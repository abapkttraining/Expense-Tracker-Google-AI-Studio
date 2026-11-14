import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const ALLOWED_PAYMENT_METHODS = [
  'PhonePe',
  'Google Pay (GPay)',
  'BHIM UPI',
  'Paytm',
  'Debit Card',
  'Credit Card',
  'Cash',
] as const;

interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
}

async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid authentication token' });
  }
}

interface TagInput {
  id: string;
  name: string;
  parentCategory?: string;
}

interface MemberInput {
  uid: string;
  displayName: string;
}

function normalizePaymentMethod(raw: string | undefined): (typeof ALLOWED_PAYMENT_METHODS)[number] {
  if (!raw) return 'PhonePe';
  const lower = raw.toLowerCase();
  if (lower.includes('phonepe') || lower.includes('phone pe')) return 'PhonePe';
  if (lower.includes('gpay') || lower.includes('google pay') || lower.includes('googlepay')) {
    return 'Google Pay (GPay)';
  }
  if (lower.includes('bhim')) return 'BHIM UPI';
  if (lower.includes('paytm')) return 'Paytm';
  if (lower.includes('debit')) return 'Debit Card';
  if (lower.includes('credit')) return 'Credit Card';
  if (lower.includes('cash')) return 'Cash';
  if (lower.includes('upi')) return 'Google Pay (GPay)';
  const exact = ALLOWED_PAYMENT_METHODS.find((m) => m.toLowerCase() === lower);
  return exact ?? 'PhonePe';
}

function isValidIsoDate(val: string | undefined): boolean {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/exchange-rates', (req: Request, res: Response) => {
    const requestedDate =
      typeof req.query.date === 'string' && isValidIsoDate(req.query.date)
        ? req.query.date
        : new Date().toISOString().slice(0, 10);

    // Deterministic daily seed from YYYY-MM-DD so rates remain stable all day and vary daily
    let seed = 0;
    for (let i = 0; i < requestedDate.length; i += 1) {
      seed = (seed * 31 + requestedDate.charCodeAt(i)) % 1000003;
    }

    const usdOffset = ((seed % 121) - 60) * 0.01; // -0.60 to +0.60
    const eurOffset = (((seed * 7) % 161) - 80) * 0.01; // -0.80 to +0.80

    const inrPerUsd = Math.round((84.25 + usdOffset) * 100) / 100;
    const inrPerEur = Math.round((91.15 + eurOffset) * 100) / 100;

    const usdPerInr = Math.round((1 / inrPerUsd) * 1_000_000) / 1_000_000;
    const eurPerInr = Math.round((1 / inrPerEur) * 1_000_000) / 1_000_000;

    res.json({
      base: 'INR',
      date: requestedDate,
      source: 'Mock Daily Exchange Rate API',
      rates: {
        INR: 1,
        USD: usdPerInr,
        EUR: eurPerInr,
      },
      inrPerUnit: {
        INR: 1,
        USD: inrPerUsd,
        EUR: inrPerEur,
      },
      updatedAt: new Date().toISOString(),
    });
  });

  app.post(
    '/api/ai/parse-expense',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!process.env.GEMINI_API_KEY) {
          res.status(503).json({
            error:
              'Gemini API key is not configured. Please verify GEMINI_API_KEY in Settings > Secrets.',
          });
          return;
        }

        const { message, image, tags, members, todayDate, currentUserUid } = req.body as {
          message?: string;
          image?: { mimeType?: string; data?: string };
          tags?: TagInput[];
          members?: MemberInput[];
          todayDate?: string;
          currentUserUid?: string;
        };

        const trimmedMessage = typeof message === 'string' ? message.trim() : '';
        const rawImageData = typeof image?.data === 'string' ? image.data.trim() : '';
        const rawMimeType = typeof image?.mimeType === 'string' ? image.mimeType.trim().toLowerCase() : '';
        const hasImage = rawImageData.length > 0;

        if (!trimmedMessage && !hasImage) {
          res.status(400).json({
            error: 'Please provide an expense message or attach a UPI screenshot.',
          });
          return;
        }

        if (hasImage && !ALLOWED_IMAGE_MIME_TYPES.has(rawMimeType)) {
          res.status(400).json({
            error: 'Unsupported image format. Please upload a PNG, JPEG, or WebP screenshot.',
          });
          return;
        }

        const safeToday = isValidIsoDate(todayDate)
          ? todayDate!
          : new Date().toISOString().slice(0, 10);
        const safeTags = Array.isArray(tags) ? tags : [];
        const safeMembers = Array.isArray(members) ? members : [];
        const fallbackUid =
          typeof currentUserUid === 'string' && currentUserUid
            ? currentUserUid
            : req.user?.uid ?? '';

        const tagListText = safeTags
          .map((t) =>
            t.parentCategory
              ? `- id: "${t.id}", name: "${t.name}" (sub-tag of "${t.parentCategory}")`
              : `- id: "${t.id}", name: "${t.name}"`
          )
          .join('\n');

        const memberListText = safeMembers
          .map((m) => `- uid: "${m.uid}", name: "${m.displayName}"`)
          .join('\n');

        const systemInstruction = `You are a precision Indian personal & group finance expense parser and OCR receipt/UPI-history reader.
Convert the user's natural language message and/or attached screenshot (such as a PhonePe, Google Pay / GPay, Paytm, BHIM UPI, or bank transaction receipt or transaction history list) into one or more structured INR expense records.

Context:
- Today's date: ${safeToday}
- Default payer UID: "${fallbackUid}"
- Allowed payment methods: ${ALLOWED_PAYMENT_METHODS.join(', ')}
- Available project tags:
${tagListText || '- id: "other", name: "Other"'}
- Available project members:
${memberListText || `- uid: "${fallbackUid}", name: "Current User"`}

Rules:
1. If an image shows a UPI transaction history list with MULTIPLE transactions, extract EVERY visible completed outgoing expense / debit / payment row into the "expenses" array (do not skip valid rows). If it is a single transaction receipt or a single text message, return 1 item in "expenses". If a text message lists multiple expenses, extract all of them too.
2. For transaction history screenshots:
   - Extract outgoing payments ("Paid to", "Sent to", "Debited from", negative amounts, "Payment to", merchant names).
   - Skip failed/cancelled transactions and skip incoming credits/money received ("Received from", "+ ₹...", "Credited") unless the user explicitly asks to include them.
3. Extract numeric amount in INR (₹) for each item (positive number, without currency symbols or commas). If no numeric amount can be detected anywhere, return 1 item with amount 0.
4. Pick the closest paymentMethod from the allowed list. Look at app branding, logos, UI colors, or text in screenshots (PhonePe purple/logo -> "PhonePe", Google Pay / GPay -> "Google Pay (GPay)", Paytm -> "Paytm", BHIM -> "BHIM UPI", card -> "Credit Card" or "Debit Card"). If generic UPI without app branding, use "Google Pay (GPay)" or "PhonePe". User text overrides screenshot detection if specified.
5. Determine each expense date in YYYY-MM-DD format relative to ${safeToday}. Convert labels like "Today", "Yesterday", "14 Nov", "02 Nov 2026", "12/11/26" into YYYY-MM-DD (if year is omitted in a screenshot, infer the most recent date <= ${safeToday}; default to ${safeToday} if no date is visible).
6. Match one or more tag IDs from the available project tags list based on the merchant/payee/category (e.g., Swiggy/Zomato/restaurant/Blinkit -> Food or Groceries; Uber/Ola/Rapido/Metro/Petrol -> Travel or Fuel; Jio/Airtel/Electricity/BESCOM/Broadband -> Bills / Phone Recharge / Electricity / Internet). Only return tag IDs that exist in the provided list. Fallback to the "other" tag ID if available.
7. Match paidByUid to a project member if named in text or screenshot; otherwise use "${fallbackUid}".
8. Detect recurring bills (e.g. monthly broadband, electricity, daily milk, weekly gym, subscriptions) -> set isRecurring true and frequency to "daily", "weekly", "monthly", or "yearly"; otherwise isRecurring false and frequency "".
9. Detect equal split intent in the user's message (e.g. "split equally", "split with everyone", "shared") -> set splitMode to "equal"; otherwise "none".
10. Write a concise, clean description per expense (merchant/payee name or purpose, max 120 chars, e.g. "Paid to Swiggy" or "BESCOM Electricity Bill").
11. Write a helpful 1-sentence top-level assistantReply summarizing how many expenses were found and the total amount in ₹.`;

        const promptText = trimmedMessage
          ? hasImage
            ? `Extract all expenses from the attached image. User note: ${trimmedMessage}`
            : trimmedMessage
          : 'Read this UPI transaction or transaction history screenshot and extract all outgoing expenses.';

        const contents = hasImage
          ? {
              parts: [
                {
                  inlineData: {
                    mimeType: rawMimeType === 'image/jpg' ? 'image/jpeg' : rawMimeType,
                    data: rawImageData,
                  },
                },
                { text: promptText },
              ],
            }
          : promptText;

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                assistantReply: {
                  type: Type.STRING,
                  description:
                    'Friendly 1-sentence summary stating how many expenses were extracted and total ₹.',
                },
                expenses: {
                  type: Type.ARRAY,
                  description: 'List of all extracted expenses from the text or screenshot.',
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      amount: {
                        type: Type.NUMBER,
                        description: 'Parsed expense amount in INR. 0 if not detected.',
                      },
                      description: {
                        type: Type.STRING,
                        description: 'Clean, concise merchant or expense description.',
                      },
                      paymentMethod: {
                        type: Type.STRING,
                        description:
                          'One of: PhonePe, Google Pay (GPay), BHIM UPI, Paytm, Debit Card, Credit Card, Cash.',
                      },
                      date: {
                        type: Type.STRING,
                        description: 'Expense date in YYYY-MM-DD format.',
                      },
                      matchedTagIds: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Array of matching tag IDs from the provided project tags list.',
                      },
                      paidByUid: {
                        type: Type.STRING,
                        description: 'UID of the project member who paid.',
                      },
                      isRecurring: {
                        type: Type.BOOLEAN,
                        description: 'True if recurring bill or subscription.',
                      },
                      frequency: {
                        type: Type.STRING,
                        description:
                          'Recurring schedule when isRecurring is true: daily, weekly, monthly, or yearly. Empty string otherwise.',
                      },
                      splitMode: {
                        type: Type.STRING,
                        description:
                          'Set to "equal" if user mentions splitting the expense; otherwise "none".',
                      },
                      confidence: {
                        type: Type.STRING,
                        description: 'Confidence level: high, medium, or low.',
                      },
                    },
                    required: [
                      'amount',
                      'description',
                      'paymentMethod',
                      'date',
                      'matchedTagIds',
                      'paidByUid',
                      'isRecurring',
                      'frequency',
                      'splitMode',
                      'confidence',
                    ],
                  },
                },
              },
              required: ['assistantReply', 'expenses'],
            },
          },
        });

        const rawText = (response.text ?? '{}').trim();
        const parsed = JSON.parse(rawText) as {
          assistantReply?: string;
          expenses?: Array<{
            amount?: number;
            description?: string;
            paymentMethod?: string;
            date?: string;
            matchedTagIds?: string[];
            paidByUid?: string;
            isRecurring?: boolean;
            frequency?: string;
            splitMode?: string;
            confidence?: string;
          }>;
        };

        const validTagIdSet = new Set(safeTags.map((t) => t.id));
        const validMemberSet = new Set(safeMembers.map((m) => m.uid));
        const rawExpenses = Array.isArray(parsed.expenses) && parsed.expenses.length > 0
          ? parsed.expenses
          : [{}];

        const normalizedExpenses = rawExpenses.slice(0, 25).map((item) => {
          const filteredTags = (Array.isArray(item.matchedTagIds) ? item.matchedTagIds : []).filter(
            (id) => validTagIdSet.has(id)
          );
          if (filteredTags.length === 0) {
            const otherTag = safeTags.find((t) => t.name.toLowerCase() === 'other') ?? safeTags[0];
            if (otherTag) filteredTags.push(otherTag.id);
          }

          const paidByUid =
            item.paidByUid && validMemberSet.has(item.paidByUid)
              ? item.paidByUid
              : fallbackUid;

          const amount =
            typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0
              ? Math.round(item.amount * 100) / 100
              : 0;

          const confidence =
            item.confidence === 'high' ||
            item.confidence === 'medium' ||
            item.confidence === 'low'
              ? item.confidence
              : amount > 0
                ? 'high'
                : 'low';

          const isRecurring = Boolean(item.isRecurring);
          const normalizedFrequency =
            item.frequency === 'daily' ||
            item.frequency === 'weekly' ||
            item.frequency === 'monthly' ||
            item.frequency === 'yearly'
              ? item.frequency
              : isRecurring
                ? 'monthly'
                : undefined;

          const splitMode = item.splitMode === 'equal' ? 'equal' : 'none';
          const fallbackDesc = trimmedMessage || (hasImage ? 'UPI Transaction' : 'Expense');

          return {
            amount,
            description: (item.description || fallbackDesc).slice(0, 200),
            paymentMethod: normalizePaymentMethod(item.paymentMethod),
            date: isValidIsoDate(item.date) ? item.date : safeToday,
            matchedTagIds: filteredTags.slice(0, 10),
            paidByUid,
            isRecurring,
            frequency: normalizedFrequency,
            splitMode,
            assistantReply: '',
            confidence,
          };
        });

        const totalExtracted = normalizedExpenses.reduce((sum, e) => sum + e.amount, 0);
        const defaultReply =
          totalExtracted > 0
            ? normalizedExpenses.length > 1
              ? `Found ${normalizedExpenses.length} expenses totaling ₹${totalExtracted.toLocaleString('en-IN')}. Review and save individually or click Save All.`
              : `Extracted ₹${totalExtracted.toLocaleString('en-IN')} expense. Review and click Confirm & Save.`
            : 'Could not detect clear expense amounts. Please review and enter the amount in ₹ before saving.';

        res.json({
          assistantReply: parsed.assistantReply || defaultReply,
          expenses: normalizedExpenses,
        });
      } catch (error: unknown) {
        console.error('AI expense parse error:', error);
        const msg =
          error instanceof Error ? error.message : 'Failed to parse expense with Gemini AI.';
        res.status(500).json({ error: msg });
      }
    }
  );

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*path}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`KhataLedger server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

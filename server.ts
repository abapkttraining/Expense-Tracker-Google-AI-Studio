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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
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

        const { message, tags, members, todayDate, currentUserUid } = req.body as {
          message?: string;
          tags?: TagInput[];
          members?: MemberInput[];
          todayDate?: string;
          currentUserUid?: string;
        };

        if (!message || typeof message !== 'string' || !message.trim()) {
          res.status(400).json({ error: 'Please provide an expense description message.' });
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

        const systemInstruction = `You are a precision Indian personal & group finance expense parser.
Convert the user's natural language message into a structured INR expense record.

Context:
- Today's date: ${safeToday}
- Default payer UID: "${fallbackUid}"
- Allowed payment methods: ${ALLOWED_PAYMENT_METHODS.join(', ')}
- Available project tags:
${tagListText || '- id: "other", name: "Other"'}
- Available project members:
${memberListText || `- uid: "${fallbackUid}", name: "Current User"`}

Rules:
1. Extract numeric amount in INR (₹). If no numeric amount is found, set amount to 0.
2. Pick the closest paymentMethod from the allowed list. Map "GPay", "Google Pay", or generic "UPI" to "Google Pay (GPay)" unless "PhonePe", "Paytm", or "BHIM" is named. Default to "PhonePe" if unspecified.
3. Determine the expense date in YYYY-MM-DD format relative to ${safeToday} (e.g., "yesterday" -> 1 day before ${safeToday}; default to ${safeToday}).
4. Match one or more tag IDs from the available project tags list (for example, "electricity bill and internet" should match both Electricity and Internet, or Bills). Only return tag IDs that exist in the provided list. If none match, return the "other" tag ID if available.
5. Match paidByUid to a project member if the message names someone who paid; otherwise use "${fallbackUid}".
6. Detect if this is a recurring bill or subscription (e.g. "monthly internet bill", "daily milk", "weekly gym", "annual subscription"). If recurring, set isRecurring to true and frequency to one of: "daily", "weekly", "monthly", "yearly". Otherwise set isRecurring to false and frequency to "".
7. Detect if the user wants to split this expense equally among members (e.g., "split equally", "split with everyone", "split between us", "shared bill"). If so, set splitMode to "equal"; otherwise set splitMode to "none".
8. Write a concise, natural description (max 120 chars) and a helpful 1-sentence assistantReply summarizing the parsed expense in ₹.`;

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: message.trim(),
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                amount: {
                  type: Type.NUMBER,
                  description: 'Parsed expense amount in INR. 0 if not detected.',
                },
                description: {
                  type: Type.STRING,
                  description: 'Clean, concise description of the expense.',
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
                  description: 'True if the user mentions a recurring bill or schedule.',
                },
                frequency: {
                  type: Type.STRING,
                  description:
                    'Recurring schedule when isRecurring is true: daily, weekly, monthly, or yearly. Empty string otherwise.',
                },
                splitMode: {
                  type: Type.STRING,
                  description: 'Set to "equal" if user mentions splitting the expense; otherwise "none".',
                },
                assistantReply: {
                  type: Type.STRING,
                  description: 'Friendly 1-sentence summary confirming what was extracted.',
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
                'assistantReply',
                'confidence',
              ],
            },
          },
        });

        const rawText = (response.text ?? '{}').trim();
        const parsed = JSON.parse(rawText) as {
          amount?: number;
          description?: string;
          paymentMethod?: string;
          date?: string;
          matchedTagIds?: string[];
          paidByUid?: string;
          isRecurring?: boolean;
          frequency?: string;
          splitMode?: string;
          assistantReply?: string;
          confidence?: string;
        };

        const validTagIdSet = new Set(safeTags.map((t) => t.id));
        const filteredTags = (Array.isArray(parsed.matchedTagIds) ? parsed.matchedTagIds : []).filter(
          (id) => validTagIdSet.has(id)
        );
        if (filteredTags.length === 0) {
          const otherTag = safeTags.find((t) => t.name.toLowerCase() === 'other') ?? safeTags[0];
          if (otherTag) filteredTags.push(otherTag.id);
        }

        const validMemberSet = new Set(safeMembers.map((m) => m.uid));
        const paidByUid =
          parsed.paidByUid && validMemberSet.has(parsed.paidByUid)
            ? parsed.paidByUid
            : fallbackUid;

        const amount =
          typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) && parsed.amount > 0
            ? Math.round(parsed.amount * 100) / 100
            : 0;

        const confidence =
          parsed.confidence === 'high' ||
          parsed.confidence === 'medium' ||
          parsed.confidence === 'low'
            ? parsed.confidence
            : amount > 0
              ? 'high'
              : 'low';

        const isRecurring = Boolean(parsed.isRecurring);
        const normalizedFrequency =
          parsed.frequency === 'daily' ||
          parsed.frequency === 'weekly' ||
          parsed.frequency === 'monthly' ||
          parsed.frequency === 'yearly'
            ? parsed.frequency
            : isRecurring
              ? 'monthly'
              : undefined;

        const splitMode = parsed.splitMode === 'equal' ? 'equal' : 'none';

        res.json({
          amount,
          description: (parsed.description || message.trim()).slice(0, 200),
          paymentMethod: normalizePaymentMethod(parsed.paymentMethod),
          date: isValidIsoDate(parsed.date) ? parsed.date : safeToday,
          matchedTagIds: filteredTags.slice(0, 10),
          paidByUid,
          isRecurring,
          frequency: normalizedFrequency,
          splitMode,
          assistantReply:
            parsed.assistantReply ||
            (amount > 0
              ? 'Parsed your expense details. Review and click Confirm & Save.'
              : 'Could not detect an amount. Please enter the amount in ₹ before saving.'),
          confidence,
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

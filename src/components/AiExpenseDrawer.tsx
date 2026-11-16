import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  FileText,
  FileUp,
  Loader2,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { formatINR } from '../constants';
import { useCurrency } from '../hooks/useCurrency';
import {
  askProjectChatbot,
  parseExpenseWithAI,
  type AiExpenseAttachmentPayload,
} from '../services/aiService';
import { findDuplicateExpenses, makeDuplicateSignature } from '../utils/duplicateUtils';
import { formatFrequencyLabel } from '../utils/recurringUtils';
import {
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  type Expense,
  type ParsedExpenseDraft,
  type PaymentMethod,
  type ProjectChatTurn,
  type ProjectMember,
  type ReceivedMoney,
  type RecurringFrequency,
  type Settlement,
  type Tag,
} from '../types';

interface DraftItem {
  id: string;
  draft: ParsedExpenseDraft;
  saved: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imagePreviewUrl?: string;
  attachmentKind?: 'image' | 'pdf';
  attachmentName?: string;
  attachmentSizeLabel?: string;
  drafts?: DraftItem[];
}

interface PendingAttachment {
  kind: 'image' | 'pdf';
  previewUrl?: string;
  fileName: string;
  fileSizeLabel: string;
  payload: AiExpenseAttachmentPayload;
}

interface QaMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

interface AiExpenseDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  monthlyBudget?: number;
  existingExpenses: Expense[];
  tags: Tag[];
  members: ProjectMember[];
  settlements: Settlement[];
  receivedMoney: ReceivedMoney[];
  onConfirmSave: (draft: ParsedExpenseDraft) => Promise<void>;
  onConfirmSaveBatch?: (drafts: ParsedExpenseDraft[]) => Promise<void>;
}

const SAMPLE_PROMPTS = [
  'Paid 650 on PhonePe for dinner at restaurant with friends',
  '1200 GPay monthly electricity bill and internet',
  '480 Paytm petrol refill for bike',
];

const CHAT_STARTER_PROMPTS = [
  "Summarize this month's expenses and budget status",
  'Break down spending by tag & top categories',
  'Which payment methods were used the most?',
  'List recurring bills & highest expenses in this project',
];

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`b-${keyCounter++}`} className="font-semibold text-slate-900 dark:text-slate-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`c-${keyCounter++}`}
          className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono-tabular text-[11px] text-teal-800 dark:text-teal-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}

function FormattedChatMessage({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: { ordered: boolean; items: string[] } | null = null;
  let blockIdx = 0;

  const flushList = () => {
    if (!listItems) return;
    if (listItems.ordered) {
      blocks.push(
        <ol key={`ol-${blockIdx++}`} className="list-decimal pl-4 space-y-1">
          {listItems.items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ol>
      );
    } else {
      blocks.push(
        <ul key={`ul-${blockIdx++}`} className="list-disc pl-4 space-y-1">
          {listItems.items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>
      );
    }
    listItems = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bulletMatch = /^[-*•]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      if (listItems && listItems.ordered) flushList();
      if (!listItems) listItems = { ordered: false, items: [] };
      listItems.items.push(bulletMatch[1]);
      continue;
    }

    const orderedMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (orderedMatch) {
      if (listItems && !listItems.ordered) flushList();
      if (!listItems) listItems = { ordered: true, items: [] };
      listItems.items.push(orderedMatch[1]);
      continue;
    }

    flushList();

    const headingMatch = /^#{1,4}\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push(
        <p key={`h-${blockIdx++}`} className="font-semibold text-slate-900 dark:text-slate-100 pt-1">
          {renderInlineMarkdown(headingMatch[1])}
        </p>
      );
    } else {
      blocks.push(
        <p key={`p-${blockIdx++}`} className="leading-relaxed">
          {renderInlineMarkdown(line)}
        </p>
      );
    }
  }
  flushList();

  return <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200">{blocks}</div>;
}

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB binary limit (~20 MB base64)

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdfFile(file: File): boolean {
  const type = file.type.toLowerCase();
  return (
    type === 'application/pdf' ||
    type === 'application/x-pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

async function readFileAsDataUrl(file: File, label: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Failed to read ${label}.`));
    reader.readAsDataURL(file);
  });
}

async function preparePdfForUpload(file: File): Promise<PendingAttachment> {
  if (file.size <= 0) {
    throw new Error('The selected PDF file is empty.');
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error('PDF file is too large (max 15 MB). Please attach a smaller bill or statement.');
  }

  const dataUrl = await readFileAsDataUrl(file, 'PDF file');
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

  return {
    kind: 'pdf',
    fileName: file.name || 'document.pdf',
    fileSizeLabel: formatFileSize(file.size),
    payload: {
      mimeType: 'application/pdf',
      data: base64,
      fileName: file.name || 'document.pdf',
    },
  };
}

async function prepareImageForUpload(file: File): Promise<PendingAttachment> {
  const dataUrl = await readFileAsDataUrl(file, 'image file');

  // Keep crisp small screenshots as-is if <= 1.2MB
  if (
    file.size <= 1_200_000 &&
    (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp')
  ) {
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return {
      kind: 'image',
      previewUrl: dataUrl,
      fileName: file.name || 'screenshot.png',
      fileSizeLabel: formatFileSize(file.size),
      payload: {
        mimeType: file.type,
        data: base64,
        fileName: file.name || 'screenshot.png',
      },
    };
  }

  // Resize/compress large screenshots cleanly while preserving OCR legibility
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
    image.src = dataUrl;
  });

  const maxSide = 2048;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to process image in browser.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const compressedUrl = canvas.toDataURL('image/jpeg', 0.88);
  const base64 = compressedUrl.slice(compressedUrl.indexOf(',') + 1);

  return {
    kind: 'image',
    previewUrl: compressedUrl,
    fileName: file.name || 'screenshot.jpg',
    fileSizeLabel: formatFileSize(file.size),
    payload: {
      mimeType: 'image/jpeg',
      data: base64,
      fileName: file.name || 'screenshot.jpg',
    },
  };
}

export function AiExpenseDrawer({
  open,
  onClose,
  projectId,
  projectName,
  monthlyBudget,
  existingExpenses,
  tags,
  members,
  settlements,
  receivedMoney,
  onConfirmSave,
  onConfirmSaveBatch,
}: AiExpenseDrawerProps) {
  const [drawerMode, setDrawerMode] = useState<'log' | 'chat'>('log');
  const [input, setInput] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [savingBatchMsgId, setSavingBatchMsgId] = useState<string | null>(null);
  const [acknowledgedDuplicateDraftIds, setAcknowledgedDuplicateDraftIds] = useState<Set<string>>(
    () => new Set()
  );
  const [acknowledgedDuplicateBatchMsgIds, setAcknowledgedDuplicateBatchMsgIds] = useState<
    Set<string>
  >(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Multi-turn project-scoped Gemini Q&A state
  const [qaInput, setQaInput] = useState('');
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const qaEndRef = useRef<HTMLDivElement>(null);
  const { currency, formatAmount } = useCurrency();

  // Strictly isolate conversation history when switching projects
  useEffect(() => {
    setMessages([]);
    setQaMessages([]);
    setPendingAttachment(null);
    setError(null);
    setQaError(null);
    setQaInput('');
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    if (drawerMode === 'log') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      qaEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, drawerMode, messages.length, parsing, qaMessages.length, qaLoading]);

  if (!open) return null;

  const handleAttachFile = async (file: File | null | undefined) => {
    if (!file) return;
    const pdf = isPdfFile(file);
    const image = file.type.startsWith('image/');
    if (!pdf && !image) {
      setError('Please select an image screenshot (PNG, JPEG, WebP) or a PDF document.');
      return;
    }
    setError(null);
    try {
      const prepared = pdf
        ? await preparePdfForUpload(file)
        : await prepareImageForUpload(file);
      setPendingAttachment(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to attach file.');
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          void handleAttachFile(file);
          return;
        }
      }
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void handleAttachFile(file);
    }
  };

  const handleSend = async (textOverride?: string) => {
    const query = (textOverride ?? input).trim();
    const attachmentToSend = textOverride ? null : pendingAttachment;

    if ((!query && !attachmentToSend) || parsing) return;

    setError(null);
    if (!textOverride) {
      setInput('');
      setPendingAttachment(null);
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text:
        query ||
        (attachmentToSend?.kind === 'pdf'
          ? 'Extract expenses from attached PDF'
          : 'Uploaded UPI screenshot'),
      imagePreviewUrl: attachmentToSend?.previewUrl,
      attachmentKind: attachmentToSend?.kind,
      attachmentName: attachmentToSend?.fileName,
      attachmentSizeLabel: attachmentToSend?.fileSizeLabel,
    };
    setMessages((prev) => [...prev, userMsg]);
    setParsing(true);

    try {
      const result = await parseExpenseWithAI(
        {
          message: query,
          attachment: attachmentToSend?.payload,
        },
        tags,
        members
      );
      const msgTimestamp = Date.now();
      const drafts: DraftItem[] = result.expenses.map((draft, idx) => ({
        id: `d-${msgTimestamp}-${idx}`,
        draft,
        saved: false,
      }));
      const assistantMsg: ChatMessage = {
        id: `a-${msgTimestamp}`,
        role: 'assistant',
        text: result.assistantReply,
        drafts,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse expense right now.');
    } finally {
      setParsing(false);
    }
  };

  const handleSendQa = async (promptOverride?: string) => {
    const question = (promptOverride ?? qaInput).trim();
    if (!question || qaLoading) return;

    setQaError(null);
    if (!promptOverride) {
      setQaInput('');
    }

    const priorHistory: ProjectChatTurn[] = qaMessages.map((m) => ({
      role: m.role,
      text: m.text,
    }));

    const userTurn: QaMessage = {
      id: `qa-u-${Date.now()}`,
      role: 'user',
      text: question,
    };

    setQaMessages((prev) => [...prev, userTurn]);
    setQaLoading(true);

    try {
      const result = await askProjectChatbot({
        projectId,
        projectName,
        monthlyBudget,
        question,
        history: priorHistory,
        displayCurrency: currency,
        expenses: existingExpenses,
        tags,
        members,
        settlements,
        receivedMoney,
      });

      const assistantTurn: QaMessage = {
        id: `qa-m-${Date.now()}`,
        role: 'model',
        text: result.reply,
      };
      setQaMessages((prev) => [...prev, assistantTurn]);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : 'Failed to answer project query.');
    } finally {
      setQaLoading(false);
    }
  };

  const updateDraftField = <K extends keyof ParsedExpenseDraft>(
    msgId: string,
    draftId: string,
    key: K,
    value: ParsedExpenseDraft[K]
  ) => {
    if (key === 'amount' || key === 'date' || key === 'description') {
      setAcknowledgedDuplicateDraftIds((prev) => {
        if (!prev.has(draftId)) return prev;
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
      setAcknowledgedDuplicateBatchMsgIds((prev) => {
        if (!prev.has(msgId)) return prev;
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    }
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.drafts) return m;
        return {
          ...m,
          drafts: m.drafts.map((item) =>
            item.id === draftId ? { ...item, draft: { ...item.draft, [key]: value } } : item
          ),
        };
      })
    );
  };

  const toggleDraftTag = (msgId: string, draftId: string, tagId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.drafts) return m;
        return {
          ...m,
          drafts: m.drafts.map((item) => {
            if (item.id !== draftId) return item;
            const exists = item.draft.matchedTagIds.includes(tagId);
            const nextTags = exists
              ? item.draft.matchedTagIds.filter((id) => id !== tagId)
              : [...item.draft.matchedTagIds, tagId];
            return {
              ...item,
              draft: { ...item.draft, matchedTagIds: nextTags.length > 0 ? nextTags : [tagId] },
            };
          }),
        };
      })
    );
  };

  const removeDraftItem = (msgId: string, draftId: string) => {
    setAcknowledgedDuplicateBatchMsgIds((prev) => {
      if (!prev.has(msgId)) return prev;
      const next = new Set(prev);
      next.delete(msgId);
      return next;
    });
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.drafts) return m;
        return {
          ...m,
          drafts: m.drafts.filter((item) => item.id !== draftId),
        };
      })
    );
  };

  const removeBatchDuplicates = (msgId: string, duplicateIds: Set<string>) => {
    if (duplicateIds.size === 0) return;
    setAcknowledgedDuplicateBatchMsgIds((prev) => {
      if (!prev.has(msgId)) return prev;
      const next = new Set(prev);
      next.delete(msgId);
      return next;
    });
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.drafts) return m;
        return {
          ...m,
          drafts: m.drafts.filter((item) => item.saved || !duplicateIds.has(item.id)),
        };
      })
    );
  };

  const handleSaveSingleDraft = async (
    msgId: string,
    item: DraftItem,
    hasDuplicate: boolean
  ) => {
    if (item.saved) return;
    if (!(item.draft.amount > 0)) {
      setError('Amount must be greater than ₹0 before saving.');
      return;
    }

    if (hasDuplicate && !acknowledgedDuplicateDraftIds.has(item.id)) {
      setError(null);
      setAcknowledgedDuplicateDraftIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      return;
    }

    setError(null);
    setSavingDraftId(item.id);
    try {
      await onConfirmSave(item.draft);
      setAcknowledgedDuplicateDraftIds((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.drafts) return m;
          return {
            ...m,
            drafts: m.drafts.map((d) => (d.id === item.id ? { ...d, saved: true } : d)),
          };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense.');
    } finally {
      setSavingDraftId(null);
    }
  };

  const handleSaveAllDrafts = async (msg: ChatMessage, batchDuplicateCount: number) => {
    const unsaved = (msg.drafts ?? []).filter((d) => !d.saved);
    if (unsaved.length === 0) return;

    const invalid = unsaved.find((d) => !(d.draft.amount > 0));
    if (invalid) {
      setError('Every expense must have an amount greater than ₹0 before saving all.');
      return;
    }

    if (batchDuplicateCount > 0 && !acknowledgedDuplicateBatchMsgIds.has(msg.id)) {
      setError(null);
      setAcknowledgedDuplicateBatchMsgIds((prev) => {
        const next = new Set(prev);
        next.add(msg.id);
        return next;
      });
      return;
    }

    setError(null);
    setSavingBatchMsgId(msg.id);
    try {
      if (onConfirmSaveBatch) {
        await onConfirmSaveBatch(unsaved.map((u) => u.draft));
      } else {
        for (const item of unsaved) {
          await onConfirmSave(item.draft);
        }
      }
      setAcknowledgedDuplicateBatchMsgIds((prev) => {
        if (!prev.has(msg.id)) return prev;
        const next = new Set(prev);
        next.delete(msg.id);
        return next;
      });
      const savedIds = new Set(unsaved.map((u) => u.id));
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msg.id || !m.drafts) return m;
          return {
            ...m,
            drafts: m.drafts.map((d) => (savedIds.has(d.id) ? { ...d, saved: true } : d)),
          };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save one or more expenses.');
    } finally {
      setSavingBatchMsgId(null);
    }
  };

  return (
    <aside
      aria-label="AI Expense Assistant"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={handleDrop}
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[460px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col"
    >
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquareText className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                AI Expense Assistant
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-teal-700 dark:text-teal-400 shrink-0" />
              <span className="truncate">Project-only access: {projectName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Expense Assistant"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="AI Assistant mode"
          className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={drawerMode === 'log'}
            onClick={() => setDrawerMode('log')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              drawerMode === 'log'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>Log Expense</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={drawerMode === 'chat'}
            onClick={() => setDrawerMode('chat')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              drawerMode === 'chat'
                ? 'bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-300 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ask AI Chat</span>
          </button>
        </div>
      </div>

      {drawerMode === 'log' ? (
      <>
      <div className="relative flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50 dark:bg-slate-950/60">
        {isDragging && (
          <div className="absolute inset-3 z-20 rounded-xl border-2 border-dashed border-teal-600 dark:border-teal-400 bg-teal-50/90 dark:bg-teal-950/90 flex flex-col items-center justify-center gap-2 text-center p-6 pointer-events-none">
            <FileUp className="w-7 h-7 text-teal-700 dark:text-teal-300" />
            <p className="text-sm font-semibold text-teal-900 dark:text-teal-100">
              Drop screenshot or PDF document
            </p>
            <p className="text-xs text-teal-700 dark:text-teal-300">
              Supports UPI receipts, history screenshots, PDF bills, invoices &amp; statements
            </p>
          </div>
        )}

        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Type an expense, upload a screenshot, or attach a PDF
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Upload a PhonePe, GPay, or Paytm screenshot—or attach a PDF invoice, utility bill,
                or bank/UPI statement—to automatically extract one or multiple expenses at once.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-3 rounded-lg border border-dashed border-teal-300 dark:border-teal-700 bg-teal-50/60 dark:bg-teal-950/40 hover:bg-teal-50 dark:hover:bg-teal-950/70 text-teal-800 dark:text-teal-300 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <FileUp className="w-4 h-4 shrink-0" />
                <span>Upload Screenshot or PDF</span>
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Or try a text example
              </p>
              <div className="space-y-2">
                {SAMPLE_PROMPTS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => void handleSend(sample)}
                    className="w-full text-left p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-teal-600 dark:hover:border-teal-500 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
                  >
                    &ldquo;{sample}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const drafts = msg.drafts ?? [];
          const unsavedCount = drafts.filter((d) => !d.saved).length;
          const totalDraftAmount = drafts.reduce((sum, d) => sum + (d.draft.amount || 0), 0);

          const seenBatchSignatures = new Set<string>();
          const duplicateInfoByDraftId = new Map<
            string,
            { existingMatch: Expense | null; isIntraBatchDuplicate: boolean }
          >();
          const duplicateDraftIdSet = new Set<string>();

          for (const item of drafts) {
            if (item.saved) continue;
            const matches = findDuplicateExpenses(
              {
                description: item.draft.description,
                date: item.draft.date,
                amount: item.draft.amount,
              },
              existingExpenses
            );
            const sig = makeDuplicateSignature({
              description: item.draft.description,
              date: item.draft.date,
              amount: item.draft.amount,
            });
            const isIntraBatchDuplicate =
              item.draft.amount > 0 && Boolean(item.draft.date.trim()) && seenBatchSignatures.has(sig);
            if (item.draft.amount > 0 && item.draft.date.trim()) {
              seenBatchSignatures.add(sig);
            }
            const existingMatch = matches[0] ?? null;
            if (existingMatch || isIntraBatchDuplicate) {
              duplicateDraftIdSet.add(item.id);
              duplicateInfoByDraftId.set(item.id, { existingMatch, isIntraBatchDuplicate });
            }
          }

          const batchDuplicateCount = duplicateDraftIdSet.size;
          const batchConfirmPending =
            batchDuplicateCount > 0 && acknowledgedDuplicateBatchMsgIds.has(msg.id);

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-slate-900 dark:bg-teal-700 text-white text-sm space-y-2">
                  {msg.imagePreviewUrl && (
                    <img
                      src={msg.imagePreviewUrl}
                      alt="Uploaded UPI screenshot"
                      className="max-h-56 w-auto rounded-lg border border-white/15 object-contain bg-black/20"
                    />
                  )}
                  {msg.attachmentKind === 'pdf' && msg.attachmentName && (
                    <div className="flex items-center gap-2.5 rounded-lg bg-white/10 border border-white/15 px-3 py-2">
                      <FileText className="w-4 h-4 shrink-0 text-teal-200" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{msg.attachmentName}</p>
                        {msg.attachmentSizeLabel && (
                          <p className="text-[11px] text-white/75">
                            PDF · {msg.attachmentSizeLabel}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {msg.text && <p className="leading-snug">{msg.text}</p>}
                </div>
              ) : (
                <div className="w-full space-y-2.5">
                  <p className="text-xs text-slate-600 dark:text-slate-400 px-1">{msg.text}</p>

                  {drafts.length > 1 && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {drafts.length} expenses detected
                          </span>
                          <span className="text-slate-400 dark:text-slate-500 mx-1.5">&middot;</span>
                          <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-300">
                            {formatAmount(totalDraftAmount)}
                          </span>
                        </div>
                        {unsavedCount > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {batchDuplicateCount > 0 && (
                              <button
                                type="button"
                                disabled={savingBatchMsgId === msg.id}
                                onClick={() => removeBatchDuplicates(msg.id, duplicateDraftIdSet)}
                                className="px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Skip Duplicates ({batchDuplicateCount})
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={savingBatchMsgId === msg.id}
                              onClick={() => void handleSaveAllDrafts(msg, batchDuplicateCount)}
                              className={`px-3 py-1.5 rounded-lg text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                batchConfirmPending
                                  ? 'bg-amber-600 hover:bg-amber-700'
                                  : 'bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500'
                              }`}
                            >
                              {savingBatchMsgId === msg.id ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Saving All...</span>
                                </>
                              ) : (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>
                                    {batchConfirmPending
                                      ? `Save All Anyway (${unsavedCount})`
                                      : `Save All (${unsavedCount})`}
                                  </span>
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>All Saved</span>
                          </span>
                        )}
                      </div>

                      {unsavedCount > 0 && batchDuplicateCount > 0 && (
                        <div
                          role="alert"
                          className="rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <span>
                            {batchDuplicateCount}{' '}
                            {batchDuplicateCount === 1 ? 'item matches' : 'items match'} an
                            existing or duplicate expense.{' '}
                            {batchConfirmPending
                              ? 'Click "Save All Anyway" to log all items including duplicates.'
                              : 'Review highlighted rows or click Skip Duplicates.'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {drafts.map((item, idx) => {
                    const dupInfo = !item.saved ? duplicateInfoByDraftId.get(item.id) : undefined;
                    const hasDuplicate = Boolean(dupInfo);
                    const draftConfirmPending =
                      hasDuplicate && acknowledgedDuplicateDraftIds.has(item.id);
                    return (
                    <div
                      key={item.id}
                      className={`bg-white dark:bg-slate-900 border rounded-xl p-4 space-y-3 ${
                        hasDuplicate
                          ? 'border-amber-300 dark:border-amber-800/80'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                            {drafts.length > 1
                              ? item.saved
                                ? `#${idx + 1} · Saved`
                                : `#${idx + 1} · Review Expense`
                              : item.saved
                                ? 'Saved to Ledger'
                                : 'Review Extracted Expense'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            title={
                              currency !== 'INR'
                                ? `Stored amount: ${formatINR(item.draft.amount)}`
                                : undefined
                            }
                            className="font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100"
                          >
                            {formatAmount(item.draft.amount)}
                          </span>
                          {!item.saved && drafts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeDraftItem(msg.id, item.id)}
                              aria-label={`Remove extracted expense ${idx + 1}`}
                              title="Remove this item"
                              className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <label className="space-y-1">
                          <span className="text-slate-500 dark:text-slate-400 block">
                            Amount (₹)
                          </span>
                          <input
                            type="number"
                            min="1"
                            step="any"
                            disabled={item.saved}
                            value={item.draft.amount || ''}
                            onChange={(e) =>
                              updateDraftField(
                                msg.id,
                                item.id,
                                'amount',
                                Number(e.target.value) || 0
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-slate-500 dark:text-slate-400 block">Date</span>
                          <input
                            type="date"
                            disabled={item.saved}
                            value={item.draft.date}
                            onChange={(e) =>
                              updateDraftField(msg.id, item.id, 'date', e.target.value)
                            }
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-slate-500 dark:text-slate-400 block">
                            Payment Method
                          </span>
                          <select
                            disabled={item.saved}
                            value={item.draft.paymentMethod}
                            onChange={(e) =>
                              updateDraftField(
                                msg.id,
                                item.id,
                                'paymentMethod',
                                e.target.value as PaymentMethod
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                          >
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-slate-500 dark:text-slate-400 block">Paid By</span>
                          <select
                            disabled={item.saved}
                            value={item.draft.paidByUid}
                            onChange={(e) =>
                              updateDraftField(msg.id, item.id, 'paidByUid', e.target.value)
                            }
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                          >
                            {members.map((m) => (
                              <option key={m.uid} value={m.uid}>
                                {m.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label className="space-y-1 block text-xs">
                        <span className="text-slate-500 dark:text-slate-400 block">
                          Description
                        </span>
                        <input
                          type="text"
                          disabled={item.saved}
                          value={item.draft.description}
                          onChange={(e) =>
                            updateDraftField(msg.id, item.id, 'description', e.target.value)
                          }
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                        />
                      </label>

                      <div className="space-y-1.5">
                        <span className="text-xs text-slate-500 dark:text-slate-400 block">
                          Matched Tags
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map((tag) => {
                            const selected = item.draft.matchedTagIds.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                disabled={item.saved}
                                onClick={() => toggleDraftTag(msg.id, item.id, tag.id)}
                                className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer disabled:cursor-default ${
                                  selected
                                    ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                                    : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                }`}
                              >
                                {tag.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              disabled={item.saved}
                              checked={Boolean(item.draft.isRecurring)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                updateDraftField(msg.id, item.id, 'isRecurring', checked);
                                if (checked && !item.draft.frequency) {
                                  updateDraftField(msg.id, item.id, 'frequency', 'monthly');
                                }
                              }}
                              className="w-3.5 h-3.5 accent-teal-700 rounded"
                            />
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              Recurring bill
                            </span>
                          </label>

                          {item.draft.isRecurring && (
                            <select
                              disabled={item.saved}
                              value={item.draft.frequency ?? 'monthly'}
                              onChange={(e) =>
                                updateDraftField(
                                  msg.id,
                                  item.id,
                                  'frequency',
                                  e.target.value as RecurringFrequency
                                )
                              }
                              className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                            >
                              {RECURRING_FREQUENCIES.map((freq) => (
                                <option key={freq} value={freq}>
                                  {formatFrequencyLabel(freq)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {members.length > 1 && (
                          <label className="flex items-center justify-between gap-2 cursor-pointer">
                            <span className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                disabled={item.saved}
                                checked={item.draft.splitMode === 'equal'}
                                onChange={(e) =>
                                  updateDraftField(
                                    msg.id,
                                    item.id,
                                    'splitMode',
                                    e.target.checked ? 'equal' : 'none'
                                  )
                                }
                                className="w-3.5 h-3.5 accent-teal-700 rounded"
                              />
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                Split equally ({members.length} members)
                              </span>
                            </span>
                            {item.draft.splitMode === 'equal' && item.draft.amount > 0 && (
                              <span className="font-mono-tabular text-teal-700 dark:text-teal-400 font-semibold">
                                {formatAmount(item.draft.amount / members.length)}/ea
                              </span>
                            )}
                          </label>
                        )}
                      </div>

                      {hasDuplicate && dupInfo && (
                        <div
                          role="alert"
                          className="rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="space-y-0.5 min-w-0">
                            <p className="font-semibold">Possible duplicate expense</p>
                            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
                              {dupInfo.existingMatch
                                ? `Matches an existing entry in ${projectName} (${dupInfo.existingMatch.paidByName} · ${dupInfo.existingMatch.paymentMethod}) with the same description, date, and amount.`
                                : 'Matches another extracted expense in this message with the same description, date, and amount.'}
                            </p>
                            {draftConfirmPending && (
                              <p className="font-semibold text-amber-900 dark:text-amber-100">
                                Click &ldquo;Save Anyway&rdquo; below to confirm logging this duplicate.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="pt-1">
                        {item.saved ? (
                          <div className="w-full py-2 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5">
                            <Check className="w-4 h-4" />
                            <span>Saved to {projectName}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={savingDraftId === item.id || savingBatchMsgId === msg.id}
                            onClick={() => void handleSaveSingleDraft(msg.id, item, hasDuplicate)}
                            className={`w-full py-2 px-3 rounded-lg text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer ${
                              draftConfirmPending
                                ? 'bg-amber-600 hover:bg-amber-700'
                                : 'bg-teal-700 hover:bg-teal-800'
                            }`}
                          >
                            {savingDraftId === item.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Saving...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>
                                  {draftConfirmPending ? 'Save Anyway' : 'Confirm & Save'}
                                </span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {parsing && (
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700 dark:text-teal-400" />
            <span>Reading details, PDF/receipt items, payment method, and tags...</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {pendingAttachment && (
          <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {pendingAttachment.kind === 'image' && pendingAttachment.previewUrl ? (
                <img
                  src={pendingAttachment.previewUrl}
                  alt="Screenshot preview"
                  className="w-11 h-11 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-teal-700 dark:text-teal-300" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {pendingAttachment.fileName}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {pendingAttachment.kind === 'pdf'
                    ? `PDF (${pendingAttachment.fileSizeLabel}) ready to scan`
                    : 'Screenshot ready to scan'}{' '}
                  · optional note below
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              aria-label="Remove attached file"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="p-4 flex items-center gap-2"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              void handleAttachFile(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={parsing}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach screenshot or PDF"
            title="Attach UPI screenshot or PDF bill/statement"
            className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={
              pendingAttachment
                ? 'Optional note (e.g. split equally)...'
                : 'Type expense, attach PDF/screenshot, or paste'
            }
            className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-teal-600"
          />
          <button
            type="submit"
            disabled={parsing || (!input.trim() && !pendingAttachment)}
            aria-label="Send message"
            className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
      </>
      ) : (
      <>
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-teal-50/60 dark:bg-teal-950/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-teal-900 dark:text-teal-200 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
            <span className="truncate">
              Locked to <strong>{projectName}</strong> ({existingExpenses.length} expenses)
            </span>
          </div>
          {qaMessages.length > 0 && (
            <button
              type="button"
              disabled={qaLoading}
              onClick={() => {
                setQaMessages([]);
                setQaError(null);
              }}
              className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear chat</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50 dark:bg-slate-950/60">
          {qaMessages.length === 0 && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Summarize &amp; query {projectName}
                  </p>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Ask anything about expenses, categories, payment methods, member splits, or budgets
                  in <strong className="text-slate-800 dark:text-slate-200">{projectName}</strong>. For
                  security, this assistant never reads data from any other project.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Suggested questions
                </p>
                <div className="space-y-2">
                  {CHAT_STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={qaLoading}
                      onClick={() => void handleSendQa(prompt)}
                      className="w-full text-left p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-teal-600 dark:hover:border-teal-500 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {qaMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-slate-900 dark:bg-teal-700 text-white text-xs sm:text-sm leading-snug">
                  {msg.text}
                </div>
              ) : (
                <div className="max-w-[95%] rounded-xl px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                  <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                    <Bot className="w-3.5 h-3.5" />
                    <span>Gemini Assistant · {projectName}</span>
                  </div>
                  <FormattedChatMessage text={msg.text} />
                </div>
              )}
            </div>
          ))}

          {qaLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700 dark:text-teal-400" />
              <span>Analyzing {projectName} expenses...</span>
            </div>
          )}

          {qaError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {qaError}
            </div>
          )}
          <div ref={qaEndRef} />
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendQa();
            }}
            className="p-4 flex items-center gap-2"
          >
            <input
              type="text"
              value={qaInput}
              onChange={(e) => setQaInput(e.target.value)}
              placeholder={`Ask about ${projectName} expenses...`}
              className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-teal-600"
            />
            <button
              type="submit"
              disabled={qaLoading || !qaInput.trim()}
              aria-label="Send project question"
              className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </>
      )}
    </aside>
  );
}

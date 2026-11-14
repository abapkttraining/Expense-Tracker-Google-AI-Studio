import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import {
  Check,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { formatINR } from '../constants';
import { parseExpenseWithAI, type AiExpenseImagePayload } from '../services/aiService';
import { formatFrequencyLabel } from '../utils/recurringUtils';
import {
  PAYMENT_METHODS,
  RECURRING_FREQUENCIES,
  type ParsedExpenseDraft,
  type PaymentMethod,
  type ProjectMember,
  type RecurringFrequency,
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
  drafts?: DraftItem[];
}

interface PendingImage {
  previewUrl: string;
  fileName: string;
  payload: AiExpenseImagePayload;
}

interface AiExpenseDrawerProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  tags: Tag[];
  members: ProjectMember[];
  onConfirmSave: (draft: ParsedExpenseDraft) => Promise<void>;
  onConfirmSaveBatch?: (drafts: ParsedExpenseDraft[]) => Promise<void>;
}

const SAMPLE_PROMPTS = [
  'Paid 650 on PhonePe for dinner at restaurant with friends',
  '1200 GPay monthly electricity bill and internet',
  '480 Paytm petrol refill for bike',
];

async function prepareImageForUpload(file: File): Promise<PendingImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  // Keep crisp small screenshots as-is if <= 1.2MB
  if (file.size <= 1_200_000 && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp')) {
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return {
      previewUrl: dataUrl,
      fileName: file.name || 'screenshot.png',
      payload: {
        mimeType: file.type,
        data: base64,
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
    previewUrl: compressedUrl,
    fileName: file.name || 'screenshot.jpg',
    payload: {
      mimeType: 'image/jpeg',
      data: base64,
    },
  };
}

export function AiExpenseDrawer({
  open,
  onClose,
  projectName,
  tags,
  members,
  onConfirmSave,
  onConfirmSaveBatch,
}: AiExpenseDrawerProps) {
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [savingBatchMsgId, setSavingBatchMsgId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleAttachFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image screenshot (PNG, JPEG, or WebP).');
      return;
    }
    setError(null);
    try {
      const prepared = await prepareImageForUpload(file);
      setPendingImage(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to attach screenshot.');
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
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
    const imageToSend = textOverride ? null : pendingImage;

    if ((!query && !imageToSend) || parsing) return;

    setError(null);
    if (!textOverride) {
      setInput('');
      setPendingImage(null);
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: query || 'Uploaded UPI screenshot',
      imagePreviewUrl: imageToSend?.previewUrl,
    };
    setMessages((prev) => [...prev, userMsg]);
    setParsing(true);

    try {
      const result = await parseExpenseWithAI(
        {
          message: query,
          image: imageToSend?.payload,
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

  const updateDraftField = <K extends keyof ParsedExpenseDraft>(
    msgId: string,
    draftId: string,
    key: K,
    value: ParsedExpenseDraft[K]
  ) => {
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

  const handleSaveSingleDraft = async (msgId: string, item: DraftItem) => {
    if (item.saved) return;
    if (!(item.draft.amount > 0)) {
      setError('Amount must be greater than ₹0 before saving.');
      return;
    }

    setError(null);
    setSavingDraftId(item.id);
    try {
      await onConfirmSave(item.draft);
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

  const handleSaveAllDrafts = async (msg: ChatMessage) => {
    const unsaved = (msg.drafts ?? []).filter((d) => !d.saved);
    if (unsaved.length === 0) return;

    const invalid = unsaved.find((d) => !(d.draft.amount > 0));
    if (invalid) {
      setError('Every expense must have an amount greater than ₹0 before saving all.');
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
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquareText className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              AI Expense Entry
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
            Text or UPI screenshots for {projectName}
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

      <div className="relative flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50 dark:bg-slate-950/60">
        {isDragging && (
          <div className="absolute inset-3 z-20 rounded-xl border-2 border-dashed border-teal-600 dark:border-teal-400 bg-teal-50/90 dark:bg-teal-950/90 flex flex-col items-center justify-center gap-2 text-center p-6 pointer-events-none">
            <ImagePlus className="w-7 h-7 text-teal-700 dark:text-teal-300" />
            <p className="text-sm font-semibold text-teal-900 dark:text-teal-100">
              Drop UPI transaction or history screenshot
            </p>
            <p className="text-xs text-teal-700 dark:text-teal-300">
              Supports single receipts or multi-row PhonePe / GPay / Paytm history
            </p>
          </div>
        )}

        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Type an expense or upload a UPI screenshot
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Upload or paste a PhonePe, Google Pay, or Paytm receipt—or a full transaction
                history screenshot—to automatically extract one or multiple expenses at once.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-3 rounded-lg border border-dashed border-teal-300 dark:border-teal-700 bg-teal-50/60 dark:bg-teal-950/40 hover:bg-teal-50 dark:hover:bg-teal-950/70 text-teal-800 dark:text-teal-300 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <ImagePlus className="w-4 h-4 shrink-0" />
                <span>Upload UPI Receipt or History Screenshot</span>
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
                  {msg.text && <p className="leading-snug">{msg.text}</p>}
                </div>
              ) : (
                <div className="w-full space-y-2.5">
                  <p className="text-xs text-slate-600 dark:text-slate-400 px-1">{msg.text}</p>

                  {drafts.length > 1 && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {drafts.length} expenses detected
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 mx-1.5">&middot;</span>
                        <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-300">
                          {formatINR(totalDraftAmount)}
                        </span>
                      </div>
                      {unsavedCount > 0 ? (
                        <button
                          type="button"
                          disabled={savingBatchMsgId === msg.id}
                          onClick={() => void handleSaveAllDrafts(msg)}
                          className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {savingBatchMsgId === msg.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Saving All...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Save All ({unsavedCount})</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          <span>All Saved</span>
                        </span>
                      )}
                    </div>
                  )}

                  {drafts.map((item, idx) => (
                    <div
                      key={item.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
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
                          <span className="font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
                            {formatINR(item.draft.amount)}
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
                                {formatINR(item.draft.amount / members.length)}/ea
                              </span>
                            )}
                          </label>
                        )}
                      </div>

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
                            onClick={() => void handleSaveSingleDraft(msg.id, item)}
                            className="w-full py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer"
                          >
                            {savingDraftId === item.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Saving...</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Confirm &amp; Save</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {parsing && (
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700 dark:text-teal-400" />
            <span>Reading details, payment method, and tags...</span>
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
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {pendingImage && (
          <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={pendingImage.previewUrl}
                alt="Screenshot preview"
                className="w-11 h-11 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {pendingImage.fileName}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Ready to scan · optional note below
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              aria-label="Remove attached screenshot"
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
            accept="image/*"
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
            aria-label="Upload UPI screenshot"
            title="Upload UPI receipt or transaction history screenshot"
            className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={
              pendingImage
                ? 'Optional note (e.g. split equally)...'
                : 'Type expense or attach/paste UPI screenshot'
            }
            className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-teal-600"
          />
          <button
            type="submit"
            disabled={parsing || (!input.trim() && !pendingImage)}
            aria-label="Send message"
            className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}

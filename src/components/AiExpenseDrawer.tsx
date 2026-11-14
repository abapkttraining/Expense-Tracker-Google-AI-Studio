import { useState } from 'react';
import { Check, Loader2, MessageSquareText, Send, X } from 'lucide-react';
import { formatINR } from '../constants';
import { parseExpenseWithAI } from '../services/aiService';
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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  draft?: ParsedExpenseDraft;
  saved?: boolean;
}

interface AiExpenseDrawerProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
  tags: Tag[];
  members: ProjectMember[];
  onConfirmSave: (draft: ParsedExpenseDraft) => Promise<void>;
}

const SAMPLE_PROMPTS = [
  'Paid 650 on PhonePe for dinner at restaurant with friends',
  '1200 GPay monthly electricity bill and internet',
  '480 Paytm petrol refill for bike',
];

export function AiExpenseDrawer({
  open,
  onClose,
  projectName,
  tags,
  members,
  onConfirmSave,
}: AiExpenseDrawerProps) {
  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  if (!open) return null;

  const handleSend = async (textOverride?: string) => {
    const query = (textOverride ?? input).trim();
    if (!query || parsing) return;

    setError(null);
    if (!textOverride) setInput('');

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: query,
    };
    setMessages((prev) => [...prev, userMsg]);
    setParsing(true);

    try {
      const draft = await parseExpenseWithAI(query, tags, members);
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: draft.assistantReply,
        draft,
        saved: false,
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
    key: K,
    value: ParsedExpenseDraft[K]
  ) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.draft) return m;
        return { ...m, draft: { ...m.draft, [key]: value } };
      })
    );
  };

  const toggleDraftTag = (msgId: string, tagId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.draft) return m;
        const exists = m.draft.matchedTagIds.includes(tagId);
        const nextTags = exists
          ? m.draft.matchedTagIds.filter((id) => id !== tagId)
          : [...m.draft.matchedTagIds, tagId];
        return {
          ...m,
          draft: { ...m.draft, matchedTagIds: nextTags.length > 0 ? nextTags : [tagId] },
        };
      })
    );
  };

  const handleSaveDraft = async (msg: ChatMessage) => {
    if (!msg.draft || msg.saved) return;
    if (!(msg.draft.amount > 0)) {
      setError('Amount must be greater than ₹0 before saving.');
      return;
    }

    setError(null);
    setSavingId(msg.id);
    try {
      await onConfirmSave(msg.draft);
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, saved: true } : m))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <aside
      aria-label="AI Expense Assistant"
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[440px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col"
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
            Parsing against {projectName} tags &amp; members
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

      <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50 dark:bg-slate-950/60">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Describe an expense in plain language
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Include the amount, Indian payment method (PhonePe, GPay, Paytm, Cash, Card), and
                what it was for. Review the extracted card and click Confirm &amp; Save.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Try an example
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

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 bg-slate-900 dark:bg-teal-700 text-white text-sm">
                {msg.text}
              </div>
            ) : (
              <div className="w-full space-y-2.5">
                <p className="text-xs text-slate-600 dark:text-slate-400 px-1">{msg.text}</p>
                {msg.draft && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {msg.saved ? 'Saved to Ledger' : 'Review Extracted Expense'}
                      </span>
                      <span className="font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
                        {formatINR(msg.draft.amount)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      <label className="space-y-1">
                        <span className="text-slate-500 dark:text-slate-400 block">Amount (₹)</span>
                        <input
                          type="number"
                          min="1"
                          step="any"
                          disabled={msg.saved}
                          value={msg.draft.amount || ''}
                          onChange={(e) =>
                            updateDraftField(msg.id, 'amount', Number(e.target.value) || 0)
                          }
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-slate-500 dark:text-slate-400 block">Date</span>
                        <input
                          type="date"
                          disabled={msg.saved}
                          value={msg.draft.date}
                          onChange={(e) => updateDraftField(msg.id, 'date', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-slate-500 dark:text-slate-400 block">
                          Payment Method
                        </span>
                        <select
                          disabled={msg.saved}
                          value={msg.draft.paymentMethod}
                          onChange={(e) =>
                            updateDraftField(
                              msg.id,
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
                          disabled={msg.saved}
                          value={msg.draft.paidByUid}
                          onChange={(e) => updateDraftField(msg.id, 'paidByUid', e.target.value)}
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
                      <span className="text-slate-500 dark:text-slate-400 block">Description</span>
                      <input
                        type="text"
                        disabled={msg.saved}
                        value={msg.draft.description}
                        onChange={(e) => updateDraftField(msg.id, 'description', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 disabled:bg-slate-50 dark:disabled:bg-slate-800"
                      />
                    </label>

                    <div className="space-y-1.5">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">
                        Matched Tags
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => {
                          const selected = msg.draft?.matchedTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              disabled={msg.saved}
                              onClick={() => toggleDraftTag(msg.id, tag.id)}
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
                            disabled={msg.saved}
                            checked={Boolean(msg.draft.isRecurring)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              updateDraftField(msg.id, 'isRecurring', checked);
                              if (checked && !msg.draft?.frequency) {
                                updateDraftField(msg.id, 'frequency', 'monthly');
                              }
                            }}
                            className="w-3.5 h-3.5 accent-teal-700 rounded"
                          />
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            Recurring bill
                          </span>
                        </label>

                        {msg.draft.isRecurring && (
                          <select
                            disabled={msg.saved}
                            value={msg.draft.frequency ?? 'monthly'}
                            onChange={(e) =>
                              updateDraftField(
                                msg.id,
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
                              disabled={msg.saved}
                              checked={msg.draft.splitMode === 'equal'}
                              onChange={(e) =>
                                updateDraftField(
                                  msg.id,
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
                          {msg.draft.splitMode === 'equal' && msg.draft.amount > 0 && (
                            <span className="font-mono-tabular text-teal-700 dark:text-teal-400 font-semibold">
                              {formatINR(msg.draft.amount / members.length)}/ea
                            </span>
                          )}
                        </label>
                      )}
                    </div>

                    <div className="pt-1">
                      {msg.saved ? (
                        <div className="w-full py-2 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5">
                          <Check className="w-4 h-4" />
                          <span>Saved to {projectName}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={savingId === msg.id}
                          onClick={() => void handleSaveDraft(msg)}
                          className="w-full py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer"
                        >
                          {savingId === msg.id ? (
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
                )}
              </div>
            )}
          </div>
        ))}

        {parsing && (
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700 dark:text-teal-400" />
            <span>Extracting amount, payment method, and tags...</span>
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. 650 PhonePe dinner with friends"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-teal-600"
        />
        <button
          type="submit"
          disabled={parsing || !input.trim()}
          aria-label="Send message"
          className="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </aside>
  );
}

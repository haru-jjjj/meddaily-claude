import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, Language, Source, StudyContent } from '../types';
import {
  streamChatAnswer, chooseMode, makeReviewQuestion, uncitedClaims, REINFORCE_INSTRUCTION,
  ChatMode, ChatModeSetting, ChatStatus
} from '../services/chatService';
import { initialReview } from '../services/review';
import { sourceKindOf, SOURCE_KIND_LABEL, sourceKindClass } from '../services/sourceKind';
import { labelsFor } from './labels';

interface ChatPanelProps {
  card: StudyContent;
  savedChat: ChatMessage[];
  language: Language;
  onPersist: (messages: ChatMessage[]) => Promise<void> | void;
  onClose: () => void;
}

const MODE_KEY = 'medDaily_chatMode';

const hostOf = (uri: string) => { try { return new URL(uri).hostname.replace(/^www\./, ''); } catch { return ''; } };

// [n] → clickable link to the n-th source
const linkCitations = (text: string, sources: Source[]) =>
  text.replace(/\[(\d{1,2})\]/g, (m, n) => {
    const s = sources[Number(n) - 1];
    return s ? `[\\[${n}\\]](${s.uri.replace(/\)/g, '%29').replace(/\s/g, '%20')})` : m;
  });

const mdComponents: any = {
  a: ({ node, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 no-underline hover:underline" />,
  h3: ({ node, ...props }: any) => <h4 className="text-base font-semibold text-slate-800 mt-4 mb-2" {...props} />,
  p: ({ node, ...props }: any) => <p className="mb-3 leading-relaxed" {...props} />,
  ul: ({ node, ...props }: any) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
  ol: ({ node, ...props }: any) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,
  table: ({ node, ...props }: any) => <div className="overflow-x-auto mb-3"><table className="min-w-full border-collapse border border-slate-200 text-xs" {...props} /></div>,
  th: ({ node, ...props }: any) => <th className="border border-slate-200 px-2 py-1 bg-slate-50 text-left" {...props} />,
  td: ({ node, ...props }: any) => <td className="border border-slate-200 px-2 py-1" {...props} />,
  blockquote: ({ node, ...props }: any) => <blockquote className="border-l-4 border-slate-300 pl-3 text-slate-500 my-3" {...props} />,
};

const KindBadge: React.FC<{ s: Source }> = ({ s }) => {
  const k = sourceKindOf(s);
  return <span className={`inline-block align-[1px] mr-1 px-1.5 py-px rounded border text-[10px] font-bold leading-tight whitespace-nowrap ${sourceKindClass(k)}`}>{SOURCE_KIND_LABEL[k]}</span>;
};

export const ChatPanel: React.FC<ChatPanelProps> = ({ card, savedChat, language, onPersist, onClose }) => {
  const L = labelsFor(language);
  const [messages, setMessages] = useState<ChatMessage[]>(savedChat);
  const messagesRef = useRef<ChatMessage[]>(savedChat);
  const setAll = (list: ChatMessage[]) => { messagesRef.current = list; setMessages(list); };

  const [modeSetting, setModeSetting] = useState<ChatModeSetting>(() => {
    try { return (localStorage.getItem(MODE_KEY) as ChatModeSetting) || 'auto'; } catch { return 'auto'; }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyIndex, setBusyIndex] = useState<number | null>(null); // answer being replaced
  const [liveText, setLiveText] = useState('');
  const [liveSources, setLiveSources] = useState<Source[]>([]);
  const [liveMode, setLiveMode] = useState<ChatMode>('fast');
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; abortRef.current?.abort(); };
  }, []);

  const changeMode = (m: ChatModeSetting) => {
    setModeSetting(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  };

  const scrollDown = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);

  const persist = async (list: ChatMessage[]) => {
    try { await onPersist(list); } catch (e) { console.warn('Chat save failed', e); }
  };

  // Adds a review question to the answer stamped `at`, after it is saved
  const attachReview = async (question: string, answer: string, at: number) => {
    const recall = await makeReviewQuestion(question, answer);
    if (!recall) return;
    const list = messagesRef.current.map(m => m.at === at && m.role === 'assistant' ? { ...m, recall, review: initialReview() } : m);
    setAll(list);
    persist(list);
  };

  /**
   * Ask a question. With `replaceIndex`, re-answers the question before that
   * assistant message (used by "근거 중심으로 자세히" and "근거 찾아 보강").
   */
  const ask = async (question: string, opts: { mode?: ChatMode; replaceIndex?: number; instruction?: string } = {}) => {
    const q = question.trim();
    if (!q || busy) return;
    const mode: ChatMode = opts.mode ?? (modeSetting === 'auto' ? chooseMode(q) : modeSetting);
    const base = messagesRef.current;

    let history: ChatMessage[];
    let working: ChatMessage[];
    if (opts.replaceIndex !== undefined) {
      history = base.slice(0, opts.replaceIndex - 1); // before the user question
      working = base;
    } else {
      history = base;
      working = [...base, { role: 'user', at: Date.now(), text: q }];
      setAll(working);
      setInput('');
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setBusyIndex(opts.replaceIndex ?? null);
    setLiveText(''); setLiveSources([]); setLiveMode(mode); setStatus(null); setError('');
    scrollDown();

    try {
      const res = await streamChatAnswer({
        card, history, question: q, mode, instruction: opts.instruction,
        onText: setLiveText, onSources: setLiveSources, onStatus: setStatus, signal: ctrl.signal
      });
      const at = Date.now();
      const answer: ChatMessage = {
        role: 'assistant', at, text: res.text, mode,
        sources: res.sources, seen: res.seen, queries: res.queries, followups: res.followups
      };
      const list = opts.replaceIndex !== undefined
        ? working.map((m, i) => i === opts.replaceIndex ? answer : m)
        : [...working, answer];
      setAll(list);
      await persist(list);
      attachReview(q, res.text, at);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(`${L.chatError} ${e?.message || ''}`);
      if (opts.replaceIndex === undefined) {
        // drop the unanswered question and give the text back
        setAll(base);
        setInput(q);
      }
    } finally {
      setBusy(false);
      setBusyIndex(null);
      setStatus(null);
      abortRef.current = null;
      scrollDown();
    }
  };

  const questionBefore = (i: number) => {
    for (let k = i - 1; k >= 0; k--) if (messages[k].role === 'user') return messages[k].text;
    return '';
  };

  const statusText = status === 'searching' ? L.statusSearching : status === 'recheck' ? L.statusRecheck : L.statusWriting;
  const autoHint = modeSetting === 'auto' && input.trim()
    ? L.modeAutoHint(chooseMode(input) === 'full' ? L.modeFull : L.modeFast) : '';

  return (
    <div className="fixed inset-0 z-[55] bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-slate-400">{L.askTitle}</p>
          <p className="text-sm font-semibold text-slate-800 truncate">{card.title}</p>
        </div>
        <button onClick={onClose} className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-sm">✕</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {messages.length === 0 && !busy && (
          <p className="text-sm text-slate-500 text-center px-6 py-10 leading-relaxed">{L.askEmpty}</p>
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={m.at + '-u'} className="flex justify-end">
                <div className="max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap">{m.text}</div>
              </div>
            );
          }
          if (busyIndex === i) return null; // being re-answered; shown live below
          return (
            <AnswerView
              key={m.at + '-a'}
              m={m}
              L={L}
              disabled={busy}
              onDeeper={() => ask(questionBefore(i), { mode: 'full', replaceIndex: i })}
              onReinforce={() => ask(questionBefore(i), { mode: 'full', replaceIndex: i, instruction: REINFORCE_INSTRUCTION(m.text) })}
              onFollowup={(q) => ask(q)}
            />
          );
        })}

        {busy && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <div className="flex items-center gap-2 text-xs text-blue-600 font-semibold mb-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              {statusText}
              <span className="text-slate-400 font-normal">· {liveMode === 'full' ? L.modeFull : L.modeFast}</span>
            </div>
            {liveText && (
              <div className="text-sm text-slate-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkCitations(liveText, liveSources)}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="bg-white border-t border-slate-200 px-3 pt-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-1 mb-2">
          {(['auto', 'fast', 'full'] as ChatModeSetting[]).map(m => (
            <button
              key={m}
              onClick={() => changeMode(m)}
              className={`px-2.5 py-1 rounded-full text-[11px] border ${modeSetting === m ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}
            >
              {m === 'auto' ? L.modeAuto : m === 'fast' ? L.modeFast : L.modeFull}
            </button>
          ))}
          {autoHint && <span className="ml-1 text-[11px] text-slate-400 truncate">{autoHint}</span>}
        </div>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={L.askPlaceholder}
            rows={1}
            className="flex-1 min-w-0 resize-none max-h-32 px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="px-4 py-2.5 rounded-xl bg-red-100 text-red-600 text-sm font-medium">{L.stop}</button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-40">{L.send}</button>
          )}
        </form>
      </div>
    </div>
  );
};

// One saved answer: text with linked [n], references, searched sources,
// uncited-claim check, depth actions and follow-up questions.
const AnswerView: React.FC<{
  m: ChatMessage; L: ReturnType<typeof labelsFor>; disabled: boolean;
  onDeeper: () => void; onReinforce: () => void; onFollowup: (q: string) => void;
}> = ({ m, L, disabled, onDeeper, onReinforce, onFollowup }) => {
  const sources = m.sources || [];
  const seen = (m.seen || []).filter(s => !sources.some(x => x.uri === s.uri));
  const [showSeen, setShowSeen] = useState(false);
  const uncited = useMemo(() => uncitedClaims(m.text, sources.length), [m.text, sources.length]);
  const html = useMemo(() => linkCitations(m.text, sources), [m.text, sources]);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">{m.mode === 'full' ? L.modeFull : L.modeFast}</span>
        {m.recall && <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-[10px]">{L.reviewMade}</span>}
      </div>

      <div className="text-sm text-slate-800">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{html}</ReactMarkdown>
      </div>

      {sources.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold text-slate-500 mb-1.5">{L.references}</p>
          <ol className="space-y-1.5">
            {sources.map((s, i) => (
              <li key={s.uri} className="text-[12px] leading-snug">
                <span className="text-slate-400 mr-1">[{i + 1}]</span>
                <KindBadge s={s} />
                <a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-slate-700 hover:text-blue-700 hover:underline break-words">{s.title}</a>
                {hostOf(s.uri) && <span className="text-slate-400"> · {hostOf(s.uri)}</span>}
                {s.snippet && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">"{s.snippet}"</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(seen.length > 0 || (m.queries || []).length > 0) && (
        <div className="mt-2">
          <button onClick={() => setShowSeen(!showSeen)} className="text-[11px] text-slate-400 underline">
            {L.searched(seen.length)}
          </button>
          {showSeen && (
            <div className="mt-1.5 space-y-1">
              {(m.queries || []).length > 0 && (
                <p className="text-[11px] text-slate-400">{L.searchQueries}: {(m.queries || []).join(' · ')}</p>
              )}
              <ul className="space-y-1">
                {seen.map(s => (
                  <li key={s.uri} className="text-[12px] leading-snug">
                    <KindBadge s={s} />
                    <a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:underline break-words">{s.title}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(uncited.length > 0 || m.mode !== 'full') && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {uncited.length > 0 && (
            <>
              <span className="text-[11px] text-amber-700">{L.uncited(uncited.length)}</span>
              <button onClick={onReinforce} disabled={disabled} className="px-2.5 py-1 rounded-full border border-amber-300 text-amber-700 text-[11px] disabled:opacity-40">{L.reinforce}</button>
            </>
          )}
          {m.mode !== 'full' && (
            <button onClick={onDeeper} disabled={disabled} className="px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 text-[11px] disabled:opacity-40">{L.deeper}</button>
          )}
        </div>
      )}

      {(m.followups || []).length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {(m.followups || []).map(q => (
            <button key={q} onClick={() => onFollowup(q)} disabled={disabled} className="text-left text-[12px] px-3 py-2 rounded-xl bg-slate-50 text-slate-700 border border-slate-100 disabled:opacity-40">
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

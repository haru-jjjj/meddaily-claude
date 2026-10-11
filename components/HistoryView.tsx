import React, { useMemo, useState } from 'react';
import { Language, StudyContent, SubCategory } from '../types';
import { CATEGORY_MAP } from '../constants';
import { CategoryType } from '../types';
import { countBySpecialty, REVIEW_INTERVALS_DAYS } from '../services/review';
import type { SyncStatus } from '../services/store';
import { labelsFor, formatDate } from './labels';

interface HistoryViewProps {
  cards: StudyContent[];
  language: Language;
  sync: { status: SyncStatus; message?: string };
  onOpen: (card: StudyContent) => void;
  onDelete: (id: string) => void;
}

const PAGE = 30;

// Specialties shown in the coverage section (meta options removed)
const ALL_SPECIALTIES: string[] = [
  ...CATEGORY_MAP[CategoryType.INTERNAL_MEDICINE],
  ...CATEGORY_MAP[CategoryType.OTHER],
  ...CATEGORY_MAP[CategoryType.PHARMACOLOGY],
].filter(c => c !== SubCategory.INTERNAL_MEDICINE_GENERAL && c !== SubCategory.OTHER_GENERAL);

const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export const HistoryView: React.FC<HistoryViewProps> = ({ cards, language, sync, onOpen, onDelete }) => {
  const L = labelsFor(language);
  const [filter, setFilter] = useState<string>('');
  const [shown, setShown] = useState(PAGE);

  const coverage = useMemo(() => countBySpecialty(cards), [cards]);
  const seen = Object.entries(coverage).sort((a, b) => b[1] - a[1]);
  const maxCount = seen.length ? seen[0][1] : 1;
  const notSeen = ALL_SPECIALTIES.filter(s => !coverage[s]);

  const filtered = filter ? cards.filter(c => c.specialty === filter) : cards;
  const visible = filtered.slice(0, shown);

  const todayKey = dayKey(Date.now());
  const yesterdayKey = dayKey(Date.now() - 86400000);
  const dayLabel = (ts: number) => {
    const k = dayKey(ts);
    if (k === todayKey) return L.today;
    if (k === yesterdayKey) return L.yesterday;
    return formatDate(ts, language);
  };

  const syncText = sync.status === 'local' ? L.syncLocal
    : sync.status === 'connecting' ? L.syncConnecting
    : sync.status === 'synced' ? L.syncOk : `${L.syncError}${sync.message ? ` (${sync.message})` : ''}`;
  const syncColor = sync.status === 'synced' ? 'bg-emerald-500' : sync.status === 'error' ? 'bg-red-500' : 'bg-amber-400';

  let lastDay = '';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className={`w-2 h-2 rounded-full ${syncColor}`}></span>
        <span className="break-all">{syncText}</span>
      </div>

      {/* Coverage */}
      <section className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-800">{L.coverageTitle}</h2>
        <p className="text-xs text-slate-400 mt-1 mb-4">{L.coverageHint}</p>
        {seen.length > 0 && (
          <div className="space-y-2">
            {seen.map(([spec, n]) => (
              <button key={spec} onClick={() => { setFilter(spec); setShown(PAGE); }} className="w-full text-left">
                <div className="flex justify-between text-xs text-slate-600 mb-1">
                  <span>{spec}</span><span>{n}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(n / maxCount) * 100}%` }} />
                </div>
              </button>
            ))}
          </div>
        )}
        {notSeen.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-500 mb-2">{L.notSeenYet}</p>
            <div className="flex flex-wrap gap-1.5">
              {notSeen.map(s => (
                <span key={s} className="px-2 py-1 rounded-md bg-slate-100 text-slate-500 text-[11px]">{s}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* List */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-sm font-bold text-slate-800">{L.historyTitle} <span className="text-slate-400 font-normal">{filtered.length}</span></h2>
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setShown(PAGE); }}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white max-w-[55%]"
          >
            <option value="">{L.allSpecialties}</option>
            {ALL_SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {visible.length === 0 && (
          <p className="text-sm text-slate-500 py-8 text-center">{L.emptyHistory}</p>
        )}

        <div className="space-y-2">
          {visible.map(card => {
            const label = card.readAt ? dayLabel(card.readAt) : '';
            const header = label !== lastDay ? label : '';
            lastDay = label;
            const r = card.review;
            const reviewText = !card.recall ? '' : r && r.dueAt === null ? L.reviewDone
              : r ? L.reviewStage(Math.min(r.stage + 1, REVIEW_INTERVALS_DAYS.length)) : '';
            return (
              <React.Fragment key={card.id}>
                {header && <p className="text-xs font-semibold text-slate-400 pt-3 pb-1">{header}</p>}
                <div className="bg-white rounded-xl border border-slate-100 p-4 flex gap-3 items-start">
                  <button onClick={() => onOpen(card)} className="flex-1 min-w-0 text-left">
                    <p className="font-semibold text-slate-800 leading-snug">{card.title}</p>
                    {card.keyPoints && card.keyPoints[0] && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{card.keyPoints[0]}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {card.specialty && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px]">{card.specialty}</span>}
                      {card.seriesTitle && <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px]">{card.seriesTitle} {typeof card.seriesIndex === 'number' ? `#${card.seriesIndex + 1}` : ''}</span>}
                      {reviewText && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">{reviewText}</span>}
                      {card.chat && card.chat.some(m => m.role === 'user') && (
                        <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-[10px]">{L.chatCount(card.chat.filter(m => m.role === 'user').length)}</span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => { if (card.id && window.confirm(L.confirmDelete)) onDelete(card.id); }}
                    className="text-[11px] text-slate-400 hover:text-red-500 px-1 py-1 shrink-0"
                  >
                    {L.delete}
                  </button>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {filtered.length > shown && (
          <button onClick={() => setShown(shown + PAGE)} className="mt-4 w-full py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600">
            {L.showMore}
          </button>
        )}
      </section>
    </div>
  );
};

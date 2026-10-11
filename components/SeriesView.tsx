import React, { useState } from 'react';
import { Language, Series, StudyContent } from '../types';
import { labelsFor } from './labels';

interface SeriesViewProps {
  seriesList: Series[];
  cards: StudyContent[];
  language: Language;
  creating: boolean;
  onCreate: (theme: string, partCount: number) => void;
  onOpenPart: (series: Series, index: number) => void;
  onDelete: (id: string) => void;
}

// A part counts as read when its card still exists in history
export const readPartIndexes = (series: Series, cards: StudyContent[]): Set<number> => {
  const ids = new Set(cards.filter(c => c.seriesId === series.id).map(c => c.id));
  const done = new Set<number>();
  series.parts.forEach((p, i) => { if (p.cardId && ids.has(p.cardId)) done.add(i); });
  // also count cards of this series whose part index is known (e.g. saved before the series doc updated)
  cards.forEach(c => { if (c.seriesId === series.id && typeof c.seriesIndex === 'number') done.add(c.seriesIndex); });
  return done;
};

export const SeriesView: React.FC<SeriesViewProps> = ({ seriesList, cards, language, creating, onCreate, onOpenPart, onDelete }) => {
  const L = labelsFor(language);
  const [theme, setTheme] = useState('');
  const [partCount, setPartCount] = useState(6);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Create */}
      <section className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-3">{L.seriesTitle}</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); if (theme.trim() && !creating) onCreate(theme.trim(), partCount); }}
          className="space-y-3"
        >
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder={L.seriesThemePlaceholder}
            className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <select
              value={partCount}
              onChange={(e) => setPartCount(parseInt(e.target.value, 10))}
              className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white"
            >
              {[4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{L.seriesParts(n)}</option>)}
            </select>
            <button
              type="submit"
              disabled={!theme.trim() || creating}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {creating ? L.seriesCreating : L.seriesCreate}
            </button>
          </div>
        </form>
      </section>

      {seriesList.length === 0 && (
        <p className="text-sm text-slate-500 text-center px-4">{L.seriesEmpty}</p>
      )}

      {/* List */}
      <div className="space-y-3">
        {seriesList.map(s => {
          const done = readPartIndexes(s, cards);
          const nextIndex = s.parts.findIndex((_, i) => !done.has(i));
          const isOpen = expanded === s.id;
          return (
            <section key={s.id} className="bg-white rounded-2xl border border-slate-100 p-5">
              <button onClick={() => setExpanded(isOpen ? null : s.id)} className="w-full text-left">
                <div className="flex justify-between items-start gap-3">
                  <p className="font-semibold text-slate-800 leading-snug">{s.title}</p>
                  <span className="text-xs text-slate-400 shrink-0">{done.size}/{s.parts.length}</span>
                </div>
                {s.specialty && <p className="text-[11px] text-slate-400 mt-0.5">{s.specialty}</p>}
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-3">
                  <div className="h-full bg-violet-500" style={{ width: `${(done.size / s.parts.length) * 100}%` }} />
                </div>
              </button>

              {nextIndex >= 0 ? (
                <button
                  onClick={() => onOpenPart(s, nextIndex)}
                  className="mt-4 w-full py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold text-left px-4 truncate"
                >
                  {L.seriesContinue(`${nextIndex + 1}. ${s.parts[nextIndex].title}`)}
                </button>
              ) : (
                <p className="mt-4 text-sm text-emerald-600 font-medium">{L.seriesFinished}</p>
              )}

              {isOpen && (
                <div className="mt-4 space-y-1">
                  {s.parts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => onOpenPart(s, i)}
                      className="w-full text-left flex gap-3 py-2 px-2 rounded-lg hover:bg-slate-50"
                    >
                      <span className={`w-6 h-6 shrink-0 rounded-full text-xs flex items-center justify-center ${done.has(i) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {done.has(i) ? '✓' : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-800">{p.title}</span>
                        <span className="block text-xs text-slate-400 line-clamp-2">{p.focus}</span>
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => { if (window.confirm(L.confirmSeriesDelete)) onDelete(s.id); }}
                    className="mt-2 text-xs text-slate-400 hover:text-red-500"
                  >
                    {L.seriesDelete}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

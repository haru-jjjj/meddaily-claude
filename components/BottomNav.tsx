import React from 'react';
import { Language } from '../types';
import { labelsFor } from './labels';

export type View = 'study' | 'history' | 'review' | 'series';

interface BottomNavProps {
  view: View;
  onChange: (v: View) => void;
  dueCount: number;
  language: Language;
}

const ICONS: Record<View, string> = {
  study: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  history: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  review: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  series: 'M4 6h16M4 10h16M4 14h10M4 18h7',
};

export const BottomNav: React.FC<BottomNavProps> = ({ view, onChange, dueCount, language }) => {
  const L = labelsFor(language);
  const items: { key: View; label: string }[] = [
    { key: 'study', label: L.navStudy },
    { key: 'history', label: L.navHistory },
    { key: 'review', label: L.navReview },
    { key: 'series', label: L.navSeries },
  ];
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-3xl mx-auto grid grid-cols-4">
        {items.map(({ key, label }) => {
          const active = view === key;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${active ? 'text-blue-600' : 'text-slate-500'}`}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[key]} />
              </svg>
              {label}
              {key === 'review' && dueCount > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[18px] text-center">
                  {dueCount > 99 ? '99+' : dueCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

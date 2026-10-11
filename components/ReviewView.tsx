import React, { useState } from 'react';
import { Language, StudyContent } from '../types';
import { dueItems, upcomingItems, ReviewItem } from '../services/review';
import { labelsFor, formatDate } from './labels';

interface ReviewViewProps {
  cards: StudyContent[];
  language: Language;
  onAnswer: (item: ReviewItem, correct: boolean) => void;
  onOpenCard: (card: StudyContent, openChat?: boolean) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({ cards, language, onAnswer, onOpenCard }) => {
  const L = labelsFor(language);
  // Freeze the queue when the session starts so answered questions don't
  // disappear from under the user while the explanation is shown.
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);

  const due = dueItems(cards);
  const upcoming = upcomingItems(cards);

  const start = () => { setQueue(due); setIndex(0); setPicked(null); setScore(0); };

  if (!queue) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
        <h2 className="text-lg font-bold text-slate-800 mb-2">{L.reviewTitle}</h2>
        {due.length > 0 ? (
          <>
            <p className="text-slate-600 mb-5">{L.reviewBanner(due.length)}</p>
            <button onClick={start} className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold">{L.start}</button>
          </>
        ) : (
          <>
            <p className="text-slate-500">{L.noReview}</p>
            {upcoming[0] && (
              <p className="text-xs text-slate-400 mt-2">{L.nextReview(formatDate(upcoming[0].review.dueAt as number, language))}</p>
            )}
          </>
        )}
      </div>
    );
  }

  if (index >= queue.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
        <h2 className="text-lg font-bold text-slate-800 mb-2">{L.reviewTitle}</h2>
        <p className="text-slate-700">{L.reviewSummary(score, queue.length)}</p>
        {upcoming[0] && (
          <p className="text-xs text-slate-400 mt-2">{L.nextReview(formatDate(upcoming[0].review.dueAt as number, language))}</p>
        )}
        <button onClick={() => setQueue(null)} className="mt-5 w-full py-3 rounded-xl border border-slate-200 text-slate-700">OK</button>
      </div>
    );
  }

  const item = queue[index];
  const q = item.recall;
  const isCorrect = picked !== null && picked === q.isTrue;

  const answer = (choice: boolean) => {
    if (picked !== null) return;
    setPicked(choice);
    const ok = choice === q.isTrue;
    if (ok) setScore(s => s + 1);
    onAnswer(item, ok);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center text-xs text-slate-500">
        <span>{L.reviewTitle}</span>
        <span>{L.reviewProgress(index + 1, queue.length)}</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <div className="flex items-center gap-1.5 mb-1">
          {item.card.specialty && <span className="text-xs text-slate-400">{item.card.specialty}</span>}
          {item.chatAt !== undefined && (
            <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-[10px]">{L.fromChat}</span>
          )}
        </div>
        <p className="text-xs font-semibold text-slate-500 mb-1">{item.card.title}</p>
        {item.question && <p className="text-xs text-slate-400 mb-4 line-clamp-2">Q. {item.question}</p>}
        <p className="text-lg text-slate-900 leading-relaxed mt-3">{q.statement}</p>

        <div className="grid grid-cols-2 gap-3 mt-6">
          {[true, false].map(choice => {
            const chosen = picked === choice;
            const right = picked !== null && choice === q.isTrue;
            return (
              <button
                key={String(choice)}
                onClick={() => answer(choice)}
                disabled={picked !== null}
                className={`py-4 rounded-xl text-2xl font-bold border transition-colors ${
                  right ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                  : chosen ? 'bg-red-50 border-red-300 text-red-600'
                  : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {choice ? 'O' : 'X'}
              </button>
            );
          })}
        </div>

        {picked !== null && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <p className={`font-bold ${isCorrect ? 'text-emerald-600' : 'text-red-600'}`}>
              {isCorrect ? L.correct : L.wrong} · {L.answerIs(q.isTrue)}
            </p>
            {q.explanation && <p className="text-sm text-slate-700 mt-2 leading-relaxed">{q.explanation}</p>}
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button onClick={() => onOpenCard(item.card, item.chatAt !== undefined)} className="py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700">
                {item.chatAt !== undefined ? L.openChat : L.openCard}
              </button>
              <button onClick={() => { setIndex(index + 1); setPicked(null); }} className="py-2.5 rounded-xl bg-slate-800 text-white text-sm">{L.next}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

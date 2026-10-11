import React, { useState } from 'react';
import { Language, StudyContent } from '../types';
import { dueCards } from '../services/review';
import { labelsFor, formatDate } from './labels';

interface ReviewViewProps {
  cards: StudyContent[];
  language: Language;
  onAnswer: (card: StudyContent, correct: boolean) => void;
  onOpenCard: (card: StudyContent) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({ cards, language, onAnswer, onOpenCard }) => {
  const L = labelsFor(language);
  // Freeze the queue when the session starts so answered questions don't
  // disappear from under the user while the explanation is shown.
  const [queue, setQueue] = useState<StudyContent[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);

  const due = dueCards(cards);
  const upcoming = cards
    .filter(c => c.recall && c.review && c.review.dueAt !== null && c.review.dueAt > Date.now())
    .sort((a, b) => (a.review!.dueAt as number) - (b.review!.dueAt as number));

  const start = () => { setQueue(due); setIndex(0); setPicked(null); setScore(0); };

  // Not started (or finished)
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
              <p className="text-xs text-slate-400 mt-2">{L.nextReview(formatDate(upcoming[0].review!.dueAt as number, language))}</p>
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
          <p className="text-xs text-slate-400 mt-2">{L.nextReview(formatDate(upcoming[0].review!.dueAt as number, language))}</p>
        )}
        <button onClick={() => setQueue(null)} className="mt-5 w-full py-3 rounded-xl border border-slate-200 text-slate-700">OK</button>
      </div>
    );
  }

  const card = queue[index];
  const q = card.recall!;
  const isCorrect = picked !== null && picked === q.isTrue;

  const answer = (choice: boolean) => {
    if (picked !== null) return;
    setPicked(choice);
    const ok = choice === q.isTrue;
    if (ok) setScore(s => s + 1);
    onAnswer(card, ok);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center text-xs text-slate-500">
        <span>{L.reviewTitle}</span>
        <span>{L.reviewProgress(index + 1, queue.length)}</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <p className="text-xs text-slate-400 mb-1">{card.specialty}</p>
        <p className="text-xs font-semibold text-slate-500 mb-4">{card.title}</p>
        <p className="text-lg text-slate-900 leading-relaxed">{q.statement}</p>

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
              <button onClick={() => onOpenCard(card)} className="py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700">{L.openCard}</button>
              <button onClick={() => { setIndex(index + 1); setPicked(null); }} className="py-2.5 rounded-xl bg-slate-800 text-white text-sm">{L.next}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

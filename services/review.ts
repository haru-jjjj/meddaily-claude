import { ReviewState, StudyContent, RecallQuestion } from '../types';

const DAY = 24 * 60 * 60 * 1000;

// Days until the next recall question after each correct answer.
// Wrong answers go back to the start (asked again tomorrow).
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60];

export function initialReview(now: number = Date.now()): ReviewState {
  return { stage: 0, dueAt: now + REVIEW_INTERVALS_DAYS[0] * DAY, correct: 0, wrong: 0 };
}

export function answerReview(prev: ReviewState | undefined, correct: boolean, now: number = Date.now()): ReviewState {
  const base = prev || initialReview(now);
  if (!correct) {
    return {
      stage: 0,
      dueAt: now + REVIEW_INTERVALS_DAYS[0] * DAY,
      lastAnsweredAt: now,
      correct: base.correct,
      wrong: base.wrong + 1
    };
  }
  const nextStage = base.stage + 1;
  return {
    stage: nextStage,
    dueAt: nextStage < REVIEW_INTERVALS_DAYS.length ? now + REVIEW_INTERVALS_DAYS[nextStage] * DAY : null,
    lastAnsweredAt: now,
    correct: base.correct + 1,
    wrong: base.wrong
  };
}

// A review question comes either from the card itself or from one answer in
// the card's Q&A conversation (chatAt = that answer's timestamp).
export interface ReviewItem {
  key: string;
  card: StudyContent;
  chatAt?: number;
  question?: string;      // the question that was asked (chat items)
  recall: RecallQuestion;
  review: ReviewState;
}

export function reviewItems(cards: StudyContent[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const card of cards) {
    if (card.recall && card.review) {
      items.push({ key: `${card.id}`, card, recall: card.recall, review: card.review });
    }
    const chat = card.chat || [];
    chat.forEach((m, i) => {
      if (m.role !== 'assistant' || !m.recall || !m.review) return;
      const q = [...chat.slice(0, i)].reverse().find(x => x.role === 'user');
      items.push({ key: `${card.id}:${m.at}`, card, chatAt: m.at, question: q?.text, recall: m.recall, review: m.review });
    });
  }
  return items;
}

const isItemDue = (it: ReviewItem, now: number) => it.review.dueAt !== null && it.review.dueAt <= now;

export function dueItems(cards: StudyContent[], now: number = Date.now()): ReviewItem[] {
  return reviewItems(cards)
    .filter(it => isItemDue(it, now))
    .sort((a, b) => (a.review.dueAt as number) - (b.review.dueAt as number));
}

export function upcomingItems(cards: StudyContent[], now: number = Date.now()): ReviewItem[] {
  return reviewItems(cards)
    .filter(it => it.review.dueAt !== null && it.review.dueAt > now)
    .sort((a, b) => (a.review.dueAt as number) - (b.review.dueAt as number));
}

// How many cards per specialty were read in the last `days` days.
export function countBySpecialty(cards: StudyContent[], days = 14, now: number = Date.now()): Record<string, number> {
  const since = now - days * DAY;
  const counts: Record<string, number> = {};
  for (const c of cards) {
    if (!c.specialty || !c.readAt || c.readAt < since) continue;
    counts[c.specialty] = (counts[c.specialty] || 0) + 1;
  }
  return counts;
}

import { ReviewState, StudyContent } from '../types';

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

export function isDue(card: StudyContent, now: number = Date.now()): boolean {
  return !!card.recall && !!card.review && card.review.dueAt !== null && card.review.dueAt <= now;
}

export function dueCards(cards: StudyContent[], now: number = Date.now()): StudyContent[] {
  return cards
    .filter(c => isDue(c, now))
    .sort((a, b) => (a.review!.dueAt as number) - (b.review!.dueAt as number));
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

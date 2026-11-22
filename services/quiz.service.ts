import { apiClient } from "../libs/api.client";

/**
 * Quizzes on posts (riftn-backend src/quiz). Each reader gets one go; right
 * answers earn the creator's channel points, more with a bigger badge. Points
 * are never money.
 */
export interface QuizQuestion {
  q: string;
  options: string[];
  /** Index of the right option. Absent until the reader has answered. */
  answer?: number;
}

export interface QuizResult {
  answers: number[];
  correct: number;
  total: number;
  points: number;
  multiplier: number;
}

export interface PostQuiz {
  tokenId: number;
  topic: string;
  pointsPerQuestion: number;
  attempts: number;
  isCreator: boolean;
  multiplier: number;
  /** Daily quiz: the reader's live streak with this creator (days in a row). */
  streak?: number;
  bestStreak?: number;
  /** The streak bonus the reader's next play earns, 1 to 1.5. */
  streakBonus?: number;
  questions: QuizQuestion[];
  mine: QuizResult | null;
}

export interface QuizDraft {
  topic: string;
  questions: Required<QuizQuestion>[];
  pointsPerQuestion: number;
}

export async function draftQuiz(topic: string, count = 5): Promise<{ topic: string; questions: Required<QuizQuestion>[] }> {
  return apiClient.post("/quiz/draft", { topic, count }, { isAuthRequired: true, timeoutMs: 60_000 });
}

export async function createQuiz(tokenId: number, draft: QuizDraft): Promise<{ quiz: PostQuiz }> {
  return apiClient.post(
    "/quiz",
    { tokenId, topic: draft.topic, questions: draft.questions, pointsPerQuestion: draft.pointsPerQuestion },
    { isAuthRequired: true },
  );
}

/** Signed in, the answer carries this person's result (and the right answers once they have played). */
export async function getQuiz(tokenId: number, signedIn: boolean): Promise<{ quiz: PostQuiz }> {
  return apiClient.get(`/quiz/${tokenId}`, { isAuthRequired: signedIn, quiet: true });
}

export async function answerQuiz(tokenId: number, answers: number[]): Promise<QuizResult & { streak?: number; bestStreak?: number; questions: Required<QuizQuestion>[] }> {
  return apiClient.post(`/quiz/${tokenId}/answer`, { answers }, { isAuthRequired: true });
}

/** Every question has text, 2+ answers and a right one picked. */
export function isQuizDraftValid(draft: QuizDraft | null | undefined): draft is QuizDraft {
  return !!draft && draft.questions.length > 0 && draft.questions.every(
    (q) => q.q.trim() && q.options.filter((o) => o.trim()).length >= 2 && q.answer >= 0 && q.answer < q.options.length && !!q.options[q.answer]?.trim(),
  );
}

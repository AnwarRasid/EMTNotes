// Starting a quiz, naming what it covers, and reading an open one. The Quiz tab, its setup, the session (Task 17),
// the notes reader (Task 19) and Today (Task 20) start and describe quizzes through these.
import { useMemo } from 'preact/hooks';
import { GROUPS, type Question } from '../data/questions';
import { TOPICS } from '../data/schema';
import { navigate } from '../app/routes';
import { mulberry32, randomSeed } from '../lib/rng';
import { useProgress } from '../progress/hooks';
import { checksum } from '../progress/slots';
import type { ProgressStore } from '../progress/store';
import type { QuizFilter, QuizMode, QuizSession } from '../progress/types';
import { filterQuestions, resumeSession, reviewPool, selectPractice, selectTest, startSession } from './engine';

/** A practice set's size, unless the filter names its ids. */
export const PRACTICE_N = 20;

/** Every question in both banks. */
export const ALL_QUESTIONS: QuizFilter = { group: 'all', topic: 'all' };

/**
 * How long a key that has just taken another key's place ignores presses: Next question after Check, and the result's
 * keys after See results or Finish test. The second tap of a fast double tap lands on the new key; it must not skip
 * what the trainee is about to read. Timed, not by the click's tap count: iOS Safari reports every tap as one click.
 */
export const READ_HOLD_MS = 400;

/** True while now is within READ_HOLD_MS of `since`, a performance.now() time (null: nothing to hold from). */
export function withinHold(since: number | null): boolean {
  return since !== null && performance.now() - since < READ_HOLD_MS;
}

/** A dismissed "Under review" note, saved in `dismissedReview`: the question id and a short hash of its reasons, as
 *  'mt-b-q168#1a2b3c4d'. A reason added since (a re-import changed the question) makes a new key, so the note shows
 *  again. */
export function reviewKey(q: Question): string {
  return `${q.id}#${checksum(q.review.join('\n'))}`;
}

/** Whether the trainee dismissed `q`'s note for the reasons it has now. A plain id, saved before the reasons were
 *  keyed, still counts, as it did when it was saved. */
export function reviewDismissed(dismissed: readonly string[], q: Question): boolean {
  return dismissed.includes(reviewKey(q)) || dismissed.includes(q.id);
}

/** What a session is called in its header. */
export const MODE_TITLES: Record<QuizMode, string> = { practice: 'Practice', test: 'Test', review: 'Review wrong' };

/**
 * Starts a session and opens it. Practice picks 20 (or every id the filter names), test picks `n` (20 unless
 * given), and review takes every question the filter covers that is still in review. The stats come from
 * `store.get()` at the moment of the call, never from a render. Returns false, and starts nothing, when nothing
 * matches: an empty session would open on no question.
 */
export function startQuiz(store: ProgressStore, questions: Question[], mode: QuizMode, filter: QuizFilter, n?: 20 | 50): boolean {
  const stats = store.get().questions;
  const rng = mulberry32(randomSeed());
  const ids = mode === 'review' ? reviewPool(filterQuestions(questions, filter), stats)
    : mode === 'test' ? selectTest(questions, filter, n ?? 20, rng)
    : selectPractice(questions, stats, filter, filter.ids?.length ?? PRACTICE_N, rng);
  if (ids.length === 0) return false;

  const session = startSession(mode, ids, filter, new Map(questions.map((q) => [q.id, q])), rng, new Date());
  store.update((p) => ({ ...p, quizOpen: session }));
  navigate('/quiz/session');
  return true;
}

/** What a session covers, for its sub-line: "Respiratory, both banks", "All topics, HMLS", "From your notes". */
export function filterLabel(f: QuizFilter): string {
  if (f.ids !== undefined) return 'From your notes';
  const bank = f.group === 'all' ? 'both banks' : GROUPS.find((g) => g.id === f.group)?.label ?? 'both banks';
  if (f.topic === 'all') return `All topics, ${bank}`;
  const topic = TOPICS[f.topic];
  return topic === bank ? topic : `${topic}, ${bank}`;   // the HMLS topic in the HMLS bank says it once
}

/**
 * Questions still to come in a review, counting the one showing. Once a wrong answer is checked, check() has
 * already put a copy of it on the end of the queue; that copy isn't counted until Next drops the one showing,
 * so the count doesn't jump up and back down.
 */
export function reviewLeft(s: QuizSession): number {
  const head = s.queue[0];
  const requeued = s.checked !== null && s.queue.length > 1 && s.queue[s.queue.length - 1] === head;
  return s.queue.length - (requeued ? 1 : 0);
}

/** "Quiz in progress: {filterLabel}, question {n} of {total}." In review, "…, {left} left." instead. */
export function resumeLine(s: QuizSession): string {
  const where = s.mode === 'review'
    ? `${reviewLeft(s)} left`
    : `question ${s.done.length + (s.checked ? 0 : 1)} of ${s.total}`;
  return `Quiz in progress: ${filterLabel(s.filter)}, ${where}.`;
}

/** Today's resume row: "Quiz in progress: Practice, {answered} of {total} answered." (a checked answer counts), or
 *  "Quiz in progress: Review wrong, {left} left." */
export function resumeSummary(s: QuizSession): string {
  const where = s.mode === 'review' ? `${reviewLeft(s)} left` : `${s.done.length} of ${s.total} answered`;
  return `Quiz in progress: ${MODE_TITLES[s.mode]}, ${where}.`;
}

/**
 * The open quiz as it would resume against `questions` (ids gone from the bank dropped), or null when there is
 * none or nothing of it is left to ask. For display only: the session screen runs its own resume and saves it.
 */
export function useOpenQuiz(questions: Question[]): QuizSession | null {
  const open = useProgress((p) => p.quizOpen);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  // The rng only reorders options, which nothing here shows, so a fixed seed keeps renders stable.
  return useMemo(() => (open ? resumeSession(open, byId, mulberry32(1)) : null), [open, byId]);
}

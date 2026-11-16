// The quiz engine: pure functions over questions, per-question stats and the saved QuizSession (spec §6.4).
// No DOM, no storage and no Math.random: every random choice draws from the Rng passed in.
//
// A session is saved as-is (quizOpen / quizLast), so every value it holds is plain JSON: strings, numbers, arrays,
// objects and null, never undefined. Options are shuffled each time a question shows in a session (`orders`): the
// first time, and again when review brings it back. Answers are graded by option id, never by position.
import { GROUPS, type Question } from '../data/questions';
import type { AnswerRecord, QStat, QuizFilter, QuizMode, QuizSession } from '../progress/types';
import type { Rng } from '../lib/rng';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

// ---- Randomness --------------------------------------------------------------------------------------------

/** An index in [0, n). Clamped, so an Rng that returns 1, a negative or NaN can't index past the array. */
function randIndex(rng: Rng, n: number): number {
  const r = rng();
  if (!(r >= 0)) return 0;
  return Math.min(n - 1, Math.floor(r * n));
}

/** A shuffled copy (Fisher–Yates). */
function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randIndex(rng, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The question's option ids in a fresh random order. */
export function shuffleOptions(q: Question, rng: Rng): string[] {
  return shuffled(q.options.map(o => o.id), rng);
}

// ---- Stats lookups -----------------------------------------------------------------------------------------

/** The question's own stat, or undefined: never one inherited from Object.prototype ('constructor', say). */
export function statOf(stats: Record<string, QStat>, id: string): QStat | undefined {
  return Object.hasOwn(stats, id) ? stats[id] : undefined;
}

const isSeen = (st: QStat | undefined): st is QStat => st !== undefined && st.seen >= 1;
const inReview = (st: QStat | undefined) => st !== undefined && st.rightSinceWrong !== null && st.rightSinceWrong < 2;
const isCleared = (st: QStat | undefined) => st !== undefined && st.rightSinceWrong !== null && st.rightSinceWrong >= 2;

/** The stat after one more answer: a wrong answer resets the right-twice counter to 0; a right one adds 1 to it
 *  when it is counting and leaves it null (never wrong) otherwise. */
function nextStat(prev: QStat | undefined, right: boolean, at: string): QStat {
  const rsw = prev?.rightSinceWrong ?? null;
  return {
    seen: (prev?.seen ?? 0) + 1,
    right: (prev?.right ?? 0) + (right ? 1 : 0),
    lastAt: at,
    lastRight: right,
    rightSinceWrong: !right ? 0 : rsw === null ? null : rsw + 1,
  };
}

// ---- Choosing questions ------------------------------------------------------------------------------------

/** The questions a filter covers, in bank order. `ids`, when given (even empty), wins over group and topic. */
export function filterQuestions(qs: Question[], f: QuizFilter): Question[] {
  if (f.ids !== undefined) {
    const want = new Set(f.ids);
    return qs.filter(q => want.has(q.id));
  }
  const banks = f.group === 'all' ? null : GROUPS.find(g => g.id === f.group)?.banks ?? [];
  return qs.filter(q => (banks === null || banks.includes(q.bank)) && (f.topic === 'all' || q.topic === f.topic));
}

const count = (n: number) => Math.max(0, Math.floor(n)) || 0;

/** Up to n practice ids: unseen questions first, then the seen ones with the oldest `lastAt`. Each tier is
 *  shuffled, so a session never runs in bank order, and ties in age fall randomly. */
export function selectPractice(qs: Question[], stats: Record<string, QStat>, f: QuizFilter, n: number, rng: Rng): string[] {
  const want = count(n);
  const pool = filterQuestions(qs, f);
  const unseen = shuffled(pool.filter(q => !isSeen(statOf(stats, q.id))).map(q => q.id), rng);
  const seen = pool.filter(q => isSeen(statOf(stats, q.id)))
    .map(q => ({ id: q.id, at: statOf(stats, q.id)!.lastAt }));
  // Shuffle before the stable sort, so questions of the same age come out in random order.
  const oldest = shuffled(seen, rng).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(s => s.id);
  const first = unseen.slice(0, want);
  return [...first, ...shuffled(oldest.slice(0, want - first.length), rng)];
}

/** A random test set of up to n ids; a smaller pool gives all of it. */
export function selectTest(qs: Question[], f: QuizFilter, n: 20 | 50, rng: Rng): string[] {
  return shuffled(filterQuestions(qs, f).map(q => q.id), rng).slice(0, count(n));
}

/** Questions that exist and were answered wrong, not yet right twice since: `rightSinceWrong` 0 or 1. */
export function reviewPool(qs: Question[], stats: Record<string, QStat>): string[] {
  return qs.filter(q => inReview(statOf(stats, q.id))).map(q => q.id);
}

/** Questions that exist and were cleared from review: right twice since the last wrong answer. */
export function clearedCount(qs: Question[], stats: Record<string, QStat>): number {
  return qs.filter(q => isCleared(statOf(stats, q.id))).length;
}

// ---- The session -------------------------------------------------------------------------------------------

/** A JSON-safe copy of a filter: `ids` is present only when the filter has it. */
function copyFilter(f: QuizFilter): QuizFilter {
  return f.ids !== undefined ? { group: f.group, topic: f.topic, ids: [...f.ids] } : { group: f.group, topic: f.topic };
}

/** `orders` with the head's order filled in if it has none yet, or rebuilt anyway when `reshuffle` is set. */
function withHeadOrder(orders: Record<string, string[]>, queue: string[], byId: Map<string, Question>, rng: Rng, reshuffle = false) {
  const h = queue[0];
  if (h === undefined || (!reshuffle && Object.hasOwn(orders, h))) return orders;
  const q = byId.get(h);
  return q ? { ...orders, [h]: shuffleOptions(q, rng) } : orders;
}

/**
 * A new session over `ids`, in the order given. Ids that aren't questions and repeats are left out. `total` is the
 * set size: in practice and test that's the set, and in review it's the starting pool. Only the first question is
 * shuffled now; `next` shuffles each one as it comes up.
 */
export function startSession(mode: QuizMode, ids: string[], f: QuizFilter, byId: Map<string, Question>, rng: Rng, now: Date): QuizSession {
  const queue = [...new Set(ids)].filter(id => byId.has(id));
  const id = `${now.getTime().toString(36)}-${Math.floor(rng() * 4294967296).toString(36)}`;
  return {
    id, mode, filter: copyFilter(f), startedAt: now.toISOString(), total: queue.length,
    queue, orders: withHeadOrder({}, queue, byId, rng), picked: null, checked: null, done: [],
  };
}

/** The id of the question showing now, or null once the session is finished. */
export function current(s: QuizSession): string | null {
  return s.queue[0] ?? null;
}

/** Picks an option of the current question. Ignored once it is checked, when the session is finished, or for an id
 *  the question's order doesn't have. */
export function pick(s: QuizSession, optionId: string): QuizSession {
  const h = current(s);
  if (s.checked !== null || h === null) return s;
  const order = Object.hasOwn(s.orders, h) ? s.orders[h] : undefined;
  if (order && !order.includes(optionId)) return s;
  return s.picked === optionId ? s : { ...s, picked: optionId };
}

const norm = (t: string) => t.trim().toLowerCase();

/** Right when the pick is the answer, or reads the same as the answer: mt-b-q169 prints its key twice, as b and c. */
function isRight(q: Question, picked: string): boolean {
  if (picked === q.answer) return true;
  const p = q.options.find(o => o.id === picked);
  const a = q.options.find(o => o.id === q.answer);
  return p !== undefined && a !== undefined && norm(p.text) === norm(a.text);
}

/** The option ids `check` grades right, in option order: the answer, and any option that reads the same. */
export function rightOptions(q: Question): string[] {
  return q.options.filter((o) => isRight(q, o.id)).map((o) => o.id);
}

/**
 * Grades the pick for `q`, the current question. `stat` is its stat from before this answer. Returns the same
 * session and `record: null` when it is already checked, nothing is picked, or `q` isn't the current question.
 * Otherwise the record goes onto `done` straight away and becomes `checked`; the caller then applies it to the
 * stats with `applyAnswer`. In review, the question goes back on the end of the queue unless this answer clears
 * it (right twice since the last wrong one).
 */
export function check(s: QuizSession, q: Question, stat: QStat | undefined, now: Date): { session: QuizSession; record: AnswerRecord | null } {
  if (s.checked !== null || s.picked === null || current(s) !== q.id) return { session: s, record: null };
  const right = isRight(q, s.picked);
  const at = now.toISOString();
  const record: AnswerRecord = { qid: q.id, picked: s.picked, right, at };
  const requeue = s.mode === 'review' && inReview(nextStat(stat, right, at));
  return {
    session: { ...s, checked: record, done: [...s.done, record], queue: requeue ? [...s.queue, q.id] : s.queue },
    record,
  };
}

/**
 * Moves on: drops the current question, clears the pick and shuffles the new current question if it is showing for
 * the first time. In review, a re-queued question showing again gets a fresh order too, so its second right answer
 * can't come from remembering the letter. (Orders are only made for a question as it comes up, so in review an
 * existing order means it has shown before; practice and test never show a question twice.) Ignored until the
 * current question is checked, so a double tap can't skip one.
 */
export function next(s: QuizSession, byId: Map<string, Question>, rng: Rng): QuizSession {
  if (s.checked === null) return s;
  const queue = s.queue.slice(1);
  return { ...s, queue, picked: null, checked: null, orders: withHeadOrder(s.orders, queue, byId, rng, s.mode === 'review') };
}

/** Finished once the queue is empty. */
export function isFinished(s: QuizSession): boolean {
  return s.queue.length === 0;
}

/** The stats with one answer applied. A right answer in any mode counts toward clearing review. */
export function applyAnswer(stats: Record<string, QStat>, r: AnswerRecord): Record<string, QStat> {
  return { ...stats, [r.qid]: nextStat(statOf(stats, r.qid), r.right, r.at) };
}

/** True when `order` holds exactly the question's option ids, once each. */
function orderFits(order: string[], q: Question): boolean {
  const ids = new Set(q.options.map(o => o.id));
  return order.length === ids.size && new Set(order).size === order.length && order.every(id => ids.has(id));
}

/**
 * A saved session checked against the current question bank, or null if nothing is left to ask. Queue and done
 * ids that no longer exist are dropped, with their orders, and `total` shrinks by the questions dropped. A question
 * whose option ids changed gets a new order. If the current question went away, its pick goes with it; a checked
 * current question stays checked, so its answer can't be counted twice.
 */
export function resumeSession(s: QuizSession, byId: Map<string, Question>, rng: Rng): QuizSession | null {
  const queue = s.queue.filter(id => byId.has(id));
  if (queue.length === 0) return null;
  const done = s.done.filter(r => byId.has(r.qid));
  const gone = new Set([...s.queue, ...s.done.map(r => r.qid)].filter(id => !byId.has(id)));

  let orders: Record<string, string[]> = {};
  for (const [id, order] of Object.entries(s.orders)) {
    const q = byId.get(id);
    if (q) orders[id] = orderFits(order, q) ? order : shuffleOptions(q, rng);
  }
  orders = withHeadOrder(orders, queue, byId, rng);

  // The pick and check belong to the head. They survive only if the head is still the same question, and an
  // unchecked pick only if it is still one of that question's options.
  const sameHead = queue[0] === s.queue[0];
  const checked = sameHead ? s.checked : null;
  const pickFits = s.picked !== null && (checked !== null || (orders[queue[0]!]?.includes(s.picked) ?? false));
  const picked = sameHead && pickFits ? s.picked : null;

  return { ...s, total: Math.max(0, s.total - gone.size), queue, done, orders, picked, checked };
}

/** Right answers and answers given so far, against the set size. In review a question can be answered more than once. */
export function score(s: QuizSession): { right: number; answered: number; total: number } {
  return { right: s.done.filter(r => r.right).length, answered: s.done.length, total: s.total };
}

/** Per group, how many of its questions have been answered at least once. Stats for ids not in `qs` don't count. */
export function bankProgress(qs: Question[], stats: Record<string, QStat>): { group: 'mt' | 'hmls'; label: string; answered: number; total: number }[] {
  return GROUPS.map(g => {
    const mine = qs.filter(q => g.banks.includes(q.bank));
    return { group: g.id, label: g.label, answered: mine.filter(q => isSeen(statOf(stats, q.id))).length, total: mine.length };
  });
}

/** The letter shown for the option at `index` in session order. */
export function displayLetter(index: number): 'A' | 'B' | 'C' | 'D' {
  const l = LETTERS[index];
  if (l === undefined) throw new RangeError(`No display letter for option index ${index}`);
  return l;
}

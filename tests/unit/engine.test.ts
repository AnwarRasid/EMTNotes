// Task 14: the pure quiz engine. Selection, shuffle-by-id grading, review-until-twice, resume and scoring.
import { describe, it, expect, vi } from 'vitest';
import { mulberry32, randomSeed } from '../../src/lib/rng';
import {
  applyAnswer, bankProgress, check, clearedCount, current, displayLetter, filterQuestions, isFinished, next, pick,
  resumeSession, reviewPool, rightOptions, score, selectPractice, selectTest, shuffleOptions, startSession, statOf,
} from '../../src/quiz/engine';
import type { Question } from '../../src/data/questions';
import type { BankId, Topic } from '../../src/data/schema';
import { normalizeProgress, type QStat, type QuizFilter, type QuizSession } from '../../src/progress/types';

const NOW = new Date('2026-11-09T08:00:00.000Z');
const ALL: QuizFilter = { group: 'all', topic: 'all' };
const MT_TOPICS: Topic[] = ['cardiac', 'respiratory', 'trauma', 'shock', 'airway'];

function makeQ(id: string, bank: BankId, number: number, topic: Topic, options = ['a', 'b', 'c', 'd']): Question {
  return {
    id, bank, number, passage: null,
    stem: `Stem of ${id}`,
    options: options.map(o => ({ id: o, text: `Option ${o} of ${id}` })),
    answer: 'b', image: null, topic,
    explanation: null, notesRef: null, generated: true, slides: [], review: [],
  };
}

/** 30 questions: mt-a-q001…q025 over five topics (5 cardiac), then hmls-q001…q005. Four options a–d, answer b. */
function fixture(): Question[] {
  const qs: Question[] = [];
  for (let i = 1; i <= 25; i++) qs.push(makeQ(`mt-a-q${String(i).padStart(3, '0')}`, 'mt-a', i, MT_TOPICS[(i - 1) % 5]!));
  for (let i = 1; i <= 5; i++) qs.push(makeQ(`hmls-q${String(i).padStart(3, '0')}`, 'hmls', i, 'hmls'));
  return qs;
}

const mapOf = (qs: Question[]) => new Map(qs.map(q => [q.id, q]));

function stat(over: Partial<QStat> = {}): QStat {
  return { seen: 1, right: 0, lastAt: '2026-11-01T00:00:00.000Z', lastRight: false, rightSinceWrong: 0, ...over };
}

/** The question at the head of the queue (fails the test if there is none). */
function head(s: QuizSession, byId: Map<string, Question>): Question {
  const id = current(s);
  expect(id).not.toBeNull();
  const q = byId.get(id!);
  expect(q).toBeDefined();
  return q!;
}

describe('statOf', () => {
  it("reads a question's own stat, never one inherited from Object.prototype", () => {
    const stat: QStat = { seen: 1, right: 1, lastAt: '2026-11-10T09:00:00.000Z', lastRight: true, rightSinceWrong: null };
    expect(statOf({ q1: stat }, 'q1')).toBe(stat);
    expect(statOf({}, 'q1')).toBeUndefined();
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(statOf({}, id), id).toBeUndefined();
  });
});

describe('rng', () => {
  it('mulberry32 is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(1), b = mulberry32(1);
    const xs = Array.from({ length: 200 }, () => a());
    expect(Array.from({ length: 200 }, () => b())).toEqual(xs);
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(190);
  });

  it('randomSeed returns an unsigned 32-bit integer', () => {
    const s = randomSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

describe('shuffleOptions', () => {
  it('returns a permutation of the option ids', () => {
    const rng = mulberry32(1);
    for (const q of fixture()) expect([...shuffleOptions(q, rng)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives different orders under two seeds for some question', () => {
    const qs = fixture();
    const r1 = mulberry32(1), r2 = mulberry32(2);
    const differs = qs.some(q => shuffleOptions(q, r1).join() !== shuffleOptions(q, r2).join());
    expect(differs).toBe(true);
  });

  it('grades the id b as right whatever position it shows in', () => {
    const qs = fixture();
    const byId = mapOf(qs);
    const positions = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      let s = startSession('practice', ['mt-a-q001'], ALL, byId, mulberry32(seed), NOW);
      positions.add(s.orders['mt-a-q001']!.indexOf('b'));
      s = pick(s, 'b');
      const { record } = check(s, head(s, byId), undefined, NOW);
      expect(record?.right).toBe(true);
    }
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe('check: duplicate option text', () => {
  // mt-b-q169 prints its key twice: b and c both read "Spinal immobilization & fracture management", answer b.
  function dupQ(): Question {
    const q = makeQ('mt-b-q169', 'mt-b', 169, 'trauma');
    q.options = [
      { id: 'a', text: 'Spinal immobilization & IV dextrose 10%' },
      { id: 'b', text: 'Spinal immobilization & fracture management' },
      { id: 'c', text: '  spinal IMMOBILIZATION & fracture management ' },
      { id: 'd', text: 'Spinal immobilization & high flow oxygen' },
    ];
    return q;
  }

  it.each([['b', true], ['c', true], ['a', false], ['d', false]] as const)('picking %s grades right = %s', (id, right) => {
    const q = dupQ();
    const byId = mapOf([q]);
    const s = pick(startSession('practice', [q.id], ALL, byId, mulberry32(1), NOW), id);
    const out = check(s, q, undefined, NOW);
    expect(out.record).toEqual({ qid: q.id, picked: id, right, at: NOW.toISOString() });
    expect(out.session.done).toEqual([out.record]);
    expect(applyAnswer({}, out.record!)[q.id]?.right).toBe(right ? 1 : 0);
  });

  it('rightOptions names every option check grades right: the answer and its twin, in option order', () => {
    expect(rightOptions(dupQ())).toEqual(['b', 'c']);
    expect(rightOptions(makeQ('mt-a-q001', 'mt-a', 1, 'cardiac'))).toEqual(['b']);
  });
});

describe('selection', () => {
  it('selectPractice takes unseen questions first: 25 unseen, 5 seen, n=20 gives 20 unseen', () => {
    const qs = fixture();
    const stats: Record<string, QStat> = {};
    for (const q of qs.slice(0, 5)) stats[q.id] = stat();
    const ids = selectPractice(qs, stats, ALL, 20, mulberry32(1));
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids.every(id => !(id in stats))).toBe(true);
  });

  it('selectPractice fills from the oldest seen once the unseen run out, unseen tier first', () => {
    const qs = fixture();
    const stats: Record<string, QStat> = {};
    qs.slice(0, 5).forEach((q, i) => { stats[q.id] = stat({ lastAt: `2026-11-0${i + 1}T00:00:00.000Z` }); });
    const ids = selectPractice(qs, stats, ALL, 28, mulberry32(1));
    expect(ids).toHaveLength(28);
    expect(ids.slice(0, 25).every(id => !(id in stats))).toBe(true);
    expect([...ids.slice(25)].sort()).toEqual(['mt-a-q001', 'mt-a-q002', 'mt-a-q003']);
  });

  it('with every question seen, selectPractice returns the 20 with the oldest lastAt', () => {
    const qs = fixture();
    const stats: Record<string, QStat> = {};
    // Spread the ages over a fixed permutation (7 is coprime to 30) so the oldest are not the first 20 in bank order.
    qs.forEach((q, i) => { stats[q.id] = stat({ lastAt: new Date(Date.UTC(2026, 9, 1) + ((i * 7) % 30) * 3_600_000).toISOString() }); });
    const oldest = [...qs].sort((a, b) => (stats[a.id]!.lastAt < stats[b.id]!.lastAt ? -1 : 1)).slice(0, 20).map(q => q.id);
    const ids = selectPractice(qs, stats, ALL, 20, mulberry32(1));
    expect([...ids].sort()).toEqual([...oldest].sort());
  });

  it('{group: hmls} returns only hmls', () => {
    const qs = fixture();
    expect(filterQuestions(qs, { group: 'hmls', topic: 'all' }).map(q => q.id)).toEqual(
      ['hmls-q001', 'hmls-q002', 'hmls-q003', 'hmls-q004', 'hmls-q005']);
    const ids = selectPractice(qs, {}, { group: 'hmls', topic: 'all' }, 20, mulberry32(1));
    expect(ids).toHaveLength(5);
    expect(ids.every(id => id.startsWith('hmls-'))).toBe(true);
    expect(filterQuestions(qs, { group: 'mt', topic: 'all' })).toHaveLength(25);
  });

  it('{topic: cardiac} returns only cardiac', () => {
    const qs = fixture();
    const got = filterQuestions(qs, { group: 'all', topic: 'cardiac' });
    expect(got).toHaveLength(5);
    expect(got.every(q => q.topic === 'cardiac')).toBe(true);
    const ids = selectTest(qs, { group: 'all', topic: 'cardiac' }, 20, mulberry32(1));
    expect(ids).toHaveLength(5);
    expect(ids.every(id => qs.find(q => q.id === id)?.topic === 'cardiac')).toBe(true);
  });

  it('ids win over group and topic', () => {
    const qs = fixture();
    const f: QuizFilter = { group: 'hmls', topic: 'cardiac', ids: ['mt-a-q002', 'mt-a-q003', 'not-a-question'] };
    expect(filterQuestions(qs, f).map(q => q.id)).toEqual(['mt-a-q002', 'mt-a-q003']);
    expect(filterQuestions(qs, { ...f, ids: [] })).toEqual([]);
  });

  it('selectTest(…, 50) on a 30-question pool returns 30 distinct ids', () => {
    const qs = fixture();
    const ids = selectTest(qs, ALL, 50, mulberry32(1));
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
    const twenty = selectTest(qs, ALL, 20, mulberry32(1));
    expect(new Set(twenty).size).toBe(20);
  });

  it('selectPractice breaks ties in lastAt randomly: different seeds pick different tied questions', () => {
    const qs = fixture();
    const stats: Record<string, QStat> = {};
    // 10 old questions are always taken; the other 20 share one lastAt, and 5 of them fill the set of 15.
    qs.forEach((q, i) => { stats[q.id] = stat({ lastAt: i < 10 ? '2026-10-01T00:00:00.000Z' : '2026-11-01T00:00:00.000Z' }); });
    const old = qs.slice(0, 10).map(q => q.id);
    const tiedPicks = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const ids = selectPractice(qs, stats, ALL, 15, mulberry32(seed));
      expect(ids).toHaveLength(15);
      expect(old.every(id => ids.includes(id))).toBe(true);
      tiedPicks.add(ids.filter(id => !old.includes(id)).sort().join());
    }
    expect(tiedPicks.size).toBeGreaterThan(1);
  });

  it('is deterministic for a seed', () => {
    const qs = fixture();
    expect(selectTest(qs, ALL, 20, mulberry32(5))).toEqual(selectTest(qs, ALL, 20, mulberry32(5)));
    expect(selectPractice(qs, {}, ALL, 20, mulberry32(5))).toEqual(selectPractice(qs, {}, ALL, 20, mulberry32(5)));
  });
});

describe('startSession', () => {
  it('queues the ids, shuffles only the head, and sizes total to the set', () => {
    const qs = fixture();
    const ids = ['mt-a-q004', 'hmls-q002', 'mt-a-q010'];
    const s = startSession('test', ids, ALL, mapOf(qs), mulberry32(1), NOW);
    expect(s.id).toMatch(/\S/);
    expect(s.mode).toBe('test');
    expect(s.filter).toEqual(ALL);
    expect(s.startedAt).toBe(NOW.toISOString());
    expect(s.total).toBe(3);
    expect(s.queue).toEqual(ids);
    expect(Object.keys(s.orders)).toEqual(['mt-a-q004']);
    expect(s.picked).toBeNull();
    expect(s.checked).toBeNull();
    expect(s.done).toEqual([]);
  });

  it('leaves out ids that are not questions, and repeats', () => {
    const s = startSession('practice', ['gone', 'mt-a-q001', 'mt-a-q001', 'mt-a-q002'], ALL, mapOf(fixture()), mulberry32(1), NOW);
    expect(s.queue).toEqual(['mt-a-q001', 'mt-a-q002']);
    expect(s.total).toBe(2);
  });
});

describe('Review Focus 1: one answer per showing', () => {
  it('a second check returns record null and done stays at 1', () => {
    const byId = mapOf(fixture());
    let s = startSession('practice', ['mt-a-q001', 'mt-a-q002'], ALL, byId, mulberry32(1), NOW);
    s = pick(s, 'a');
    const q = head(s, byId);
    const first = check(s, q, undefined, NOW);
    expect(first.record).toEqual({ qid: 'mt-a-q001', picked: 'a', right: false, at: NOW.toISOString() });
    expect(first.session.checked).toEqual(first.record);
    const second = check(first.session, q, undefined, NOW);
    expect(second.record).toBeNull();
    expect(second.session).toBe(first.session);
    expect(second.session.done).toHaveLength(1);
  });

  it('pick after check is ignored', () => {
    const byId = mapOf(fixture());
    let s = pick(startSession('practice', ['mt-a-q001'], ALL, byId, mulberry32(1), NOW), 'a');
    s = check(s, head(s, byId), undefined, NOW).session;
    expect(pick(s, 'b')).toBe(s);
    expect(s.picked).toBe('a');
  });

  it('check with nothing picked records nothing', () => {
    const byId = mapOf(fixture());
    const s = startSession('practice', ['mt-a-q001'], ALL, byId, mulberry32(1), NOW);
    const out = check(s, head(s, byId), undefined, NOW);
    expect(out.record).toBeNull();
    expect(out.session).toBe(s);
  });

  it('check for a question that is not the current one records nothing', () => {
    const byId = mapOf(fixture());
    const s = pick(startSession('practice', ['mt-a-q001', 'mt-a-q002'], ALL, byId, mulberry32(1), NOW), 'b');
    const out = check(s, byId.get('mt-a-q002')!, undefined, NOW);
    expect(out.record).toBeNull();
    expect(out.session).toBe(s);
  });

  it('pick ignores an id the question does not have', () => {
    const byId = mapOf(fixture());
    const s = startSession('practice', ['mt-a-q001'], ALL, byId, mulberry32(1), NOW);
    expect(pick(s, 'z')).toBe(s);
    expect(pick(s, 'c').picked).toBe('c');
  });
});

describe('next and finishing', () => {
  it('drops the head, clears the pick and shuffles the new head', () => {
    const byId = mapOf(fixture());
    let s = pick(startSession('practice', ['mt-a-q001', 'mt-a-q002'], ALL, byId, mulberry32(1), NOW), 'b');
    s = check(s, head(s, byId), undefined, NOW).session;
    s = next(s, byId, mulberry32(2));
    expect(s.queue).toEqual(['mt-a-q002']);
    expect(s.picked).toBeNull();
    expect(s.checked).toBeNull();
    expect([...s.orders['mt-a-q002']!].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(s.orders['mt-a-q001']).toBeDefined();
    expect(isFinished(s)).toBe(false);
    s = pick(s, 'c');
    s = check(s, head(s, byId), undefined, NOW).session;
    s = next(s, byId, mulberry32(3));
    expect(isFinished(s)).toBe(true);
    expect(current(s)).toBeNull();
    expect(s.done).toHaveLength(2);
  });

  it('is ignored until the head is checked, so a double tap cannot skip a question', () => {
    const byId = mapOf(fixture());
    const s = startSession('test', ['mt-a-q001', 'mt-a-q002'], ALL, byId, mulberry32(1), NOW);
    expect(next(s, byId, mulberry32(1))).toBe(s);
    expect(next(pick(s, 'b'), byId, mulberry32(1)).queue).toEqual(['mt-a-q001', 'mt-a-q002']);
  });
});

describe('applyAnswer', () => {
  const at = (h: number) => `2026-11-09T0${h}:00:00.000Z`;

  it('counts seen and right, and tracks rights since the last wrong', () => {
    let stats: Record<string, QStat> = {};
    stats = applyAnswer(stats, { qid: 'q1', picked: 'a', right: false, at: at(1) });
    expect(stats.q1).toEqual({ seen: 1, right: 0, lastAt: at(1), lastRight: false, rightSinceWrong: 0 });
    stats = applyAnswer(stats, { qid: 'q1', picked: 'b', right: true, at: at(2) });
    expect(stats.q1).toEqual({ seen: 2, right: 1, lastAt: at(2), lastRight: true, rightSinceWrong: 1 });
    stats = applyAnswer(stats, { qid: 'q1', picked: 'b', right: true, at: at(3) });
    expect(stats.q1).toEqual({ seen: 3, right: 2, lastAt: at(3), lastRight: true, rightSinceWrong: 2 });
    stats = applyAnswer(stats, { qid: 'q1', picked: 'c', right: false, at: at(4) });
    expect(stats.q1?.rightSinceWrong).toBe(0);
  });

  it('keeps null on a never-wrong question', () => {
    let stats = applyAnswer({}, { qid: 'q2', picked: 'b', right: true, at: at(1) });
    expect(stats.q2).toEqual({ seen: 1, right: 1, lastAt: at(1), lastRight: true, rightSinceWrong: null });
    stats = applyAnswer(stats, { qid: 'q2', picked: 'b', right: true, at: at(2) });
    expect(stats.q2?.rightSinceWrong).toBeNull();
  });

  it('does not change the stats it is given', () => {
    const before = { q1: stat() };
    const after = applyAnswer(before, { qid: 'q1', picked: 'b', right: true, at: at(5) });
    expect(before).toEqual({ q1: stat() });
    expect(after).not.toBe(before);
  });
});

describe('review pool', () => {
  it('reviewPool and clearedCount follow rightSinceWrong, for questions that exist', () => {
    const qs = fixture();
    const stats: Record<string, QStat> = {
      'mt-a-q001': stat({ rightSinceWrong: null }),
      'mt-a-q002': stat({ rightSinceWrong: 0 }),
      'mt-a-q003': stat({ rightSinceWrong: 1 }),
      'mt-a-q004': stat({ rightSinceWrong: 2 }),
      'hmls-q001': stat({ rightSinceWrong: 3 }),
      'hmls-q002': stat({ rightSinceWrong: 0 }),
      'mt-b-q999': stat({ rightSinceWrong: 0 }),
      'mt-b-q998': stat({ rightSinceWrong: 2 }),
    };
    expect(reviewPool(qs, stats)).toEqual(['mt-a-q002', 'mt-a-q003', 'hmls-q002']);
    expect(clearedCount(qs, stats)).toBe(2);
    expect(reviewPool(qs, {})).toEqual([]);
    expect(clearedCount(qs, {})).toBe(0);
  });
});

describe('review mode', () => {
  /** Pick, check against the live stat, apply the answer and press Next. */
  function answer(s: QuizSession, stats: Record<string, QStat>, byId: Map<string, Question>, id: string) {
    const q = head(s, byId);
    const out = check(pick(s, id), q, stats[q.id], NOW);
    expect(out.record).not.toBeNull();
    const after = out.session;
    return { checked: after, stats: applyAnswer(stats, out.record!), session: next(after, byId, mulberry32(9)) };
  }

  it('a wrong answer re-queues the question', () => {
    const qs = fixture(); const byId = mapOf(qs);
    let stats: Record<string, QStat> = { 'mt-a-q001': stat({ rightSinceWrong: 0 }), 'mt-a-q002': stat({ rightSinceWrong: 0 }) };
    let s = startSession('review', reviewPool(qs, stats), ALL, byId, mulberry32(1), NOW);
    expect(s.total).toBe(2);
    const r = answer(s, stats, byId, 'a');
    expect(r.checked.queue).toEqual(['mt-a-q001', 'mt-a-q002', 'mt-a-q001']);
    ({ stats, session: s } = r);
    expect(s.queue).toEqual(['mt-a-q002', 'mt-a-q001']);
    expect(stats['mt-a-q001']?.rightSinceWrong).toBe(0);
  });

  it('two rights (stat at 0, then 1) re-queue once, then drop it, and the session finishes when the pool is clear', () => {
    const qs = fixture(); const byId = mapOf(qs);
    let stats: Record<string, QStat> = { 'mt-a-q001': stat({ rightSinceWrong: 0 }) };
    let s = startSession('review', reviewPool(qs, stats), ALL, byId, mulberry32(1), NOW);
    let r = answer(s, stats, byId, 'b');
    expect(r.checked.queue).toEqual(['mt-a-q001', 'mt-a-q001']);
    ({ stats, session: s } = r);
    expect(stats['mt-a-q001']?.rightSinceWrong).toBe(1);
    expect(isFinished(s)).toBe(false);
    r = answer(s, stats, byId, 'b');
    expect(r.checked.queue).toEqual(['mt-a-q001']);
    ({ stats, session: s } = r);
    expect(stats['mt-a-q001']?.rightSinceWrong).toBe(2);
    expect(isFinished(s)).toBe(true);
    expect(reviewPool(qs, stats)).toEqual([]);
    expect(clearedCount(qs, stats)).toBe(1);
    expect(score(s)).toEqual({ right: 2, answered: 2, total: 1 });
  });

  it('total stays the starting pool size through re-queues', () => {
    const qs = fixture(); const byId = mapOf(qs);
    let stats: Record<string, QStat> = { 'mt-a-q001': stat({ rightSinceWrong: 1 }), 'mt-a-q002': stat({ rightSinceWrong: 1 }) };
    let s = startSession('review', reviewPool(qs, stats), ALL, byId, mulberry32(1), NOW);
    ({ stats, session: s } = answer(s, stats, byId, 'c'));   // q001 wrong: back to 0, re-queued
    ({ stats, session: s } = answer(s, stats, byId, 'b'));   // q002 right: 2, cleared
    expect(s.queue).toEqual(['mt-a-q001']);
    ({ stats, session: s } = answer(s, stats, byId, 'b'));   // q001: 1, re-queued
    ({ stats, session: s } = answer(s, stats, byId, 'b'));   // q001: 2, cleared
    expect(isFinished(s)).toBe(true);
    expect(s.total).toBe(2);
    expect(s.done).toHaveLength(4);
  });

  it('a right answer with no wrong on record does not re-queue', () => {
    const byId = mapOf(fixture());
    const s = pick(startSession('review', ['mt-a-q001'], ALL, byId, mulberry32(1), NOW), 'b');
    expect(check(s, head(s, byId), undefined, NOW).session.queue).toEqual(['mt-a-q001']);
  });

  it('practice and test never re-queue', () => {
    const byId = mapOf(fixture());
    for (const mode of ['practice', 'test'] as const) {
      const s = pick(startSession(mode, ['mt-a-q001'], ALL, byId, mulberry32(1), NOW), 'a');
      expect(check(s, head(s, byId), stat({ rightSinceWrong: 0 }), NOW).session.queue).toEqual(['mt-a-q001']);
    }
  });

  it('a re-queued question gets a fresh order when it shows again, and still grades by id', () => {
    const byId = mapOf(fixture());
    const q = byId.get('mt-a-q001')!;
    let differs = false;
    for (let seed = 1; seed <= 20; seed++) {
      let s = startSession('review', [q.id], ALL, byId, mulberry32(seed), NOW);
      const first = s.orders[q.id]!;
      s = check(pick(s, 'a'), q, stat({ rightSinceWrong: 0 }), NOW).session;   // wrong: re-queued behind itself
      expect(s.queue).toEqual([q.id, q.id]);
      expect(s.orders[q.id]).toEqual(first);                                     // the feedback still shows the old order
      s = next(s, byId, mulberry32(seed + 100));
      const again = s.orders[q.id]!;
      expect(again).toEqual(shuffleOptions(q, mulberry32(seed + 100)));          // rebuilt with the rng passed to next
      if (again.join() !== first.join()) differs = true;
      const out = check(pick(s, 'b'), q, stat({ rightSinceWrong: 0 }), NOW);
      expect(out.record?.right).toBe(true);
    }
    expect(differs).toBe(true);
  });

  it('a first showing in review is shuffled as before, and practice keeps an existing order', () => {
    const byId = mapOf(fixture());
    let s = startSession('review', ['mt-a-q001', 'mt-a-q002'], ALL, byId, mulberry32(1), NOW);
    s = next(check(pick(s, 'b'), head(s, byId), stat({ rightSinceWrong: 1 }), NOW).session, byId, mulberry32(4));
    expect(s.orders['mt-a-q002']).toEqual(shuffleOptions(byId.get('mt-a-q002')!, mulberry32(4)));
    // Practice never shows a question twice, but if a queue ever held one, its order is left as it was.
    let p = startSession('practice', ['mt-a-q001'], ALL, byId, mulberry32(1), NOW);
    p = { ...p, queue: ['mt-a-q001', 'mt-a-q001'] };
    const order = p.orders['mt-a-q001'];
    p = next(check(pick(p, 'b'), head(p, byId), undefined, NOW).session, byId, mulberry32(4));
    expect(p.orders['mt-a-q001']).toBe(order);
  });
});

describe('Review Focus 4: resumeSession', () => {
  function midSession() {
    const qs = fixture(); const byId = mapOf(qs);
    let s = startSession('practice', ['mt-a-q001', 'mt-a-q002', 'mt-a-q003', 'mt-a-q004'], ALL, byId, mulberry32(1), NOW);
    s = check(pick(s, 'b'), head(s, byId), undefined, NOW).session;
    s = next(s, byId, mulberry32(2));          // queue q002 q003 q004; done q001; orders q001 q002
    return { qs, byId, s };
  }

  it('drops a queued id that no longer exists', () => {
    const { byId, s } = midSession();
    byId.delete('mt-a-q003');
    const r = resumeSession(s, byId, mulberry32(3));
    expect(r?.queue).toEqual(['mt-a-q002', 'mt-a-q004']);
    expect(r?.done).toEqual(s.done);
    expect(r?.orders).toEqual(s.orders);
    expect(r?.total).toBe(3);
  });

  it('drops a done id that no longer exists, with its order', () => {
    const { byId, s } = midSession();
    byId.delete('mt-a-q001');
    const r = resumeSession(s, byId, mulberry32(3));
    expect(r?.done).toEqual([]);
    expect(r?.orders['mt-a-q001']).toBeUndefined();
    expect(r?.queue).toEqual(s.queue);
    expect(r?.total).toBe(3);
  });

  it('rebuilds the order of a question whose option ids changed, and keeps the rest', () => {
    const { byId, s } = midSession();
    const q2 = byId.get('mt-a-q002')!;
    byId.set('mt-a-q002', { ...q2, options: q2.options.slice(0, 3) });
    const r = resumeSession(s, byId, mulberry32(3));
    expect(r).not.toBeNull();
    expect([...r!.orders['mt-a-q002']!].sort()).toEqual(['a', 'b', 'c']);
    const { orders: rOrders, ...rRest } = r!;
    const { orders: sOrders, ...sRest } = s;
    expect(rRest).toEqual(sRest);
    expect(rOrders['mt-a-q001']).toEqual(sOrders['mt-a-q001']);
  });

  it('keeps an unchanged session as it was', () => {
    const { byId, s } = midSession();
    expect(resumeSession(s, byId, mulberry32(3))).toEqual(s);
  });

  it('shuffles a head that has no order, and clears a pick for a head that went away', () => {
    const { byId, s } = midSession();
    const picked = pick(s, 'c');
    byId.delete('mt-a-q002');
    const r = resumeSession(picked, byId, mulberry32(3));
    expect(r?.queue[0]).toBe('mt-a-q003');
    expect(r?.picked).toBeNull();
    expect(r?.checked).toBeNull();
    expect([...r!.orders['mt-a-q003']!].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clears an unchecked pick whose option is gone, and keeps one that still fits', () => {
    const { byId, s } = midSession();
    const q2 = byId.get('mt-a-q002')!;
    byId.set('mt-a-q002', { ...q2, options: q2.options.slice(0, 3) });
    expect(resumeSession(pick(s, 'd'), byId, mulberry32(3))?.picked).toBeNull();
    expect(resumeSession(pick(s, 'a'), byId, mulberry32(3))?.picked).toBe('a');
  });

  it('keeps a checked head checked, so a resumed answer cannot be counted twice', () => {
    const qs = fixture(); const byId = mapOf(qs);
    let s = startSession('practice', ['mt-a-q001', 'mt-a-q002'], ALL, byId, mulberry32(1), NOW);
    s = check(pick(s, 'a'), head(s, byId), undefined, NOW).session;
    const r = resumeSession(JSON.parse(JSON.stringify(s)) as QuizSession, byId, mulberry32(3))!;
    expect(r.checked).toEqual(s.checked);
    expect(check(r, head(r, byId), undefined, NOW).record).toBeNull();
  });

  it('returns null when every id is gone', () => {
    const { s } = midSession();
    expect(resumeSession(s, new Map(), mulberry32(3))).toBeNull();
  });
});

describe('score, bank progress and letters', () => {
  it('score counts the right answers in done', () => {
    const byId = mapOf(fixture());
    let s = startSession('test', ['mt-a-q001', 'mt-a-q002', 'mt-a-q003'], ALL, byId, mulberry32(1), NOW);
    for (const id of ['b', 'a', 'b']) s = next(check(pick(s, id), head(s, byId), undefined, NOW).session, byId, mulberry32(4));
    expect(score(s)).toEqual({ right: 2, answered: 3, total: 3 });
  });

  it('bankProgress counts answered per group and ignores stats for ids not in qs', () => {
    const qs = fixture();
    const stats: Record<string, QStat> = {
      'mt-a-q001': stat(), 'mt-a-q002': stat(), 'mt-a-q003': stat({ seen: 4 }),
      'mt-a-q004': stat({ seen: 0 }),
      'hmls-q005': stat(),
      'mt-b-q999': stat(), 'hmls-q099': stat(),
    };
    expect(bankProgress(qs, stats)).toEqual([
      { group: 'mt', label: 'Medical and trauma', answered: 3, total: 25 },
      { group: 'hmls', label: 'HMLS', answered: 1, total: 5 },
    ]);
  });

  it('displayLetter maps an index to A–D', () => {
    expect(displayLetter(2)).toBe('C');
    expect([0, 1, 2, 3].map(displayLetter)).toEqual(['A', 'B', 'C', 'D']);
  });
});

/** Freezes an object and everything inside it. The engine runs in strict mode, so a write to any of it throws. */
function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

const snapshot = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('no input is mutated', () => {
  it('pick, check, next and resumeSession leave their inputs as they were', () => {
    const qs = fixture().map(deepFreeze);
    const byId = mapOf(qs);
    const entries = [...byId.entries()];
    // A review session part-way through: q001 answered and cleared, q002 showing.
    let s = startSession('review', ['mt-a-q001', 'mt-a-q002'], ALL, byId, mulberry32(1), NOW);
    s = next(check(pick(s, 'b'), head(s, byId), stat({ rightSinceWrong: 1 }), NOW).session, byId, mulberry32(2));

    const fresh = deepFreeze(s), freshBefore = snapshot(fresh);
    const picked = deepFreeze(pick(fresh, 'a'));
    expect(fresh).toStrictEqual(freshBefore);

    const pickedBefore = snapshot(picked);
    const st = deepFreeze(stat({ rightSinceWrong: 0 }));
    const checked = deepFreeze(check(picked, head(picked, byId), st, NOW).session);   // wrong: re-queued
    expect(picked).toStrictEqual(pickedBefore);
    expect(st).toStrictEqual(stat({ rightSinceWrong: 0 }));
    expect(checked.queue).toEqual(['mt-a-q002', 'mt-a-q002']);

    const checkedBefore = snapshot(checked);
    const moved = deepFreeze(next(checked, byId, mulberry32(3)));                       // reshuffles q002
    expect(checked).toStrictEqual(checkedBefore);

    // Resume with q001 gone and q002's options cut to three, so the drop and rebuild paths both run.
    const movedBefore = snapshot(moved);
    const q2 = byId.get('mt-a-q002')!;
    const byId2 = new Map(byId);
    byId2.delete('mt-a-q001');
    byId2.set('mt-a-q002', deepFreeze({ ...q2, options: q2.options.slice(0, 3) }));
    const entries2 = [...byId2.entries()];
    const resumed = resumeSession(moved, byId2, mulberry32(4));
    expect(resumed?.done.map(r => r.qid)).toEqual(['mt-a-q002']);
    expect([...resumed!.orders['mt-a-q002']!].sort()).toEqual(['a', 'b', 'c']);
    expect(moved).toStrictEqual(movedBefore);
    expect([...byId2.entries()]).toEqual(entries2);
    expect([...byId.entries()]).toEqual(entries);
  });
});

describe('saved sessions', () => {
  it('a session round-trips through JSON unchanged and validates as quizOpen', () => {
    const byId = mapOf(fixture());
    const filters: QuizFilter[] = [ALL, { group: 'mt', topic: 'cardiac', ids: ['mt-a-q001', 'mt-a-q002'] }];
    for (const f of filters) {
      let s = startSession('review', ['mt-a-q001', 'mt-a-q002'], f, byId, mulberry32(1), NOW);
      const steps: QuizSession[] = [s];
      s = pick(s, 'a'); steps.push(s);
      s = check(s, head(s, byId), stat(), NOW).session; steps.push(s);
      s = next(s, byId, mulberry32(2)); steps.push(s);
      s = resumeSession(s, byId, mulberry32(3))!; steps.push(s);
      for (const step of steps) {
        expect(JSON.parse(JSON.stringify(step))).toStrictEqual(step);
        expect(normalizeProgress({ quizOpen: step })?.quizOpen).toEqual(step);
      }
    }
  });

  it('a broken rng cannot put a hole in an order', () => {
    const q = fixture()[0]!;
    for (const r of [() => 1, () => -0.5, () => Number.NaN, () => 0.999999999]) {
      expect([...shuffleOptions(q, r)].sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('the engine never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const qs = fixture(); const byId = mapOf(qs);
      const ids = selectPractice(qs, {}, ALL, 20, mulberry32(1));
      selectTest(qs, ALL, 50, mulberry32(1));
      let s = startSession('practice', ids, ALL, byId, mulberry32(1), NOW);
      s = next(check(pick(s, 'b'), head(s, byId), undefined, NOW).session, byId, mulberry32(2));
      resumeSession(s, byId, mulberry32(3));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import { MemoryStorage } from './helpers';
import {
  SESSION_UNSAVABLE_ERROR, SLOT_KEYS, UNSAVABLE_ERROR, checkSavable, checksum, createSlotMemo, loadProgress, newestSavedSeq, saveProgress, savedOnDisk,
  type LoadResult, type SlotStorage,
} from '../../src/progress/slots';
import { SCHEMA_VERSION, defaultProgress, normalizeProgress, type Progress, type QuizSession } from '../../src/progress/types';

const T1 = new Date('2026-11-09T10:00:00.000Z');
const T2 = new Date('2026-11-09T10:05:00.000Z');
const T3 = new Date('2026-11-09T10:10:00.000Z');

/** Defaults plus one question stat, so saves at different seqs hold different data. */
function withStat(id: string, seen = 1): Progress {
  return {
    ...defaultProgress(),
    questions: { [id]: { seen, right: 1, lastAt: '2026-11-09T10:00:00.000Z', lastRight: true, rightSinceWrong: null } },
  };
}

/** A well-formed envelope string, with fields overridable to build bad slots. */
function envelope(data: unknown, seq: number, over: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: SCHEMA_VERSION, seq, savedAt: T1.toISOString(), sum: checksum(JSON.stringify(data)), data, ...over });
}

function session(id: string): QuizSession {
  return { id, mode: 'practice', filter: { group: 'all', topic: 'all' }, startedAt: T1.toISOString(), total: 1,
    queue: ['q1'], orders: { q1: ['a', 'b'] }, picked: null, checked: null, done: [] };
}

function parsed(storage: MemoryStorage, slot: 0 | 1): { seq: number; data: Progress } {
  const raw = storage.raw(SLOT_KEYS[slot]);
  if (raw === null) throw new Error(`slot ${slot} is empty`);
  return JSON.parse(raw) as { seq: number; data: Progress };
}

describe('checksum', () => {
  it('is FNV-1a 32-bit as 8 lowercase hex digits', () => {
    expect(checksum('')).toBe('811c9dc5');
    expect(checksum('a')).toBe('e40c292c');
    expect(checksum('foobar')).toBe('bf9cf968');
  });

  it("hashes the UTF-8 bytes of text beyond ASCII, as every build's saves have (values from fa5e7c4's for…of loop)", () => {
    expect(checksum('é漢字')).toBe('4dffd446');
    expect(checksum('RBS 2:41 ✓ – “quoted”')).toBe('a326d914');
  });
});

describe('fresh storage', () => {
  it('loads empty storage as fresh defaults, available', () => {
    const r = loadProgress(new MemoryStorage());
    expect(r).toEqual({ status: 'fresh', data: defaultProgress(), seq: 0, available: true });
  });

  it('loads null storage as fresh, unavailable', () => {
    const r = loadProgress(null);
    expect(r.status).toBe('fresh');
    expect(r.data).toEqual(defaultProgress());
    expect(r.status === 'fresh' && r.available).toBe(false);
  });
});

describe('round trip', () => {
  it('loads a seq 1 save as ok with equal data and the savedAt the save returned', () => {
    const s = new MemoryStorage();
    const data = withStat('mt-a-q001');
    const saved = saveProgress(s, data, 1, T1);
    expect(saved).toEqual({ ok: true, savedAt: T1.toISOString() });
    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.data).toEqual(data);
    expect(r.seq).toBe(1);
    expect(r.status === 'ok' && r.savedAt).toBe(T1.toISOString());
  });
});

describe('alternation', () => {
  it('puts seq 1 in slot 1, seq 2 in slot 0 and seq 3 in slot 1, keeping seq 2 in slot 0', () => {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q', 1), 1, T1);
    expect(parsed(s, 1).seq).toBe(1);
    expect(s.raw(SLOT_KEYS[0])).toBeNull();

    saveProgress(s, withStat('q', 2), 2, T2);
    expect(parsed(s, 0).seq).toBe(2);
    expect(parsed(s, 1).seq).toBe(1);

    saveProgress(s, withStat('q', 3), 3, T3);
    expect(parsed(s, 1).seq).toBe(3);
    expect(parsed(s, 0).seq).toBe(2);
    expect(parsed(s, 0).data).toEqual(withStat('q', 2));

    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.seq).toBe(3);
    expect(r.data).toEqual(withStat('q', 3));
  });
});

describe('bad newest slot', () => {
  function twoSaves(): MemoryStorage {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q', 1), 1, T1);
    saveProgress(s, withStat('q', 2), 2, T2);
    return s;
  }

  it('restores seq 1 when the seq 2 slot is torn JSON', () => {
    const s = twoSaves();
    s.map.set(SLOT_KEYS[0], s.raw(SLOT_KEYS[0])!.slice(0, 40));
    const r = loadProgress(s);
    expect(r.status).toBe('restored');
    expect(r.data).toEqual(withStat('q', 1));
    expect(r.seq).toBe(1);
    expect(r.status === 'restored' && r.savedAt).toBe(T1.toISOString());
  });

  it('restores seq 1 when the seq 2 slot fails its checksum', () => {
    const s = twoSaves();
    const env = JSON.parse(s.raw(SLOT_KEYS[0])!) as { data: Progress };
    env.data.dismissedReview = ['tampered'];
    s.map.set(SLOT_KEYS[0], JSON.stringify(env));
    const r = loadProgress(s);
    expect(r.status).toBe('restored');
    expect(r.data).toEqual(withStat('q', 1));
  });

  it('does not trust an envelope stored in the wrong slot for its seq', () => {
    const s = new MemoryStorage();
    s.map.set(SLOT_KEYS[1], envelope(withStat('q', 1), 1));
    s.map.set(SLOT_KEYS[0], envelope(withStat('q', 3), 3)); // seq 3 belongs in slot 1
    const r = loadProgress(s);
    expect(r.status).toBe('restored');
    expect(r.seq).toBe(1);
  });

  it('stays ok when only the older slot is bad', () => {
    const s = twoSaves();
    saveProgress(s, withStat('q', 3), 3, T3);
    s.map.set(SLOT_KEYS[0], envelope(withStat('q', 2), 2, { sum: '00000000' }));
    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.seq).toBe(3);
  });
});

describe('no good slot', () => {
  it('is corrupt when both slots are garbage', () => {
    const s = new MemoryStorage({ [SLOT_KEYS[0]]: 'not json {', [SLOT_KEYS[1]]: '{"v":1,"seq":' });
    const r = loadProgress(s);
    expect(r.status).toBe('corrupt');
    expect(r.data).toEqual(defaultProgress());
  });

  it('is corrupt when the checksum matches but the data has a wrong type', () => {
    const s = new MemoryStorage({ [SLOT_KEYS[1]]: envelope({ dismissedReview: 'q1' }, 1) });
    expect(loadProgress(s).status).toBe('corrupt');
  });

  it('treats a slot too deeply nested to check as unreadable instead of throwing', () => {
    const deep = '['.repeat(200_000) + ']'.repeat(200_000);
    const s = new MemoryStorage({
      [SLOT_KEYS[0]]: envelope(withStat('q', 2), 2),
      [SLOT_KEYS[1]]: `{"v":1,"seq":3,"savedAt":"${T1.toISOString()}","sum":"00000000","data":{"runOpen":${deep}}}`,
    });
    let r: LoadResult | undefined;
    expect(() => { r = loadProgress(s); }).not.toThrow();
    expect(r?.status).toBe('restored');
    expect(r?.seq).toBe(2);
  });
});

describe("a newer version's save", () => {
  // Plan 2 bumps SCHEMA_VERSION. A window still running this build must never write over the newer build's save:
  // it can't read it, so its own memory would replace whatever the newer build kept (a run, say), with no message.
  const newer = (data: unknown, seq: number, over: Record<string, unknown> = {}) =>
    envelope(data, seq, { v: SCHEMA_VERSION + 1, ...over });

  it('above the best good slot reads newer, never restored, with the good slot as memory', () => {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q', 1), 1, T1);
    s.map.set(SLOT_KEYS[0], newer({ runs: ['a v2 run'] }, 2));
    const r = loadProgress(s);
    expect(r.status).toBe('newer');
    expect(r.data).toEqual(withStat('q', 1));
    expect(r.seq).toBe(1);
  });

  it('below the best good slot still reads newer: the next save would land on it', () => {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q', 3), 3, T3);   // slot 1
    s.map.set(SLOT_KEYS[0], newer({ runs: ['a v2 run'] }, 2));
    const r = loadProgress(s);
    expect(r.status).toBe('newer');
    expect(r.seq).toBe(3);
    expect(r.data).toEqual(withStat('q', 3));
  });

  it('alone, or beside garbage, reads newer, not corrupt, so Start fresh is never offered over it', () => {
    const raw = newer(withStat('q'), 1, { v: 99 });
    const alone = new MemoryStorage({ [SLOT_KEYS[1]]: raw });
    expect(loadProgress(alone)).toEqual({ status: 'newer', data: defaultProgress(), seq: 0 });
    expect(alone.raw(SLOT_KEYS[1])).toBe(raw);
    expect(alone.raw(SLOT_KEYS[0])).toBeNull();

    const beside = new MemoryStorage({ [SLOT_KEYS[0]]: 'garbage {', [SLOT_KEYS[1]]: raw });
    expect(loadProgress(beside).status).toBe('newer');
  });

  it('counts in whichever slot it sits, whatever its seq or checksum: this build reads none of it', () => {
    for (const raw of [newer({}, 3), newer({}, 0), newer({}, 2, { sum: 'x' }), JSON.stringify({ v: SCHEMA_VERSION + 1 })]) {
      const s = new MemoryStorage();
      saveProgress(s, withStat('q', 1), 1, T1);
      s.map.set(SLOT_KEYS[0], raw);
      expect(loadProgress(s).status, raw).toBe('newer');
      expect(savedOnDisk(s).newer, raw).toBe(true);
    }
  });

  it('a v this build wrote, or a v that is not a whole number, is no newer save', () => {
    for (const v of [SCHEMA_VERSION, 0, 1.5, '2', null]) {
      const s = new MemoryStorage();
      saveProgress(s, withStat('q', 1), 1, T1);
      s.map.set(SLOT_KEYS[0], envelope(withStat('q', 2), 2, { v, sum: '00000000' }));
      expect(loadProgress(s).status, String(v)).toBe('restored');
      expect(savedOnDisk(s).newer, String(v)).toBe(false);
    }
  });

  it('counts in the two-window guard: savedOnDisk says newer, and newestSavedSeq takes its seq', () => {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q', 2), 2, T2);   // slot 0
    expect(savedOnDisk(s)).toEqual({ seq: 2, newer: false });
    s.map.set(SLOT_KEYS[1], newer({ runs: [] }, 3));
    expect(savedOnDisk(s)).toEqual({ seq: 3, newer: true });
    expect(newestSavedSeq(s)).toBe(3);
  });
});

describe('saves that would not load back', () => {
  it('refuses NaN without writing, so the target slot keeps its older save', () => {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q', 1), 1, T1);
    saveProgress(s, withStat('q', 2), 2, T2);
    const before = s.raw(SLOT_KEYS[1]);
    const bad = withStat('q', 3);
    bad.questions.q!.seen = NaN;
    const r = saveProgress(s, bad, 3, T3);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/\S/);
    expect(s.raw(SLOT_KEYS[1])).toBe(before);
    expect(loadProgress(s).status).toBe('ok');
  });

  it('refuses an undefined array item and leaves an empty slot empty', () => {
    const s = new MemoryStorage();
    const bad: Progress = { ...defaultProgress(), dismissedReview: [undefined as unknown as string] };
    expect(saveProgress(s, bad, 1, T1).ok).toBe(false);
    expect(s.map.size).toBe(0);
  });
});

describe('sessions that fail validation', () => {
  it('load as null without making the whole save unreadable', () => {
    const data = { ...withStat('q'), quizLast: { ...session('last'), filter: { group: 'all', topic: 'dropped-topic' } } };
    const r = loadProgress(new MemoryStorage({ [SLOT_KEYS[1]]: envelope(data, 1) }));
    expect(r.status).toBe('ok');
    expect(r.data.quizLast).toBeNull();
    expect(r.data.questions).toEqual(withStat('q').questions);
  });

  it('fall back to null in normalizeProgress, while a good session is kept', () => {
    expect(normalizeProgress({ quizOpen: 'x', quizLast: { id: 1 } })).toMatchObject({ quizOpen: null, quizLast: null });
    expect(normalizeProgress({ quizOpen: session('open') })?.quizOpen).toEqual(session('open'));
  });
});

describe('Review Focus 2: full or blocked storage', () => {
  it('fails a save without throwing and keeps the other slot loading ok', () => {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q', 1), 1, T1);
    s.failWrites = true;
    let r: ReturnType<typeof saveProgress> | undefined;
    expect(() => { r = saveProgress(s, withStat('q', 2), 2, T2); }).not.toThrow();
    expect(r?.ok).toBe(false);
    expect(r && !r.ok && r.error.length > 0).toBe(true);
    s.failWrites = false;
    const loaded = loadProgress(s);
    expect(loaded.status).toBe('ok');
    expect(loaded.seq).toBe(1);
    expect(loaded.data).toEqual(withStat('q', 1));
  });

  it('fails a save whose read-back does not match', () => {
    const backing = new MemoryStorage();
    const lossy: SlotStorage = {
      getItem: (k) => backing.getItem(k)?.slice(0, -1) ?? null,
      setItem: (k, v) => backing.setItem(k, v),
      removeItem: (k) => backing.removeItem(k),
    };
    const r = saveProgress(lossy, withStat('q'), 1, T1);
    expect(r.ok).toBe(false);
  });

  it('loads fresh and unavailable when getItem throws', () => {
    const s = new MemoryStorage();
    saveProgress(s, withStat('q'), 1, T1);
    s.failReads = true;
    const r = loadProgress(s);
    expect(r.status).toBe('fresh');
    expect(r.status === 'fresh' && r.available).toBe(false);
    expect(r.data).toEqual(defaultProgress());
  });
});

describe('normalizeProgress', () => {
  it('fills every missing key from the defaults', () => {
    expect(normalizeProgress({})).toEqual(defaultProgress());
    const p = normalizeProgress({ settings: { textSize: 'larger' }, notes: { read: ['s01'] } });
    expect(p?.settings).toEqual({ textSize: 'larger', haptics: true, answerBy: 'typing' });
    expect(p?.notes).toEqual({ lastSection: null, read: ['s01'] });
  });

  it('is null for a non-object or a known key of the wrong type', () => {
    for (const raw of [null, undefined, 'x', 3, [], [defaultProgress()]]) expect(normalizeProgress(raw)).toBeNull();
    expect(normalizeProgress({ dismissedReview: 'q1' })).toBeNull();
    expect(normalizeProgress({ settings: { textSize: 'huge' } })).toBeNull();
    expect(normalizeProgress({ notes: [] })).toBeNull();
    expect(normalizeProgress({ questions: { q1: { seen: '1' } } })).toBeNull();
  });

  it('turns a runOpen that fails its schema into null, and the save still loads ok', () => {
    expect(normalizeProgress({ runOpen: { step: 3 } })?.runOpen).toBeNull();
    expect(normalizeProgress({ runOpen: 'x' })?.runOpen).toBeNull();
    const r = loadProgress(new MemoryStorage({ [SLOT_KEYS[1]]: envelope({ ...withStat('q'), runOpen: { step: 3 } }, 1) }));
    expect(r.status).toBe('ok');
    expect(r.data.runOpen).toBeNull();
    expect(r.data.questions).toEqual(withStat('q').questions);
  });

  it('gets a fresh defaults object from each defaultProgress call', () => {
    const a = defaultProgress();
    a.dismissedReview.push('q1');
    expect(defaultProgress().dismissedReview).toEqual([]);
  });
});

describe('the slot memo', () => {
  it("skips parsing a slot it saw unchanged, and reads one whose text changed, so a newer build's save is still seen", () => {
    const s = new MemoryStorage();
    const memo = createSlotMemo();
    saveProgress(s, withStat('q', 1), 1, T1, memo);
    saveProgress(s, withStat('q', 2), 2, T2, memo);
    const parse = vi.spyOn(JSON, 'parse');
    expect(savedOnDisk(s, memo)).toEqual({ seq: 2, newer: false });
    expect(parse).not.toHaveBeenCalled();
    s.map.set(SLOT_KEYS[1], envelope(withStat('q'), 3, { v: SCHEMA_VERSION + 1 }));
    expect(savedOnDisk(s, memo)).toEqual({ seq: 3, newer: true });
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });

  it('checks the whole save first, then only the top-level keys changed since, and still refuses one that would not load back (ruling D12)', () => {
    const s = new MemoryStorage();
    const memo = createSlotMemo();
    const first = withStat('q', 1);
    const parse = vi.spyOn(JSON, 'parse');
    expect(saveProgress(s, first, 1, T1, memo).ok).toBe(true);
    expect(parse.mock.calls).toEqual([[JSON.stringify(first)]]);
    const quiz = { ...first, quizOpen: session('a') };
    expect(saveProgress(s, quiz, 2, T2, memo).ok).toBe(true);
    expect(parse.mock.calls.slice(1)).toEqual([[JSON.stringify(quiz.quizOpen)]]);
    // A changed key that wouldn't load back is refused as before: the whole save, or the session alone.
    const badStat = { ...quiz, questions: { q: { ...quiz.questions.q!, seen: NaN } } };
    expect(saveProgress(s, badStat, 3, T3, memo)).toEqual({ ok: false, error: UNSAVABLE_ERROR });
    const badQuiz = { ...quiz, quizOpen: { ...session('a'), total: NaN } };
    expect(saveProgress(s, badQuiz, 3, T3, memo)).toEqual({ ok: false, error: SESSION_UNSAVABLE_ERROR });
    // A refused save is never the one checked against: the bad key is checked again next time, and refused again.
    expect(saveProgress(s, { ...badQuiz, notes: { lastSection: 's01', read: [] } }, 3, T3, memo))
      .toEqual({ ok: false, error: SESSION_UNSAVABLE_ERROR });
    parse.mockRestore();
    expect(loadProgress(s)).toMatchObject({ status: 'ok', seq: 2, data: quiz });
  });

  it('refuses a session key gone from the progress once there is a baseline, as the whole check does', () => {
    const s = new MemoryStorage();
    const memo = createSlotMemo();
    const quiz = { ...withStat('q', 1), quizOpen: session('a') };
    expect(saveProgress(s, quiz, 1, T1, memo).ok).toBe(true);
    const { quizOpen: _gone, ...rest } = quiz;
    expect(saveProgress(s, rest as Progress, 2, T2, memo)).toEqual({ ok: false, error: SESSION_UNSAVABLE_ERROR });
    expect(checkSavable(rest as Progress)).toBe(SESSION_UNSAVABLE_ERROR);
  });

  it('leaves checkSavable checking everything, whatever a memo holds', () => {
    const s = new MemoryStorage();
    const memo = createSlotMemo();
    const p = withStat('q', 1);
    expect(saveProgress(s, p, 1, T1, memo).ok).toBe(true);
    // An in-place edit breaks the store's rule (updates are immutable; store.test.ts pins it): the memo's baseline
    // still holds the same objects, so a save through it doesn't look again. checkSavable has no baseline: it does.
    p.questions.q!.seen = NaN;
    expect(saveProgress(s, p, 2, T2, memo).ok).toBe(true);
    expect(checkSavable(p)).toBe(UNSAVABLE_ERROR);
  });
});

// ---- Plan 3 Task 7: a save over the quota (parked 7, ruling D28) -------------------------------------------------

describe('a save over the quota', () => {
  /** Storage whose every setItem throws `e`. */
  function throwing(e: unknown): SlotStorage {
    const s = new MemoryStorage();
    return { getItem: (k) => s.getItem(k), setItem: () => { throw e; }, removeItem: (k) => s.removeItem(k) };
  }
  const saveInto = (e: unknown) => saveProgress(throwing(e), withStat('q'), 1, T1);

  it("says quota for a DOMException named QuotaExceededError (Chrome's) or NS_ERROR_DOM_QUOTA_REACHED (old Firefox's)", () => {
    expect(saveInto(new DOMException('full', 'QuotaExceededError'))).toEqual({ ok: false, error: expect.stringContaining('full'), quota: true });
    expect(saveInto(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'))).toEqual({ ok: false, error: expect.stringContaining('full'), quota: true });
  });

  it('says quota for a DOMException with the legacy code 22', () => {
    const e = new DOMException('full', 'SomeQuotaName');
    Object.defineProperty(e, 'code', { value: 22 });
    expect(saveInto(e)).toEqual({ ok: false, error: expect.stringContaining('full'), quota: true });
  });

  it('says no quota for a plain Error, even one that names it, nor for another DOMException', () => {
    const plain = saveInto(new Error('QuotaExceededError: storage is full'));
    expect(plain).toEqual({ ok: false, error: 'QuotaExceededError: storage is full' });
    expect(plain).not.toHaveProperty('quota');
    const named = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    expect(saveInto(named)).not.toHaveProperty('quota');
    expect(saveInto(new DOMException('blocked', 'SecurityError'))).not.toHaveProperty('quota');
  });

  it('keeps the other slot loading ok', () => {
    const backing = new MemoryStorage();
    saveProgress(backing, withStat('q', 1), 1, T1);
    const full: SlotStorage = { getItem: (k) => backing.getItem(k), removeItem: (k) => backing.removeItem(k),
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(saveProgress(full, withStat('q', 2), 2, T2)).toMatchObject({ ok: false, quota: true });
    const loaded = loadProgress(backing);
    expect(loaded.status).toBe('ok');
    expect(loaded.seq).toBe(1);
  });
});

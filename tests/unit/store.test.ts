import { describe, it, expect, vi } from 'vitest';
import { h, type ComponentChildren } from 'preact';
import { render, renderHook, act } from '@testing-library/preact';
import { MemoryStorage } from './helpers';
import { blankSession } from './sim-helpers';
import { SESSION_UNSAVABLE_ERROR, SLOT_KEYS, UNSAVABLE_ERROR, checksum, loadProgress, saveProgress } from '../../src/progress/slots';
import {
  RUN_LIMITS, SCHEMA_VERSION, defaultProgress, normalizeProgress, trimTranscripts,
  type ChatLine, type Progress, type QStat, type QuizSession, type RunRecord, type RunSession,
} from '../../src/progress/types';
import { createProgressStore, persistOnce, requestPersist, type ProgressStore } from '../../src/progress/store';
import { ProgressContext, useProgress, useStore } from '../../src/progress/hooks';

const ANOTHER_WINDOW = 'Your progress changed in another window. Reload this one to keep going.';
const NEWER_VERSION = 'This copy of EMTNotes is out of date. Reload to update.';

/** Storage whose writes can be cut short, like a torn write: the stored string loses its tail. */
class TearingStorage extends MemoryStorage {
  tear = false;
  override setItem(k: string, v: string): void {
    super.setItem(k, this.tear ? v.slice(0, 50) : v);
  }
}

const provider = (store: ProgressStore) => ({ children }: { children?: ComponentChildren }) =>
  h(ProgressContext.Provider, { value: store }, children);

const T1 = new Date('2026-11-09T10:00:00.000Z');
const STAT: QStat = { seen: 1, right: 1, lastAt: '2026-11-09T10:00:00.000Z', lastRight: true, rightSinceWrong: null };
const addStat = (id: string) => (p: Progress): Progress => ({ ...p, questions: { ...p.questions, [id]: STAT } });

/** A save envelope from a newer version of the app (Plan 2 bumps SCHEMA_VERSION), holding a run this build can't read. */
function newerSave(seq: number): string {
  const data = { ...defaultProgress(), runs: [{ id: 'r1', caseId: 'case-01', v2Only: true }] };
  return JSON.stringify({ v: SCHEMA_VERSION + 1, seq, savedAt: T1.toISOString(), sum: checksum(JSON.stringify(data)), data });
}
const bothSlots = (s: MemoryStorage) => [s.raw(SLOT_KEYS[0]), s.raw(SLOT_KEYS[1])];

function garbageStorage(): MemoryStorage {
  return new MemoryStorage({ [SLOT_KEYS[0]]: 'garbage {', [SLOT_KEYS[1]]: '{"v":1,"seq":3,"sum":' });
}

function session(id: string): QuizSession {
  return { id, mode: 'practice', filter: { group: 'all', topic: 'all' }, startedAt: T1.toISOString(), total: 1,
    queue: ['q1'], orders: { q1: ['a', 'b'] }, picked: null, checked: null, done: [] };
}

describe('updates', () => {
  it('notifies subscribers and persists, so a new store on the same storage reads the change', () => {
    const s = new MemoryStorage();
    const store = createProgressStore(s, () => T1);
    const fn = vi.fn();
    store.subscribe(fn);
    store.update(addStat('q1'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]?.[0].questions.q1).toEqual(STAT);
    expect(store.get().questions.q1).toEqual(STAT);
    expect(store.lastSaveError()).toBeNull();

    const again = createProgressStore(s);
    expect(again.lastLoad().status).toBe('ok');
    expect(again.get().questions.q1).toEqual(STAT);
  });

  it('stops notifying after unsubscribe, and skips an update that returns the same object', () => {
    const s = new MemoryStorage();
    const store = createProgressStore(s);
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.update((p) => p);
    expect(fn).not.toHaveBeenCalled();
    expect(s.map.size).toBe(0);
    off();
    store.update(addStat('q1'));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('restored load', () => {
  it('writes the next save into the bad slot and keeps the good one byte-identical', () => {
    const s = new MemoryStorage();
    saveProgress(s, addStat('kept')(defaultProgress()), 2, T1);   // seq 2, slot 0
    s.map.set(SLOT_KEYS[1], JSON.stringify({ v: 1, seq: 3, savedAt: T1.toISOString(), sum: '00000000', data: defaultProgress() }));
    const good = s.raw(SLOT_KEYS[0]);
    const store = createProgressStore(s);
    expect(store.lastLoad().status).toBe('restored');

    store.update(addStat('q1'));
    expect(store.lastSaveError()).toBeNull();
    expect(s.raw(SLOT_KEYS[0])).toBe(good);
    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.seq).toBe(3);
    expect(Object.keys(r.data.questions)).toEqual(['kept', 'q1']);
  });
});

describe('two windows on one storage', () => {
  it('blocks a stale window instead of letting it overwrite the newer saves', () => {
    const s = new MemoryStorage();
    const a = createProgressStore(s);
    for (let i = 1; i <= 5; i++) a.update(addStat(`a${i}`));
    const b = createProgressStore(s);
    expect(b.lastLoad().seq).toBe(5);
    for (let i = 6; i <= 40; i++) a.update(addStat(`a${i}`));
    const slots = [s.raw(SLOT_KEYS[0]), s.raw(SLOT_KEYS[1])];

    b.update(addStat('b1'));
    b.update(addStat('b2'));
    expect(b.lastSaveError()).toBe(ANOTHER_WINDOW);
    expect(Object.keys(b.get().questions)).toContain('b2');
    expect([s.raw(SLOT_KEYS[0]), s.raw(SLOT_KEYS[1])]).toEqual(slots);
    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.seq).toBe(40);
    expect(r.data).toEqual(a.get());

    a.update(addStat('a41'));
    expect(a.lastSaveError()).toBeNull();
    expect(loadProgress(s).seq).toBe(41);

    expect(b.tryAgain().seq).toBe(41);
    b.update(addStat('b3'));
    expect(b.lastSaveError()).toBeNull();
    expect(loadProgress(s).seq).toBe(42);
  });

  it("isn't fooled by this store's own torn write", () => {
    const s = new TearingStorage();
    const store = createProgressStore(s);
    store.update(addStat('q1'));   // seq 1
    s.tear = true;
    store.update(addStat('q2'));   // seq 2 tears in slot 0
    expect(store.lastSaveError()).not.toBeNull();
    expect(s.raw(SLOT_KEYS[0])).toMatch(new RegExp(`^\\{"v":${SCHEMA_VERSION},"seq":2,`));
    s.tear = false;
    store.update(addStat('q3'));
    expect(store.lastSaveError()).toBeNull();
    expect(loadProgress(s).seq).toBe(2);
  });
});

describe("a newer version's save (I1)", () => {
  it('an older store that loaded ok never writes over a newer build saving after it, and says so', () => {
    const s = new MemoryStorage();
    const old = createProgressStore(s);
    old.update(addStat('q1'));
    old.update(addStat('q2'));   // seq 2, slot 0
    s.map.set(SLOT_KEYS[1], newerSave(3));   // the updated app, in another window, saves seq 3
    const disk = bothSlots(s);

    const fn = vi.fn();
    old.subscribe(fn);
    old.update(addStat('q3'));
    old.update(addStat('q4'));
    expect(bothSlots(s)).toEqual(disk);
    expect(old.lastSaveError()).toBe(NEWER_VERSION);
    expect(old.writeBlock()).toBe('newer');
    expect(Object.keys(old.get().questions)).toEqual(['q1', 'q2', 'q3', 'q4']);   // kept in memory
    expect(fn).toHaveBeenCalledTimes(2);
    expect(loadProgress(s).status).toBe('newer');
  });

  it.each([
    ['restored', 1, 2],   // the newer save is above the good one: before I1 this read restored
    ['ok', 3, 2],         // the newer save is below the good one, in the slot the next save would take
  ])('a load that read %s before, with a newer save beside it, blocks at once and never writes it', (_, goodSeq, newerSeq) => {
    const s = new MemoryStorage();
    saveProgress(s, addStat('kept')(defaultProgress()), goodSeq, T1);
    s.map.set(SLOT_KEYS[newerSeq % 2]!, newerSave(newerSeq));
    const disk = bothSlots(s);
    const store = createProgressStore(s);
    expect(store.lastLoad().status).toBe('newer');
    expect(store.writeBlock()).toBe('newer');
    expect(store.lastSaveError()).toBe(NEWER_VERSION);
    expect(store.get().questions.kept).toEqual(STAT);   // the good slot shows, read only

    store.update(addStat('q1'));
    store.resetProgress();
    expect(bothSlots(s)).toEqual(disk);
    expect(store.lastSaveError()).toBe(NEWER_VERSION);
  });

  it('neither Try again nor Start fresh clears or writes over it', () => {
    const s = new MemoryStorage({ [SLOT_KEYS[0]]: 'garbage {', [SLOT_KEYS[1]]: newerSave(1) });
    const disk = bothSlots(s);
    const store = createProgressStore(s);
    expect(store.lastLoad().status).toBe('newer');
    expect(store.tryAgain().status).toBe('newer');
    expect(store.writeBlock()).toBe('newer');
    store.startFresh();
    store.update(addStat('q1'));
    expect(bothSlots(s)).toEqual(disk);
    expect(store.writeBlock()).toBe('newer');
  });
});

describe('recheck: a save made in another window (I2)', () => {
  it('blocks a stale window at once, before its next save, and tells subscribers', () => {
    const s = new MemoryStorage();
    const mine = createProgressStore(s);
    mine.update(addStat('q1'));
    const fn = vi.fn();
    mine.subscribe(fn);

    mine.recheck();   // nothing new on disk
    expect(mine.writeBlock()).toBeNull();
    expect(fn).not.toHaveBeenCalled();

    createProgressStore(s).update(addStat('theirs'));   // the other window saves seq 2
    const disk = bothSlots(s);
    mine.recheck();
    expect(mine.writeBlock()).toBe('conflict');
    expect(mine.lastSaveError()).toBe(ANOTHER_WINDOW);
    expect(fn).toHaveBeenCalledTimes(1);
    mine.recheck();
    expect(fn).toHaveBeenCalledTimes(1);   // no news, no notice
    mine.update(addStat('q2'));
    expect(bothSlots(s)).toEqual(disk);
  });

  it("names a newer build's save as one, even after another window's", () => {
    const s = new MemoryStorage();
    const mine = createProgressStore(s);
    mine.update(addStat('q1'));   // seq 1, slot 1
    createProgressStore(s).update(addStat('theirs'));   // seq 2, slot 0
    mine.recheck();
    expect(mine.writeBlock()).toBe('conflict');
    s.map.set(SLOT_KEYS[1], newerSave(3));
    mine.recheck();
    expect(mine.writeBlock()).toBe('newer');
    expect(mine.lastSaveError()).toBe(NEWER_VERSION);
  });

  it('turns a corrupt load into a conflict once another window has a readable save, so Start fresh never wipes it', () => {
    const s = garbageStorage();
    const mine = createProgressStore(s);
    expect(mine.writeBlock()).toBe('corrupt');
    const theirs = createProgressStore(s);
    theirs.startFresh();   // the other window clears the garbage and saves seq 1
    const disk = bothSlots(s);
    mine.recheck();
    expect(mine.writeBlock()).toBe('conflict');
    mine.startFresh();
    expect(bothSlots(s)).toEqual(disk);
  });

  it('Start fresh checks first too, without a storage event', () => {
    const s = garbageStorage();
    const mine = createProgressStore(s);
    createProgressStore(s).startFresh();
    const disk = bothSlots(s);
    mine.startFresh();
    expect(bothSlots(s)).toEqual(disk);
    expect(mine.writeBlock()).toBe('conflict');
    expect(mine.lastSaveError()).toBe(ANOTHER_WINDOW);
  });

  it('does nothing while storage is out of reach', () => {
    const store = createProgressStore(null);
    store.recheck();
    expect(store.writeBlock()).toBe('unavailable');
  });
});

describe('Review Focus 3: corrupt save with no backup', () => {
  it('writes nothing until Start fresh, keeps changes in memory, then persists again', () => {
    const s = garbageStorage();
    const before = [s.raw(SLOT_KEYS[0]), s.raw(SLOT_KEYS[1])];
    const store = createProgressStore(s);
    expect(store.lastLoad().status).toBe('corrupt');

    store.update(addStat('q1'));
    store.update(addStat('q2'));
    expect([s.raw(SLOT_KEYS[0]), s.raw(SLOT_KEYS[1])]).toEqual(before);
    expect(Object.keys(store.get().questions)).toEqual(['q1', 'q2']);

    expect(store.tryAgain().status).toBe('corrupt');
    expect(store.lastLoad().status).toBe('corrupt');
    expect([s.raw(SLOT_KEYS[0]), s.raw(SLOT_KEYS[1])]).toEqual(before);
    expect(Object.keys(store.get().questions)).toEqual(['q1', 'q2']);

    const fn = vi.fn();
    store.subscribe(fn);
    const memory = store.get();
    store.startFresh();
    expect(fn).toHaveBeenCalledTimes(1);
    // What was worked on while the banner was up stays: only the unreadable slots are cleared (M1).
    expect(store.get()).toBe(memory);
    expect(store.writeBlock()).toBeNull();
    expect(store.lastLoad().status).toBe('ok');
    const saved = loadProgress(s);
    expect(saved.status).toBe('ok');
    expect(saved.seq).toBe(1);
    expect(Object.keys(saved.data.questions)).toEqual(['q1', 'q2']);

    store.update(addStat('q3'));
    const reread = loadProgress(s);
    expect(reread.status).toBe('ok');
    expect(reread.seq).toBe(2);
    expect(reread.data.questions.q3).toEqual(STAT);
    expect(createProgressStore(s).get().questions.q3).toEqual(STAT);
  });

  it('lets Try again pick up a save once the problem clears, and unblocks', () => {
    const s = garbageStorage();
    const store = createProgressStore(s);
    store.update(addStat('lost'));

    s.map.delete(SLOT_KEYS[0]);
    s.map.delete(SLOT_KEYS[1]);
    const good = addStat('kept')(defaultProgress());
    saveProgress(s, good, 1, T1);

    const fn = vi.fn();
    store.subscribe(fn);
    const r = store.tryAgain();
    expect(r.status).toBe('ok');
    expect(store.get()).toEqual(good);
    expect(fn).toHaveBeenCalledTimes(1);

    store.update(addStat('q2'));
    expect(loadProgress(s).data.questions.q2).toEqual(STAT);
  });
});

describe('resetProgress', () => {
  it('clears progress and keeps settings', () => {
    const s = new MemoryStorage();
    const full: Progress = {
      ...addStat('q1')(defaultProgress()),
      dismissedReview: ['q1'],
      notes: { lastSection: 's07', read: ['s01', 's07'] },
      quizOpen: session('open'),
      quizLast: session('last'),
      // A full v2 record: the Plan 1 fields, with the v2 fields at the defaults a v1 record loads with.
      runs: normalizeProgress({ runs: [{ id: 'r1', caseId: 'case-01', mode: 'coached', drill: false, startedAt: T1.toISOString(),
        usedMs: 1000, stepTimes: {}, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [] }] })!.runs,
      settings: { textSize: 'larger', haptics: false, answerBy: 'typing' },
    };
    saveProgress(s, full, 1, T1);
    const store = createProgressStore(s);
    expect(store.get()).toEqual(full);

    store.resetProgress();
    const p = store.get();
    expect(p.questions).toEqual({});
    expect(p.dismissedReview).toEqual([]);
    expect(p.notes).toEqual({ lastSection: null, read: [] });
    expect(p.quizOpen).toBeNull();
    expect(p.quizLast).toBeNull();
    expect(p.runs).toEqual([]);
    expect(p.settings).toEqual({ textSize: 'larger', haptics: false, answerBy: 'typing' });
    expect(createProgressStore(s).get()).toEqual(p);
  });
});

describe('generation', () => {
  it('moves on when memory is replaced wholesale, and only then', () => {
    const s = new MemoryStorage();
    const store = createProgressStore(s);
    expect(store.generation()).toBe(0);
    store.update(addStat('q1'));
    expect(store.generation()).toBe(0);

    store.resetProgress();
    expect(store.generation()).toBe(1);
    store.startFresh();   // keeps memory: it clears only what is on disk
    expect(store.generation()).toBe(1);
    expect(store.tryAgain().status).toBe('ok');   // adopts the save it reads
    expect(store.generation()).toBe(2);
  });

  it('is already new when resetProgress tells its subscribers', () => {
    const store = createProgressStore(new MemoryStorage());
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.generation()));
    store.resetProgress();
    expect(seen).toEqual([1]);
  });

  it('stays put when Try again still cannot read the save', () => {
    const store = createProgressStore(garbageStorage());
    expect(store.tryAgain().status).toBe('corrupt');
    expect(store.generation()).toBe(0);
  });

  it('stays put for Start fresh with storage out of reach, which keeps memory too', () => {
    const store = createProgressStore(null);
    store.update(addStat('q1'));
    const memory = store.get();
    store.startFresh();
    expect(store.generation()).toBe(0);
    expect(store.get()).toBe(memory);
  });
});

// Task 19 carry: Start fresh removes both slots before it saves memory as seq 1. Should that save be refused (memory
// wouldn't load back), the slots would be gone with nothing in their place, so it checks first and removes nothing.
describe('Start fresh checks what it would save first', () => {
  const badStat = (p: Progress): Progress => ({ ...p, questions: { ...p.questions, q2: { ...STAT, seen: NaN } } });

  it("removes nothing when what is in memory wouldn't load back, says why, and goes ahead once it would", () => {
    const s = garbageStorage();
    const disk = bothSlots(s);
    const store = createProgressStore(s);
    store.update(badStat);   // corrupt: held in memory, nothing written
    const fn = vi.fn();
    store.subscribe(fn);
    store.startFresh();
    expect(bothSlots(s)).toEqual(disk);
    expect(store.writeBlock()).toBe('corrupt');
    expect(store.lastLoad().status).toBe('corrupt');
    expect(store.lastSaveError()).toBe(UNSAVABLE_ERROR);
    expect(fn).toHaveBeenCalledTimes(1);

    store.update(addStat('q2'));   // the stat made good again
    store.startFresh();
    expect(store.writeBlock()).toBeNull();
    expect(store.lastSaveError()).toBeNull();
    expect(loadProgress(s)).toMatchObject({ status: 'ok', seq: 1 });
  });

  it("names a quiz or run that wouldn't load back", () => {
    const s = garbageStorage();
    const disk = bothSlots(s);
    const store = createProgressStore(s);
    const dropped = { group: 'all', topic: 'dropped-topic' } as unknown as QuizSession['filter'];   // a topic since removed
    store.update((p) => ({ ...p, quizOpen: { ...session('s1'), filter: dropped } }));
    store.startFresh();
    expect(bothSlots(s)).toEqual(disk);
    expect(store.lastSaveError()).toBe(SESSION_UNSAVABLE_ERROR);
  });
});

describe('save errors', () => {
  it('reports the error, keeps the in-memory update, never throws, and never overwrites the last good slot', () => {
    const s = new MemoryStorage();
    const store = createProgressStore(s);
    store.update(addStat('q1')); // seq 1, slot 1
    const good = s.raw(SLOT_KEYS[1]);

    s.failWrites = true;
    expect(() => store.update(addStat('q2'))).not.toThrow();
    expect(store.lastSaveError()).toEqual(expect.any(String));
    expect(store.lastSaveError()!.length).toBeGreaterThan(0);
    expect(store.get().questions.q2).toEqual(STAT);
    expect(() => store.update(addStat('q3'))).not.toThrow();
    expect(s.raw(SLOT_KEYS[1])).toBe(good);

    s.failWrites = false;
    store.update(addStat('q4'));
    expect(store.lastSaveError()).toBeNull();
    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.seq).toBe(2);
    expect(Object.keys(r.data.questions)).toEqual(['q1', 'q2', 'q3', 'q4']);
  });

  it("keeps the earlier save loading ok when updates hold data that wouldn't load back", () => {
    const s = new MemoryStorage();
    const store = createProgressStore(s);
    store.update(addStat('q1'));   // seq 1
    store.update((p) => ({ ...p, questions: { ...p.questions, q2: { ...STAT, seen: NaN } } }));
    store.update(addStat('q3'));
    expect(store.lastSaveError()).toBe(UNSAVABLE_ERROR);
    expect(store.get().questions.q3).toEqual(STAT);
    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.seq).toBe(1);
    expect(Object.keys(r.data.questions)).toEqual(['q1']);
  });

  it('keeps working in memory when storage is unavailable, and writes nothing', () => {
    const s = new MemoryStorage();
    saveProgress(s, addStat('saved')(defaultProgress()), 1, T1);
    const before = s.raw(SLOT_KEYS[1]);
    s.failReads = true;
    const store = createProgressStore(s);
    const load = store.lastLoad();
    expect(load.status === 'fresh' && load.available).toBe(false);

    expect(() => store.update(addStat('q1'))).not.toThrow();
    expect(store.get().questions.q1).toEqual(STAT);
    expect(store.lastSaveError()).toEqual(expect.any(String));
    expect(s.raw(SLOT_KEYS[1])).toBe(before);
    expect(s.raw(SLOT_KEYS[0])).toBeNull();

    const none = createProgressStore(null);
    none.update(addStat('q1'));
    expect(none.get().questions.q1).toEqual(STAT);
    expect(none.lastSaveError()).toEqual(expect.any(String));
  });
});

describe('persistOnce', () => {
  it("asks once per page load and keeps the answer, for Settings to show", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const nav = { storage: { persist } } as any;
    const first = persistOnce(nav);
    await expect(first).resolves.toBe(true);
    expect(persistOnce(nav)).toBe(first);
    expect(persistOnce()).toBe(first);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('requestPersist', () => {
  it('asks navigator.storage.persist() when present', async () => {
    await expect(requestPersist({ storage: { persist: vi.fn().mockResolvedValue(true) } } as any)).resolves.toBe(true);
  });

  it('resolves false when persist is missing or fails', async () => {
    await expect(requestPersist({} as any)).resolves.toBe(false);
    await expect(requestPersist({ storage: { persist: vi.fn().mockRejectedValue(new Error('no')) } } as any)).resolves.toBe(false);
  });
});

describe('useProgress', () => {
  it('re-renders only when the selected value changes', () => {
    const store = createProgressStore(new MemoryStorage());
    const wrapper = ({ children }: { children?: ComponentChildren }) => h(ProgressContext.Provider, { value: store }, children);
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useProgress((p) => p.questions.q1?.seen ?? 0); }, { wrapper });
    expect(result.current).toBe(0);
    const afterMount = renders;

    act(() => store.update(addStat('q1')));
    expect(result.current).toBe(1);
    expect(renders).toBe(afterMount + 1);

    act(() => store.update((p) => ({ ...p, flags: { offlineToastShown: true } })));
    expect(renders).toBe(afterMount + 1);
  });

  it('stops listening after unmount', () => {
    const store = createProgressStore(new MemoryStorage());
    let live = 0;
    const counted: ProgressStore = {
      ...store,
      subscribe(fn) { live++; const off = store.subscribe(fn); return () => { live--; off(); }; },
    };
    let renders = 0;
    const { unmount } = renderHook(() => { renders++; return useProgress((p) => p.dismissedReview.length); },
      { wrapper: provider(counted) });
    expect(live).toBe(1);
    const before = renders;
    unmount();
    expect(live).toBe(0);
    act(() => store.update((p) => ({ ...p, dismissedReview: ['q1'] })));
    expect(renders).toBe(before);
  });

  it('lets a throwing selector re-render instead of escaping update() or skipping later subscribers', () => {
    const store = createProgressStore(new MemoryStorage());
    store.update((p) => ({ ...p, quizOpen: session('open') }));
    // The child subscribes first (child effects run first) and its selector throws once quizOpen is null.
    function Child() { return h('p', null, `next ${useProgress((p) => p.quizOpen!.queue[0])}`); }
    function Parent() { return useProgress((p) => p.quizOpen !== null) ? h(Child, null) : h('p', null, 'no quiz'); }
    const { container } = render(h(Parent, null), { wrapper: provider(store) });
    expect(container.textContent).toBe('next q1');

    const later = vi.fn();
    store.subscribe(later);
    expect(() => act(() => store.update((p) => ({ ...p, quizOpen: null })))).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('no quiz');
  });
});

describe('useStore', () => {
  it('throws outside a ProgressContext.Provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useStore())).toThrow(/ProgressContext/);
    vi.restoreAllMocks();
  });
});

test('a save re-reads unchanged slots from the memo, and checks only the key that changed, so it parses JSON once, and only that key', () => {
  const storage = new MemoryStorage();
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  const parse = vi.spyOn(JSON, 'parse');
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01', 's02'] } }));
  // saveProgress checking what it is about to write: since the save before, only `notes` has changed (ruling D12)
  expect(parse).toHaveBeenCalledTimes(1);
  expect(parse).toHaveBeenCalledWith(JSON.stringify(store.get().notes));
  parse.mockRestore();
});
test('a slot another window changed is still read, and holds the save back', () => {
  const storage = new MemoryStorage();
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  const other = createProgressStore(storage);
  other.update((p) => ({ ...p, notes: { ...p.notes, read: ['s09'] } }));
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01', 's02'] } }));
  expect(store.writeBlock()).toBe('conflict');
});

// ---- Plan 3 Task 7: the quota trim (parked 7, ruling D28) --------------------------------------------------------

/** `x` with every object and array in it frozen, so an edit in place throws (store-immutable.test.tsx's). */
function deepFreeze<T>(x: T, seen = new WeakSet<object>()): T {
  if (typeof x !== 'object' || x === null || seen.has(x)) return x;
  seen.add(x);
  Object.freeze(x);
  for (const v of Object.values(x)) deepFreeze(v, seen);
  return x;
}

/** localStorage as Chrome has it once full: any write longer than `limit` characters throws its QuotaExceededError,
 *  and leaves the slot as it was. `writes` holds each write's length, whether it went in or not. */
class QuotaStorage extends MemoryStorage {
  readonly writes: number[] = [];
  constructor(public limit: number) { super(); }
  override setItem(k: string, v: string): void {
    this.writes.push(v.length);
    if (v.length > this.limit) throw new DOMException('full', 'QuotaExceededError');
    super.setItem(k, v);
  }
}

/** Run record `i`, started on day `i`, with `lines` transcript lines of its own. */
function recordWith(i: number, lines: number): RunRecord {
  const transcript = Array.from({ length: lines }, (_, n) => ({ who: 'You', text: `Run ${i}, line ${n}: arm buddy, please measure the SpO2.`, atMs: n * 1_000 }));
  const plan1 = { id: `run-${i}`, caseId: 'copd-amk-01', mode: 'coached', drill: false, startedAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
    usedMs: 1_000_000, stepTimes: {}, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript };
  return normalizeProgress({ runs: [plan1] })!.runs[0]!;
}
const twelve = () => Array.from({ length: 12 }, (_, i) => recordWith(i, 30));
const withTranscripts = (p: Progress) => p.runs.filter((r) => r.transcript.length > 0).map((r) => r.id);
/** An open run of 30 lines of the trainee's. */
function longRun(): RunSession {
  const s = blankSession('copd-amk-01');
  const said: ChatLine[] = Array.from({ length: 30 }, (_, n) => ({ who: 'you', text: `Line ${n}: buddy, please do a head grip.`, atMs: n * 1_000 }));
  return { ...s, lines: [...s.lines, ...said] };
}

describe('trimTranscripts', () => {
  it('empties every record’s transcript but the newest `keep`, in new objects, leaving the open run as it was', () => {
    const runs = twelve();
    const open = longRun();
    const p = deepFreeze({ ...defaultProgress(), runs, runOpen: open });
    const t = trimTranscripts(p, RUN_LIMITS.transcriptsOnQuota);
    expect(RUN_LIMITS.transcriptsOnQuota).toBe(3);
    expect(withTranscripts(t)).toEqual(['run-9', 'run-10', 'run-11']);
    expect(t.runs.map((r) => r.id)).toEqual(runs.map((r) => r.id));
    expect(t.runs[0]).toEqual({ ...runs[0], transcript: [] });
    expect(t).not.toBe(p);
    expect(t.runs).not.toBe(p.runs);
    expect(t.runs[11]).toBe(runs[11]);   // a record kept whole is the same object
    expect(t.runOpen).toBe(open);
    expect(t.questions).toBe(p.questions);
    expect(runs.every((r) => r.transcript.length === 30)).toBe(true);
  });

  it('returns the progress itself when there is nothing to empty', () => {
    const p = { ...defaultProgress(), runs: [recordWith(0, 0), recordWith(1, 30), recordWith(2, 30), recordWith(3, 30)] };
    expect(trimTranscripts(p, 3)).toBe(p);
    const few = { ...defaultProgress(), runs: [recordWith(0, 30)] };
    expect(trimTranscripts(few, 3)).toBe(few);
  });
});

describe('the quota trim', () => {
  it('saves a write over the quota by keeping transcripts on only the newest 3 records, silently, and tells subscribers', () => {
    const s = new QuotaStorage(20_000);
    const store = createProgressStore(s);
    const open = longRun();
    store.update((p) => ({ ...p, runOpen: open }));   // seq 1
    expect(store.lastSaveError()).toBeNull();
    const seen: Progress[] = [];
    store.subscribe((p) => seen.push(p));
    const runs = twelve();
    // the probe: the save in full is over the quota, and the trimmed one under it
    expect(JSON.stringify({ ...store.get(), runs }).length).toBeGreaterThan(20_000);
    expect(JSON.stringify(trimTranscripts({ ...store.get(), runs }, 3)).length).toBeLessThan(19_000);

    store.update((p) => ({ ...p, runs }));
    expect(store.lastSaveError()).toBeNull();
    expect(withTranscripts(store.get())).toEqual(['run-9', 'run-10', 'run-11']);
    expect(store.get().runs).toHaveLength(12);
    expect(store.get().runOpen).toBe(open);
    expect(store.get().runOpen!.lines).toEqual(open.lines);
    expect(seen).toHaveLength(1);   // once, with the trimmed data
    expect(seen[0]).toBe(store.get());
    expect(s.writes.slice(1).map((n) => n > 20_000)).toEqual([true, false]);   // over the quota once, then the trimmed save

    const loaded = loadProgress(s);
    expect(loaded.status).toBe('ok');
    expect(loaded.seq).toBe(2);
    expect(withTranscripts(loaded.data)).toEqual(['run-9', 'run-10', 'run-11']);
    expect(loaded.data.runOpen).toEqual(open);
  });

  it('a storage that always throws gives the save error as before: one retry, memory kept, the good slot untouched', () => {
    const s = new QuotaStorage(Infinity);
    const store = createProgressStore(s);
    store.update(addStat('q1'));   // seq 1, slot 1
    const good = s.raw(SLOT_KEYS[1]);
    s.limit = 0;
    const before = s.writes.length;
    expect(() => store.update((p) => ({ ...p, runs: twelve() }))).not.toThrow();
    expect(store.lastSaveError()).toContain('full');   // App toasts SAVE_ERROR for it
    expect(s.writes.length - before).toBe(2);
    expect(s.raw(SLOT_KEYS[1])).toBe(good);
    expect(s.raw(SLOT_KEYS[0])).toBeNull();
    expect(store.get().runs).toHaveLength(12);
    const r = loadProgress(s);
    expect(r.status).toBe('ok');
    expect(r.seq).toBe(1);

    s.limit = Infinity;   // room again: the next save goes into the slot that failed, as seq 2
    store.update(addStat('q2'));
    expect(store.lastSaveError()).toBeNull();
    expect(loadProgress(s).seq).toBe(2);
  });

  it('tries once only when the trim has nothing to empty', () => {
    const s = new QuotaStorage(Infinity);
    const store = createProgressStore(s);
    s.limit = 0;
    store.update((p) => ({ ...p, runs: [recordWith(0, 30)] }));
    expect(s.writes).toHaveLength(1);
    expect(store.lastSaveError()).toContain('full');
    expect(withTranscripts(store.get())).toEqual(['run-0']);
  });

  it('trims nothing for a failure that is not the quota', () => {
    const s = new MemoryStorage();
    const store = createProgressStore(s);
    s.failWrites = true;   // a plain Error
    store.update((p) => ({ ...p, runs: twelve() }));
    expect(store.lastSaveError()).toEqual(expect.any(String));
    expect(withTranscripts(store.get())).toHaveLength(12);
  });

  it('never trims progress edited in place: the trim builds fresh objects over a frozen save', () => {
    const s = new QuotaStorage(20_000);
    const store = createProgressStore(s);
    store.update((p) => ({ ...p, runOpen: longRun() }));
    deepFreeze(store.get());
    const runs = deepFreeze(twelve());
    expect(() => store.update((p) => ({ ...p, runs }))).not.toThrow();
    expect(store.lastSaveError()).toBeNull();
    expect(withTranscripts(store.get())).toHaveLength(3);
  });
});

// The in-memory progress store every screen reads and updates. It saves through the two slots after each
// update, and holds writes back while the save on disk can't be read (corrupt), storage can't be reached,
// another window has saved newer progress, or a newer version of the app has saved.
import { RUN_LIMITS, defaultProgress, trimTranscripts, type Progress } from './types';
import { SLOT_KEYS, checkSavable, createSlotMemo, loadProgress, saveProgress, savedOnDisk, type LoadResult, type SlotStorage } from './slots';

/** Why writes are held back, if they are:
 *  - corrupt: no slot could be read; wait for Try again or Start fresh;
 *  - unavailable: writing blind could clobber saves we couldn't read;
 *  - conflict: another window saved past our seq, and our next save would overwrite its newest;
 *  - newer: a newer version of the app saved, and this one can't read that save, so it must never write over it.
 *  Only a reload ends conflict and newer. */
export type WriteBlock = 'corrupt' | 'unavailable' | 'conflict' | 'newer' | null;

export interface ProgressStore {
  get(): Progress; subscribe(fn: (p: Progress) => void): () => void;
  update(fn: (p: Progress) => Progress): void;      // immutable; notifies; saves unless blocked (over the quota, trimmed)
  lastLoad(): LoadResult; lastSaveError(): string | null;
  /** Why writes are held back now, or null when they aren't. */
  writeBlock(): WriteBlock;
  /** Reads the slots for a save made elsewhere since (another window's, a newer version's) and holds writes back if
   *  there is one, telling subscribers. Never writes. App calls it on another window's storage event. */
  recheck(): void;
  tryAgain(): LoadResult; startFresh(): void; resetProgress(): void;   // reset keeps settings
  /** Counts the times memory was replaced wholesale: resetProgress, and a tryAgain that adopted a load.
   *  Anything held against the old progress (Today's Undo for a discarded quiz) compares it and lapses. */
  generation(): number;
}

const UNAVAILABLE = "Storage isn't available on this phone.";
/** `lastSaveError()` once another window (say the installed app and a Chrome tab) has saved newer progress. */
export const ANOTHER_WINDOW_ERROR = 'Your progress changed in another window. Reload this one to keep going.';
/** `lastSaveError()` once a newer version of the app has saved: this window still runs the older one. */
export const NEWER_VERSION_ERROR = 'This copy of EMTNotes is out of date. Reload to update.';
/** App's toast for any other save failure (storage full or blocked, a torn write). A refusal (UNSAVABLE_ERROR,
 *  SESSION_UNSAVABLE_ERROR) is toasted as it is. Here, in a module with no Preact, so the e2e specs import it too. */
export const SAVE_ERROR = "Progress couldn't be saved on this phone. It's kept until you close the app.";

const RELOAD_ERRORS = { conflict: ANOTHER_WINDOW_ERROR, newer: NEWER_VERSION_ERROR } as const;

/** Each save after an update is timed as this User Timing measure; Task 20's save budget profile reads it. The start
 *  mark is cleared once measured, so marks don't pile up over a session; the measures stay for Task 20. */
const SAVE_MEASURE = 'crewleader:save';
const SAVE_MARK = 'crewleader:save:start';
/** `performance`, where it has User Timing's measure (and clearMarks, to tidy up after it). */
const timing = (): Performance | null =>
  typeof performance !== 'undefined' && typeof performance.measure === 'function' && typeof performance.clearMarks === 'function'
    ? performance : null;

const blockFor = (r: LoadResult): WriteBlock =>
  r.status === 'corrupt' ? 'corrupt'
    : r.status === 'newer' ? 'newer'
      : r.status === 'fresh' && !r.available ? 'unavailable' : null;

export function createProgressStore(storage: SlotStorage | null, now: () => Date = () => new Date()): ProgressStore {
  let load = loadProgress(storage);
  let data = load.data;
  let seq = load.seq;            // the last good save on disk; the next save is seq + 1
  let block = blockFor(load);
  let saveError: string | null = block === 'newer' ? NEWER_VERSION_ERROR : null;
  let generation = 0;
  const memo = createSlotMemo();   // what the slots held when last read or written, so an unchanged one isn't parsed again
  const subs = new Set<(p: Progress) => void>();

  const notify = () => { for (const fn of [...subs]) fn(data); };

  /**
   * Holds writes back when the slots hold a save this store didn't make and must not write over: a newer version's
   * (newer), or another window's past our seq (conflict). After a corrupt load any readable save is another window's,
   * since none was readable then. Returns whether writing may go ahead.
   */
  function checkDisk(): boolean {
    if (storage === null) return false;
    const disk = savedOnDisk(storage, memo);
    const found = disk.newer ? 'newer' : disk.seq > (block === 'corrupt' ? 0 : seq) ? 'conflict' : null;
    if (found === null) return true;
    block = found;
    saveError = RELOAD_ERRORS[found];
    return false;
  }

  function persist(): void {
    if (block === 'corrupt') return;   // the corrupt banner already says so
    if (block === 'unavailable' || storage === null) { saveError = UNAVAILABLE; return; }
    if (block === 'conflict' || block === 'newer') { saveError = RELOAD_ERRORS[block]; return; }
    const perf = timing();
    perf?.mark(SAVE_MARK);
    if (checkDisk()) {
      let r = saveProgress(storage, data, seq + 1, now(), memo);
      // Over the quota: only the newest records keep their transcripts (never the open run's), in memory too, and the
      // same save is tried once more, silently (ruling D28). update() then tells subscribers of the trimmed data.
      if (!r.ok && r.quota === true) {
        const trimmed = trimTranscripts(data, RUN_LIMITS.transcriptsOnQuota);
        if (trimmed !== data) {
          data = trimmed;
          r = saveProgress(storage, data, seq + 1, now(), memo);
        }
      }
      if (r.ok) { seq += 1; saveError = null; } else saveError = r.error;   // a failed save keeps seq, so the good slot stays put
    }
    perf?.measure(SAVE_MEASURE, SAVE_MARK);
    perf?.clearMarks(SAVE_MARK);
  }

  /** Adopts a usable load: memory, seq and the unblocked state all follow it. */
  function adopt(r: LoadResult): void {
    generation += 1;
    load = r;
    data = r.data;
    seq = r.seq;
    block = null;
    saveError = null;
  }

  function update(fn: (p: Progress) => Progress): void {
    const next = fn(data);
    if (next === data) return;   // returning the same object means nothing changed
    data = next;
    persist();
    notify();
  }

  return {
    get: () => data,

    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },

    update,

    lastLoad: () => load,
    generation: () => generation,
    lastSaveError: () => saveError,
    writeBlock: () => block,

    recheck() {
      if (storage === null || block === 'unavailable' || block === 'newer') return;   // nothing to read, or nothing stronger to find
      const before = block;
      if (!checkDisk() && block !== before) notify();
    },

    // Re-reads the slots. A usable result replaces memory and unblocks; otherwise memory and the block stay.
    tryAgain() {
      const r = loadProgress(storage);
      const next = blockFor(r);
      if (next === null) {
        adopt(r);
        notify();
      } else {
        load = r;
        block = next;
        if (next === 'newer') {
          saveError = NEWER_VERSION_ERROR;
          notify();
        }
      }
      return r;
    },

    // Drops both slots and saves what is in memory as seq 1, so the next load reads `ok` (a leftover garbage slot
    // would count as newer and read `restored`). Memory began as the defaults when no slot could be read, so work
    // done since stays (M1). Never clears a save another window or a newer version has made since the load. And
    // never clears anything when that save would be refused (memory wouldn't load back): the slots would be gone with
    // nothing in their place. Then the block stays, and lastSaveError says why.
    startFresh() {
      if (block === 'conflict' || block === 'newer') return;
      if (storage === null || block === 'unavailable') {
        load = { status: 'fresh', data, seq: 0, available: false };
        notify();
        return;
      }
      if (!checkDisk()) {
        notify();
        return;
      }
      const refused = checkSavable(data);
      if (refused !== null) {
        saveError = refused;
        notify();
        return;
      }
      for (const key of SLOT_KEYS) {
        try { storage.removeItem(key); } catch { /* the seq 1 save below reports any storage failure */ }
      }
      const r = saveProgress(storage, data, 1, now(), memo);
      load = r.ok ? { status: 'ok', data, seq: 1, savedAt: r.savedAt } : { status: 'fresh', data, seq: 0, available: true };
      seq = load.seq;
      block = null;
      saveError = r.ok ? null : r.error;
      notify();
    },

    resetProgress() {
      generation += 1;   // before update(), so its subscribers already see the new generation
      update((p) => ({ ...defaultProgress(), settings: p.settings, flags: p.flags }));   // flags are app state, not progress
    },
  };
}

/** `window.localStorage`, or null when reaching it throws (blocked cookies, some private modes) or there is no window. */
export function safeLocalStorage(): SlotStorage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

let persisting: Promise<boolean> | null = null;

/** requestPersist() once per page load, with its answer kept: index.ts asks at start-up, and Settings shows the
 *  answer (Android Chrome grants it to an installed app). Later calls return the same promise. */
export function persistOnce(nav?: Navigator): Promise<boolean> {
  persisting ??= requestPersist(nav);
  return persisting;
}

/** Asks the browser to keep this site's storage under pressure. False when unsupported, refused or failing. */
export async function requestPersist(nav?: Navigator): Promise<boolean> {
  try {
    const n = nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
    const storage = n?.storage as StorageManager | undefined;
    if (typeof storage?.persist !== 'function') return false;
    return (await storage.persist()) === true;
  } catch {
    return false;
  }
}

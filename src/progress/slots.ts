// Two alternating localStorage slots, so a failed or torn write never destroys the last good save.
// Pure TS with no window or DOM access, so the Playwright seed helper can import it in Node.
import { SCHEMA_VERSION, defaultProgress, normalizeProgress, type Progress } from './types';

export interface SlotStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const SLOT_KEYS = ['crewleader.save.0', 'crewleader.save.1'] as const;

/** `newer`: a slot holds a save from a newer version of the app (a higher `v`). This build can't read it and must
 *  never write over it, so the store holds every write back; `data` and `seq` are the best good slot's, if any. */
export type LoadResult =
  | { status: 'fresh'; data: Progress; seq: 0; available: boolean }
  | { status: 'ok' | 'restored'; data: Progress; seq: number; savedAt: string }
  | { status: 'corrupt'; data: Progress; seq: number }
  | { status: 'newer'; data: Progress; seq: number };

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as 8 lowercase hex digits. An indexed loop, not for…of: the array
 *  iterator costs about 4× as much on a throttled phone, and every save checksums the whole progress (Task 20, ruling
 *  D12 amended: same bytes, same hash). */
export function checksum(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const slotFor = (seq: number) => SLOT_KEYS[seq % 2] as (typeof SLOT_KEYS)[number];

/** The sessions a failed check turns into null on load, instead of failing the whole save. */
const SESSION_KEYS = ['quizOpen', 'quizLast', 'runOpen'] as const;

/** What one slot holds. An unreadable slot has a `rank`: its seq when that is readable, else Infinity,
 *  so a slot too broken to date always counts as newer than the good one. A newer version's save ranks the same way. */
type Slot =
  | { kind: 'empty' }
  | { kind: 'good'; seq: number; savedAt: string; data: Progress }
  | { kind: 'bad'; rank: number }
  | { kind: 'newer'; rank: number };

const isSeq = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 1;

function readSlot(raw: string | null, index: 0 | 1): Slot {
  if (raw === null) return { kind: 'empty' };
  try {
    const env: unknown = JSON.parse(raw);
    if (typeof env !== 'object' || env === null || Array.isArray(env)) return { kind: 'bad', rank: Infinity };
    const { v, seq, savedAt, sum, data } = env as Record<string, unknown>;
    // A newer version's save, in whichever slot and whatever else its envelope holds: this build reads none of it,
    // and only has to know it is there, so that nothing is ever written over it.
    if (typeof v === 'number' && Number.isInteger(v) && v > SCHEMA_VERSION) {
      return { kind: 'newer', rank: isSeq(seq) ? seq : Infinity };
    }
    if (!isSeq(seq)) return { kind: 'bad', rank: Infinity };

    const bad: Slot = { kind: 'bad', rank: seq };
    // A seq outside its own slot isn't one this code wrote; trusting it would let the next save overwrite it.
    if (seq % 2 !== index) return bad;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return bad;
    if (typeof savedAt !== 'string' || typeof sum !== 'string') return bad;
    if (data === undefined || checksum(JSON.stringify(data)) !== sum) return bad;
    const progress = normalizeProgress(data);
    if (progress === null) return bad;
    return { kind: 'good', seq, savedAt, data: progress };
  } catch {
    // Unparseable JSON, or data nested too deep for JSON.stringify to re-check: too broken to date.
    return { kind: 'bad', rank: Infinity };
  }
}

/** Remembers what each slot last held and what it read as, so an unchanged slot costs a getItem and a string compare;
 *  and the progress saveProgress last found savable, so a save checks again only what has changed since. */
export interface SlotMemo { readonly kind: 'memo' }      // opaque

/** What savedOnDisk reads of a slot: its kind, and a good slot's seq or an unreadable or newer slot's rank. The
 *  parsed progress is left out, so the memo never keeps a copy of it. */
type SlotHead = Exclude<Slot, { kind: 'good' }> | { kind: 'good'; seq: number };
const headOf = (slot: Slot): SlotHead => (slot.kind === 'good' ? { kind: 'good', seq: slot.seq } : slot);

class Memo implements SlotMemo {
  readonly kind = 'memo';
  /** Per slot key: the last string seen there (null for empty) and the head of what readSlot made of it. */
  readonly seen = new Map<string, { raw: string | null; head: SlotHead }>();
  /** The progress saveProgress last found savable: each of its top-level values loads back. The store's updates are
   *  immutable, so a value still the same object is unchanged, and needn't be checked again (ruling D12). */
  checked: Progress | null = null;
}

export function createSlotMemo(): SlotMemo {
  return new Memo();
}

const memoOf = (memo: SlotMemo | undefined): Memo | undefined => (memo instanceof Memo ? memo : undefined);

/** readSlot over what slot `index` holds now, skipped when that is the very string the memo saw there last. Any other
 *  string is read afresh, so another window's save and a newer build's save are still seen. getItem may throw. */
function readSlotAt(storage: SlotStorage, index: 0 | 1, memo: Memo | undefined): SlotHead {
  const key = SLOT_KEYS[index];
  const raw = storage.getItem(key);
  const seen = memo?.seen.get(key);
  if (seen !== undefined && seen.raw === raw) return seen.head;
  const head = headOf(readSlot(raw, index));
  memo?.seen.set(key, { raw, head });
  return head;
}

/** Reads both slots and keeps the readable one with the highest seq. A newer version's save in either slot makes the
 *  load `newer`, whatever the other slot holds. Never writes. */
export function loadProgress(storage: SlotStorage | null): LoadResult {
  const unavailable: LoadResult = { status: 'fresh', data: defaultProgress(), seq: 0, available: false };
  if (storage === null) return unavailable;

  let raws: [string | null, string | null];
  try {
    raws = [storage.getItem(SLOT_KEYS[0]), storage.getItem(SLOT_KEYS[1])];
  } catch {
    return unavailable;
  }

  const slots = [readSlot(raws[0], 0), readSlot(raws[1], 1)];
  let best: Extract<Slot, { kind: 'good' }> | null = null;
  let newestBad = -Infinity;
  for (const slot of slots) {
    if (slot.kind === 'good' && (best === null || slot.seq > best.seq)) best = slot;
    if (slot.kind === 'bad') newestBad = Math.max(newestBad, slot.rank);
  }

  if (slots.some((s) => s.kind === 'newer')) {
    return best === null ? { status: 'newer', data: defaultProgress(), seq: 0 } : { status: 'newer', data: best.data, seq: best.seq };
  }
  if (best !== null) {
    const status = newestBad > best.seq ? 'restored' : 'ok';
    return { status, data: best.data, seq: best.seq, savedAt: best.savedAt };
  }
  if (slots.every((s) => s.kind === 'empty')) return { status: 'fresh', data: defaultProgress(), seq: 0, available: true };
  return { status: 'corrupt', data: defaultProgress(), seq: Number.isFinite(newestBad) ? newestBad : 0 };
}

/** What the slots on disk hold now: the highest seq among the good slots and any newer version's save, and whether a
 *  newer version's save is there. The store checks it before each save, so a stale window never overwrites a newer
 *  window's saves, and an older build never overwrites a newer build's. Nothing readable, or reading that throws, is
 *  `{ seq: 0, newer: false }`. With a memo, a slot holding what it held last time isn't parsed again. */
export function savedOnDisk(storage: SlotStorage, memo?: SlotMemo): { seq: number; newer: boolean } {
  const m = memoOf(memo);
  try {
    let seq = 0;
    let newer = false;
    SLOT_KEYS.forEach((_, i) => {
      const slot = readSlotAt(storage, i as 0 | 1, m);
      if (slot.kind === 'good') seq = Math.max(seq, slot.seq);
      if (slot.kind === 'newer') {
        newer = true;
        seq = Math.max(seq, slot.rank);
      }
    });
    return { seq, newer };
  } catch {
    return { seq: 0, newer: false };
  }
}

/** The highest seq among the good slots and any newer version's save on disk (savedOnDisk's `seq`). */
export function newestSavedSeq(storage: SlotStorage): number {
  return savedOnDisk(storage).seq;
}

/** saveProgress's error for progress that wouldn't load back (its own load would reject it), in the trainee's words:
 *  App toasts it as it is. Memory keeps the progress. */
export const UNSAVABLE_ERROR = "Your progress couldn't be saved because of a problem with it. It's kept until you close the app.";
/** saveProgress's error for an open quiz or run (or the last quiz) that wouldn't load back, though the rest would. */
export const SESSION_UNSAVABLE_ERROR =
  "Your progress couldn't be saved because of a problem with the quiz or run in progress. It's kept until you close the app.";

/** Why the progress serialised as `json` can't be saved, or null when it can. JSON turns NaN, Infinity and undefined
 *  array items into null, and a value outside a picklist fails too. A session that fails its own check loads back as
 *  null while the rest loads, so it gets its own check: saving it would put no session where the older slot may hold
 *  the last good one.
 *  With `checked`, progress already found savable, only the top-level keys whose value has changed since are checked,
 *  each through its own JSON (ruling D12: the run is saved after every line, and a line changes only `runOpen`). The
 *  schema checks each top-level key on its own, so the keys left as they were load back as they did. */
function refusal(data: Progress, json: string, checked: Progress | null = null): string | null {
  let loadsAs: Progress | null;
  let keys: readonly (keyof Progress)[];
  if (checked === null) {
    loadsAs = normalizeProgress(JSON.parse(json));
    keys = SESSION_KEYS;
  } else {
    const all = new Set([...Object.keys(data), ...Object.keys(checked)] as (keyof Progress)[]);
    keys = [...all].filter((k) => data[k] !== checked[k]);
    const raw: Record<string, unknown> = {};
    for (const k of keys) {
      const piece = JSON.stringify(data[k]);   // undefined for a key gone, which JSON leaves out
      if (piece !== undefined) raw[k] = JSON.parse(piece);
    }
    loadsAs = normalizeProgress(raw);
  }
  if (loadsAs === null) return UNSAVABLE_ERROR;
  if (SESSION_KEYS.some((k) => keys.includes(k) && data[k] !== null && loadsAs[k] === null)) return SESSION_UNSAVABLE_ERROR;
  return null;
}

/** saveProgress's own check, without saving: why `data` would be refused, or null when it would save. The store's
 *  Start fresh asks first, since it removes both slots before it saves. Never throws. */
export function checkSavable(data: Progress): string | null {
  try {
    return refusal(data, JSON.stringify(data));
  } catch (e) {
    return e instanceof Error && e.message ? e.message : String(e) || 'Save failed.';
  }
}

/** Whether `e`, thrown by setItem, says storage is over its quota: a DOMException named QuotaExceededError (Chrome's)
 *  or NS_ERROR_DOM_QUOTA_REACHED (older Firefox's), or with the legacy code 22. A plain Error never is. */
function isQuotaError(e: unknown): boolean {
  if (typeof DOMException === 'undefined' || !(e instanceof DOMException)) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22;
}

const failure = (e: unknown): string => (e instanceof Error && e.message ? e.message : String(e) || 'Save failed.');

/** Writes `data` as save `seq` into slot `seq % 2`, then reads it back. The caller passes the last good seq + 1,
 *  so the newest good slot is never the one written. A memo records the text written and what it reads as, and the
 *  progress found savable, so the next save with it checks only the top-level keys changed since (ruling D12).
 *  `quota`: setItem threw because storage is full, so a smaller save may still fit (the store trims transcripts and
 *  tries once more, ruling D28). Never throws. */
export function saveProgress(storage: SlotStorage, data: Progress, seq: number, now: Date, memo?: SlotMemo):
  { ok: true; savedAt: string } | { ok: false; error: string; quota?: true } {
  if (!isSeq(seq)) return { ok: false, error: `Save number ${seq} isn't a whole number from 1.` };
  try {
    const savedAt = now.toISOString();
    const json = JSON.stringify(data);
    // Refuse a save its own load would reject before it replaces anything, so the older slot survives.
    const m = memoOf(memo);
    const refused = refusal(data, json, m?.checked ?? null);
    if (refused !== null) return { ok: false, error: refused };
    if (m !== undefined) m.checked = data;
    // The same string JSON.stringify({ v, seq, savedAt, sum, data }) gives, without serialising data twice.
    const text = `{"v":${SCHEMA_VERSION},"seq":${seq},"savedAt":${JSON.stringify(savedAt)},"sum":"${checksum(json)}","data":${json}}`;
    const key = slotFor(seq);
    try {
      storage.setItem(key, text);
    } catch (e) {
      // A setItem that throws leaves the slot as it was.
      return isQuotaError(e) ? { ok: false, error: failure(e), quota: true } : { ok: false, error: failure(e) };
    }
    if (storage.getItem(key) !== text) return { ok: false, error: `Save ${seq} didn't read back the same.` };
    // What readSlot would make of `text`, which is now exactly what the slot holds.
    m?.seen.set(key, { raw: text, head: { kind: 'good', seq } });
    return { ok: true, savedAt };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}

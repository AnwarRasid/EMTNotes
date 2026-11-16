// The smart tester's settings (Plan 3 Task 9, ruling D16): whether it is on, the trainee's own Claude API key, the
// model, and what it has spent. They live in localStorage under `crewleader.smart`, outside the two-slot save, so the key
// never rides in Progress: Reset progress keeps them, and Remove key clears the key. Every screen that reads them in
// this tab sees each change as it is made, and a change another window saves arrives by the 'storage' event.
import { useEffect, useState } from 'preact/hooks';
import * as v from 'valibot';
import type { SmartUsage } from '../sim/smart';

export const SMART_STORAGE_KEY = 'crewleader.smart';

export type SmartModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
/** The models Settings offers (D13), Opus first as the default. US$ per million tokens, from the claude-api skill's
 *  model table (cached 2026-11-03). */
export const SMART_MODELS: readonly { id: SmartModelId; label: string; sub: string; inPerM: number; outPerM: number }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', sub: 'Most careful. The default.', inPerM: 4, outPerM: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', sub: 'Faster, about half the cost.', inPerM: 2, outPerM: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', sub: 'Fastest and cheapest.', inPerM: 0.1, outPerM: 0.5 },
];

export interface SmartSettings { on: boolean; key: string | null; model: SmartModelId; checks: number; spentUsd: number }
export const DEFAULT_SMART: SmartSettings = { on: false, key: null, model: 'claude-opus-5-5', checks: 0, spentUsd: 0 };

/** What the settings are read from and written to: localStorage, or a stand-in with the same two calls. */
export type SmartStorage = Pick<Storage, 'getItem' | 'setItem'>;

const count = v.pipe(v.number(), v.finite(), v.minValue(0));
const MODEL_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const satisfies readonly SmartModelId[];
// Each field optional, so a save missing one reads whole; any field of the wrong type makes the whole save unreadable.
const SmartSchema = v.object({
  on: v.optional(v.boolean(), DEFAULT_SMART.on),
  key: v.optional(v.nullable(v.string()), DEFAULT_SMART.key),
  model: v.optional(v.picklist(MODEL_IDS), DEFAULT_SMART.model),
  checks: v.optional(count, DEFAULT_SMART.checks),
  spentUsd: v.optional(count, DEFAULT_SMART.spentUsd),
});
type _SchemaMirrorsSettings = [SmartSettings] extends [v.InferOutput<typeof SmartSchema>]
  ? ([v.InferOutput<typeof SmartSchema>] extends [SmartSettings] ? true : never) : never;
const _mirrors: _SchemaMirrorsSettings = true;   // tsc fails here when the schema and the interface part ways
void _mirrors;

/** `window.localStorage`, or null where reaching it throws or there is no window. */
function localStore(): SmartStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved settings, or undefined when there is no storage to read or reading it throws. */
function readStored(storage: SmartStorage | null): SmartSettings | undefined {
  if (storage === null) return undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(SMART_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return { ...DEFAULT_SMART };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_SMART };
    const result = v.safeParse(SmartSchema, parsed);
    return result.success ? result.output : { ...DEFAULT_SMART };
  } catch {
    return { ...DEFAULT_SMART };
  }
}

/**
 * The saved settings, each missing field taking DEFAULT_SMART's value, so `{ on: true, key: 'sk-ant-x' }` reads whole.
 * A field of the wrong type, JSON that won't parse, or storage that throws or isn't there reads as DEFAULT_SMART.
 * `storage` defaults to localStorage.
 */
export function readSmart(storage: SmartStorage | null = localStore()): SmartSettings {
  return readStored(storage) ?? { ...DEFAULT_SMART };
}

/** Saves `s`; false when there is no storage or it refuses the write (full or blocked). */
export function writeSmart(s: SmartSettings, storage: SmartStorage | null = localStore()): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(SMART_STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** Whether the smart tester checks lines: on, with a key. */
export function smartReady(s: SmartSettings): boolean {
  return s.on && s.key !== null;
}

/** `s` with one more check, and its usage priced at `model`'s rates added to the spend: the model that answered (Task 9
 *  review M6), which is the chosen one unless it was changed while the check was out. */
export function withSpend(s: SmartSettings, u: SmartUsage, model: SmartModelId = s.model): SmartSettings {
  const m = SMART_MODELS.find((x) => x.id === model) ?? SMART_MODELS[0]!;
  const usd = (u.inputTokens * m.inPerM + u.outputTokens * m.outPerM) / 1_000_000;
  return { ...s, checks: s.checks + 1, spentUsd: s.spentUsd + usd };
}

// ---- The settings in this tab ----------------------------------------------------------------------------------

/** This tab's settings, as last read or saved: what the screens show, and what a change starts from when storage can't
 *  be read. */
let shared: SmartSettings | null = null;
const listeners = new Set<(s: SmartSettings) => void>();

function tell(s: SmartSettings): void {
  shared = s;
  for (const fn of [...listeners]) fn(s);
}

/**
 * The settings changed by `fn`, saved, and told to every screen reading them; true once saved. Each change starts from
 * what is saved now, so a change another window saved whose 'storage' event hasn't arrived yet is kept: a check's spend
 * never writes back a key another window removed (Task 9 review M3). A change storage refuses (full or blocked) changes
 * nothing, here or there, and returns false, so Settings can say so: a key is never shown as saved when it isn't.
 */
function updateSmart(fn: (s: SmartSettings) => SmartSettings): boolean {
  const next = fn(readStored(localStore()) ?? shared ?? { ...DEFAULT_SMART });
  if (!writeSmart(next)) return false;
  tell(next);
  return true;
}

/**
 * The settings and the way to change them: each change is saved at once and seen by every screen using them, and says
 * whether it was saved. Kept current with changes another window saves (the 'storage' event), and read from storage as
 * it mounts.
 */
export function useSmartSettings(): [SmartSettings, (fn: (s: SmartSettings) => SmartSettings) => boolean] {
  const [s, setS] = useState<SmartSettings>(() => {
    shared = readStored(localStore()) ?? shared ?? { ...DEFAULT_SMART };
    return shared;
  });
  useEffect(() => {
    listeners.add(setS);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SMART_STORAGE_KEY) return;
      tell(readSmart());
    };
    window.addEventListener('storage', onStorage);
    if (shared !== null && shared !== s) setS(shared);   // a change between the render and this effect
    return () => {
      listeners.delete(setS);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return [s, updateSmart];
}

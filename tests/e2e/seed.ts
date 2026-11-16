// Seeds saved progress into a Playwright page before the app loads: used by quiz.spec.ts, today.spec.ts, and the run,
// perf and screens specs (Task 20).
// The slot is written by saveProgress itself, against a Map, so the seed is exactly what the app's own loader reads.
// Only pure modules are imported: the progress modules and the simulator (through tests/unit/sim-helpers, which reads
// its JSON with fs and imports nothing from vitest, ruling P32) touch no window, so they run in Playwright's Node process.
// Plan 3 Task 12 adds the fakes the voice and smart tester flows need: a speech recogniser (fakeSpeech) and the smart
// tester's settings (seedSmart). Neither ever reaches a real mic or a real API: the smart flows also route every
// request to api.anthropic.com (tests/e2e/smart.spec.ts).
import type { Page } from '@playwright/test';
import {
  SCHEMA_VERSION, defaultProgress, type Progress, type QuizSession, type RunMode, type RunRecord,
} from '../../src/progress/types';
import { SLOT_KEYS, checksum, loadProgress, saveProgress, type SlotStorage } from '../../src/progress/slots';
import { startDrill } from '../../src/sim/drill';
import { fillCanonical } from '../../src/sim/replies';
import { endRun, envFor, sendLine } from '../../src/sim/run';
import { SMART_STORAGE_KEY } from '../../src/smart/settings';
import { STEPS, T0, caseById, recordOf } from '../unit/sim-helpers';

// A scripted run's open session and its record, built by the run engine itself (Tasks 10 and 17).
export { playRun, recordOf } from '../unit/sim-helpers';

/** A Map-backed SlotStorage, so saveProgress can write the slot strings without a browser. */
class MapStorage implements SlotStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
}

/** The defaults with `patch` on top, for seeding. */
export function progressWith(patch: Partial<Progress>): Progress {
  return { ...defaultProgress(), ...patch };
}

/** Set in sessionStorage once the seed is in, so it goes in once per test (each test has a fresh context). */
const SEEDED_FLAG = 'crewleader.e2e.seeded';

/**
 * Seeds `data` as save seq 1, which lives in SLOT_KEYS[1] (the loader only trusts a seq in its own slot), into
 * localStorage before any page script runs. The envelope is { v: SCHEMA_VERSION, seq: 1, savedAt, sum, data }.
 * Throws if the seed wouldn't load back, so a bad seed fails the test here rather than as a fresh start.
 * addInitScript runs on every document load, so a flag keeps it to the first: a reload then reads what the app
 * saved since, not the seed again (the app's save 3 lands in the seed's slot, which a re-seed would overwrite).
 */
export async function seed(page: Page, data: Progress): Promise<void> {
  const storage = new MapStorage();
  const saved = saveProgress(storage, data, 1, new Date());
  if (!saved.ok) throw new Error(`The seed wouldn't save: ${saved.error}`);
  const slot = storage.map.get(SLOT_KEYS[1]);
  const env = slot === undefined ? null : (JSON.parse(slot) as { v: unknown; seq: unknown; sum: unknown });
  if (env === null || env.v !== SCHEMA_VERSION || env.seq !== 1 || env.sum !== checksum(JSON.stringify(data))) {
    throw new Error(`The seed isn't save 1 in ${SLOT_KEYS[1]}.`);
  }
  if (loadProgress(storage).status !== 'ok') throw new Error("The seed wouldn't load back.");

  const slots = Object.fromEntries(storage.map);
  await page.addInitScript(({ entries, flag }: { entries: Record<string, string>; flag: string }) => {
    if (window.sessionStorage.getItem(flag) !== null) return;
    for (const [k, v] of Object.entries(entries)) window.localStorage.setItem(k, v);
    window.sessionStorage.setItem(flag, '1');
  }, { entries: slots, flag: SEEDED_FLAG });
}

/** A fresh practice session over `ids`, in that order, with the given option orders (the rest are shuffled on load). */
export function practiceSession(ids: string[], orders: Record<string, string[]> = {}): QuizSession {
  return {
    id: 'seeded', mode: 'practice', filter: { group: 'all', topic: 'all' }, startedAt: new Date().toISOString(),
    total: ids.length, queue: [...ids], orders, picked: null, checked: null, done: [],
  };
}

// ---- Scripted runs (Task 20) -------------------------------------------------------------------------------------

/** Step `stepId`'s canonical line as the step list plays it for the case, with an ETA of `eta` minutes where it says one. */
export function canonicalLine(caseId: string, stepId: string, eta = 6): string {
  const step = STEPS.find((s) => s.id === stepId);
  if (step === undefined) throw new Error(`No step "${stepId}".`);
  return fillCanonical(step.canonicalLine, caseById(caseId), eta, step.mustHit);
}

/** Steps 1 to 4 (the call, the caller, preparation, the scene) as their canonical lines: a run at Approach, its clock
 *  still to start. A line said before then is read against the steps near the run's current one (Task 5), so Approach's
 *  sound-out said first is heard as the call to the caller. */
export const toApproach = (caseId: string): string[] =>
  ['respond-call', 'call-caller', 'preparation', 'scene-evaluation'].map((id) => canonicalLine(caseId, id));

export const COPD = 'copd-amk-01';
/** Mockup screen 2's run: Mdm Tan's COPD case played to step 10, Breathing, in plain lines, with two flags. The head
 *  grip asked in Approach's sound-out (Order: step 6 flagged), and a simple face mask at 6 L/min where she needs the
 *  nasal cannula (Wrong). Played 15 s apart, the clock reads 02:15 (RBS by 3:00) after the last. */
export const COPD_TO_BREATHING: readonly string[] = [
  ...toApproach(COPD),
  'Approaching casualty from the front. If you can hear me, please do not move your head. Buddy, do a head grip.',
  "Is there any catastrophic bleeding? Any hazards around the patient? Remove any hazards. Never move the patient's head.",
  canonicalLine(COPD, 'introduction'), canonicalLine(COPD, 'loc-avpu'), canonicalLine(COPD, 'delicate-spine'),
  canonicalLine(COPD, 'airway'),
  'Is there chest rise and fall? What is the rate and quality of the breathing?',
  'Arm buddy, please measure the SpO2 reading on room air.',
  'Mdm Tan, do you have any lung problems, like asthma or COPD?',
  'Buddy, simple face mask, 6 litres.',
];
export const COPD_GAP_MS = 15_000;

/** The faults a whole COPD run can be given: MOI said without "suspected" (Phrase), the head grip asked in Approach
 *  (Order), the pocket check left out of the rapid body survey (Missed). */
export interface RunFaults { moi?: boolean; grip?: boolean; pocket?: boolean }

/**
 * A whole COPD run, one line per step, each the step's canonical line, with the oxygen named (a nasal cannula at
 * 2 L/min, which is right) and the notification's ETA as the clock will have it when the line is said `gapMs` apart
 * (Approach is the fifth line, and starts the clock). With no faults it is a clean run.
 */
export function copdRunLines(gapMs: number, faults: RunFaults = {}): string[] {
  return STEPS.map((st) => {
    const eta = 20 - Math.floor((Math.max(0, st.order - 5) * gapMs) / 60_000);
    let line = canonicalLine(COPD, st.id, eta);
    if (st.id === 'scene-evaluation' && faults.moi) line = line.replace('MOI is suspected case of', 'MOI is case of');
    if (st.id === 'approach-patient' && faults.grip) {
      line = line.replace('please do not move your head.', 'please do not move your head. Buddy, do a head grip.');
    }
    if (st.id === 'rapid-body-survey' && faults.pocket) line = line.replace(/ Sir\/Ma'am, may I check your pockets[^?]*\?/, '');
    if (st.id === 'breathing') line = line.replace('the appropriate mask and flow rate based on Guidelines.', 'a nasal cannula at 2 L/min.');
    if (st.id === 'oxygen') line = line.replace('maintain or titrate the oxygen mask and flow rate based on Guidelines.', 'maintain the nasal cannula at 2 L/min.');
    return line;
  });
}

/** A whole COPD run's record (copdRunLines through recordOf, 20 s apart), under its own id and start time, in `mode`
 *  (Coached by default). */
export async function copdRecord(id: string, startedAt: string, faults: RunFaults = {}, mode: RunMode = 'coached'): Promise<RunRecord> {
  const gapMs = 20_000;
  return { ...(await recordOf(COPD, mode, copdRunLines(gapMs, faults), { gapMs })), id, startedAt };
}

/** A COPD drill's record (Plan 3 Task 12): a drill on `target` (startDrill), its steps said in a clean run's lines
 *  (copdRunLines), 20 s apart, ended 20 s after the last, under its own id and start time. */
export async function copdDrillRecord(id: string, startedAt: string, target = 'rapid-body-survey'): Promise<RunRecord> {
  const gapMs = 20_000;
  const env = envFor(STEPS, caseById(COPD));
  let s = startDrill(env, target, [], null, { id, startedAt }, T0);
  const range = s.drill;
  if (range === null) throw new Error(`No drill on "${target}".`);
  const all = copdRunLines(gapMs);
  const said = STEPS.flatMap((st, i) => (st.order >= range.from && st.order <= range.to ? [all[i]!] : []));
  for (const [i, line] of said.entries()) s = (await sendLine(env, s, line, T0 + (i + 1) * gapMs)).session;
  return endRun(env, s, T0 + (said.length + 1) * gapMs);
}

// ---- Voice and the smart tester (Plan 3 Task 12) -----------------------------------------------------------------

/**
 * An addInitScript source: a fake speech recogniser on both window.SpeechRecognition and window.webkitSpeechRecognition
 * (headless Chromium ships its own unprefixed one, which src/voice/speech.ts would take first; Task 5's report). Each
 * start() fires onstart, then, `delayMs` later (30 by default), one final onresult with the next of `transcripts`, or
 * onerror { error } when `opts.error` is given, then onend. stop() gives a pending result at once, as a real recogniser
 * gives its last final; abort() cancels a pending result, then fires onerror 'aborted' and onend. With no transcript
 * left, a listening ends with nothing heard. What it does goes into window.__fakeSpeech, in order ('start', 'result:…',
 * 'error:…', 'stop', 'abort', 'end'), for a test to read.
 * With `opts.manual` no timer runs (Task 12 review M5): the result waits for a stop(), or for the test to call
 * window.__fakeSpeechGive(), which gives the newest listening's pending result, if it still has one (an aborted
 * listening has none). So a test can assert while the fake is listening, with no race against a timer.
 */
export function fakeSpeech(transcripts: string[], opts: { error?: string; delayMs?: number; manual?: boolean } = {}): string {
  const config = JSON.stringify({ transcripts, error: opts.error ?? null, delayMs: opts.manual === true ? null : opts.delayMs ?? 30 });
  return `(() => {
  const { transcripts, error, delayMs } = ${config};
  const log = [];
  let newest = null;
  window.__fakeSpeech = log;
  window.__fakeSpeechGive = () => {
    const p = newest === null ? null : newest.pending;
    if (p !== null) { clearTimeout(p.timer); p.give(); }
  };
  class FakeSpeechRecognition {
    constructor() {
      this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
      this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null;
      this.pending = null; this.ended = false;
    }
    start() {
      log.push('start');
      setTimeout(() => { if (!this.ended && this.onstart) this.onstart(); }, 0);
      const text = error === null ? transcripts.shift() : undefined;
      const give = () => {
        this.pending = null;
        if (error !== null) {
          log.push('error:' + error);
          if (this.onerror) this.onerror({ error });
        } else if (text !== undefined) {
          log.push('result:' + text);
          const alternative = { transcript: text, confidence: 0.9 };
          const result = { 0: alternative, length: 1, isFinal: true, item: (i) => (i === 0 ? alternative : null) };
          if (this.onresult) this.onresult({ resultIndex: 0, results: { 0: result, length: 1, item: (i) => (i === 0 ? result : null) } });
        }
        this.end();
      };
      this.pending = { timer: delayMs === null ? null : setTimeout(give, delayMs), give };
      newest = this;
    }
    stop() {
      log.push('stop');
      const p = this.pending;
      if (p !== null) { clearTimeout(p.timer); p.give(); }
    }
    abort() {
      log.push('abort');
      const p = this.pending;
      this.pending = null;
      if (p !== null) clearTimeout(p.timer);
      setTimeout(() => {
        if (this.ended) return;
        if (this.onerror) this.onerror({ error: 'aborted' });
        this.end();
      }, 0);
    }
    end() {
      if (this.ended) return;
      this.ended = true;
      log.push('end');
      if (this.onend) this.onend();
    }
  }
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    Object.defineProperty(window, name, { configurable: true, writable: true, value: FakeSpeechRecognition });
  }
})();`;
}

/** Set in sessionStorage once the smart settings are in, so they go in once per test, as the progress seed does. */
const SMART_SEEDED_FLAG = 'crewleader.e2e.smartSeeded';

/**
 * Seeds the smart tester's settings (localStorage `crewleader.smart`, never progress: the key is kept apart, D16)
 * before any page script runs: on or off, the key, and the model when given. Every field left out takes its default as
 * the app reads it (readSmart). Only a made-up key ever goes in, and every request it could make is routed by the spec.
 */
export async function seedSmart(page: Page, s: { on: boolean; key: string; model?: string }): Promise<void> {
  const value = JSON.stringify(s.model === undefined ? { on: s.on, key: s.key } : { on: s.on, key: s.key, model: s.model });
  await page.addInitScript(({ key, value, flag }: { key: string; value: string; flag: string }) => {
    if (window.sessionStorage.getItem(flag) !== null) return;
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem(flag, '1');
  }, { key: SMART_STORAGE_KEY, value, flag: SMART_SEEDED_FLAG });
}

import { vi } from 'vitest';
import { SCHEMA_VERSION, RUN_LIMITS, addRunRecord, activeFaults, defaultProgress, normalizeProgress, type Progress, type QuizSession, type RunRecord, type RunSession } from '../../src/progress/types';
import { SESSION_UNSAVABLE_ERROR, SLOT_KEYS, UNSAVABLE_ERROR, checksum, loadProgress, saveProgress } from '../../src/progress/slots';
import { createProgressStore } from '../../src/progress/store';
import { MemoryStorage } from './helpers';

const AT = '2026-11-12T10:00:00.000Z';
const V1_RUN = { id: 'r1', caseId: 'copd-amk-01', mode: 'coached', drill: false, startedAt: AT, usedMs: 600_000,
  stepTimes: {}, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [{ who: 'You', text: 'Hi', atMs: null }] };
const v1Slot = (data: unknown) => {
  const json = JSON.stringify(data);
  return `{"v":1,"seq":1,"savedAt":"${AT}","sum":"${checksum(json)}","data":${json}}`;
};
const record = (n: number): RunRecord => ({ ...(normalizeProgress({ runs: [V1_RUN] })!.runs[0]!), id: `r${n}`, startedAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString() });

test('the schema version is 2, in the same two slots', () => {
  expect(SCHEMA_VERSION).toBe(2);
  expect(SLOT_KEYS).toEqual(['crewleader.save.0', 'crewleader.save.1']);
});
test('a v1 save loads under v2, its runs given the v2 defaults', () => {
  const storage = new MemoryStorage({ [SLOT_KEYS[1]]: v1Slot({ ...defaultProgress(), runs: [V1_RUN], runOpen: null }) });
  const r = loadProgress(storage);
  expect(r.status).toBe('ok');
  expect(r.data.runs[0]).toMatchObject({ id: 'r1', wrong: [], faults: [], rbsMs: null, standbyMs: null, readings: [],
    oxygen: null, record: null, drillRange: null, drillChain: [], stepsTotal: 19, reached: [], sourceRunId: null, smartLines: 0 });
});
test('the first save after a v1 load is a v2 save in the other slot', () => {
  const storage = new MemoryStorage({ [SLOT_KEYS[1]]: v1Slot(defaultProgress()) });
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  expect(JSON.parse(storage.raw(SLOT_KEYS[0])!)).toMatchObject({ v: 2, seq: 2 });
  expect(storage.raw(SLOT_KEYS[1])).toBe(v1Slot(defaultProgress()));   // the v1 save is kept as the fallback
});
test('a run in progress that fails its schema becomes null; the rest loads', () => {
  const p = normalizeProgress({ runOpen: { id: 7 }, notes: { lastSection: 's03', read: [] } });
  expect(p).not.toBeNull();
  expect(p!.runOpen).toBeNull();
  expect(p!.notes.lastSection).toBe('s03');
});
test('addRunRecord keeps the newest 50 runs and transcripts on the newest 10 only', () => {
  let p = defaultProgress();
  for (let n = 1; n <= RUN_LIMITS.runsKept + 2; n++) p = addRunRecord(p, record(n));
  expect(p.runs).toHaveLength(50);
  expect(p.runs[0]!.id).toBe('r3');
  expect(p.runs.filter((r) => r.transcript.length > 0).map((r) => r.id)).toEqual(['r43', 'r44', 'r45', 'r46', 'r47', 'r48', 'r49', 'r50', 'r51', 'r52']);
});
test('addRunRecord leaves progress as it is for a run already on record, so a double finish adds it once', () => {
  const once = addRunRecord(defaultProgress(), record(1));
  expect(addRunRecord(once, record(1))).toBe(once);
  expect(addRunRecord(once, record(2)).runs.map((r) => r.id)).toEqual(['r1', 'r2']);
});
test('a disputed point leaves every fault of that point out', () => {
  const r = { ...record(1), disputes: ['rapid-body-survey/pocket-check'], faults: [
    { kind: 'missed', point: 'rapid-body-survey/pocket-check', step: 12, label: 'Pocket check', detail: null, atMs: 170_000 },
    { kind: 'phrase', point: 'scene-evaluation/moi', step: 4, label: 'MOI', detail: null, atMs: null },
  ] } as RunRecord;
  expect(activeFaults(r).map((f) => f.point)).toEqual(['scene-evaluation/moi']);
});

/** A run in progress with every field set, the optional ones included. */
const SESSION: RunSession = {
  id: 'run-2', caseId: 'copd-amk-01', mode: 'exam', startedAt: AT,
  drill: { target: 'rapid-body-survey', from: 10, to: 12, chain: ['airway', 'rapid-body-survey'], sourceRunId: 'r1' },
  clock: { started: true, bankedMs: 120_000, runningSince: 1_762_941_600_000 },
  lastAt: 1_762_941_660_000, current: 12,
  hits: { 'scene-evaluation/moi': { line: 3, pos: 0, atMs: 45_000, during: 4, said: 'MOI is case of giddiness.',
    missing: ['case'], check: 'right', chose: 'nasal-cannula', tapped: true } },
  parts: { 'scene-evaluation/moi/case': { line: 3, pos: 7 } },
  prefilled: ['respond-call'], tapped: ['approach'],
  nudged: ['scene-evaluation/ppe'], flaggedOrder: ['scene-evaluation/moi'], disputes: ['rapid-body-survey/pocket-check'],
  played: ['scene-evaluation#0'],
  lines: [
    { who: 'you', text: 'MOI is case of giddiness.', atMs: 45_000, route: 'patient',
      flags: [{ kind: 'nudge', point: 'scene-evaluation/ppe', text: 'Say your PPE first.' }], tapped: true, smart: true },
    { who: 'armBuddy', text: 'SpO2 88% on room air.', atMs: null },
  ],
  readings: [{ key: 'spo2', value: '88%', atMs: 150_000, o2: 'RA' }, { key: 'gcs', value: '15', atMs: 155_000, o2: null }],
  oxygen: { device: 'nasal-cannula', flow: 3, atMs: 160_000, right: true },
  ecg: '4-lead',
  reassessFromMs: 300_000, reassessSets: 1, rbsMs: 161_000, standbyMs: 900_000,
  stepTimes: { 'rapid-body-survey': 150_000 },
  arrived: true, held: 4,
};

/** A finished run with every v2 field away from its default. */
const FULL_RUN: RunRecord = {
  ...record(1), mode: 'exam', drill: true, wrong: ['oxygen/device'],
  faults: [{ kind: 'wrong', point: 'oxygen/device', step: 14, label: 'O2 device', detail: 'BVM', atMs: 400_000 }],
  rbsMs: 161_000, standbyMs: 900_000,
  readings: [{ key: 'hypocount', value: '6.2', atMs: 500_000, o2: null }],
  oxygen: { device: 'bvm', flow: null, atMs: 400_000, right: false },
  record: { complaint: 'Giddiness', moi: 'Case of giddiness', oxygen: 'NC 3 L/min', ecg: '4-lead', hypocount: '6.2',
    position: 'Semi-recumbent', decision: 'Convey', sracie: ['S', 'R'], standby: [{ who: 'You', text: 'Standby.', atMs: 900_000 }] },
  drillRange: [10, 12], drillChain: ['airway', 'rapid-body-survey'], stepsTotal: 3, reached: [10, 11], sourceRunId: 'r0', smartLines: 2,
};

test('a typed run round-trips through a save: the run in progress and a full v2 record', () => {
  const storage = new MemoryStorage();
  const data: Progress = { ...defaultProgress(), runs: [FULL_RUN], runOpen: SESSION };
  expect(saveProgress(storage, data, 1, new Date(AT))).toEqual({ ok: true, savedAt: AT });
  const r = loadProgress(storage);
  expect(r.status).toBe('ok');
  expect(r.data.runOpen).toEqual(SESSION);
  expect(r.data).toEqual(data);
});

test('a run in progress saved before the arrival fields loads as not arrived, with nothing held; a held NaN loads as none', () => {
  // Task 10 post-breaker ruling: the engine counts a run past preparation as arrived (run.ts arrivedOf)
  const { arrived: _a, held: _h, ...older } = SESSION;
  expect(normalizeProgress({ runOpen: older })!.runOpen).toEqual({ ...SESSION, arrived: false, held: null });
  expect(normalizeProgress({ runOpen: { ...SESSION, arrived: 'yes' } })!.runOpen).toBeNull();
  const storage = new MemoryStorage();
  expect(saveProgress(storage, { ...defaultProgress(), runOpen: { ...SESSION, held: Number.NaN } }, 1, new Date(AT)).ok).toBe(true);
  expect(loadProgress(storage).data.runOpen?.held).toBeNull();
});

test('each save is measured as crewleader:save, and saves go on where performance.measure is missing', () => {
  performance.clearMeasures('crewleader:save');
  performance.clearMarks('crewleader:save:start');
  const storage = new MemoryStorage();
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01'] } }));
  store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s01', 's02'] } }));
  expect(performance.getEntriesByName('crewleader:save', 'measure')).toHaveLength(2);
  expect(performance.getEntriesByName('crewleader:save:start', 'mark')).toHaveLength(0);   // cleared; the measures stay

  const own = Object.getOwnPropertyDescriptor(performance, 'measure');
  Object.defineProperty(performance, 'measure', { value: undefined, configurable: true });
  try {
    expect(() => store.update((p) => ({ ...p, notes: { ...p.notes, read: ['s03'] } }))).not.toThrow();
    expect(store.lastSaveError()).toBeNull();
    expect(loadProgress(storage).data.notes.read).toEqual(['s03']);
  } finally {
    if (own) Object.defineProperty(performance, 'measure', own);
    else delete (performance as { measure?: unknown }).measure;
  }
  expect(typeof performance.measure).toBe('function');
});

// A session that fails its schema loads back as null (the rest of the save still loads), so a save holding one would
// replace the older slot's good session with none. saveProgress refuses it instead.
const SESSION_LOST = SESSION_UNSAVABLE_ERROR;

// Task 19 carry: the two refusals are said in the trainee's words, since App toasts them as they are.
test("the refusals say what happened in the trainee's words, and that the progress is kept", () => {
  expect(UNSAVABLE_ERROR).toBe("Your progress couldn't be saved because of a problem with it. It's kept until you close the app.");
  expect(SESSION_UNSAVABLE_ERROR).toBe(
    "Your progress couldn't be saved because of a problem with the quiz or run in progress. It's kept until you close the app.");
  const storage = new MemoryStorage();
  const bad = { ...defaultProgress(), questions: { q1: { seen: NaN, right: 1, lastAt: AT, lastRight: true, rightSinceWrong: null } } };
  expect(saveProgress(storage, bad, 1, new Date(AT))).toEqual({ ok: false, error: UNSAVABLE_ERROR });
  expect([storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])]).toEqual([null, null]);
});
const quiz = (topic: string) => ({ id: 'q', mode: 'practice', filter: { group: 'all', topic }, startedAt: AT, total: 1,
  queue: ['q1'], orders: {}, picked: null, checked: null, done: [] }) as QuizSession;

test('a save whose run or quiz would load back as null is refused, and the slot it would replace stays', () => {
  const storage = new MemoryStorage();
  const good: Progress = { ...defaultProgress(), runOpen: SESSION, quizOpen: quiz('all'), quizLast: quiz('all') };
  saveProgress(storage, good, 1, new Date(AT));   // slot 1
  saveProgress(storage, good, 2, new Date(AT));   // slot 0
  const slots = [storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])];
  for (const bad of [
    { ...good, runOpen: { ...SESSION, clock: { ...SESSION.clock, bankedMs: NaN } } },
    { ...good, quizOpen: quiz('dropped-topic') },
    { ...good, quizLast: quiz('dropped-topic') },
  ]) {
    expect(saveProgress(storage, bad, 3, new Date(AT))).toEqual({ ok: false, error: SESSION_LOST });   // seq 3 → slot 1
    expect([storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])]).toEqual(slots);
  }
  expect(loadProgress(storage).data).toEqual(good);

  expect(saveProgress(storage, { ...good, runOpen: { ...SESSION, current: 13 } }, 3, new Date(AT)).ok).toBe(true);
  expect(loadProgress(storage).data.runOpen).toEqual({ ...SESSION, current: 13 });
});

test('the store reports that refused save, keeps the run in memory, and saves once the run is valid again', () => {
  const storage = new MemoryStorage();
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, runOpen: SESSION }));   // seq 1
  const saved = storage.raw(SLOT_KEYS[1]);
  store.update((p) => ({ ...p, runOpen: { ...SESSION, lastAt: NaN } }));
  expect(store.lastSaveError()).toBe(SESSION_LOST);
  expect(store.get().runOpen?.lastAt).toBeNaN();
  expect([storage.raw(SLOT_KEYS[0]), storage.raw(SLOT_KEYS[1])]).toEqual([null, saved]);

  store.update((p) => ({ ...p, runOpen: { ...SESSION, current: 13 } }));
  expect(store.lastSaveError()).toBeNull();
  expect(loadProgress(storage)).toMatchObject({ status: 'ok', seq: 2 });
  expect(loadProgress(storage).data.runOpen).toEqual({ ...SESSION, current: 13 });
});

// Plan 3 Task 5: how the trainee answers, Typing or Voice, is a setting, not part of a run.
test("settings.answerBy: an older save loads as 'typing'; the default is 'typing'; a bad value is refused", () => {
  expect(defaultProgress().settings.answerBy).toBe('typing');
  expect(normalizeProgress({ settings: { textSize: 'large' } })!.settings.answerBy).toBe('typing');
  expect(normalizeProgress({ settings: { textSize: 'large', haptics: false } })!.settings)
    .toEqual({ textSize: 'large', haptics: false, answerBy: 'typing' });
  expect(normalizeProgress({ settings: { answerBy: 'voice' } })!.settings.answerBy).toBe('voice');
  expect(normalizeProgress({ settings: { answerBy: 'telepathy' } })).toBeNull();
  expect(normalizeProgress({})).toEqual(defaultProgress());
});

// Plan 3 Task 8 (D15): where smart credit came from. A line the smart tester credited is marked, and a record counts them.
test('a v2 record saved before smartLines loads with 0; a bad count is refused', () => {
  const { smartLines: _s, ...older } = FULL_RUN;
  expect(normalizeProgress({ runs: [older] })!.runs[0]!.smartLines).toBe(0);
  expect(normalizeProgress({ runs: [V1_RUN] })!.runs[0]!.smartLines).toBe(0);
  expect(normalizeProgress({ runs: [{ ...FULL_RUN, smartLines: '2' }] })).toBeNull();
});
test('a session line marked smart round-trips through normalizeProgress; any other mark makes the run null', () => {
  const marked: RunSession = { ...SESSION, lines: [{ who: 'you', text: 'Any ouch at your nape?', atMs: 50_000, route: 'To patient: neck pain', smart: true }] };
  expect(normalizeProgress(JSON.parse(JSON.stringify({ runOpen: marked })))!.runOpen).toEqual(marked);
  expect(normalizeProgress({ runOpen: { ...SESSION, lines: [{ who: 'you', text: 'x', atMs: null, smart: false }] } })!.runOpen).toBeNull();
  const unmarked = normalizeProgress({ runOpen: { ...SESSION, lines: [{ who: 'you', text: 'x', atMs: null }] } })!.runOpen!;
  expect('smart' in unmarked.lines[0]!).toBe(false);   // no default: an unmarked line stays unmarked
});

// The shape of the trainee's saved progress, its defaults, and the check that turns a parsed save back into it.
// Pure TS with no window or DOM access, so the Playwright seed helper can import it in Node.
import * as v from 'valibot';
import { OXYGEN_DEVICES, TopicSchema, VITAL_KEYS, type OxygenDevice, type Topic, type VitalKey } from '../data/schema';

export const SCHEMA_VERSION = 2;   // 1 = Plan 1 (runOpen untyped, runs never written). Never lower it.
/** `transcriptsOnQuota`: the transcripts kept once a save is over the storage quota (ruling D28; store.ts persist). */
export const RUN_LIMITS = { lineChars: 600, transcriptLines: 400, runsKept: 50, transcriptsKept: 10, transcriptsOnQuota: 3 } as const;

export type TextSize = 'standard' | 'large' | 'larger';
/** How the trainee answers in a run or drill (Plan 3 Task 5, ruling D1): typing each line, or dictating it into the field. */
export type AnswerBy = 'typing' | 'voice';
export interface QStat { seen: number; right: number; lastAt: string; lastRight: boolean; rightSinceWrong: number | null } // null = never wrong
export type QuizMode = 'practice' | 'test' | 'review';
export interface QuizFilter { group: 'all' | 'mt' | 'hmls'; topic: Topic | 'all'; ids?: string[] }
export interface AnswerRecord { qid: string; picked: string; right: boolean; at: string }
export interface QuizSession { id: string; mode: QuizMode; filter: QuizFilter; startedAt: string; total: number;
  queue: string[]; orders: Record<string, string[]>; picked: string | null; checked: AnswerRecord | null; done: AnswerRecord[] }

// ---- Runs ----------------------------------------------------------------------------------------------------

export type RunMode = 'coached' | 'exam';
export type FaultKind = 'missed' | 'wrong' | 'order' | 'phrase';
export type Speaker = 'you' | 'system' | 'opsCtr' | 'caller' | 'patient' | 'headBuddy' | 'armBuddy' | 'tester';
export type ReadingKey = VitalKey | 'hypocount' | 'gcs';   // 'spo2' | 'pr' | 'rr' | 'bp' | 'temp' | 'skin' | 'crt' | 'hypocount' | 'gcs'
export interface RunClock { started: boolean; bankedMs: number; runningSince: number | null }   // epoch ms
export interface DrillInfo { target: string; from: number; to: number; chain: string[]; sourceRunId: string | null }
export interface InlineFlag { kind: FaultKind | 'nudge'; point: string /* 'stepId/pointId' */; text: string }
// smart: the smart tester credited the line, where the keyword rules read nothing (Plan 3 D15); no default, like tapped
export interface ChatLine { who: Speaker; text: string; atMs: number | null; route?: string; flags?: InlineFlag[]; tapped?: true;
  smart?: true }
export interface PointHit { line: number; pos: number; atMs: number | null; during: number; said: string; missing: string[];
  check: 'right' | 'wrong' | 'unnamed' | null; chose: string | null; tapped?: true }
export interface PartHit { line: number; pos: number }
export interface Reading { key: ReadingKey; value: string; atMs: number | null; o2: string | null }   // o2: 'RA', 'NC'… for spo2 only
export interface OxygenGiven { device: OxygenDevice; flow: number | null; atMs: number | null; right: boolean }
export interface RunSession {
  id: string; caseId: string; mode: RunMode; startedAt: string; drill: DrillInfo | null;
  clock: RunClock; lastAt: number; current: number;
  hits: Record<string, PointHit>;          // 'stepId/pointId'
  parts: Record<string, PartHit>;          // 'stepId/pointId/partId'
  prefilled: string[]; tapped: string[];   // step ids
  nudged: string[]; flaggedOrder: string[]; disputes: string[];   // point keys
  played: string[];                        // reply keys 'stepId#index' of text replies already said
  lines: ChatLine[]; readings: Reading[]; oxygen: OxygenGiven | null; ecg: '12-lead' | '4-lead' | null;
  reassessFromMs: number | null; reassessSets: number; rbsMs: number | null; standbyMs: number | null;
  stepTimes: Record<string, number>;       // step id → clock ms when first reached (timed steps)
  // Task 10 post-breaker ruling; a session saved before them loads with these defaults
  arrived: boolean;                        // false; true once the crew has arrived, so the call is over
  held: number | null;                     // null; the index of a line held before arrival, read again on arrival by (c), (d) or (e)
}
export interface TranscriptLine { who: string; text: string; atMs: number | null }   // Plan 1's transcript entry
export interface Fault { kind: FaultKind; point: string; step: number; label: string; detail: string | null; atMs: number | null }
export interface CaseRecordFacts { complaint: string | null; moi: string | null; oxygen: string | null; ecg: string | null;
  hypocount: string | null; position: string | null; decision: string | null; sracie: string[]; standby: TranscriptLine[] }
export interface RunRecord {
  // Plan 1 fields, unchanged
  id: string; caseId: string; mode: RunMode; drill: boolean; startedAt: string; usedMs: number;
  stepTimes: Record<string, number>; missed: string[]; order: string[]; phrase: string[]; disputes: string[]; tapped: string[];
  transcript: TranscriptLine[];
  // v2; a v1 record loads with these defaults
  wrong: string[];                      // []
  faults: Fault[];                      // []
  rbsMs: number | null;                 // null
  standbyMs: number | null;             // null
  readings: Reading[];                  // []
  oxygen: OxygenGiven | null;           // null
  record: CaseRecordFacts | null;       // null
  drillRange: [number, number] | null;  // null
  drillChain: string[];                 // []
  stepsTotal: number;                   // 19
  reached: number[];                    // [] — step orders with any hit (the debrief's Call segment spikes)
  sourceRunId: string | null;           // null — a drill's DrillInfo.sourceRunId: the run its chain came from (Task 17)
  smartLines: number;                   // 0 — the trainee's lines the smart tester credited (ChatLine.smart, Plan 3 D15)
}

export interface Progress {
  questions: Record<string, QStat>; dismissedReview: string[];
  notes: { lastSection: string | null; read: string[] };
  quizOpen: QuizSession | null; quizLast: QuizSession | null;
  runs: RunRecord[];                    // oldest first; addRunRecord appends and caps them
  runOpen: RunSession | null;           // the run in progress; an invalid one falls back to null, as quizOpen does
  settings: { textSize: TextSize; haptics: boolean; answerBy: AnswerBy };
  flags: { offlineToastShown: boolean };
}

/** `p` with `r` appended: only the newest `runsKept` runs stay, and only the newest `transcriptsKept` keep their
 *  transcripts (older ones keep everything else, with the transcript emptied), so the save stays small.
 *  A run whose id is already on record returns `p` itself, so finishing a run twice adds it once. */
export function addRunRecord(p: Progress, r: RunRecord): Progress {
  if (p.runs.some((run) => run.id === r.id)) return p;
  return trimTranscripts({ ...p, runs: [...p.runs, r].slice(-RUN_LIMITS.runsKept) }, RUN_LIMITS.transcriptsKept);
}

/** `p` with every record's transcript emptied but the newest `keep` (the runs are oldest first), each one emptied a new
 *  object and the rest as they were; the open run is never touched. `p` itself when none has a transcript to empty, so
 *  the store can tell nothing changed. Never edits in place: the save re-checks only new top-level values (D12). */
export function trimTranscripts(p: Progress, keep: number): Progress {
  const keepFrom = p.runs.length - keep;
  const emptied = (r: RunRecord, i: number): boolean => i < keepFrom && r.transcript.length > 0;
  if (!p.runs.some(emptied)) return p;
  return { ...p, runs: p.runs.map((r, i) => (emptied(r, i) ? { ...r, transcript: [] } : r)) };
}

/** The run's faults whose point the trainee hasn't disputed: what the debrief and drills count. */
export function activeFaults(r: RunRecord): Fault[] {
  return r.faults.filter((f) => !r.disputes.includes(f.point));
}

export function defaultProgress(): Progress {
  return {
    questions: {}, dismissedReview: [],
    notes: { lastSection: null, read: [] },
    quizOpen: null, quizLast: null,
    runs: [], runOpen: null,
    settings: { textSize: 'standard', haptics: true, answerBy: 'typing' },
    flags: { offlineToastShown: false },
  };
}

// ---- Validation --------------------------------------------------------------------------------------------
// valibot's object and record accept arrays, so every object position goes through `obj`, which rejects them first.

const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const obj = <S extends v.GenericSchema>(schema: S) => v.pipe(v.custom<v.InferInput<S>>(isPlainObject), schema);
const dict = <S extends v.GenericSchema>(value: S) => obj(v.record(v.string(), value));
const strings = v.array(v.string());

const QStatSchema = obj(v.object({
  seen: v.number(), right: v.number(), lastAt: v.string(), lastRight: v.boolean(), rightSinceWrong: v.nullable(v.number()),
}));
const AnswerRecordSchema = obj(v.object({ qid: v.string(), picked: v.string(), right: v.boolean(), at: v.string() }));
const QuizSessionSchema = obj(v.object({
  id: v.string(),
  mode: v.picklist(['practice', 'test', 'review']),
  filter: obj(v.object({
    group: v.picklist(['all', 'mt', 'hmls']),
    topic: v.union([TopicSchema, v.literal('all')]),
    ids: v.optional(strings),
  })),
  startedAt: v.string(), total: v.number(),
  queue: strings, orders: dict(strings),
  picked: v.nullable(v.string()), checked: v.nullable(AnswerRecordSchema), done: v.array(AnswerRecordSchema),
}));
const msOrNull = v.nullable(v.number());
const RunModeSchema = v.picklist(['coached', 'exam']);
const FaultKindSchema = v.picklist(['missed', 'wrong', 'order', 'phrase']);
const READING_KEYS = [...VITAL_KEYS, 'hypocount', 'gcs'] as const;
const ReadingSchema = obj(v.object({ key: v.picklist(READING_KEYS), value: v.string(), atMs: msOrNull, o2: v.nullable(v.string()) }));
const OxygenGivenSchema = obj(v.object({ device: v.picklist(OXYGEN_DEVICES), flow: v.nullable(v.number()), atMs: msOrNull, right: v.boolean() }));
const TranscriptLineSchema = obj(v.object({ who: v.string(), text: v.string(), atMs: msOrNull }));

const RunSessionSchema = obj(v.object({
  id: v.string(), caseId: v.string(), mode: RunModeSchema, startedAt: v.string(),
  drill: v.nullable(obj(v.object({
    target: v.string(), from: v.number(), to: v.number(), chain: strings, sourceRunId: v.nullable(v.string()),
  }))),
  clock: obj(v.object({ started: v.boolean(), bankedMs: v.number(), runningSince: v.nullable(v.number()) })),
  lastAt: v.number(), current: v.number(),
  hits: dict(obj(v.object({
    line: v.number(), pos: v.number(), atMs: msOrNull, during: v.number(), said: v.string(), missing: strings,
    check: v.nullable(v.picklist(['right', 'wrong', 'unnamed'])), chose: v.nullable(v.string()), tapped: v.optional(v.literal(true)),
  }))),
  parts: dict(obj(v.object({ line: v.number(), pos: v.number() }))),
  prefilled: strings, tapped: strings,
  nudged: strings, flaggedOrder: strings, disputes: strings,
  played: strings,
  lines: v.array(obj(v.object({
    who: v.picklist(['you', 'system', 'opsCtr', 'caller', 'patient', 'headBuddy', 'armBuddy', 'tester']),
    text: v.string(), atMs: msOrNull, route: v.optional(v.string()),
    flags: v.optional(v.array(obj(v.object({ kind: v.union([FaultKindSchema, v.literal('nudge')]), point: v.string(), text: v.string() })))),
    tapped: v.optional(v.literal(true)),
    smart: v.optional(v.literal(true)),
  }))),
  readings: v.array(ReadingSchema), oxygen: v.nullable(OxygenGivenSchema), ecg: v.nullable(v.picklist(['12-lead', '4-lead'])),
  reassessFromMs: msOrNull, reassessSets: v.number(), rbsMs: msOrNull, standbyMs: msOrNull,
  stepTimes: dict(v.number()),
  // a session saved before the arrival fields loads as not yet arrived, with nothing held; the engine still counts a
  // run past preparation as arrived (run.ts arrivedOf)
  arrived: v.optional(v.boolean(), false),
  held: v.optional(v.nullable(v.number()), null),
}));

const RunRecordSchema = obj(v.object({
  id: v.string(), caseId: v.string(), mode: RunModeSchema, drill: v.boolean(),
  startedAt: v.string(), usedMs: v.number(), stepTimes: dict(v.number()),
  missed: strings, order: strings, phrase: strings, disputes: strings, tapped: strings,
  transcript: v.array(TranscriptLineSchema),
  // v2: a v1 record has none of these, and loads with the defaults.
  wrong: v.optional(strings, () => []),
  faults: v.optional(v.array(obj(v.object({
    kind: FaultKindSchema, point: v.string(), step: v.number(), label: v.string(), detail: v.nullable(v.string()), atMs: msOrNull,
  }))), () => []),
  rbsMs: v.optional(msOrNull, null),
  standbyMs: v.optional(msOrNull, null),
  readings: v.optional(v.array(ReadingSchema), () => []),
  oxygen: v.optional(v.nullable(OxygenGivenSchema), null),
  record: v.optional(v.nullable(obj(v.object({
    complaint: v.nullable(v.string()), moi: v.nullable(v.string()), oxygen: v.nullable(v.string()), ecg: v.nullable(v.string()),
    hypocount: v.nullable(v.string()), position: v.nullable(v.string()), decision: v.nullable(v.string()),
    sracie: strings, standby: v.array(TranscriptLineSchema),
  }))), null),
  drillRange: v.optional(v.nullable(v.tuple([v.number(), v.number()])), null),
  drillChain: v.optional(strings, () => []),
  stepsTotal: v.optional(v.number(), 19),
  reached: v.optional(v.array(v.number()), () => []),
  sourceRunId: v.optional(v.nullable(v.string()), null),
  smartLines: v.optional(v.number(), 0),
}));

// The run schemas mirror their interfaces both ways, so tsc fails here when a field or a picklist value is in one and
// not the other. normalizeProgress's return type alone catches only a schema wider than its interface, and a narrower
// one would turn a valid run in progress into null (which saveProgress then refuses to save).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Holds<T extends true> = T;
type _RunSchemasMirrorTheirTypes = [   // checked by tsc, never used
  Holds<Same<v.InferOutput<typeof RunSessionSchema>, RunSession>>,
  Holds<Same<v.InferOutput<typeof RunRecordSchema>, RunRecord>>,
];

// A session that fails validation (say its topic was dropped from TOPICS) becomes null rather than making the whole
// save unreadable: losing one quiz or run in progress beats a corrupt load. Every other key stays strict.
const SessionOrNull = v.optional(v.fallback(v.nullable(QuizSessionSchema), null), null);
const RunOrNull = v.optional(v.fallback(v.nullable(RunSessionSchema), null), null);

// Missing keys take their defaults at every fixed level (a missing `settings` fills in whole; a missing
// `settings.haptics` fills in alone). `normalizeProgress({})` equals `defaultProgress()`; a unit test holds them together.
const ProgressSchema = obj(v.object({
  questions: v.optional(dict(QStatSchema), () => ({})),
  dismissedReview: v.optional(strings, () => []),
  notes: v.optional(obj(v.object({
    lastSection: v.optional(v.nullable(v.string()), null),
    read: v.optional(strings, () => []),
  })), () => ({})),
  quizOpen: SessionOrNull,
  quizLast: SessionOrNull,
  runs: v.optional(v.array(RunRecordSchema), () => []),
  runOpen: RunOrNull,
  settings: v.optional(obj(v.object({
    textSize: v.optional(v.picklist(['standard', 'large', 'larger']), 'standard'),
    haptics: v.optional(v.boolean(), true),
    answerBy: v.optional(v.picklist(['typing', 'voice']), 'typing'),   // a save before Plan 3 answers by Typing
  })), () => ({})),
  flags: v.optional(obj(v.object({
    offlineToastShown: v.optional(v.boolean(), false),
  })), () => ({})),
}));

/** The parsed `data` of a save as a `Progress`, or null if it isn't an object or a known key has the wrong type.
 *  Missing keys take their defaults (a v1 run record's v2 fields too); unknown keys are dropped; an invalid
 *  `quizOpen`/`quizLast`/`runOpen` becomes null.
 *  Always returns fresh objects. */
export function normalizeProgress(raw: unknown): Progress | null {
  const result = v.safeParse(ProgressSchema, raw);
  return result.success ? result.output : null;
}

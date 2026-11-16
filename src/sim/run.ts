// The run engine: the pure reducer at the heart of a run. A trainee's line, a tap on the step list, the clock's tick, a
// pause and the end each turn the open RunSession into the next one, which the app saves after every line. It reads
// lines through the Grader seam, answers through replies.ts and leaves the end-of-run reckoning to classify.ts.
// Every number it stores stays finite, because a save holding one that isn't is refused for the whole run (Task 2); a
// dev-only check throws when one slips through. Pure: no window, document or preact.
import type { Case, Reply, Step } from '../data/schema';
import {
  RUN_LIMITS, type CaseRecordFacts, type ChatLine, type InlineFlag, type OxygenGiven, type PartHit, type PointHit, type Reading,
  type RunClock, type RunMode, type RunRecord, type RunSession, type TranscriptLine,
} from '../progress/types';
import { UNNAMED_DETAIL, applicablePoints, classify, missingWordsDetail, outOfOrder, pointDone, pointKey, rankOf, type Applicable } from './classify';
import { NEW_CLOCK, elapsedMs, etaMinutes, formatMmSs, pauseClock, rbsShown, resumeClock, startClock } from './clock';
import {
  LAST_CALL_STEP, keywordGrader, lineBudget, onScene, type GradeContext, type Grader, type Heard, type LineBudget, type PointReading,
  type SentenceReading,
} from './grader';
import { allowedArms, caseSlots, matchAt, normalizeLine, splitSentences, type MatchSlots } from './match';
import { choiceAt, describeOxygen, oxygenRight, type ArmSide, type OxygenChoice } from './oxygen';
import {
  activationText, capitalise, fillCanonical, joinSigns, oneDecimal, readingsSpeech, replyText, speakerLabel, stop,
} from './replies';

export interface RunEnv { steps: Step[]; case: Case; grader: Grader }
/** A session after one input, and what the run's live region should say about it ("RBS done at 2:41."). */
export interface Applied { session: RunSession; announce: string[] }
export type StepState = 'done' | 'missed' | 'flagged' | 'now' | 'todo';

export const NOT_UNDERSTOOD = 'Not sure what this is.';
const ROUTE_SEP = ' · ';   // between a line's route pieces, one per sentence
export const UNCLEAR = "Who's this for? Tester, patient or buddy";
export const ADDRESSEE_LABEL: Record<Heard, string> = {
  opsCtr: 'Ops Ctr', caller: 'caller', patient: 'patient', headBuddy: 'head buddy', armBuddy: 'arm buddy', tester: 'tester',
  crew: 'crew', buddy: 'buddy',
};
const WRONG_TEXT = {
  oxygen: 'Wrong mask or flow for this patient. Check your oxygen guidelines.',
  ecg: 'Wrong ECG for this patient.',
  arm: 'Not on that arm. The patient ruled it out.',
} as const;

export const DRILL_ETA = 10;     // R11: drills are untimed, so the tester always gives 10 mins
const REASSESS_MS = 300_000;     // the buddies reread the vitals every 5 minutes after the reassess call
const KEY = {
  rbs: 'rapid-body-survey/rbs-regions', standby: 'notification/standby-opener', reassess: 'vital-signs/reassess-5',
  gcs: 'vital-signs/gcs', complaint: 'introduction/whats-bothering', moi: 'scene-evaluation/moi',
  decision: 'decision-point/unstable-signs', ecg: 'investigation/ecg', hypocount: 'investigation/hypocount',
  askPosition: 'position/ask-position', convince: 'position/convince', sracie: 'notification/sracie',
} as const;

/** `now` when it is a time, else `fallback`, so lastAt never takes a NaN the save would refuse. */
const stamp = (now: number, fallback: number): number => (Number.isFinite(now) ? now : fallback);
const has = <T>(r: Record<string, T>, k: string): boolean => Object.hasOwn(r, k);
const inRange = (s: RunSession, order: number): boolean => s.drill === null || (order >= s.drill.from && order <= s.drill.to);
const rangeOf = (s: RunSession): [number, number] | null => (s.drill === null ? null : [s.drill.from, s.drill.to]);
const etaAt = (s: RunSession, now: number): number => (s.drill !== null ? DRILL_ETA : etaMinutes(elapsedMs(s.clock, now)));

// ---- Dev check ------------------------------------------------------------------------------------------------

/** The path of the first number in `x` that isn't finite, or null. */
function nonFinite(x: unknown, path: string): string | null {
  if (typeof x === 'number') return Number.isFinite(x) ? null : path;
  if (x === null || typeof x !== 'object') return null;
  for (const [k, v] of Object.entries(x)) {
    const bad = nonFinite(v, `${path}.${k}`);
    if (bad !== null) return bad;
  }
  return null;
}

/**
 * The session, after a dev-only check that every number in it is finite (Task 2: one that isn't blocks every save for
 * the run). Dev builds and Vitest run it; production builds and plain Node (Playwright's seed helper, where
 * import.meta.env is undefined) skip it. Every function that makes a session ends with it (drill.ts's startDrill too).
 */
export function checked(s: RunSession): RunSession {
  if (import.meta.env?.DEV) {
    const bad = nonFinite(s, 'session');
    if (bad !== null) throw new Error(`The run session holds a number that isn't finite at ${bad}.`);
  }
  return s;
}

// ---- Points -------------------------------------------------------------------------------------------------

const INDEX = new WeakMap<RunEnv, Map<string, Applicable>>();
/** Every point that applies to the case, by 'stepId/pointId'. */
function pointsOf(env: RunEnv): Map<string, Applicable> {
  let index = INDEX.get(env);
  if (index === undefined) {
    index = new Map(applicablePoints(env.steps, env.case).map(a => [a.key, a]));
    INDEX.set(env, index);
  }
  return index;
}

/** The points classify grades: they apply to the case, lie in the drill's range, and their step was neither tapped
 *  nor prefilled. */
function gradedPoints(env: RunEnv, s: RunSession): Applicable[] {
  const ungraded = new Set([...s.tapped, ...s.prefilled]);
  return applicablePoints(env.steps, env.case, rangeOf(s)).filter(a => !ungraded.has(a.step.id));
}

/** Whether step `order` is behind the run at `current`, so a point of it still to do counts as missed there: one of the
 *  call's steps (1–2) as soon as the run is past it (the radio call's once the run is on the caller's), any other step
 *  two steps back. The step bar's 'missed' (stepStates) and the chat's nudges (nudgeDue) both read this one rule, so the
 *  bar never contradicts the nudges (Task 13 ruling). */
const behind = (order: number, current: number): boolean =>
  (order <= LAST_CALL_STEP ? order < current : order <= current - 2);

/** Whether a point of step `order` still to do is nudged with the run at `current`: once its step is behind, except
 *  the call's points after arrival. Once arrived a call sentence reads as not understood (fix round 4, NB3; the
 *  post-breaker ruling), so the call can no longer be made and its points are never nudged there; the step bar still
 *  shows them missed. */
const nudgeDue = (order: number, current: number, arrived: boolean): boolean =>
  behind(order, current) && !(arrived && order <= LAST_CALL_STEP);

/** Whether the crew has arrived (the post-breaker ruling): as the session says, or, for a session saved before it said,
 *  a run past preparation or with preparation said. Before arrival a run never gets past the call's steps. */
export function arrivedOf(env: RunEnv, s: RunSession): boolean {
  if (s.arrived || onScene(s.current)) return true;
  const prep = env.steps.find(x => x.order === LAST_CALL_STEP + 1)?.id;
  return prep !== undefined && (s.tapped.includes(prep) || s.prefilled.includes(prep)
    || Object.keys(s.hits).some(k => k.startsWith(`${prep}/`)) || Object.keys(s.parts).some(k => k.startsWith(`${prep}/`)));
}

/** A point is settled when it is done, or the trainee disputed it (R9: "Not what I meant" takes it out of the score). */
const settled = (a: Applicable, s: RunSession): boolean => pointDone(a, s) || s.disputes.includes(a.key);

// ---- Setup --------------------------------------------------------------------------------------------------

/** The run's environment; the keyword grader unless another is given (Plan 3's seam). Steps are kept in order. */
export function envFor(steps: Step[], c: Case, grader: Grader = keywordGrader): RunEnv {
  return { steps: [...steps].sort((a, b) => a.order - b.order), case: c, grader };
}

/** A new run: the dispatch line, the clock not started (it starts at the first timed step, ruling S13), step 1. */
export function startRun(env: RunEnv, mode: RunMode, ids: { id: string; startedAt: string }, now: number): RunSession {
  return checked({
    id: ids.id, caseId: env.case.id, mode, startedAt: ids.startedAt, drill: null,
    clock: NEW_CLOCK, lastAt: stamp(now, 0), current: 1,
    hits: {}, parts: {}, prefilled: [], tapped: [], nudged: [], flaggedOrder: [], disputes: [], played: [],
    lines: [{ who: 'system', text: activationText(env.case), atMs: null }],
    readings: [], oxygen: null, ecg: null,
    reassessFromMs: null, reassessSets: 0, rbsMs: null, standbyMs: null, stepTimes: {}, arrived: false, held: null,
  });
}

/** The run time used by `now`: 0 until the clock starts. */
export function runElapsed(s: RunSession, now: number): number {
  return elapsedMs(s.clock, now);
}

/** What the grader reads a line against: the run's step, what is done (tapped and prefilled points too), what is still
 *  to do in the steps before it (`pending`: a point gone back for is read there, not as a step ahead), whether the crew
 *  has arrived and the last line was held (the post-breaker ruling), and the case's slots at the ETA the tester would
 *  give now (10 in a drill). */
export function gradeContext(env: RunEnv, s: RunSession, now: number): GradeContext {
  const points = applicablePoints(env.steps, env.case);
  const arrived = arrivedOf(env, s);
  const done = new Set(points.filter(a => pointDone(a, s)).map(a => a.key));
  const pending = new Set(points.filter(a => a.step.order < s.current && !done.has(a.key)
    && !(arrived && a.step.order <= LAST_CALL_STEP)).map(a => a.key));   // once arrived the call is over (fix round 3)
  const eta = etaAt(s, now);
  return { case: env.case, steps: env.steps, current: s.current, slots: caseSlots(env.case, eta), done, pending,
    arrived, held: !arrived && s.held !== null, eta };
}

// ---- One line or tap ----------------------------------------------------------------------------------------

/** What a check point's choice was, for its first hit. */
interface Checked { check: PointHit['check']; chose: string | null }
/** The choice a whole line made for a check point: the latest device and the latest flow named in its readings of the
 *  point, the latest ECG type, and an allowed BP arm if any reading chose one, else the latest. */
interface LineChoice { oxygen: OxygenChoice | null; ecg: '12-lead' | '4-lead' | null; arm: ArmSide | null }

/** Whether a reply of the point's step answers it: its `on` names the point, or 'point.part' for one of `partIds`. */
export function replyHeard(r: Reply, pointId: string, partIds: string[]): boolean {
  return r.on.some(on => on === pointId || partIds.some(p => on === `${pointId}.${p}`));
}

/** The working copy of a session while one line or tap is applied to it. */
class Turn {
  clock: RunClock;
  current: number;
  hits: Record<string, PointHit>;
  parts: Record<string, PartHit>;
  played: string[];
  oxygen: OxygenGiven | null;
  ecg: RunSession['ecg'];
  stepTimes: Record<string, number>;
  rbsMs: number | null;
  standbyMs: number | null;
  reassessFromMs: number | null;
  /** Whether the crew has arrived: as the run began, then from the sentence the grader says the call ends at. */
  arrived: boolean;
  /** Replies in the order they are said, and the readings they add, both stamped with the line's time at the end. */
  readonly replies: Omit<ChatLine, 'atMs'>[] = [];
  readonly readings: Omit<Reading, 'atMs'>[] = [];
  readonly announce: string[] = [];
  /** Keys of hits this input made, in order; keys of the graded points it read whole. */
  readonly newHits: string[] = [];
  readonly saw = new Set<string>();
  /** The points' pieces already in this line's route ("sound out", "remove hazards"), so each shows once (Task 14 review). */
  readonly routed = new Set<string>();
  private readonly playedNow = new Set<string>();
  /** The index of the trainee's line (a held line read again keeps its own); the furthest a line may move the run (2
   *  steps past where it began). */
  readonly at: number;
  readonly cap: number;
  /** The furthest step the line's sentences so far have reached (a whole reading within the cap): what its next
   *  sentence is read at (fix round 2). A far-ahead reading moves `current` to the cap but reaches nothing (I1); on the
   *  phone it takes the line's next sentences to the cap, off the call (fix round 4, NB1). */
  reachedTo: number;
  /** The furthest step a whole reading of this input truly reached, within its window (never a far-ahead read's cap). */
  furthest: number;
  readonly eta: number;

  constructor(readonly env: RunEnv, readonly s: RunSession, readonly now: number, at: number = s.lines.length, cap: number = s.current + 2) {
    this.clock = s.clock;   // replaced, never written into: NEW_CLOCK is frozen and shared (Task 7 carry)
    this.current = s.current;
    this.hits = { ...s.hits };
    this.parts = { ...s.parts };
    this.played = [...s.played];
    this.oxygen = s.oxygen;
    this.ecg = s.ecg;
    this.stepTimes = { ...s.stepTimes };
    this.rbsMs = s.rbsMs;
    this.standbyMs = s.standbyMs;
    this.reassessFromMs = s.reassessFromMs;
    this.arrived = arrivedOf(env, s);
    this.at = at;
    this.cap = cap;
    this.reachedTo = s.current;
    this.furthest = 0;
    this.eta = etaAt(s, now);
  }

  elapsed(): number { return elapsedMs(this.clock, this.now); }
  atMs(): number | null { return this.clock.started ? this.elapsed() : null; }
  /** The session as it stands, for pointDone and the like. */
  view(): RunSession { return { ...this.s, hits: this.hits, parts: this.parts }; }
  graded(order: number): boolean { return inRange(this.s, order); }

  /** Whether the run has reached the step: it is at or past it, or a point of it was said whole in this same input (so
   *  "…a rapid body survey, please allow me. Head, neck…" from further back than the 2-step cap still takes its
   *  regions). A stray hit of the step from an earlier line never opens it (Task 10 fix round 1, I4). */
  entered(step: Step): boolean {
    return step.order <= this.current || this.newHits.some(k => k.startsWith(`${step.id}/`));
  }

  /** A reading that reaches its step: outside a drill, the first in a timed step starts the clock (ruling S13); a timed
   *  step's first time is kept once the clock runs (the T10 conflict row's ruling: timed steps only). */
  reach(step: Step): void {
    if (!step.timed) return;
    if (this.s.drill === null && !this.clock.started) this.clock = startClock(this.clock, this.now);
    if (this.clock.started && !has(this.stepTimes, step.id)) this.stepTimes[step.id] = this.elapsed();
  }

  /** A check point's reading puts the oxygen or ECG the sentence names on the patient: later readings titrate it, and a
   *  flow alone changes the flow of the device on. The BP arm puts nothing on. What a first hit is graded on is the
   *  line's whole choice (grade). */
  apply(a: Applicable, sen: SentenceReading, atMs: number | null): void {
    const expected = this.env.case.expected;
    if (a.point.check === 'arm') return;
    if (a.point.check === 'ecg') {
      if (sen.ecg !== null) this.ecg = sen.ecg;
      return;
    }
    const o = sen.oxygen;
    if (o === null) return;
    if (o.device === null) {
      const on = this.oxygen;
      if (o.flow !== null && on !== null && on.device !== 'none') {
        const choice = { device: on.device, flow: o.flow, flowMax: o.flowMax };
        this.oxygen = { device: on.device, flow: o.flow, atMs, right: oxygenRight(choice, expected.oxygen) };
      }
      return;
    }
    this.oxygen = { device: o.device, flow: o.flow, atMs, right: oxygenRight(o, expected.oxygen) };
  }

  /** A check point's first hit, graded on the choice the whole line made for it (Task 10 fix round 1, I3: as P17 does
   *  for missing words): "Nasal cannula please. 2 litres." is the cannula at 2 L/min. No device named is 'unnamed'. The
   *  BP arm is right when it is one of the case's allowed arms (allowedArms), so wrong only where the patient rules it out. */
  grade(a: Applicable, choice: LineChoice | undefined): Checked {
    const expected = this.env.case.expected;
    if (a.point.check === 'arm') {
      const arm = choice?.arm ?? null;
      return arm === null ? { check: 'unnamed', chose: null }
        : { check: allowedArms(this.env.case).includes(arm) ? 'right' : 'wrong', chose: `${arm} arm` };
    }
    if (a.point.check === 'ecg') {
      const ecg = choice?.ecg ?? null;
      return ecg === null ? { check: 'unnamed', chose: null } : { check: ecg === expected.ecg ? 'right' : 'wrong', chose: ecg };
    }
    const o = choice?.oxygen ?? null;
    if (o === null || o.device === null) return { check: 'unnamed', chose: null };
    return { check: oxygenRight(o, expected.oxygen) ? 'right' : 'wrong', chose: describeOxygen(o) };
  }

  /** The replies a point's reading sets off, each once in this input: those of its step, in file order, whose `on`
   *  names the point or a part read, hearing `oxygen` (by default the oxygen on now). A text reply is said once per run
   *  (R16). A reply counts as said only once it says something, so one with nothing to say yet (no oxygen on) can still
   *  speak later in the line (I3). Every reading a reply carries is kept (ruling P21). */
  play(step: Step, pointId: string, partIds: string[], oxygen: OxygenGiven | null = this.oxygen): void {
    step.replies.forEach((r, index) => {
      if (!replyHeard(r, pointId, partIds)) return;
      const key = `${step.id}#${index}`;
      if (this.playedNow.has(key) || ('text' in r && this.played.includes(key))) return;
      const spoken = replyText(r, { case: this.env.case, oxygen, eta: this.eta });
      if (spoken === null) return;
      this.playedNow.add(key);
      if ('text' in r) this.played.push(key);
      this.replies.push({ who: r.role, text: spoken.text });
      this.readings.push(...spoken.readings);
    });
  }

  /** The times a line or tap can set, once the clock runs: RBS done (outside a drill), the standby call and the reassess
   *  call. */
  times(): void {
    if (!this.clock.started) return;
    const rbs = pointsOf(this.env).get(KEY.rbs);
    if (this.s.drill === null && this.rbsMs === null && rbs !== undefined && pointDone(rbs, this.view())) {
      this.rbsMs = this.elapsed();
      this.announce.push(`RBS done at ${rbsShown(this.rbsMs)}.`);
    }
    if (this.standbyMs === null && this.saw.has(KEY.standby)) this.standbyMs = this.elapsed();
    if (this.reassessFromMs === null && this.saw.has(KEY.reassess)) this.reassessFromMs = this.elapsed();
  }

  /**
   * The session with the trainee's line (`you`) and its replies, in Coached with its flags: Phrase and Wrong for new
   * hits, a nudge for each point not done two steps back, and Order (`withOrder`) for each point newly out of place,
   * on the line holding its hit.
   */
  finish(you: Omit<ChatLine, 'atMs'>, tapped: string[], withOrder: boolean, held: number | null = null): Applied {
    const s = this.s;
    const atMs = this.atMs();
    const session: RunSession = {
      ...s, clock: this.clock, current: this.current, hits: this.hits, parts: this.parts, played: this.played,
      oxygen: this.oxygen, ecg: this.ecg, stepTimes: this.stepTimes,
      rbsMs: this.rbsMs, standbyMs: this.standbyMs, reassessFromMs: this.reassessFromMs, tapped,
      readings: [...s.readings, ...this.readings.map(r => ({ ...r, atMs }))],
      lastAt: stamp(this.now, s.lastAt), arrived: this.arrived, held: this.arrived ? null : held,
    };
    const lines = [...s.lines];
    const flags: InlineFlag[] = [];
    if (s.mode === 'coached') {
      const points = pointsOf(this.env);
      const nudged = [...s.nudged];
      const flaggedOrder = [...s.flaggedOrder];
      const fresh = this.newHits.flatMap(k => {
        const hit = this.hits[k];
        const a = points.get(k);
        return hit === undefined || a === undefined ? [] : [{ k, hit, a }];
      });
      for (const { k, hit, a } of fresh) {
        if (hit.missing.length > 0) flags.push({ kind: 'phrase', point: k, text: missingWordsDetail(hit.missing) });
        if (hit.check === 'unnamed' && a.point.check !== undefined) flags.push({ kind: 'phrase', point: k, text: UNNAMED_DETAIL[a.point.check] });
      }
      for (const { k, hit, a } of fresh) {
        if (hit.check === 'wrong' && a.point.check !== undefined) flags.push({ kind: 'wrong', point: k, text: WRONG_TEXT[a.point.check] });
      }
      const graded = gradedPoints(this.env, session);
      for (const a of graded) {
        if (!nudgeDue(a.step.order, this.current, this.arrived) || pointDone(a, session) || nudged.includes(a.key)) continue;
        flags.push({ kind: 'nudge', point: a.key, text: `Not done yet: ${stop(a.point.label)}` });
        nudged.push(a.key);
      }
      if (withOrder) {
        const said = graded.flatMap(a => {
          const hit = has(this.hits, a.key) ? this.hits[a.key] : undefined;
          return hit === undefined ? [] : [{ a, hit, key: a.key, rank: rankOf(a.step, a.index) }];
        }).sort((x, y) => x.hit.line - y.hit.line || x.hit.pos - y.hit.pos || x.rank - y.rank);   // as classify orders them
        const late = outOfOrder(said);
        for (const { a, hit } of said) {
          if (!late.has(a.key) || flaggedOrder.includes(a.key)) continue;
          const flag: InlineFlag = { kind: 'order', point: a.key, text: `${capitalise(a.point.short)} belongs to step ${a.step.order}, ${a.step.name}.` };
          const holder = hit.line < this.at ? lines[hit.line] : undefined;
          if (holder === undefined) flags.push(flag);
          else lines[hit.line] = { ...holder, flags: [...(holder.flags ?? []), flag] };
          flaggedOrder.push(a.key);
        }
      }
      session.nudged = nudged;
      session.flaggedOrder = flaggedOrder;
    }
    const replies = merged(this.replies).map(r => ({ ...r, atMs }));
    const was = this.at < lines.length ? lines[this.at] : undefined;
    if (was !== undefined) {   // a held line read again on arrival, or the rest of a line read in parts: its new route
      // (for the rest, the whole line's, from both parts' pieces: readLine) and flags, its replies said now; marked smart
      // once either read took smart credit (D15)
      const all = [...(was.flags ?? []), ...flags];
      lines[this.at] = { ...was, ...(you.route === undefined ? {} : { route: you.route }), ...(all.length > 0 ? { flags: all } : {}),
        ...(you.smart === true ? { smart: true as const } : {}) };
      session.lines = [...lines, ...replies];
    } else {
      session.lines = [...lines, { ...you, atMs, ...(flags.length > 0 ? { flags } : {}) }, ...replies];
    }
    return { session: checked(session), announce: this.announce };
  }
}

/** Replies in a row from one role, as one line: their texts joined with a space. */
function merged(replies: Omit<ChatLine, 'atMs'>[]): Omit<ChatLine, 'atMs'>[] {
  const out: Omit<ChatLine, 'atMs'>[] = [];
  for (const r of replies) {
    const prev = out.at(-1);
    if (prev !== undefined && prev.who === r.who) out[out.length - 1] = { ...prev, text: `${prev.text} ${r.text}` };
    else out.push(r);
  }
  return out;
}

// The GCS a trainee states (R15, ruling P21), read in this order (Task 10 fix round 1, I5):
// 1. an explicit total: "4 + 5 + 6 = 15", "total 15", "15/15", "15 out of 15";
// 2. else the eye, verbal and motor figures, summed: "E4 V5 M6", "eyes 4, verbal 5, motor 6";
// 3. else a lone figure in a sentence that names the GCS: "GCS 14", "GCS score is 14" (never "pain score 7").
const GCS_TOTAL = [
  /=\s?(\d{1,2})(?![0-9])/,
  /(?<![a-z])total(?: is| of)?:? ?(\d{1,2})(?![0-9])/,
  /(?<![0-9])(\d{1,2}) ?(?:\/|out of) ?15(?![0-9])/,
];
// Each figure with its most: eyes 4, verbal 5, motor 6. "v5" may follow "e4" with no space ("E4V5M6").
const GCS_PARTS: readonly (readonly [RegExp, number])[] = [
  [/(?<![a-z])(?:eyes?(?: opening)?|e)[ :]*(\d)(?![0-9])/, 4],
  [/(?<![a-z])(?:verbal|v)[ :]*(\d)(?![0-9])/, 5],
  [/(?<![a-z])(?:motor|m)[ :]*(\d)(?![0-9])/, 6],
];
const NAMES_GCS = /(?<![a-z])(?:gcs|glasgow)(?![a-z])/;
/** A GCS figure as the rail stores it: 3 to 15, else null. */
const gcsFigure = (n: number): string | null => (Number.isInteger(n) && n >= 3 && n <= 15 ? String(n) : null);

/** The GCS a sentence states, or null: never the case's own figure (R15, ruling P21). */
function gcsSaid(text: string): string | null {
  const t = normalizeLine(text);
  for (const re of GCS_TOTAL) {
    const m = re.exec(t);
    if (m !== null) return gcsFigure(Number(m[1]));
  }
  const parts = GCS_PARTS.map(([re, most]) => {
    const n = Number(re.exec(t)?.[1] ?? Number.NaN);
    return n >= 1 && n <= most ? n : null;
  });
  if (parts.every(n => n !== null)) return gcsFigure(parts.reduce<number>((sum, n) => sum + (n ?? 0), 0));
  const figures = t.match(/(?<![0-9.])\d+(?:\.\d+)?(?![0-9])/g) ?? [];
  return NAMES_GCS.test(t) && figures.length === 1 ? gcsFigure(Number(figures[0])) : null;
}

/** Where a grader puts a point or part in its sentence, as the run stores it: a finite place from 0 to 999 (m4: a
 *  Plan 3 grader's NaN would otherwise block every save). */
const place = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999) : 0);
/** A flow the run can store: finite, else none (I6: a 309-digit "flow" is Infinity). */
const finiteFlow = (n: number | null): number | null => (n !== null && Number.isFinite(n) ? n : null);

/** A sentence as the grader read it, with every number made safe to store (I6, m4). */
function safe(sen: SentenceReading): SentenceReading {
  const o = sen.oxygen;
  const flow = finiteFlow(o?.flow ?? null);
  const oxygen = o === null || (o.device === null && flow === null) ? null
    : { device: o.device, flow, flowMax: flow === null ? null : finiteFlow(o.flowMax) };
  return { ...sen, oxygen,
    points: sen.points.map(p => ({ ...p, pos: place(p.pos), ...(p.partPos === undefined ? {} : { partPos: p.partPos.map(place) }) })) };
}

/** What a whole line said, for the points it read: the missing words no sentence found (P17), and each check point's
 *  choice over the line (I3). */
interface LineFacts { missing: Map<string, string[]>; choices: Map<string, LineChoice> }
/** No line facts yet: what the scratch copy reads a line's sentences with, as the grader reads them (fix round 2). The
 *  facts change only a hit's missing words and grade, never where the run stands. */
const NO_FACTS: LineFacts = { missing: new Map(), choices: new Map() };

function lineFacts(env: RunEnv, sentences: SentenceReading[]): LineFacts {
  const points = pointsOf(env);
  const missing = new Map<string, string[]>();
  const choices = new Map<string, LineChoice>();
  // the BP arm: an allowed arm any sentence chooses holds, else the latest (Task 2 pre-review ruling)
  const allowed: readonly string[] = allowedArms(env.case);
  const armOf = (was: ArmSide | null, now: ArmSide | null | undefined): ArmSide | null =>
    (was !== null && allowed.includes(was) ? was : now ?? was);
  for (const sen of sentences) {
    for (const p of sen.points) {
      const key = pointKey(p.step, p.point);
      const prev = missing.get(key);
      missing.set(key, prev === undefined ? [...p.missing] : prev.filter(w => p.missing.includes(w)));
      const check = points.get(key)?.point.check;
      if (check === undefined) continue;
      const was = choices.get(key) ?? { oxygen: null, ecg: null, arm: null };
      choices.set(key, check === 'ecg' ? { ...was, ecg: sen.ecg ?? was.ecg }
        : check === 'arm' ? { ...was, arm: armOf(was.arm, sen.arm) }
        : { ...was, oxygen: sen.oxygen === null ? was.oxygen : joinChoice(was.oxygen, sen.oxygen) });
    }
  }
  return { missing, choices };
}

/** A line's oxygen so far, then the next sentence's: a device named takes over (with its own flow, or the flow already
 *  named for that same device); a flow alone sets the flow of the device named so far. */
function joinChoice(was: OxygenChoice | null, o: OxygenChoice): OxygenChoice {
  if (o.device !== null) {
    const keep = was !== null && was.device === o.device && o.flow === null;
    return { device: o.device, flow: keep ? was.flow : o.flow, flowMax: keep ? was.flowMax : o.flowMax };
  }
  return { device: was?.device ?? null, flow: o.flow, flowMax: o.flowMax };
}

/** A point's piece of the route: "oxygen, {choice}", "ECG, {type}", "BP arm, {side} arm", "{short} ({parts read})" when
 *  only some of its parts were read, else its short; "(not in this drill)" after a point outside the drill. */
function shortOf(a: Applicable, p: PointReading, sen: SentenceReading, graded: boolean): string {
  const m = a.point;
  const parts = m.parts ?? [];
  const read = parts.filter(x => p.parts.includes(x.id));
  const base = m.check === 'oxygen' && sen.oxygen !== null ? `oxygen, ${describeOxygen(sen.oxygen)}`
    : m.check === 'ecg' && sen.ecg !== null ? `ECG, ${sen.ecg}`
    : m.check === 'arm' && sen.arm != null ? `BP arm, ${sen.arm} arm`
    : read.length > 0 && read.length < parts.length ? `${m.short} (${read.map(x => x.label.toLowerCase()).join(', ')})`
    : m.short;
  return graded ? base : `${base} (not in this drill)`;
}

/**
 * One sentence of a line, applied: its hits and parts, the clock, the oxygen, its replies; returns its piece of the
 * route ('' when every point it read is in the line's route already, or when it reads nothing and is no question: D25).
 * - Whole readings move the run on to their step, but never more than 2 steps past where the line began (Task 5 carry);
 *   a part-only read of a step ahead of the run never moves it (Task 9 carry A).
 * - An `ordered` point's parts count only once its step is reached, so a re-ask read as an RBS region ("Is there chest
 *   rise and fall?" at step 10) never credits it early or throws its order out (Task 9 carry A). A sentence naming
 *   every one of its parts is a sweep, not a re-ask, and counts wherever it is said (no re-ask names all eight RBS
 *   regions), so an RBS said before any other step 12 point is never lost. Other parts count wherever they are read.
 * - Each part keeps its own place in the sentence (Task 9 carry B).
 * - A reading reaches its step (starting the clock, setting its time) only within the same 2-step window that moves
 *   `current` (Task 10 fix round 1, I1), so a phone question read as a step far ahead never starts the clock.
 * - A check point's first hit is graded on the whole line's choice for it (I3).
 * - Its replies hear the oxygen as it stands after this sentence, before any later one (Task 8 carry); within the
 *   sentence, a point said before the oxygen choice is answered with the oxygen as the sentence began (I2).
 */
function applySentence(t: Turn, i: number, sen: SentenceReading, line: LineFacts): string {
  const points = pointsOf(t.env);
  const read = sen.points.flatMap(p => {
    const a = points.get(pointKey(p.step, p.point));
    return a === undefined ? [] : [{ p, a, graded: t.graded(a.step.order) }];
  });
  if (sen.arrives !== undefined) t.arrived = true;   // the call ends at this sentence (the post-breaker ruling)
  // D25: an unread question keeps its mark, as it expected an answer; an unread statement drops out (routeOf still
  // says "Not sure what this is." for a line that reads nothing at all)
  if (read.length === 0) return sen.question === true ? NOT_UNDERSTOOD : '';
  const during = t.current;
  const before = t.oxygen;
  for (const { p, a, graded } of read) {
    if (!graded || !p.whole) continue;
    t.current = Math.max(t.current, Math.min(a.step.order, t.cap));
    if (sen.reask === true) continue;   // a re-ask that spilled ahead never moves the line on (fix round 3, N1)
    if (a.step.order <= t.cap) t.reachedTo = Math.max(t.reachedTo, a.step.order);
    if (a.step.order <= t.cap) t.furthest = Math.max(t.furthest, a.step.order);
    // on the phone, a read past the next two steps that the grader kept (no lone phone question) means the trainee has
    // left the call: the line's next sentences are read as far on as it may go, so "…do not move your head. Is there any
    // catastrophic bleeding?" asks the scene, not the caller (fix round 4, NB1)
    else if (t.reachedTo <= LAST_CALL_STEP && a.step.order > t.reachedTo + 2) t.reachedTo = t.cap;
  }
  // A sentence naming every part of a point is a sweep, never a re-ask, so it counts where its step stands.
  const sweep = (a: Applicable, p: PointReading) => (a.point.parts ?? []).every(x => p.parts.includes(x.id));
  const counts = (a: Applicable, p: PointReading) => p.parts.length > 0 && (a.point.ordered !== true || t.entered(a.step) || sweep(a, p));
  for (const { p, a, graded } of read) {
    if (graded && a.step.order <= t.cap && (p.whole || (p.parts.length > 0 && (t.entered(a.step) || sweep(a, p))))) t.reach(a.step);
  }
  const atMs = t.atMs();
  const hitOf = (a: Applicable, p: PointReading, c: Checked | null): PointHit => ({
    line: t.at, pos: i * 1000 + p.pos, atMs, during, said: sen.text, missing: line.missing.get(a.key) ?? p.missing,
    check: c?.check ?? null, chose: c?.chose ?? null,
  });
  // whole points first, so a step said whole in this sentence takes its ordered parts below
  for (const { p, a, graded } of read) {
    if ((a.point.parts ?? []).length > 0) continue;
    if (a.point.check !== undefined) t.apply(a, sen, atMs);
    if (!graded || !p.whole) continue;
    t.saw.add(a.key);
    if (has(t.hits, a.key)) continue;
    t.hits[a.key] = hitOf(a, p, a.point.check === undefined ? null : t.grade(a, line.choices.get(a.key)));
    t.newHits.push(a.key);
  }
  for (const { p, a, graded } of read) {
    const own = a.point.parts ?? [];
    if (own.length === 0 || !graded) continue;
    if (p.whole) t.saw.add(a.key);
    if (counts(a, p)) {
      p.parts.forEach((id, j) => {
        const key = `${a.key}/${id}`;
        if (own.some(x => x.id === id) && !has(t.parts, key)) t.parts[key] = { line: t.at, pos: i * 1000 + (p.partPos?.[j] ?? p.pos) };
      });
    }
    if (!has(t.hits, a.key) && pointDone(a, t.view())) {   // the sentence that completes a parted point records its hit
      t.hits[a.key] = hitOf(a, p, null);
      t.newHits.push(a.key);
    }
  }
  const gcs = read.find(({ a, p }) => a.key === KEY.gcs && p.parts.includes('score'));
  const figure = gcs === undefined ? null : gcsSaid(sen.text);
  if (figure !== null) t.readings.push({ key: 'gcs', value: figure, o2: null });
  if (sen.addressee === 'unclear') return UNCLEAR;   // R8: its points count, its replies wait
  // where the sentence names its oxygen choice: a point said before it is answered as the sentence began (I2)
  const choiceFrom = sen.oxygen === null ? -1 : choiceAt(normalizeLine(sen.text));
  for (const { p, a } of read) {
    const earlier = choiceFrom >= 0 && a.point.check !== 'oxygen' && p.pos < choiceFrom;
    t.play(a.step, a.point.id, p.parts, earlier ? before : t.oxygen);
  }
  // a point the line's route already shows isn't shown again ("Sound out · Sound out"); a sentence with nothing new adds
  // no piece
  const fresh = [...new Set(read.map(({ p, a, graded }) => shortOf(a, p, sen, graded)))].filter(x => !t.routed.has(x));
  if (fresh.length === 0) return '';
  for (const x of fresh) t.routed.add(x);
  const shorts = fresh.join(', ');
  return sen.addressee === null ? capitalise(shorts) : `To ${ADDRESSEE_LABEL[sen.addressee]}: ${shorts}`;
}

/** A line's route from its pieces, in order: a piece of points once, empty pieces left out, and "Not sure what this is."
 *  when none is left. A sentence's own NOT_UNDERSTOOD (an unread question, D25) or UNCLEAR stays where it is, each
 *  time: it marks that sentence, not a point. */
export function routeOf(pieces: string[]): string {
  const kept: string[] = [];
  for (const x of pieces) {
    if (x !== '' && (x === NOT_UNDERSTOOD || x === UNCLEAR || !kept.includes(x))) kept.push(x);
  }
  return kept.length === 0 ? NOT_UNDERSTOOD : kept.join(ROUTE_SEP);
}

/**
 * The trainee's line, read and applied. The line is trimmed and cut to RUN_LIMITS.lineChars; an empty line, or a run
 * already at RUN_LIMITS.transcriptLines lines, changes nothing. Each sentence is applied in order (applySentence); a new
 * hit's missing words are those no sentence of the line reading the same point found (ruling P17), and a check point's
 * choice is the line's (I3). The route joins the sentences' pieces with " · ". Replies in a row from one role merge
 * into one line. Every read of the line shares one budget for slow readings (lineBudget), closed once it is applied, so
 * a smart check costs the line one deadline in all, however many parts it is read in (Plan 3 D14).
 */
export async function sendLine(env: RunEnv, s: RunSession, text: string, now: number): Promise<Applied> {
  const line = text.trim().slice(0, RUN_LIMITS.lineChars);
  if (line === '' || s.lines.length >= RUN_LIMITS.transcriptLines) return { session: s, announce: [] };
  // every read of this line shares one budget for slow readings (the smart tester's one deadline, Plan 3 D14)
  const budget = lineBudget();
  try {
    return await readParts(env, s, line, now, budget);
  } finally {
    budget.close();
  }
}

/** sendLine's reads of one line, each with the line's budget. */
async function readParts(env: RunEnv, s: RunSession, line: string, now: number, budget: LineBudget): Promise<Applied> {
  const first = await readLine(env, s, line, now, { budget });
  // The held line is read on arrival (e), the second line in a row to read scene steps through statements (the
  // post-breaker ruling), and on (c) or (d) right after it, so neither is lost. The call ends at the sentence that
  // ends it (the adjudication ruling, LB2): the line's sentences before it are read as the phone's, so its call points
  // count; the held line is read there, on scene; then the rest of the line. All within the line's own 2-step window.
  const held = s.held === null ? undefined : s.lines[s.held];
  if (!first.onScene || s.held === null || held?.who !== 'you') return first.applied;
  const k = Math.max(0, first.sentences.findIndex(x => x.arrives !== undefined));
  const cap = s.current + 2;
  const at = s.lines.length;
  const call = k === 0 ? null
    : await readLine(env, { ...s, held: null }, first.sentences.slice(0, k).map(x => x.text).join(' '), now, { shown: line, cap, budget });
  const again = await readLine(env, { ...(call?.applied.session ?? s), arrived: true, held: null }, held.text, now,
    { at: s.held, cap, budget });
  // the rest moves within two steps of where the held line truly took the run: a held line that only read far ahead
  // ("Keep the patient comfortable.") never lets the line move the run twice
  const after = Math.max(cap, again.furthest + 2);
  const rest = await readLine(env, again.applied.session, first.sentences.slice(k).map(x => x.text).join(' '), now,
    call === null ? { shown: line, from: k, cap: after, budget } : { at, before: call.pieces, from: k, cap: after, budget });
  return { session: rest.applied.session,
    announce: [...(call?.applied.announce ?? []), ...again.applied.announce, ...rest.applied.announce] };
}

/** Where a read goes (readLine): `at` an existing line (a held line read again, or the rest of a line read in parts),
 *  `before` the route pieces of the sentences a line read in parts said before its arrival, which the rest's route
 *  joins (so "Not sure what this is." stands for the line only when neither part reads anything, D25: review round 1),
 *  `shown` the text a new line shows when only part of it is read, `from` the index of its first sentence in the whole
 *  line (so places keep their order), `cap` the whole line's 2-step window, `budget` the line's one budget for slow
 *  readings, which every read of it shares (Plan 3 D14). */
interface LinePart { at?: number; before?: string[]; shown?: string; from?: number; cap?: number; budget?: LineBudget }

/**
 * One line read and applied (sendLine), at `at`: a new line, or a held line read again on arrival. Fix round 2: the
 * grader reads each sentence at the furthest step the line's earlier sentences reached, within the line's 2-step cap
 * (ctx.next), so local terms, `pending`, the window ahead and the arrival follow the line. A scratch copy of the run
 * applies the sentences as they are read, by the same rules the line is then applied with. A far-ahead reading reaches
 * nothing (I1). What is done stays as the line began: a point said over two sentences ("…from the front. …do not move
 * your head.") is still the point the second one is read for. A line before arrival that reads nothing on the call and
 * a scene step through a statement is held. `onScene`: the grader ended the call at a scene step, by (c), (d) or (e).
 * A line any of whose sentences the smart tester credited is marked `smart` (Plan 3 D15), so the run and its record can
 * tell where that credit came from.
 */
async function readLine(env: RunEnv, s: RunSession, line: string, now: number, opts: LinePart = {}):
  Promise<{ applied: Applied; onScene: boolean; sentences: SentenceReading[]; furthest: number; pieces: string[] }> {
  const at = opts.at ?? s.lines.length;
  const from = opts.from ?? 0;
  const scratch = new Turn(env, s, now, at, opts.cap);
  let read = 0;
  const budget = opts.budget === undefined ? {} : { budget: opts.budget };
  const after = (sen: SentenceReading): GradeContext => {
    applySentence(scratch, from + read++, safe(sen), NO_FACTS);
    return { ...gradeContext(env, { ...s, current: scratch.reachedTo, arrived: scratch.arrived }, now), next: after, ...budget };
  };
  const sentences = (await env.grader.interpret(line, { ...gradeContext(env, s, now), next: after, ...budget })).sentences.map(safe);
  const facts = lineFacts(env, sentences);
  const t = new Turn(env, s, now, at, opts.cap);
  const pieces = sentences.map((sen, i) => applySentence(t, from + i, sen, facts));
  t.times();
  const route = routeOf([...(opts.before ?? []), ...pieces]);
  const held = !t.arrived && sentences.every(x => x.points.length === 0) && sentences.some(x => x.dropped === 'statement');
  const smart = sentences.some(x => x.smart === true) ? { smart: true as const } : {};
  return { applied: t.finish({ who: 'you', text: opts.shown ?? line, route, ...smart }, s.tapped, true, held ? at : null),
    onScene: sentences.some(x => x.arrives === 'secondLine' || x.arrives === 'twoPoints' || x.arrives === 'callDone'), sentences,
    furthest: t.furthest, pieces };
}

/** The sentence of a tapped canonical line that says the point (by its own terms), else the whole line: what its hit
 *  records as said, so a tapped (or a drill's prefilled) MOI or decision reads in the case record as a typed one does. */
function saidIn(text: string, a: Applicable, slots: MatchSlots): string {
  const m = a.point;
  const terms = [...m.match, ...(m.local ?? []), ...(m.accept ?? []).flatMap(x => x.match), ...(m.parts ?? []).flatMap(p => p.match)];
  return splitSentences(text).find(x => matchAt(normalizeLine(x), terms, slots) >= 0) ?? text;
}

/** The case's own oxygen, given at `atMs`: its device at its lowest flow, right. What tap mode and a drill's prefilled
 *  breathing put on the patient. */
export function caseOxygen(env: RunEnv, atMs: number | null): OxygenGiven {
  const o = env.case.expected.oxygen;
  return { device: o.device, flow: o.flowMin, atMs, right: true };
}

/**
 * A point said from the case, at `at`: tap mode's hits and a drill's prefilled steps (drill.ts) both come from here, so
 * what such a hit records can't drift between them (Task 11 fix round 1). It is hit whole, nothing missing, said as the
 * step's filled canonical line `text` says it (saidIn), right where it has a check (the case's own oxygen at its lowest
 * flow, its own ECG, or its own BP arm), and every one of its parts is said on the same line.
 */
export function caseHit(env: RunEnv, a: Applicable, text: string, slots: MatchSlots,
  at: { line: number; atMs: number | null; during: number }): { hit: PointHit; parts: Record<string, PartHit> } {
  const check = a.point.check;
  const o = caseOxygen(env, at.atMs);
  const chose = check === 'oxygen' ? describeOxygen({ device: o.device, flow: o.flow, flowMax: null })
    : check === 'ecg' ? env.case.expected.ecg
    : check === 'arm' ? `${env.case.findings.investigation.bpArm} arm` : null;
  const parts: Record<string, PartHit> = {};
  (a.point.parts ?? []).forEach((p, j) => { parts[`${a.key}/${p.id}`] = { line: at.line, pos: a.index * 100 + j }; });
  return { hit: { line: at.line, pos: a.index, atMs: at.atMs, during: at.during, said: saidIn(text, a, slots), missing: [],
    check: check === undefined ? null : 'right', chose }, parts };
}

/** Whether the step needs nothing more: tapped, prefilled, or every point of it that applies to the case done. */
export function stepCovered(env: RunEnv, s: RunSession, stepId: string): boolean {
  if (s.tapped.includes(stepId) || s.prefilled.includes(stepId)) return true;
  const step = env.steps.find(x => x.id === stepId);
  return step !== undefined && applicablePoints([step], env.case).every(a => pointDone(a, s));
}

/**
 * A step played from the step list (tap mode): its canonical line, filled for the case, and every point that applies
 * to the case hit, tapped, with nothing missing, right where it has a check, and every part said. The oxygen and ECG
 * take the case's own (never what the canonical line names, Task 5 carry), so the readings improve, and each reply
 * hears the oxygen as it stood at its point (step 10's SpO2 is read on room air). The clock, the step's time, `current`
 * and the run's times move as for a typed line; Coached nudges run. A covered step, a step outside the drill, an
 * unknown step, or a run at its line limit, changes nothing.
 */
export function tapStep(env: RunEnv, s: RunSession, stepId: string, now: number): Applied {
  const step = env.steps.find(x => x.id === stepId);
  if (step === undefined || !inRange(s, step.order) || stepCovered(env, s, stepId) || s.lines.length >= RUN_LIMITS.transcriptLines) {
    return { session: s, announce: [] };
  }
  const t = new Turn(env, s, now);
  const text = fillCanonical(step.canonicalLine, env.case, t.eta, step.mustHit).slice(0, RUN_LIMITS.lineChars);
  t.current = Math.max(t.current, step.order);
  if (step.order > LAST_CALL_STEP) t.arrived = true;   // a tap past the call's steps is the crew's arrival
  t.reach(step);
  const atMs = t.atMs();
  const slots = caseSlots(env.case, t.eta);
  for (const a of applicablePoints([step], env.case)) {
    if (a.point.check === 'oxygen') t.oxygen = caseOxygen(env, atMs);
    else if (a.point.check === 'ecg') t.ecg = env.case.expected.ecg;
    const said = caseHit(env, a, text, slots, { line: t.at, atMs, during: s.current });
    t.hits[a.key] = { ...said.hit, tapped: true };
    Object.assign(t.parts, said.parts);
    t.saw.add(a.key);
    t.play(step, a.point.id, (a.point.parts ?? []).map(p => p.id));
  }
  t.times();
  return t.finish({ who: 'you', text, route: `Tapped: step ${step.order}, ${step.name}`, tapped: true }, [...s.tapped, step.id], false);
}

/**
 * The 5-minute reassessments: once the clock runs and the reassess call was made, each 5-minute mark since then that
 * has no readings yet gets the head buddy's and the arm buddy's, at the mark's time, with the oxygen on now. Null when
 * there is nothing new (so the 1 s tick saves only when it adds lines), and no lines past the run's line limit.
 */
export function tickRun(env: RunEnv, s: RunSession, now: number): Applied | null {
  if (!s.clock.started || s.reassessFromMs === null) return null;
  const marks = Math.floor((elapsedMs(s.clock, now) - s.reassessFromMs) / REASSESS_MS);
  if (!(marks > s.reassessSets)) return null;
  const lines = [...s.lines];
  const readings = [...s.readings];
  const speech = { case: env.case, oxygen: s.oxygen, eta: etaAt(s, now) };
  for (let k = s.reassessSets + 1; k <= marks && lines.length < RUN_LIMITS.transcriptLines; k++) {
    const atMs = s.reassessFromMs + k * REASSESS_MS;
    const head = readingsSpeech(['temp', 'rr', 'skin'], speech);
    const arm = readingsSpeech(['spo2', 'pr', 'bp', 'crt'], speech);
    lines.push({ who: 'headBuddy', text: head.text, atMs }, { who: 'armBuddy', text: arm.text, atMs });
    readings.push(...[...head.readings, ...arm.readings].map(r => ({ ...r, atMs })));
  }
  return { session: checked({ ...s, lines, readings, reassessSets: marks, lastAt: stamp(now, s.lastAt) }), announce: [] };
}

/** The run paused at `now`: its time banked (lastAt = now, which recoverClock relies on). */
export function pauseRun(s: RunSession, now: number): RunSession {
  return checked({ ...s, clock: pauseClock(s.clock, now), lastAt: stamp(now, s.lastAt) });
}

/** The run's clock running again from `now`, if it had started. */
export function resumeRun(s: RunSession, now: number): RunSession {
  return checked({ ...s, clock: resumeClock(s.clock, now), lastAt: stamp(now, s.lastAt) });
}

/** "Not what I meant" on a flag: the point's faults leave the score (R9). `now` defaults to the time it is said. */
export function disputePoint(s: RunSession, key: string, now: number = Date.now()): RunSession {
  return checked({ ...s, disputes: s.disputes.includes(key) ? s.disputes : [...s.disputes, key], lastAt: stamp(now, s.lastAt) });
}

// ---- Where the run stands -----------------------------------------------------------------------------------

/** The step to show as the run's: `current`, or the next once every point of it is done. It stays within the steps,
 *  and within a drill's range (Task 13 carry): a drill never shows a step it doesn't reach. */
export function shownStep(env: RunEnv, s: RunSession): number {
  const [first, last] = rangeOf(s) ?? [env.steps[0]?.order ?? s.current, env.steps.at(-1)?.order ?? s.current];
  const within = (order: number): number => Math.max(first, Math.min(order, last));
  const step = env.steps.find(x => x.order === s.current);
  if (step === undefined) return within(s.current);
  const done = stepCovered(env, s, step.id) || applicablePoints([step], env.case).every(a => settled(a, s));
  return within(done ? s.current + 1 : s.current);
}

/**
 * Each step as the step bar shows it, in order:
 * - 'now': the shown step (in a drill, always one of its range);
 * - 'done': tapped, prefilled, or every graded point done (or disputed);
 * - 'missed': a graded point still not done in a step behind the run (`behind`: a call step once the run is past it,
 *   any other two steps back), as the nudges count it;
 * - 'flagged': an inline flag on one of its points that isn't disputed;
 * - 'todo': the rest, and every step outside a drill's range.
 */
export function stepStates(env: RunEnv, s: RunSession): { order: number; name: string; state: StepState }[] {
  const shown = shownStep(env, s);
  const graded = gradedPoints(env, s);
  const flagged = new Set(s.lines.flatMap(l => l.flags ?? [])
    .filter(f => f.kind !== 'nudge' && !s.disputes.includes(f.point)).map(f => f.point.split('/')[0]));
  return env.steps.map(st => {
    const open = graded.filter(a => a.step.id === st.id && !settled(a, s));
    const state: StepState = st.order === shown ? 'now'
      : s.tapped.includes(st.id) || s.prefilled.includes(st.id) ? 'done'
      : !inRange(s, st.order) ? 'todo'
      : open.length > 0 && behind(st.order, s.current) ? 'missed'
      : flagged.has(st.id) ? 'flagged'
      : open.length === 0 ? 'done'
      : 'todo';
    return { order: st.order, name: st.name, state };
  });
}

/** The graded steps with a point not yet done (and not disputed), in order: what ending now would count as missed. */
export function unfinishedSteps(env: RunEnv, s: RunSession): number[] {
  const orders = gradedPoints(env, s).filter(a => !settled(a, s)).map(a => a.step.order);
  return [...new Set(orders)].sort((a, b) => a - b);
}

/** Step numbers as prose: runs of three or more as "15 to 19", the rest listed: '9, 12 and 15 to 19'; '3 and 4'. */
export function rangeText(orders: number[]): string {
  const xs = [...new Set(orders)].sort((a, b) => a - b);
  const items: string[] = [];
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === (xs[j] ?? 0) + 1) j++;
    if (j - i >= 2) items.push(`${xs[i]} to ${xs[j]}`);
    else for (let k = i; k <= j; k++) items.push(String(xs[k]));
    i = j + 1;
  }
  return joinSigns(items);
}

/** 'Step 19'; 'Steps 15 to 19'; '' for none. */
export function stepsPhrase(orders: number[]): string {
  const n = new Set(orders).size;
  return n === 0 ? '' : `${n === 1 ? 'Step' : 'Steps'} ${rangeText(orders)}`;
}

/** The Pause sheet's End confirm: "End run at 09:40? Steps 15 to 19 count as missed.", "End run now? …" before the
 *  clock starts, "End drill? …" in a drill, and no second sentence when nothing is left. */
export function endConfirmCopy(env: RunEnv, s: RunSession, now: number): string {
  const left = stepsPhrase(unfinishedSteps(env, s));
  const tail = left === '' ? '' : ` ${left} count as missed.`;
  if (s.drill !== null) return `End drill?${tail}`;
  if (!s.clock.started) return `End run now?${tail}`;
  return `End run at ${formatMmSs(elapsedMs(s.clock, now))}?${tail}`;
}

// ---- The end of a run ---------------------------------------------------------------------------------------

const transcriptLine = (l: ChatLine, c: Case): TranscriptLine => ({ who: speakerLabel(l.who, c), text: l.text, atMs: l.atMs });

/** The case record the debrief shows: what the trainee found, chose and said. */
function caseRecord(env: RunEnv, s: RunSession): CaseRecordFacts {
  const c = env.case;
  const hit = (key: string): PointHit | undefined => (has(s.hits, key) ? s.hits[key] : undefined);
  const part = (id: string): boolean => has(s.parts, `${KEY.sracie}/${id}`);
  const ecgHit = hit(KEY.ecg);
  const standby = hit(KEY.standby);
  const sracie: [string, boolean][] = [['S', part('sex')], ['R', part('race')], ['A', part('age')],
    ['C', part('case') && part('two-signs')], ['I', part('ic-no')], ['E', part('eta')]];
  return {
    complaint: hit(KEY.complaint) === undefined ? null : c.patient.chiefComplaint,
    moi: hit(KEY.moi)?.said ?? null,
    oxygen: s.oxygen === null ? null
      : describeOxygen({ device: s.oxygen.device, flow: s.oxygen.flow, flowMax: null }) + (s.oxygen.right ? '' : ', no improvement'),
    ecg: ecgHit === undefined ? null : `${s.ecg ?? ecgHit.chose ?? c.findings.investigation.ecg.type}: ${c.findings.investigation.ecg.reading}`,
    hypocount: hit(KEY.hypocount) === undefined ? null : `${oneDecimal(c.findings.investigation.hypocount)} mmol/L`,
    position: hit(KEY.askPosition) === undefined ? null
      : c.findings.position.choice + (hit(KEY.convince) === undefined ? '' : ', convinced to change'),
    decision: hit(KEY.decision)?.said ?? null,
    sracie: sracie.filter(([, lit]) => lit).map(([letter]) => letter),
    standby: standby === undefined ? []
      : s.lines.slice(standby.line).filter(l => l.who === 'you' || l.who === 'opsCtr' || l.who === 'tester').map(l => transcriptLine(l, c)),
  };
}

/**
 * The run's record: the run paused at `now`, then classified (classify, with the elapsed time as its end, or null if the
 * clock never started). `faults` holds every fault, disputed ones too, in classify's order; `missed`, `wrong`, `order` and
 * `phrase` the points of the faults still counted. `usedMs` is 0 in a drill. The transcript is capped at
 * RUN_LIMITS.transcriptLines; `reached` is every step with a hit, prefilled steps left out. A drill's `sourceRunId` is
 * kept, so the debrief's next drill in its chain still names the run the fixes came from (Task 17). `smartLines` counts
 * the lines the smart tester credited (Plan 3 D15): the record is built from the hits the run saved, never regraded.
 */
export function endRun(env: RunEnv, s: RunSession, now: number): RunRecord {
  const ended = pauseRun(s, now);
  const c = env.case;
  const endMs = ended.clock.started ? elapsedMs(ended.clock, now) : null;
  const counted = classify(env.steps, c, ended, endMs);
  const faults = classify(env.steps, c, { ...ended, disputes: [] }, endMs).faults;   // the same faults, none set aside
  const keys = (kind: RunRecord['faults'][number]['kind']) => [...new Set(counted.faults.filter(f => f.kind === kind).map(f => f.point))];
  const orderOf = new Map(env.steps.map(st => [st.id, st.order]));
  const reached = [...new Set(Object.keys(ended.hits).map(k => k.split('/')[0] ?? '').filter(id => !ended.prefilled.includes(id))
    .flatMap(id => { const o = orderOf.get(id); return o === undefined ? [] : [o]; }))].sort((a, b) => a - b);
  return {
    id: ended.id, caseId: ended.caseId, mode: ended.mode, drill: ended.drill !== null, startedAt: ended.startedAt,
    usedMs: ended.drill !== null ? 0 : (endMs ?? 0),
    stepTimes: { ...ended.stepTimes },
    missed: keys('missed'), order: keys('order'), phrase: keys('phrase'), wrong: keys('wrong'),
    disputes: [...ended.disputes], tapped: [...ended.tapped],
    transcript: ended.lines.slice(0, RUN_LIMITS.transcriptLines).map(l => transcriptLine(l, c)),
    faults, rbsMs: ended.rbsMs, standbyMs: ended.standbyMs,
    readings: [...ended.readings], oxygen: ended.oxygen === null ? null : { ...ended.oxygen },
    record: caseRecord(env, ended),
    drillRange: ended.drill === null ? null : [ended.drill.from, ended.drill.to],
    drillChain: ended.drill === null ? [] : [...ended.drill.chain],
    stepsTotal: counted.stepsTotal,
    reached,
    sourceRunId: ended.drill?.sourceRunId ?? null,
    smartLines: ended.lines.filter(l => l.smart === true).length,
  };
}

// The keyword grader: it splits a trainee's line into sentences and decides, for each, which step and which must-hit
// points it covers, who it is said to, and any oxygen, ECG or BP arm it names. Run tasks see only the Grader interface, so
// Plan 3 can put a Claude API tester behind it. Pure: no window, document or preact.
import { conditionHolds, type Addressee, type Case, type MustHit, type Role, type Step } from '../data/schema';
import { allowedArms, matchAt, normalizeLine, splitSentences, termAt, type MatchSlots } from './match';
import { armAt, ecgAt, oxygenAt, readArm, readEcg, readOxygen, type ArmScene, type ArmSide, type OxygenChoice } from './oxygen';

export type Heard = Addressee | 'buddy';
export interface GradeContext { case: Case; steps: Step[]; current: number; slots: MatchSlots; done: ReadonlySet<string>;
  pending: ReadonlySet<string>; arrived?: boolean; held?: boolean; next?: (read: SentenceReading) => GradeContext;
  eta?: number | null; budget?: LineBudget }
// done: 'stepId/pointId' keys of points already done (hit, tapped or prefilled)
// pending: keys of the points of steps before `current` that apply to the case and are not done yet, so a trainee going
// back for a forgotten or nudged point is read there, not as a step ahead (Task 10 fix round 1 ruling)
// arrived: the crew has arrived, so the call is over (Task 10 post-breaker ruling); left out, a run past the call's steps
// (current 4 on, or a preparation point done) has. held: the run's last line, before arrival, read only scene steps
// through statements, so a second such line arrives (arrival (e), below).
// next: the context for the line's following sentence, once `read` has been applied: `current` (and so `pending`) at the
// furthest step the line has reached (Task 10 fix round 2 ruling: a line moves the run as its sentences do, within its
// 2-step cap, so step 2's local terms hold for "…May I know what happened? Did he fall from a height?" typed while still
// at step 1). `done` stays as the line began. The run engine supplies it, and it is stateful: call it once per sentence
// except the last, in order, each time with that sentence's final reading (fix round 3). A context built by hand
// (tests, ctxAt) has none, and the line reads from its start.
// eta: the ETA in minutes the tester would give now (10 in a drill), which `slots` were filled at; the smart tester
// sends it (Plan 3 D17). Left out, it is unknown.
// budget: the trainee line's one budget for slow readings, shared by every read of the line (lineBudget, below). The
// engine gives one per sendLine; a context built by hand has none.
// partPos: where each of `parts` was found, in the same order (Task 10 carry: parts read in one sentence keep their own
// places, so a part-order slip inside one sentence is seen). Optional, so a grader that can't say gives every part `pos`.
export interface PointReading { step: string; point: string; parts: string[]; whole: boolean; missing: string[]; pos: number;
  partPos?: number[] }
/** Why the call ended at a sentence (the post-breaker ruling's (a) to (e)): it prepared (a preparation point whole, or
 *  two items); it was said to a buddy, the crew or the tester; its line names two points of one scene step; the call was
 *  finished and it read a scene step (a question only about the step next); or it is the second line in a row to read
 *  only scene steps through statements. On the last three the run's held line is read first (run.ts sendLine). */
export type Arrival = 'preparation' | 'listener' | 'twoPoints' | 'callDone' | 'secondLine';
// reask: on scene, the sentence re-asks what is already done at the run's step (or before) while that step still has a
// point to do, and was read by a step ahead: a "spill", such as "Sir, can you hear me?" asked again at LOC and read as
// the airway's response. It credits that step ahead, but it never moves the line on (Task 10 fix round 3, N1). Never on
// the phone, where a line moving on from an unfinished radio call to the caller is no re-ask (fix round 4, NB2).
// arrives: the crew arrives at this sentence, which is read as on scene, as is the rest of its line.
// dropped: before arrival, the sentence read only a scene step, so it reads nothing; 'statement' counts toward (e).
// question: the sentence is a question (isQuestion), so one that reads nothing keeps "Not sure what this is." in the
// route, while an unread statement drops out (Plan 3 ruling D25).
// arm: the BP arm the sentence gives (readArm: an allowed arm it credits, else a ruled-out one it names as the BP arm),
// which the run grades a bp-arm hit on (Plan 3 ruling D23, Task 2 fix round 1).
// smart: the smart tester credited the sentence's points, where the keyword rules read nothing (Plan 3 D12), so the run
// marks its line (D15). The keyword grader never sets it.
// All six are optional: a grader that can't tell leaves them out.
export interface SentenceReading { text: string; step: string | null; addressee: Heard | 'unclear' | null; points: PointReading[];
  oxygen: OxygenChoice | null; ecg: '12-lead' | '4-lead' | null; reask?: true; arrives?: Arrival; dropped?: 'statement' | 'question';
  question?: true; arm?: ArmSide | null; smart?: true }

/** One trainee line's budget for a grader that asks something slow (the smart tester, Plan 3 D14), shared by every
 *  read of the line: sendLine reads a line in up to four parts (the line, its call part, the held line again and its
 *  rest), so a bad line costs one budget, not one per read. `deadline(ms)` starts the line's clock at its first call and
 *  gives every later call the same deadline, which settles once the time is up; `expired` says it has. The engine
 *  closes the budget once the line is applied, which clears its timer. */
export interface LineBudget { readonly expired: boolean; deadline(ms: number): Promise<void>; close(): void }

/** A new line's budget (LineBudget): no timer runs until a grader asks for the deadline. */
export function lineBudget(): LineBudget {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due: Promise<void> | undefined;
  let expired = false;
  return {
    get expired() { return expired; },
    deadline(ms) {
      due ??= new Promise(resolve => {
        timer = setTimeout(() => {
          expired = true;
          timer = undefined;
          resolve();
        }, ms);
      });
      return due;
    },
    close() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** The last call-taking step: steps 1 (respond call) and 2 (call caller) are said on the phone. */
export const LAST_CALL_STEP = 2;
/** Whether the crew is on scene: past preparation, which ends "You've arrived on scene" (Task 10 fix round 3). A step
 *  of order 4 on is a scene step. */
export const onScene = (current: number): boolean => current > 3;
/** Whether the call is over for a context: its own `arrived`, else, as the engine counts an older save (run.ts
 *  arrivedOf), a run past preparation or with preparation done. */
export const arrivedIn = (ctx: GradeContext): boolean => ctx.arrived ?? (onScene(ctx.current)
  || ctx.steps.some(s => s.order === LAST_CALL_STEP + 1 && [...ctx.done].some(k => k.startsWith(`${s.id}/`))));
/** The words a question opens with, so a question dictated with no "?" is still one (fix round 5, post-breaker ruling). */
const QUESTION_WORDS: ReadonlySet<string> = new Set(['is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will',
  'would', 'has', 'have', 'any', 'how', 'what', 'where', 'when', 'who', 'why', 'which']);
/** The words that open a question only before "I": "May I know your name", "Should I…", "Am I…", "Shall I…", while
 *  "May be COPD." and "Should be fine." are statements (Task 1 review round 1). */
const BEFORE_I: ReadonlySet<string> = new Set(['may', 'should', 'am', 'shall']);
/** Words before a question that don't stop it being one: "OK, is there any bleeding". */
const FILLERS: ReadonlySet<string> = new Set(['ok', 'okay', 'and', 'also', 'so']);
/** Who a sentence before arrival is said to only once the crew is there (arrival (b)). */
const ARRIVAL_LISTENERS: ReadonlySet<Heard> = new Set<Heard>(['headBuddy', 'armBuddy', 'buddy', 'crew', 'tester']);
/** How a sentence is read: `arrived` overrides the context's (interpret sets it from the sentence the call ends at);
 *  `keep` reads a scene step before arrival instead of dropping it (interpret's look at the whole line). */
export interface LineView { arrived?: boolean; keep?: boolean }
export interface Interpretation { sentences: SentenceReading[] }
/**
 * The seam for Plan 3's Claude API tester: anything that turns a line into readings, one SentenceReading per sentence, in
 * order. The engine calls interpret once per line. A grader that reads sentence by sentence should read each one
 * against the context `ctx.next` returns for the sentence before it (when it is given), so local terms, `pending` and
 * the window of steps ahead follow the line as it moves (Task 10 fix round 2). `next` is stateful: call it once per
 * sentence, in order, with that sentence's final reading, and never ahead or twice (fix round 3). A grader may add
 * credit to a sentence after passing its first reading to `ctx.next`, as the smart grader does; it must never remove
 * credit. A grader that reads the line in one go may read every sentence against `ctx`, the run as the line began.
 * Mark a re-ask that spilled to a step ahead with `reask`, so it never moves the line on, and a question with
 * `question`, so the route keeps it when it reads nothing (D25); name the BP arm a sentence says in `arm`, or a bp-arm
 * hit is graded as naming none (D23). Keep the call and the scene apart as the keyword grader does (Task 10
 * post-breaker ruling): until `ctx.arrived`, mark the sentence the call ends at with `arrives`, and drop (and mark
 * `dropped`) any other that reads only a scene step; once arrived, a sentence the call would take reads nothing.
 */
export interface Grader { readonly id: string; interpret(line: string, ctx: GradeContext): Promise<Interpretation> }

/** Step orders in the order a sentence tries them: current, the next two, back down to 1, then the rest ahead. */
export function stepPriority(current: number, total: number): number[] {
  const order = [current, current + 1, current + 2];
  for (let n = current - 1; n >= 1; n--) order.push(n);
  for (let n = current + 3; n <= total; n++) order.push(n);
  return order.filter(n => n >= 1 && n <= total);
}

/** The role of the first reply whose `on` names the point or one of its parts ('pointId.partId'). */
export function replyRole(step: Step, pointId: string): Role | null {
  return step.replies.find(r => r.on.some(on => on === pointId || on.startsWith(`${pointId}.`)))?.role ?? null;
}

// ---- Addressee ------------------------------------------------------------------------------------------

/** The words that speak to the patient; softBreaks (Plan 3 Task 4) breaks a dictated line before them too. */
export const PATIENT_WORDS: readonly string[] = ['sir', "ma'am", 'madam', 'mdm', 'mr', 'ms', 'encik', 'cik', 'uncle', 'auntie', 'aunty'];
// "Medic Awas tag" and "medic alert(s)" or "medic-alert" name the patient's tag, not the buddy (ruling D1).
const MEDIC = 'medic(?![\\s-]*(?:awas|alerts?|tags?)(?![a-z0-9]))';
// Regex sources, blanked in this order, so a phrase goes before the words inside it: "arm buddy" (also "arm-buddy" and
// "armbuddy") is never also "buddy", nor "ops ctr" also "ops".
const ADDRESSEE_WORDS: readonly (readonly [string, Heard])[] = [
  ['arm[ -]?buddy', 'armBuddy'], ['head[ -]?buddy', 'headBuddy'], ['buddy', 'buddy'], ['buddies', 'buddy'], [MEDIC, 'buddy'],
  ['ops ctr', 'opsCtr'], ['ops centre', 'opsCtr'], ['ops center', 'opsCtr'], ['ops', 'opsCtr'],
  ['crew', 'crew'], ['guys', 'crew'], ['tester', 'tester'], ['examiner', 'tester'], ['caller', 'caller'],
  ...PATIENT_WORDS.map(w => [w, 'patient'] as const),
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole words, never stems, so "medic" never hits "medication" (ruling D1).
const wordRe = (source: string) => new RegExp(`(?<![a-z0-9])(?:${source})(?![a-z0-9])`, 'g');
const ADDRESSEE_RES = ADDRESSEE_WORDS.map(([source, heard]) => ({ heard, re: wordRe(source) }));

/**
 * Every addressee in normalized text, in the order they appear, and the text with each one blanked to spaces, so
 * positions still line up with the normalized sentence. The last word of the patient's call name is tried last.
 */
function findAddressees(normalized: string, callName: string): { heard: Heard[]; rest: string; firstAt: number | null } {
  const last = normalizeLine(callName).split(' ').at(-1) ?? '';
  const words = last === '' ? ADDRESSEE_RES : [...ADDRESSEE_RES, { heard: 'patient' as const, re: wordRe(escapeRe(last)) }];
  const found: { at: number; heard: Heard }[] = [];
  let rest = normalized;
  for (const { heard, re } of words) {
    rest = rest.replace(re, (m: string, at: number) => {
      found.push({ at, heard });
      return ' '.repeat(m.length);
    });
  }
  found.sort((a, b) => a.at - b.at);
  return { heard: found.map(f => f.heard), rest, firstAt: found[0]?.at ?? null };
}

/** Punctuation and fillers a sentence may open with before its addressee: "OK, crew, …", "And buddy, …". */
const LEADING_FILLERS = /^(?:[^a-z0-9]*(?:ok|okay|and|also|so)(?![a-z0-9]))*[^a-z0-9]*/;

/** Who a sentence opens by speaking to, past the fillers ("Crew, please don…"), or null: only an addressee said first
 *  says who a sentence is for; one named later ("Our crew is on the way.") is spoken of (Task 10 adjudication, LB1). */
function leadingListener(text: string, callName: string): Heard | null {
  const opening = normalizeLine(text).replace(LEADING_FILLERS, '');
  const { heard, firstAt } = findAddressees(opening, callName);
  return firstAt === 0 ? heard[0] ?? null : null;
}

/** A sentence normalized with its addressee words blanked to spaces: the text readSentence reads points and required
 *  words on, so an addressee is never a finding (ruling T05b). The smart grader reads its missing words on it too. */
export function withoutAddressees(text: string, callName: string): string {
  return findAddressees(normalizeLine(text), callName).rest;
}

/** Who a normalized sentence names as its listener: the first addressee in it (ruling D1), or null. */
export function detectAddressee(normalized: string, callName: string): Heard | null {
  return findAddressees(normalized, callName).heard[0] ?? null;
}

type Kind = 'patient' | 'tester' | 'buddy';
const kindOf = (t: Addressee): Kind | null =>
  t === 'patient' || t === 'tester' ? t : t === 'armBuddy' || t === 'headBuddy' ? 'buddy' : null;

/** The sentence's addressee, from what was heard and the points' own targets (`to`, else the first reply's role). The
 *  smart grader (smart.ts) resolves the sentences it credits by this same rule (Plan 3 D12). */
export function resolveAddressee(heard: Heard | null, targets: (Addressee | null)[]): Heard | 'unclear' | null {
  if (heard === null) {
    const kinds = new Set(targets.flatMap(t => (t === null ? [] : [kindOf(t)])).filter(k => k !== null));
    if (kinds.size >= 2) return 'unclear';   // R8: ask who it is for
    return targets.find(t => t !== null) ?? null;
  }
  if (heard === 'buddy') return targets.find(t => t === 'armBuddy' || t === 'headBuddy') ?? 'buddy';
  return heard;
}

// ---- Points ---------------------------------------------------------------------------------------------

/** How the BP arm reads a sentence in the run (oxygen.ts bpArm): the case's allowed arms, whether it is a question, and
 *  whether the step reading it (the BP arm's) is the run's. checkAt and readSentence build it alike, so the arm checkAt
 *  reads the point by is the arm the sentence reports (Task 2 fix round 2, M3). */
const armScene = (ctx: GradeContext, stepOrder: number | undefined, question: boolean): ArmScene =>
  ({ allowed: allowedArms(ctx.case), question, ownStep: stepOrder === ctx.current });

/**
 * Where a `check` point is read by what it checks, or −1, so the device terms in oxygen.ts are the one source for both.
 * - oxygen: a device other than `none`, or a flow; `none` only in a sentence that also says "oxygen" or "o2" (never the
 *   "o2" inside "spo2"), so "SpO2 on room air" and "Suction not required." are not oxygen choices.
 * - ecg: any ECG type named.
 * - arm: the BP arm the sentence gives (armAt, Task 2 fix rounds 1 and 2): an allowed arm named with "bp" or "blood
 *   pressure", whatever else it says and questions too, or named on the point's own step without BP; else a ruled-out
 *   arm tied to the BP ("BP on the left arm", "left arm for the BP") in a statement, with no negation in the tie's own
 *   clause, before or after it, and no restriction beside it or in that clause (graded Wrong; final review, I1). So "Right arm, no injuries." at the RBS is no BP arm, and an
 *   arm without BP is never Wrong. This alone reads the point: readPoint reads it only
 *   where this finds an arm, so its match and local terms serve `pos`, a tapped hit's sentence (run.ts saidIn) and any
 *   grader that reads terms.
 */
function checkAt(step: Step, m: MustHit, text: string, ctx: GradeContext, question: boolean): number {
  if (m.check === 'ecg') return ecgAt(text);
  if (m.check === 'arm') return armAt(text, armScene(ctx, step.order, question));
  if (m.check !== 'oxygen') return -1;
  const o = readOxygen(text);
  if (o === null) return -1;
  const counts = (o.device !== null && o.device !== 'none') || o.flow !== null || termAt(text, 'oxygen') >= 0 || termAt(text, 'o2') >= 0;
  return counts ? oxygenAt(text) : -1;
}

/** How one point reads in the (addressee-stripped) normalized text, or null when it doesn't count. `question`: the
 *  sentence is one (isQuestion), for checkAt. */
function readPoint(step: Step, m: MustHit, text: string, ctx: GradeContext, question: boolean): PointReading | null {
  if (m.when !== undefined && !conditionHolds(ctx.case, m.when)) return null;
  const found = (term: string) => matchAt(text, [[term]], ctx.slots) >= 0;
  if ((m.negatives ?? []).some(found)) return null;
  const accept = (m.accept ?? []).flatMap(a => a.match);
  const local = step.order === ctx.current ? (m.local ?? []) : [];
  const matchedAt = matchAt(text, [...m.match, ...local, ...accept], ctx.slots);
  const checkedAt = checkAt(step, m, text, ctx, question);
  // the BP arm is read only where checkAt finds the arm the sentence gives (Task 2 fix round 1), though a term names one
  if (m.check === 'arm' && checkedAt < 0) return null;
  const accepted = matchAt(text, accept, ctx.slots) >= 0;
  const partsAt = (m.parts ?? []).map(p => ({ id: p.id, at: matchAt(text, p.match, ctx.slots) }));
  const read = partsAt.filter(p => accepted || p.at >= 0);   // a matched accept counts every part
  if (matchedAt < 0 && checkedAt < 0 && read.length === 0) return null;
  const pos = Math.min(...[matchedAt, checkedAt, ...partsAt.map(p => p.at)].filter(i => i >= 0));
  return {
    step: step.id, point: m.id, parts: read.map(p => p.id), whole: matchedAt >= 0 || checkedAt >= 0,
    missing: (m.requiredWords ?? []).filter(w => !found(w)),
    pos, partPos: read.map(p => (p.at >= 0 ? p.at : pos)),   // a part only the accept counted sits where the point does
  };
}

/**
 * Reads one sentence. The first step to read a point still to do takes it, tried in this order, so a finished step never
 * swallows the next step's opening and a point gone back for is credited where it belongs (late, as an Order fault):
 * 1. the current step, for a point not yet done;
 * 2. an earlier step, nearest first, for one of its pending points (Task 10 fix round 1 ruling), unless the first of
 *    the next two steps to read a point not yet done credits more of the sentence (keepsAhead);
 * 3. the next two steps, for a point not yet done.
 * Otherwise the first step in priority order with any counting point takes it, as a re-ask. The taking step takes all
 * its counting points. Addressee words are stripped before points are matched, because an addressee is never a
 * finding: "arm buddy" is not the arm (ruling T05b).
 *
 * The call and the scene (Task 10 fix round 3, the post-breaker ruling):
 * - Once arrived (`line.arrived`, else the context's), the call is over. A sentence the call would take, were it still
 *   open (its points pending, so a point gone back for), reads nothing: no credit, no reply. So "May I know what
 *   happened to the patient?" said again is never the patient's "what is bothering you", nor "…prepare the IC and
 *   medication" the RBS pocket check (NB3). Any other sentence is read as if the call steps weren't there.
 * - Before arrival, a sentence that reads only a scene step (order 4 on) reads nothing, and is marked `dropped` as a
 *   statement or a question (isQuestion); interpret decides where the call ends. Patient words (Sir, Ma'am, Uncle, the
 *   patient's name) are said to the caller. `line.keep` reads the scene step instead, for interpret's look at the line.
 */
export function readSentence(text: string, ctx: GradeContext, line: LineView = {}): SentenceReading {
  const normalized = normalizeLine(text);
  const { heard, rest } = findAddressees(normalized, ctx.case.patient.callName);
  const question = isQuestion(text, rest);
  const byOrder = new Map(ctx.steps.map(s => [s.order, s]));
  const readings = stepPriority(ctx.current, ctx.steps.length).flatMap(order => {
    const step = byOrder.get(order);
    if (step === undefined) return [];
    const points = step.mustHit.flatMap(m => {
      const reading = readPoint(step, m, rest, ctx, question);
      return reading === null ? [] : [{ reading, target: m.to ?? replyRole(step, m.id) }];
    });
    return [{ step, points }];
  });
  type StepReading = (typeof readings)[number];
  const key = (r: StepReading, p: StepReading['points'][number]) => `${r.step.id}/${p.reading.point}`;
  const toDo = (r: StepReading) => r.points.some(p => !ctx.done.has(key(r, p)));
  const callStep = (r: StepReading) => r.step.order <= LAST_CALL_STEP;
  const scene = onScene(ctx.current);
  const arrived = line.arrived ?? arrivedIn(ctx);
  // on scene a done call point is no re-ask (fix round 3, guard N-c)
  const readable = (r: StepReading) => !scene || !callStep(r);
  // NB3: once arrived, the sentence is read as if the call were still open, its points still to do pending (`pending`
  // lists none then), and it reads nothing if the call takes it. Any other step takes it just as with the call closed:
  // the call's steps are the farthest back, so they win `back` only when no nearer step is pending.
  let taken = pick((r, k) => ctx.pending.has(k) || (arrived && callStep(r) && !ctx.done.has(k)));
  if (taken !== undefined && arrived && callStep(taken)) taken = undefined;
  // before arrival a sentence reading a scene step is dropped; interpret ends the call where the ruling says. So is one
  // reading a lone preparation item ("Keep him warm with a blanket."), which is no preparation (prepares)
  let dropped: 'statement' | 'question' | undefined;
  if (taken !== undefined && !arrived && line.keep !== true && onScene(taken.step.order)) {
    dropped = question ? 'question' : 'statement';
    taken = undefined;
  } else if (taken !== undefined && !arrived && line.keep !== true && taken.step.order === LAST_CALL_STEP + 1
    && !prepares(taken.points.map(p => p.reading))) taken = undefined;
  const points = taken?.points ?? [];
  // a re-ask that spilled ahead, on scene (NB2: never on the phone): the run's step still has a point to do, what the
  // sentence reads there (or before) is all done, and a step ahead took it. Moving on from a finished step is not one.
  const here = byOrder.get(ctx.current);
  const unfinished = here !== undefined && here.mustHit.some(m => (m.when === undefined || conditionHolds(ctx.case, m.when))
    && !ctx.done.has(`${here.id}/${m.id}`));
  const reask = scene && unfinished && taken !== undefined && taken.step.order > ctx.current
    && readings.some(r => r.step.order <= ctx.current && readable(r) && r.points.length > 0 && !toDo(r));
  return {
    text, step: taken?.step.id ?? null, points: points.map(p => p.reading), oxygen: readOxygen(rest), ecg: readEcg(rest),
    arm: readArm(rest, armScene(ctx, taken?.step.order, question)),
    // before arrival the patient's honorifics and name are the caller's: the trainee asks about the patient on the phone
    addressee: resolveAddressee(!arrived && heard[0] === 'patient' ? 'caller' : heard[0] ?? null, points.map(p => p.target)),
    ...(reask ? { reask: true as const } : {}), ...(dropped === undefined ? {} : { dropped }), ...(question ? { question: true as const } : {}),
  };

  /**
   * The step that takes the sentence, with `isPending` the points gone back for: an earlier step's pending point
   * (nearest step first), else the current step or one of the next two with a point not yet done (keepsAhead decides
   * between the two); else, as a re-ask, the first step in priority order that reads anything.
   */
  function pick(isPending: (r: StepReading, k: string) => boolean): StepReading | undefined {
    const back = readings.find(r => r.step.order < ctx.current && r.points.some(p => isPending(r, key(r, p))));
    // the current step, else the first of the next two, with a point not yet done (pass 1 before pending, Task 5)
    const forward = readings.find(r => r.step.order >= ctx.current && r.step.order <= ctx.current + 2 && toDo(r));
    return (back !== undefined && forward !== undefined ? (keepsAhead(back, forward, isPending) ? forward : back) : back ?? forward)
      ?? readings.find(r => r.points.length > 0);
  }
  /** What the sentence would credit in a step: each point still open there counts 1 read whole, and 1 per part read. */
  function credits(r: StepReading, open: (k: string) => boolean): { n: number; whole: boolean } {
    const read = r.points.filter(p => open(key(r, p))).map(p => p.reading);
    return { n: read.reduce((n, p) => n + Math.max(p.whole ? 1 : 0, p.parts.length), 0), whole: read.some(p => p.whole) };
  }
  /**
   * Whether the step ahead keeps a sentence that a pending point of an earlier step also reads. The earlier step takes
   * it unless the step ahead credits more of it, or as much with a whole point against parts alone, or as much and as
   * whole while nearer the run. So the notes' next line ("…monitoring of patient every 5 mins till ambulance arrives.")
   * is never taken by an undone point from long ago that shares one word ("monitor"), while a point gone back for is
   * still read where it belongs (Task 10 fix round 1).
   */
  function keepsAhead(earlier: StepReading, next: StepReading, isPending: (r: StepReading, k: string) => boolean): boolean {
    const b = credits(earlier, k => isPending(earlier, k));
    const a = credits(next, k => !ctx.done.has(k));
    if (a.n !== b.n) return a.n > b.n;
    if (a.whole !== b.whole) return a.whole;
    return next.step.order - ctx.current < ctx.current - earlier.step.order;
  }
}

/** Whether a reading of preparation is the crew preparing, for arrival (a): a point said whole ("don gloves and mask"),
 *  or two items of the B.B.O.L.T.Z. or more. One item alone ("a blanket") may be advice to the caller. */
const prepares = (points: PointReading[]): boolean =>
  points.some(p => p.whole) || points.reduce((n, p) => n + p.parts.length, 0) >= 2;

/**
 * Whether a sentence is a question, for arrival (e): it ends with "?", or opens with a question word, whole, once the
 * addressee words (blanked in `rest`) and the fillers (ok, and, also, so) before it are set aside, so "OK, is there any
 * bleeding" dictated with no "?" is one, as is one that opens "May I", "Should I", "Am I" or "Shall I" (BEFORE_I).
 * "Do not move" and "does not" open statements (the post-breaker ruling).
 */
function isQuestion(text: string, rest: string): boolean {
  if (/\?[?!.]*$/.test(text.trim())) return true;
  const words = rest.split(/[^a-z0-9']+/).filter(w => w !== '');
  while (words.length > 0 && FILLERS.has(words[0] ?? '')) words.shift();
  const [first, second] = words;
  if (first === undefined) return false;
  if (BEFORE_I.has(first)) return second === 'i';
  return QUESTION_WORDS.has(first) && !((first === 'do' || first === 'does') && second === 'not');
}

/**
 * Where a line said before arrival ends the call, and why (the post-breaker ruling), from its sentences read as the run
 * began with nothing dropped (`pre`): the first sentence that prepares (a) or is said to a buddy, the crew or the tester
 * (b); else the first that reads a scene step, when the line names two points of one scene step (c) or when the run's
 * last line was held and this one too reads only scene steps, at least one through a statement (e); or the first scene
 * statement, or question about a step within the next two, once the call is finished, by the line's earlier sentences
 * if need be (d). Null: the call goes on.
 */
function arrivalOf(pieces: string[], pre: SentenceReading[], ctx: GradeContext): { at: number; why: Arrival } | null {
  const order = (r: SentenceReading): number => ctx.steps.find(s => s.id === r.step)?.order ?? 0;
  const callName = ctx.case.patient.callName;
  const first = pre.flatMap((r, i): { at: number; why: Arrival }[] => {
    if (order(r) === LAST_CALL_STEP + 1 && prepares(r.points)) return [{ at: i, why: 'preparation' }];
    // (b) as said to (LB1): a buddy, the crew or the tester addressed first; or one mentioned in a sentence that itself
    // reads a step past the call ("My buddy will do a head grip on you…"), never in a phone line ("Our crew is on the way.")
    const lead = leadingListener(pieces[i] ?? '', callName);
    const named = order(r) > LAST_CALL_STEP && findAddressees(normalizeLine(pieces[i] ?? ''), callName).heard.some(h => ARRIVAL_LISTENERS.has(h));
    return (lead !== null && ARRIVAL_LISTENERS.has(lead)) || named ? [{ at: i, why: 'listener' }] : [];
  })[0] ?? null;
  const scene = pre.findIndex(r => onScene(order(r)));
  if (scene < 0 || (first !== null && first.at < scene)) return first;
  const named = new Map<string, Set<string>>();
  for (const r of pre) if (onScene(order(r))) for (const p of r.points) named.set(p.step, (named.get(p.step) ?? new Set()).add(p.point));
  const statement = (r: SentenceReading, i: number) =>
    onScene(order(r)) && !isQuestion(pieces[i] ?? '', findAddressees(normalizeLine(pieces[i] ?? ''), callName).rest);
  const onlyScene = pre.every(r => r.points.length === 0 || onScene(order(r))) && pre.some(statement);
  // (d) by a statement, or by a question about the step the run goes to next (within its next two): a finished call's
  // "Is there any bleeding?" is still asked of the caller, so a medical call typed line by line stays on the phone (the
  // ruling's test 4), while "Are there any witnesses?" after it is the scene's
  const told = pre.findIndex((r, i) => statement(r, i) || (onScene(order(r)) && order(r) <= ctx.current + 2));
  const said = new Set(pre.slice(0, Math.max(told, 0)).flatMap(r => r.points.map(p => `${p.step}/${p.point}`)));
  const callDone = ctx.steps.filter(s => s.order === LAST_CALL_STEP).every(s => s.mustHit.every(m =>
    (m.when !== undefined && !conditionHolds(ctx.case, m.when)) || ctx.done.has(`${s.id}/${m.id}`) || said.has(`${s.id}/${m.id}`)));
  const found: { at: number; why: Arrival }[] = [
    // the held line is read first only on (e), so (e) comes first when another trigger ends the call at its sentence
    ...(ctx.held === true && onlyScene ? [{ at: scene, why: 'secondLine' as const }] : []),
    ...(first === null ? [] : [first]),
    ...([...named.values()].some(points => points.size >= 2) ? [{ at: scene, why: 'twoPoints' as const }] : []),
    ...(callDone && told >= 0 ? [{ at: told, why: 'callDone' as const }] : []),
  ];
  return found.reduce<{ at: number; why: Arrival } | null>((best, x) => (best === null || x.at < best.at ? x : best), null);
}

/**
 * Ruling P17: a required word that any sentence of the line reading the same point found clears it for every one of
 * them, so the notes' two-sentence sound-out ("…from the front. …do not move your head.") lacks nothing.
 */
function wholeLineMissing(sentences: SentenceReading[]): SentenceReading[] {
  const still = new Map<string, string[]>();   // 'step/point' → the required words no sentence found
  for (const p of sentences.flatMap(s => s.points)) {
    const key = `${p.step}/${p.point}`;
    const prev = still.get(key);
    still.set(key, prev === undefined ? p.missing : prev.filter(w => p.missing.includes(w)));
  }
  return sentences.map(s => ({ ...s, points: s.points.map(p => ({ ...p, missing: still.get(`${p.step}/${p.point}`) ?? p.missing })) }));
}

export const keywordGrader: Grader = {
  id: 'keywords',
  // splitSentences runs on the raw line, before normalizeLine folds its newlines (Task 4). Each sentence is read against
  // the run as the sentences before it left it (ctx.next, Task 10 fix round 2). Before arrival, the line is first read
  // whole as the run began, nothing dropped, to find the sentence the call ends at (arrivalOf); from there on the line
  // is read as on scene (the post-breaker ruling).
  async interpret(line, ctx) {
    const pieces = splitSentences(line);
    const ends = arrivedIn(ctx) ? null : arrivalOf(pieces, pieces.map(x => readSentence(x, ctx, { arrived: false, keep: true })), ctx);
    const read: SentenceReading[] = [];
    let at = ctx;
    for (const [i, sentence] of pieces.entries()) {
      const before = read.at(-1);
      if (before !== undefined) at = at.next?.(before) ?? at;
      const r = readSentence(sentence, at, ends !== null && i >= ends.at ? { arrived: true } : arrivedIn(ctx) ? {} : { arrived: false });
      read.push(ends !== null && i === ends.at ? { ...r, arrives: ends.why } : r);
    }
    return { sentences: wholeLineMissing(read) };
  },
};

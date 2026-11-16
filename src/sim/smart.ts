// The smart tester's core (Plan 3 Task 8): a grader behind the Grader seam that reads each line by the keyword rules
// first, then asks a transport about only the sentences those rules read nothing for (ruling D12). It can only add
// credit, never take any away. A failure, a slow answer, the cap or being offline leaves the keyword reading (D14). A
// verdict is cached for the grader's run, so a re-read reads the same (D15). Only what D17 allows is sent, with the
// case's own values masked out of each sentence first. The transport (Task 9's Claude call) and whether the device is
// online come in through SmartOptions. Pure: no window, document or preact, nothing from src/smart or src/voice.
import { CONDITIONS, conditionHolds, type Addressee, type Case, type MustHit, type Step } from '../data/schema';
import {
  LAST_CALL_STEP, PATIENT_WORDS, arrivedIn, detectAddressee, keywordGrader, lineBudget, replyRole, resolveAddressee,
  withoutAddressees, type GradeContext, type Grader, type LineBudget, type PointReading, type SentenceReading,
} from './grader';
import { matchAt, normalizeLine } from './match';

/** How long one check may take before the line keeps its keyword reading (D14). */
export const SMART_TIMEOUT_MS = 6000;
/** The most checks one grader, so one run, sends (D14). */
export const SMART_MAX_CHECKS = 40;

/** A point the smart tester may credit: its key ('stepId/pointId'), its label, and its parts' ids and labels. */
export interface SmartPoint { key: string; label: string; parts: { id: string; label: string }[] }
/** The case facts a check carries (D17): never the patient's name, call name or IC, nor the address. */
export interface SmartFacts { complaint: string; type: 'medical' | 'trauma'; sex: 'male' | 'female'; race: string; age: number;
  eta: number | null; conditions: string[] }
/** One check, exactly what is sent and never more (D17): the run's step, whether the crew has arrived, the unread
 *  sentences (masked) with their indices in the line, the points that may be credited, and the case facts. */
export interface SmartRequest { step: { order: number; name: string }; arrived: boolean; sentences: { index: number; text: string }[];
  candidates: SmartPoint[]; facts: SmartFacts }
/** What the tester heard: for a sentence by its index, the points it says (by key), and for a parted point the parts. */
export interface SmartVerdict { sentences: { index: number; points: { key: string; parts: string[] }[] }[] }
export interface SmartUsage { inputTokens: number; outputTokens: number }
/** Sends one check. A null verdict is a failure: a refusal (D19), or an answer that isn't a verdict. */
export type SmartTransport = (req: SmartRequest) => Promise<{ verdict: SmartVerdict | null; usage: SmartUsage | null }>;
/** Why a check left the keyword reading, for the run's one toast (Task 9): the transport threw or rejected, it didn't
 *  answer within the budget, or its answer was no verdict (null, a refusal among them, or malformed). */
export type SmartFailure = 'error' | 'timeout' | 'invalid';
/**
 * `online()` says whether the device is online now, read before each check; offline, a line keeps its keyword reading
 * silently (D14). `onUsage` gets each answer's usage that came within the budget; `onFailure` each failed check's
 * kind, never offline and never at the cap. `timeoutMs` defaults to SMART_TIMEOUT_MS, `maxChecks` to SMART_MAX_CHECKS.
 */
export interface SmartOptions { transport: SmartTransport; online(): boolean; onUsage?(u: SmartUsage): void;
  onFailure?(kind: SmartFailure): void; timeoutMs?: number; maxChecks?: number }

// ---- What may be credited (D12) ----------------------------------------------------------------------------

interface Candidate { step: Step; m: MustHit; point: SmartPoint }

const applies = (c: Case, m: MustHit): boolean => m.when === undefined || conditionHolds(c, m.when);

/** The points the keyword grader could still credit at the run's step, with their steps (smartCandidates). */
function candidatesOf(ctx: GradeContext): Candidate[] {
  const arrived = arrivedIn(ctx);
  return [...ctx.steps].sort((a, b) => a.order - b.order).flatMap(step => {
    if ((step.order <= LAST_CALL_STEP) === arrived) return [];   // the call's steps before arrival, never after
    const near = step.order >= ctx.current && step.order <= ctx.current + 2;
    return step.mustHit.flatMap(m => {
      const key = `${step.id}/${m.id}`;
      if (m.check !== undefined || !applies(ctx.case, m) || ctx.done.has(key) || !(near || ctx.pending.has(key))) return [];
      return [{ step, m, point: { key, label: m.label, parts: (m.parts ?? []).map(p => ({ id: p.id, label: p.label })) } }];
    });
  });
}

/**
 * The points the smart tester may credit (D12), in step and point order: those the keyword grader could still credit
 * there. Each applies to the case, is not done, and is pending or in the run's step or the next two. Before arrival
 * they come only from the call's steps (orders 1 and 2), and after arrival never from those. A `check` point (oxygen,
 * ECG or BP arm) is never one: the device, the ECG type and the arm stay the keyword grader's to read and grade.
 */
export function smartCandidates(ctx: GradeContext): SmartPoint[] {
  return candidatesOf(ctx).map(c => c.point);
}

// ---- What is sent (D17) -------------------------------------------------------------------------------------

/** The case facts a check carries (D17), and nothing else: the complaint, the type, the patient's sex, race and age, the
 *  ETA, and the conditions that hold for the case. */
export function smartFacts(c: Case, eta: number | null): SmartFacts {
  const { sex, race, age } = c.patient;
  return { complaint: c.complaint, type: c.type, sex, race, age, eta, conditions: CONDITIONS.filter(k => conditionHolds(c, k)) };
}

/** The titles a name may follow ("Mdm Tan", "Uncle Lim"): the honorifics the addressee rules know, and mrs, miss and
 *  mister (final review, parked item 1: a title here only, never an addressee word). */
const TITLES: ReadonlySet<string> = new Set([...PATIENT_WORDS, 'mrs', 'miss', 'mister']);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One word as a pattern: any case, a straight or curly apostrophe, and a title's full stop optional ("Mdm." or "Mdm"). */
function termOf(word: string): string {
  const bare = word.replace(/\.$/, '');
  const term = (w: string): string => escapeRe(w).replace(/'/g, "['’]");
  return TITLES.has(bare.toLowerCase().replace(/’/g, "'")) ? `${term(bare)}\\.?` : term(word);
}
/** Any title, its full stop optional. */
const TITLE = `(?:${[...TITLES].sort((a, b) => b.length - a.length).map(termOf).join('|')})`;
/** A value's words: split at spaces and hyphens, so "Ah-Mui" is two (final review, parked item 1). */
const wordsOf = (value: string): string[] => value.trim().split(/[\s-]+/).filter(w => w !== '');
/** `words` as one whole phrase, after `lead`: at word boundaries, any case, any run of spaces or hyphens between the
 *  words, so "Tan Ah-Mui" and "Tan Ah Mui" are one phrase. */
const phrase = (words: string[], lead = ''): RegExp =>
  new RegExp(`(?<![a-z0-9])${lead}${words.map(termOf).join('[\\s-]+')}(?![a-z0-9])`, 'gi');
/** An NRIC's shape, whoever's it is: s, t, f, g or m, 2 digits, digits or x's (with a space or two among them), then a
 *  letter, so "S58xxxxB" typed one x short or "S12 xxxxxA" is still one. */
const NRIC = /(?<![a-z0-9])[stfgm]\d{2}(?: ?[\dx]+){1,2} ?[a-z](?![a-z0-9])/gi;
/** An NRIC with a space, full stop or hyphen before any of its 7 digits (or x's) and its letter, or with no letter:
 *  "S90-12345-A", "S90 12 34 5A", "S9012345", and the case's IC hyphenated, whole (final review, parked item 1). */
const NRIC_SPLIT = /(?<![a-z0-9])[stfgm](?:[ .-]?[\dx]){7}(?:[ .-]?[a-z])?(?![a-z0-9])/gi;
/** An NRIC's 7 digits alone, never 8 (a Singapore phone number), nor a piece of a figure ("1.2345678", "120/80"). */
const NRIC_DIGITS = /(?<![a-z0-9./])\d{7}(?![a-z0-9])/g;
/** A location piece that opens with its block: "Blk 2xx Compassvale St" is block "2xx", street "Compassvale St". */
const BLOCK_PIECE = /^(blk|block)\.?\s+(\S+)\s+(.+)$/i;

/** The masks for a case, in order (maskCase). */
function masksOf(c: Case): [RegExp, string][] {
  const { name, callName, ic } = c.patient;
  const last = wordsOf(callName).at(-1);
  const pieces = c.location.split(',').map(p => p.trim()).filter(p => /[0-9#]/.test(p));
  // the block alone ("Blk 2xx", "Block 2xx", "blk2xx") and the street alone ("Compassvale St"), before the area, so a
  // street holding the area's name ("Ang Mo Kio Ave 3") goes whole
  const blocks = pieces.flatMap((p): [RegExp, string][] => {
    const m = BLOCK_PIECE.exec(p);
    if (m === null) return [];
    return [[new RegExp(`(?<![a-z0-9])(?:blk|block)\\.?\\s*${escapeRe(m[2] ?? '')}(?![a-z0-9])`, 'gi'), 'the address'],
      [phrase(wordsOf(m[3] ?? '')), 'the address']];
  });
  return [
    ...(wordsOf(name).length > 0 ? [[phrase(wordsOf(name), `(?:${TITLE}\\s+)?`), 'the patient'] as [RegExp, string]] : []),
    ...(last === undefined ? [] : [
      [phrase(wordsOf(callName)), 'the patient'] as [RegExp, string],
      [phrase([last], `${TITLE}\\s+`), 'the patient'] as [RegExp, string],
    ]),
    [phrase([ic]), 'the IC'], [NRIC, 'the IC'], [NRIC_SPLIT, 'the IC'], [NRIC_DIGITS, 'the IC'],
    [new RegExp(`(?<![a-z0-9])${escapeRe(ic.slice(0, 3))}[a-z0-9]*(?![a-z0-9])`, 'gi'), 'the IC'],
    // its last 6 characters, with a space, full stop or hyphen before the letter allowed ("xxxxx A")
    [new RegExp(`(?<![a-z0-9])[a-z0-9]*${escapeRe(ic.slice(-6, -1))}[ .-]?${escapeRe(ic.slice(-1))}(?![a-z0-9])`, 'gi'), 'the IC'],
    ...[c.location, ...pieces].filter(p => p.trim() !== '').map(p => [phrase(wordsOf(p)), 'the address'] as [RegExp, string]),
    ...blocks,
    ...(c.area.trim() === '' ? [] : [[phrase(wordsOf(c.area)), 'the address'] as [RegExp, string]]),
  ];
}

/**
 * A sentence with the case's own values out of it (D17; review round 1, C1, I1 and M3; final review, parked item 1), at
 * word boundaries and in any case, in this order. Names go only as whole phrases, never one word alone, so "every 5 min"
 * or "Any wei?" is left as said even where a name holds "Min" or "Wei"; a phrase's words may be split by spaces or
 * hyphens ("Tan Ah-Mui"). A title is any of PATIENT_WORDS, mrs, miss or mister, its full stop optional.
 * 1. "the patient": an optional title and the patient's whole name; the call name; any title and the call name's last
 *    word ("Uncle Tan", "Mister Tan").
 * 2. "the IC": the IC; any NRIC-shaped token (NRIC: anyone's, and the IC typed short or split); one with a space, full
 *    stop or hyphen before any of its 7 digits and its letter, or with no letter (NRIC_SPLIT: "S90-12345-A", the case's
 *    IC hyphenated); 7 digits alone (NRIC_DIGITS, never a phone's 8); any word that starts with the IC's first 3
 *    characters; its last 6, with a space, full stop or hyphen before the letter allowed ("xxxxx A").
 * 3. "the address": the whole location, then each of its comma-separated pieces that holds a digit or "#" (the block and
 *    street, the unit), then the block alone ("Blk 2xx") and the street alone ("Compassvale St") of a piece that opens
 *    with its block, then the case's area or town ("Hougang", "Ang Mo Kio"), each as a whole phrase: D17 sends no part
 *    of the address. A landmark piece ("void deck") is left.
 */
export function maskCase(text: string, c: Case): string {
  return masksOf(c).reduce((out, [re, as]) => out.replace(re, as), text);
}

/** A sentence that ends with a title, which sentence splitting cut from the name after it ("Mdm. Tan, are you OK?"). */
const ENDS_IN_TITLE = new RegExp(`(?<![a-z0-9])${TITLE}$`, 'i');

/**
 * The sentence at `index` as it is sent: masked (maskCase), and, when the sentence before it ends with a title, its
 * opening call-name word too, so a title and its name stay together across the split (review round 1, M5).
 */
function maskedAt(sentences: SentenceReading[], index: number, c: Case): string | null {
  const sen = sentences[index];
  if (sen === undefined) return null;
  const text = maskCase(sen.text, c);
  const last = wordsOf(c.patient.callName).at(-1);
  if (last === undefined || !ENDS_IN_TITLE.test((sentences[index - 1]?.text ?? '').trim())) return text;
  return text.replace(new RegExp(`^(\\s*)${termOf(last)}(?![a-z0-9])`, 'i'), '$1the patient');
}

/** The check for the `unread` sentences of a line read at `ctx` (D17). Each sentence goes in masked (maskedAt), with its
 *  index in the line, which is how the verdict is matched back to it: the masked text never reaches the run. The ETA is
 *  the context's own (review round 1, M1), null when it is unknown. */
export function smartRequest(ctx: GradeContext, sentences: SentenceReading[], unread: number[]): SmartRequest {
  return {
    step: { order: ctx.current, name: ctx.steps.find(s => s.order === ctx.current)?.name ?? '' },
    arrived: arrivedIn(ctx),
    sentences: unread.flatMap(index => {
      const text = maskedAt(sentences, index, ctx.case);
      return text === null ? [] : [{ index, text }];
    }),
    candidates: smartCandidates(ctx),
    facts: smartFacts(ctx.case, ctx.eta ?? null),
  };
}

// ---- The merge ----------------------------------------------------------------------------------------------

/**
 * The indexes of the sentences the smart tester reads (D12): the keyword rules read no point in them and dropped none of
 * them. Before arrival, only those before the sentence the line's call ends at, when it ends there: past it the line is
 * on scene, where the call's points (the only candidates then) may never be credited.
 */
function unreadOf(sentences: SentenceReading[], ctx: GradeContext): number[] {
  const ends = arrivedIn(ctx) ? -1 : sentences.findIndex(s => s.arrives !== undefined);
  return sentences.flatMap((s, i) => (s.points.length === 0 && s.dropped === undefined && (ends < 0 || i < ends) ? [i] : []));
}

/**
 * The line's sentences with the verdict applied: each verdict entry, in order, for a sentence the smart tester reads
 * (unreadOf) that has no points yet, gives it the entry's points that are candidates (smartCandidates), each key once
 * and with only that point's own part ids. What the line's sentences already read is never credited again: not a point
 * without parts already read, nor a part already read, so a line is marked smart only for credit the keyword rules
 * didn't give, and the line's missing words (P17) stay theirs. A point with parts is read by the parts given (and needs
 * one still unread), one without whole; at place 0, missing the required words the sentence lacks once its addressee
 * words are blanked, as the keyword grader finds them (Phrase stays its call; review round 1, M2). The sentence takes
 * the first point's step and `smart`, and its addressee by the keyword rule (resolveAddressee over the points' targets;
 * before arrival the patient's words are the caller's, as readSentence hears them). Its oxygen, ECG, arm and question
 * stay as the keyword grader read them. Every other sentence is left as it was.
 */
export function mergeVerdict(sentences: SentenceReading[], v: SmartVerdict, ctx: GradeContext): SentenceReading[] {
  const open = new Set(unreadOf(sentences, ctx));
  const byKey = new Map(candidatesOf(ctx).map(c => [c.point.key, c]));
  const arrived = arrivedIn(ctx);
  // 'stepId/pointId' (read whole) and 'stepId/pointId/partId', for what the line's sentences have read so far
  const read = new Set(sentences.flatMap(s => s.points.flatMap(p => [...(p.whole ? [`${p.step}/${p.point}`] : []),
    ...p.parts.map(id => `${p.step}/${p.point}/${id}`)])));
  const out = [...sentences];
  for (const entry of v.sentences) {
    const sen = out[entry.index];
    if (sen === undefined || !open.has(entry.index) || sen.points.length > 0) continue;
    const text = normalizeLine(sen.text);
    const rest = withoutAddressees(sen.text, ctx.case.patient.callName);   // as readPoint reads required words (M2)
    const seen = new Set<string>();
    const credited = entry.points.flatMap(({ key, parts }): { reading: PointReading; target: Addressee | null }[] => {
      const c = byKey.get(key);
      if (c === undefined || seen.has(key)) return [];
      const own = c.m.parts ?? [];
      const ids = [...new Set(parts)].filter(id => own.some(p => p.id === id) && !read.has(`${key}/${id}`));
      if (own.length > 0 ? ids.length === 0 : read.has(key)) return [];
      seen.add(key);
      return [{
        reading: { step: c.step.id, point: c.m.id, parts: ids, whole: own.length === 0, pos: 0,
          missing: (c.m.requiredWords ?? []).filter(w => matchAt(rest, [[w]], ctx.slots) < 0) },
        target: c.m.to ?? replyRole(c.step, c.m.id),
      }];
    });
    const first = credited[0];
    if (first === undefined) continue;
    for (const { reading: p } of credited) {
      if (p.whole) read.add(`${p.step}/${p.point}`);
      for (const id of p.parts) read.add(`${p.step}/${p.point}/${id}`);
    }
    const heard = detectAddressee(text, ctx.case.patient.callName);
    out[entry.index] = { ...sen, step: first.reading.step, points: credited.map(r => r.reading),
      addressee: resolveAddressee(!arrived && heard === 'patient' ? 'caller' : heard, credited.map(r => r.target)), smart: true };
  }
  return out;
}

// ---- The grader ---------------------------------------------------------------------------------------------

type Answer = { verdict: SmartVerdict; usage: SmartUsage | null } | { verdict: null; usage: SmartUsage | null; failure: SmartFailure };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isUsage = (x: unknown): x is SmartUsage => isRecord(x) && isCount(x.inputTokens) && isCount(x.outputTokens);
/** Whether an answer's verdict has the verdict's shape, so a malformed one is a failure, never a throw. */
function isVerdict(x: unknown): x is SmartVerdict {
  return isRecord(x) && Array.isArray(x.sentences) && x.sentences.every((s: unknown) => isRecord(s) && Number.isInteger(s.index)
    && Array.isArray(s.points) && s.points.every((p: unknown) => isRecord(p) && typeof p.key === 'string'
      && Array.isArray(p.parts) && p.parts.every((id: unknown) => typeof id === 'string')));
}

function answerOf(res: unknown): Answer {
  if (!isRecord(res)) return { verdict: null, usage: null, failure: 'invalid' };
  const usage = isUsage(res.usage) ? res.usage : null;
  return isVerdict(res.verdict) ? { verdict: res.verdict, usage } : { verdict: null, usage, failure: 'invalid' };
}

/** One check, raced against the line's deadline (`due`). A throw, a rejection or an answer that is no verdict is a
 *  failure. Once the deadline has passed the check has failed, and a late answer is ignored: its resolve does nothing. */
function ask(transport: SmartTransport, req: SmartRequest, due: Promise<void>): Promise<Answer> {
  return new Promise(resolve => {
    void due.then(() => resolve({ verdict: null, usage: null, failure: 'timeout' }));
    new Promise<unknown>(answer => answer(transport(req))).then(
      res => resolve(answerOf(res)),
      () => resolve({ verdict: null, usage: null, failure: 'error' }),
    );
  });
}

/** The cache's key for a check: the request with no time in it (its ETA left out), so a retry of the line after the
 *  clock passes a minute is answered the same (review round 1, M4). */
function keyOf(req: SmartRequest): string {
  const { eta: _eta, ...facts } = req.facts;
  return JSON.stringify({ ...req, facts });
}

/** Calls one of the run's handlers. A handler's own error is its own: it never costs the line its reading. */
function tell(handler: () => void): void {
  try {
    handler();
  } catch {
    // the line still reads; the toast or the spend it was for is the handler's to recover
  }
}

/**
 * The smart grader (id 'smart'), one per run: its cache and its count of checks are its own. Each line is read by the
 * keyword grader first (which calls `ctx.next` as it always does). The sentences it read nothing for and dropped none
 * of (unreadOf) are sent as one check (smartRequest) when there are any and any point may be credited; the verdict is
 * merged in (mergeVerdict).
 * - **The cache** holds, by request (keyOf), each verdict and each failed check. The same line in the same context (the
 *   held line, a queue retry) reads the same with no second check, offline or past the cap too: by its verdict, or by
 *   the keyword rules, silently, for one that failed.
 * - **One budget a line** (review round 1, I2): every read of one trainee line shares the line's budget
 *   (`ctx.budget`, which the engine gives each sendLine; a read with none is a line of its own). Its deadline is
 *   `timeoutMs` from the line's first check, for all its checks together. Once a check of the line has failed, or the
 *   deadline has passed, the line sends no more checks: the rest of it keeps the keyword reading, so a bad line costs
 *   about one budget (D14).
 * - **Silent:** offline, or at `maxChecks`, the line keeps its keyword reading with no word.
 * - **A failure** (a throw, the deadline, or no verdict) calls `onFailure` with its kind, once a line.
 */
export function smartGrader(o: SmartOptions): Grader {
  const timeoutMs = o.timeoutMs ?? SMART_TIMEOUT_MS;
  const maxChecks = o.maxChecks ?? SMART_MAX_CHECKS;
  const cache = new Map<string, SmartVerdict | null>();   // null: the check failed, and is never sent again
  // each line's state, by its budget: whether it is over (a check failed or the time ran out), and whether onFailure
  // was told
  const lines = new WeakMap<LineBudget, { over: boolean; told: boolean }>();
  let checks = 0;
  return {
    id: 'smart',
    async interpret(line, ctx) {
      const k = await keywordGrader.interpret(line, ctx);
      const unread = unreadOf(k.sentences, ctx);
      if (unread.length === 0) return k;
      const req = smartRequest(ctx, k.sentences, unread);
      if (req.candidates.length === 0) return k;
      const key = keyOf(req);
      const budget = ctx.budget ?? lineBudget();
      const state = lines.get(budget) ?? { over: false, told: false };
      lines.set(budget, state);
      const fail = (kind: SmartFailure): void => {
        state.over = true;
        if (state.told) return;
        state.told = true;
        tell(() => o.onFailure?.(kind));
      };
      try {
        const cached = cache.get(key);
        if (cached === null) {   // asked before, and it failed: the keyword reading, with no second word
          state.over = true;
          return k;
        }
        if (cached !== undefined) return { sentences: mergeVerdict(k.sentences, cached, ctx) };
        if (!o.online() || checks >= maxChecks || state.over) return k;
        if (budget.expired) {
          fail('timeout');
          return k;
        }
        checks++;
        const answer = await ask(o.transport, req, budget.deadline(timeoutMs));
        const { usage } = answer;
        if (usage !== null) tell(() => o.onUsage?.(usage));
        if (answer.verdict === null) {
          cache.set(key, null);
          fail(answer.failure);
          return k;
        }
        cache.set(key, answer.verdict);
        return { sentences: mergeVerdict(k.sentences, answer.verdict, ctx) };
      } finally {
        if (ctx.budget === undefined) budget.close();   // a read of its own closes its own budget
      }
    },
  };
}

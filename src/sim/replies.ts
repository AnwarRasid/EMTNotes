// What the run says back: who speaks under which name, a case's findings as speech, the vitals for the oxygen given, the
// computed replies, and the canonical lines filled for a case. Pure: no window, document or preact.
import {
  CANONICAL_SLOTS, SAY_SLOT, conditionHolds, getFinding, type Case, type Condition, type MustHit, type Reply, type Role, type VitalKey,
} from '../data/schema';
import type { OxygenGiven, ReadingKey, Speaker } from '../progress/types';
import { splitSentences } from './match';
import { DEVICE_LABEL, DEVICE_SHORT } from './oxygen';

export const ROLE_LABEL: Record<Role, string> = {
  opsCtr: 'Ops Ctr', caller: 'Caller', patient: 'Patient', headBuddy: 'Head buddy', armBuddy: 'Arm buddy', tester: 'Tester',
};

/** What a system line (the activation) is shown and saved under; the debrief reads it to find a drill's opening line. */
export const DISPATCH = 'Dispatch';

/** The name a chat line is shown under: 'You', 'Dispatch', 'Mdm Tan, patient', 'Caller, son', 'Arm buddy'. */
export function speakerLabel(who: Speaker, c: Case): string {
  switch (who) {
    case 'you': return 'You';
    case 'system': return DISPATCH;
    case 'patient': return `${c.patient.callName}, patient`;
    case 'caller': return `Caller, ${c.caller.who}`;
    default: return ROLE_LABEL[who];
  }
}

/** Which vitals the buddies read: after-O2 only once a right oxygen that isn't `none` is on (spec §11). */
export function vitalsPhase(oxygen: OxygenGiven | null): 'roomAir' | 'afterO2' {
  return oxygen !== null && oxygen.right && oxygen.device !== 'none' ? 'afterO2' : 'roomAir';
}

export interface ReplyEnv { case: Case; oxygen: OxygenGiven | null; eta: number }
/** A reply's words, and the readings it adds to the vitals rail (o2 for SpO2 only: 'RA', 'NC'…). */
export interface Spoken { text: string; readings: { key: ReadingKey; value: string; o2: string | null }[] }

/**
 * A hypocount or temperature as a glucometer or thermometer shows it, always to one decimal: 6 → '6.0', 37.2 → '37.2'.
 * The one formatter for every place either is shown or stored (Task 8 fix round 1; Task 10's RunRecord.hypocount).
 */
export function oneDecimal(n: number): string {
  return n.toFixed(1);
}

/** The text with a capital first letter. The one helper for it in the simulator (run.ts and classify.ts use it too). */
export const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** A full stop after the text, unless it already ends a sentence, so a finding written with its stop never gets two.
 *  The one helper for it in the simulator. */
export const stop = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

// What an empty list says, by its last key; any other empty list is 'Nothing of note.' as the scene items are.
const EMPTY_LIST = {
  ntucp: 'No nasal flaring, tracheal tugging, accessory muscle use, cyanosis or pursed lips.',
  hazards: 'No hazards.',
  pockets: 'Nothing in the pockets.',
  items: 'Nothing of note.',
} as const;
function emptyList(path: string): string {
  const key = path.split('.').at(-1) ?? '';
  return Object.hasOwn(EMPTY_LIST, key) ? EMPTY_LIST[key as keyof typeof EMPTY_LIST] : EMPTY_LIST.items;
}
const HYPOCOUNT = 'findings.investigation.hypocount';

/**
 * A finding as the tester, patient or caller says it, or null when the case has none at that path. A string is spoken as
 * written; where the case writes a bare phrase ('fast and shallow'), it is finished as a sentence the way a list is, with
 * a capital and a full stop, so two replies merged into one chat line never run together.
 */
export function findingSpeech(c: Case, path: string): string | null {
  const value = getFinding(c, path);
  if (value === undefined) return null;
  const { rbs, investigation } = c.findings;
  switch (path) {
    case 'findings.rbs.jvd': return rbs.jvd ? 'JVD present.' : 'No JVD.';
    case 'findings.rbs.pedalEdema': return rbs.pedalEdema ? 'Pedal oedema present.' : 'No pedal oedema.';
    case 'findings.investigation.ecg': return stop(`${investigation.ecg.type}: ${investigation.ecg.reading}`);
    case HYPOCOUNT: return `Hypocount ${oneDecimal(investigation.hypocount)} mmol/L.`;
    case 'findings.investigation.bp': return stop(`BP ${investigation.bp}`);
    case 'findings.rbs.pockets': return rbs.pockets.length === 0 ? EMPTY_LIST.pockets : stop(`In the pockets: ${rbs.pockets.join(', ')}`);
  }
  if (typeof value === 'string') return value.trim() === '' ? null : stop(capitalise(value.trim()));
  if (Array.isArray(value) && value.every((x): x is string => typeof x === 'string')) {
    return value.length === 0 ? emptyList(path) : stop(capitalise(value.join(', ')));
  }
  return null;
}

const READING_TEXT: Record<VitalKey, (value: string, on: string) => string> = {
  spo2: (v, on) => `SpO2 ${v}% on ${on}.`,
  pr: v => stop(`PR ${v}`),
  rr: v => stop(`RR ${v}`),
  bp: v => stop(`BP ${v}`),
  temp: v => `Temp ${v}°C.`,
  crt: v => stop(`CRT ${v}`),
  skin: v => stop(`Skin ${v}`),
};

/** The buddies' readings, in key order, from the vitals for the oxygen on: 'SpO2 90% on nasal cannula. PR 112.' */
export function readingsSpeech(keys: VitalKey[], env: ReplyEnv): Spoken {
  const vitals = env.case.vitals[vitalsPhase(env.oxygen)];
  const device = env.oxygen?.device ?? 'none';
  const on = device === 'none' ? 'room air' : DEVICE_LABEL[device];
  const value = (key: VitalKey) => (key === 'temp' ? oneDecimal(vitals.temp) : String(vitals[key]));
  const readings = keys.map(key => ({ key, value: value(key), o2: key === 'spo2' ? DEVICE_SHORT[device] : null }));
  return { text: readings.map(r => READING_TEXT[r.key](r.value, on)).join(' '), readings };
}

function computedText(kind: Extract<Reply, { computed: unknown }>['computed'], env: ReplyEnv): string | null {
  switch (kind) {
    case 'eta': return `ETA ${env.eta} ${env.eta === 1 ? 'min' : 'mins'}.`;
    case 'ic': return `IC card: ${env.case.patient.name}, ${env.case.patient.ic}.`;
    case 'oxygen': {
      const o = env.oxygen;
      if (o === null) return null;
      if (o.device === 'none') return 'No oxygen for now.';
      return `${capitalise(DEVICE_LABEL[o.device])} on${o.flow === null ? '' : `, ${o.flow} L/min`}.`;
    }
  }
}

/**
 * What a reply says, or null when its finding is absent in the case (or, for the oxygen reply, no oxygen is given yet).
 * Vitals replies carry their readings, and so does the hypocount (ruling P21), so the run engine appends every one.
 */
export function replyText(r: Reply, env: ReplyEnv): Spoken | null {
  if ('text' in r) return { text: r.text, readings: [] };
  if ('vitals' in r) return readingsSpeech(r.vitals, env);
  const text = 'finding' in r ? findingSpeech(env.case, r.finding) : computedText(r.computed, env);
  if (text === null) return null;
  const hypocount = 'finding' in r && r.finding === HYPOCOUNT;
  return { text, readings: hypocount ? [{ key: 'hypocount', value: oneDecimal(env.case.findings.investigation.hypocount), o2: null }] : [] };
}

/** 'low SpO2 and high RR'; 'a, b and c'. */
export function joinSigns(signs: string[]): string {
  if (signs.length <= 1) return signs[0] ?? '';
  return `${signs.slice(0, -1).join(', ')} and ${signs.at(-1)}`;
}

type CanonicalSlot = (typeof CANONICAL_SLOTS)[number];
const CANONICAL_SLOT = new RegExp(`\\{(${CANONICAL_SLOTS.join('|')})\\}`, 'g');
// Step 17 tells each patient only their own way to move (findings.position.toward; notes s01 Position: sitting for
// SOB or chest pain, supine for low BP), and nothing where the position is already ideal.
const POSITION_ADVICE = {
  'sit-up': 'sitting up will make it easier for you to breathe',
  supine: 'lying flat is better for your low blood pressure',
} as const;
// Step 18's decision sentence for the case's plan, verbatim from notes s01 Decision Point (Task 10 fix round 1 ruling).
const DECISION_LINE = {
  'stay-and-treat': 'So, I will Stay & Treat to see whether I can initiate any protocols.',
  'load-and-go': 'It is a Load & Go case.',
} as const;

// Step 2's extra questions for the case, in this order (notes s01 Call: "If trauma, additional qns to ask"; Task 10
// canonical call slot ruling). Tele-CPR stays out: it hangs on the caller's answer.
const CALL_EXTRAS: readonly (readonly [Condition, string])[] = [
  ['unconscious', 'Is the patient breathing?'],
  ['trauma', 'Any critical injuries present?'],
  ['rta', 'What vehicles are involved in the accident?'],
];

function canonicalValues(c: Case, eta: number): Record<CanonicalSlot, string> {
  const toward = c.findings.position.toward;
  return {
    location: c.location,
    callText: c.callText,
    chiefComplaint: c.complaint.toLowerCase(),
    suspected: c.expected.decision.suspected,
    signs: joinSigns(c.expected.decision.signs),
    sex: c.patient.sex,
    race: c.patient.race,
    age: String(c.patient.age),
    ic: c.patient.ic,
    eta: String(eta),
    bpArm: c.findings.investigation.bpArm,
    positionAdvice: toward === undefined ? '' : POSITION_ADVICE[toward],
    decisionLine: DECISION_LINE[c.expected.decision.plan],
    callExtras: CALL_EXTRAS.filter(([when]) => conditionHolds(c, when)).map(([, ask]) => ask).join(' '),
    // the injured limb step 12's immobilise say names (Plan 3 D22); none in a case with no limb injury
    limbWhere: c.findings.rbs.limb?.where ?? '',
  };
}

// "ETA {eta} mins" at one minute says "ETA 1 min", as the computed ETA reply does; "every 5 mins" is left alone.
const ETA_MINS = /\{eta\} mins(?![a-z0-9])/g;
/** A slot that is a sentence of its own: at the line's start or after a sentence's end, before a space or the end. */
const OWN_SENTENCE_SLOT = new RegExp(`(?:^|(?<=[.?!]))\\s*\\{(${CANONICAL_SLOTS.join('|')})\\}(?=\\s|$)`, 'g');
/** Text before a slot that ends a sentence, or none at all: the slot then starts a sentence. */
const SENTENCE_START = /(?:^|[.?!])\s*$/;
/** 'Elderly female' → 'elderly female' inside a sentence; an acronym ('RTA, …') keeps its capitals. */
const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** A {say:<pointId>} placeholder, with the space before it. */
const SAY_PLACEHOLDER = new RegExp(`(\\s*)${SAY_SLOT}`, 'g');

/**
 * The line with each {say:<pointId>} placeholder (Task 11b) given its point's words where the point's `when` holds for
 * the case, and gone, with the space before it, where it doesn't: so "…lacerations. {say:c-collar} {say:release-grip}"
 * says the C-collar for neck pain and the release otherwise, and a case with neither keeps the line as it was. The
 * schema keeps every placeholder a sentence of its own naming a point of its step with a say; one naming none of
 * `points` throws, as a step passed without its points would.
 */
function fillSays(line: string, c: Case, points: readonly MustHit[]): string {
  return line.replace(SAY_PLACEHOLDER, (_: string, space: string, id: string) => {
    const point = points.find(p => p.id === id);
    if (point?.when === undefined || point.say === undefined) throw new Error(`{say:${id}} names no point of the step with a when and a say.`);
    return conditionHolds(c, point.when) ? `${space}${point.say}` : '';
  });
}

/**
 * A canonical line with its slots filled from the case, as tap mode plays it. `points` are the line's step's must-hit
 * points, where each {say:<pointId>} finds its words.
 * - A conditional point's {say:<pointId>} says the point's `say` where its `when` holds for the case, and goes with the
 *   space before it where it doesn't (fillSays), so a typed or tapped canonical line says each case's own conditional
 *   steps: the bleeding control, the C-collar or the release, the jaw thrust or the head tilt (Task 11b). A slot the
 *   say holds is filled below with the line's own ("Buddy, immobilise the {limbWhere}." → "…the right leg.", Plan 3 D22).
 * - A sentence holding a slot with nothing to say for the case is left out whole: an ideal position drops step 17's
 *   "If that position is not ideal: …". A slot that is its own sentence (step 2's {callExtras}, between "…unconscious?"
 *   and "Please prepare…") goes with the space before it, so a case with no extra questions keeps the line as it was.
 * - The call text filled mid-sentence takes a lowercase first letter ("for case of elderly female, breathlessness"); at
 *   the start of the line or after ". ", "? " or "! " it keeps its capital, as an acronym always does.
 * - At an ETA of 1, "{eta} mins" reads "1 min".
 */
export function fillCanonical(line: string, c: Case, eta: number, points: readonly MustHit[]): string {
  const values = canonicalValues(c, eta);
  const emptySlot = (s: string) => [...s.matchAll(CANONICAL_SLOT)].some(m => values[m[1] as CanonicalSlot] === '');
  const own = fillSays(line, c, points)
    .replace(OWN_SENTENCE_SLOT, (m: string, slot: string) => (values[slot as CanonicalSlot] === '' ? '' : m)).trimStart();
  const kept = emptySlot(own) ? splitSentences(own).filter(s => !emptySlot(s)).join(' ') : own;
  const text = eta === 1 ? kept.replace(ETA_MINS, '{eta} min') : kept;
  return text.replace(CANONICAL_SLOT, (_, slot: string, at: number) => {
    const value = values[slot as CanonicalSlot];
    return slot === 'callText' && !SENTENCE_START.test(text.slice(0, at)) ? lowerFirst(value) : value;
  });
}

/** The dispatch line a run opens with: 'Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.' */
export function activationText(c: Case): string {
  return `Activation: ${stop(c.callText)} ${stop(c.location)}`;
}

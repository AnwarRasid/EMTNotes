// Reads the oxygen device, the flow, the ECG type and the BP arm a trainee names, and judges the oxygen against the case.
// Pure: no window, document or preact.
import { OXYGEN_DEVICES, type Case, type OxygenDevice } from '../data/schema';
import { termAt } from './match';

export interface OxygenChoice { device: OxygenDevice | null; flow: number | null; flowMax: number | null }

// Found through termAt, so the short ones ("nc", "neb", "nrm") match whole words only.
const DEVICE_TERMS: Record<OxygenDevice, string[]> = {
  'nasal-cannula': ['nasal cannula', 'cannula', 'nasal prong', 'nc'],
  'simple-face-mask': ['simple face mask', 'simple mask', 'sfm', 'face mask'],
  'non-rebreather': ['non-rebreather', 'non rebreather', 'nonrebreather', 'nrm', 'nrb'],
  'nebuliser-mask': ['nebuliser', 'nebulizer', 'neb'],
  bvm: ['bvm', 'bag valve', 'bag-valve'],
  none: ['no oxygen', 'oxygen not required', 'not required', 'not needed', 'optional', 'room air'],
};

// Speech-to-text sometimes writes the flow as a word ("fifteen litres"), so one to fifteen read as numbers too, as whole
// words only, so "often" holds no "ten". The longest come first, so "fourteen" is never read as "four".
const NUMBER_WORDS = ['fifteen', 'fourteen', 'thirteen', 'twelve', 'eleven', 'ten', 'nine', 'eight', 'seven', 'six', 'five',
  'four', 'three', 'two', 'one'] as const;
const NUMBER = `\\d+(?:\\.\\d+)?|(?<![a-z0-9])(?:${NUMBER_WORDS.join('|')})`;
// The first flow, or range of flows, with its unit: the longest unit first, and a word end after it, so "15 left" and
// "3 lying" are not flows (ruling D5). normalizeLine has already turned "10-15" into "10 to 15".
const FLOW = new RegExp(`(${NUMBER})(?: to (${NUMBER}))? ?(?:l\\/min|litres?|liters?|lpm|l)(?![a-z0-9])`);
/** A flow figure as FLOW captured it: digits, or a number word. */
const flowNumber = (s: string): number => {
  const word = NUMBER_WORDS.indexOf(s as (typeof NUMBER_WORDS)[number]);
  return word < 0 ? Number(s) : 15 - word;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every device name but `none`, longest first; a long one may run on ("nasal prongs"), a short one is a whole word.
const DEVICE_NAME = OXYGEN_DEVICES.filter(d => d !== 'none').flatMap(d => DEVICE_TERMS[d])
  .sort((a, b) => b.length - a.length)
  .map(t => escapeRe(t) + (t.length > 3 ? '[a-z]*' : '(?![a-z0-9])'))
  .join('|');
// Units that make a bare number something other than a flow: "15 mins", "95%", "72 years old", "2 days ago",
// "12 breaths a minute", "2 ml salbutamol", "10 am" (fix round 2 adds all but min, sec, year and %).
const NON_FLOW_UNIT = '(?:%|(?:min(?:ute)?s?|sec(?:ond)?s?|years?|yrs?|yo|hours?|hrs?|days?|breaths?|times|mg|ml|kg|percent|am|pm)'
  + '(?![a-z0-9]))';
// Controller ruling (Task 6 fix round 1, carry (b)): with no unit, a number or range right after a device name,
// optionally after "mask", a comma (fix round 2: Gboard voice may insert one) and "at", is its flow: "NRM at 15", "NRM,
// 15", "nasal cannula 2 to 4", "nebuliser mask at 6 to 8". A range that a non-flow unit follows ("2 to 4 minutes") is
// never read as its first number alone, nor a decimal as its whole part ("2.5 mg" is not 2).
const BARE_FLOW = new RegExp(`(?<![a-z0-9])(?:${DEVICE_NAME})(?: mask)?,?(?: at)? (${NUMBER})(?: to (${NUMBER}))?`
  + `(?! to (?:${NUMBER}))(?![0-9a-z]|\\.\\d)(?! ?${NON_FLOW_UNIT})`);

/** Where the device is first named in normalized text, or Infinity. */
function namedAt(text: string, device: OxygenDevice): number {
  return Math.min(...DEVICE_TERMS[device].map(t => termAt(text, t)).map(i => (i < 0 ? Infinity : i)));
}

/**
 * The device and flow named in normalized text; null when neither is. The first device named wins, and any device beats
 * `none`, so "SpO2 88% on room air, nasal cannula 2 litres" reads the cannula (ruling D5). A flow with its unit wins over
 * a bare number after a device.
 */
export function readOxygen(normalized: string): OxygenChoice | null {
  const named = OXYGEN_DEVICES.filter(d => d !== 'none')
    .map(d => ({ d, at: namedAt(normalized, d) }))
    .filter(x => x.at < Infinity)
    .sort((a, b) => a.at - b.at);
  const device = named[0]?.d ?? (namedAt(normalized, 'none') < Infinity ? 'none' : null);
  const m = FLOW.exec(normalized) ?? BARE_FLOW.exec(normalized);
  const flow = m?.[1] === undefined ? null : flowNumber(m[1]);
  const flowMax = m?.[2] === undefined ? null : flowNumber(m[2]);
  return device === null && flow === null ? null : { device, flow, flowMax };
}

/** Where readOxygen first finds a device (`none` included) or a flow in normalized text, or −1. */
export function oxygenAt(normalized: string): number {
  const at = Math.min(...OXYGEN_DEVICES.map(d => namedAt(normalized, d)), FLOW.exec(normalized)?.index ?? Infinity);
  return at === Infinity ? -1 : at;
}

/** Where the choice readOxygen reads is named in normalized text: its device, when it is one, else the first device or
 *  flow found; −1 when there is no choice. The run engine uses it so a point asked for before the mask goes on, in the
 *  same sentence, is answered without it (Task 10 fix round 1, I2). */
export function choiceAt(normalized: string): number {
  const o = readOxygen(normalized);
  if (o === null) return -1;
  return o.device !== null && o.device !== 'none' ? namedAt(normalized, o.device) : oxygenAt(normalized);
}

/**
 * Whether the choice is the case's oxygen: the expected device, with the flow (and the top of a named range) inside the
 * expected range. An expectation with no range judges the device alone. Where oxygen is optional, no device or `none`
 * is right too.
 */
export function oxygenRight(choice: OxygenChoice, expected: Case['expected']['oxygen']): boolean {
  if (expected.optional && (choice.device === null || choice.device === 'none')) return true;
  if (choice.device !== expected.device) return false;
  if (expected.flowMin === null && expected.flowMax === null) return true;
  const lo = expected.flowMin ?? -Infinity;
  const hi = expected.flowMax ?? Infinity;
  const inRange = (f: number | null) => f !== null && f >= lo && f <= hi;
  return inRange(choice.flow) && (choice.flowMax === null || inRange(choice.flowMax));
}

// "12-lead", "12 lead", "twelve lead"; never the "4 lead" inside "14 lead".
const ECG: readonly (readonly ['12-lead' | '4-lead', RegExp])[] = [
  ['12-lead', /(?<![a-z0-9])(?:12|twelve)[ -]?lead/],
  ['4-lead', /(?<![a-z0-9])(?:4|four)[ -]?lead/],
];
// Speech-to-text writes "four lead" as "for lead" (controller ruling). It needs a word end, so "prepare for leads" is
// not one, and counts only beside "ECG" and when no type is written (fix round 1): "get ready for lead placement,
// 12-lead ECG" is a 12-lead, "prepare for lead placement" no ECG at all.
const SPOKEN_FOUR_LEAD = /(?<![a-z0-9])for[ -]lead(?![a-z0-9])/;

function findEcg(normalized: string): { type: '12-lead' | '4-lead'; at: number } | null {
  let best: { type: '12-lead' | '4-lead'; at: number } | null = null;
  for (const [type, re] of ECG) {
    const at = re.exec(normalized)?.index;
    if (at !== undefined && (best === null || at < best.at)) best = { type, at };
  }
  if (best !== null || termAt(normalized, 'ecg') < 0) return best;
  const spoken = SPOKEN_FOUR_LEAD.exec(normalized)?.index;
  return spoken === undefined ? null : { type: '4-lead', at: spoken };
}

/** The ECG type named in normalized text, or null; when both are named, the first. */
export function readEcg(normalized: string): '12-lead' | '4-lead' | null {
  return findEcg(normalized)?.type ?? null;
}

/** Where readEcg finds its ECG type in normalized text, or −1. */
export function ecgAt(normalized: string): number {
  return findEcg(normalized)?.at ?? -1;
}

/** A side, as the BP arm is named. */
export type ArmSide = 'left' | 'right';
/** Where a sentence is said, for the BP arm (Task 2 fix round 1's ruling): the arms the case allows (its {bparm} slot,
 *  both where the patient rules none out), whether the sentence is a question, and whether the run is on the BP arm's
 *  own step (13). */
export interface ArmScene { allowed: readonly string[]; question: boolean; ownStep: boolean }
/** No case: both arms allowed, a statement, on step 13. */
const OPEN_SCENE: ArmScene = { allowed: ['left', 'right'], question: false, ownStep: true };

const SIDES: Readonly<Record<string, ArmSide>> = { left: 'left', lt: 'left', l: 'left', right: 'right', rt: 'right', r: 'right' };
const SIDE = '(left|right|lt|rt|l|r)';
const BP = '(?:bp|blood pressure)';
// An arm named by its side (D23; Task 2 fix rounds 1 and 2): a side (left, right, lt, rt, l, r) before "arm(s)", or right
// after the BP, "BP (on|from|at|in)? (the|your|her|his|this)? {side}", with any "arm" after it as one name. Either of
// two forms ties it to the BP, which a Wrong needs: that one (group 1), or "{side} arm for (the|your)? BP" (groups 3 and
// 4). Whole words, never beside a "/", so "upright arm", "left armpit", "r/o" and "l/min" name none, and a bare side
// ("Right, BP next.") names none either.
const SIDE_NAME = new RegExp(`(?<![a-z0-9'/])(${BP} (?:(?:on|from|at|in) )?(?:(?:the|your|her|his|this) )?)?${SIDE}( arms?)?`
  + `( for (?:(?:the|your) )?${BP})?(?![a-z0-9'/])`, 'g');
// The arm named by the patient's state: the other, opposite, good, unaffected or uninjured arm is the allowed one; "the
// other one / side" and "the opposite one / side" too, beside BP; either and any arm only in a BP statement where both
// arms are allowed (fix round 2, m2).
const STATE_NAME = new RegExp("(?<![a-z0-9'])(?:(other|opposite|good|unaffected|uninjured) arms?|(other|opposite) (?:one|side)"
  + "|(either|any) arms?)(?![a-z0-9'])", 'g');
// "L/R" and "R/L" name both arms, so no choice (fix round 2, m4).
const BOTH_ARMS = /(?<![a-z0-9'])(?:left|right|lt|rt|l|r) ?\/ ?(?:left|right|lt|rt|l|r)(?![a-z0-9'])/g;
// A negation in the tie's own comma or semicolon clause, before or after the tied phrase, keeps a ruled-out arm from
// being Wrong: "No BP on the left arm", "Cannot take BP on the left arm", "I won't be taking your BP on the left arm"
// (fix round 2), and "BP on the left arm cannot.", "BP on the left arm not possible because of the fistula." (final
// review, I1). So does one opening the clause right after the tie's, which names no arm and no BP: "BP on the left arm,
// cannot." (final review residual). One in another clause does not: "Don't move, BP on the left arm.". "Do not" is
// "not"; "dont", "cant", "wont" and "shouldnt" are phone spellings; a word starting "avoid" or "contraindicat" counts,
// and so do "unable" and "impossible" (final review residual).
const NEGATIONS: ReadonlySet<string> = new Set(['not', 'no', "don't", 'dont', 'cannot', "can't", 'cant', "won't", 'wont', 'never', 'except',
  "shouldn't", 'shouldnt', 'unable', 'impossible']);
const isNegation = (w: string): boolean => NEGATIONS.has(w) || w.startsWith('avoid') || w.startsWith('contraindicat');
// An assent is never a negation, wherever it stands (final review residual): "BP on the left arm, no problem." and "No
// problem, BP on the left arm." are Wrong, and so is "bp on the left arm no problem", dictated with no comma. Blanked
// (same length, so places hold) before the negation guards read the sentence.
const ASSENTS = /(?<![a-z0-9'])(?:no (?:problem|worries|issues?)|not a problem)(?![a-z0-9'])/g;
// A restriction within 3 words of the tied arm keeps it from being Wrong too: "fistula left arm for BP", "BP on the left
// arm, fistula there" (fix round 2); and so does one anywhere in the tie's own clause: "BP on the left arm will press on
// her old fistula." (final review, I1). A word starting with one of these.
const RESTRICTIONS = ['fistula', 'shunt', 'cut', 'injur', 'wound', 'operation', 'contraindicat'];
const RESTRICTION_REACH = 3;
const wordsOf = (s: string): string[] => s.match(/[a-z0-9']+/g) ?? [];
// What names an arm or the BP in a clause: a side, "arm", the other or opposite one or side, "bp", "blood pressure".
const NAMES_ARM_OR_BP = /(?<![a-z0-9'/])(?:arms?|left|right|lt|rt|l|r|bp|blood pressure|(?:other|opposite) (?:one|side))(?![a-z0-9'/])/;

/** Where the comma or semicolon clause around [from, to) of normalized text starts and ends: just after the last ','
 *  or ';' before it, and at the next one after it (or the text's end). */
function clauseBounds(normalized: string, from: number, to: number): [number, number] {
  const start = Math.max(normalized.lastIndexOf(',', from - 1), normalized.lastIndexOf(';', from - 1)) + 1;
  const ends = [normalized.indexOf(',', to), normalized.indexOf(';', to)].filter(i => i >= 0);
  return [start, ends.length === 0 ? normalized.length : Math.min(...ends)];
}

/** The words of the comma or semicolon clause around [from, to) of normalized text, less that span: those before it,
 *  back to the last ',' or ';', and those after it, up to the next. */
function clauseAround(normalized: string, from: number, to: number): string[] {
  const [start, end] = clauseBounds(normalized, from, to);
  return [...wordsOf(normalized.slice(start, from)), ...wordsOf(normalized.slice(to, end))];
}

/** Whether a negation stands in the comma or semicolon clause of the tied phrase [from, to), before or after it; or
 *  opens the clause right after that one, which names no arm and no BP ("BP on the left arm, cannot.", "…, not
 *  possible.": final review residual). A later clause, or one that names an arm or the BP, does not count:
 *  "BP on the left arm, now, not later.", "Taking BP on the left arm, no BP on the legs.". `normalized` has its
 *  assents blanked (ASSENTS). */
function negatedInClause(normalized: string, from: number, to: number): boolean {
  if (clauseAround(normalized, from, to).some(isNegation)) return true;
  const [, end] = clauseBounds(normalized, from, to);
  if (end >= normalized.length) return false;
  const [, nextEnd] = clauseBounds(normalized, end + 1, end + 1);
  const next = normalized.slice(end + 1, nextEnd);
  const opening = wordsOf(next)[0];
  return opening !== undefined && isNegation(opening) && !NAMES_ARM_OR_BP.test(next);
}

/** Whether a restriction stands within 3 words before `from` or after `to` in normalized text, or anywhere in the comma
 *  or semicolon clause of [from, to). */
function restrictedNear(normalized: string, from: number, to: number): boolean {
  const near = [...wordsOf(normalized.slice(0, from)).slice(-RESTRICTION_REACH), ...wordsOf(normalized.slice(to)).slice(0, RESTRICTION_REACH),
    ...clauseAround(normalized, from, to)];
  return near.some(w => RESTRICTIONS.some(r => w.startsWith(r)));
}

/**
 * The BP arm a sentence gives (Task 2 fix rounds 1 and 2), and where it is named, or null:
 * - credit, leniently: the first allowed arm named, when the sentence says "bp" or "blood pressure" (whatever else it
 *   says, a question too) or is said on step 13 itself;
 * - else Wrong, strictly: the first ruled-out arm tied to the BP (SIDE_NAME) in a statement, with no negation in the
 *   tie's comma or semicolon clause, before or after it (final review, I1), none opening the clause right after it
 *   with no arm or BP named there (final review residual), an assent never counting as one, and no restriction within
 *   3 words of it or anywhere in its clause.
 * An arm without BP never gives Wrong, and credits only on step 13.
 */
function bpArm(normalized: string, scene: ArmScene): { side: ArmSide; at: number } | null {
  const text = normalized.replace(BOTH_ARMS, m => '_'.repeat(m.length));   // same length, so places hold
  const first = scene.allowed[0];
  const own: ArmSide | undefined = first === 'left' || first === 'right' ? first : undefined;   // the case's own arm
  const open = scene.allowed.length > 1;
  const bp = termAt(text, 'bp') >= 0 || termAt(text, 'blood pressure') >= 0;
  const sides = [...text.matchAll(SIDE_NAME)].flatMap(m => {
    const side = SIDES[m[2] ?? ''];
    if (side === undefined || (m[1] === undefined && m[3] === undefined)) return [];   // a bare side names no arm
    const end = m.index + (m[1]?.length ?? 0) + (m[2]?.length ?? 0) + (m[3]?.length ?? 0);
    return [{ side, at: m.index, end, tied: m[1] !== undefined || m[4] !== undefined }];
  });
  const states = [...text.matchAll(STATE_NAME)].flatMap(m => {
    const counts = m[1] !== undefined || (m[2] !== undefined && bp) || (m[3] !== undefined && open && bp && !scene.question);
    return counts && own !== undefined ? [{ side: own, at: m.index }] : [];
  });
  const named = [...sides, ...states].sort((a, b) => a.at - b.at);
  const credit = bp || scene.ownStep ? named.find(a => scene.allowed.includes(a.side)) : undefined;
  if (credit !== undefined) return { side: credit.side, at: credit.at };
  if (!bp || scene.question) return null;
  const unassented = text.replace(ASSENTS, m => '_'.repeat(m.length));   // an assent is no negation; places hold
  const wrong = sides.find(a => a.tied && !scene.allowed.includes(a.side) && !negatedInClause(unassented, a.at, a.end)
    && !restrictedNear(text, a.at, a.end));
  return wrong === undefined ? null : { side: wrong.side, at: wrong.at };
}

/** The BP arm normalized text gives in `scene` (bpArm), or null; with no scene, the first arm it names. Whether the
 *  sentence is a question and the run is on step 13 are the grader's to say (grader.ts checkAt). */
export function readArm(normalized: string, scene: ArmScene = OPEN_SCENE): ArmSide | null {
  return bpArm(normalized, scene)?.side ?? null;
}

/** Where the BP arm readArm gives is named in normalized text, or −1. */
export function armAt(normalized: string, scene: ArmScene = OPEN_SCENE): number {
  return bpArm(normalized, scene)?.at ?? -1;
}

export const DEVICE_SHORT: Record<OxygenDevice, string> = {
  'nasal-cannula': 'NC', 'simple-face-mask': 'SFM', 'non-rebreather': 'NRM', 'nebuliser-mask': 'Neb', bvm: 'BVM', none: 'RA',
};

export const DEVICE_LABEL: Record<OxygenDevice, string> = {
  'nasal-cannula': 'nasal cannula', 'simple-face-mask': 'simple face mask', 'non-rebreather': 'non-rebreather mask',
  'nebuliser-mask': 'nebuliser mask', bvm: 'BVM', none: 'no oxygen',
};

/** 'nasal cannula 3 L/min'; 'non-rebreather mask 10–15 L/min'; 'no oxygen'. With no device, the flow alone. */
export function describeOxygen(choice: OxygenChoice): string {
  if (choice.device === 'none') return DEVICE_LABEL.none;
  const flow = choice.flow === null ? null : `${choice.flow}${choice.flowMax === null ? '' : `–${choice.flowMax}`} L/min`;
  return [choice.device === null ? null : DEVICE_LABEL[choice.device], flow].filter(s => s !== null).join(' ');
}

// The matcher under the keyword grader: match terms are found at word starts (Plan 1 carry), so "ic" never hits
// "medication", "pr" never hits "pressure" and "5 min" never hits "15 mins". Pure: no window, document or preact.
import { MATCH_SLOTS, type Case, type Match, type MatchSlot } from '../data/schema';

/** The values each match slot ('{age}') expands to, for one case. */
export type MatchSlots = Record<MatchSlot, string[]>;

// The SMS words a phone keyboard gives, as the words match terms are written in (final review I3).
const SMS: Readonly<Record<string, string>> = { ur: 'your', u: 'you', pt: 'patient' };

/**
 * Folds a typed or spoken line into the form match terms are written in: lowercase, plain quotes and dashes. Phone
 * shorthand is spelt out, whole words only, never inside a token (final review I3): "ur" → "your", "u" → "you", "pt" →
 * "patient" ("pt's" too), "w/o" → "without", "w/" → "with". Glued GCS notation is spaced out, "e4v5m6" → "e4 v5 m6", so
 * each figure is a word of its own (final review I1).
 */
export function normalizeLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/(\d)-(?=\d)/g, '$1 to ')   // '1-6' → '1 to 6'; the lookahead lets '1-2-3' chain
    .replace(/(?<![a-z0-9])w\/o(?![a-z0-9])/g, 'without')
    .replace(/(?<![a-z0-9])w\//g, 'with ')
    .replace(/(?<![a-z0-9])(?:ur|u|pt)(?![a-z0-9])/g, w => SMS[w] ?? w)
    .replace(/(?<![a-z0-9])e([1-4]) ?v([1-5]) ?m([1-6])(?![0-9])/g, 'e$1 v$2 m$3')
    .replace(/\s+/g, ' ')
    .trim();
}

// charAt gives '' past either end of the text, which counts as a word boundary.
const isWordChar = (ch: string) => /[a-z0-9]/.test(ch);

/**
 * Where `term` first appears in normalized `text` at a word start, or −1. A term of 3 characters or fewer must also end
 * at a word end, and so must one whose last word is a single letter ("chinese f", "may i"), so it is never "Chinese
 * for…" or "may it" (Task 1 review round 1); other terms are prefixes, so stems such as "deformit" work, and a last word
 * of digits stays one ("every 5" reads "every 5mins"). The start rule skips a term that starts with punctuation, and the
 * end rule one that ends with it: '/15' needs only a word end after its 5.
 */
export function termAt(text: string, term: string): number {
  if (term === '') return -1;
  const atStart = isWordChar(term.charAt(0));
  const atEnd = (term.length <= 3 || /(?:^|[^a-z0-9])[a-z]$/.test(term)) && isWordChar(term.charAt(term.length - 1));
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) {
    if (atStart && isWordChar(text.charAt(i - 1))) continue;
    if (atEnd && isWordChar(text.charAt(i + term.length))) continue;
    return i;
  }
  return -1;
}

const SLOT = new RegExp(`\\{(${MATCH_SLOTS.join('|')})\\}`);

/** One term per slot value ('{bparm} arm' → ['left arm']); a term with no slot is itself; with `slots` null, none. */
export function expandTerm(term: string, slots: MatchSlots | null): string[] {
  const m = SLOT.exec(term);
  if (m === null) return [term];
  if (slots === null) return [];
  const head = term.slice(0, m.index);
  const tails = expandTerm(term.slice(m.index + m[0].length), slots);
  return slots[m[1] as MatchSlot].flatMap(value => tails.map(tail => head + value + tail));
}

/** The earliest position of any of a term's expansions, or −1. */
function firstAt(text: string, term: string, slots: MatchSlots | null): number {
  const at = expandTerm(term, slots).map(t => termAt(text, t)).filter(i => i >= 0);
  return at.length > 0 ? Math.min(...at) : -1;
}

/**
 * The earliest position of a matching alternative in normalized `text`, or −1. An alternative matches when every one of
 * its terms is found, at the smallest of their positions. Any negative term found vetoes the whole match.
 */
export function matchAt(text: string, match: Match, slots: MatchSlots | null, negatives: string[] = []): number {
  if (negatives.some(n => firstAt(text, n, slots) >= 0)) return -1;
  let best = -1;
  for (const alt of match) {
    const at = alt.map(t => firstAt(text, t, slots));
    if (at.length === 0 || at.includes(-1)) continue;   // an empty alternative matches nothing
    const pos = Math.min(...at);
    if (best < 0 || pos < best) best = pos;
  }
  return best;
}

// The words for the way a case needs the patient moved (findings.position.toward); none where the position is ideal.
// Sitting up includes the notes' Fowler / semi-Fowler (s01 Position) and "upright"; "fowler's" and the phone keyboard's
// "fowlers" let "{posture} position" read "Fowler's position" and "Fowlers position".
const POSTURE_WORDS = {
  'sit-up': ['sit', 'sitting', 'upright', 'fowler', "fowler's", 'fowlers', 'semi-fowler', 'semi fowlers'],
  supine: ['lie', 'lying', 'lay', 'flat', 'supine'],
} as const;

/** Every GCS total, 3 to 15: the {gcstotal} slot, the same for every case. */
const GCS_TOTALS: readonly string[] = Array.from({ length: 13 }, (_, i) => String(i + 3));
/** A GCS letter's figures, 1 to its most: 'e' 4 → e1…e4. */
const figures = (letter: string, most: number): readonly string[] => Array.from({ length: most }, (_, i) => `${letter}${i + 1}`);
/** The slots that are the same for every case: the GCS totals and figures, the race words, and the totals a lone
 *  "score" may state, 11 to 15, beyond any 1-to-10 pain score (Plan 3 ruling D24). */
const FIXED_SLOTS = {
  gcstotal: GCS_TOTALS, gcse: figures('e', 4), gcsv: figures('v', 5), gcsm: figures('m', 6),
  raceword: ['chinese', 'malay', 'indian', 'eurasian'], gcsscore: GCS_TOTALS.slice(-5),
} as const;

/** The arms the BP may go on for a case: its own first, and the other too unless the patient rules it out (final review
 *  I2). The {bparm} slot, the BP arm's grading and the line's arm all read this (Task 2 fix round 2, M3). */
export function allowedArms(c: Case): Case['findings']['investigation']['bpArm'][] {
  const { bpArm, bpArmRestricted } = c.findings.investigation;
  return bpArmRestricted === true ? [bpArm] : [bpArm, bpArm === 'left' ? 'right' : 'left'];
}

/**
 * The slot values for a case: age 72 → '72' and '70s'; IC 'S54xxxxxA' → 's54xxxxxa' and 's54'; ETA 6 → 5, 6 and 7;
 * the BP arm, the case's own first, and the other too unless the patient rules it out (final review I2); posture from
 * the position's `toward`, so the convince point reads only the right direction; and the fixed slots (FIXED_SLOTS): any
 * GCS total, the E, V and M figures, the race words, and the totals 11 to 15.
 */
export function caseSlots(c: Case, eta: number | null): MatchSlots {
  const { age, ic } = c.patient;
  const toward = c.findings.position.toward;
  return {
    age: [String(age)],
    decade: [`${Math.floor(age / 10) * 10}s`],
    ic: [ic.toLowerCase(), ic.slice(0, 3).toLowerCase()],
    eta: (eta === null ? [] : [eta - 1, eta, eta + 1]).filter(n => n >= 1).map(String),
    bparm: allowedArms(c),
    posture: toward === undefined ? [] : [...POSTURE_WORDS[toward]],
    gcstotal: [...FIXED_SLOTS.gcstotal],
    gcse: [...FIXED_SLOTS.gcse],
    gcsv: [...FIXED_SLOTS.gcsv],
    gcsm: [...FIXED_SLOTS.gcsm],
    raceword: [...FIXED_SLOTS.raceword],
    gcsscore: [...FIXED_SLOTS.gcsscore],
  };
}

const STOPS = '?!;.';

// A full stop ends a sentence only after a word of 3 or more characters with no inner '.', so "IC no.", "e.g." and
// "C.A.T." never split; and never right before a digit, so a decimal such as "100.5" stays whole.
function endsSentence(before: string, next: string): boolean {
  const word = /\S*$/.exec(before)?.[0] ?? '';
  return word.length >= 3 && !word.includes('.') && !/[0-9]/.test(next);
}

/**
 * Splits after '?', '!' or ';', after a full stop that ends a real word, and at newlines; trimmed, no empty pieces.
 * Run it on the raw line, before `normalizeLine`, which folds '\n' into a space.
 */
export function splitSentences(line: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '\n') {
      pieces.push(line.slice(start, i));
      start = i + 1;
    } else if ('?!;'.includes(ch) || (ch === '.' && endsSentence(line.slice(start, i), line.charAt(i + 1)))) {
      while (i + 1 < line.length && STOPS.includes(line.charAt(i + 1))) i++;   // "?!" and "..." stay with their sentence
      pieces.push(line.slice(start, i + 1));
      start = i + 1;
    }
  }
  pieces.push(line.slice(start));
  return pieces.map(p => p.trim()).filter(p => p !== '');
}

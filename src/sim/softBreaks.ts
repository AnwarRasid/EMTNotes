// Soft sentence breaks for a dictated line (Plan 3 Task 4, ruling D7). A Web Speech transcript comes with no punctuation,
// and the grader splits a line into sentences on punctuation, so one spoken line would otherwise land on one step (Plan 2
// ruling carry (c)). softBreaks puts a full stop before an addressee, the patient's call name or a step opener; the voice
// path (Task 5) runs each final transcript through appendHeard into the field, where the trainee sees and edits it before
// Send. Typed lines are never touched. In tests/unit/soft-breaks.test.ts, the cue table and the held-word tables pin each
// cue and each hold, and the canonical dictation sweep guards that every canonical line, dictated, grades as typed.
// Pure: no window, document or preact.
import { RUN_LIMITS } from '../progress/types';
import { PATIENT_WORDS } from './grader';

/** The addressees a break goes before: the buddies, Ops, the crew, the tester, the caller and the patient's words. */
export const BREAK_ADDRESSEES: readonly string[] = [
  'arm buddy', 'head buddy', 'buddy', 'ops ctr', 'ops centre', 'ops center', 'crew', 'tester', 'caller', ...PATIENT_WORDS,
];

/** The words a step's sentences open with, a break going before them. 'does the' and 'fmv' give the notification's
 *  identity checks and radio calls their own sentences (pre-flight finding 4); 'fmv' alone, so the call sign may be
 *  written "123", "1 2 3" or "one two three" (Task 4 fix round 1, M2). */
export const STEP_OPENERS: readonly string[] = [
  'may i', 'can you', 'could you', 'do you', 'did you', 'are you', 'is there', 'are there',
  'does the', 'fmv', 'please allow', "i'm going", 'i am going', 'checking', 'taking', 'patient is',
];

/** Fillers a sentence opens with ("ok sir …", "and buddy …"): never a break right after one. */
const FILLERS: readonly string[] = ['ok', 'okay', 'and', 'also', 'so'];
/** Possessives and small words that run on into what follows ("my buddy", "with the crew"): never a break after one. */
const RUN_ON: readonly string[] = ['my', 'your', 'our', 'his', 'her', 'the', 'a', 'an', 'to', 'with', 'for', 'of', 'on', 'at', 'by'];
/** Question words: an opener's verb after one is inside its question ("how are you feeling", "where are you now"), so
 *  never a break right after one (Task 4 pre-review ruling 1). */
const QUESTION_WORDS: readonly string[] = ['how', 'what', 'where', 'when', 'who', 'why', 'which'];
/** Subjects, copulas and auxiliaries: a one-word opener right after one is its clause's verb ("is she taking any
 *  medication", "i am checking the pulse"), so never a break before it there (fix round 1, I1). */
const SUBJECTS: ReadonlySet<string> = new Set(['i', "i'm", 'am', 'is', 'are', 'was', 'were', 'you', 'he', 'she', 'we', 'they',
  'it', 'patient', 'does', 'do', 'did', 'has', 'have', 'will', 'can']);
/** A side or an owner makes the next "arm" or "head" a limb ("the left arm buddy …", "your head buddy …"), so there the
 *  one-word "buddy" is the cue, not "arm buddy" or "head buddy" (fix round 1, M4). */
const LIMB_OWNERS: ReadonlySet<string> = new Set(['left', 'right', 'your', 'his', 'her']);
const LIMB_BUDDIES: ReadonlySet<string> = new Set(['arm buddy', 'head buddy']);
/** A '.' between two digits, a decimal ("37.5"): not punctuation, and never a break (pre-review ruling 2). */
const DECIMAL_POINT = /(?<=\d)\.(?=\d)/g;

/** A word as the cues see it: lower case, curly apostrophes straight, no punctuation at either end ("Buddy," → "buddy"). */
const keyOf = (word: string): string =>
  word.toLowerCase().replace(/[‘’]/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
const lastWord = (phrase: string): string => phrase.split(' ').at(-1) ?? '';
/** Trailing spaces and a trailing comma, semicolon or colon, which a full stop replaces. */
const TRAILING = /[\s,;:]+$/;

/** A piece of the line as a sentence: its first letter capital, a trailing comma or colon dropped, a full stop at its end. */
const sentenceOf = (words: readonly string[]): string => {
  const text = words.join(' ').replace(TRAILING, '');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

/** A cue: its words, the phrase, and whether it is a step opener (only a one-word opener is held after a subject). */
interface Cue { readonly words: readonly string[]; readonly phrase: string; readonly opener: boolean }

/**
 * The dictated line with soft sentence breaks (D7). A transcript holding '.', '?' or '!' (a decimal's '.' aside) is
 * already punctuated and comes back trimmed, otherwise unchanged. Otherwise a break goes before word i ≥ 1 when the words
 * from i start a cue (an addressee in BREAK_ADDRESSEES, the last word of `callName`, or a step opener in STEP_OPENERS),
 * unless word i − 1 is an addressee word (the last word of an addressee or of the call name), a filler, a run-on word or
 * a question word; or the cue is a one-word opener and word i − 1 a subject, copula or auxiliary; or fewer than 2 words
 * follow the break before. The longest cue at a word wins, except that "arm buddy" and "head buddy" are no cue after a
 * side or an owner, and the words inside a cue are not tried again. Each piece gets a capital first letter and ends
 * with '.'.
 */
export function softBreaks(transcript: string, callName: string): string {
  const text = transcript.trim();
  if (text === '' || /[.?!]/.test(text.replace(DECIMAL_POINT, ''))) return text;
  const words = text.split(/\s+/);
  const keys = words.map(keyOf);
  const name = keyOf(callName.trim().split(/\s+/).at(-1) ?? '');   // "Mdm Tan" → "tan"
  const named = name === '' ? [] : [name];
  const cueOf = (opener: boolean) => (phrase: string): Cue => ({ words: phrase.split(' '), phrase, opener });
  const cues = [...BREAK_ADDRESSEES.map(cueOf(false)), ...STEP_OPENERS.map(cueOf(true)), ...named.map(cueOf(false))]
    .sort((a, b) => b.words.length - a.words.length);   // the longest cue at a word wins (a stable sort keeps the lists' order)
  const held = new Set([...BREAK_ADDRESSEES.map(lastWord), ...named, ...FILLERS, ...RUN_ON, ...QUESTION_WORDS]);
  const starts = [0];
  for (let i = 0; i < words.length;) {
    const prev = keys[i - 1];
    const limb = prev !== undefined && LIMB_OWNERS.has(prev);
    const cue = cues.find(c => c.words.every((w, k) => keys[i + k] === w) && !(limb && LIMB_BUDDIES.has(c.phrase)));
    if (cue === undefined) { i++; continue; }
    const verb = cue.opener && cue.words.length === 1 && prev !== undefined && SUBJECTS.has(prev);
    if (prev !== undefined && !held.has(prev) && !verb && i - (starts.at(-1) ?? 0) >= 2) starts.push(i);
    i += cue.words.length;   // the words inside the cue are not tried again
  }
  return starts.map((from, n) => sentenceOf(words.slice(from, starts[n + 1]))).join(' ');
}

/**
 * The composer's field with a dictated final result added (Task 5): the soft-broken words alone in an empty field; after
 * a space when the field already ends in '.', '?' or '!'; otherwise after '. ', so the field's last words stay a sentence
 * of their own. The field's trailing spaces, and a trailing comma, semicolon or colon (fix round 1, M3), go first. Cut to
 * `max` characters. A result with no words leaves the field as it is.
 */
export function appendHeard(field: string, heard: string, callName: string, max: number = RUN_LIMITS.lineChars): string {
  const said = softBreaks(heard, callName);
  const before = field.replace(TRAILING, '');   // "Sir, " → "Sir"
  const line = said === '' ? field : before === '' ? said : /[.?!]$/.test(before) ? `${before} ${said}` : `${before}. ${said}`;
  return line.slice(0, max);
}

// The notes as plain text, the Notes tab's search over it, and the reader's highlight passages and cross-links.
// Search is a plain, case-insensitive substring match: the query is never read as a pattern.
import type { Question } from '../data/questions';
import type { Block, NotesDoc, Run, Section, Step } from '../data/schema';

/** The runs' text as written. Literal `**` from the docx stays as typed. */
export function runsText(runs: Run[]): string {
  return runs.map((r) => r.t).join('');
}

/**
 * All the text a block shows, in reading order, one piece per line: a heading; a paragraph; each list item (not
 * its marker); every block in every table cell; a box's title, then its blocks. An image has none: its alt only
 * names the figure, and isn't text on the page.
 */
export function blockText(b: Block): string {
  switch (b.k) {
    case 'h':
      return b.text;
    case 'p':
      return runsText(b.runs);
    case 'list':
      return lines(b.items.map((i) => runsText(i.runs)));
    case 'table':
      return lines(b.rows.flatMap((r) => r.cells.flatMap((cell) => cell.map(blockText))));
    case 'box':
      return lines([b.title, ...b.blocks.map(blockText)]);
    case 'img':
      return '';
  }
}

const lines = (pieces: string[]) => pieces.filter((t) => t !== '').join('\n');

// ---- Search ---------------------------------------------------------------------------------------------

export interface SearchHit { sectionId: string; sectionTitle: string; blockIndex: number; before: string; match: string; after: string }

const SNIPPET = 40;
const CUT = '…';
/** How the line break between two pieces of a block (a box's title and its body, two table cells) shows in a snippet. */
const PIECE = ' · ';

/** The query as searched: trimmed, with any run of whitespace read as one space. So it holds no line break, and
 *  never matches across two pieces of a block. */
const oneLine = (s: string) => s.trim().replace(/\s+/g, ' ');

/** A block's text as searched: each piece trimmed, with its runs of whitespace read as one space, and empty pieces
 *  dropped. The line breaks between pieces stay, as hard boundaries. */
const tidy = (s: string) => s.split('\n').map(oneLine).filter((piece) => piece !== '').join('\n');

/** Whether `query` is long enough to search: 2 characters or more once trimmed. Shorter gives no hits. */
export function searchable(query: string): boolean {
  return [...oneLine(query)].length >= 2;
}

// Punctuation a phone keyboard types differently from the notes: curly quotes for their straight ones, and a hyphen
// for their en dashes ("60 – 80"). Each maps to a single character, so indexes still line up.
const SAME_AS = new Map([['‘', "'"], ['’', "'"], ['“', '"'], ['”', '"'], ['–', '-'], ['—', '-'], ['−', '-']]);

/** Folds text for matching, character by character: lower case, and the punctuation above. A character whose lower
 *  case has another length (say 'İ') stays as it is, so an index in the folded text is the same index in the original. */
function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const same = SAME_AS.get(ch);
    if (same !== undefined) {
      out += same;
      continue;
    }
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

interface Entry { sectionId: string; sectionTitle: string; blockIndex: number; plain: string; folded: string }

// Each top-level block's text, built once per notes document (the tab searches on every keystroke).
const indexes = new WeakMap<NotesDoc, Entry[]>();

function indexOf(notes: NotesDoc): Entry[] {
  let index = indexes.get(notes);
  if (!index) {
    index = [];
    for (const s of notes.sections) {
      for (const [blockIndex, b] of s.blocks.entries()) {
        const plain = tidy(blockText(b));
        if (plain !== '') index.push({ sectionId: s.id, sectionTitle: s.title, blockIndex, plain, folded: fold(plain) });
      }
    }
    indexes.set(notes, index);
  }
  return index;
}

/** Block text as a snippet shows it: each break between pieces as ' · '. */
const shown = (text: string) => text.replaceAll('\n', PIECE);

/** The end of `text`, up to SNIPPET characters. A longer one is cut at a word, after an ellipsis. */
function lead(text: string): string {
  if (text.length <= SNIPPET) return text;
  const start = text.length - (SNIPPET - CUT.length);
  let kept = text.slice(start);
  if (text[start - 1] !== ' ' && kept[0] !== ' ') {
    const space = kept.indexOf(' ');
    if (space >= 0) kept = kept.slice(space + 1);   // drop the part-word; one long word is cut where it falls
  }
  kept = kept.trimStart();
  if (kept.startsWith('· ')) kept = kept.slice(2);   // a cut never opens on a piece separator
  return CUT + kept;
}

/** The start of `text`, up to SNIPPET characters. A longer one is cut at a word, before an ellipsis. */
function trail(text: string): string {
  if (text.length <= SNIPPET) return text;
  const end = SNIPPET - CUT.length;
  let kept = text.slice(0, end);
  if (text[end] !== ' ' && kept[kept.length - 1] !== ' ') {
    const space = kept.lastIndexOf(' ');
    if (space >= 0) kept = kept.slice(0, space);
  }
  kept = kept.trimEnd();
  if (kept.endsWith(' ·')) kept = kept.slice(0, -2).trimEnd();
  return kept + CUT;
}

/**
 * Finds `query` in the notes: case-insensitive, plain substring, one hit per top-level block, in document order,
 * at most `limit`. A query under 2 characters once trimmed finds nothing. Phone punctuation matches the notes' own
 * (curly quotes, a hyphen for a dash), and no match runs across two pieces of a block. `before` and `after` are the
 * context either side of the match (whitespace collapsed, a break between pieces shown as ' · '), each up to 40
 * characters, cut at a word with '…'.
 */
export function searchNotes(notes: NotesDoc, query: string, limit = 50): SearchHit[] {
  if (!searchable(query)) return [];
  const q = fold(oneLine(query));
  const hits: SearchHit[] = [];
  for (const e of indexOf(notes)) {
    if (hits.length >= limit) break;
    const at = e.folded.indexOf(q);
    if (at < 0) continue;
    const end = at + q.length;
    hits.push({
      sectionId: e.sectionId, sectionTitle: e.sectionTitle, blockIndex: e.blockIndex,
      before: lead(shown(e.plain.slice(0, at))), match: e.plain.slice(at, end), after: trail(shown(e.plain.slice(end))),
    });
  }
  return hits;
}

// ---- Highlight passages and cross-links (the section reader) ---------------------------------------------

/** A list marker that is part of what the item says ("2.", "b)"), as against a bullet or dash, which only marks it. */
export function isNumberMarker(marker: string): boolean {
  return /^[0-9a-z]+[.)]$/i.test(marker);
}

/** One highlighted passage, with the heading it sits under for context. `marker` is a numbered list item's number
 *  ("2."): the order of steps is part of what the notes teach. Bullets and dashes give none. */
export interface Passage { headingId: string | null; heading: string; runs: Run[]; marker?: string }

/**
 * The section's highlight passages, in document order: each paragraph and each list item, at any depth (inside
 * boxes and table cells too), with at least one highlighted run. The importer counts the same passages for
 * `section.highlights` (Task 5); a heading is never one, though a heading's own highlight shows in Full text.
 * Each passage's heading is the nearest heading before it, else the section title, with a null id.
 */
export function highlightPassages(section: Section): Passage[] {
  const out: Passage[] = [];
  let headingId: string | null = null;
  let heading = section.title;
  const take = (runs: Run[], marker?: string) => {
    if (!runs.some((r) => r.h)) return;
    out.push(marker !== undefined && isNumberMarker(marker) ? { headingId, heading, runs, marker } : { headingId, heading, runs });
  };
  const visit = (blocks: Block[]) => {
    for (const b of blocks) {
      switch (b.k) {
        case 'h':
          headingId = b.id;
          heading = b.text;
          break;
        case 'p':
          take(b.runs);
          break;
        case 'list':
          for (const item of b.items) take(item.runs, item.marker);
          break;
        case 'box':
          visit(b.blocks);
          break;
        case 'table':
          for (const row of b.rows) for (const cell of row.cells) visit(cell);
          break;
        case 'img':
          break;
      }
    }
  };
  visit(section.blocks);
  return out;
}

/** Whether a notesRef ('s01' or 's01#delicate-spine') points into section `sectionId`. */
const refersTo = (ref: string | null, sectionId: string) => ref !== null && (ref === sectionId || ref.startsWith(`${sectionId}#`));

/** The PAM steps whose notes are in this section, in step order, and the ids of the questions that link to it,
 *  in bank order. */
export function linksForSection(sectionId: string, steps: Step[], questions: Question[]): { steps: Step[]; questionIds: string[] } {
  return {
    steps: steps.filter((s) => refersTo(s.notesRef, sectionId)).sort((a, b) => a.order - b.order),
    questionIds: questions.filter((q) => refersTo(q.notesRef, sectionId)).map((q) => q.id),
  };
}

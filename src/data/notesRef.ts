// Notes links: a notesRef is a section id with an optional heading anchor, e.g. "s11#oxygen-masks".
import { NOTES_REF, type Block, type NotesDoc, type Section } from './schema';

type Heading = Extract<Block, { k: 'h' }>;

function parseRef(ref: string): { sectionId: string; anchor: string | null } | null {
  if (!NOTES_REF.test(ref)) return null;
  const hash = ref.indexOf('#');
  return hash < 0 ? { sectionId: ref, anchor: null } : { sectionId: ref.slice(0, hash), anchor: ref.slice(hash + 1) };
}

/**
 * Finds the section and the anchor's heading. `blockIndex` is the heading's index among the section's
 * top-level blocks, or 0 when the ref has no anchor. Null when the section or the anchor doesn't exist.
 */
export function resolveNotesRef(notes: NotesDoc, ref: string): { section: Section; blockIndex: number; heading: string | null } | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const section = notes.sections.find(s => s.id === parsed.sectionId);
  if (!section) return null;
  if (parsed.anchor === null) return { section, blockIndex: 0, heading: null };
  const blockIndex = section.blocks.findIndex(b => b.k === 'h' && b.id === parsed.anchor);
  if (blockIndex < 0) return null;
  return { section, blockIndex, heading: (section.blocks[blockIndex] as Heading).text };
}

/** 's11#oxygen-masks' -> '#/notes/s11/oxygen-masks'; 's07' -> '#/notes/s07'; a malformed ref -> '#/notes'. */
export function notesRefHref(ref: string): string {
  const parsed = parseRef(ref);
  if (!parsed) return '#/notes';
  return parsed.anchor === null ? `#/notes/${parsed.sectionId}` : `#/notes/${parsed.sectionId}/${parsed.anchor}`;
}

/** 'Notes 11, Oxygen Masks' when the notes are loaded and the anchor resolves; otherwise 'Notes 11'. */
export function notesRefLabel(notes: NotesDoc | null, ref: string): string {
  const parsed = parseRef(ref);
  if (!parsed) return 'Notes';
  const base = `Notes ${Number(parsed.sectionId.slice(1))}`;
  const heading = notes ? resolveNotesRef(notes, ref)?.heading : null;
  return heading ? `${base}, ${heading}` : base;
}

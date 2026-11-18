// What a checked practice or review answer says (spec §6.4, mockup screen 4): the verdict in words with display
// letters, then the explanation and its notes link. The Answer and Yours marks sit on the options (OptionList).
import type { JSX } from 'preact';
import type { Question } from '../data/questions';
import { notesRefHref, notesRefLabel } from '../data/notesRef';
import type { NotesDoc } from '../data/schema';
import type { AnswerRecord } from '../progress/types';
import { Icon } from '../ui/Icon';
import { TextLink } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { letterAt } from './OptionList';

/** An option as the trainee saw it: its letter in `order`. A pick kept across a re-import can be missing from a
 *  rebuilt order, so it falls back to the option's text, and to plain words when the option itself is gone. */
function nameOf(q: Question, order: string[], id: string): string {
  const i = order.indexOf(id);
  if (i >= 0) return letterAt(i);
  const text = q.options.find((o) => o.id === id)?.text;
  return text !== undefined ? `“${text}”` : 'an answer that has since changed';
}

/** The explanation's notes link (spec §6.1, the shared notesRef key): "Notes 11, Oxygen Masks", or "Notes 11" before
 *  the notes load. Nothing for a question with no notesRef. Feedback and the result's wrong rows both show it. */
export function NotesLink({ q, notes }: { q: Question; notes: NotesDoc | null }): JSX.Element | null {
  return q.notesRef ? <TextLink href={notesRefHref(q.notesRef)}>{notesRefLabel(notes, q.notesRef)}</TextLink> : null;
}

/** The course decks or files behind the explanation: "Source: MED 805, EMS Drugs". Nothing when none covers it, so
 *  a line that rests on no course material never looks as if it does. Feedback and the result's wrong rows both show it. */
export function SourceLine({ q }: { q: Question }): JSX.Element | null {
  return q.slides.length > 0 ? <p class="explain-src">Source: {q.slides.join(', ')}</p> : null;
}

export function Feedback({ q, order, record, notes }:
  { q: Question; order: string[]; record: AnswerRecord; notes: NotesDoc | null }): JSX.Element {
  const yours = nameOf(q, order, record.picked);
  // A right pick names its own letter: on mt-b-q169 the answer is printed twice, and either copy is right.
  const verdict = record.right
    ? `Right: ${yours} is the answer.`
    : `Wrong: you picked ${yours}. The answer is ${nameOf(q, order, q.answer)}.`;
  return (
    <Panel as="div" class={record.right ? 'explain explain-ok' : 'explain'}>
      <p class="verdict"><Icon name={record.right ? 'check' : 'cross'} />{verdict}</p>
      {q.explanation && <p class="explain-text">{q.explanation}</p>}
      <SourceLine q={q} />
      <NotesLink q={q} notes={notes} />
    </Panel>
  );
}

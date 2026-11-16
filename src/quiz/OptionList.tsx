// A question's options as a native radio group: a fieldset whose legend is the stem, one radio per option, lettered
// A–D in session order (spec §6.4, §8). Once checked, and only when `reveal` is on, the official answer is marked
// "Answer" in green and a wrong pick "Yours" in magenta, in words as well as colour. Picks are reported by option id.
import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import type { Question } from '../data/questions';
import type { AnswerRecord } from '../progress/types';
import { Icon } from '../ui/Icon';
import { displayLetter, rightOptions } from './engine';

type Mark = 'ok' | 'bad' | null;

/** The letter for the option at `index`. The banks have four options; a fifth would still get a letter. */
export function letterAt(index: number): string {
  return index < 4 ? displayLetter(index) : String.fromCharCode(65 + index);
}

/** How a checked answer marks an option: every option graded right (the answer, and on mt-b-q169 its twin that reads
 *  the same) is ok, a wrong pick is bad, the rest are plain. `right` is rightOptions(q). */
function markFor(right: ReadonlySet<string>, checked: AnswerRecord, id: string): Mark {
  if (right.has(id) || (checked.right && id === checked.picked)) return 'ok';
  return id === checked.picked ? 'bad' : null;
}

export function OptionList({ q, order, picked, checked, reveal, onPick }:
  { q: Question; order: string[]; picked: string | null; checked: AnswerRecord | null; reveal: boolean; onPick(id: string): void }): JSX.Element {
  const name = useId();
  const shown = order.flatMap((id) => q.options.filter((o) => o.id === id));
  const right = new Set(rightOptions(q));

  return (
    <fieldset class="opts-set">
      <legend class="stem">{q.stem}</legend>
      <div class="opts">
        {shown.map((o, i) => {
          const mark = reveal && checked ? markFor(right, checked, o.id) : null;
          const cls = mark === 'ok' ? 'opt opt-ok' : mark === 'bad' ? 'opt opt-bad'
            : picked === o.id && checked === null ? 'opt opt-picked' : 'opt';
          return (
            <label key={o.id} class={cls}>
              {/* Locked once checked: the pick is graded, and a click must not move the radio off it. */}
              <input type="radio" name={name} value={o.id} checked={picked === o.id} disabled={checked !== null}
                onChange={() => onPick(o.id)} />
              <span class="opt-key">{letterAt(i)}</span>{' '}
              <span class="opt-text">{o.text}</span>
              {mark && <>{' '}<Badge mark={mark} /></>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Badge({ mark }: { mark: 'ok' | 'bad' }): JSX.Element {
  return (
    <span class={mark === 'ok' ? 'badge badge-ok' : 'badge badge-bad'}>
      <Icon name={mark === 'ok' ? 'check' : 'cross'} />{mark === 'ok' ? 'Answer' : 'Yours'}
    </span>
  );
}

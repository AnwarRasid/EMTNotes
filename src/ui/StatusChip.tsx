// Status is always a solid chip with a mark and a word, in hues the band never uses:
// magenta !!! for missed or wrong, lavender !! for order or phrase, green ✓ for done or right.
// !!! and !! are alarm priorities (from the Monitor language), so done never carries one.
import type { JSX } from 'preact';
import type { InlineFlag } from '../progress/types';

export type ChipKind = 'missed' | 'order' | 'phrase' | 'done';

const CHIPS: Record<ChipKind, { cls: string; mark: string }> = {
  missed: { cls: 'tag-hi', mark: '!!!' },
  order: { cls: 'tag-med', mark: '!!' },
  phrase: { cls: 'tag-med', mark: '!!' },
  done: { cls: 'tag-ok', mark: '✓' },
};

/** The chip for a fault or an inline flag (the run's chat and the debrief share it): Wrong is magenta like Missed (spec
 *  §9: "missed or wrong"), and a nudge is the point Missed so far. */
export function chipFor(kind: InlineFlag['kind']): { kind: ChipKind; label: string } {
  switch (kind) {
    case 'missed': case 'nudge': return { kind: 'missed', label: 'Missed' };
    case 'wrong': return { kind: 'missed', label: 'Wrong' };
    case 'order': return { kind: 'order', label: 'Order' };
    case 'phrase': return { kind: 'phrase', label: 'Phrase' };
  }
}

export function StatusChip({ kind, label }: { kind: ChipKind; label: string }): JSX.Element {
  const { cls, mark } = CHIPS[kind];
  // The word carries the meaning for screen readers; the mark is for the eye.
  return <span class={`tag ${cls}`}><span class="bang" aria-hidden="true">{mark}</span>{label}</span>;
}

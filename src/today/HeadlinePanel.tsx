// Today's headline (spec §6.1; mockup screen 1, .as-alert): the trainee's most frequent recent mistake as its chip,
// a title and what the point was, then a drill on its step and the step's notes.
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { useContent } from '../data/load';
import { notesRefHref, notesRefLabel } from '../data/notesRef';
import { useProgress } from '../progress/hooks';
import { headline, headlineCopy, type Headline } from '../sim/headline';
import { Primary, Secondary, TextLink } from '../ui/Keys';
import { StatusChip, chipFor } from '../ui/StatusChip';

/** The headline over the saved runs, kept while the runs are unchanged. */
function useHeadline(): Headline | null {
  const runs = useProgress((p) => p.runs);
  return useMemo(() => headline(runs), [runs]);
}

/** Whether the headline shows ('shown'), may yet ('pending': there is one, and the steps it reads are still loading),
 *  or won't ('none'). */
export function useHeadlineRow(): 'shown' | 'pending' | 'none' {
  const h = useHeadline();
  const steps = useContent('steps');
  if (h === null) return 'none';
  return steps.status === 'ready' ? 'shown' : steps.status === 'loading' ? 'pending' : 'none';
}

/** The headline, once the steps are in, or nothing when the recent runs have no fault. `primary`: its drill key is the
 *  screen's one primary key. The drill key opens Run start on the step, which says if it replaces an open run. */
export function HeadlinePanel({ primary }: { primary: boolean }): JSX.Element | null {
  const h = useHeadline();
  const steps = useContent('steps');
  const ready = steps.status === 'ready' ? steps.data.steps : null;
  const copy = useMemo(() => (h !== null && ready !== null ? headlineCopy(h, ready) : null), [h, ready]);
  if (h === null || copy === null) return null;
  const chip = chipFor(h.kind);
  const Drill = primary ? Primary : Secondary;
  return (
    <section class="alert">
      <StatusChip kind={chip.kind} label={chip.label} />
      <h2 class="h1">{copy.title}</h2>
      <p class="sub">{copy.sub}</p>
      <div class="act">
        <Drill href={copy.drillHref}>{copy.drillLabel}</Drill>
        {copy.notesRef !== null && <TextLink href={notesRefHref(copy.notesRef)}>{notesRefLabel(null, copy.notesRef)}</TextLink>}
      </div>
    </section>
  );
}

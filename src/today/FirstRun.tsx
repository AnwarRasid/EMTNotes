// Today's first-run checklist, "Start here" (spec §6.1): read the PAM steps, do a Coached run, do an Exam run. Each item
// ticks itself from progress and links to where it is done: the notes' steps section, or Run start. A run item ticks for
// a full run whose clock started, as the headline and the last times count runs (ruling D9; final review M6). It goes
// once all three are done.
import type { ComponentChildren, JSX } from 'preact';
import { useProgress } from '../progress/hooks';
import { timed } from '../sim/headline';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';

/** The notes section with the PAM steps: every step links into it. */
const STEPS_SECTION = 's01';

export function FirstRun(): JSX.Element | null {
  const read = useProgress((p) => p.notes.read.includes(STEPS_SECTION));
  const coached = useProgress((p) => p.runs.some((r) => !r.drill && r.mode === 'coached' && timed(r)));
  const exam = useProgress((p) => p.runs.some((r) => !r.drill && r.mode === 'exam' && timed(r)));
  if (read && coached && exam) return null;
  return (
    <Panel class="firstrun">
      <h2 class="plabel">Start here</h2>
      <ul class="fr-list">
        <Item done={read} href={`#/notes/${STEPS_SECTION}`}>Read the PAM steps in your notes</Item>
        <Item done={coached} href="#/pam/start">Do a Coached run</Item>
        <Item done={exam} href="#/pam/start">Do an Exam run</Item>
      </ul>
    </Panel>
  );
}

/** One item: its tick, then the link to do it. The tick is an image named "Done" or "Not done yet", read before the
 *  item. */
function Item({ done, href, children }: { done: boolean; href: string; children: ComponentChildren }): JSX.Element {
  return (
    <li class={done ? 'fr-item fr-done' : 'fr-item'}>
      <span class="fr-tick" role="img" aria-label={done ? 'Done' : 'Not done yet'}>{done && <Icon name="check" />}</span>
      <a class="fr-link" href={href}>
        <span>{children}</span>
        <span class="fr-go" aria-hidden="true"><Icon name="forward" /></span>
      </a>
    </li>
  );
}

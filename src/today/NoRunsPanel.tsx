// The panel Today and the PAM tab show before the first full run: the No runs copy (spec §7) over the empty run
// strip, and on Today [Start your first run].
import type { JSX } from 'preact';
import type { RunRecord } from '../progress/types';
import { Primary, Secondary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { RunStrip } from '../ui/RunStrip';

export const NO_RUNS_COPY = 'No runs yet. A run takes about 20 minutes. The clock starts when you say Approach.';
export const EMPTY_STRIP_LABEL = 'Run strip, 0 to 20 minutes. No runs yet. Limits: RBS by 3:00, whole run by 20:00.';

/** Whether any full run (not a drill) is on record. */
export function hasFullRun(runs: RunRecord[]): boolean {
  return runs.some((r) => !r.drill);
}

/** `start`: the Start your first run key, as the screen's one primary key or a secondary one; none without it (the PAM
 *  tab, whose New case does the same). */
export function NoRunsPanel({ title, start }: { title: string; start?: 'primary' | 'secondary' }): JSX.Element {
  const Key = start === 'primary' ? Primary : Secondary;
  return (
    <Panel class="norun">
      <h2 class="plabel">{title}</h2>
      <p class="norun-line">{NO_RUNS_COPY}</p>
      <RunStrip label={EMPTY_STRIP_LABEL} />
      {start !== undefined && <div class="keys"><Key href="#/pam/start">Start your first run</Key></div>}
    </Panel>
  );
}

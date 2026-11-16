// The PAM tab (#/pam, spec §6.1): the run in progress, New case, and the run history (No runs yet before the first
// record), which replaces Plan 2's Last run card (Plan 3 ruling D10; Today keeps its card). The one primary key is
// Resume while a run is open, else New case.
import type { JSX } from 'preact';
import { RunResume, useRunRow } from '../today/RunResume';
import { Primary, Secondary } from '../ui/Keys';
import { RunHistory } from './RunHistory';

export function PamTab(): JSX.Element {
  const run = useRunRow();
  // While a saved run is still being read, neither key is primary yet: Resume may be about to take it.
  const NewCase = run === 'none' ? Primary : Secondary;
  return (
    <div class="screen">
      <header class="screen-head"><h1 class="h1">PAM</h1></header>
      <RunResume primary={run === 'shown'} />
      {/* A wrapper, so the key keeps its own width rather than stretching across the column. */}
      <div><NewCase href="#/pam/start">New case</NewCase></div>
      <RunHistory />
    </div>
  );
}

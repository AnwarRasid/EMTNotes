// The run in progress, on Today and the PAM tab (spec §7): where it stands, then [Resume] and [Discard], with an Undo;
// or, while its steps or cases failed to load, why it can't be shown, with [Try again].
import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import { contentErrorCopy } from '../data/load';
import { useProgress, useStore } from '../progress/hooks';
import type { RunSession } from '../progress/types';
import { useOpenRun } from '../run/useRun';
import { formatMmSs, recoverClock } from '../sim/clock';
import { runElapsed, shownStep, type RunEnv } from '../sim/run';
import { Primary, Secondary } from '../ui/Keys';
import { Panel } from '../ui/Panel';
import { discardOpen } from './discard';

/**
 * "Run in progress: Breathlessness, step 6, 02:05 used. The clock paused when you left." (spec §7), or for a drill,
 * which has no clock, "Drill in progress: Breathlessness, step 11.". The step is the one the run screen shows (in a
 * drill, within its range). A clock still running here was left by a page that died mid-run: the run screen recovers
 * it to the run's last save (recoverClock), so the time counts to that, never the hours since.
 */
export function runResumeLine(s: RunSession, env: RunEnv, now: number): string {
  const step = shownStep(env, s);
  if (s.drill !== null) return `Drill in progress: ${env.case.complaint}, step ${step}.`;
  const used = runElapsed({ ...s, clock: recoverClock(s.clock, s.lastAt) }, now);
  return `Run in progress: ${env.case.complaint}, step ${step}, ${formatMmSs(used)} used. The clock paused when you left.`;
}

/**
 * Whether the run row shows ('shown'), may yet ('pending': a run is saved but the steps and cases to read it are still
 * loading), or won't ('none': no run, its content failed, or its case has left this phone and it is being cleared).
 * The screens hold their primary key while it is pending, so no key is primary for a moment and then steps down.
 */
export function useRunRow(): 'shown' | 'pending' | 'none' {
  const open = useOpenRun();
  const saved = useProgress((p) => p.runOpen !== null);
  return open.status === 'open' ? 'shown' : saved && open.status === 'loading' ? 'pending' : 'none';
}

/** The row's line while a run is open but the steps or the cases to read it failed to load (ruling D29): the content's
 *  own error copy after "A run is open, but", so "A run is open, but the cases didn't load. They aren't saved on this
 *  phone yet. Connect once, then try again.", or "…but the PAM steps didn't load. …". */
export function openRunErrorCopy(key: 'steps' | 'cases'): string {
  const copy = contentErrorCopy(key);
  return `A run is open, but ${copy.charAt(0).toLowerCase()}${copy.slice(1)}`;
}

/** The row, once the open run can be read. `primary`: Resume is the screen's one primary key. Each key names the
 *  row's line as its description, since Today can show a quiz's Resume and Discard beside it. While the run's content
 *  failed to load, the row says so with a secondary Try again instead (the screen's primary key is picked as if no run
 *  were open), and the run stays saved. */
export function RunResume({ primary }: { primary: boolean }): JSX.Element | null {
  const store = useStore();
  const open = useOpenRun();
  const saved = useProgress((p) => p.runOpen !== null);
  const lineId = useId();
  if (open.status === 'error' && saved) {
    return (
      // Set as the app's other content errors are (RunStart's RunContentError, the history's), in the run row's place.
      <Panel class="load-error">
        <p class="load-error-msg" id={lineId} role="alert">{openRunErrorCopy(open.key)}</p>
        <div class="keys"><Secondary onClick={open.retry} describedBy={lineId}>Try again</Secondary></div>
      </Panel>
    );
  }
  if (open.status !== 'open') return null;
  const Resume = primary ? Primary : Secondary;
  return (
    <Panel class="resume">
      <p class="resume-line" id={lineId}>{runResumeLine(open.session, open.env, Date.now())}</p>
      <div class="keys">
        <Resume href="#/run" describedBy={lineId}>Resume</Resume>
        <Secondary onClick={() => discardOpen(store, 'run')} describedBy={lineId}>Discard</Secondary>
      </div>
    </Panel>
  );
}

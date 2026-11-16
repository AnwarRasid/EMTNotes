// The Pause sheet (spec §6.2): a modal bottom sheet over the run, which the Pause key and Android's back open with the
// clock stopped. Its rows run, top to bottom, End run, the mode (read-only: it is set when the run starts), Restart
// case and Resume, so Resume sits nearest the thumb and End run farthest from it (ruling S6). End and Restart each ask
// to confirm in the sheet's place.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { RunMode } from '../progress/types';
import { withinHold } from '../quiz/useQuiz';
import { Primary, Secondary } from '../ui/Keys';

export const RESTART_COPY = "Restart this case? This run won't be kept.";
export type PauseConfirm = 'end' | 'restart';

const TITLE_ID = 'pause-title';
const COPY_ID = 'pause-confirm';

/**
 * The sheet, named by its "Paused" heading. With `confirm` null it shows the rows; with 'end', `endCopy` ("End run at
 * 09:40? Steps 15 to 19 count as missed.") over the confirming key and Keep going; with 'restart', RESTART_COPY over
 * Restart and Keep going.
 * - Focus: Resume as it opens; Keep going on a confirm (both keys are described by its copy); back on End run or
 *   Restart case after Keep going. Escape resumes, from anywhere in it.
 * - The confirming key takes the place of the key that asked, so it ignores presses for READ_HOLD_MS after it appears
 *   (ruling S5): the second tap of a double tap must not end or restart a run. Resume does the same when it comes back
 *   in Keep going's place, so a double tap on Keep going doesn't start the clock. As the sheet opens it takes presses at
 *   once: nothing was in its place.
 */
export function PauseSheet({ mode, drill, confirm, endCopy, onResume, onRestart, onEnd, onConfirm, onCancel }: {
  mode: RunMode; drill: boolean; confirm: PauseConfirm | null; endCopy: string;
  onResume(): void; onRestart(): void; onEnd(): void; onConfirm(): void; onCancel(): void }): JSX.Element {
  const sheet = useRef<HTMLDivElement>(null);
  // When the keys last changed places (a confirm in, or the rows back after one); null while the sheet is as it opened.
  const swapped = useRef<{ confirm: PauseConfirm | null; at: number | null }>({ confirm, at: null });
  if (swapped.current.confirm !== confirm) swapped.current = { confirm, at: performance.now() };
  const held = () => withinHold(swapped.current.at);
  const asked = useRef<PauseConfirm | null>(null);   // the confirm last shown, for focus to go back to its key
  const resume = useRef(onResume);
  resume.current = onResume;
  const end = drill ? 'End drill' : 'End run';

  useLayoutEffect(() => {
    const keys = Array.from(sheet.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    // the rows: End run, Restart case, Resume; a confirm: its key, Keep going
    const target = confirm !== null ? keys[1] : asked.current === 'end' ? keys[0] : asked.current === 'restart' ? keys[1] : keys.at(-1);
    asked.current = confirm;
    target?.focus();
  }, [confirm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      resume.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="sheet-wrap">
      <div class="scrim" aria-hidden="true" />
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} ref={sheet}>
        <h2 class="sheet-title" id={TITLE_ID}>Paused</h2>
        <p class="sheet-sub">The clock is stopped.</p>
        {confirm === null ? (
          <div class="sheet-rows">
            <Secondary onClick={onEnd}>{end}</Secondary>
            <div class="sheet-mode">
              <p class="sheet-mode-name">Mode: {mode === 'exam' ? 'Exam' : 'Coached'}</p>
              <p class="sheet-mode-sub">Set when the run starts.</p>
            </div>
            <Secondary onClick={onRestart}>Restart case</Secondary>
            <Primary onClick={() => { if (!held()) onResume(); }}>Resume</Primary>
          </div>
        ) : (
          <div class="sheet-rows sheet-confirm">
            <p class="sheet-copy" id={COPY_ID}>{confirm === 'end' ? endCopy : RESTART_COPY}</p>
            <Primary describedBy={COPY_ID} onClick={() => { if (!held()) onConfirm(); }}>
              {confirm === 'end' ? end : 'Restart'}
            </Primary>
            <Secondary describedBy={COPY_ID} onClick={onCancel}>Keep going</Secondary>
          </div>
        )}
      </div>
    </div>
  );
}

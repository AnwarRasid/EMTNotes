// The step list (spec §6.2, tap mode; Coached and drills): a docked, non-modal sheet in the composer's place, a row per
// step. A step picked plays as the trainee's line (its canonical line, tapped), through the run's send queue. It scrolls
// inside itself, so the header and the clock above stay in view.
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Secondary } from '../ui/Keys';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/toast';

/** A tap the run couldn't take (the queue's call resolved false): its row comes back to tap again. */
export const STEP_FAILED = "That step didn't go through. Tap it again.";

export interface StepRow { id: string; order: number; name: string; covered: boolean; inRange: boolean }

/**
 * The list: a header with Back to typing, then a button per row, "{order} {name}". A row is disabled once covered
 * (with "Done"), outside the drill (with "Not in this drill"), or while its tap is on its way. A pick goes to `onPick`;
 * when that returns a promise that resolves false, the row is enabled again with STEP_FAILED. The list stays open.
 * - Focus: the first row still to play as the list opens, scrolled to the list's top; after a pick, the next one, or
 *   Back to typing once none is left, so focus never falls to the page.
 */
export function StepSheet({ rows, onPick, onClose }: { rows: StepRow[]; onPick(stepId: string): void | Promise<boolean>;
  onClose(): void }): JSX.Element {
  const root = useRef<HTMLElement>(null);
  const pending = useRef(new Set<string>());
  const [, rerender] = useState(0);
  const off = (r: StepRow): boolean => r.covered || !r.inRange || pending.current.has(r.id);

  // The first step still to play opens at the top of the list, not at its foot under the steps done (Task 15 review).
  // Only the list scrolls, at once: it has no smooth scrolling, so reduced motion needs nothing more.
  useLayoutEffect(() => {
    const first = nextKey(root.current, null);
    first?.focus({ preventScroll: true });
    const list = root.current?.querySelector<HTMLElement>('.ss-list') ?? null;
    if (first === null || list === null || !list.contains(first)) return;
    const pad = parseFloat(getComputedStyle(list).paddingTop) || 0;
    list.scrollTop += first.getBoundingClientRect().top - list.getBoundingClientRect().top - pad;
  }, []);

  const pick = (r: StepRow, e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    if (off(r)) return;   // the second click of a double click: its tap is already on its way
    const sent = onPick(r.id);
    if (!(sent instanceof Promise)) return;
    pending.current.add(r.id);
    rerender((n) => n + 1);
    // A tap or a click (detail > 0) keeps the list where it is; a key press scrolls the next row into view.
    nextKey(root.current, e.currentTarget)?.focus({ preventScroll: e.detail > 0 });
    void sent.then((ok) => {
      pending.current.delete(r.id);
      rerender((n) => n + 1);
      if (!ok) toast(STEP_FAILED);
    });
  };

  return (
    <section class="stepsheet" aria-label="Step list" ref={root}>
      <div class="ss-head">
        <h2 class="ss-title">Step list</h2>
        <Secondary onClick={onClose}>Back to typing</Secondary>
      </div>
      <ol class="ss-list">
        {rows.map((r) => {
          const state = r.covered ? 'done' : r.inRange ? null : 'out';
          const stateId = `ss-${r.id}`;
          return (
            <li key={r.id} class={state === null ? 'ss-row' : `ss-row ss-${state}`}>
              {/* The state is the key's description, not part of its name ("6 Introduction"), so it is hidden from the
                  name and pointed at instead. */}
              <button type="button" class="ss-key" disabled={off(r)} aria-describedby={state === null ? undefined : stateId}
                onClick={(e) => pick(r, e)}>
                <b class="ss-n tn">{r.order}</b> <span class="ss-name">{r.name}</span>
                {state !== null && (
                  <span class="ss-state" id={stateId} aria-hidden="true">
                    {state === 'done' ? <StatusChip kind="done" label="Done" /> : 'Not in this drill'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The first enabled row after `after` (from the top with null), else Back to typing. */
function nextKey(root: HTMLElement | null, after: HTMLButtonElement | null): HTMLButtonElement | null {
  if (root === null) return null;
  const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('.ss-key'));
  const from = after === null ? 0 : rows.indexOf(after) + 1;
  return rows.slice(from).find((b) => !b.disabled) ?? root.querySelector<HTMLButtonElement>('.ss-head button');
}

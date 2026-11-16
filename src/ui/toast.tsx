// Toasts: one at a time, queued, read out through a polite status region. A toast without an action leaves by
// itself after time to read it, pausing while it has keyboard focus (a visible focus ring) or a mouse over it;
// one with an action stays until it is used or dismissed, unless it is given a time of its own (an Undo), which
// pauses the same way. Focus a script moved there after a tap or a click doesn't pause it, so a toast a touch user
// never reaches for still leaves. One that waits for its user steps aside for any newer toast and comes back after.
// When a toast closes with focus inside it, focus moves to the screen's heading.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { focusScreen, hasVisibleFocus } from '../lib/focus';
import { Icon } from './Icon';

export interface ToastAction { label: string; run(): void }
/**
 * - `ms`: how long the toast shows (pausing on keyboard focus and hover), for one with an action, which otherwise
 *   stays.
 * - `onClose`: runs once the toast has gone, however it went.
 * - `focusAction`: for a toast raised by a key that goes with the tap (Discard). Focus moves to the toast's action
 *   as it shows, if it shows now (or straight after one already fading); one that has to wait its turn sends focus
 *   to the screen's heading instead, so focus doesn't jump from wherever it has got to when its turn comes.
 */
export interface ToastOptions { ms?: number; onClose?(): void; focusAction?: boolean }
interface Item { id: number; message: string; action?: ToastAction; ms?: number; onClose?(): void }
type Hold = 'focus' | 'hover';

const EXIT_MS = 140;           // --t-exit, the fade-out in components.css
const RESUME_MIN_MS = 2_000;   // after a pause, at least this long before it leaves

let queue: Item[] = [];
let leaving = false;
let timer: ReturnType<typeof setTimeout> | undefined;       // the reading clock only
let exitTimer: ReturnType<typeof setTimeout> | undefined;   // the exit fade, kept apart so a hold can't cancel it
let deadline = 0;
let remaining = 0;
const holds = new Set<Hold>();
let nextId = 1;
let focusId: number | null = null;   // a toast whose action takes focus as it shows (focusAction)
const listeners = new Set<() => void>();

const emit = () => { for (const fn of [...listeners]) fn(); };

/** 5 s, or 70 ms a character for a longer message, up to 10 s. */
const readingMs = (message: string) => Math.min(10_000, Math.max(5_000, message.length * 70));

const stopClock = () => { clearTimeout(timer); timer = undefined; };

/** Timers live here, not in effects, so they run with or without a render. */
function runClock(ms: number): void {
  stopClock();
  const head = queue[0];
  if (!head || leaving || (head.action && head.ms === undefined)) return;
  deadline = Date.now() + ms;
  timer = setTimeout(() => close(head.id), ms);
}

function showHead(): void {
  holds.clear();
  const head = queue[0];
  if (head) runClock(head.ms ?? readingMs(head.message));
  else stopClock();
}

function hold(reason: Hold): void {
  if (leaving || holds.has(reason)) return;   // a fading toast is on its way out; nothing holds it
  holds.add(reason);
  if (holds.size === 1 && timer !== undefined) {
    remaining = Math.max(0, deadline - Date.now());
    stopClock();
  }
}

function release(reason: Hold): void {
  if (!holds.delete(reason) || holds.size > 0 || leaving) return;
  runClock(Math.max(remaining, RESUME_MIN_MS));
}

const focusInToasts = () => {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return active instanceof Element && active.closest('.toasts') !== null;
};

function close(id: number): void {
  if (leaving || queue[0]?.id !== id) return;
  leaving = true;   // first, so the focusout that focusScreen() fires can't restart the clock
  stopClock();
  holds.clear();
  if (focusInToasts()) focusScreen();   // its buttons are about to go
  emit();
  exitTimer = setTimeout(() => {
    exitTimer = undefined;
    leaving = false;
    const gone = queue[0];
    queue = queue.slice(1);
    showHead();
    emit();
    gone?.onClose?.();
  }, EXIT_MS);
}

/** How long `t` shows when nothing holds it: its own time, else forever for one with an action, else time to read. */
const showMs = (t: Item) => t.ms ?? (t.action ? Infinity : readingMs(t.message));

/** A repeat of `same`'s message: its onClose chains after `same`'s, and its `ms`, if longer, becomes `same`'s time.
 *  The first call's action stays. For the toast showing, the repeat's `ms` also counts from now, if that is later. */
function mergeInto(same: Item, opts: ToastOptions | undefined): void {
  const more = opts?.onClose;
  if (more) {
    const first = same.onClose;
    same.onClose = first ? () => { try { first(); } finally { more(); } } : more;
  }
  const ms = opts?.ms;
  if (ms === undefined) return;
  if (ms > showMs(same)) same.ms = ms;
  if (queue[0] !== same || leaving) return;   // a waiting toast's clock starts from its time when it shows
  if (holds.size > 0) remaining = Math.max(remaining, ms);
  else if (timer !== undefined) runClock(Math.max(deadline - Date.now(), ms));   // none runs for an action that waits
}

/** A toast that waits for its user (an action, no time of its own), such as "A new version is ready." [Reload]. */
const waitsForUser = (t: Item) => showMs(t) === Infinity;

/**
 * Queues a toast and returns its id, for dismissToast. The same message already showing or waiting is not queued
 * twice: its id comes back instead, and the repeat's options merge into it: the longer `ms` is kept and both
 * `onClose` callbacks run, the first first. Its action and `focusAction` are dropped. One on its way out doesn't
 * count, so a message dismissed to be replaced can show again.
 *
 * Toasts that wait for their user never hold the one slot: a newer toast goes ahead of them, at once if one is
 * showing (it is set aside, not closed, and comes back once the newer has gone). So an Undo or a save failure always
 * shows while an update waits. A toast fading out is never cut short.
 */
export function toast(message: string, action?: ToastAction, opts?: ToastOptions): number {
  const same = queue.find((t, i) => t.message === message && !(i === 0 && leaving));
  if (same) {
    mergeInto(same, opts);
    return same.id;
  }
  const item: Item = { id: nextId++, message, action, ms: opts?.ms, onClose: opts?.onClose };
  let at = queue.length;
  while (at > 0 && waitsForUser(queue[at - 1]!) && !(at === 1 && leaving)) at -= 1;
  if (at === 0 && queue.length > 0 && focusInToasts()) focusScreen();   // the keys of the one set aside are going
  queue = [...queue.slice(0, at), item, ...queue.slice(at)];
  if (opts?.focusAction && action) {
    const showsNow = at === 0 || (at === 1 && leaving);
    if (showsNow) focusId = item.id;
    else focusScreen();
  }
  if (at === 0) showHead();
  emit();
  return item.id;
}

/** Takes a toast away: the one showing fades out as if dismissed; one still waiting is dropped. Any other id does
 *  nothing. */
export function dismissToast(id: number): void {
  if (queue[0]?.id === id) {
    close(id);
    return;
  }
  const waiting = queue.find((t) => t.id === id);
  if (!waiting) return;
  queue = queue.filter((t) => t !== waiting);
  emit();
  waiting.onClose?.();
}

/** Drops every toast at once. For tests. */
export function clearToasts(): void {
  stopClock();
  clearTimeout(exitTimer);
  exitTimer = undefined;
  const gone = queue;
  queue = [];
  leaving = false;
  focusId = null;
  holds.clear();
  emit();
  for (const t of gone) t.onClose?.();
}

export function ToastHost(): JSX.Element {
  const [, rerender] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    fn();   // catch a toast queued between render and subscribe
    return () => { listeners.delete(fn); };
  }, []);

  const head = queue[0];
  const act = head?.action;
  // focusAction: once its toast is on screen, its action takes focus. A keyboard user's (with the ring) holds the clock.
  useLayoutEffect(() => {
    if (!head || head.id !== focusId || leaving) return;
    focusId = null;
    host.current?.querySelector<HTMLElement>('.toast-act')?.focus({ preventScroll: true });
  });
  return (
    <div class="toasts" role="status" aria-live="polite" ref={host}>
      {head && (
        <div
          key={head.id}
          class={leaving ? 'toast toast-out' : 'toast'}
          inert={leaving}   // a fading toast takes no clicks, focus or screen-reader visits
          onFocusIn={(e) => { if (hasVisibleFocus(e.target)) hold('focus'); }}
          onFocusOut={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) release('focus'); }}
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') hold('hover'); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') release('hover'); }}
        >
          <p class="toast-msg">{head.message}</p>
          {act && (
            <button type="button" class="toast-act" onClick={() => { try { act.run(); } finally { close(head.id); } }}>
              {act.label}
            </button>
          )}
          <button type="button" class="ibtn toast-x" aria-label="Dismiss" onClick={() => close(head.id)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}

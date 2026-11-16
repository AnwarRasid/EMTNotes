// Discard on Today's resume rows (and the PAM tab's run row), with an Undo: Plan 1's quiz Discard, generalised to
// the open run. Each kind keeps its own Undo, so putting the run aside never costs the quiz's, nor the other way round.
// Replacing an open run with a new one (Run start, a debrief's drill, a notes drill link) offers the same Undo, as a
// third kind (Plan 3 ruling D26).
import type { ProgressStore } from '../progress/store';
import type { Progress, QuizSession, RunSession } from '../progress/types';
import { dismissToast, toast } from '../ui/toast';

export type OpenKind = 'quiz' | 'run';
/** What a pending Undo puts back: a quiz or run discarded, or a run replaced by another. */
type UndoKind = OpenKind | 'replace';

/** How long "Quiz discarded.", "Run discarded.", "Drill discarded.", "Run replaced." or "Drill replaced." offers Undo,
 *  pausing while it has keyboard focus or a mouse over it. Never Infinity (ruling S7). */
export const UNDO_MS = 8_000;

/** What each kind's Discard clears and its Undo puts back: the slot in Progress, and the toast's words for the
 *  session put aside. A drill is a run, but its row says "Drill in progress", so its toast says "Drill discarded.". */
interface Slot<T> { message(s: T): string; read(p: Progress): T | null; write(p: Progress, s: T | null): Progress }
type Sessions = { quiz: QuizSession; run: RunSession };
const SLOTS: { [K in OpenKind]: Slot<Sessions[K]> } = {
  quiz: { message: () => 'Quiz discarded.', read: (p) => p.quizOpen, write: (p, s) => ({ ...p, quizOpen: s }) },
  run: { message: (s) => (s.drill !== null ? 'Drill discarded.' : 'Run discarded.'),
    read: (p) => p.runOpen, write: (p, s) => ({ ...p, runOpen: s }) },
};

/** A Discard (or a replace) that can still be undone: the store's generation when it was put aside, its toast, and how
 *  to put the session back (only while nothing has taken its place). */
interface Discarded { store: ProgressStore; generation: number; toastId: number; unsubscribe(): void; restore(p: Progress): Progress }

/**
 * Each kind's one Undo still pending. Its Undo lapses, and its toast goes, when the toast times out or is dismissed,
 * when progress is replaced wholesale (resetProgress, a tryAgain that adopts a load: the store's generation moves
 * on), and when what it would put back over has changed: for a Discard, one of its kind opens (a quiz started, a run
 * begun, or a load that brings one); for a replace, the new run is gone or the trainee has said or tapped anything in
 * it. startFresh keeps memory, so the Undo outlives it. A stale Undo, its button pressed somehow after all that, finds
 * no token and does nothing.
 */
const pending: Record<UndoKind, Discarded | null> = { quiz: null, run: null, replace: null };

/** Lets the kind's pending Undo lapse and takes its toast away. */
function forgetDiscard(kind: UndoKind): void {
  const d = pending[kind];
  if (!d) return;
  pending[kind] = null;
  d.unsubscribe();
  dismissToast(d.toastId);
}

/**
 * Toasts `message` with an Undo for UNDO_MS, after the change it undoes has been made: a later one of the same kind
 * replaces this one's Undo and toast; another kind's toast waits its turn behind a showing one. The key pressed goes
 * with its screen or its row, so focus moves to the Undo (or to the heading if the toast waits). A keyboard user's
 * focus there holds the time; after a tap or a click it doesn't, and the toast still leaves on time. The Undo lapses
 * as soon as `lapsed` holds for the progress, or the generation moves; else it applies `restore`.
 */
function offerUndo(store: ProgressStore, kind: UndoKind, message: string, restore: (p: Progress) => Progress,
  lapsed: (p: Progress) => boolean): void {
  const generation = store.generation();
  const unsubscribe = store.subscribe((p) => {
    if (pending[kind] === entry && (lapsed(p) || store.generation() !== generation)) forgetDiscard(kind);
  });
  const entry: Discarded = { store, generation, toastId: 0, unsubscribe, restore };
  pending[kind] = entry;
  entry.toastId = toast(message, { label: 'Undo', run: () => undoDiscard(kind, entry) },
    { ms: UNDO_MS, focusAction: true, onClose: () => { if (pending[kind] === entry) forgetDiscard(kind); } });
}

/**
 * Clears the open quiz or run (read from the store at the tap, not from a render) and offers Undo for UNDO_MS, so a
 * stray tap never loses it for good. A second Discard of the same kind replaces the first one's Undo and toast. The
 * Undo puts the session back only into an empty slot.
 */
export function discardOpen<K extends OpenKind>(store: ProgressStore, kind: K): void {
  const slot: Slot<Sessions[K]> = SLOTS[kind];
  const session = slot.read(store.get());
  if (session === null) return;
  forgetDiscard(kind);
  store.update((p) => slot.write(p, null));
  offerUndo(store, kind, slot.message(session),
    (p) => (slot.read(p) === null ? slot.write(p, session) : p),
    (p) => slot.read(p) !== null);
}

/** How many of the run's lines are the trainee's: typed, dictated or tapped. */
const saidCount = (s: RunSession): number => s.lines.reduce((n, l) => n + (l.who === 'you' ? 1 : 0), 0);

/**
 * Writes `next` as the open run. With another run open and `opts.undo` not false, toasts "Run replaced." ("Drill
 * replaced." when the one put aside was a drill) with Undo for UNDO_MS. The Undo puts the old run back as it was saved,
 * while `next` is still the open run (its id) and the trainee has neither tapped a step in it nor said a line beyond
 * those it began with. The run screen's own writes (the clock resumed as it opens, the buddies' lines on its tick)
 * leave the Undo standing. Pause's Restart, confirmed already, passes `{ undo: false }`.
 */
export function replaceOpenRun(store: ProgressStore, next: RunSession, opts?: { undo?: boolean }): void {
  const old = store.get().runOpen;
  store.update((p) => ({ ...p, runOpen: next }));
  if (old === null || old.id === next.id || opts?.undo === false) return;
  forgetDiscard('replace');
  const said = saidCount(next);
  const untouched = (s: RunSession | null): boolean =>
    s !== null && s.id === next.id && s.tapped.length <= next.tapped.length && saidCount(s) <= said;
  offerUndo(store, 'replace', old.drill !== null ? 'Drill replaced.' : 'Run replaced.',
    (p) => (untouched(p.runOpen) ? { ...p, runOpen: old } : p),
    (p) => !untouched(p.runOpen));
}

/**
 * Lets a pending "Run replaced." (or "Drill replaced.") Undo lapse now, and takes its toast away. The run screen calls
 * it as the trainee sends a line or taps a step, before the input is read (Task 7 review M1): with a slow grader the
 * line reaches the save seconds later, and an Undo pressed meanwhile would put the old run back and drop the line.
 */
export function forgetReplace(): void {
  forgetDiscard('replace');
}

/** Brings back exactly the session put aside, if this Undo is still its kind's pending one and nothing has taken its
 *  place since. */
function undoDiscard(kind: UndoKind, entry: Discarded): void {
  if (pending[kind] !== entry) return;
  forgetDiscard(kind);
  const { store, generation } = entry;
  if (store.generation() !== generation) return;
  store.update(entry.restore);
}

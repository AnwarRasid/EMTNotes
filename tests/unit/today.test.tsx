// Task 20 (Plan 1): Today (#/) in its first-run state, its quiz resume row with Discard and Undo, and the PAM tab.
// Task 18 (Plan 2): the run resume row with its own Discard and Undo, the headline with its drill key, the last run's
// panel and strip, and the one primary key that todayPrimary picks.
import { render, screen, fireEvent, act, within } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import * as v from 'valibot';
import questionsDoc from '../../public/data/questions.json';
import overridesDoc from '../../public/data/overrides.json';
import notesDoc from '../../public/data/notes.json';
import { MemoryStorage } from './helpers';
import { CASES, IDS, POCKET, STEPS, T0, blankSession, debriefSession, envOf } from './sim-helpers';
import { primeContent, resetContentCache } from '../../src/data/load';
import { mergeQuestions, type Question } from '../../src/data/questions';
import { NotesDocSchema, OverridesDocSchema, RawQuestionsDocSchema } from '../../src/data/schema';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import { normalizeProgress, type Progress, type QStat, type QuizFilter, type QuizMode, type QuizSession, type RunRecord, type RunSession } from '../../src/progress/types';
import { startSession } from '../../src/quiz/engine';
import { resumeSummary, startQuiz } from '../../src/quiz/useQuiz';
import { mulberry32 } from '../../src/lib/rng';
import { hasVisibleFocus } from '../../src/lib/focus';
import { todayStripLabel } from '../../src/sim/debrief';
import { startDrill } from '../../src/sim/drill';
import { headline } from '../../src/sim/headline';
import { endRun } from '../../src/sim/run';
import { ToastHost, clearToasts, toast } from '../../src/ui/toast';
import { Today, UNDO_MS, todayPrimary } from '../../src/today/Today';
import { formatRunAt } from '../../src/today/LastRunPanel';
import { runResumeLine } from '../../src/today/RunResume';
import { PamTab } from '../../src/pam/PamTab';

// Whether focus shows a ring (a keyboard user) decides if it holds a toast. jsdom's :focus-visible is its own guess
// from the last event, unlike Chromium's, and it carries over between tests, so tests say which they mean with this
// spy: keyboard focus by default, as a test that focuses a key by script means. tests/e2e/today.spec.ts checks the
// real thing in Chromium.
vi.mock('../../src/lib/focus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/focus')>();
  return { ...actual, hasVisibleFocus: vi.fn(() => true) };
});

const REAL: Question[] = mergeQuestions(v.parse(RawQuestionsDocSchema, questionsDoc), v.parse(OverridesDocSchema, overridesDoc));
const NOTES = v.parse(NotesDocSchema, notesDoc);
const BY_ID = new Map(REAL.map((q) => [q.id, q]));
const ALL: QuizFilter = { group: 'all', topic: 'all' };
const NO_RUNS = 'No runs yet. A run takes about 20 minutes. The clock starts when you say Approach.';
const STRIP = 'Run strip, 0 to 20 minutes. No runs yet. Limits: RBS by 3:00, whole run by 20:00.';
const QUESTIONS_ERROR = "The question bank didn't load. It isn't saved on this phone yet. Connect once, then try again.";

const BASE = import.meta.env.BASE_URL;
const FILES: Record<string, unknown> = {
  [`${BASE}data/questions.json`]: questionsDoc, [`${BASE}data/overrides.json`]: overridesDoc, [`${BASE}data/notes.json`]: notesDoc,
};
const fileFetch = () => vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  return url in FILES ? new Response(JSON.stringify(FILES[url]), { status: 200 }) : new Response('Not found', { status: 404 });
});
const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });

const stat = (rightSinceWrong: number | null): QStat =>
  ({ seen: 1, right: rightSinceWrong === 0 ? 0 : 1, lastAt: '2026-11-09T10:00:00.000Z', lastRight: rightSinceWrong !== 0, rightSinceWrong });

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

function renderIn(store: ProgressStore, ui: ComponentChildren) {
  return render(<ProgressContext.Provider value={store}>{ui}<ToastHost /></ProgressContext.Provider>);
}

/** Matches the element whose whole text is `text`, not its ancestors: for text split by <b> or a hidden span. */
const wholeText = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

/** A session over the first `n` real ids with `answered` of them done; `checked` leaves the last answer showing. */
function sessionAfter(mode: QuizMode, n: number, answered: number, { checked = false } = {}): QuizSession {
  const ids = REAL.slice(0, n).map((q) => q.id);
  const s = startSession(mode, ids, ALL, BY_ID, mulberry32(1), new Date('2026-11-10T09:00:00Z'));
  const done = ids.slice(0, answered).map((qid) => ({ qid, picked: 'a', right: true, at: '2026-11-10T09:01:00.000Z' }));
  const queue = ids.slice(checked ? answered - 1 : answered);
  return { ...s, queue, done, checked: checked ? done[done.length - 1]! : null, picked: checked ? 'a' : null };
}

/** A full v2 run record: these Plan 1 fields, with the v2 fields at the defaults a v1 record loads with. */
function run(mode: 'coached' | 'exam', drill = false): RunRecord {
  const plan1 = { id: `${mode}-${drill}`, caseId: 'c01', mode, drill, startedAt: '2026-11-10T09:00:00.000Z', usedMs: 1_000_000,
    stepTimes: {}, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [] };
  return normalizeProgress({ runs: [plan1] })!.runs[0]!;
}

/** The checklist's ticks, in order: "Done" or "Not done yet". */
const ticks = () => within(screen.getByRole('heading', { level: 2, name: 'Start here' }).closest('section')!)
  .getAllByRole('img').map((i) => i.getAttribute('aria-label'));

/** The simulator's content, ready on the first render as a warm cache has it. */
function primeRunContent(): void {
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
}

/** The COPD run open at step 6 with 2:05 banked and the clock paused, as leaving the run screen leaves it. */
function openRun(): RunSession {
  return { ...blankSession('copd-amk-01'), current: 6, clock: { started: true, bankedMs: 125_000, runningSince: null } };
}

/** A record of the debrief's sample COPD run (17:42, Coached, every point said), with the pocket check never said
 *  when `pocket` is true: its only fault. */
function pocketRun(id: string, pocket: boolean): RunRecord {
  const s = debriefSession({ faults: false });
  const hits = { ...s.hits };
  const parts = { ...s.parts };
  if (pocket) {
    delete hits[POCKET];
    for (const k of Object.keys(parts)) if (k.startsWith(`${POCKET}/`)) delete parts[k];
  }
  return endRun(envOf('copd-amk-01'), { ...s, id, hits, parts }, T0 + 1_062_000);
}

/** Three full runs, oldest first: the pocket check missed in the oldest and the newest. */
const threeRuns = (): RunRecord[] => [pocketRun('run-a', true), pocketRun('run-b', false), pocketRun('run-c', true)];

beforeEach(() => {
  clearToasts();
  resetContentCache();
  primeContent('questions', REAL);
  primeContent('notes', NOTES);
  primeRunContent();
  vi.stubGlobal('fetch', fileFetch());
  location.hash = '#/';
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToasts();
  resetContentCache();
});

describe('Today: first run', () => {
  it('has the brand, a Settings key, a Today heading and one primary key, Start your first run', () => {
    renderIn(makeStore(), <Today />);
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeTruthy();
    expect(screen.getByText('EMTNotes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('#/settings');
    expect([...document.querySelectorAll('.primary')]).toEqual([screen.getByRole('link', { name: 'Start your first run' })]);
  });

  it('shows the Start here checklist, nothing done, each run item a link to Run start', () => {
    renderIn(makeStore(), <Today />);
    expect(ticks()).toEqual(['Not done yet', 'Not done yet', 'Not done yet']);
    expect(screen.getByRole('link', { name: 'Read the PAM steps in your notes' }).getAttribute('href')).toBe('#/notes/s01');
    expect(screen.getByRole('link', { name: 'Do a Coached run' }).getAttribute('href')).toBe('#/pam/start');
    expect(screen.getByRole('link', { name: 'Do an Exam run' }).getAttribute('href')).toBe('#/pam/start');
    expect(screen.queryByText('Arrives with the simulator')).toBeNull();
  });

  it('shows the No runs copy, the empty strip and Start your first run', () => {
    renderIn(makeStore(), <Today />);
    expect(screen.getByText(NO_RUNS)).toBeTruthy();
    expect(screen.getByRole('img', { name: STRIP })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start your first run' }).getAttribute('href')).toBe('#/pam/start');
    expect(screen.queryByText('The simulator arrives in the next update.')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Last run' })).toBeTruthy();
  });

  it('shows the Theory quiz progress at zero and no review link', () => {
    renderIn(makeStore(), <Today />);
    expect(screen.getByRole('heading', { level: 2, name: 'Theory quiz' })).toBeTruthy();
    expect(screen.getByText('Medical and trauma')).toBeTruthy();
    expect(screen.getByText(wholeText('0 of 346 answered'))).toBeTruthy();
    expect(screen.getByText('HMLS')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Review/ })).toBeNull();
  });

  it('starts reading at section 1', () => {
    renderIn(makeStore(), <Today />);
    expect(screen.getByRole('link', { name: 'Start with 1. Primary Survey' }).getAttribute('href')).toBe('#/notes/s01');
  });

  it('shows no resume row with no quiz open', () => {
    renderIn(makeStore(), <Today />);
    expect(screen.queryByText(/^Quiz in progress/)).toBeNull();
  });
});

describe('Today: the checklist ticks itself', () => {
  it('ticks the reading item once section 1 is read', () => {
    renderIn(makeStore({ notes: { lastSection: 's01', read: ['s01'] } }), <Today />);
    expect(ticks()).toEqual(['Done', 'Not done yet', 'Not done yet']);
  });

  it('ticks a run item for a full run in its mode, never for a drill', () => {
    renderIn(makeStore({ runs: [run('coached', true), run('exam')] }), <Today />);
    expect(ticks()).toEqual(['Not done yet', 'Not done yet', 'Done']);
  });

  // Final review M6: as the headline and the last times (ruling D9), a run ended before its clock started is no run done.
  it('never ticks a run item for a run ended before its clock started', () => {
    const untimed = (mode: 'coached' | 'exam'): RunRecord => ({ ...run(mode), id: `${mode}-untimed`, usedMs: 0, stepTimes: {} });
    renderIn(makeStore({ runs: [untimed('coached'), untimed('exam')] }), <Today />);
    expect(ticks()).toEqual(['Not done yet', 'Not done yet', 'Not done yet']);
  });

  it('ticks a run item for a timed run, as its used time or a step time shows', () => {
    const timedBy = (mode: 'coached' | 'exam', patch: Partial<RunRecord>): RunRecord => ({ ...run(mode), usedMs: 0, stepTimes: {}, ...patch });
    renderIn(makeStore({ runs: [timedBy('coached', { usedMs: 61_000 }), timedBy('exam', { stepTimes: { 'approach-patient': 0 } })] }), <Today />);
    expect(ticks()).toEqual(['Not done yet', 'Done', 'Done']);
  });

  it('goes away once all three are done, and the No runs panel with the first full run', () => {
    renderIn(makeStore({ notes: { lastSection: 's01', read: ['s01'] }, runs: [run('coached'), run('exam')] }), <Today />);
    expect(screen.queryByRole('heading', { level: 2, name: 'Start here' })).toBeNull();
    expect(screen.queryByText(NO_RUNS)).toBeNull();
  });

  it('keeps the No runs panel while the only runs are drills', () => {
    renderIn(makeStore({ runs: [run('coached', true)] }), <Today />);
    expect(screen.getByText(NO_RUNS)).toBeTruthy();
  });

  it('ticks as progress changes, without a remount', () => {
    const store = makeStore();
    renderIn(store, <Today />);
    act(() => store.update((p) => ({ ...p, notes: { lastSection: 's01', read: ['s01'] } })));
    expect(ticks()[0]).toBe('Done');
  });
});

describe('Today: review link', () => {
  const ids = REAL.slice(0, 2).map((q) => q.id);
  const wrong = () => Object.fromEntries(ids.map((id) => [id, stat(0)]));

  it('offers "Review 2 you got wrong" and starts that review', () => {
    const store = makeStore({ questions: wrong() });
    renderIn(store, <Today />);
    const link = screen.getByRole('link', { name: 'Review 2 you got wrong' });
    expect(link.closest('section')?.querySelector('h2')?.textContent).toBe('Theory quiz');
    expect(link.classList.contains('link')).toBe(true);   // a text link, per the mockup, not a key
    fireEvent.click(link);
    const open = store.get().quizOpen!;
    expect(open.mode).toBe('review');
    expect([...open.queue].sort()).toEqual([...ids].sort());
    expect(location.hash).toBe('#/quiz/session');
  });

  it('says it replaces an open quiz', () => {
    renderIn(makeStore({ questions: wrong(), quizOpen: sessionAfter('practice', 20, 1) }), <Today />);
    const link = screen.getByRole('link', { name: 'Review 2 you got wrong' });
    const note = document.getElementById(link.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('This replaces your open quiz.');
    // next to its link, under the panel's head, not at the foot of the panel
    expect(link.closest('.bankp-head')?.nextElementSibling).toBe(note);
  });

  it('counts only questions still in review', () => {
    const [a, b, c] = REAL.map((q) => q.id);
    renderIn(makeStore({ questions: { [a!]: stat(1), [b!]: stat(2), [c!]: stat(null) } }), <Today />);
    expect(screen.getByRole('link', { name: 'Review 1 you got wrong' })).toBeTruthy();
  });
});

describe('Today: resume row', () => {
  it('reads "Quiz in progress: Practice, 1 of 20 answered." with Resume as the one primary key', () => {
    renderIn(makeStore({ quizOpen: sessionAfter('practice', 20, 1) }), <Today />);
    expect(screen.getByText('Quiz in progress: Practice, 1 of 20 answered.')).toBeTruthy();
    const resume = screen.getByRole('link', { name: 'Resume' });
    expect(resume.getAttribute('href')).toBe('#/quiz/session');
    expect([...document.querySelectorAll('.primary')]).toEqual([resume]);
    expect(screen.getByRole('button', { name: 'Discard' }).classList.contains('btn2')).toBe(true);
  });

  it('names a test, counting a checked answer as answered', () => {
    expect(resumeSummary(sessionAfter('test', 20, 3, { checked: true }))).toBe('Quiz in progress: Test, 3 of 20 answered.');
    expect(resumeSummary(sessionAfter('test', 50, 0))).toBe('Quiz in progress: Test, 0 of 50 answered.');
  });

  it('counts what is left in a review, not the re-queued copy of a wrong answer before Next', () => {
    const s = sessionAfter('review', 5, 2);   // 3 left
    expect(resumeSummary(s)).toBe('Quiz in progress: Review wrong, 3 left.');
    const head = s.queue[0]!;
    const wrongNow = { qid: head, picked: 'b', right: false, at: '2026-11-10T09:02:00.000Z' };
    const checked = { ...s, checked: wrongNow, done: [...s.done, wrongNow], queue: [...s.queue, head] };
    expect(resumeSummary(checked)).toBe('Quiz in progress: Review wrong, 3 left.');
  });

  describe('Discard and its Undo', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(hasVisibleFocus).mockReset();   // back to keyboard focus
    });

    const undoKey = () => screen.getByRole('button', { name: 'Undo' });
    /** Discards the open quiz and returns the toast's Undo button, kept for pressing after it should have lapsed. */
    const discard = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      return undoKey();
    };

    it('clears the quiz and offers Undo, which brings back exactly that quiz within the 8 s', () => {
      const open = sessionAfter('practice', 20, 1);
      const store = makeStore({ quizOpen: open });
      renderIn(store, <Today />);
      discard();
      expect(store.get().quizOpen).toBeNull();
      expect(screen.queryByText(/^Quiz in progress/)).toBeNull();
      expect(screen.getByText('Quiz discarded.')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(UNDO_MS - 100); });
      fireEvent.click(undoKey());
      expect(store.get().quizOpen).toBe(open);
      expect(screen.getByText('Quiz in progress: Practice, 1 of 20 answered.')).toBeTruthy();
    });

    it('after a Discard by keyboard, moves focus to the Undo key, which holds the 8 s while it has it', () => {
      vi.mocked(hasVisibleFocus).mockReturnValue(true);   // the browser shows the focus ring: a keyboard user
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      const key = screen.getByRole('button', { name: 'Discard' });
      key.focus();
      fireEvent.click(key);
      expect(document.activeElement).toBe(undoKey());
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(screen.getByText('Quiz discarded.')).toBeTruthy();
      act(() => undoKey().blur());
      act(() => { vi.advanceTimersByTime(UNDO_MS + 200); });
      expect(screen.queryByText('Quiz discarded.')).toBeNull();
    });

    it('after a Discard by touch or mouse, moves focus to the Undo key too, but the 8 s still run out', () => {
      vi.mocked(hasVisibleFocus).mockReturnValue(false);   // focus a script moved after a tap: no ring
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      const key = screen.getByRole('button', { name: 'Discard' });
      key.focus();
      fireEvent.click(key);
      expect(document.activeElement).toBe(undoKey());
      act(() => { vi.advanceTimersByTime(UNDO_MS - 100); });
      expect(screen.getByText('Quiz discarded.')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.queryByText('Quiz discarded.')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });

    it("moves focus to the screen's heading instead when the toast has to wait its turn", () => {
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      render(<ProgressContext.Provider value={store}><main><Today /></main><ToastHost /></ProgressContext.Provider>);
      act(() => { toast('Ready to use offline.'); });
      const key = screen.getByRole('button', { name: 'Discard' });
      key.focus();
      fireEvent.click(key);
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Today' }));
      act(() => { vi.advanceTimersByTime(5_200); });   // its turn comes: no jump to the Undo now
      expect(screen.getByText('Quiz discarded.')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Today' }));
    });

    it('takes the toast and the Undo away 8 s after it shows, with focus elsewhere', () => {
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      const stale = discard();
      act(() => stale.blur());
      act(() => { vi.advanceTimersByTime(UNDO_MS + 200); });
      expect(screen.queryByText('Quiz discarded.')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
      fireEvent.click(stale);
      expect(store.get().quizOpen).toBeNull();
    });

    it('holds the 8 s while the Undo has focus', () => {
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      const undo = discard();
      act(() => undo.focus());
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(screen.getByText('Quiz discarded.')).toBeTruthy();
    });

    it('restores nothing after a reset, and its toast goes', () => {
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      const stale = discard();
      act(() => store.resetProgress());
      fireEvent.click(stale);   // pressed somehow, as the toast fades
      expect(store.get().quizOpen).toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByText('Quiz discarded.')).toBeNull();
    });

    it('restores nothing after a Try again that loads the save', () => {
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      const stale = discard();
      act(() => { store.tryAgain(); });
      fireEvent.click(stale);
      expect(store.get().quizOpen).toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByText('Quiz discarded.')).toBeNull();
    });

    it('still restores after Start fresh, which keeps memory and clears only the slots', () => {
      const open = sessionAfter('practice', 20, 1);
      const store = makeStore({ quizOpen: open });
      renderIn(store, <Today />);
      discard();
      act(() => store.startFresh());
      fireEvent.click(undoKey());
      expect(store.get().quizOpen).toBe(open);
    });

    it('never overwrites a quiz started since, nor brings the old one back once that one has gone', () => {
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      const stale = discard();
      act(() => { startQuiz(store, REAL, 'test', ALL); });
      const newer = store.get().quizOpen!;
      expect(newer.mode).toBe('test');
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByText('Quiz discarded.')).toBeNull();
      fireEvent.click(stale);
      expect(store.get().quizOpen).toBe(newer);
      act(() => store.update((p) => ({ ...p, quizOpen: null })));   // say the new quiz is done
      fireEvent.click(stale);
      expect(store.get().quizOpen).toBeNull();
    });

    it('offers a fresh Undo for a Discard pressed while the last Undo is fading', () => {
      const open = sessionAfter('practice', 20, 1);
      const store = makeStore({ quizOpen: open });
      renderIn(store, <Today />);
      discard();
      fireEvent.click(undoKey());
      expect(store.get().quizOpen).toBe(open);
      expect(document.querySelector('.toast')?.className).toBe('toast toast-out');   // the 140 ms fade has begun
      act(() => { vi.advanceTimersByTime(50); });
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));   // inside the fade
      expect(store.get().quizOpen).toBeNull();
      act(() => { vi.advanceTimersByTime(150); });   // the old toast has gone; its onClose must not cancel the new Undo
      expect(screen.getAllByText('Quiz discarded.')).toHaveLength(1);
      expect(document.querySelector('.toast')?.className).toBe('toast');
      expect(document.activeElement).toBe(undoKey());
      fireEvent.click(undoKey());
      expect(store.get().quizOpen).toBe(open);
      expect(screen.getByText('Quiz in progress: Practice, 1 of 20 answered.')).toBeTruthy();
    });

    it('gives a second Discard its own toast and Undo', () => {
      const store = makeStore({ quizOpen: sessionAfter('practice', 20, 1) });
      renderIn(store, <Today />);
      discard();
      const second = sessionAfter('test', 20, 4);
      act(() => store.update((p) => ({ ...p, quizOpen: second })));
      act(() => { vi.advanceTimersByTime(200); });
      act(() => { vi.advanceTimersByTime(UNDO_MS - 1_000); });   // the first toast's time would be nearly up
      discard();
      expect(store.get().quizOpen).toBeNull();
      expect(screen.getAllByText('Quiz discarded.')).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(UNDO_MS - 100); });
      fireEvent.click(undoKey());
      expect(store.get().quizOpen).toBe(second);
    });
  });

  it('shows no row for an open quiz with nothing left in the bank', () => {
    const gone: QuizSession = { ...sessionAfter('practice', 2, 0), queue: ['no-such-question'] };
    renderIn(makeStore({ quizOpen: gone }), <Today />);
    expect(screen.queryByText(/^Quiz in progress/)).toBeNull();
  });
});

describe('Today: continue reading', () => {
  it('links to the last section read', () => {
    renderIn(makeStore({ notes: { lastSection: 's07', read: ['s07'] } }), <Today />);
    expect(screen.getByRole('link', { name: 'Continue reading: 7. Auscultation (6 points)' }).getAttribute('href')).toBe('#/notes/s07');
    expect(screen.queryByRole('link', { name: /^Start with/ })).toBeNull();
  });

  it('starts at section 1 when the last section is gone from the notes', () => {
    renderIn(makeStore({ notes: { lastSection: 's99', read: [] } }), <Today />);
    expect(screen.getByRole('link', { name: 'Start with 1. Primary Survey' }).getAttribute('href')).toBe('#/notes/s01');
  });
});

describe('Today: the question bank fails to load', () => {
  it('says so in place of the quiz panel, and still shows the checklist and the strip', async () => {
    resetContentCache();
    primeContent('notes', NOTES);
    primeRunContent();
    vi.stubGlobal('fetch', offlineFetch());
    renderIn(makeStore(), <Today />);
    expect(await screen.findByText(QUESTIONS_ERROR)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Start here' })).toBeTruthy();
    expect(screen.getByRole('img', { name: STRIP })).toBeTruthy();
    // its Try again steps down, so the screen keeps one primary key
    expect(screen.getByRole('button', { name: 'Try again' }).classList.contains('btn2')).toBe(true);
    expect([...document.querySelectorAll('.primary')]).toEqual([screen.getByRole('link', { name: 'Start your first run' })]);
  });
});

describe('PAM tab', () => {
  it('has the PAM heading, the No runs copy, the empty strip and New case as the one primary key', () => {
    renderIn(makeStore(), <PamTab />);
    expect(screen.getByRole('heading', { level: 1, name: 'PAM' })).toBeTruthy();
    expect(screen.getByText(NO_RUNS)).toBeTruthy();
    expect(screen.getByRole('img', { name: STRIP })).toBeTruthy();
    expect(screen.queryByText('The simulator arrives in the next update.')).toBeNull();
    expect([...document.querySelectorAll('.primary')]).toEqual([screen.getByRole('link', { name: 'New case' })]);
  });
});

// ---- Task 18 ---------------------------------------------------------------------------------------------------

describe('todayPrimary', () => {
  const none = { runOpen: false, quizOpen: false, headline: false, noRuns: false };
  it('picks the run, then the quiz, then the headline, then the first run, else nothing', () => {
    expect(todayPrimary({ runOpen: true, quizOpen: true, headline: true, noRuns: false })).toBe('run');
    expect(todayPrimary({ ...none, quizOpen: true, headline: true })).toBe('quiz');
    expect(todayPrimary({ ...none, headline: true })).toBe('headline');
    expect(todayPrimary({ ...none, noRuns: true })).toBe('start');
    expect(todayPrimary(none)).toBeNull();
  });
});

describe('formatRunAt', () => {
  // Every date from local parts, so these hold in any time zone.
  const now = new Date(2026, 10, 13, 23, 0);
  const at = (d: Date) => formatRunAt(d.toISOString(), now);
  it('says Today or Yesterday by the local date, else the day and month', () => {
    expect(at(new Date(2026, 10, 13, 22, 10))).toBe('Today, 22:10');
    expect(at(new Date(2026, 10, 12, 22, 10))).toBe('Yesterday, 22:10');
    expect(at(new Date(2026, 10, 9, 22, 10))).toBe('9 Nov, 22:10');
  });
  it('counts by the calendar, not by 24 hours', () => {
    expect(at(new Date(2026, 10, 13, 0, 5))).toBe('Today, 00:05');
    expect(at(new Date(2026, 10, 12, 23, 59))).toBe('Yesterday, 23:59');
    expect(at(new Date(2026, 10, 11, 23, 59))).toBe('11 Nov, 23:59');
  });
  it('reads a time it cannot parse as formatSavedAt does', () => {
    expect(formatRunAt('not a date', now)).toBe('an unknown time');
  });
});

describe('Today: a run in progress', () => {
  const LINE = 'Run in progress: Breathlessness, step 6, 02:05 used. The clock paused when you left.';
  /** The resume row whose line starts with `start`. */
  const row = (start: RegExp) => screen.getByText(start).closest('section')!;

  it('says where the run stands, with Resume as the one primary key', () => {
    renderIn(makeStore({ runOpen: openRun() }), <Today />);
    expect(screen.getByText(LINE)).toBeTruthy();
    const resume = within(row(/^Run in progress/)).getByRole('link', { name: 'Resume' });
    expect(resume.getAttribute('href')).toBe('#/run');
    expect([...document.querySelectorAll('.primary')]).toEqual([resume]);
    expect(within(row(/^Run in progress/)).getByRole('button', { name: 'Discard' }).classList.contains('btn2')).toBe(true);
    // the first run's key steps down while the run is open
    expect(screen.getByRole('link', { name: 'Start your first run' }).classList.contains('btn2')).toBe(true);
  });

  it('runResumeLine: the shown step and the time used; a clock a dead page left running counts to its last save', () => {
    const env = envOf('copd-amk-01');
    expect(runResumeLine(openRun(), env, T0 + 999_999)).toBe(LINE);
    const left = { ...openRun(), lastAt: T0 + 5_000, clock: { started: true, bankedMs: 120_000, runningSince: T0 } };
    expect(runResumeLine(left, env, T0 + 3_600_000)).toBe(LINE);
    expect(runResumeLine(blankSession('copd-amk-01'), env, T0)).toBe(
      'Run in progress: Breathlessness, step 1, 00:00 used. The clock paused when you left.');
  });

  it('says "Drill in progress" for a drill, at its step', () => {
    const drill = startDrill(envOf('copd-amk-01'), 'rapid-body-survey', [], null, IDS, T0);
    renderIn(makeStore({ runOpen: drill }), <Today />);
    expect(screen.getByText('Drill in progress: Breathlessness, step 11.')).toBeTruthy();
  });

  it('with a quiz open as well, the quiz Resume is secondary and each key names its row', () => {
    renderIn(makeStore({ runOpen: openRun(), quizOpen: sessionAfter('practice', 20, 1) }), <Today />);
    const quiz = within(row(/^Quiz in progress/)).getByRole('link', { name: 'Resume' });
    const run = within(row(/^Run in progress/)).getByRole('link', { name: 'Resume' });
    expect(quiz.classList.contains('btn2')).toBe(true);
    expect([...document.querySelectorAll('.primary')]).toEqual([run]);
    expect(document.getElementById(run.getAttribute('aria-describedby') ?? '')?.textContent).toBe(LINE);
    expect(document.getElementById(quiz.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Quiz in progress: Practice, 1 of 20 answered.');
    // the run row comes first
    expect(row(/^Run in progress/).compareDocumentPosition(row(/^Quiz in progress/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('makes no key primary while the saved run is still being read, then Resume', () => {
    resetContentCache();
    primeContent('questions', REAL);
    primeContent('notes', NOTES);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));   // the steps and cases never arrive by fetch
    renderIn(makeStore({ runOpen: openRun() }), <Today />);
    expect(screen.getByRole('link', { name: 'Start your first run' }).classList.contains('btn2')).toBe(true);
    expect(document.querySelector('.primary')).toBeNull();
    act(() => primeRunContent());
    expect([...document.querySelectorAll('.primary')]).toEqual([screen.getByRole('link', { name: 'Resume' })]);
  });

  it('shows no row, and keeps the first run primary, while a run that closed with its case is cleared', () => {
    const gone = { ...openRun(), caseId: 'no-such-case' };
    const store = makeStore({ runOpen: gone });
    renderIn(store, <Today />);
    expect(screen.queryByText(/^Run in progress/)).toBeNull();
    expect(store.get().runOpen).toBeNull();
    expect([...document.querySelectorAll('.primary')]).toEqual([screen.getByRole('link', { name: 'Start your first run' })]);
  });

  describe('Discard and its Undo', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(hasVisibleFocus).mockReset();
    });
    const undoKey = () => screen.getByRole('button', { name: 'Undo' });
    const discardRun = () => {
      fireEvent.click(within(row(/^Run in progress/)).getByRole('button', { name: 'Discard' }));
      return undoKey();
    };

    it('clears the run and toasts "Run discarded." with Undo, which brings back the same session within the 8 s', () => {
      const open = openRun();
      const store = makeStore({ runOpen: open });
      renderIn(store, <Today />);
      const undo = discardRun();
      expect(store.get().runOpen).toBeNull();
      expect(screen.queryByText(/^Run in progress/)).toBeNull();
      expect(screen.getByText('Run discarded.')).toBeTruthy();
      expect(document.activeElement).toBe(undo);
      act(() => { vi.advanceTimersByTime(UNDO_MS - 100); });
      fireEvent.click(undoKey());
      expect(store.get().runOpen).toBe(open);
      expect(screen.getByText(LINE)).toBeTruthy();
    });

    it('lets the Undo go after the 8 s, with focus elsewhere', () => {
      const store = makeStore({ runOpen: openRun() });
      renderIn(store, <Today />);
      const stale = discardRun();
      act(() => stale.blur());
      act(() => { vi.advanceTimersByTime(UNDO_MS + 200); });
      expect(screen.queryByText('Run discarded.')).toBeNull();
      fireEvent.click(stale);
      expect(store.get().runOpen).toBeNull();
    });

    it('never overwrites a run opened since, and its toast goes', () => {
      const store = makeStore({ runOpen: openRun() });
      renderIn(store, <Today />);
      const stale = discardRun();
      const newer = { ...blankSession('copd-amk-01'), id: 'run-2' };
      act(() => store.update((p) => ({ ...p, runOpen: newer })));
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByText('Run discarded.')).toBeNull();
      fireEvent.click(stale);
      expect(store.get().runOpen).toBe(newer);
    });

    it('restores nothing after a reset', () => {
      const store = makeStore({ runOpen: openRun() });
      renderIn(store, <Today />);
      const stale = discardRun();
      act(() => store.resetProgress());
      fireEvent.click(stale);
      expect(store.get().runOpen).toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByText('Run discarded.')).toBeNull();
    });

    it("keeps a quiz's Undo when the run's Undo brings the run back, and both come back in turn", () => {
      const run = openRun();
      const quiz = sessionAfter('practice', 20, 1);
      const store = makeStore({ runOpen: run, quizOpen: quiz });
      renderIn(store, <Today />);
      discardRun();
      fireEvent.click(within(row(/^Quiz in progress/)).getByRole('button', { name: 'Discard' }));
      expect(store.get()).toMatchObject({ runOpen: null, quizOpen: null });
      fireEvent.click(undoKey());   // the run's toast shows first
      expect(store.get().runOpen).toBe(run);
      act(() => { vi.advanceTimersByTime(200); });   // the run's toast fades; the quiz's takes its place
      expect(screen.getByText('Quiz discarded.')).toBeTruthy();
      fireEvent.click(undoKey());
      expect(store.get().quizOpen).toBe(quiz);
    });

    it("keeps the run's Undo when a quiz opens, and it still brings back the run", () => {
      const run = openRun();
      const store = makeStore({ runOpen: run });
      renderIn(store, <Today />);
      discardRun();
      act(() => { startQuiz(store, REAL, 'test', ALL); });
      const quiz = store.get().quizOpen;
      expect(quiz).not.toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByText('Run discarded.')).toBeTruthy();
      fireEvent.click(undoKey());
      expect(store.get().runOpen).toBe(run);
      expect(store.get().quizOpen).toBe(quiz);   // the quiz started since stays
    });

    it('says "Drill discarded." for a drill, and its Undo brings the drill back', () => {
      const drill = startDrill(envOf('copd-amk-01'), 'rapid-body-survey', [], null, IDS, T0);
      const store = makeStore({ runOpen: drill });
      renderIn(store, <Today />);
      fireEvent.click(within(row(/^Drill in progress/)).getByRole('button', { name: 'Discard' }));
      expect(store.get().runOpen).toBeNull();
      expect(screen.getByText('Drill discarded.')).toBeTruthy();
      expect(screen.queryByText('Run discarded.')).toBeNull();
      fireEvent.click(undoKey());
      expect(store.get().runOpen).toBe(drill);
      expect(screen.getByText('Drill in progress: Breathlessness, step 11.')).toBeTruthy();
    });
  });
});

describe('Today: the headline and the last run', () => {
  it('shows the most frequent recent mistake, with its drill as the one primary key and its notes link', () => {
    renderIn(makeStore({ runs: threeRuns() }), <Today />);
    const title = screen.getByRole('heading', { level: 2, name: 'Pocket check missed in 2 of your last 3 runs' });
    const panel = title.closest('section')!;
    expect(panel.querySelector('.tag')?.textContent).toBe('!!!Missed');
    expect(within(panel).getByText('Pocket check, after seeking permission. Step 12, Rapid body survey.')).toBeTruthy();
    const drill = within(panel).getByRole('link', { name: 'Drill steps 11 to 13' });
    expect(drill.getAttribute('href')).toBe('#/pam/start?drill=rapid-body-survey');
    expect([...document.querySelectorAll('.primary')]).toEqual([drill]);
    expect(within(panel).getByRole('link', { name: 'Notes 1' }).getAttribute('href')).toBe('#/notes/s01/rapid-body-survey');
  });

  it('steps the drill key down to secondary while a run is open', () => {
    renderIn(makeStore({ runs: threeRuns(), runOpen: openRun() }), <Today />);
    expect(screen.getByRole('link', { name: 'Drill steps 11 to 13' }).classList.contains('btn2')).toBe(true);
    expect(document.querySelectorAll('.primary')).toHaveLength(1);
  });

  it('shows the last full run: when, its case and mode, its time, Open debrief and its strip', () => {
    const runs = threeRuns();
    renderIn(makeStore({ runs }), <Today />);
    const panel = screen.getByRole('heading', { level: 2, name: 'Last run' }).closest('section')!;
    const last = runs[2]!;
    expect(within(panel).getByText(formatRunAt(last.startedAt, new Date()))).toBeTruthy();
    expect(within(panel).getByText('Breathlessness, Ang Mo Kio. Coached.')).toBeTruthy();
    expect(within(panel).getByText('17:42')).toBeTruthy();
    expect(within(panel).getByText('of 20:00')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Open debrief' }).getAttribute('href')).toBe(`#/debrief/${last.id}`);
    expect(within(panel).getByRole('img', { name: todayStripLabel(last, STEPS, headline(runs)) })).toBeTruthy();
    expect(screen.queryByText(NO_RUNS)).toBeNull();
  });

  it('shows the last full run, not a newer drill, and "—" for a run whose clock never started', () => {
    const early = endRun(envOf('copd-amk-01'), { ...blankSession('copd-amk-01'), id: 'run-early' }, T0 + 5_000);
    const drill = { ...pocketRun('run-drill', true), drill: true };
    renderIn(makeStore({ runs: [early, drill] }), <Today />);
    const panel = screen.getByRole('heading', { level: 2, name: 'Last run' }).closest('section')!;
    expect(within(panel).getByRole('link', { name: 'Open debrief' }).getAttribute('href')).toBe('#/debrief/run-early');
    expect(within(panel).getByText('—')).toBeTruthy();
  });

  it('has no primary key with a clean last run and nothing open', () => {
    renderIn(makeStore({ runs: [pocketRun('run-a', false)] }), <Today />);
    expect(screen.queryByRole('heading', { level: 2, name: /missed/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Last run' })).toBeTruthy();
    expect(document.querySelector('.primary')).toBeNull();
  });
});

// ---- Plan 3 Task 7: a run open whose steps or cases failed to load (parked 5, ruling D29) --------------------------

describe('Today and the PAM tab: a run open, its content failed to load', () => {
  const CASES_ROW = "A run is open, but the cases didn't load. They aren't saved on this phone yet. Connect once, then try again.";
  const STEPS_ROW = "A run is open, but the PAM steps didn't load. They aren't saved on this phone yet. Connect once, then try again.";
  const urls = (f: ReturnType<typeof offlineFetch>) => f.mock.calls.map((c) => String(c[0]).replace(BASE, ''));
  beforeEach(() => {
    resetContentCache();
    primeContent('questions', REAL);
    primeContent('notes', NOTES);
  });

  it("Today says the cases didn't load, with a secondary Try again that fetches them again", async () => {
    primeContent('steps', { contentVersion: 'test', steps: STEPS });
    const f = offlineFetch();
    vi.stubGlobal('fetch', f);
    renderIn(makeStore({ runOpen: openRun() }), <Today />);
    const line = await screen.findByText(CASES_ROW);
    const row = line.closest('section')!;
    const again = within(row).getByRole('button', { name: 'Try again' });
    expect(again.classList.contains('btn2')).toBe(true);
    expect(document.getElementById(again.getAttribute('aria-describedby') ?? '')).toBe(line);
    expect(screen.queryByText(/^Run in progress/)).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Discard' })).toBeNull();
    // todayPrimary as before: with no run row to resume, the first run's key is the one primary
    expect([...document.querySelectorAll('.primary')]).toEqual([screen.getByRole('link', { name: 'Start your first run' })]);

    f.mockClear();
    await act(async () => { fireEvent.click(again); });
    expect(urls(f)).toEqual(['data/cases/index.json']);
  });

  it('says "the PAM steps" when the steps failed', async () => {
    primeContent('cases', CASES);
    const f = offlineFetch();
    vi.stubGlobal('fetch', f);
    renderIn(makeStore({ runOpen: openRun() }), <Today />);
    const row = (await screen.findByText(STEPS_ROW)).closest('section')!;
    expect(screen.queryByText(CASES_ROW)).toBeNull();
    f.mockClear();
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Try again' })); });
    expect(urls(f)).toContain('data/steps.json');
  });

  it('shows no such row with no run open', async () => {
    primeContent('steps', { contentVersion: 'test', steps: STEPS });
    vi.stubGlobal('fetch', offlineFetch());
    renderIn(makeStore(), <Today />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText(CASES_ROW)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('the PAM tab shows the row once, over New case as the one primary key, and the history only its heading', async () => {
    primeContent('steps', { contentVersion: 'test', steps: STEPS });
    vi.stubGlobal('fetch', offlineFetch());
    renderIn(makeStore({ runOpen: openRun(), runs: [pocketRun('run-a', true)] }), <PamTab />);
    const row = (await screen.findByText(CASES_ROW)).closest('section')!;
    expect(screen.getAllByText(CASES_ROW)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Try again' })).toEqual([within(row).getByRole('button', { name: 'Try again' })]);
    expect([...document.querySelectorAll('.primary')]).toEqual([screen.getByRole('link', { name: 'New case' })]);
    const history = screen.getByRole('heading', { level: 2, name: 'Run history' }).closest('section')!;
    expect(history.textContent).toBe('Run history');
  });
});

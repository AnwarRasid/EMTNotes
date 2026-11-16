// Task 18: the PAM tab (#/pam): the run in progress, New case, and the last run (or No runs yet before the first).
// Plan 3 Task 6: the run history replaces the Last run card (ruling D10): every record, drills too, newest first, 10 at a
// time, each one link to its debrief with a half-size strip (ruling D11).
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { MemoryStorage } from './helpers';
import { CASES, STEPS, T0, blankSession, caseById, debriefRecord, envOf, hitAll, recordOf } from './sim-helpers';
import { primeContent, resetContentCache } from '../../src/data/load';
import { HISTORY_PAGE, historyMeta, historyRowName, historyRows } from '../../src/pam/RunHistory';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import { RUN_LIMITS, normalizeProgress, type Progress, type RunRecord } from '../../src/progress/types';
import { startDrill } from '../../src/sim/drill';
import { endRun } from '../../src/sim/run';
import { formatRunAt } from '../../src/today/LastRunPanel';
import { ToastHost, clearToasts } from '../../src/ui/toast';
import { PamTab } from '../../src/pam/PamTab';

const NO_RUNS = 'No runs yet. A run takes about 20 minutes. The clock starts when you say Approach.';
const CASES_ERROR = "The cases didn't load. They aren't saved on this phone yet. Connect once, then try again.";
const FOOT = 'EMTNotes keeps your last 50 runs on this phone.';

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

function renderIn(store: ProgressStore, ui: ComponentChildren) {
  return render(<ProgressContext.Provider value={store}>{ui}<ToastHost /></ProgressContext.Provider>);
}

const primaries = () => [...document.querySelectorAll('.primary')];

/** The simulator's content, ready on the first render as a warm cache has it. */
function primeRunContent(): void {
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
}

beforeEach(() => {
  clearToasts();
  resetContentCache();
  primeRunContent();
  location.hash = '#/pam';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearToasts();
  resetContentCache();
});

describe('PAM tab', () => {
  it('offers New case as the one primary key, over No runs yet with no start key of its own', () => {
    renderIn(makeStore(), <PamTab />);
    expect(screen.getByRole('heading', { level: 1, name: 'PAM' })).toBeTruthy();
    const key = screen.getByRole('link', { name: 'New case' });
    expect(key.getAttribute('href')).toBe('#/pam/start');
    expect(key.classList.contains('primary')).toBe(true);
    expect(primaries()).toEqual([key]);
    expect(screen.getByRole('heading', { level: 2, name: 'Run history' })).toBeTruthy();
    expect(screen.getByText(NO_RUNS)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start your first run' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Run history' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Last run' })).toBeNull();
  });

  it('with a run open, shows it with Resume as the one primary key and New case secondary', () => {
    renderIn(makeStore({ runOpen: blankSession('copd-amk-01') }), <PamTab />);
    expect(screen.getByText(/^Run in progress: Breathlessness, step 1/)).toBeTruthy();
    const resume = screen.getByRole('link', { name: 'Resume' });
    expect(resume.getAttribute('href')).toBe('#/run');
    expect(primaries()).toEqual([resume]);
    expect(screen.getByRole('link', { name: 'New case' }).classList.contains('btn2')).toBe(true);
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
  });
});

// ---- Plan 3 Task 6: the run history ------------------------------------------------------------------------------

const copd = caseById('copd-amk-01');
const env = envOf('copd-amk-01');
/** The debrief's sample COPD run: Coached, 17:42, three active faults (pocket check, head grip, MOI). */
const R = debriefRecord();
const DRILL_IDS = { id: 'drill-1', startedAt: '2026-11-13T15:00:00.000Z' };

/** A drill on step 4 from the sample run, its range (3 to 5) played through. */
function drillRecord(): RunRecord {
  const s = startDrill(env, 'scene-evaluation', [], R.id, DRILL_IDS, T0);
  return endRun(env, hitAll(s, STEPS, copd, ['preparation', 'scene-evaluation', 'approach-patient']), T0);
}

/** `r` as the `i`-th run, started i minutes after 9:00 on 1 Nov: a later i is a newer run. */
const nth = (r: RunRecord, i: number): RunRecord =>
  ({ ...r, id: `run-${i}`, startedAt: new Date(Date.UTC(2026, 10, 1, 9, i)).toISOString() });

const historyList = () => screen.getByRole('list', { name: 'Run history' });
const rowLinks = () => within(historyList()).queryAllByRole('link');

describe('Run history', () => {
  it('lists a run as one link to its debrief: its case and mode, when and its time, the verdict, and its strip', () => {
    renderIn(makeStore({ runs: [R] }), <PamTab />);
    expect(screen.getByRole('heading', { level: 2, name: 'Run history' })).toBeTruthy();
    const links = rowLinks();
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.getAttribute('href')).toBe(`#/debrief/${R.id}`);
    expect(link.textContent).toContain('Breathlessness, Ang Mo Kio. Coached.');
    expect(link.textContent).toContain('17:42 of 20:00');
    expect(link.textContent).toContain('3 to fix');
    // its name is its text, built once as its aria-label (Task 12 review M1: no hidden stop for Chromium to space out),
    // said once: the strip inside is hidden, and nothing else in it is interactive
    const meta = historyMeta(R, STEPS, new Date());
    const name = `Breathlessness, Ang Mo Kio. Coached. ${meta}. 3 to fix`;
    expect(link.getAttribute('aria-label')).toBe(name);
    expect(historyRowName(R, caseById('copd-amk-01'), STEPS, new Date())).toBe(name);
    expect(screen.getByRole('link', { name })).toBe(link);
    expect(link.querySelector('.vh')).toBeNull();
    const strip = link.querySelector('svg.strip-mini');
    expect(strip?.getAttribute('aria-hidden')).toBe('true');
    expect(link.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
    expect(screen.getByText(FOOT)).toBeTruthy();
    expect(screen.queryByText(NO_RUNS)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open debrief' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show 10 more' })).toBeNull();
    expect(primaries()).toEqual([screen.getByRole('link', { name: 'New case' })]);
  });

  it('lists a drill, with untimed for its time and no strip, even with no full run on record', () => {
    const d = drillRecord();
    renderIn(makeStore({ runs: [d] }), <PamTab />);
    const [link] = rowLinks();
    expect(link?.getAttribute('href')).toBe(`#/debrief/${d.id}`);
    expect(link?.textContent).toContain('Breathlessness, Ang Mo Kio. Drill on steps');
    expect(link?.textContent).toContain('untimed');
    // a drill on step 4 covers steps 3 to 5, every point hit: nothing to fix
    expect(link?.getAttribute('aria-label')).toBe(
      `Breathlessness, Ang Mo Kio. Drill on steps 3 to 5. ${historyMeta(d, STEPS, new Date())}. Nothing to fix this run.`);
    expect(link?.querySelector('svg')).toBeNull();
    expect(screen.queryByText(NO_RUNS)).toBeNull();
  });

  it('names a case a later build dropped "A removed case.", and lists a record saved before Plan 2 with its defaults', () => {
    const plan1 = { id: 'old-1', caseId: 'c01', mode: 'coached', drill: false, startedAt: '2026-11-10T09:00:00.000Z',
      usedMs: 1_000_000, stepTimes: {}, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [] };
    const old = normalizeProgress({ runs: [plan1] })!.runs[0]!;   // started 10 Nov, after the sample run's 1 Nov
    const gone = { ...nth(R, 5), caseId: 'gone-case-01' };
    renderIn(makeStore({ runs: [gone, old] }), <PamTab />);
    const [first, second] = rowLinks();
    expect(first?.getAttribute('href')).toBe('#/debrief/old-1');
    expect(first?.textContent).toContain('A removed case. Coached.');
    expect(first?.textContent).toContain('16:40 of 20:00');
    expect(first?.textContent).toContain('Nothing to fix this run.');
    // its strip, from the Plan 1 fields alone: no step times, so a flat trace to the end at 16:40, and no fault dot
    const old1 = first?.querySelector('svg.strip-mini');
    expect(old1?.getAttribute('aria-hidden')).toBe('true');
    expect(old1?.querySelector('path.sv-trace')?.getAttribute('d')).toBe('M4 52L249.7 52');
    expect(old1?.querySelector('line.sv-end')?.getAttribute('x1')).toBe('249.7');
    expect(old1?.querySelector('circle')).toBeNull();
    expect(second?.getAttribute('href')).toBe(`#/debrief/${gone.id}`);
    expect(second?.textContent).toContain('A removed case. Coached.');
    expect(second?.textContent).toContain('3 to fix');
    expect(second?.querySelector('svg.strip-mini')).not.toBeNull();
  });

  it('shows 10, then Show 10 more shows the rest, moves focus to the first new row, and goes', async () => {
    const early = await recordOf('copd-amk-01', 'exam', []);   // a scripted run, ended before its clock started
    const runs = [nth(early, 0), ...Array.from({ length: 11 }, (_, i) => nth(R, i + 1))];
    renderIn(makeStore({ runs }), <PamTab />);
    expect(HISTORY_PAGE).toBe(10);
    expect(rowLinks().map((a) => a.getAttribute('href'))).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((i) => `#/debrief/run-${i}`));
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));
    const links = rowLinks();
    expect(links).toHaveLength(12);
    expect(document.activeElement).toBe(links[10]);
    expect(links[11]?.getAttribute('href')).toBe('#/debrief/run-0');
    expect(links[11]?.textContent).toContain('Breathlessness, Ang Mo Kio. Exam.');
    expect(links[11]?.textContent).toContain('— of 20:00');
    expect(screen.queryByRole('button', { name: 'Show 10 more' })).toBeNull();
  });

  it('keeps Show 10 more while more remain', () => {
    renderIn(makeStore({ runs: Array.from({ length: 23 }, (_, i) => nth(R, i)) }), <PamTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));
    expect(rowLinks()).toHaveLength(20);
    expect(document.activeElement).toBe(rowLinks()[10]);
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));
    expect(rowLinks()).toHaveLength(23);
    expect(document.activeElement).toBe(rowLinks()[20]);
    expect(screen.queryByRole('button', { name: 'Show 10 more' })).toBeNull();
  });

  it('lists no more than 50 runs, so a save over the cap pages to 50 and the key goes', () => {
    renderIn(makeStore({ runs: Array.from({ length: 51 }, (_, i) => nth(R, i)) }), <PamTab />);
    for (let page = 1; page < 5; page++) fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));
    const links = rowLinks();
    expect(links).toHaveLength(50);
    expect(links.some((a) => a.getAttribute('href') === '#/debrief/run-0')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Show 10 more' })).toBeNull();
  });

  it('shows a skeleton while a slow load runs, then the rows', () => {
    vi.useFakeTimers();
    resetContentCache();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));   // the steps and cases never arrive by fetch
    renderIn(makeStore({ runs: [R] }), <PamTab />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Run history' })).toBeNull();
    act(() => primeRunContent());
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(rowLinks()).toHaveLength(1);
  });

  describe('when the cases fail to load', () => {
    const offline = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });
    beforeEach(() => {
      resetContentCache();
      primeContent('steps', { contentVersion: 'test', steps: STEPS });
    });
    const panel = async () => (await screen.findByRole('heading', { level: 2, name: 'Run history' })).closest('section')!;

    it('with no run open, says so in place of the rows, with Try again as a secondary key that loads them again', async () => {
      const fetch = offline();
      vi.stubGlobal('fetch', fetch);
      renderIn(makeStore({ runs: [R] }), <PamTab />);
      const p = await panel();
      expect(await within(p).findByText(CASES_ERROR)).toBeTruthy();
      expect(within(p).queryAllByRole('link')).toHaveLength(0);
      const again = within(p).getByRole('button', { name: 'Try again' });
      expect(again.classList.contains('btn2')).toBe(true);
      expect(primaries()).toEqual([screen.getByRole('link', { name: 'New case' })]);
      const calls = fetch.mock.calls.length;
      fireEvent.click(again);
      expect(fetch.mock.calls.length).toBeGreaterThan(calls);
    });

    it('with a run open, shows only its heading: the run row says why, with its own Try again', async () => {
      vi.stubGlobal('fetch', offline());
      renderIn(makeStore({ runs: [R], runOpen: blankSession('copd-amk-01') }), <PamTab />);
      const p = await panel();
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(within(p).queryByText(CASES_ERROR)).toBeNull();
      expect(within(p).queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(within(p).queryAllByRole('link')).toHaveLength(0);
      expect(p.textContent).toBe('Run history');
    });
  });
});

describe('historyRows', () => {
  it('returns every record, drills too, newest started first, whatever order they were saved in', () => {
    const d = { ...drillRecord(), startedAt: new Date(Date.UTC(2026, 10, 1, 9, 30)).toISOString() };
    const runs = [nth(R, 2), d, nth(R, 9), nth(R, 0)];
    expect(historyRows(runs).map((r) => r.id)).toEqual(['drill-1', 'run-9', 'run-2', 'run-0']);
    expect(runs.map((r) => r.id)).toEqual(['run-2', 'drill-1', 'run-9', 'run-0']);   // the input is left alone
  });

  it('puts the later saved of two started at once first', () => {
    const a = { ...nth(R, 1), id: 'a' };
    const b = { ...nth(R, 1), id: 'b' };
    expect(historyRows([a, b]).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('keeps at most RUN_LIMITS.runsKept (50), dropping the oldest', () => {
    expect(RUN_LIMITS.runsKept).toBe(50);
    const rows = historyRows(Array.from({ length: 51 }, (_, i) => nth(R, i)));
    expect(rows).toHaveLength(50);
    expect(rows[0]?.id).toBe('run-50');
    expect(rows[49]?.id).toBe('run-1');
    expect(rows.some((r) => r.id === 'run-0')).toBe(false);
  });
});

describe('historyMeta', () => {
  const now = new Date(2026, 10, 13, 23, 0);
  it("is when the run started, then its time against the 20:00 limit: '— of 20:00' for a clock never started", async () => {
    const at = formatRunAt(R.startedAt, now);
    expect(historyMeta(R, STEPS, now)).toBe(`${at} · 17:42 of 20:00`);
    const early = await recordOf('copd-amk-01', 'coached', []);
    expect(historyMeta(early, STEPS, now)).toBe(`${formatRunAt(early.startedAt, now)} · — of 20:00`);
  });

  it("is untimed for a drill", () => {
    const d = drillRecord();
    expect(historyMeta(d, STEPS, now)).toBe(`${formatRunAt(d.startedAt, now)} · untimed`);
  });
});

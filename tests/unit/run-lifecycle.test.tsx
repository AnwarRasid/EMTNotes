// Task 15: the run's lifecycle and its ending (#/run): the Pause sheet (Pause and system back open it; Resume, Restart
// case and End run), the clock paused while the app is hidden, the wake lock, the guard history entry, the 1 s tick
// that writes the buddies' reassessments, the step list (tap mode) in the composer's place, and a drill ending itself.
import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { MemoryStorage } from './helpers';
import { CASES, IDS, STEPS, caseById, envOf, hitAll } from './sim-helpers';
import { primeContent, resetContentCache } from '../../src/data/load';
import { App } from '../../src/app/App';
import { navigate } from '../../src/app/routes';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import { RUN_LIMITS, type ChatLine, type Progress, type RunRecord, type RunSession } from '../../src/progress/types';
import { READ_HOLD_MS } from '../../src/quiz/useQuiz';
import { applicablePoints } from '../../src/sim/classify';
import { startDrill } from '../../src/sim/drill';
import { startRun } from '../../src/sim/run';
import { RESTART_COPY } from '../../src/run/PauseSheet';
import { LINE_LIMIT_NOTE } from '../../src/run/Run';
import { STEP_FAILED } from '../../src/run/StepSheet';
import { beginDrill, beginRun } from '../../src/run/start';
import { RUN_GUARD_KEY, wakeLock } from '../../src/run/useRunLifecycle';
import { clearToasts } from '../../src/ui/toast';

const env = envOf('copd-amk-01');
const copd = caseById('copd-amk-01');
const upTo = (order: number) => STEPS.filter((s) => s.order <= order).map((s) => s.id);
const T = Date.UTC(2026, 10, 14, 9, 0, 0);

const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });

/** The app at #/run with `session` open, over `storage`. */
function renderRun(session: RunSession, patch: Partial<Progress> = {}, storage = new MemoryStorage()) {
  const store = createProgressStore(storage);
  store.update((p) => ({ ...p, runOpen: session, ...patch }));
  const view = render(<App store={store} />);
  return { store, view, storage };
}

/** A new run of the COPD case, started now. */
const fresh = (mode: RunSession['mode'] = 'coached'): RunSession => startRun(env, mode, IDS, Date.now());
/** A run whose clock has `ms` banked and runs from now. */
const running = (ms = 60_000, s: RunSession = fresh()): RunSession =>
  ({ ...s, clock: { started: true, bankedMs: ms, runningSince: Date.now() } });
/** A drill on step 12 (Rapid body survey): steps 11 to 13, the ten before filled in. */
const drill = (chain: string[] = [], source: string | null = null): RunSession =>
  startDrill(env, 'rapid-body-survey', chain, source, IDS, Date.now());

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
/** Lets the promises in flight settle (the wake lock's request, the send queue). */
const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
const runOf = (store: ProgressStore): RunSession => store.get().runOpen!;
const clockOf = (store: ProgressStore) => runOf(store).clock;
const dialog = () => screen.getByRole('dialog', { name: 'Paused' });
const noDialog = () => screen.queryByRole('dialog', { name: 'Paused' });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const field = () => screen.queryByRole('textbox', { name: 'Speak to the scene' }) as HTMLInputElement | null;
const pause = () => fireEvent.click(button('Pause'));
/** Past the confirm keys' tap hold (S5). */
const afterHold = () => tick(READ_HOLD_MS + 50);

/** Types `text` in the composer and submits it, as Enter would. */
function say(text: string): void {
  const el = field()!;
  fireEvent.input(el, { target: { value: text } });
  act(() => { el.form!.requestSubmit(); });
}

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(v: DocumentVisibilityState): void {
  visibility = v;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

/** navigator.wakeLock, as Chrome has it: a request that resolves to a sentinel with release(). */
function mockWakeLock() {
  const release = vi.fn();
  const request = vi.fn().mockResolvedValue({ release });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  return { request, release };
}

beforeEach(() => {
  history.replaceState(null, '', '#/run');
  clearToasts();
  vi.useFakeTimers();
  vi.setSystemTime(T);
  resetContentCache();
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
  vi.stubGlobal('fetch', offlineFetch());
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetContentCache();
  clearToasts();
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(navigator, 'wakeLock');
});

// ---- The Pause sheet --------------------------------------------------------------------------------------------

describe('Pause', () => {
  it('opens the dialog "Paused": the clock stops, with Mode: Coached, End run, Restart case and Resume, Resume last', () => {
    const { store } = renderRun(running());
    tick(2000);
    pause();
    const d = dialog();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('Paused');
    expect(within(d).getByText('The clock is stopped.')).toBeTruthy();
    expect(clockOf(store)).toEqual({ started: true, bankedMs: 62_000, runningSince: null });
    expect(within(d).getByText('Mode: Coached')).toBeTruthy();
    expect(within(d).getByText('Set when the run starts.')).toBeTruthy();
    const keys = within(d).getAllByRole('button').map((b) => b.textContent);
    expect(keys).toEqual(['End run', 'Restart case', 'Resume']);
    expect(within(d).getByRole('button', { name: 'Resume' }).className).toBe('primary');
  });

  it('rows top to bottom: End run, Mode, Restart case, Resume (S6)', () => {
    renderRun(running());
    pause();
    const d = dialog();
    const order = [within(d).getByRole('button', { name: 'End run' }), within(d).getByText('Mode: Coached'),
      within(d).getByRole('button', { name: 'Restart case' }), within(d).getByRole('button', { name: 'Resume' })];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('Resume closes it and the clock runs again', () => {
    const { store } = renderRun(running());
    pause();
    tick(5000);
    fireEvent.click(button('Resume'));
    expect(noDialog()).toBeNull();
    expect(clockOf(store)).toEqual({ started: true, bankedMs: 60_000, runningSince: T + 5000 });
    expect(document.activeElement).toBe(button('Pause'));
  });

  it("Resume, back in Keep going's place, ignores a press within READ_HOLD_MS (S5)", () => {
    const { store } = renderRun(running());
    pause();
    fireEvent.click(button('End run'));
    fireEvent.click(button('Keep going'));
    fireEvent.click(button('Resume'));   // the second tap of a double tap on Keep going
    expect(dialog()).toBeTruthy();
    expect(clockOf(store).runningSince).toBeNull();
    afterHold();
    fireEvent.click(button('Resume'));
    expect(noDialog()).toBeNull();
    expect(clockOf(store).runningSince).not.toBeNull();
  });

  it('opening drops the keyboard: focus leaves the composer for Resume, and the run behind is inert', () => {
    renderRun(running());
    field()!.focus();
    expect(document.activeElement).toBe(field());
    pause();
    expect(document.activeElement).toBe(button('Resume'));
    expect(document.querySelector('.run')!.hasAttribute('inert')).toBe(true);
    fireEvent.click(button('Resume'));
    expect(document.querySelector('.run')!.hasAttribute('inert')).toBe(false);
  });

  it('Escape resumes', () => {
    const { store } = renderRun(running());
    pause();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(noDialog()).toBeNull();
    expect(clockOf(store).runningSince).toBe(T);
  });

  it('Exam says "Mode: Exam"', () => {
    renderRun(running(60_000, fresh('exam')));
    pause();
    expect(within(dialog()).getByText('Mode: Exam')).toBeTruthy();
  });

  it('in a drill the sheet offers End drill, and its confirm ends the drill', () => {
    renderRun(drill());
    pause();
    expect(within(dialog()).getByText('Mode: Coached')).toBeTruthy();
    expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual(['End drill', 'Restart case', 'Resume']);
    fireEvent.click(button('End drill'));
    expect(within(dialog()).getByText('End drill? Steps 11 to 13 count as missed.')).toBeTruthy();
    expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual(['End drill', 'Keep going']);
  });
});

// ---- System back ------------------------------------------------------------------------------------------------

describe('System back', () => {
  it('dispatching popstate opens the dialog, and the clock pauses', () => {
    const { store } = renderRun(running());
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
    expect(dialog()).toBeTruthy();
    expect(clockOf(store).runningSince).toBeNull();
  });
});

// Real session history: Android's back is history.back(), which jsdom traverses on a later task (setImmediate). These
// tests keep real timers so that task runs, and fake only performance, for the confirm keys' hold.
describe('System back, through real history', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['performance'] });
  });

  /** Android's back: history.back(), awaited until its popstate has been handled (the run's listener came first). */
  async function systemBack(): Promise<void> {
    await act(async () => {
      const popped = new Promise<void>((resolve) => { window.addEventListener('popstate', () => resolve(), { once: true }); });
      history.back();
      await popped;
    });
  }
  /** Whether this entry is a run's guard, as the run reads it. */
  const guarded = () => (history.state as Record<string, unknown> | null)?.[RUN_GUARD_KEY] === history.length;
  /** Back, then End run from the sheet it opens, past the hold: the debrief replaces the run. */
  async function backThenEnd(): Promise<void> {
    await systemBack();
    fireEvent.click(button('End run'));
    afterHold();
    fireEvent.click(button('End run'));
    expect(location.hash).toBe(`#/debrief/${IDS.id}?fresh=1`);
  }

  it('the run pushes one guard on #/run; Back opens the sheet and the guard comes back; Back again does nothing', async () => {
    const length = history.length;
    const { store } = renderRun(running());
    expect(history.length).toBe(length + 1);
    expect(guarded()).toBe(true);
    await systemBack();
    expect(location.hash).toBe('#/run');
    expect(dialog()).toBeTruthy();
    expect(clockOf(store).runningSince).toBeNull();
    expect(history.length).toBe(length + 1);   // the guard back where the popped one was
    expect(guarded()).toBe(true);
    fireEvent.click(button('End run'));
    const before = runOf(store);
    await systemBack();
    expect(location.hash).toBe('#/run');
    expect(within(dialog()).getByText(/^End run at/)).toBeTruthy();
    expect(runOf(store)).toBe(before);
    expect(history.length).toBe(length + 1);
    expect(guarded()).toBe(true);
  });

  it.each([
    ['Run start, pushed from the debrief', () => { navigate('/pam/start'); }],
    ['the PAM tab by replace, then Run start', () => { navigate('/pam', { replace: true }); navigate('/pam/start'); }],
  ])('after a Back and End in one run, a run started through %s gets its own guard', async (_, leave) => {
    const { store } = renderRun(running());
    await backThenEnd();
    expect(guarded()).toBe(false);   // the debrief took the guard's entry without its mark
    act(() => { leave(); });
    const length = history.length;
    act(() => { beginRun(store, env, 'coached'); });   // Take the call
    expect(runOf(store).id).not.toBe(IDS.id);
    expect(location.hash).toBe('#/run');
    expect(history.length).toBe(length + 1);
    expect(guarded()).toBe(true);
    await systemBack();
    expect(location.hash).toBe('#/run');
    expect(dialog()).toBeTruthy();
  });

  it('a drill opened from the debrief by replace gets its own guard', async () => {
    const { store } = renderRun(running());
    await backThenEnd();
    const length = history.length;
    act(() => { beginDrill(store, env, 'rapid-body-survey', [], IDS.id); });
    expect(runOf(store).drill).not.toBeNull();
    expect(location.hash).toBe('#/run');
    expect(history.length).toBe(length + 1);
    expect(guarded()).toBe(true);
    await systemBack();
    expect(location.hash).toBe('#/run');
    expect(dialog()).toBeTruthy();
  });

  it('Restart after a Back keeps the one guard, and Back still opens the sheet', async () => {
    const { store } = renderRun(running());
    await systemBack();
    const length = history.length;
    fireEvent.click(button('Restart case'));
    afterHold();
    fireEvent.click(button('Restart'));
    expect(runOf(store).id).not.toBe(IDS.id);
    expect(noDialog()).toBeNull();
    expect(history.length).toBe(length);
    expect(guarded()).toBe(true);
    await systemBack();
    expect(location.hash).toBe('#/run');
    expect(dialog()).toBeTruthy();
  });

  it('a reload on #/run after a Back pushes no second guard', async () => {
    const { store, view } = renderRun(running());
    await systemBack();
    fireEvent.click(button('Resume'));
    const length = history.length;
    view.unmount();
    render(<App store={store} />);   // the page again, on the same history entry
    expect(history.length).toBe(length);
    expect(guarded()).toBe(true);
    await systemBack();
    expect(location.hash).toBe('#/run');
    expect(dialog()).toBeTruthy();
  });
});

// ---- Background, recovery and the wake lock --------------------------------------------------------------------

describe('Background', () => {
  it('visibilitychange to hidden pauses the clock, and the pause is saved', () => {
    const { storage } = renderRun(running());
    tick(3000);
    setVisibility('hidden');
    expect(createProgressStore(storage).get().runOpen!.clock).toEqual({ started: true, bankedMs: 63_000, runningSince: null });
  });

  it('pagehide pauses too', () => {
    const { store } = renderRun(running());
    tick(1000);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(clockOf(store)).toEqual({ started: true, bankedMs: 61_000, runningSince: null });
  });

  it('visible resumes, from the time it comes back', () => {
    const { store } = renderRun(running());
    setVisibility('hidden');
    tick(30_000);
    setVisibility('visible');
    expect(clockOf(store)).toEqual({ started: true, bankedMs: 60_000, runningSince: T + 30_000 });
  });

  it('with the sheet open, visible keeps the clock paused', () => {
    const { store } = renderRun(running());
    pause();
    setVisibility('hidden');
    tick(5000);
    setVisibility('visible');
    expect(clockOf(store).runningSince).toBeNull();
    expect(dialog()).toBeTruthy();
  });

  it('hidden and pagehide together save one pause', () => {
    const { storage } = renderRun(running());
    const writes = vi.spyOn(storage, 'setItem');
    setVisibility('hidden');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('a run the page left running (it died without a pause) counts up to its last save, then runs from now', () => {
    // running from 2 min ago, last saved 30 s after that: the 90 s since never count
    const s: RunSession = { ...fresh(), clock: { started: true, bankedMs: 60_000, runningSince: T - 120_000 }, lastAt: T - 90_000 };
    const { store } = renderRun(s);
    expect(clockOf(store)).toEqual({ started: true, bankedMs: 90_000, runningSince: T });
  });

  it('unmounting pauses the run', () => {
    const { store, view } = renderRun(running());
    tick(4000);
    view.unmount();
    expect(clockOf(store)).toEqual({ started: true, bankedMs: 64_000, runningSince: null });
  });
});

describe('Wake lock', () => {
  it('is requested with "screen" on mount, released on unmount, and requested again on visible', async () => {
    const { request, release } = mockWakeLock();
    const { view } = renderRun(running());
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    setVisibility('hidden');
    expect(release).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('a lock granted after the run has gone is released at once', async () => {
    const { request, release } = mockWakeLock();
    let grant!: (s: { release(): void }) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { grant = resolve; }));
    const { view } = renderRun(running());
    view.unmount();
    await act(async () => { grant({ release }); await Promise.resolve(); await Promise.resolve(); });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('with no navigator.wakeLock, mounting throws nothing', async () => {
    expect('wakeLock' in navigator).toBe(false);
    renderRun(running());
    await settle();
    expect(button('Pause')).toBeTruthy();
  });

  it('wakeLock() is null with no API and when the request is refused', async () => {
    expect(await wakeLock({} as Navigator)).toBeNull();
    const refused = { wakeLock: { request: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } };
    expect(await wakeLock(refused as unknown as Navigator)).toBeNull();
    const release = vi.fn(() => Promise.reject(new Error('already released')));
    const granted = await wakeLock({ wakeLock: { request: vi.fn().mockResolvedValue({ release }) } } as unknown as Navigator);
    expect(() => granted!.release()).not.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

// ---- End and Restart --------------------------------------------------------------------------------------------

describe('End', () => {
  /** COPD with steps 1 to 14 done and 9:40 used. */
  const doneTo14 = (): RunSession => ({ ...hitAll(fresh(), STEPS, copd, upTo(14)),
    clock: { started: true, bankedMs: 580_000, runningSince: Date.now() } });

  it('asks "End run at 09:40? Steps 15 to 19 count as missed."; confirming records the run and opens its debrief', () => {
    const { store } = renderRun(doneTo14());
    pause();
    fireEvent.click(button('End run'));
    const d = dialog();
    expect(within(d).getByText('End run at 09:40? Steps 15 to 19 count as missed.')).toBeTruthy();
    expect(within(d).getAllByRole('button').map((b) => b.textContent)).toEqual(['End run', 'Keep going']);
    expect(within(d).getByRole('button', { name: 'End run' }).className).toBe('primary');
    expect(within(d).getByRole('button', { name: 'Keep going' }).className).toBe('btn2');
    afterHold();
    fireEvent.click(button('End run'));
    const { runs, runOpen } = store.get();
    expect(runs).toHaveLength(1);
    const missed = runs[0]!.faults.filter((f) => f.kind === 'missed');
    const left = applicablePoints(STEPS, copd, [15, 19]).map((a) => a.key);
    expect(missed.map((f) => f.point).sort()).toEqual([...left].sort());
    expect([...new Set(missed.map((f) => f.step))]).toEqual([15, 16, 17, 18, 19]);
    expect(runs[0]!.usedMs).toBe(580_000);
    expect(runOpen).toBeNull();
    expect(location.hash).toBe(`#/debrief/${IDS.id}?fresh=1`);
  });

  it('the confirming End run ignores a press within READ_HOLD_MS of appearing (S5)', () => {
    const { store } = renderRun(doneTo14());
    pause();
    fireEvent.click(button('End run'));
    fireEvent.click(button('End run'));   // the second tap of a double tap
    expect(store.get().runs).toHaveLength(0);
    expect(runOf(store).id).toBe(IDS.id);
    tick(READ_HOLD_MS - 50);
    fireEvent.click(button('End run'));
    expect(store.get().runs).toHaveLength(0);
    tick(100);
    fireEvent.click(button('End run'));
    expect(store.get().runs).toHaveLength(1);
  });

  it('Keep going goes back to the sheet, with focus on End run', () => {
    renderRun(doneTo14());
    pause();
    fireEvent.click(button('End run'));
    expect(document.activeElement).toBe(button('Keep going'));
    fireEvent.click(button('Keep going'));
    expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual(['End run', 'Restart case', 'Resume']);
    expect(document.activeElement).toBe(button('End run'));
  });
});

describe('Restart', () => {
  it('asks first; confirming opens a new run of the same case and mode, with one line, and keeps runs as they were', () => {
    const before = [finished('run-0')];
    const length = history.length;
    const { store } = renderRun({ ...hitAll(running(), STEPS, copd, upTo(6)), mode: 'exam' }, { runs: before });
    pause();
    fireEvent.click(button('Restart case'));
    expect(within(dialog()).getByText(RESTART_COPY)).toBeTruthy();
    expect(RESTART_COPY).toBe("Restart this case? This run won't be kept.");
    expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Restart', 'Keep going']);
    afterHold();
    fireEvent.click(button('Restart'));
    const s = runOf(store);
    expect(s.id).not.toBe(IDS.id);
    expect(s.lines).toHaveLength(1);
    expect(s.caseId).toBe('copd-amk-01');
    expect(s.mode).toBe('exam');
    expect(s.clock.started).toBe(false);
    expect(store.get().runs).toBe(before);
    expect(noDialog()).toBeNull();
    expect(location.hash).toBe('#/run');
    expect(history.length).toBe(length + 1);   // the new run keeps the one guard entry
  });

  it('Restart ignores a press within READ_HOLD_MS of appearing (S5)', () => {
    const { store } = renderRun(running());
    pause();
    fireEvent.click(button('Restart case'));
    fireEvent.click(button('Restart'));
    expect(runOf(store).id).toBe(IDS.id);
    afterHold();
    fireEvent.click(button('Restart'));
    expect(runOf(store).id).not.toBe(IDS.id);
  });

  it('in a drill: a fresh drill on the same target, chain and source run', () => {
    const { store } = renderRun(hitAll(drill(['investigation'], 'run-0'), STEPS, copd, ['circulation']));
    pause();
    fireEvent.click(button('Restart case'));
    afterHold();
    fireEvent.click(button('Restart'));
    const s = runOf(store);
    expect(s.id).not.toBe(IDS.id);
    expect(s.drill).toEqual({ target: 'rapid-body-survey', from: 11, to: 13, chain: ['investigation'], sourceRunId: 'run-0' });
    expect(s.hits['circulation/pulse']).toBeUndefined();
    expect(s.lines).toHaveLength(2);
  });
});

/** A finished run's record, for a store that already has one. */
const finished = (id: string): RunRecord => ({
  id, caseId: 'copd-amk-01', mode: 'coached', drill: false, startedAt: '2026-11-13T14:00:00.000Z', usedMs: 0,
  stepTimes: {}, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [], wrong: [], faults: [],
  rbsMs: null, standbyMs: null, readings: [], oxygen: null, record: null, drillRange: null, drillChain: [], stepsTotal: 19,
  reached: [], sourceRunId: null, smartLines: 0,
});

// ---- The step list ----------------------------------------------------------------------------------------------

describe('Step list', () => {
  const region = () => screen.getByRole('region', { name: 'Step list' });
  const row = (name: string) => within(region()).getByRole('button', { name }) as HTMLButtonElement;
  const tapped = (store: ProgressStore) => runOf(store).lines.filter((l) => l.tapped === true);

  it('the Step list key shows the region "Step list" in place of the composer, with a row per step', () => {
    renderRun(fresh());
    fireEvent.click(button('Step list'));
    expect(region().tagName).toBe('SECTION');
    expect(region().className).toBe('stepsheet');
    expect(field()).toBeNull();
    const rows = within(region()).getByRole('list').querySelectorAll('li > button');
    expect(Array.from(rows, (b) => b.textContent)).toEqual(STEPS.map((s) => `${s.order} ${s.name}`));
    expect(within(region()).getByRole('button', { name: 'Back to typing' }).className).toBe('btn2');
  });

  it('clicking "6 Introduction" adds a tapped line, and its row disables with "Done"', async () => {
    const { store } = renderRun(fresh());
    fireEvent.click(button('Step list'));
    fireEvent.click(row('6 Introduction'));
    expect(row('6 Introduction').disabled).toBe(true);
    await settle();
    expect(tapped(store)).toHaveLength(1);
    expect(tapped(store)[0]!.route).toBe('Tapped: step 6, Introduction');
    expect(row('6 Introduction').disabled).toBe(true);
    expect(within(row('6 Introduction').closest('li')!).getByText('Done')).toBeTruthy();
    expect(region()).toBeTruthy();   // the sheet stays open
  });

  it('two clicks in a row add one tapped line', async () => {
    const { store } = renderRun(fresh());
    fireEvent.click(button('Step list'));
    fireEvent.click(row('6 Introduction'));
    fireEvent.click(row('6 Introduction'));
    await settle();
    expect(tapped(store)).toHaveLength(1);
  });

  it('"Back to typing" brings the composer back, with focus in its field and what was typed there', () => {
    renderRun(fresh());
    fireEvent.input(field()!, { target: { value: 'Arm buddy, SpO2' } });
    fireEvent.click(button('Step list'));
    expect(document.activeElement).toBe(row('1 Respond call'));   // the first step still to play
    fireEvent.click(button('Back to typing'));
    expect(screen.queryByRole('region', { name: 'Step list' })).toBeNull();
    expect(field()).toBeTruthy();
    expect(document.activeElement).toBe(field());
    expect(field()!.value).toBe('Arm buddy, SpO2');
  });

  it("a tap that doesn't go through re-enables its row and says so", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // a number that isn't finite in the run: the engine's dev check throws on the tap
    const { store } = renderRun({ ...fresh(), reassessSets: Number.NaN });
    fireEvent.click(button('Step list'));
    fireEvent.click(row('6 Introduction'));
    expect(row('6 Introduction').disabled).toBe(true);
    await settle();
    expect(error).toHaveBeenCalled();
    expect(tapped(store)).toHaveLength(0);
    expect(row('6 Introduction').disabled).toBe(false);
    tick(10_000);   // the save of a run holding NaN is refused too: that toast goes first
    expect(screen.getByText(STEP_FAILED)).toBeTruthy();
    expect(STEP_FAILED).toBe("That step didn't go through. Tap it again.");
  });

  it('in a drill only its range plays: the steps filled in are Done, the ones after are not in it', () => {
    renderRun(drill());
    fireEvent.click(button('Step list'));
    const states = Array.from(within(region()).getByRole('list').querySelectorAll('li'), (li) =>
      [li.querySelector('button')!.disabled, li.querySelector('.ss-state')?.textContent ?? '']);
    expect(states).toEqual([...Array(10).fill([true, '✓Done']), [false, ''], [false, ''], [false, ''],
      ...Array(6).fill([true, 'Not in this drill'])]);
  });

  it('opens with the first step still to play at the top of the list, focused', () => {
    // jsdom has no layout: the list's top is at 400, and each key sits 50px below the one before
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const i = Array.from(document.querySelectorAll('.ss-key')).indexOf(this);
      const top = this.classList.contains('ss-list') ? 400 : i >= 0 ? 400 + i * 50 : 0;
      return { top, bottom: top + 48, left: 0, right: 0, width: 0, height: 48, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    renderRun(hitAll(fresh(), STEPS, copd, upTo(6)));
    fireEvent.click(button('Step list'));
    expect(document.activeElement).toBe(row('7 LOC (AVPU)'));
    expect(region().querySelector<HTMLElement>('.ss-list')!.scrollTop).toBe(300);   // rows 1 to 6, done, above it
  });

  /** A run of `n` typed lines after the activation. */
  const withLines = (n: number): RunSession =>
    ({ ...fresh(), lines: Array.from({ length: n }, (_, i): ChatLine => ({ who: 'you', text: `Line ${i}`, atMs: null })) });

  it('at the line limit the Step list key is off, as the field is, and the note says why', () => {
    renderRun(withLines(RUN_LIMITS.transcriptLines));
    expect(button('Step list').disabled).toBe(true);
    expect(button('Step list').getAttribute('aria-describedby')).toBe(screen.getByText(LINE_LIMIT_NOTE).id);
  });

  it('a tap that takes the run to its line limit gives the list back to the composer and its note', async () => {
    const { store } = renderRun(withLines(RUN_LIMITS.transcriptLines - 1));
    fireEvent.click(button('Step list'));
    fireEvent.click(row('1 Respond call'));
    await settle();
    expect(runOf(store).lines.length).toBeGreaterThanOrEqual(RUN_LIMITS.transcriptLines);
    expect(screen.queryByRole('region', { name: 'Step list' })).toBeNull();
    expect(screen.getByText(LINE_LIMIT_NOTE)).toBeTruthy();
    expect(button('Step list').disabled).toBe(true);
    expect(document.activeElement).toBe(button('Pause'));
  });

  it('Exam has no step list', () => {
    renderRun(fresh('exam'));
    expect(screen.queryByRole('button', { name: 'Step list' })).toBeNull();
  });
});

// ---- A drill ends itself ----------------------------------------------------------------------------------------

describe('A drill', () => {
  it('with every range point done but one, sending that one records the drill and opens its debrief: "Drill done."', async () => {
    const all = hitAll(drill(), STEPS, copd, ['circulation', 'rapid-body-survey', 'investigation']);
    const { 'investigation/hypocount': _, ...hits } = all.hits;
    const { store } = renderRun({ ...all, hits });
    expect(store.get().runs).toHaveLength(0);
    say('Checking the hypocount.');
    await settle();
    const { runs, runOpen } = store.get();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.drill).toBe(true);
    expect(runs[0]!.drillRange).toEqual([11, 13]);
    expect(runOpen).toBeNull();
    expect(location.hash).toBe(`#/debrief/${IDS.id}?fresh=1`);
    expect(screen.getByText('Drill done.')).toBeTruthy();
  });
});

// ---- The 1 s tick -----------------------------------------------------------------------------------------------

describe('The tick', () => {
  it('with reassessFromMs 0 and 299 s elapsed, advancing 1 s adds the two buddy lines', () => {
    const { store } = renderRun({ ...running(299_000), reassessFromMs: 0 });
    expect(runOf(store).lines).toHaveLength(1);
    tick(1000);
    const lines = runOf(store).lines;
    expect(lines).toHaveLength(3);
    expect(lines.slice(1).map((l) => [l.who, l.atMs])).toEqual([['headBuddy', 300_000], ['armBuddy', 300_000]]);
    expect(runOf(store).reassessSets).toBe(1);
  });

  it('saves nothing while there is nothing to add, and stops while paused', () => {
    const { store, storage } = renderRun({ ...running(100_000), reassessFromMs: 0 });
    const writes = vi.spyOn(storage, 'setItem');
    tick(3000);
    expect(writes).not.toHaveBeenCalled();
    pause();
    writes.mockClear();
    tick(300_000);
    expect(writes).not.toHaveBeenCalled();
    expect(runOf(store).lines).toHaveLength(1);
  });
});

// Task 13: the run screen's frame (#/run): the header with Pause, the run clock and its time-limit line, the mode row,
// the step bar and the vitals rail; and what Run shows with no run, while the content loads and when it fails.
import { cleanup, render, renderHook, screen, fireEvent, act, within } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { MemoryStorage } from './helpers';
import { CASES, IDS, STEPS, caseById, envOf, hitAll } from './sim-helpers';
import { contentErrorCopy, primeContent, resetContentCache } from '../../src/data/load';
import { App } from '../../src/app/App';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import type { ChatLine, Progress, RunClock, RunSession } from '../../src/progress/types';
import { READ_HOLD_MS } from '../../src/quiz/useQuiz';
import { startDrill } from '../../src/sim/drill';
import { rbsInTime } from '../../src/sim/clock';
import { keywordGrader, type Grader } from '../../src/sim/grader';
import { fillCanonical } from '../../src/sim/replies';
import { sendLine, startRun, type StepState } from '../../src/sim/run';
import { smartGrader, type SmartRequest } from '../../src/sim/smart';
import { finishRun } from '../../src/run/useRunLifecycle';
import { draftKeyOf } from '../../src/run/Composer';
import { RunHeader } from '../../src/run/RunHeader';
import { stepBarLabel } from '../../src/run/StepBar';
import { latestReadings } from '../../src/run/VitalsRail';
import { useNow } from '../../src/run/useNow';
import { SMART_FAILED, useOpenRun } from '../../src/run/useRun';
import { graderFor } from '../../src/smart/claude';
import { SMART_STORAGE_KEY } from '../../src/smart/settings';
import { replaceOpenRun } from '../../src/today/discard';
import { clearToasts } from '../../src/ui/toast';

// The run's grader comes from graderFor (Plan 3 Task 9): the real one unless a test gives the run a slow or failing one
// of its own. No test here sends a line through the real smart grader, so none reaches the SDK or the network (D20).
vi.mock('../../src/smart/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/smart/claude')>();
  return { ...actual, graderFor: vi.fn(actual.graderFor) };
});
const realGraderFor = (await vi.importActual<typeof import('../../src/smart/claude')>('../../src/smart/claude')).graderFor;

const env = envOf('copd-amk-01');
const copd = caseById('copd-amk-01');
const upTo = (order: number) => STEPS.filter((s) => s.order <= order).map((s) => s.id);
const T = Date.UTC(2026, 10, 14, 9, 0, 0);

const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });
const pendingFetch = () => vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

/** The app at #/run with `session` open (none by default). */
function renderRun(session: RunSession | null = null): ProgressStore {
  const store = makeStore({ runOpen: session });
  render(<App store={store} />);
  return store;
}

/** A new run of the COPD case, started now. */
const fresh = (mode: RunSession['mode'] = 'coached'): RunSession => startRun(env, mode, IDS, Date.now());
/** A run whose clock has `ms` banked and runs from now (or `since`), with RBS done at `rbsMs`. */
const running = (ms: number, rbsMs: number | null = null, since = Date.now()): RunSession =>
  ({ ...fresh(), clock: { started: true, bankedMs: ms, runningSince: since }, rbsMs });

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const timer = () => screen.getByRole('timer', { name: 'Run clock' });
const digits = () => timer().querySelector('b')!;
const limitLine = () => timer().querySelector('.rbs')!;
/** The run's one polite live region, where the clock's limits and the engine's announcements go. */
const live = () => document.querySelector<HTMLElement>('.run p.vh[aria-live="polite"]')!;
const vitals = () => screen.getByRole('group', { name: 'Vitals' });
/** What an element shows on screen: its text, less the visually hidden (.vh) text a screen reader hears instead. */
function shown(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('.vh').forEach((x) => x.remove());
  return copy.textContent ?? '';
}
/** The vitals tiles' names as shown, in order ("SpO2" is set as SpO<sub>2</sub>). */
const tileNames = () => Array.from(vitals().querySelectorAll('.vl > :first-child'), shown);
/** The vitals tile whose name shows `label`. */
function tile(label: string): HTMLElement {
  const found = Array.from(vitals().querySelectorAll<HTMLElement>('.vt')).find((t) => shown(t.querySelector('.vl > :first-child')!) === label);
  if (found === undefined) throw new Error(`No vitals tile "${label}" in [${tileNames().join(', ')}].`);
  return found;
}
const hasTile = (label: string) => tileNames().includes(label);
const stepBar = () => screen.getByRole('list', { name: /^Steps: / });

/** Matches the element whose whole text is `text`, not its ancestors: for text split by an inline element. */
const wholeText = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

beforeEach(() => {
  location.hash = '#/run';
  clearToasts();
  vi.useFakeTimers();
  vi.setSystemTime(T);
  resetContentCache();
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
  vi.stubGlobal('fetch', offlineFetch());
  vi.mocked(graderFor).mockReset().mockImplementation(realGraderFor);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetContentCache();
});

// ---- The header and the clock -----------------------------------------------------------------------------------

describe('Run: the header and the clock', () => {
  it('before Approach shows --:-- and "Starts at Approach", with the complaint over the location', () => {
    renderRun(fresh());
    expect(digits().textContent).toBe('--:--');
    expect(limitLine().textContent).toBe('Starts at Approach');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Breathlessness');
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('lang')).toBe('en');   // English hyphenation for larger text
    expect(screen.getByText('Blk 2xx Ang Mo Kio Ave 3, #07-xx').tagName).toBe('P');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('running: after 1 s the clock reads 06:13, and with no RBS by then "RBS limit passed" in the warning tone', () => {
    renderRun(running(372_000));
    expect(digits().textContent).toBe('06:12');
    tick(1000);
    expect(digits().textContent).toBe('06:13');
    expect(limitLine().textContent).toBe('RBS limit passed');
    expect(limitLine().className).toBe('rbs warn');
    expect(digits().classList.contains('warn')).toBe(false);
  });

  it("ticks on the run clock's whole second: opened 10 ms short of one, the digits advance then and once a second after", () => {
    renderRun(running(372_000, null, Date.now() - 990));   // 6:12.990
    expect(digits().textContent).toBe('06:12');
    tick(9);
    expect(digits().textContent).toBe('06:12');
    tick(1);
    expect(digits().textContent).toBe('06:13');
    for (const [after, shows] of [[999, '06:13'], [1, '06:14'], [999, '06:14'], [1, '06:15'], [3000, '06:18']] as const) {
      tick(after);
      expect(digits().textContent).toBe(shows);
    }
  });

  it('a limit is said on the second the clock reaches it', () => {
    renderRun(running(179_500));
    tick(499);
    expect(live().textContent).toBe('');
    tick(1);
    expect(digits().textContent).toBe('03:00');
    expect(live().textContent).toBe('RBS limit passed.');
  });

  it('running with RBS done at 2:41: "RBS 2:41 ✓" in the done tone', () => {
    renderRun(running(372_000, 161_000));
    tick(1000);
    expect(digits().textContent).toBe('06:13');
    expect(limitLine().textContent).toBe('RBS 2:41 ✓');
    expect(limitLine().className).toBe('rbs done');
  });

  it('a crossing: from 179 500, the tick past 3:00 puts "RBS limit passed." in the live region', () => {
    renderRun(running(179_500));
    expect(limitLine().textContent).toBe('RBS by 3:00');
    expect(limitLine().className).toBe('rbs plain');
    expect(live().textContent).toBe('');
    tick(1000);
    expect(live().textContent).toBe('RBS limit passed.');
  });

  it('a reload past a limit announces nothing: only limits crossed while the screen is up are said', () => {
    renderRun(running(400_000));
    tick(3000);
    expect(live().textContent).toBe('');
  });

  it('warning digits from 18:00', () => {
    renderRun(running(1_080_000));
    expect(digits().textContent).toBe('18:00');
    expect(digits().className).toBe('warn');
    expect(limitLine().textContent).toBe('2 min left');
  });

  it('past 20:00: +0:42 and "Past 20:00"', () => {
    renderRun(running(1_242_000));
    expect(digits().textContent).toBe('+0:42');
    expect(digits().className).toBe('warn');
    expect(limitLine().textContent).toBe('Past 20:00');
  });

  it('Pause pauses the clock and saves it', () => {
    const store = renderRun(running(60_000));
    tick(2000);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(store.get().runOpen!.clock).toEqual({ started: true, bankedMs: 62_000, runningSince: null });
    tick(5000);
    expect(digits().textContent).toBe('01:02');
  });
});

describe('RunHeader', () => {
  const header = (clock: RunClock, announce: string | null = null) =>
    <RunHeader title="Breathlessness" sub="Blk 2xx" clock={clock} rbsMs={null} drill={false} announce={announce} onPause={() => {}} />;

  it("puts the engine's announcement in the same live region", () => {
    const view = render(<div class="run">{header({ started: false, bankedMs: 0, runningSince: null })}</div>);
    expect(live().textContent).toBe('');
    view.rerender(<div class="run">{header({ started: false, bankedMs: 0, runningSince: null }, 'RBS done at 2:41.')}</div>);
    expect(live().textContent).toBe('RBS done at 2:41.');
  });

  it('never repeats a limit when the phone clock is set back', () => {
    const clock = { started: true, bankedMs: 179_500, runningSince: Date.now() };
    const view = render(<div class="run">{header(clock)}</div>);
    tick(1000);
    expect(live().textContent).toBe('RBS limit passed.');
    view.rerender(<div class="run">{header(clock, 'Something else.')}</div>);
    expect(live().textContent).toBe('Something else.');
    vi.setSystemTime(Date.now() - 6000);   // the clock reads 3:00 less 0.5 s again
    tick(1000);
    tick(1000);
    tick(5000);   // and back past 3:00
    expect(digits().textContent).toBe('03:01');
    expect(live().textContent).toBe('Something else.');
  });
});

describe('useNow', () => {
  it("ticks on its anchor's whole intervals, takes the time at once when it turns on, and stops when off or unmounted", () => {
    const anchor = Date.now() - 372_990;   // a clock at 6:12.990
    const hook = renderHook(({ active }: { active: boolean }) => useNow(1000, active, anchor), { initialProps: { active: true } });
    expect(hook.result.current).toBe(T);
    tick(9);
    expect(hook.result.current).toBe(T);
    tick(1);
    expect(hook.result.current).toBe(T + 10);
    tick(999);
    expect(hook.result.current).toBe(T + 10);
    tick(1);
    expect(hook.result.current).toBe(T + 1010);
    hook.rerender({ active: false });
    expect(vi.getTimerCount()).toBe(0);
    tick(5000);
    expect(hook.result.current).toBe(T + 1010);
    hook.rerender({ active: true });
    expect(hook.result.current).toBe(T + 6010);
    expect(vi.getTimerCount()).toBe(1);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---- The mode row and the step bar ------------------------------------------------------------------------------

describe('Run: the mode row and the step bar', () => {
  it('Coached: the chip, "Step 1 of 19", a 19-step bar and four tiles not yet reported', () => {
    renderRun(fresh());
    expect(screen.getByText('Coached')).toBeTruthy();
    expect(screen.getByText(wholeText('Step 1 of 19'))).toBeTruthy();
    expect(stepBar().getAttribute('aria-label')).toBe('Steps: step 1 current, 18 to go');
    const items = within(stepBar()).getAllByRole('listitem');
    expect(items).toHaveLength(19);
    expect(items.map((li) => li.className)).toEqual(['s-now', ...Array(18).fill('')]);
    expect(within(vitals()).getAllByText('not yet reported')).toHaveLength(4);
    expect(['SpO2', 'PR', 'RR', 'BP'].map((l) => tile(l).classList.contains('vt-empty'))).toEqual([true, true, true, true]);
  });

  it('Exam: the chip only, with no step bar, no step count and no vitals tiles', () => {
    renderRun(fresh('exam'));
    expect(screen.getByText('Exam')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /^Steps: / })).toBeNull();
    expect(screen.queryByText(/of 19/)).toBeNull();
    expect(screen.queryAllByText('not yet reported')).toHaveLength(0);
    expect(document.querySelectorAll('.vt')).toHaveLength(0);
  });

  it('a flagged step: "Step 10 of 19, step 6 flagged", and the bar says so', () => {
    let s = hitAll(fresh(), STEPS, copd, upTo(9));
    const at = s.hits['introduction/head-grip']!.line;
    s = { ...s, lines: s.lines.map((l, i) => (i === at ? { ...l, flags: [{ kind: 'order' as const, point: 'introduction/head-grip', text: 'x' }] } : l)) };
    renderRun(s);
    expect(screen.getByText(wholeText('Step 10 of 19, step 6 flagged'))).toBeTruthy();
    expect(stepBar().getAttribute('aria-label')).toBe('Steps: 1 to 5 and 7 to 9 done, step 6 flagged, step 10 current, 9 to go');
    const flagged = within(stepBar()).getAllByRole('listitem')[5]!;
    expect(flagged.className).toBe('s-flagged');
    expect(flagged.textContent).toBe('!6 Introduction: flagged');
  });

  it('a missed call step shows on the bar as soon as the run is past it', () => {
    renderRun({ ...hitAll(fresh(), STEPS, copd, ['respond-call']), current: 3 });
    expect(stepBar().getAttribute('aria-label')).toBe('Steps: 1 done, step 2 missed, step 3 current, 16 to go');
    expect(within(stepBar()).getAllByRole('listitem')[1]!.className).toBe('s-missed');
  });

  it('a drill: the Drill chip, an untimed clock, and the step within its range', () => {
    renderRun(startDrill(env, 'rapid-body-survey', [], null, IDS, Date.now()));
    expect(screen.getByText('Drill', { selector: '.runmode' })).toBeTruthy();
    expect(digits().textContent).toBe('Drill');
    expect(limitLine().textContent).toBe('Untimed');
    expect(screen.getByText(wholeText('Step 11 of 19'))).toBeTruthy();
    expect(stepBar().getAttribute('aria-label')).toBe('Steps: 1 to 10 done, step 11 current, 2 to go');
    // the steps outside its range (11 to 13) are dimmed, the filled-in ones still done
    const items = within(stepBar()).getAllByRole('listitem');
    expect(items.map((li) => li.className)).toEqual([...Array(10).fill('s-done s-out'), 's-now', '', '', ...Array(6).fill('s-out')]);
    expect(items[13]!.textContent).toBe('14 Vital signs: not in this drill');
    expect(items[0]!.textContent).toBe('1 Respond call: done');
  });
});

// ---- The vitals rail --------------------------------------------------------------------------------------------

describe('Run: the vitals rail', () => {
  it('a reading arrives: the SpO2 tile shows "– –", then 86 on RA 220 ms later', async () => {
    const before: RunSession = { ...fresh(), current: 10 };
    const store = renderRun(before);
    const after = (await sendLine(env, before, 'Arm buddy, SpO2 please.', Date.now())).session;
    expect(after.readings).toEqual([{ key: 'spo2', value: '86', atMs: 0, o2: 'RA' }]);
    act(() => store.update((p) => ({ ...p, runOpen: after })));
    expect(shown(tile('SpO2'))).toBe('SpO2– –');
    expect(tile('SpO2').classList.contains('vt-empty')).toBe(false);
    tick(219);
    expect(within(tile('SpO2')).queryByText('86')).toBeNull();
    tick(1);
    expect(within(tile('SpO2')).getByText('86')).toBeTruthy();
    expect(within(tile('SpO2')).getByText('RA')).toBeTruthy();
    expect(shown(tile('SpO2'))).toBe('SpO2RA86%');
  });

  it('a reading already there when the screen opens shows at once (ruling P33)', async () => {
    const after = (await sendLine(env, { ...fresh(), current: 10 }, 'Arm buddy, SpO2 please.', Date.now())).session;
    renderRun(after);
    expect(shown(tile('SpO2'))).toBe('SpO2RA86%');
  });

  it('an extra tile: after the hypocount reply, a Hypo tile shows 6.8', async () => {
    const before = hitAll(fresh(), STEPS, copd, upTo(12));
    const store = renderRun(before);
    expect(hasTile('Hypo')).toBe(false);
    const after = (await sendLine(env, before, 'Checking the hypocount.', Date.now())).session;
    expect(after.readings.map((r) => [r.key, r.value])).toEqual([['hypocount', '6.8']]);
    act(() => store.update((p) => ({ ...p, runOpen: after })));
    tick(220);
    expect(within(tile('Hypo')).getByText('6.8')).toBeTruthy();
    expect(shown(tile('Hypo'))).toBe('Hypommol/L6.8');   // the unit at the right of the name, as SpO2's device
  });

  it('Exam: a tile shows only once reported', async () => {
    const before: RunSession = { ...fresh('exam'), current: 10 };
    const after = (await sendLine(env, before, 'Arm buddy, SpO2 please.', Date.now())).session;
    renderRun(after);
    expect(tileNames()).toEqual(['SpO2']);
  });

  it('SpO2 is set as SpO₂, and a screen reader hears "SpO2"', () => {
    renderRun(fresh());
    const name = tile('SpO2').querySelector('.vl > :first-child')!;
    expect(name.querySelector('[aria-hidden="true"]')!.innerHTML).toBe('SpO<sub>2</sub>');
    expect(name.querySelector('.vh')!.textContent).toBe('SpO2');
  });

  it('latestReadings keeps the newest reading of each key', () => {
    const r = (key: 'spo2' | 'bp', value: string, atMs: number) => ({ key, value, atMs, o2: key === 'spo2' ? 'RA' : null });
    expect(latestReadings([r('spo2', '86', 0), r('bp', '146/86', 10), r('spo2', '90', 20)]))
      .toEqual({ spo2: r('spo2', '90', 20), bp: r('bp', '146/86', 10) });
    expect(latestReadings([])).toEqual({});
  });
});

// ---- stepBarLabel -----------------------------------------------------------------------------------------------

describe('stepBarLabel', () => {
  const of = (states: StepState[]) => states.map((state, i) => ({ order: i + 1, state }));

  it('names the done runs, the flagged steps, the current step and how many are left', () => {
    const states = of([...Array<StepState>(5).fill('done'), 'flagged', 'done', 'done', 'done', 'now', ...Array<StepState>(9).fill('todo')]);
    expect(stepBarLabel(states)).toBe('Steps: 1 to 5 and 7 to 9 done, step 6 flagged, step 10 current, 9 to go');
  });

  it('a new run', () => {
    expect(stepBarLabel(of(['now', ...Array<StepState>(18).fill('todo')]))).toBe('Steps: step 1 current, 18 to go');
  });

  it('missed steps, two flagged, and none left to go', () => {
    const states = of(['done', 'missed', 'done', 'flagged', 'missed', 'flagged', 'now']);
    expect(stepBarLabel(states)).toBe('Steps: 1 and 3 done, steps 4 and 6 flagged, steps 2 and 5 missed, step 7 current');
  });

  it("a drill counts only its range's steps as to go", () => {
    const states = of([...Array<StepState>(10).fill('done'), 'now', ...Array<StepState>(8).fill('todo')]);
    expect(stepBarLabel(states, [11, 13])).toBe('Steps: 1 to 10 done, step 11 current, 2 to go');
    expect(stepBarLabel(states, null)).toBe('Steps: 1 to 10 done, step 11 current, 8 to go');
  });
});

// ---- No run, loading and errors ---------------------------------------------------------------------------------

describe('Run: no run, loading and errors', () => {
  it('with no run open goes to Today, replacing #/run', () => {
    renderRun(null);
    expect(location.hash).toBe('#/');
    expect(document.querySelector('.run')).toBeNull();
  });

  it('shows nothing for 300 ms while the content loads, then the skeleton', () => {
    resetContentCache();
    vi.stubGlobal('fetch', pendingFetch());
    renderRun(fresh());
    expect(screen.queryByRole('progressbar')).toBeNull();
    tick(300);
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
    expect(location.hash).toBe('#/run');
  });

  it('on a content error shows its copy with Try again, and keeps the run', async () => {
    vi.useRealTimers();
    resetContentCache();
    const f = offlineFetch();
    vi.stubGlobal('fetch', f);
    const session = fresh();
    const store = renderRun(session);
    expect(await screen.findByText(contentErrorCopy('steps'))).toBeTruthy();
    expect(store.get().runOpen).toEqual(session);
    expect(location.hash).toBe('#/run');
    const calls = f.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });
});

// ---- Plan 3 Task 7: Restart is confirmed already, so it offers no Undo (M1, ruling D26) --------------------------

describe('Run: Restart', () => {
  it('Pause, Restart case, then Restart opens a new run with no "Run replaced." toast and no Undo', () => {
    const store = renderRun(fresh());
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart case' }));
    tick(READ_HOLD_MS + 50);   // past the confirm key's tap hold (S5)
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(store.get().runOpen?.id).not.toBe(IDS.id);
    tick(200);
    expect(screen.queryByText('Run replaced.')).toBeNull();
    expect(screen.queryByText('Drill replaced.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('in a drill too: no "Drill replaced." toast', () => {
    const store = renderRun(startDrill(env, 'rapid-body-survey', [], null, IDS, Date.now()));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart case' }));
    tick(READ_HOLD_MS + 50);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(store.get().runOpen?.drill?.target).toBe('rapid-body-survey');
    expect(store.get().runOpen?.id).not.toBe(IDS.id);
    tick(200);
    expect(screen.queryByText('Drill replaced.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

// ---- Plan 3 Task 9: the smart tester in the run (D14, D15) --------------------------------------------------------

const STEP1 = 'FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3 for case of elderly female, breathlessness.';
const field = () => screen.getByRole('textbox', { name: 'Speak to the scene' }) as HTMLInputElement;
const statusLine = () => document.querySelector<HTMLElement>('.composer [role="status"]')!;
const pendingLines = () => [...document.querySelectorAll<HTMLElement>('.msg.pending')];
const log = () => screen.getByRole('log', { name: 'Run chat' });
const said = (store: ProgressStore, text: string) => store.get().runOpen?.lines.some((l) => l.who === 'you' && l.text === text) ?? false;
/** Types `text` in the composer and sends it, as Enter does. */
function say(text: string): void {
  fireEvent.input(field(), { target: { value: text } });
  act(() => { field().form!.requestSubmit(); });
}
/** Lets the send queue's promises run (no timer moves). */
const flush = () => act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
/** Moves the clock `ms` on, running the timers and the promises they settle. */
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** A grader that reads a line as the keyword grader does, `ms` later: the network grader's stand-in. */
const slowGrader = (ms: number): Grader => ({
  id: 'slow',
  async interpret(line, ctx) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return keywordGrader.interpret(line, ctx);
  },
});

describe('Run: a line still being read (D14)', () => {
  it('shows after the log from 300 ms, outside it, as a pending bubble with "Checking…", and the status says so', async () => {
    vi.mocked(graderFor).mockImplementation(() => slowGrader(1000));
    const store = renderRun(fresh());
    say(STEP1);
    await flush();
    expect(field().value).toBe('');
    tick(299);
    expect(pendingLines()).toHaveLength(0);
    expect(statusLine().textContent).toBe('');
    tick(1);
    const [pending] = pendingLines();
    expect(pendingLines()).toHaveLength(1);
    expect(pending!.className).toBe('msg me pending');
    expect(pending!.getAttribute('aria-hidden')).toBe('true');
    expect(log().contains(pending!)).toBe(false);
    expect(pending!.querySelector('.bub')!.textContent).toBe(STEP1);
    expect(pending!.querySelector('.route')!.textContent).toBe('Checking…');
    expect(statusLine().textContent).toBe('Checking your line.');
    expect(said(store, STEP1)).toBe(false);
    await wait(700);
    await flush();
    expect(said(store, STEP1)).toBe(true);
    expect(pendingLines()).toHaveLength(0);
    expect(statusLine().textContent).toBe('');
    expect(within(log()).getByText(STEP1)).toBeTruthy();
  });

  it('a line read at once never shows as pending', async () => {
    const store = renderRun(fresh());
    say(STEP1);
    await flush();
    tick(400);
    expect(said(store, STEP1)).toBe(true);
    expect(pendingLines()).toHaveLength(0);
    expect(statusLine().textContent).toBe('');
  });

  it('lines sent behind a slow one wait in order, each shown pending until it is read', async () => {
    vi.mocked(graderFor).mockImplementation(() => slowGrader(1000));
    const store = renderRun(fresh());
    say(STEP1);
    say('Hi, I am calling from 995 FMV. Can I confirm your address?');
    await flush();
    tick(300);
    expect(pendingLines().map((p) => p.querySelector('.bub')!.textContent))
      .toEqual([STEP1, 'Hi, I am calling from 995 FMV. Can I confirm your address?']);
    await wait(700);
    await flush();
    expect(said(store, STEP1)).toBe(true);
    expect(pendingLines()).toHaveLength(1);
    await wait(1000);
    await flush();
    expect(pendingLines()).toHaveLength(0);
  });
});

// Final review M3: End with a check still out never drops the line. It is graded by the keyword rules, with every line
// queued behind it, before the run ends; the check that never answers is left to time out on its own.
describe('Run: End with a check in flight', () => {
  /** Pause, End run, past the confirm key's tap hold, then End run again. */
  const endRun = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'End run' }));
    tick(READ_HOLD_MS + 50);
    fireEvent.click(screen.getByRole('button', { name: 'End run' }));
  };
  const LINE = `${STEP1} Any ouch at your nape?`;   // its second sentence reads nothing by the keyword rules, so it is sent
  const NEXT = 'Hi, I am calling from 995 FMV. Can I confirm your address?';

  it('grades the line by the keyword rules before the run ends, so it is in the record, never dropped', async () => {
    const transport = vi.fn((_req: SmartRequest) => new Promise<never>(() => {}));   // a check that never answers
    vi.mocked(graderFor).mockImplementation(() => smartGrader({ transport, online: () => true }));
    const store = renderRun(fresh());
    say(LINE);
    say(NEXT);
    await flush();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0].sentences.map((s) => s.text)).toEqual(['Any ouch at your nape?']);
    expect(said(store, LINE)).toBe(false);
    endRun();
    await flush();
    expect(store.get().runOpen).toBeNull();
    const record = store.get().runs.at(-1)!;
    expect(location.hash).toBe(`#/debrief/${encodeURIComponent(record.id)}?fresh=1`);
    expect(record.transcript.filter((l) => l.who === 'You').map((l) => l.text)).toEqual([LINE, NEXT]);
    expect(record.missed.filter((k) => k.startsWith('respond-call/'))).toEqual([]);   // step 1, as the keyword rules read it
    expect(record.missed).not.toContain('call-caller/intro-fmv-emt');                 // and the line behind it
    await wait(10_000);   // the check times out after the run: nothing more is written
    await flush();
    expect(store.get().runs.at(-1)).toBe(record);
    expect(store.get().runOpen).toBeNull();
  });

  it('with nothing in flight, End ends the run at once, as before', () => {
    const store = renderRun(fresh());
    endRun();
    expect(store.get().runOpen).toBeNull();
    expect(location.hash).toBe(`#/debrief/${encodeURIComponent(store.get().runs.at(-1)!.id)}?fresh=1`);
  });
});

describe('Run: the smart tag (D15)', () => {
  it('a line the smart tester credited shows "Smart tester" before its route, heard as "Checked by the smart tester."', () => {
    const s = fresh();
    const lines: ChatLine[] = [...s.lines,
      { who: 'you', text: 'Any ouch at your nape?', atMs: null, route: 'To the patient: neck pain', smart: true },
      { who: 'you', text: 'Any wheeze?', atMs: null, route: 'To the patient: breathing' }];
    renderRun({ ...s, lines });
    const smart = within(log()).getByText('Any ouch at your nape?').closest('.msg')!;
    const tag = smart.querySelector<HTMLElement>('.route .stag')!;
    expect(shown(tag)).toBe('Smart tester');
    expect(tag.querySelector('.vh')!.textContent).toBe('Checked by the smart tester.');
    expect(shown(smart.querySelector('.route')!)).toBe('Smart tester To the patient: neck pain');
    expect(smart.querySelector('.route')!.firstElementChild).toBe(tag);
    const plain = within(log()).getByText('Any wheeze?').closest('.msg')!;
    expect(plain.querySelector('.stag')).toBeNull();
  });
});

describe("Run: the smart tester's failure toast (D14)", () => {
  it('a grader failing on two lines of one run toasts once', async () => {
    let failed = 0;
    vi.mocked(graderFor).mockImplementation((_s, _onSpend, onFailure): Grader => ({
      id: 'failing',
      async interpret(line, ctx) {
        failed += 1;
        onFailure();
        return keywordGrader.interpret(line, ctx);
      },
    }));
    const store = renderRun(fresh());
    say(STEP1);
    await flush();
    expect(screen.getByText(SMART_FAILED)).toBeTruthy();
    expect(SMART_FAILED).toBe("The smart tester didn't answer, so the keyword rules graded that line.");
    tick(11_000);   // the toast has had its time and gone
    expect(screen.queryByText(SMART_FAILED)).toBeNull();
    say('Hi, I am calling from 995 FMV. Can I confirm your address?');
    await flush();
    tick(300);
    expect(failed).toBe(2);
    expect(said(store, 'Hi, I am calling from 995 FMV. Can I confirm your address?')).toBe(true);
    expect(screen.queryByText(SMART_FAILED)).toBeNull();
  });
});

describe("useOpenRun: the run's grader (D13, D16)", () => {
  const wrapper = (store: ProgressStore) => ({ children }: { children?: ComponentChildren }) =>
    <ProgressContext.Provider value={store}>{children}</ProgressContext.Provider>;
  const graderId = (store: ProgressStore): string | null => {
    const hook = renderHook(() => useOpenRun(), { wrapper: wrapper(store) });
    const state = hook.result.current;
    hook.unmount();
    return state.status === 'open' ? state.env.grader.id : null;
  };

  it("is 'smart' when crewleader.smart holds { on: true, key }, and 'keywords' otherwise", () => {
    const store = makeStore({ runOpen: fresh() });
    expect(graderId(store)).toBe('keywords');
    localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ on: true, key: 'sk-ant-x' }));
    expect(graderId(store)).toBe('smart');
    localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ on: false, key: 'sk-ant-x' }));
    expect(graderId(store)).toBe('keywords');
    localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ on: true }));
    expect(graderId(store)).toBe('keywords');
    expect(JSON.stringify(store.get())).not.toContain('sk-ant-x');
  });

  it('a new run gets a fresh grader; the same run keeps its own', () => {
    localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ on: true, key: 'sk-ant-x' }));
    const store = makeStore({ runOpen: fresh() });
    const hook = renderHook(() => useOpenRun(), { wrapper: wrapper(store) });
    const first = hook.result.current.status === 'open' ? hook.result.current.env.grader : null;
    act(() => store.update((p) => ({ ...p, runOpen: { ...p.runOpen!, lastAt: p.runOpen!.lastAt + 1 } })));
    expect(hook.result.current.status === 'open' && hook.result.current.env.grader).toBe(first);
    act(() => store.update((p) => ({ ...p, runOpen: startRun(env, 'coached', { id: 'run-2', startedAt: IDS.startedAt }, Date.now()) })));
    const second = hook.result.current.status === 'open' ? hook.result.current.env.grader : null;
    expect(second?.id).toBe('smart');
    expect(second).not.toBe(first);
    hook.unmount();
  });
});

// ---- Task 7 review M1 and M2, carried to Task 9: a line in flight with a slow grader --------------------------------

describe('Run: sending lapses "Run replaced." at once (Task 7 review M1)', () => {
  it("Send takes the replace's Undo away before the slow line is read, and the line lands in the new run", async () => {
    vi.mocked(graderFor).mockImplementation(() => slowGrader(1000));
    const store = renderRun({ ...fresh(), id: 'run-old' });
    act(() => replaceOpenRun(store, fresh()));
    expect(screen.getByText('Run replaced.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    say(STEP1);
    await flush();
    tick(200);   // the toast's fade out
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByText('Run replaced.')).toBeNull();
    expect(said(store, STEP1)).toBe(false);   // still being read
    await wait(1000);
    await flush();
    expect(store.get().runOpen?.id).toBe(IDS.id);
    expect(said(store, STEP1)).toBe(true);
  });

  it('a step tapped from the list lapses it too', () => {
    const store = renderRun({ ...fresh(), id: 'run-old' });
    act(() => replaceOpenRun(store, fresh()));
    fireEvent.click(screen.getByRole('button', { name: 'Step list' }));
    fireEvent.click(screen.getByRole('button', { name: /^1 Respond call/ }));
    tick(200);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

// ---- Task 9 review round 1 ------------------------------------------------------------------------------------------

describe('Run: an input is timed when it is sent (Task 9 review M1)', () => {
  const rbs = STEPS.find((st) => st.id === 'rapid-body-survey')!;
  const RBS_LINE = fillCanonical(rbs.canonicalLine, copd, 6, rbs.mustHit);

  it('the RBS sent at 2:57 behind a 6 s check records 2:57, with no RBS-time fault, and the clock never waits', async () => {
    const asked: SmartRequest[] = [];
    // the real smart grader with a transport that never answers, so each check runs out its 6 s (D14)
    vi.mocked(graderFor).mockImplementation((): Grader => smartGrader({
      transport: (req) => { asked.push(req); return new Promise(() => {}); }, online: () => true }));
    const at = { ...hitAll(fresh(), STEPS, copd, upTo(11)), clock: { started: true, bankedMs: 176_000, runningSince: Date.now() } };
    const store = renderRun(at);
    say('Okay, thank you.');   // reads nothing by keywords, so it waits on a check
    await flush();
    expect(asked).toHaveLength(1);
    tick(1000);
    expect(digits().textContent).toBe('02:57');
    say(RBS_LINE);   // sent at 2:57, behind the check
    await flush();
    tick(4000);
    expect(digits().textContent).toBe('03:01');   // the clock runs on while the line waits
    expect(said(store, RBS_LINE)).toBe(false);
    await wait(20_000);   // every check runs out
    await flush();
    const s = store.get().runOpen!;
    const first = s.lines.findIndex((l) => l.who === 'you' && l.text === 'Okay, thank you.');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(s.lines.findIndex((l) => l.who === 'you' && l.text === RBS_LINE)).toBeGreaterThan(first);   // in the order sent
    expect(s.rbsMs).toBe(177_000);
    expect(rbsInTime(s.rbsMs)).toBe(true);
    expect(limitLine().textContent).toBe('RBS 2:57 ✓');
    expect(s.lastAt).toBeGreaterThanOrEqual(T + 1000);
  });

  it('an input whose run changed after it was sent is timed no earlier than that change', async () => {
    vi.mocked(graderFor).mockImplementation(() => slowGrader(1000));
    const at = { ...hitAll(fresh(), STEPS, copd, upTo(11)), clock: { started: true, bankedMs: 176_000, runningSince: Date.now() } };
    const store = renderRun(at);
    say(RBS_LINE);   // sent at 2:56
    await flush();
    tick(500);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));   // the run changes under the line: paused at 2:56.5
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await wait(2000);
    await flush();
    expect(store.get().runOpen!.rbsMs).toBe(176_500);   // the pause's time, never the earlier send
    expect(store.get().runOpen!.lastAt).toBe(T + 500);   // the run's last change never goes back
  });
});

describe("Run: the smart tester's failure toast is the run's own (Task 9 review M7)", () => {
  it('once a run has ended, a later run toasts its own failure', async () => {
    vi.mocked(graderFor).mockImplementation((_s, _onSpend, onFailure): Grader => ({
      id: 'failing',
      async interpret(line, ctx) {
        onFailure();
        return keywordGrader.interpret(line, ctx);
      },
    }));
    const store = renderRun(fresh());
    say(STEP1);
    await flush();
    expect(screen.getByText(SMART_FAILED)).toBeTruthy();
    tick(11_000);
    act(() => finishRun(store, env, Date.now()));
    expect(store.get().runOpen).toBeNull();
    act(() => {
      store.update((p) => ({ ...p, runOpen: fresh() }));   // the next run (the tests reuse the run id)
      location.hash = '#/run';
    });
    tick(100);
    say(STEP1);
    await flush();
    expect(screen.getByText(SMART_FAILED)).toBeTruthy();
  });
});

describe('Run: the draft is kept until the line is saved (Task 7 review M2)', () => {
  it('a sent line stays in the draft while it is read, so a killed tab gives it back; once saved, the draft goes', async () => {
    vi.mocked(graderFor).mockImplementation(() => slowGrader(1000));
    const storage = new MemoryStorage();
    const store = createProgressStore(storage);
    store.update((p) => ({ ...p, runOpen: fresh() }));
    render(<App store={store} />);
    say(STEP1);
    await flush();
    expect(field().value).toBe('');
    expect(sessionStorage.getItem(draftKeyOf(IDS.id))).toBe(STEP1);
    cleanup();   // the tab is killed mid-grade: the line never reached the save
    render(<App store={createProgressStore(storage)} />);
    expect(field().value).toBe(STEP1);
    cleanup();
    sessionStorage.clear();
    const again = renderRun(fresh());
    say(STEP1);
    await wait(1000);
    await flush();
    expect(said(again, STEP1)).toBe(true);
    expect(sessionStorage.getItem(draftKeyOf(IDS.id))).toBeNull();
  });

  it('what is typed while a line is read is the draft, and stays once that line is saved', async () => {
    vi.mocked(graderFor).mockImplementation(() => slowGrader(1000));
    const store = renderRun(fresh());
    say(STEP1);
    await flush();
    fireEvent.input(field(), { target: { value: 'Ops Ctr, say again' } });
    await wait(1000);
    await flush();
    expect(said(store, STEP1)).toBe(true);
    expect(sessionStorage.getItem(draftKeyOf(IDS.id))).toBe('Ops Ctr, say again');
    expect(field().value).toBe('Ops Ctr, say again');
  });

  it('the step list opened and closed while a line is read never puts that line back in the field', async () => {
    vi.mocked(graderFor).mockImplementation(() => slowGrader(1000));
    const store = renderRun(fresh());
    say(STEP1);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Step list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to typing' }));
    expect(field().value).toBe('');
    await wait(1000);
    await flush();
    expect(said(store, STEP1)).toBe(true);
    expect(sessionStorage.getItem(draftKeyOf(IDS.id))).toBeNull();
  });
});

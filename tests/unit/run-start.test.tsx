// Task 12: Run start (#/pam/start, and ?drill={stepId} for a drill), choosing a case, starting a run or a drill, and
// the run content hooks every run screen reads through (useRunContent, useOpenRun).
import { render, renderHook, screen, fireEvent, act, within } from '@testing-library/preact';
import type { ComponentChildren, JSX } from 'preact';
import { MemoryStorage, stubSpeech } from './helpers';
import { CASES, IDS, STEPS, T0, blankSession, envOf } from './sim-helpers';
import { contentErrorCopy, primeContent, resetContentCache } from '../../src/data/load';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import type { Progress, RunRecord, RunSession } from '../../src/progress/types';
import { back, matchRoute } from '../../src/app/routes';
import { RunStart } from '../../src/run/RunStart';
import { GONE_CASE, useOpenRun } from '../../src/run/useRun';
import { complaintsOf, newRunIds, pickCase } from '../../src/run/start';
import { useSendQueue, type RunInput } from '../../src/run/useSendQueue';
import { startDrill } from '../../src/sim/drill';
import { resumeRun } from '../../src/sim/run';
import { UNDO_MS } from '../../src/today/discard';
import { ToastHost, clearToasts } from '../../src/ui/toast';
import { App } from '../../src/app/App';
import { hasVisibleFocus } from '../../src/lib/focus';

// back() steps through real history; a spy says where Close goes.
vi.mock('../../src/app/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/routes')>();
  return { ...actual, back: vi.fn() };
});
// Whether focus shows a ring (a keyboard user) decides if it holds a toast, and jsdom's :focus-visible is its own guess
// (today.test.tsx says more), so the app-level replace tests say they mean a tap. Every other test gets the real one.
vi.mock('../../src/lib/focus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/focus')>();
  return { ...actual, hasVisibleFocus: vi.fn(actual.hasVisibleFocus) };
});

const COMPLAINTS = ['Breathlessness', 'Giddiness', 'Chest pain', 'Bleeding', 'Fall', 'Road accident', 'Confusion', 'Toothache'];

const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });
const pendingFetch = () => vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));

function makeStore(patch: Partial<Progress> = {}, storage = new MemoryStorage()): ProgressStore {
  const store = createProgressStore(storage);
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

function renderIn(store: ProgressStore, ui: ComponentChildren) {
  return render(<ProgressContext.Provider value={store}>{ui}<ToastHost /></ProgressContext.Provider>);
}

const startAt = (hash: string) => <RunStart match={matchRoute(hash)} />;

/** Matches the element whose whole text is `text`, not its ancestors: for text split by a span. */
const wholeText = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

/** A finished full run whose clock ran to `usedMs`. */
const runOf = (id: string, usedMs: number): RunRecord => ({
  id, caseId: 'copd-amk-01', mode: 'coached', drill: false, startedAt: '2026-11-13T14:00:00.000Z', usedMs,
  stepTimes: { 'approach-patient': 0 }, missed: [], order: [], phrase: [], disputes: [], tapped: [], transcript: [],
  wrong: [], faults: [], rbsMs: null, standbyMs: null, readings: [], oxygen: null, record: null, drillRange: null,
  drillChain: [], stepsTotal: 19, reached: [], sourceRunId: null, smartLines: 0,
});
const MS = { '17:42': 1_062_000, '19:05': 1_145_000, '21:10': 1_270_000 } as const;

beforeEach(() => {
  resetContentCache();
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
  location.hash = '#/pam/start';
});

afterEach(() => {
  vi.mocked(back).mockClear();
  clearToasts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetContentCache();
});

// ---- start.ts ---------------------------------------------------------------------------------------------------

describe('complaintsOf', () => {
  it('gives each complaint once, in index order', () => {
    expect(complaintsOf(CASES)).toEqual(COMPLAINTS);
    expect(complaintsOf([])).toEqual([]);
  });
});

describe('pickCase', () => {
  it('with no complaint picks from every case, by the rng', () => {
    expect(pickCase(CASES, null, () => 0)?.id).toBe('copd-amk-01');
    expect(pickCase(CASES, null, () => 0.999)?.id).toBe('legbleed-punggol-01');
    expect(pickCase(CASES, null, () => 0.5)?.id).toBe(CASES[5]?.id);
  });

  it("with a complaint picks only that complaint's cases", () => {
    expect(pickCase(CASES, 'Giddiness', () => 0.999)?.id).toBe('hypo-hougang-01');
    const breathless = [0, 0.4, 0.999].map((r) => pickCase(CASES, 'Breathlessness', () => r)?.id);
    expect(breathless).toEqual(['copd-amk-01', 'ccf-jurong-01', 'asthma-tampines-01']);
    // Plan 3 T3: the leg bleed joins the Bleeding complaint
    expect([0, 0.999].map((r) => pickCase(CASES, 'Bleeding', () => r)?.id)).toEqual(['bleed-woodlands-01', 'legbleed-punggol-01']);
  });

  it('gives null only when nothing matches', () => {
    expect(pickCase(CASES, 'Burns', () => 0)).toBeNull();   // no case has it (Plan 3 T3 added a Toothache case)
    expect(pickCase([], null, () => 0)).toBeNull();
  });
});

describe('newRunIds', () => {
  it("makes 'run-' + the time in base 36 + 4 random base-36 characters, and the start time", () => {
    const now = new Date('2026-11-14T09:30:00.000Z');
    const ids = newRunIds(now);
    expect(ids.startedAt).toBe('2026-11-14T09:30:00.000Z');
    expect(ids.id).toMatch(new RegExp(`^run-${now.getTime().toString(36)}-[0-9a-z]{4}$`));
  });

  it('gives two runs started in the same millisecond different ids', () => {
    const now = new Date('2026-11-14T09:30:00.000Z');
    const seen = new Set(Array.from({ length: 20 }, () => newRunIds(now).id));
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---- Run start --------------------------------------------------------------------------------------------------

describe('Run start: a new case', () => {
  it('shows the New case header, Random checked, and the complaints as chips once Pick by complaint is chosen', () => {
    renderIn(makeStore(), startAt('#/pam/start'));
    expect(screen.getByRole('heading', { level: 1, name: 'New case' })).toBeTruthy();
    expect(screen.getByText('Primary survey, about 20 minutes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledWith('/pam');

    const caseGroup = screen.getByRole('group', { name: 'Case' });
    const random = within(caseGroup).getByRole('radio', { name: 'Random' }) as HTMLInputElement;
    expect(random.checked).toBe(true);
    expect(random.getAttribute('aria-describedby') && document.getElementById(random.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Hidden until the call comes in');
    expect(screen.queryByRole('group', { name: 'Complaint' })).toBeNull();

    fireEvent.click(within(caseGroup).getByRole('radio', { name: 'Pick by complaint' }));
    expect(random.checked).toBe(false);
    const chips = within(screen.getByRole('group', { name: 'Complaint' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(COMPLAINTS);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false', 'false']);

    fireEvent.click(chips[3]!);
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false', 'false', 'false', 'false']);
  });

  it('has Coached checked, the Answer by line, the clock and "No runs yet."', () => {
    renderIn(makeStore(), startAt('#/pam/start'));
    const mode = screen.getByRole('group', { name: 'Mode' });
    const coached = within(mode).getByRole('radio', { name: 'Coached' }) as HTMLInputElement;
    const exam = within(mode).getByRole('radio', { name: 'Exam' }) as HTMLInputElement;
    expect(coached.checked).toBe(true);
    expect(exam.checked).toBe(false);
    expect(document.getElementById(coached.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Flags as you go, with the step bar and step list');
    expect(document.getElementById(exam.getAttribute('aria-describedby') ?? '')?.textContent).toBe('No flags until the debrief');

    const answerBy = screen.getByRole('group', { name: 'Answer by' });
    const typing = within(answerBy).getByRole('radio', { name: 'Typing' }) as HTMLInputElement;
    expect(typing.checked).toBe(true);
    expect(document.getElementById(typing.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Type each line, then Send.');
    expect(screen.getByRole('heading', { level: 2, name: 'The clock' })).toBeTruthy();
    expect(screen.getByText('RBS by 3:00 from Approach. Whole run by 20:00.')).toBeTruthy();
    expect(screen.getByText('No runs yet.')).toBeTruthy();

    const key = screen.getByRole('button', { name: 'Take the call' });
    expect(key.className).toBe('primary');
    expect(key.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(/This replaces your open/)).toBeNull();
  });

  it('with Giddiness pressed and Exam chosen, Take the call opens an Exam run on the Giddiness case at #/run', () => {
    const store = makeStore();
    renderIn(store, startAt('#/pam/start'));
    fireEvent.click(screen.getByRole('radio', { name: 'Pick by complaint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Giddiness' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take the call' }));

    const open = store.get().runOpen;
    expect(open?.caseId).toBe('hypo-hougang-01');
    expect(open?.mode).toBe('exam');
    expect(open?.drill).toBeNull();
    expect(open?.id).toMatch(/^run-[0-9a-z]+-[0-9a-z]{4}$/);
    expect(open?.lines).toHaveLength(1);   // the activation line, and nothing said yet
    expect(location.hash).toBe('#/run');
  });

  it('Random with Coached opens a Coached run on one of the 11 cases', () => {
    const store = makeStore();
    renderIn(store, startAt('#/pam/start'));
    fireEvent.click(screen.getByRole('button', { name: 'Take the call' }));
    const open = store.get().runOpen;
    expect(CASES.map((c) => c.id)).toContain(open?.caseId);
    expect(open?.mode).toBe('coached');
    expect(location.hash).toBe('#/run');
  });

  it('replaces the Run start entry in history with the run, so Back from the run skips it', () => {
    const length = history.length;
    renderIn(makeStore(), startAt('#/pam/start'));
    fireEvent.click(screen.getByRole('button', { name: 'Take the call' }));
    expect(history.length).toBe(length);
  });

  it('shows the last three run times, newest first', () => {
    const runs = [runOf('r1', MS['21:10']), runOf('r2', MS['19:05']), runOf('r3', MS['17:42'])];   // oldest first
    renderIn(makeStore({ runs }), startAt('#/pam/start'));
    expect(screen.getByText(wholeText('Your last 3: 17:42, 19:05, 21:10.'))).toBeTruthy();
  });

  it('says "Your last 2" and "Your last run" for fewer runs', () => {
    const two = renderIn(makeStore({ runs: [runOf('r1', MS['19:05']), runOf('r2', MS['17:42'])] }), startAt('#/pam/start'));
    expect(screen.getByText(wholeText('Your last 2: 17:42, 19:05.'))).toBeTruthy();
    two.unmount();
    renderIn(makeStore({ runs: [runOf('r1', MS['17:42'])] }), startAt('#/pam/start'));
    expect(screen.getByText(wholeText('Your last run: 17:42.'))).toBeTruthy();
  });

  it('with a run open, says the key replaces it, and the key names that line as its description', () => {
    renderIn(makeStore({ runOpen: blankSession('copd-amk-01') }), startAt('#/pam/start'));
    const note = screen.getByText('This replaces your open run.');
    const key = screen.getByRole('button', { name: 'Take the call' });
    expect(note.id).not.toBe('');
    expect(key.getAttribute('aria-describedby')).toBe(note.id);
  });
});

// Plan 3 Task 5 (ruling D1): Typing or Voice, saved as settings.answerBy for the run and drills to read.
describe('Run start: Answer by', () => {
  // final review M2: it says where the audio goes, once
  const VOICE_SUB = "Tap the mic and speak. Check the words, then Send. Voice uses your phone's speech service, which may send what you " +
    'say to Google to turn it into text.';
  const UNSUPPORTED = "This browser can't take speech. Type instead.";
  const group = () => screen.getByRole('group', { name: 'Answer by' });
  const radio = (name: 'Typing' | 'Voice') => within(group()).getByRole('radio', { name }) as HTMLInputElement;
  const subOf = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent;

  it('offers Typing (checked by default) and Voice, each with its sub-line', () => {
    stubSpeech();
    renderIn(makeStore(), startAt('#/pam/start'));
    expect(within(group()).getAllByRole('radio').map((r) => r.getAttribute('aria-labelledby') && document.getElementById(r.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual(['Typing', 'Voice']);
    expect(radio('Typing').checked).toBe(true);
    expect(radio('Voice').checked).toBe(false);
    expect(radio('Voice').disabled).toBe(false);
    expect(subOf(radio('Typing'))).toBe('Type each line, then Send.');
    expect(subOf(radio('Voice'))).toBe(VOICE_SUB);
    expect(document.body.textContent!.split('Google').length - 1).toBe(1);   // said once, on Voice's own sub-line
    expect(screen.queryByText('Typing. Voice comes in a later update.')).toBeNull();
  });

  it("picking Voice saves settings.answerBy 'voice', and picking Typing saves it back", () => {
    stubSpeech();
    const store = makeStore();
    renderIn(store, startAt('#/pam/start'));
    fireEvent.click(radio('Voice'));
    expect(store.get().settings.answerBy).toBe('voice');
    expect(radio('Voice').checked).toBe(true);
    expect(radio('Typing').checked).toBe(false);
    fireEvent.click(radio('Typing'));
    expect(store.get().settings.answerBy).toBe('typing');
  });

  it('shows the saved choice, and the run started reads it from settings, not from the run', () => {
    stubSpeech();
    const store = makeStore({ settings: { textSize: 'standard', haptics: true, answerBy: 'voice' } });
    renderIn(store, startAt('#/pam/start'));
    expect(radio('Voice').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Take the call' }));
    expect(store.get().runOpen).not.toBeNull();
    expect(store.get().runOpen).not.toHaveProperty('answerBy');
    expect(store.get().settings.answerBy).toBe('voice');
  });

  it("with no recogniser on window, Voice is disabled and described by \"This browser can't take speech. Type instead.\"", () => {
    const store = makeStore({ settings: { textSize: 'standard', haptics: true, answerBy: 'voice' } });
    renderIn(store, startAt('#/pam/start'));
    expect(radio('Voice').disabled).toBe(true);
    expect(subOf(radio('Voice'))).toBe(UNSUPPORTED);
    expect(screen.queryByText(VOICE_SUB)).toBeNull();
    expect(radio('Typing').checked).toBe(true);   // a Voice saved on another browser answers by Typing here
    expect(radio('Voice').checked).toBe(false);
    expect(store.get().settings.answerBy).toBe('voice');   // and stays saved
  });

  it('a drill has Answer by too', () => {
    stubSpeech();
    const store = makeStore();
    location.hash = '#/pam/start?drill=rapid-body-survey';
    renderIn(store, startAt('#/pam/start?drill=rapid-body-survey'));
    fireEvent.click(radio('Voice'));
    expect(store.get().settings.answerBy).toBe('voice');
  });
});

describe('Run start: a drill', () => {
  it('at ?drill=rapid-body-survey shows the Drill header, no Mode or clock, and Start drill opens steps 11 to 13', () => {
    const store = makeStore();
    location.hash = '#/pam/start?drill=rapid-body-survey';
    renderIn(store, startAt('#/pam/start?drill=rapid-body-survey'));
    expect(screen.getByRole('heading', { level: 1, name: 'Drill' })).toBeTruthy();
    expect(screen.getByText('Steps 11 to 13, Rapid body survey')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Mode' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'The clock' })).toBeNull();
    expect(screen.queryByText('No runs yet.')).toBeNull();
    expect(screen.getByRole('group', { name: 'Case' })).toBeTruthy();
    const typing = within(screen.getByRole('group', { name: 'Answer by' })).getByRole('radio', { name: 'Typing' }) as HTMLInputElement;
    expect(typing.checked).toBe(true);
    expect(document.getElementById(typing.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Type each line, then Send.');
    expect(screen.queryByRole('button', { name: 'Take the call' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Pick by complaint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fall' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start drill' }));
    const open = store.get().runOpen;
    expect(open?.caseId).toBe('fall-yishun-01');
    expect(open?.mode).toBe('coached');
    expect(open?.drill).toEqual({ target: 'rapid-body-survey', from: 11, to: 13, chain: [], sourceRunId: null });
    expect(open?.current).toBe(11);
    expect(location.hash).toBe('#/run');
  });

  it('an unknown drill id shows the plain New case screen', () => {
    renderIn(makeStore(), startAt('#/pam/start?drill=no-such-step'));
    expect(screen.getByRole('heading', { level: 1, name: 'New case' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take the call' })).toBeTruthy();
  });
});

describe('Run start: loading and errors', () => {
  it("an error loading the cases shows the cases' error copy, and Try again loads them again", async () => {
    resetContentCache();
    primeContent('steps', { contentVersion: 'test', steps: STEPS });
    const f = offlineFetch();
    vi.stubGlobal('fetch', f);
    renderIn(makeStore(), startAt('#/pam/start'));
    expect(await screen.findByText(contentErrorCopy('cases'))).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(contentErrorCopy('cases'));
    expect(screen.queryByRole('button', { name: 'Take the call' })).toBeNull();

    const calls = f.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });

  it("with the steps and the cases both failing, shows the steps' copy, and one Try again loads both again", async () => {
    resetContentCache();
    const f = offlineFetch();
    vi.stubGlobal('fetch', f);
    renderIn(makeStore(), startAt('#/pam/start'));
    expect(await screen.findByText(contentErrorCopy('steps'))).toBeTruthy();
    expect(screen.queryByText(contentErrorCopy('cases'))).toBeNull();

    f.mockClear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(f.mock.calls.map((c) => String(c[0]).replace(import.meta.env.BASE_URL, '')).sort())
      .toEqual(['data/cases/index.json', 'data/steps.json']);
  });

  it('shows nothing for 300 ms while loading, then the skeleton', () => {
    vi.useFakeTimers();
    resetContentCache();
    vi.stubGlobal('fetch', pendingFetch());
    renderIn(makeStore(), startAt('#/pam/start'));
    expect(screen.getByRole('heading', { level: 1, name: 'New case' })).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('progressbar', { name: 'Loading' }).children).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Take the call' })).toBeNull();
  });

  it('a drill link says Drill while the steps load, with a skeleton for its two panels', () => {
    vi.useFakeTimers();
    resetContentCache();
    vi.stubGlobal('fetch', pendingFetch());
    renderIn(makeStore(), startAt('#/pam/start?drill=rapid-body-survey'));
    expect(screen.getByRole('heading', { level: 1, name: 'Drill' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('progressbar', { name: 'Loading' }).children).toHaveLength(2);
  });
});

// ---- useOpenRun -------------------------------------------------------------------------------------------------

/** Shows what useOpenRun gives, as a status and, for an open run, its case. */
function Probe(): JSX.Element {
  const state = useOpenRun();
  return <p data-testid="probe">{state.status === 'open' ? `open ${state.env.case.id} ${state.session.id}` : state.status}</p>;
}

describe('useOpenRun', () => {
  it("closes a run whose case has gone, once, through the store's save, with the GONE_CASE toast", () => {
    const storage = new MemoryStorage();
    const store = makeStore({ runOpen: { ...blankSession('copd-amk-01'), caseId: 'gone-01' } }, storage);
    const update = vi.spyOn(store, 'update');
    renderIn(store, <><Probe /><Probe /></>);   // two readers of the same run, as Today's resume row and its primary

    expect(store.get().runOpen).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(GONE_CASE)).toHaveLength(1);
    expect(screen.getAllByTestId('probe').map((p) => p.textContent)).toEqual(['none', 'none']);
    expect(createProgressStore(storage).get().runOpen).toBeNull();   // saved, and the save reads back
    expect(GONE_CASE).toBe("A run in progress was closed: its case isn't on this phone any more.");
  });

  it("leaves an open run alone while the content loads: it can't tell yet whether the case has gone", () => {
    resetContentCache();
    vi.stubGlobal('fetch', pendingFetch());
    const session = blankSession('copd-amk-01');
    const store = makeStore({ runOpen: session });
    const update = vi.spyOn(store, 'update');
    renderIn(store, <Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('loading');
    expect(store.get().runOpen).toBe(session);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByText(GONE_CASE)).toBeNull();
  });

  it('leaves an open run alone when the cases fail to load', async () => {
    resetContentCache();
    primeContent('steps', { contentVersion: 'test', steps: STEPS });
    vi.stubGlobal('fetch', offlineFetch());
    const session = blankSession('copd-amk-01');
    const store = makeStore({ runOpen: session });
    const update = vi.spyOn(store, 'update');
    renderIn(store, <Probe />);
    expect(await screen.findByText('error')).toBeTruthy();
    expect(store.get().runOpen).toBe(session);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByText(GONE_CASE)).toBeNull();
  });

  it('gives the open run with its environment, none with no run, and the content state while it loads', () => {
    const store = makeStore({ runOpen: blankSession('hypo-hougang-01') });
    const view = renderIn(store, <Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('open hypo-hougang-01 run-1');

    act(() => store.update((p) => ({ ...p, runOpen: null })));
    expect(screen.getByTestId('probe').textContent).toBe('none');
    view.unmount();

    resetContentCache();
    vi.stubGlobal('fetch', pendingFetch());
    renderIn(makeStore(), <Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('loading');
  });
});

// ---- Replacing an open run (Plan 3 Task 7: M1, ruling D26) -------------------------------------------------------

describe('Run start: replacing an open run, with Undo', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  const REPLACED = 'Run replaced.';
  const undoKey = () => screen.getByRole('button', { name: 'Undo' });

  /** Run start at `hash` over `first`, open and saved, then its key: Take the call, or Start drill at a drill link. */
  function replaceFrom(first: RunSession, hash = '#/pam/start') {
    const storage = new MemoryStorage();
    const store = makeStore({ runOpen: first }, storage);
    location.hash = hash;
    renderIn(store, startAt(hash));
    const saved = store.get().runOpen!;
    fireEvent.click(screen.getByRole('button', { name: hash.includes('drill=') ? 'Start drill' : 'Take the call' }));
    return { store, storage, saved, next: store.get().runOpen! };
  }
  /** Puts `input` to the open run `id` through the send queue, as the run screen does. */
  async function sendTo(store: ProgressStore, id: string, input: RunInput): Promise<void> {
    const { result } = renderHook(() => useSendQueue(store, envOf(store.get().runOpen!.caseId), id, () => {}));
    await act(async () => { expect(await result.current(input)).toBe(true); });
  }

  it('"Take the call" opens a new run and toasts "Run replaced." with Undo', () => {
    const { saved, next } = replaceFrom(blankSession('copd-amk-01'));
    expect(next.id).not.toBe(saved.id);
    expect(location.hash).toBe('#/run');
    expect(screen.getByText(REPLACED)).toBeTruthy();
    expect(undoKey().closest('.toasts')).not.toBeNull();
  });

  it('Undo puts the first run back as it was saved, saved again, and its toast goes', () => {
    const { store, storage, saved } = replaceFrom(blankSession('copd-amk-01'));
    act(() => { vi.advanceTimersByTime(UNDO_MS - 100); });
    fireEvent.click(undoKey());
    expect(store.get().runOpen).toEqual(saved);
    expect(store.get().runOpen?.id).toBe(IDS.id);
    expect(createProgressStore(storage).get().runOpen).toEqual(saved);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText(REPLACED)).toBeNull();
  });

  it("keeps Undo through the run screen's own writes: a resume (a new object, the same id) and a buddy's line", () => {
    const { store, saved, next } = replaceFrom(blankSession('copd-amk-01'));
    const resumed = resumeRun(next, Date.now() + 1_000);
    expect(resumed).not.toBe(next);
    expect(resumed.lines).toEqual(next.lines);
    act(() => store.update((p) => ({ ...p, runOpen: resumed })));
    // the clock's tick writes the buddies' lines, never the trainee's
    act(() => store.update((p) => ({ ...p,
      runOpen: { ...p.runOpen!, lines: [...p.runOpen!.lines, { who: 'armBuddy', text: 'SpO2 86% on RA.', atMs: null }] } })));
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText(REPLACED)).toBeTruthy();
    fireEvent.click(undoKey());
    expect(store.get().runOpen).toEqual(saved);
  });

  it('lapses once a line is sent to the new run: its toast goes, and the Undo key does nothing', async () => {
    const { store, next } = replaceFrom(blankSession('copd-amk-01'));
    const stale = undoKey();
    await sendTo(store, next.id, { text: 'FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3.' });
    const said = store.get().runOpen!;
    expect(said.lines.filter((l) => l.who === 'you')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText(REPLACED)).toBeNull();
    fireEvent.click(stale);
    expect(store.get().runOpen).toBe(said);
  });

  it('lapses once a step is tapped in the new run', async () => {
    const { store, next } = replaceFrom(blankSession('copd-amk-01'));
    const stale = undoKey();
    await sendTo(store, next.id, { tap: 'respond-call' });
    const tapped = store.get().runOpen!;
    expect(tapped.tapped).toEqual(['respond-call']);
    fireEvent.click(stale);
    expect(store.get().runOpen).toBe(tapped);
  });

  it('lapses when its toast goes after UNDO_MS', () => {
    const { store, next } = replaceFrom(blankSession('copd-amk-01'));
    const stale = undoKey();
    act(() => stale.blur());
    act(() => { vi.advanceTimersByTime(UNDO_MS + 200); });
    expect(screen.queryByText(REPLACED)).toBeNull();
    fireEvent.click(stale);
    expect(store.get().runOpen).toBe(next);
  });

  it('lapses when memory is replaced wholesale, even by a load of the same new run (the generation moves)', () => {
    const { store, next } = replaceFrom(blankSession('copd-amk-01'));
    const stale = undoKey();
    act(() => { store.tryAgain(); });
    const loaded = store.get().runOpen!;
    expect(loaded).not.toBe(next);
    expect(loaded.id).toBe(next.id);
    fireEvent.click(stale);
    expect(store.get().runOpen).toBe(loaded);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText(REPLACED)).toBeNull();
  });

  it('never puts the first run over another opened since', () => {
    const { store } = replaceFrom(blankSession('copd-amk-01'));
    const stale = undoKey();
    const other = { ...blankSession('hypo-hougang-01'), id: 'run-3' };
    act(() => store.update((p) => ({ ...p, runOpen: other })));
    fireEvent.click(stale);
    expect(store.get().runOpen).toBe(other);
  });

  it('says "Drill replaced." when the one put aside was a drill, and its Undo brings the drill back', () => {
    const { store, saved } = replaceFrom(startDrill(envOf('copd-amk-01'), 'rapid-body-survey', [], null, IDS, T0));
    expect(screen.getByText('Drill replaced.')).toBeTruthy();
    expect(screen.queryByText(REPLACED)).toBeNull();
    fireEvent.click(undoKey());
    expect(store.get().runOpen).toEqual(saved);
    expect(store.get().runOpen?.drill?.target).toBe('rapid-body-survey');
  });

  it("a notes drill link's Start drill over an open run toasts it too", () => {
    const { next } = replaceFrom(blankSession('copd-amk-01'), '#/pam/start?drill=airway');
    expect(next.drill?.target).toBe('airway');
    expect(screen.getByText(REPLACED)).toBeTruthy();
  });

  it('with no run open, there is no toast', () => {
    const store = makeStore();
    renderIn(store, startAt('#/pam/start'));
    fireEvent.click(screen.getByRole('button', { name: 'Take the call' }));
    expect(store.get().runOpen).not.toBeNull();
    expect(screen.queryByText(REPLACED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

// ---- Task 7 review round 1 (I1, M3): the replace in the app, where the route change moves focus -------------------

describe('Run start in the app: replacing an open run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(hasVisibleFocus).mockImplementation(() => false);   // a tap: focus a script moves there holds nothing
  });
  afterEach(() => { vi.mocked(hasVisibleFocus).mockReset(); });

  /** The app at `hash` with the COPD run open; then Run start's key. */
  function replaceInApp(hash = '#/pam/start') {
    const store = makeStore({ runOpen: blankSession('copd-amk-01') });
    const saved = store.get().runOpen!;
    location.hash = hash;
    render(<App store={store} />);
    fireEvent.click(screen.getByRole('button', { name: hash.includes('drill=') ? 'Start drill' : 'Take the call' }));
    return { store, saved };
  }
  const runHeading = () => document.querySelector<HTMLElement>('main h1')!;

  it('Take the call: on the run screen the Undo of "Run replaced." has focus, and after UNDO_MS the run’s heading', () => {
    const { store } = replaceInApp();
    expect(location.hash).toBe('#/run');
    expect(document.querySelector('.run')).not.toBeNull();
    expect(screen.getByText('Run replaced.')).toBeTruthy();
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(document.activeElement).toBe(undo);
    act(() => { vi.advanceTimersByTime(UNDO_MS + 200); });
    expect(screen.queryByText('Run replaced.')).toBeNull();
    expect(document.activeElement).toBe(runHeading());
    expect(runHeading().closest('.run')).not.toBeNull();
    expect(store.get().runOpen?.id).not.toBe(IDS.id);
  });

  it('pressing that Undo brings the first run back onto the run screen, and focus to its heading', () => {
    const { store, saved } = replaceInApp();
    const next = store.get().runOpen!;
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.get().runOpen).toEqual(saved);
    expect(location.hash).toBe('#/run');
    act(() => { vi.advanceTimersByTime(200); });   // the toast fades, handing focus on
    expect(screen.queryByText('Run replaced.')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /Breathlessness/ })).toBe(runHeading());
    expect(document.activeElement).toBe(runHeading());
    expect(store.get().runOpen?.id).toBe(saved.id);
    expect(store.get().runOpen?.id).not.toBe(next.id);
  });

  it('a drill link’s Start drill gives its Undo focus the same way', () => {
    replaceInApp('#/pam/start?drill=airway');
    expect(location.hash).toBe('#/run');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }));
  });

  it('with no run open, Take the call lands focus on the run screen, not in a toast', () => {
    const store = makeStore();
    location.hash = '#/pam/start';
    render(<App store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take the call' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(document.activeElement).toBe(runHeading());
  });
});

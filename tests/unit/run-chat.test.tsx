// Task 14: the run screen's chat and composer (#/run): the log with its hidden speaker prefixes, the interpretation
// (route) lines and Coached's disputable inline flags, sticking to the newest line with the "↓ n new" pill, the
// composer, and the ordered send queue with its one save per input and its haptics.
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/preact';
import { FakeRecognition, MemoryStorage, lastRecognition, stubSpeech } from './helpers';
import { CASES, IDS, STEPS, caseById, envOf, hitAll } from './sim-helpers';
import { primeContent, resetContentCache } from '../../src/data/load';
import { App } from '../../src/app/App';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import { RUN_LIMITS, type ChatLine, type Progress, type RunSession } from '../../src/progress/types';
import { keywordGrader, type Grader } from '../../src/sim/grader';
import { startDrill } from '../../src/sim/drill';
import { disputePoint, envFor, startRun } from '../../src/sim/run';
import { Chat } from '../../src/run/Chat';
import { Composer, clearDraft, draftKeyOf } from '../../src/run/Composer';
import { useSendQueue } from '../../src/run/useSendQueue';
import { finishRun } from '../../src/run/useRunLifecycle';
import { chipFor } from '../../src/ui/StatusChip';
import { ToastHost, clearToasts } from '../../src/ui/toast';

const env = envOf('copd-amk-01');
const copd = caseById('copd-amk-01');
const upTo = (order: number) => STEPS.filter((s) => s.order <= order).map((s) => s.id);

const STEP1 = 'FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3 for case of elderly female, breathlessness.';
const ASK_ADDRESS = 'Hi, I am calling from 995 FMV. Can I confirm your address?';
const SOUND_OUT = 'Approaching casualty from the front. If you can hear me, please do not move your head.';
// The engine's head-grip scenario (run-engine.test.ts): the head grip said during Approach, then two Approach points,
// which make the head grip the one point out of place.
const HEAD_GRIP_LINES = [SOUND_OUT, 'Buddy, do a head grip.', 'Is there any catastrophic bleeding?', 'Any hazards around the patient?'];
const LINE_LIMIT = 'This run has reached its line limit. End it from Pause to see the debrief.';

const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });

/** A store over `storage` with `patch` applied. */
function makeStore(patch: Partial<Progress> = {}, storage = new MemoryStorage()): ProgressStore {
  const store = createProgressStore(storage);
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

/** The app at #/run with `session` open. */
function renderRun(session: RunSession, patch: Partial<Progress> = {}, storage = new MemoryStorage()): ProgressStore {
  const store = makeStore({ runOpen: session, ...patch }, storage);
  render(<App store={store} />);
  return store;
}

/** A new run of the COPD case, started now. */
const fresh = (mode: RunSession['mode'] = 'coached'): RunSession => startRun(env, mode, IDS, Date.now());
/** The head-grip scenario's start: COPD with steps 1 to 4 done. */
const beforeApproach = (mode: RunSession['mode'] = 'coached'): RunSession => hitAll(fresh(mode), STEPS, copd, upTo(4));

const log = () => screen.getByRole('log', { name: 'Run chat' });
const field = () => screen.getByRole('textbox', { name: 'Speak to the scene' }) as HTMLInputElement;
const runOf = (store: ProgressStore): RunSession => store.get().runOpen!;
const said = (s: RunSession, text: string) => s.lines.some((l) => l.who === 'you' && l.text === text);

/** Types `text` in the composer and presses Enter. Enter in the field submits its form (implicit submission), which
 *  jsdom doesn't do for a synthetic key press, so the form is submitted as Enter would. */
function say(text: string): void {
  const el = field();
  fireEvent.input(el, { target: { value: text } });
  act(() => { el.form!.requestSubmit(); });
}

/** Waits for the send queue until `done` holds for the open run, and the screen has rendered it. */
async function until(store: ProgressStore, done: (s: RunSession) => boolean): Promise<void> {
  await act(async () => { await vi.waitFor(() => expect(done(runOf(store))).toBe(true)); });
}
const lineCount = (n: number) => (s: RunSession) => s.lines.length === n;

beforeEach(() => {
  location.hash = '#/run';
  clearToasts();
  resetContentCache();
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
  vi.stubGlobal('fetch', offlineFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetContentCache();
  clearToasts();
});

// ---- The log --------------------------------------------------------------------------------------------------

describe('Chat: the log', () => {
  it('the log named "Run chat" holds the activation, with the hidden prefix "Dispatch: "', () => {
    renderRun(fresh());
    const card = log().querySelector('.syscard')!;
    expect(card.textContent).toBe('Dispatch: Activation: Elderly female, breathlessness. Blk 2xx Ang Mo Kio Ave 3, #07-xx.');
    expect(card.querySelector('.vh')!.textContent).toBe('Dispatch: ');
  });

  it("a drill's opening line has the hidden prefix \"Drill: \", as the debrief's transcript labels it (Task 17)", () => {
    const drill = startDrill(env, 'rapid-body-survey', [], null, IDS, Date.now());
    render(<Chat lines={drill.lines} case={copd} mode="coached" disputes={[]} onDispute={() => {}} />);
    const cards = [...log().querySelectorAll('.syscard')];
    expect(cards.map((c) => c.querySelector('.vh')!.textContent)).toEqual(['Dispatch: ', 'Drill: ']);
    expect(cards[1]!.textContent).toBe(`Drill: ${drill.lines.at(-1)!.text}`);
  });

  it('a first line: "You: " in its bubble, its route under it, the reply with "Ops Ctr: ", and the run saved', async () => {
    const storage = new MemoryStorage();
    const store = renderRun(fresh(), {}, storage);
    say(STEP1);
    await until(store, lineCount(3));
    const mine = log().querySelector('.msg.me')!;
    expect(mine.querySelector('.bub')!.textContent).toBe(`You: ${STEP1}`);
    expect(mine.querySelector('.bub .vh')!.textContent).toBe('You: ');
    expect(mine.querySelector('.route')!.textContent).toBe('To Ops Ctr: call sign, responding to, case of');
    const reply = log().querySelector('.msg.them')!;
    expect(reply.querySelector('.bub')!.textContent).toBe('Ops Ctr: Ops Ctr, roger.');
    expect(reply.querySelector('.bub .vh')!.textContent).toBe('Ops Ctr: ');
    // a "them" line shows its speaker too, for the eye only
    expect(reply.querySelector('.who')!.textContent).toBe('Ops Ctr');
    expect(reply.querySelector('.who')!.getAttribute('aria-hidden')).toBe('true');
    expect(runOf(store).lines).toHaveLength(3);
    expect([...storage.map.values()].some((raw) => raw.includes(STEP1))).toBe(true);
  });

  it('two submits in a row, not awaited, give A, its reply, B, its reply, in order, saved once each', async () => {
    const storage = new MemoryStorage();
    const store = renderRun(fresh(), {}, storage);
    const writes = vi.spyOn(storage, 'setItem');
    say(STEP1);
    say(ASK_ADDRESS);
    await until(store, lineCount(5));
    expect(runOf(store).lines.slice(1).map((l) => [l.who, l.text])).toEqual([
      ['you', STEP1], ['opsCtr', 'Ops Ctr, roger.'], ['you', ASK_ADDRESS], ['caller', expect.any(String)],
    ]);
    expect(writes).toHaveBeenCalledTimes(2);
    // the screen shows them in the same order
    const bubbles = Array.from(log().querySelectorAll('.bub .vh'), (x) => x.textContent);
    expect(bubbles).toEqual(['You: ', 'Ops Ctr: ', 'You: ', 'Caller, son: ']);
  });

  it('a tapped line shows "Tapped" with its route, and a long line stays in its bubble', () => {
    const lines: ChatLine[] = [
      { who: 'you', text: 'Hi Sir/Ma’am, I am EMT XXX from SCDF.', atMs: null, route: 'Tapped: step 6, Introduction', tapped: true },
      { who: 'patient', text: 'Breathless… since this morning.', atMs: null },
    ];
    render(<Chat lines={lines} case={copd} mode="coached" disputes={[]} onDispute={() => {}} />);
    const tapped = log().querySelector('.msg.me')!;
    expect(tapped.classList.contains('tapped')).toBe(true);
    expect(tapped.querySelector('.route')!.textContent).toBe('Tapped: step 6, Introduction');
    expect(log().querySelector('.msg.them .who')!.textContent).toBe('Mdm Tan, patient');
  });

  it('a tapped line with no route still says "Tapped"', () => {
    render(<Chat lines={[{ who: 'you', text: 'Line', atMs: null, tapped: true }]} case={copd} mode="coached" disputes={[]} onDispute={() => {}} />);
    expect(log().querySelector('.route')!.textContent).toBe('Tapped');
  });
});

// ---- Inline flags ---------------------------------------------------------------------------------------------

describe('Chat: inline flags', () => {
  it('Coached: the head grip flag sits under its line, "!!Order", and "Not what I meant" disputes it', async () => {
    const store = renderRun(beforeApproach());
    for (const line of HEAD_GRIP_LINES) say(line);
    await until(store, (s) => said(s, HEAD_GRIP_LINES[3]!) && s.flaggedOrder.includes('introduction/head-grip'));
    const flag = within(log()).getAllByRole('status')
      .find((x) => x.textContent!.includes('Head grip belongs to step 6, Introduction.'))!;
    expect(flag.className).toBe('flag');
    expect(flag.textContent).toContain('!!Order');
    expect(flag.textContent).toContain('Tester flag');
    // under the line holding it
    expect(flag.previousElementSibling!.querySelector('.bub')!.textContent).toBe('You: Buddy, do a head grip.');
    const key = within(flag).getByRole('button', { name: 'Not what I meant' });
    key.focus();   // as a keyboard press or Chrome's tap leaves it (a synthetic click alone moves no focus)
    act(() => { fireEvent.click(key); });
    expect(runOf(store).disputes).toContain('introduction/head-grip');
    expect(within(flag).queryByRole('button', { name: 'Not what I meant' })).toBeNull();
    expect(within(flag).getByText('Disputed. Not counted.')).toBeTruthy();
    // focus doesn't fall to the page when the key it was on goes
    expect(document.activeElement).toBe(within(flag).getByText('Disputed. Not counted.'));
  });

  it('Exam: the same lines give no status in the chat', async () => {
    const store = renderRun(beforeApproach('exam'));
    for (const line of HEAD_GRIP_LINES) say(line);
    await until(store, (s) => said(s, HEAD_GRIP_LINES[3]!));
    expect(within(log()).queryAllByRole('status')).toHaveLength(0);
    expect(log().querySelectorAll('.route').length).toBeGreaterThan(0);   // what the run understood still shows
  });

  it('each kind of flag has its chip: Missed for a nudge, Wrong, Order and Phrase; Exam shows none', () => {
    const flags = [
      { kind: 'nudge', point: 'a/b', text: 'Not done yet: say it.' },
      { kind: 'wrong', point: 'breathing/mask-flow', text: 'Wrong mask or flow for this patient. Check your oxygen guidelines.' },
      { kind: 'order', point: 'c/d', text: 'Out of order.' },
      { kind: 'phrase', point: 'e/f', text: 'Key words missing: “suspected”.' },
    ] as const;
    const lines: ChatLine[] = [{ who: 'you', text: 'Line', atMs: null, route: 'To tester: something', flags: [...flags] }];
    const view = render(<Chat lines={lines} case={copd} mode="coached" disputes={['e/f']} onDispute={() => {}} />);
    const statuses = within(log()).getAllByRole('status');
    expect(statuses.map((x) => x.querySelector('.tag')!.textContent)).toEqual(['!!!Missed', '!!!Wrong', '!!Order', '!!Phrase']);
    expect(statuses.map((x) => x.querySelector(':scope > p')!.textContent)).toEqual(flags.map((f) => f.text));
    // the disputed point: its key gives way to the note
    expect(within(statuses[3]!).getByText('Disputed. Not counted.')).toBeTruthy();
    expect(within(statuses[0]!).getByRole('button', { name: 'Not what I meant' })).toBeTruthy();
    view.rerender(<Chat lines={lines} case={copd} mode="exam" disputes={[]} onDispute={() => {}} />);
    expect(within(log()).queryAllByRole('status')).toHaveLength(0);
  });

  it('a tap on "Not what I meant" while typing keeps focus in the field, so the keyboard stays up', async () => {
    const store = renderRun(beforeApproach());
    for (const line of HEAD_GRIP_LINES) say(line);
    await until(store, (s) => said(s, HEAD_GRIP_LINES[3]!) && s.flaggedOrder.includes('introduction/head-grip'));
    const key = within(log()).getAllByRole('button', { name: 'Not what I meant' })[0]!;
    field().focus();
    expect(fireEvent.mouseDown(key)).toBe(false);   // its default (taking focus) prevented
    act(() => { fireEvent.click(key); });
    expect(runOf(store).disputes).toHaveLength(1);
    expect(document.activeElement).toBe(field());
    // with no field focused, a press is left alone (a keyboard or screen reader user's focus moves as usual)
    field().blur();
    expect(fireEvent.mouseDown(within(log()).getAllByRole('button', { name: 'Not what I meant' })[0]!)).toBe(true);
  });

  // Final review M3: TalkBack tabbing through the keys hears which flag each one disputes.
  it('describes each "Not what I meant" key by its own flag\'s text', () => {
    const lines: ChatLine[] = [
      { who: 'you', text: 'Line one', atMs: null, flags: [{ kind: 'phrase', point: 'scene-evaluation/moi', text: 'Key words missing: “suspected”.' }] },
      { who: 'you', text: 'Line two', atMs: null, flags: [{ kind: 'order', point: 'introduction/head-grip', text: 'Head grip belongs to step 6, Introduction.' }] },
    ];
    render(<Chat lines={lines} case={copd} mode="coached" disputes={[]} onDispute={() => {}} />);
    const keys = screen.getAllByRole('button', { name: 'Not what I meant' });
    const ids = keys.map((k) => k.getAttribute('aria-describedby') ?? '');
    expect(new Set(ids).size).toBe(2);
    expect(ids.map((id) => document.getElementById(id)?.textContent))
      .toEqual(['Key words missing: “suspected”.', 'Head grip belongs to step 6, Introduction.']);
  });

  it('"Not what I meant" passes the point it disputes', () => {
    const onDispute = vi.fn();
    const lines: ChatLine[] = [{ who: 'you', text: 'Line', atMs: null, flags: [{ kind: 'phrase', point: 'scene-evaluation/moi', text: 'x' }] }];
    render(<Chat lines={lines} case={copd} mode="coached" disputes={[]} onDispute={onDispute} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not what I meant' }));
    expect(onDispute).toHaveBeenCalledWith('scene-evaluation/moi');
  });

  it('chipFor maps every flag kind to its chip', () => {
    expect(chipFor('wrong')).toEqual({ kind: 'missed', label: 'Wrong' });
    expect(chipFor('nudge')).toEqual({ kind: 'missed', label: 'Missed' });
    expect(chipFor('missed')).toEqual({ kind: 'missed', label: 'Missed' });
    expect(chipFor('order')).toEqual({ kind: 'order', label: 'Order' });
    expect(chipFor('phrase')).toEqual({ kind: 'phrase', label: 'Phrase' });
  });
});

// ---- Sticking to the end --------------------------------------------------------------------------------------

describe('Chat: sticking to the newest line', () => {
  /** The scroller `fromEnd` px from its end: scrollHeight 2000, clientHeight 500, and a scrollTop that the code can set. */
  function scrolled(fromEnd: number): HTMLElement {
    const el = log();
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 1500 - fromEnd, writable: true, configurable: true });
    fireEvent.scroll(el);
    return el;
  }
  const pill = () => screen.queryByRole('button', { name: /^\d+ new$/ });

  it('scrolled up 1 500px, a line and its reply add "↓ 2 new"; the pill scrolls to the end and goes', async () => {
    const store = renderRun(fresh());
    const el = scrolled(1500);
    say(STEP1);
    await until(store, lineCount(3));
    expect(pill()!.textContent).toBe('↓ 2 new');
    expect(el.scrollTop).toBe(0);   // the trainee's place is kept
    field().focus();
    expect(fireEvent.mouseDown(pill()!)).toBe(false);   // a tap while typing keeps the keyboard up
    act(() => { fireEvent.click(pill()!); });
    expect(el.scrollTop).toBe(2000);
    expect(pill()).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it('scrolling back within 80px of the end clears the pill', async () => {
    const store = renderRun(fresh());
    const el = scrolled(1500);
    say(STEP1);
    await until(store, lineCount(3));
    expect(pill()).not.toBeNull();
    el.scrollTop = 1420;   // 80px from the end
    act(() => { fireEvent.scroll(el); });
    expect(pill()).toBeNull();
  });

  it('at the end, new lines scroll into view and no pill shows', async () => {
    const store = renderRun(fresh());
    const el = scrolled(60);
    say(STEP1);
    await until(store, lineCount(3));
    expect(el.scrollTop).toBe(2000);
    expect(pill()).toBeNull();
  });
});

// ---- The composer ---------------------------------------------------------------------------------------------

describe('Composer', () => {
  it('an empty submit adds nothing', async () => {
    const storage = new MemoryStorage();
    const store = renderRun(fresh(), {}, storage);
    const writes = vi.spyOn(storage, 'setItem');
    say('   ');
    await act(async () => { await Promise.resolve(); });
    expect(runOf(store).lines).toHaveLength(1);
    expect(writes).not.toHaveBeenCalled();
  });

  it('after a send the field is empty and keeps focus, so the keyboard stays up', async () => {
    const store = renderRun(fresh());
    field().focus();
    say(STEP1);
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
    await until(store, lineCount(3));
    expect(document.activeElement).toBe(field());
  });

  it('the field: a 600-character text line with the send key hint; the banded Send key submits', () => {
    renderRun(fresh());
    const el = field();
    expect(el.getAttribute('maxlength')).toBe(String(RUN_LIMITS.lineChars));
    expect(el.getAttribute('maxlength')).toBe('600');
    expect(el.getAttribute('enterkeyhint')).toBe('send');
    expect(el.getAttribute('type')).toBe('text');
    expect(el.getAttribute('autocomplete')).toBe('off');
    expect(el.getAttribute('placeholder')).toBe('Speak to the scene');
    expect(el.closest('form')!.className).toBe('composer');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.getAttribute('type')).toBe('submit');
    expect(send.className).toBe('send');
  });

  it('Coached has the Step list key; Exam has none', () => {
    const view = renderRun(fresh());
    expect(screen.getByRole('button', { name: 'Step list' }).className).toBe('sq');
    act(() => view.update((p) => ({ ...p, runOpen: fresh('exam') })));
    expect(screen.queryByRole('button', { name: 'Step list' })).toBeNull();
  });

  it(`at ${RUN_LIMITS.transcriptLines} lines the field is disabled, with the line limit note`, () => {
    const lines: ChatLine[] = Array.from({ length: RUN_LIMITS.transcriptLines }, (_, i) => ({ who: 'you', text: `Line ${i}`, atMs: null }));
    renderRun({ ...fresh(), lines });
    expect(field().disabled).toBe(true);
    const note = screen.getByText(LINE_LIMIT);
    expect(field().getAttribute('aria-describedby')).toBe(note.id);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it(`below ${RUN_LIMITS.transcriptLines} lines there is no note`, () => {
    renderRun(fresh());
    expect(field().disabled).toBe(false);
    expect(screen.queryByText(LINE_LIMIT)).toBeNull();
  });
});

// ---- Haptics --------------------------------------------------------------------------------------------------

describe('Haptics', () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vibrate = vi.fn();
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 15)', configurable: true });
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  });
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).userAgent;
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });
  const settings = (haptics: boolean): Partial<Progress> => ({ settings: { textSize: 'standard', haptics, answerBy: 'typing' } });

  it("Coached: a tap on every send, and the head grip scenario's flagged line buzzes wrong", async () => {
    const store = renderRun(beforeApproach(), settings(true));
    for (const line of HEAD_GRIP_LINES) say(line);
    await until(store, (s) => said(s, HEAD_GRIP_LINES[3]!) && s.flaggedOrder.includes('introduction/head-grip'));
    expect(vibrate.mock.calls.filter(([x]) => x === 8)).toHaveLength(HEAD_GRIP_LINES.length);
    expect(vibrate).toHaveBeenCalledWith([24, 60, 24]);
  });

  it('with haptics off nothing buzzes', async () => {
    const store = renderRun(beforeApproach(), settings(false));
    for (const line of HEAD_GRIP_LINES) say(line);
    await until(store, (s) => said(s, HEAD_GRIP_LINES[3]!) && s.flaggedOrder.includes('introduction/head-grip'));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('Exam never buzzes wrong: that would give away a fault before the debrief', async () => {
    const store = renderRun(beforeApproach('exam'), settings(true));
    for (const line of HEAD_GRIP_LINES) say(line);
    await until(store, (s) => said(s, HEAD_GRIP_LINES[3]!));
    expect(vibrate).toHaveBeenCalled();
    expect(vibrate.mock.calls.every(([x]) => x === 8)).toBe(true);
  });
});

// ---- The send queue -------------------------------------------------------------------------------------------

describe('useSendQueue', () => {
  /** The queue for the store's open run, with an announce spy. */
  function queue(store: ProgressStore, e = env) {
    const announce = vi.fn();
    const { result } = renderHook(() => useSendQueue(store, e, runOf(store).id, announce));
    return { send: result.current, announce };
  }

  it('a tap plays the step from the step list, saved once', async () => {
    const storage = new MemoryStorage();
    const store = makeStore({ runOpen: fresh() }, storage);
    const writes = vi.spyOn(storage, 'setItem');
    const { send } = queue(store);
    await send({ tap: 'respond-call' });
    expect(runOf(store).lines[1]).toMatchObject({ who: 'you', tapped: true, route: 'Tapped: step 1, Respond call' });
    expect(runOf(store).tapped).toEqual(['respond-call']);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('typed lines and taps keep their order', async () => {
    const store = makeStore({ runOpen: fresh() });
    const { send } = queue(store);
    void send({ text: STEP1 });
    void send({ tap: 'call-caller' });
    await send({ text: 'Crew, please don latex gloves and face mask.' });
    expect(runOf(store).lines.filter((l) => l.who === 'you').map((l) => l.tapped === true ? 'tap' : l.text))
      .toEqual([STEP1, 'tap', 'Crew, please don latex gloves and face mask.']);
  });

  it('a line read slowly keeps its place: the line sent after it waits its turn', async () => {
    const grader: Grader = {
      id: 'test',
      async interpret(line, ctx) {
        if (line === STEP1) await new Promise((r) => setTimeout(r, 30));
        return keywordGrader.interpret(line, ctx);
      },
    };
    const store = makeStore({ runOpen: fresh() });
    const { send } = queue(store, envFor(STEPS, copd, grader));
    void send({ text: STEP1 });
    await send({ text: ASK_ADDRESS });
    expect(runOf(store).lines.filter((l) => l.who === 'you').map((l) => l.text)).toEqual([STEP1, ASK_ADDRESS]);
  });

  it('passes on what the run announces', async () => {
    // RBS done, with the clock running: "RBS done at m:ss."
    const s = hitAll(fresh(), STEPS, copd, upTo(11));
    const store = makeStore({ runOpen: { ...s, clock: { started: true, bankedMs: 161_000, runningSince: Date.now() } } });
    const { send, announce } = queue(store);
    await send({ text: 'Head, neck, chest, abdomen, pelvis, lower extremities, upper extremities and back, with eye contact.' });
    expect(announce).toHaveBeenCalledWith([expect.stringMatching(/^RBS done at 2:4\d\.$/)]);
  });

  it('a run changed while a line is read (a dispute) is read again, so neither change is lost', async () => {
    let calls = 0;
    let store!: ProgressStore;
    const grader: Grader = {
      id: 'test',
      async interpret(line, ctx) {
        calls += 1;
        if (calls === 1) store.update((p) => ({ ...p, runOpen: disputePoint(p.runOpen!, 'scene-evaluation/moi') }));
        return keywordGrader.interpret(line, ctx);
      },
    };
    store = makeStore({ runOpen: fresh() });
    const { send } = queue(store, envFor(STEPS, copd, grader));
    await send({ text: STEP1 });
    expect(calls).toBe(2);
    expect(runOf(store).disputes).toEqual(['scene-evaluation/moi']);
    expect(runOf(store).lines).toHaveLength(3);
  });

  it('an input for a run that has ended, or been replaced, is dropped', async () => {
    const store = makeStore({ runOpen: fresh() });
    const { send } = queue(store);
    act(() => store.update((p) => ({ ...p, runOpen: { ...fresh(), id: 'run-2' } })));
    await send({ text: STEP1 });
    expect(runOf(store).lines).toHaveLength(1);
    act(() => store.update((p) => ({ ...p, runOpen: null })));
    await expect(send({ text: STEP1 })).resolves.toBe(true);   // nothing for the trainee to send again
    expect(store.get().runOpen).toBeNull();
  });

  it('a save the store refuses never stops the inputs after it', async () => {
    const storage = new MemoryStorage();
    const store = makeStore({ runOpen: fresh() }, storage);
    storage.failWrites = true;
    const { send } = queue(store);
    void send({ text: STEP1 });
    await send({ text: ASK_ADDRESS });
    expect(store.lastSaveError()).not.toBeNull();
    expect(runOf(store).lines.filter((l) => l.who === 'you').map((l) => l.text)).toEqual([STEP1, ASK_ADDRESS]);
  });

  it('an input that fails is logged and resolves false, and the queue carries on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const grader: Grader = {
      id: 'test',
      async interpret(line, ctx) {
        calls += 1;
        if (calls === 1) throw new Error('grader down');
        return keywordGrader.interpret(line, ctx);
      },
    };
    const store = makeStore({ runOpen: fresh() });
    const { send } = queue(store, envFor(STEPS, copd, grader));
    await expect(send({ text: STEP1 })).resolves.toBe(false);
    expect(runOf(store).lines).toHaveLength(1);
    await expect(send({ text: STEP1 })).resolves.toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(runOf(store).lines).toHaveLength(3);
  });

  it('a run that changes under every read is given up after 3 reads, and the next input still applies', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    let busy = true;
    let store!: ProgressStore;
    const grader: Grader = {
      id: 'test',
      async interpret(line, ctx) {
        calls += 1;
        // a write lands on the run during every read (a pause, a dispute, a tick)
        if (busy) store.update((p) => ({ ...p, runOpen: disputePoint(p.runOpen!, `x/${calls}`) }));
        return keywordGrader.interpret(line, ctx);
      },
    };
    store = makeStore({ runOpen: fresh() });
    const { send } = queue(store, envFor(STEPS, copd, grader));
    await expect(send({ text: STEP1 })).resolves.toBe(false);
    expect(calls).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(runOf(store).lines).toHaveLength(1);
    expect(runOf(store).disputes).toEqual(['x/1', 'x/2', 'x/3']);   // the writes themselves all stand
    busy = false;
    await expect(send({ text: STEP1 })).resolves.toBe(true);
    expect(runOf(store).lines).toHaveLength(3);
  });
});

// ---- A line that didn't go through ------------------------------------------------------------------------------

describe('Composer: a line that did not go through', () => {
  /** The composer alone, its sends answered by `sent`, with the toasts shown. */
  function composer(sent: (text: string) => Promise<boolean>) {
    const onSend = vi.fn(sent);
    render(<ProgressContext.Provider value={makeStore()}>
      <Composer onSend={onSend} disabled={false} showStepList={false} onStepList={() => {}} answerBy="typing" callName="Mdm Tan" hold={false}
        draftKey={draftKeyOf('composer')} />
      <ToastHost />
    </ProgressContext.Provider>);
    return onSend;
  }

  it(`comes back into the empty field: "It's back in the box."`, async () => {
    composer(async () => false);
    say(STEP1);
    expect(field().value).toBe('');
    await act(async () => { await Promise.resolve(); });
    expect(field().value).toBe(STEP1);
    expect(screen.getByText("That line didn't go through. It's back in the box.")).toBeTruthy();
  });

  it(`never overwrites what the trainee has typed since: "That line didn't go through."`, async () => {
    let fail!: (ok: boolean) => void;
    composer(() => new Promise<boolean>((resolve) => { fail = resolve; }));
    say(STEP1);
    fireEvent.input(field(), { target: { value: 'Ops Ctr, say again' } });
    await act(async () => { fail(false); await Promise.resolve(); });
    expect(field().value).toBe('Ops Ctr, say again');
    expect(screen.getByText("That line didn't go through.")).toBeTruthy();
  });

  it('a line that went through stays gone, with no toast', async () => {
    composer(async () => true);
    say(STEP1);
    await act(async () => { await Promise.resolve(); });
    expect(field().value).toBe('');
    expect(screen.queryByText(/didn't go through/)).toBeNull();
  });

  it('on the run screen, a line the run could not take comes back into the field', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // a number that isn't finite in the run: the engine's dev check throws on the line (the save is refused too)
    renderRun({ ...fresh(), reassessSets: Number.NaN });
    say(STEP1);
    await act(async () => { await vi.waitFor(() => expect(field().value).toBe(STEP1)); });
  });
});

// ---- Voice (Plan 3 Task 5, rulings D2 to D6) ---------------------------------------------------------------------

type ComposerProps = Parameters<typeof Composer>[0];

/** The composer alone in a store's provider, with the toasts shown, answering by Voice unless `props` say otherwise;
 *  `rerender` gives it new props over those. */
function composerWith(props: Partial<ComposerProps> = {}) {
  const onSend = vi.fn((_text: string): void => {});
  const store = makeStore();
  const ui = (p: Partial<ComposerProps>) => (
    <ProgressContext.Provider value={store}>
      <Composer onSend={onSend} disabled={false} showStepList={false} onStepList={() => {}} answerBy="voice" callName="Mdm Tan"
        hold={false} draftKey={draftKeyOf('composer')} {...p} />
      <ToastHost />
    </ProgressContext.Provider>
  );
  const view = render(ui(props));
  return { onSend, store, view, rerender: (p: Partial<ComposerProps>) => view.rerender(ui({ ...props, ...p })) };
}
const speakKey = () => screen.getByRole('button', { name: 'Speak' });
const sendKey = () => screen.getByRole('button', { name: 'Send' });
const form = () => document.querySelector<HTMLFormElement>('form.composer')!;
const statusLine = () => within(form()).getByRole('status');
const hearLine = () => document.querySelector<HTMLElement>('.composer-hear');
const HEAD_GRIP_HEARD = 'buddy do a head grip sir what is bothering you';
const HEAD_GRIP_FIELD = 'Buddy do a head grip. Sir what is bothering you.';

describe('Composer: Voice', () => {
  beforeEach(() => stubSpeech());

  it('has the field, Send as a plain square key, then Speak as the banded key at the right, not pressed', () => {
    composerWith({ showStepList: true });
    const keys = [...form().querySelectorAll('input, button')].map((el) => el.getAttribute('aria-label'));
    expect(keys).toEqual(['Step list', 'Speak to the scene', 'Send', 'Speak']);
    expect(sendKey().className).toBe('sq');
    expect(sendKey().getAttribute('type')).toBe('submit');
    expect(speakKey().className).toBe('mic');
    expect(speakKey().getAttribute('type')).toBe('button');
    expect(speakKey().getAttribute('aria-pressed')).toBe('false');
    expect(speakKey().querySelector('svg.ic rect')).not.toBeNull();   // the mic
    expect(hearLine()).toBeNull();
  });

  it('a press on Speak listens: pressed, the status says "Listening.", and the interim words show over the keys', () => {
    composerWith();
    fireEvent.click(speakKey());
    expect(lastRecognition().calls).toEqual(['start']);
    expect(lastRecognition().lang).toBe('en-SG');
    expect(speakKey().getAttribute('aria-pressed')).toBe('true');
    expect(statusLine().textContent).toBe('Listening.');
    act(() => lastRecognition().hear('buddy do a', false));
    expect(hearLine()!.textContent).toBe('Hearing: buddy do a');
    expect(hearLine()!.getAttribute('aria-hidden')).toBe('true');
    expect(hearLine()!.closest('[role="log"]')).toBeNull();
    expect(hearLine()!.closest('[role="status"]')).toBeNull();
  });

  it('a final result goes into the field with soft breaks, focus stays on Speak, and nothing is sent until Send', () => {
    const { onSend } = composerWith();
    speakKey().focus();
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear(HEAD_GRIP_HEARD, true));
    act(() => lastRecognition().finish());
    expect(field().value).toBe(HEAD_GRIP_FIELD);
    expect(onSend).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(speakKey());
    expect(speakKey().getAttribute('aria-pressed')).toBe('false');
    expect(statusLine().textContent).toBe('Added to your line.');
    expect(hearLine()!.textContent).toBe(`Your line: ${HEAD_GRIP_FIELD}`);

    fireEvent.click(sendKey());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(HEAD_GRIP_FIELD);
    expect(field().value).toBe('');
    expect(statusLine().textContent).toBe('');
    expect(hearLine()).toBeNull();
    expect(document.activeElement).toBe(speakKey());   // Send leaves focus on Speak: the keyboard stays down
  });

  it('adds what was heard after what is in the field, as its own sentence', () => {
    composerWith();
    fireEvent.input(field(), { target: { value: 'Ops Ctr, roger' } });
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear('responding to blk 2xx', true));
    expect(field().value).toBe('Ops Ctr, roger. Responding to blk 2xx.');
  });

  // Final review M1: a result cut at the line's 600 characters never claims "Added to your line.": a toast says the
  // line is full, seen and heard once.
  it('a result that would take the line past 600 characters fills it, and says the line is full, not "Added"', () => {
    composerWith();
    const near = `Sir ${'a'.repeat(RUN_LIMITS.lineChars - 10)}.`;   // 595 characters
    fireEvent.input(field(), { target: { value: near } });
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear('buddy do a head grip', true));
    act(() => lastRecognition().finish());
    expect(field().value).toHaveLength(RUN_LIMITS.lineChars);
    expect(field().value.startsWith(near)).toBe(true);
    expect(statusLine().textContent).toBe('');
    expect(screen.getByText('Your line is full: 600 characters. Send it, then go on.')).toBeTruthy();
  });

  it('a result into a field already full adds nothing, and says so', () => {
    composerWith();
    const full = 'a'.repeat(RUN_LIMITS.lineChars);
    fireEvent.input(field(), { target: { value: full } });
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear('sir can you hear me', true));
    expect(field().value).toBe(full);
    expect(statusLine().textContent).not.toBe('Added to your line.');
    expect(screen.getByText('Your line is full: 600 characters. Send it, then go on.')).toBeTruthy();
  });

  it('a result that fits to the last character is added, with no toast', () => {
    composerWith();
    const heard = 'sir can you hear me';   // in the field as ". Sir can you hear me." after it: 22 characters
    const before = 'a'.repeat(RUN_LIMITS.lineChars - 22);
    fireEvent.input(field(), { target: { value: before } });
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear(heard, true));
    act(() => lastRecognition().finish());
    expect(field().value).toBe(`${before}. Sir can you hear me.`);
    expect(field().value).toHaveLength(RUN_LIMITS.lineChars);
    expect(statusLine().textContent).toBe('Added to your line.');
    expect(screen.queryByText(/Your line is full/)).toBeNull();
  });

  it('typing in the field after a result clears "Added to your line."', () => {
    composerWith({ status: 'Checking your line.' });
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear('sir can you hear me', true));
    act(() => lastRecognition().finish());
    expect(statusLine().textContent).toBe('Added to your line.');
    fireEvent.input(field(), { target: { value: 'Sir can you hear me, sir' } });
    expect(statusLine().textContent).toBe('Checking your line.');
  });

  it('a second press stops listening and keeps what was heard; the key lets go once the recogniser ends', () => {
    composerWith();
    fireEvent.click(speakKey());
    fireEvent.click(speakKey());
    expect(lastRecognition().calls).toEqual(['start', 'stop']);
    act(() => lastRecognition().hear('patient is alert', true));
    act(() => lastRecognition().finish());
    expect(field().value).toBe('Patient is alert.');
    expect(speakKey().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(speakKey());
    expect(FakeRecognition.made).toHaveLength(2);   // a third press listens again, with a new recogniser
  });

  it('Send while listening aborts it, then sends the field', () => {
    const { onSend } = composerWith();
    fireEvent.input(field(), { target: { value: 'Sir, can you hear me?' } });
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear('buddy', false));
    fireEvent.click(sendKey());
    expect(lastRecognition().calls).toEqual(['start', 'abort']);
    expect(onSend).toHaveBeenCalledWith('Sir, can you hear me?');
    expect(speakKey().getAttribute('aria-pressed')).toBe('false');
    expect(hearLine()).toBeNull();
    act(() => { lastRecognition().fail('aborted'); lastRecognition().finish(); });
    expect(screen.queryByText(/Voice stopped/)).toBeNull();
  });

  it('hold turning true (the Pause sheet) while listening aborts it; nothing heard after lands in the field', () => {
    const { rerender } = composerWith();
    fireEvent.click(speakKey());
    rerender({ hold: true });
    expect(lastRecognition().calls).toEqual(['start', 'abort']);
    expect(speakKey().getAttribute('aria-pressed')).toBe('false');
    act(() => lastRecognition().hear('buddy do a head grip', true));
    expect(field().value).toBe('');
  });

  it('a hidden page aborts listening, and so does pagehide', () => {
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    try {
      composerWith();
      fireEvent.click(speakKey());
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });   // still visible: nothing
      expect(lastRecognition().calls).toEqual(['start']);
      visibility = 'hidden';
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(lastRecognition().calls).toEqual(['start', 'abort']);
      expect(speakKey().getAttribute('aria-pressed')).toBe('false');

      visibility = 'visible';
      fireEvent.click(speakKey());
      act(() => { window.dispatchEvent(new Event('pagehide')); });
      expect(lastRecognition().calls).toEqual(['start', 'abort']);
      expect(FakeRecognition.made).toHaveLength(2);
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('unmounting while listening (the step list in its place) aborts it', () => {
    const { view } = composerWith();
    fireEvent.click(speakKey());
    view.unmount();
    expect(lastRecognition().calls).toEqual(['start', 'abort']);
  });

  it(`an error toasts what to do: 'network' says "Voice needs a connection right now. Type instead."`, () => {
    composerWith();
    fireEvent.click(speakKey());
    act(() => { lastRecognition().fail('network'); lastRecognition().finish(); });
    expect(screen.getByText('Voice needs a connection right now. Type instead.')).toBeTruthy();
    expect(speakKey().getAttribute('aria-pressed')).toBe('false');
    expect(statusLine().textContent).toBe('');
  });

  it('is never blocked offline: Speak listens with navigator.onLine false', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    composerWith();
    expect((speakKey() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(speakKey());
    expect(lastRecognition().calls).toEqual(['start']);
    online.mockRestore();
  });

  it('a disabled composer (the line limit) turns Speak off too', () => {
    composerWith({ disabled: true, note: LINE_LIMIT });
    expect((speakKey() as HTMLButtonElement).disabled).toBe(true);
    expect(speakKey().getAttribute('aria-describedby')).toBe(screen.getByText(LINE_LIMIT).id);
  });

  it('buzzes a tap as listening starts, behind the haptics setting', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 15)', configurable: true });
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      composerWith();
      fireEvent.click(speakKey());
      expect(vibrate).toHaveBeenCalledWith(8);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userAgent;
      delete (navigator as unknown as Record<string, unknown>).vibrate;
    }
  });

  it('without a recogniser, Voice falls back to the typing composer', () => {
    vi.unstubAllGlobals();
    composerWith();
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    expect(sendKey().className).toBe('send');
  });
});

// Task 5 fix round 1, I1 and M2: the line to be sent shows whole, over the keys, with the keyboard down.
describe('Composer: Voice, the line to check', () => {
  beforeEach(() => stubSpeech());

  /** Plays one listening that hears `text` as its final, then ends. */
  const dictate = (text: string) => {
    fireEvent.click(speakKey());
    act(() => { lastRecognition().hear(text, true); lastRecognition().finish(); });
  };

  it('after a result, the row says "Your line: {the field}", aria-hidden, outside the log and the status line', () => {
    composerWith();
    dictate('sir can you hear me');
    const row = hearLine()!;
    expect(row.textContent).toBe('Your line: Sir can you hear me.');
    expect(row.querySelector('.hear-k')!.textContent).toBe('Your line:');
    expect(row.getAttribute('aria-hidden')).toBe('true');
    expect(row.getAttribute('data-lines')).toBe('3');
    expect(row.closest('[role="status"]')).toBeNull();
    expect(statusLine().textContent).toBe('Added to your line.');
  });

  it('shows the whole field, every dictation and what was typed before them', () => {
    composerWith();
    fireEvent.input(field(), { target: { value: 'Ops Ctr, roger' } });
    dictate('responding to blk 2xx');
    dictate('buddy do a head grip');
    expect(field().value).toBe('Ops Ctr, roger. Responding to blk 2xx. Buddy do a head grip.');
    expect(hearLine()!.textContent).toBe('Your line: Ops Ctr, roger. Responding to blk 2xx. Buddy do a head grip.');
  });

  it('stays until Send', () => {
    const { onSend } = composerWith();
    dictate('sir can you hear me');
    expect(hearLine()).not.toBeNull();
    fireEvent.click(sendKey());
    expect(onSend).toHaveBeenCalledWith('Sir can you hear me.');
    expect(hearLine()).toBeNull();
  });

  it('goes on an edit, with "Added to your line."', () => {
    composerWith();
    dictate('sir can you hear me');
    fireEvent.input(field(), { target: { value: 'Sir, can you hear me?' } });
    expect(hearLine()).toBeNull();
    expect(statusLine().textContent).toBe('');
  });

  it('gives way to "Hearing:" while listening again, and comes back after a listening that hears nothing', () => {
    composerWith();
    dictate('sir can you hear me');
    fireEvent.click(speakKey());
    expect(hearLine()!.textContent).toBe('Hearing: …');
    act(() => lastRecognition().hear('buddy', false));
    expect(hearLine()!.textContent).toBe('Hearing: buddy');
    act(() => { lastRecognition().fail('no-speech'); lastRecognition().finish(); });
    expect(hearLine()!.textContent).toBe('Your line: Sir can you hear me.');
    expect(statusLine().textContent).toBe('');   // "Added to your line." isn't said again for an old result
  });

  it('scrolls the field to its newest words, which an unfocused field would not show', () => {
    composerWith();
    const set = vi.fn();
    Object.defineProperty(field(), 'scrollWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(field(), 'scrollLeft', { configurable: true, get: () => 0, set });
    dictate('sir can you hear me');
    expect(set).toHaveBeenCalledWith(900);
  });

  it('is never there in Typing', () => {
    const { onSend } = composerWith({ answerBy: 'typing' });
    fireEvent.input(field(), { target: { value: 'Sir, can you hear me?' } });
    expect(hearLine()).toBeNull();
    act(() => { form().requestSubmit(); });
    expect(onSend).toHaveBeenCalled();
    expect(hearLine()).toBeNull();
    expect(FakeRecognition.made).toHaveLength(0);
  });

  /** A layout for the rows: a text's height is 20px a line at `perLine` characters a line, and a row shows at most its
   *  data-lines lines (its max-height). jsdom has none of its own. `width(n)` turns the phone: n characters a line. */
  function fakeLayout(chars: number) {
    let perLine = chars;
    const lines = (el: Element) => Math.ceil((el.textContent ?? '').length / perLine);
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) { return lines(this) * 20; });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      const most = Number((this as HTMLElement).dataset?.lines ?? '0');
      return Math.min(most, lines(this)) * 20;
    });
    return { width: (n: number) => { perLine = n; } };
  }
  /** `label` and the most words from the end of `text` that fit in `chars`, after "…". */
  function tailOf(label: string, text: string, chars: number): string {
    const words = text.split(' ');
    for (let drop = 1; drop < words.length; drop++) {
      const row = `${label} …${words.slice(drop).join(' ')}`;
      if (row.length <= chars) return row;
    }
    throw new Error('Nothing fits.');
  }
  const LONG_INTERIM = 'situation patient is a 72 year old chinese female complaining of breathlessness since this morning';

  it('a long interim keeps its "Hearing:" label and loses its start to "…", whole words, the fewest that fit', () => {
    fakeLayout(20);   // two lines: 40 characters
    composerWith();
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear(LONG_INTERIM, false));
    const row = hearLine()!;
    expect(row.textContent).toBe(tailOf('Hearing:', LONG_INTERIM, 40));
    expect(row.textContent).toMatch(/^Hearing: …\S/);
    expect(row.textContent).toMatch(/since this morning$/);
    expect(row.querySelector('.hear-k')!.textContent).toBe('Hearing:');
  });

  it('a long line keeps "Your line:" and its newest words, in three lines', () => {
    fakeLayout(20);   // three lines: 60 characters
    composerWith();
    dictate(LONG_INTERIM);
    const whole = 'Situation patient is a 72 year old chinese female complaining of breathlessness since this morning.';
    expect(field().value).toBe(whole);
    expect(hearLine()!.textContent).toBe(tailOf('Your line:', whole, 60));
    expect(hearLine()!.textContent).toMatch(/since this morning\.$/);
  });

  it('fits the line again when the phone turns', () => {
    const layout = fakeLayout(20);
    composerWith();
    dictate(LONG_INTERIM);
    const whole = 'Situation patient is a 72 year old chinese female complaining of breathlessness since this morning.';
    expect(hearLine()!.textContent).toBe(tailOf('Your line:', whole, 60));
    layout.width(40);   // landscape: 120 characters fit, so the whole line shows
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(hearLine()!.textContent).toBe(`Your line: ${whole}`);
    layout.width(16);   // and back, narrower than before
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(hearLine()!.textContent).toBe(tailOf('Your line:', whole, 48));
  });

  it('a short line is shown whole, with no "…"', () => {
    fakeLayout(20);
    composerWith();
    dictate('patient is alert');
    expect(hearLine()!.textContent).toBe('Your line: Patient is alert.');
  });
});

describe('Composer: Typing', () => {
  it('has no Speak key, and Send stays the banded key', () => {
    stubSpeech();
    composerWith({ answerBy: 'typing' });
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    expect(sendKey().className).toBe('send');
    expect(hearLine()).toBeNull();
  });
});

describe('Composer: the status line', () => {
  it.each(['typing', 'voice'] as const)('in %s, the composer has one role="status" line, which reads the status prop', (answerBy) => {
    stubSpeech();
    composerWith({ answerBy, status: 'Checking your line.' });
    expect(within(form()).getAllByRole('status')).toHaveLength(1);
    expect(statusLine().className).toBe('vh');
    expect(statusLine().textContent).toBe('Checking your line.');
  });

  it('reads "Listening." while listening, over the status prop, then the prop again', () => {
    stubSpeech();
    composerWith({ status: 'Checking your line.' });
    fireEvent.click(speakKey());
    expect(statusLine().textContent).toBe('Listening.');
    act(() => lastRecognition().finish());
    expect(statusLine().textContent).toBe('Checking your line.');
  });

  it('is empty with no status and nothing heard', () => {
    composerWith({ answerBy: 'typing' });
    expect(statusLine().textContent).toBe('');
  });
});

describe('Run screen: voice', () => {
  const voice: Partial<Progress> = { settings: { textSize: 'standard', haptics: true, answerBy: 'voice' } };
  beforeEach(() => stubSpeech());

  it("answers by Typing by default: the run's composer has no Speak key", () => {
    renderRun(fresh());
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
  });

  it("with settings.answerBy 'voice', a dictated line waits in the field, and only Send sends it", async () => {
    const store = renderRun(fresh(), voice);
    fireEvent.click(speakKey());
    act(() => lastRecognition().hear('sir can you hear me', true));
    act(() => lastRecognition().finish());
    expect(field().value).toBe('Sir can you hear me.');
    await act(async () => { await Promise.resolve(); });
    expect(runOf(store).lines).toHaveLength(1);   // nothing sent by voice
    fireEvent.click(sendKey());
    await until(store, (s) => said(s, 'Sir can you hear me.'));
  });

  it('opening the Pause sheet while listening aborts it', () => {
    renderRun(fresh(), voice);
    fireEvent.click(speakKey());
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(lastRecognition().calls).toEqual(['start', 'abort']);
  });

  it("the step list taking the composer's place aborts listening", () => {
    renderRun(fresh(), voice);
    fireEvent.click(speakKey());
    fireEvent.click(screen.getByRole('button', { name: 'Step list' }));
    expect(lastRecognition().calls).toEqual(['start', 'abort']);
  });

  it('closing the step list puts the dictated line back in the field, and focus on Speak, so the keyboard stays down', () => {
    renderRun(fresh(), voice);
    fireEvent.click(speakKey());
    act(() => { lastRecognition().hear('sir can you hear me', true); lastRecognition().finish(); });
    fireEvent.click(screen.getByRole('button', { name: 'Step list' }));
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to typing' }));
    expect(field().value).toBe('Sir can you hear me.');
    expect(document.activeElement).toBe(speakKey());
    expect(hearLine()!.textContent).toBe('Your line: Sir can you hear me.');   // still to check: no Send, no edit
    expect(statusLine().textContent).toBe('');   // and not said again
  });

  it('with Voice saved but no recogniser here, closing the step list gives the field focus, with the draft', () => {
    vi.unstubAllGlobals();
    renderRun(fresh(), voice);
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
    fireEvent.input(field(), { target: { value: 'Arm buddy, SpO2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Step list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to typing' }));
    expect(field().value).toBe('Arm buddy, SpO2');
    expect(document.activeElement).toBe(field());
  });

  it('in Typing, closing the step list still focuses the field, with the draft', () => {
    renderRun(fresh());
    fireEvent.input(field(), { target: { value: 'Arm buddy, SpO2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Step list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to typing' }));
    expect(field().value).toBe('Arm buddy, SpO2');
    expect(document.activeElement).toBe(field());
  });

  it('a Resume after the list never puts an old draft back into a field emptied since', () => {
    renderRun(fresh(), voice);
    fireEvent.input(field(), { target: { value: 'Arm buddy, SpO2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Step list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to typing' }));
    fireEvent.input(field(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(field().value).toBe('');
  });
});

// ---- The draft (Plan 3 Task 7: M4, ruling D27) -------------------------------------------------------------------

describe('Composer: the draft', () => {
  /** A composer for run `runId`'s draft, alone; unmount() takes it away, as a reload does. */
  function draftComposer(runId: string, props: Partial<ComposerProps> = {}) {
    const onSend = vi.fn((_text: string): void => {});
    const view = render(<ProgressContext.Provider value={makeStore()}>
      <Composer onSend={onSend} disabled={false} showStepList={false} onStepList={() => {}} answerBy="typing" callName="Mdm Tan"
        hold={false} draftKey={draftKeyOf(runId)} {...props} />
      <ToastHost />
    </ProgressContext.Provider>);
    return { onSend, view };
  }
  const submit = () => act(() => { field().form!.requestSubmit(); });

  it("keys each run's draft by its id in sessionStorage", () => {
    expect(draftKeyOf('r1')).toBe('crewleader.draft.r1');
  });

  it("what was typed into run r1 comes back in a new composer for r1, and not in another run's", () => {
    const first = draftComposer('r1');
    fireEvent.input(field(), { target: { value: 'Ops Ctr' } });
    expect(sessionStorage.getItem('crewleader.draft.r1')).toBe('Ops Ctr');
    first.view.unmount();
    const again = draftComposer('r1');
    expect(field().value).toBe('Ops Ctr');
    again.view.unmount();
    draftComposer('r2');
    expect(field().value).toBe('');
  });

  it('Send clears it', () => {
    const first = draftComposer('r1');
    fireEvent.input(field(), { target: { value: 'Ops Ctr' } });
    submit();
    expect(first.onSend).toHaveBeenCalledWith('Ops Ctr');
    expect(sessionStorage.getItem(draftKeyOf('r1'))).toBeNull();
    first.view.unmount();
    draftComposer('r1');
    expect(field().value).toBe('');
  });

  it('a field emptied by hand leaves no draft', () => {
    draftComposer('r1');
    fireEvent.input(field(), { target: { value: 'Ops Ctr' } });
    fireEvent.input(field(), { target: { value: '' } });
    expect(sessionStorage.getItem(draftKeyOf('r1'))).toBeNull();
  });

  it("keeps a line that didn't go through and came back into the field", async () => {
    const view = render(<ProgressContext.Provider value={makeStore()}>
      <Composer onSend={async () => false} disabled={false} showStepList={false} onStepList={() => {}} answerBy="typing"
        callName="Mdm Tan" hold={false} draftKey={draftKeyOf('r1')} />
      <ToastHost />
    </ProgressContext.Provider>);
    say(STEP1);
    await act(async () => { await Promise.resolve(); });
    expect(field().value).toBe(STEP1);
    expect(sessionStorage.getItem(draftKeyOf('r1'))).toBe(STEP1);
    view.unmount();
    draftComposer('r1');
    expect(field().value).toBe(STEP1);
  });

  it('sessionStorage.setItem throwing changes nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const { onSend } = draftComposer('r1');
    expect(() => fireEvent.input(field(), { target: { value: 'Ops Ctr' } })).not.toThrow();
    expect(setItem).toHaveBeenCalled();
    expect(field().value).toBe('Ops Ctr');
    submit();
    expect(onSend).toHaveBeenCalledWith('Ops Ctr');
    expect(field().value).toBe('');
  });

  it('sessionStorage reads and removals throwing change nothing either', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const { onSend } = draftComposer('r1');
    expect(field().value).toBe('');
    fireEvent.input(field(), { target: { value: 'Ops Ctr' } });
    submit();
    expect(onSend).toHaveBeenCalledWith('Ops Ctr');
    expect(() => clearDraft('r1')).not.toThrow();
  });

  it("clearDraft removes the run's draft, and only that run's", () => {
    sessionStorage.setItem(draftKeyOf('r1'), 'Ops Ctr');
    sessionStorage.setItem(draftKeyOf('r2'), 'Arm buddy');
    clearDraft('r1');
    expect(sessionStorage.getItem(draftKeyOf('r1'))).toBeNull();
    expect(sessionStorage.getItem(draftKeyOf('r2'))).toBe('Arm buddy');
  });

  describe('in Voice', () => {
    beforeEach(() => stubSpeech());

    it('a dictated line is saved as it goes into the field, and comes back with "Your line:" over the keys', () => {
      const first = draftComposer('r1', { answerBy: 'voice' });
      fireEvent.click(speakKey());
      act(() => { lastRecognition().hear('sir can you hear me', true); lastRecognition().finish(); });
      expect(sessionStorage.getItem(draftKeyOf('r1'))).toBe('Sir can you hear me.');
      first.view.unmount();
      draftComposer('r1', { answerBy: 'voice' });
      expect(field().value).toBe('Sir can you hear me.');
      expect(hearLine()!.textContent).toBe('Your line: Sir can you hear me.');
      expect(statusLine().textContent).toBe('');   // not said again
      fireEvent.click(sendKey());
      expect(sessionStorage.getItem(draftKeyOf('r1'))).toBeNull();
      expect(hearLine()).toBeNull();
    });

    it('a dictated line added after a typed one saves the whole field', () => {
      draftComposer('r1', { answerBy: 'voice' });
      fireEvent.input(field(), { target: { value: 'Ops Ctr, roger' } });
      fireEvent.click(speakKey());
      act(() => lastRecognition().hear('responding to blk 2xx', true));
      expect(sessionStorage.getItem(draftKeyOf('r1'))).toBe('Ops Ctr, roger. Responding to blk 2xx.');
    });
  });
});

describe('Run screen: the draft over a reload', () => {
  const voice: Partial<Progress> = { settings: { textSize: 'standard', haptics: true, answerBy: 'voice' } };

  it('in Typing, the field comes back after a reload; ending the run clears it', () => {
    const storage = new MemoryStorage();
    renderRun(fresh(), {}, storage);
    fireEvent.input(field(), { target: { value: 'Arm buddy, SpO2' } });
    cleanup();   // the page goes
    const reloaded = createProgressStore(storage);
    render(<App store={reloaded} />);
    expect(field().value).toBe('Arm buddy, SpO2');
    act(() => finishRun(reloaded, env, Date.now()));
    expect(sessionStorage.getItem(draftKeyOf(IDS.id))).toBeNull();
  });

  it('in Voice, the dictated line comes back after a reload, with "Your line:" to check it by', () => {
    stubSpeech();
    const storage = new MemoryStorage();
    renderRun(fresh(), voice, storage);
    fireEvent.click(speakKey());
    act(() => { lastRecognition().hear('sir can you hear me', true); lastRecognition().finish(); });
    cleanup();
    render(<App store={createProgressStore(storage)} />);
    expect(field().value).toBe('Sir can you hear me.');
    expect(hearLine()!.textContent).toBe('Your line: Sir can you hear me.');
  });

  it("a new run never takes another run's draft", () => {
    sessionStorage.setItem(draftKeyOf('run-other'), 'Arm buddy, SpO2');
    renderRun(fresh());
    expect(field().value).toBe('');
  });
});

// ---- Task 7 review round 1 (concern 4): a run's end clears every draft ---------------------------------------------

describe("Run screen: a run's end clears stale drafts", () => {
  it('finishRun clears every crewleader.draft.* key, left by runs replaced, restarted or discarded, and nothing else', () => {
    const store = renderRun(fresh());
    fireEvent.input(field(), { target: { value: 'Arm buddy, SpO2' } });
    sessionStorage.setItem(draftKeyOf('run-replaced'), 'Ops Ctr, say again');
    sessionStorage.setItem(draftKeyOf('run-restarted'), 'Buddy, head grip');
    sessionStorage.setItem('crewleader.other', 'kept');
    expect(sessionStorage.getItem(draftKeyOf(IDS.id))).toBe('Arm buddy, SpO2');
    act(() => finishRun(store, env, Date.now()));
    expect(store.get().runOpen).toBeNull();
    const left = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    expect(left).toEqual(['crewleader.other']);
  });

  it('ends the run all the same when sessionStorage throws', () => {
    const store = renderRun(fresh());
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    sessionStorage.setItem(draftKeyOf('run-replaced'), 'Ops Ctr, say again');
    expect(() => act(() => finishRun(store, env, Date.now()))).not.toThrow();
    expect(store.get().runOpen).toBeNull();
    expect(store.get().runs.map((r) => r.id)).toEqual([IDS.id]);
    expect(location.hash).toMatch(/^#\/debrief\//);
  });
});

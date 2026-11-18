// Task 17: the quiz session (practice, test and review), its feedback, and the result screen.
import { render, screen, fireEvent, within, act } from '@testing-library/preact';
import type { JSX } from 'preact';
import * as v from 'valibot';
import notesDoc from '../../public/data/notes.json';
import { MemoryStorage } from './helpers';
import { primeContent, resetContentCache } from '../../src/data/load';
import type { Question } from '../../src/data/questions';
import { NotesDocSchema } from '../../src/data/schema';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import type { AnswerRecord, Progress, QStat, QuizMode, QuizSession as Session } from '../../src/progress/types';
import { useRoute } from '../../src/app/routes';
import { QuizSession } from '../../src/quiz/QuizSession';
import { QuizResult } from '../../src/quiz/QuizResult';
import { Feedback } from '../../src/quiz/Feedback';
import { OptionList } from '../../src/quiz/OptionList';
import { READ_HOLD_MS, reviewKey } from '../../src/quiz/useQuiz';

const BASE = import.meta.env.BASE_URL;
const NOTES = v.parse(NotesDocSchema, notesDoc);

// ---- Fixtures ------------------------------------------------------------------------------------------------

const opts = (texts: string[]) => texts.map((text, i) => ({ id: 'abcd'[i]!, text }));
const FLOWS = ['Ten litres a minute', 'Two to four litres a minute', 'Six to eight litres a minute', 'Fifteen litres a minute'];
const MASKS = ['Nasal cannula', 'Simple face mask', 'Venturi mask', 'Non-rebreather mask'];

function question(id: string, extra: Partial<Question> = {}): Question {
  return {
    id, bank: 'mt-b', number: Number(id.slice(-3)), passage: null, stem: `Stem of ${id}`, options: opts(FLOWS),
    answer: 'b', image: null, topic: 'respiratory', explanation: `Why ${id} is what it is.`, notesRef: 's11#oxygen-masks',
    generated: true, slides: [], review: [], ...extra,
  };
}

/** Options a–d, answer b; the session shows them as A=c, B=b, C=a, D=d. */
const Q1 = question('mt-b-q901', { stem: 'What flow does a nasal cannula run at?', explanation: 'Nasal cannula runs at 2 to 4 L/min.' });
const Q2 = question('mt-b-q902', { stem: 'Which mask gives the most oxygen?', options: opts(MASKS), answer: 'd', notesRef: null });
const ORDER_1 = ['c', 'b', 'a', 'd'];

function session(mode: QuizMode, ids: string[], patch: Partial<Session> = {}): Session {
  return {
    id: 'fx', mode, filter: { group: 'all', topic: 'respiratory' }, startedAt: '2026-11-11T09:00:00.000Z',
    total: ids.length, queue: [...ids], orders: { [Q1.id]: ORDER_1 }, picked: null, checked: null, done: [], ...patch,
  };
}

const record = (q: Question, picked: string, right: boolean): AnswerRecord => ({ qid: q.id, picked, right, at: '2026-11-11T09:01:00.000Z' });
const stat = (rightSinceWrong: number | null): QStat =>
  ({ seen: 1, right: 0, lastAt: '2026-11-10T09:00:00.000Z', lastRight: rightSinceWrong !== 0, rightSinceWrong });

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  store.update((p) => ({ ...p, ...patch }));
  return store;
}

/** The two quiz screens behind the hash router, keyed by path as App keys them; any other route is a stub. */
function Screens(): JSX.Element {
  const m = useRoute();
  const Screen = m.def.name === 'quizSession' ? QuizSession : m.def.name === 'quizResult' ? QuizResult : Elsewhere;
  return <Screen key={m.path} />;
}
const Elsewhere = () => <p>Elsewhere</p>;

function open(store: ProgressStore, hash = '#/quiz/session') {
  location.hash = hash;
  return render(<ProgressContext.Provider value={store}><Screens /></ProgressContext.Provider>);
}

/** Matches the element whose whole text is `text`, not its ancestors: for text split by <b>. */
const wholeText = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

/** Ends a CSS animation on `el`, bubbling as a browser's does. jsdom has no AnimationEvent, and no onanimationend,
 *  so Preact listens for 'AnimationEnd' there; fireEvent.animationEnd would send a plain Event with no animationName. */
function animationEnd(el: Element, animationName: string): void {
  const ev = new Event('onanimationend' in el ? 'animationend' : 'AnimationEnd', { bubbles: true });
  Object.defineProperty(ev, 'animationName', { value: animationName });
  fireEvent(el, ev);
}

const group = (q: Question) => screen.getByRole('group', { name: q.stem });
const radios = (q: Question) => within(group(q)).getAllByRole('radio') as HTMLInputElement[];
const labelOf = (text: string) => screen.getByText(text).closest('label')!;
const key = (name: string | RegExp) => screen.getByRole('button', { name });
const verdictText = () => screen.queryByText(/^(Wrong|Right):/);

const servedFiles: Record<string, unknown> = { [`${BASE}data/notes.json`]: notesDoc };
const fileFetch = () => vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  return url in servedFiles ? new Response(JSON.stringify(servedFiles[url]), { status: 200 }) : new Response('Not found', { status: 404 });
});
const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });

/** Lets a hold run out: the feedback's after Check, or the result keys' after the result shows. Only
 *  performance.now() is faked (beforeEach), so content loads, waitFor and the skeleton's timers stay real. */
const afterReading = () => { vi.advanceTimersByTime(READ_HOLD_MS + 50); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] });
  resetContentCache();
  vi.stubGlobal('fetch', fileFetch());
  primeContent('questions', [Q1, Q2]);
  primeContent('notes', NOTES);
  document.documentElement.scrollTop = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetContentCache();
});

// ---- The session ---------------------------------------------------------------------------------------------

describe('practice session', () => {
  it('shows the header, the bank line, and the stem as the legend of 4 radios lettered A–D in session order', () => {
    open(makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Practice' })).toBeTruthy();
    expect(screen.getByText('Respiratory, both banks')).toBeTruthy();
    expect(screen.getByText(wholeText('1 of 2'))).toBeTruthy();
    expect(screen.getByText('Medical and trauma, part B, question 901')).toBeTruthy();

    const g = group(Q1);
    expect(g.tagName).toBe('FIELDSET');
    const rs = radios(Q1);
    expect(rs).toHaveLength(4);
    expect(rs.map((r) => r.value)).toEqual(ORDER_1);
    expect(rs.map((r) => r.closest('label')?.textContent)).toEqual([
      'A Six to eight litres a minute', 'B Two to four litres a minute', 'C Ten litres a minute', 'D Fifteen litres a minute',
    ]);
    expect(rs.every((r) => !r.checked)).toBe(true);
    expect((key('Check') as HTMLButtonElement).disabled).toBe(true);
  });

  it('picks with a radio, and arrow keys move between options without checking', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    const [a, b] = radios(Q1) as [HTMLInputElement, HTMLInputElement];
    fireEvent.click(a);
    expect(store.get().quizOpen?.picked).toBe('c');
    expect(a.checked).toBe(true);
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    fireEvent.click(b);   // what the browser does on ArrowDown: it checks the next radio
    fireEvent.keyUp(b, { key: 'ArrowDown' });
    expect(store.get().quizOpen?.picked).toBe('b');
    expect(store.get().quizOpen?.checked).toBeNull();
    expect(store.get().quizOpen?.done).toEqual([]);
    expect(verdictText()).toBeNull();
    expect((key('Check') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a wrong pick: the verdict in letters, Answer and Yours on the options, the explanation and the notes link', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    fireEvent.click(radios(Q1)[2]!);   // C, which is option a
    fireEvent.click(key('Check'));

    expect(screen.getByText('Wrong: you picked C. The answer is B.')).toBeTruthy();
    expect(labelOf('Two to four litres a minute').textContent).toContain('Answer');
    expect(labelOf('Ten litres a minute').textContent).toContain('Yours');
    expect(labelOf('Ten litres a minute').textContent).not.toContain('Answer');
    expect(labelOf('Six to eight litres a minute').textContent).not.toMatch(/Answer|Yours/);
    expect(labelOf('Two to four litres a minute').className).toContain('opt-ok');
    expect(labelOf('Ten litres a minute').className).toContain('opt-bad');
    expect(screen.getByText('Nasal cannula runs at 2 to 4 L/min.')).toBeTruthy();

    const link = screen.getByRole('link', { name: /^Notes 11/ });
    expect(link.getAttribute('href')).toBe('#/notes/s11/oxygen-masks');
    expect(link.textContent).toBe('Notes 11, Oxygen Masks');

    // graded, saved and applied to the stats; the header still counts this question
    const s = store.get();
    expect(s.quizOpen?.checked).toEqual(expect.objectContaining({ qid: Q1.id, picked: 'a', right: false }));
    expect(s.quizOpen?.done).toHaveLength(1);
    expect(s.questions[Q1.id]).toEqual(expect.objectContaining({ seen: 1, right: 0, lastRight: false, rightSinceWrong: 0 }));
    expect(screen.getByText(wholeText('1 of 2'))).toBeTruthy();
    expect(screen.getByText(wholeText('0 of 1 right'))).toBeTruthy();
    expect(radios(Q1).every((r) => r.disabled)).toBe(true);
    expect(key('Next question')).toBeTruthy();
  });

  it('a right pick: "Right: B is the answer.", with Answer on it and no Yours', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    fireEvent.click(radios(Q1)[1]!);
    fireEvent.click(key('Check'));
    expect(screen.getByText('Right: B is the answer.')).toBeTruthy();
    expect(labelOf('Two to four litres a minute').textContent).toContain('Answer');
    expect(screen.queryByText('Yours')).toBeNull();
    expect(store.get().questions[Q1.id]).toEqual(expect.objectContaining({ seen: 1, right: 1, rightSinceWrong: null }));
    expect(screen.getByText(wholeText('1 of 1 right'))).toBeTruthy();
  });

  it('grades an option that reads the same as the answer as right, naming the letter picked', () => {
    const twin = question('mt-b-q969', { options: opts(['Spinal and dextrose', 'Spinal and splints', 'Spinal and splints', 'Spinal and oxygen']) });
    primeContent('questions', [twin]);
    open(makeStore({ quizOpen: { ...session('practice', [twin.id]), orders: { [twin.id]: ['a', 'b', 'c', 'd'] } } }));
    fireEvent.click(radios(twin)[2]!);   // C, option c, the same text as the answer b
    fireEvent.click(key('Check'));
    expect(screen.getByText('Right: C is the answer.')).toBeTruthy();
    const [, b, c] = radios(twin).map((r) => r.closest('label')!);
    expect(b?.textContent).toContain('Answer');
    expect(c?.textContent).toContain('Answer');
    expect(screen.queryByText('Yours')).toBeNull();
  });

  it('a wrong pick marks every option that reads the same as the answer as Answer', () => {
    const twin = question('mt-b-q969', { options: opts(['Spinal and dextrose', 'Spinal and splints', 'Spinal and splints', 'Spinal and oxygen']) });
    primeContent('questions', [twin]);
    open(makeStore({ quizOpen: { ...session('practice', [twin.id]), orders: { [twin.id]: ['a', 'b', 'c', 'd'] } } }));
    fireEvent.click(radios(twin)[3]!);   // D, wrong
    fireEvent.click(key('Check'));
    const [a, b, c, d] = radios(twin).map((r) => r.closest('label')!);
    expect(b?.textContent).toContain('Answer');
    expect(c?.textContent).toContain('Answer');
    expect(c?.className).toContain('opt-ok');
    expect(d?.textContent).toContain('Yours');
    expect(a?.textContent).not.toMatch(/Answer|Yours/);
  });

  it('labels the notes link "Notes 11" when the notes have not loaded', async () => {
    resetContentCache();
    primeContent('questions', [Q1, Q2]);
    vi.stubGlobal('fetch', offlineFetch());
    open(makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) }));
    fireEvent.click(radios(Q1)[2]!);
    fireEvent.click(key('Check'));
    await act(async () => { await Promise.resolve(); });
    const link = screen.getByRole('link', { name: /^Notes 11/ });
    expect(link.textContent).toBe('Notes 11');
    expect(link.getAttribute('href')).toBe('#/notes/s11/oxygen-masks');
  });

  it('shows no notes link for a question without a notesRef', () => {
    open(makeStore({ quizOpen: { ...session('practice', [Q2.id]), orders: {} } }));
    fireEvent.click(radios(Q2)[0]!);
    fireEvent.click(key('Check'));
    expect(verdictText()).not.toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('Review Focus 1: a double Check applies the answer once', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    fireEvent.click(radios(Q1)[2]!);
    const check = key('Check');
    // Two clicks before Preact re-renders: both land on Check, and the second finds it already checked in the store.
    check.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    check.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    expect(store.get().questions[Q1.id]?.seen).toBe(1);
    expect(store.get().quizOpen?.done).toHaveLength(1);
  });

  describe('the feedback holds for 400 ms after Check', () => {
    it('a second tap 100 ms after Check does nothing; one at 450 ms moves on', () => {
      const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
      open(store);
      fireEvent.click(radios(Q1)[2]!);
      const check = key('Check');
      fireEvent.click(check, { detail: 1 });
      vi.advanceTimersByTime(100);
      fireEvent.click(check, { detail: 1 });   // the same key, now Next question; iOS reports a double tap's taps as detail 1
      expect(check.textContent).toBe('Next question');
      expect(screen.getByText('Wrong: you picked C. The answer is B.')).toBeTruthy();
      expect(store.get().quizOpen?.queue[0]).toBe(Q1.id);
      expect(store.get().questions[Q1.id]?.seen).toBe(1);
      expect(store.get().quizOpen?.done).toHaveLength(1);

      vi.advanceTimersByTime(350);   // 450 ms after Check
      fireEvent.click(check, { detail: 1 });
      expect(store.get().quizOpen?.queue).toEqual([Q2.id]);
      expect(group(Q2)).toBeTruthy();
    });

    it('holds See results too, and keyboard activation (Enter or Space: a click with detail 0) works after 400 ms', () => {
      const store = makeStore({ quizOpen: session('practice', [Q1.id]) });
      open(store);
      fireEvent.click(radios(Q1)[1]!);
      fireEvent.click(key('Check'));
      const see = key('See results');
      vi.advanceTimersByTime(100);
      fireEvent.click(see, { detail: 0 });
      expect(location.hash).toBe('#/quiz/session');
      expect(store.get().quizLast).toBeNull();
      vi.advanceTimersByTime(299);   // 399 ms
      fireEvent.click(see, { detail: 0 });
      expect(location.hash).toBe('#/quiz/session');
      vi.advanceTimersByTime(1);     // 400 ms
      fireEvent.click(see, { detail: 0 });
      expect(location.hash).toBe('#/quiz/result');
      expect(store.get().quizLast?.done).toHaveLength(1);
    });

    it('does not hold a question resumed already checked, which has no Check to time from', () => {
      const r = record(Q1, 'a', false);
      const store = makeStore({ quizOpen: { ...session('practice', [Q1.id, Q2.id]), picked: 'a', checked: r, done: [r] } });
      open(store);
      fireEvent.click(key('Next question'));
      expect(store.get().quizOpen?.queue).toEqual([Q2.id]);
    });
  });

  it('Next question shows the next one: counted, unpicked, shuffled, at the top, with focus on its first option', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    fireEvent.click(radios(Q1)[2]!);
    fireEvent.click(key('Check'));
    document.documentElement.scrollTop = 300;
    afterReading();   // past the hold after Check
    fireEvent.click(key('Next question'));

    expect(screen.getByText(wholeText('2 of 2'))).toBeTruthy();
    const rs = radios(Q2);
    expect(rs).toHaveLength(4);
    expect([...(store.get().quizOpen?.orders[Q2.id] ?? [])].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(rs.map((r) => r.value)).toEqual(store.get().quizOpen?.orders[Q2.id]);
    expect(rs.every((r) => !r.checked && !r.disabled)).toBe(true);
    expect(verdictText()).toBeNull();
    expect((key('Check') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(wholeText('0 of 1 right'))).toBeTruthy();
    expect(document.activeElement).toBe(rs[0]);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it('shows no score before the first answer', () => {
    const { container } = open(makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) }));
    expect(container.querySelector('.score')).toBeNull();
    expect(screen.queryByText(/right$/)).toBeNull();
  });

  it('See results on the last question finishes: quizLast set, quizOpen cleared, the result screen', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    fireEvent.click(radios(Q1)[1]!);   // B, right
    fireEvent.click(key('Check'));
    afterReading();   // past the hold after Check
    fireEvent.click(key('Next question'));
    fireEvent.click(within(group(Q2)).getByText('Simple face mask'));   // wrong
    fireEvent.click(key('Check'));
    afterReading();   // past the hold after Check
    fireEvent.click(key('See results'));

    expect(location.hash).toBe('#/quiz/result');
    const s = store.get();
    expect(s.quizOpen).toBeNull();
    expect(s.quizLast?.done.map((r) => [r.qid, r.right])).toEqual([[Q1.id, true], [Q2.id, false]]);
    expect(s.quizLast?.queue).toEqual([]);
    expect(screen.getByText(wholeText('1 of 2 right'))).toBeTruthy();
  });

  it('marks a wrong answer with the shake class once, and never a right one', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    const { container } = open(store);
    fireEvent.click(radios(Q1)[2]!);
    fireEvent.click(key('Check'));
    const wrap = container.querySelector('.qopts')!;
    expect(wrap.classList.contains('shake')).toBe(true);
    animationEnd(labelOf('Two to four litres a minute'), 'ring-in');   // the answer's ring, drawn at the same time
    expect(wrap.classList.contains('shake')).toBe(true);
    animationEnd(labelOf('Ten litres a minute'), 'opt-shake');
    expect(wrap.classList.contains('shake')).toBe(false);

    afterReading();   // past the hold after Check
    fireEvent.click(key('Next question'));
    fireEvent.click(within(group(Q2)).getByText('Non-rebreather mask'));
    fireEvent.click(key('Check'));
    expect(container.querySelector('.qopts')?.classList.contains('shake')).toBe(false);
  });

  describe('haptics', () => {
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

    it('buzzes wrong or right on Check, and not at all with haptics off', () => {
      const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
      open(store);
      fireEvent.click(radios(Q1)[2]!);
      fireEvent.click(key('Check'));
      expect(vibrate).toHaveBeenLastCalledWith([24, 60, 24]);
      afterReading();   // past the hold after Check
      fireEvent.click(key('Next question'));
      fireEvent.click(within(group(Q2)).getByText('Non-rebreather mask'));
      fireEvent.click(key('Check'));
      expect(vibrate).toHaveBeenLastCalledWith(16);
    });

    it('stays still with haptics off', () => {
      const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
      store.update((p) => ({ ...p, settings: { ...p.settings, haptics: false } }));
      open(store);
      fireEvent.click(radios(Q1)[2]!);
      fireEvent.click(key('Check'));
      expect(vibrate).not.toHaveBeenCalled();
    });

    it('gives only a tap in a test, which reveals nothing', () => {
      open(makeStore({ quizOpen: session('test', [Q1.id, Q2.id]) }));
      fireEvent.click(radios(Q1)[2]!);
      fireEvent.click(key('Next'));
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(vibrate).toHaveBeenLastCalledWith(8);
    });
  });
});

describe('test session', () => {
  it('grades on Next without revealing anything, then finishes to the result', () => {
    const store = makeStore({ quizOpen: session('test', [Q1.id, Q2.id]) });
    const { container } = open(store);
    expect(screen.getByRole('heading', { level: 1, name: 'Test' })).toBeTruthy();
    const nextKey = key('Next') as HTMLButtonElement;
    expect(nextKey.disabled).toBe(true);
    expect(container.querySelectorAll('.primary')).toHaveLength(1);
    expect(screen.queryByText(/right$/)).toBeNull();

    fireEvent.click(radios(Q1)[2]!);   // wrong
    fireEvent.click(key('Next'));
    expect(verdictText()).toBeNull();
    expect(screen.queryByText('Answer')).toBeNull();
    expect(screen.queryByText('Yours')).toBeNull();
    expect(container.querySelector('.opt-ok, .opt-bad')).toBeNull();
    expect(screen.getByText(wholeText('2 of 2'))).toBeTruthy();
    // check ran before next: the answer is on done and in the stats
    expect(store.get().quizOpen?.done).toEqual([expect.objectContaining({ qid: Q1.id, picked: 'a', right: false })]);
    expect(store.get().quizOpen?.checked).toBeNull();
    expect(store.get().questions[Q1.id]?.seen).toBe(1);

    fireEvent.click(within(group(Q2)).getByText('Non-rebreather mask'));   // right
    fireEvent.click(key('Finish test'));
    expect(verdictText()).toBeNull();
    expect(location.hash).toBe('#/quiz/result');
    expect(screen.getByText(wholeText('1 of 2 right'))).toBeTruthy();
    expect(store.get().quizLast?.done.map((r) => r.right)).toEqual([false, true]);
    expect(store.get().quizOpen).toBeNull();
  });

  it('a double Next applies one answer and never skips the next question', () => {
    const store = makeStore({ quizOpen: session('test', [Q1.id, Q2.id]) });
    open(store);
    fireEvent.click(radios(Q1)[2]!);
    const nextKey = key('Next');
    nextKey.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    nextKey.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.get().quizOpen?.done).toHaveLength(1);
    expect(store.get().quizOpen?.queue).toEqual([Q2.id]);
    expect(store.get().questions[Q1.id]?.seen).toBe(1);
  });
});

describe('review session', () => {
  it('counts what is left, not the re-queued copy before Next', () => {
    const store = makeStore({ quizOpen: session('review', [Q1.id, Q2.id]), questions: { [Q1.id]: stat(0), [Q2.id]: stat(1) } });
    open(store);
    expect(screen.getByRole('heading', { level: 1, name: 'Review wrong' })).toBeTruthy();
    expect(screen.getByText(wholeText('2 left'))).toBeTruthy();
    fireEvent.click(radios(Q1)[2]!);   // wrong, so it goes back on the queue
    fireEvent.click(key('Check'));
    expect(store.get().quizOpen?.queue).toEqual([Q1.id, Q2.id, Q1.id]);
    expect(screen.getByText(wholeText('2 left'))).toBeTruthy();
    expect(key('Next question')).toBeTruthy();
    afterReading();   // past the hold after Check
    fireEvent.click(key('Next question'));
    expect(screen.getByText(wholeText('2 left'))).toBeTruthy();
    expect(group(Q2)).toBeTruthy();
  });

  it('runs until each is right twice, then shows Cleared on the result', () => {
    const store = makeStore({ quizOpen: session('review', [Q1.id]), questions: { [Q1.id]: stat(0) } });
    open(store);
    const answerRight = () => {
      fireEvent.click(labelOf('Two to four litres a minute'));
      fireEvent.click(key('Check'));
    };
    answerRight();
    expect(screen.getByText('Right: B is the answer.')).toBeTruthy();
    afterReading();   // past the hold after Check
    fireEvent.click(key('Next question'));   // shown again, since it is right once
    answerRight();
    afterReading();   // past the hold after Check
    fireEvent.click(key('See results'));
    expect(location.hash).toBe('#/quiz/result');
    expect(store.get().questions[Q1.id]?.rightSinceWrong).toBe(2);
    expect(screen.getByText(wholeText('Cleared 1 of 1'))).toBeTruthy();
  });
});

describe('session body', () => {
  it('shows a passage in a panel, and an image from the base URL', () => {
    const q = question('mt-b-q197', { passage: 'A worker fell from the third floor.', image: 'img/q/mt-b-q197.png' });
    primeContent('questions', [q]);
    open(makeStore({ quizOpen: { ...session('practice', [q.id]), orders: {} } }));
    expect(screen.getByText('A worker fell from the third floor.').closest('.panel')).not.toBeNull();
    const img = screen.getByRole('img', { name: 'ECG strip for this question' });
    expect(img.getAttribute('src')).toBe(`${BASE}img/q/mt-b-q197.png`);
  });

  it('shows the Under review note until Dismiss, which saves the id with a short hash of its reasons', () => {
    const q = question('mt-b-q969', { review: ['Two options have the same text.', 'Check it against the PDF.'] });
    primeContent('questions', [q, Q1]);
    const store = makeStore({ quizOpen: { ...session('practice', [q.id, Q1.id]), orders: {} } });
    open(store);
    expect(screen.getByText('Under review: Two options have the same text. Check it against the PDF.')).toBeTruthy();
    fireEvent.click(key('Dismiss'));
    expect(store.get().dismissedReview).toEqual([reviewKey(q)]);
    expect(reviewKey(q)).toMatch(/^mt-b-q969#[0-9a-f]{8}$/);
    expect(screen.queryByText(/^Under review/)).toBeNull();
    expect(document.activeElement).toBe(radios(q)[0]);
  });

  it('hides the note for a question dismissed with the same reasons, and shows none for a question with no reasons', () => {
    const q = question('mt-b-q969', { review: ['Two options have the same text.'] });
    primeContent('questions', [q, Q1]);
    open(makeStore({ quizOpen: { ...session('practice', [q.id, Q1.id]), orders: {} }, dismissedReview: [reviewKey(q)] }));
    expect(screen.queryByText(/^Under review/)).toBeNull();
  });

  it('shows the note again once a new reason joins the ones dismissed (a re-import changed the question)', () => {
    const before = question('mt-b-q969', { review: ['Two options have the same text.'] });
    const after = { ...before, review: [...before.review, 'The source question changed since this explanation was written.'] };
    expect(reviewKey(after)).not.toBe(reviewKey(before));
    primeContent('questions', [after, Q1]);
    open(makeStore({ quizOpen: { ...session('practice', [after.id, Q1.id]), orders: {} }, dismissedReview: [reviewKey(before)] }));
    expect(screen.getByText(/^Under review: Two options have the same text\. The source question changed/)).toBeTruthy();
  });

  it('still honours a dismissal saved as the plain id, before reasons were keyed', () => {
    const q = question('mt-b-q969', { review: ['Two options have the same text.'] });
    primeContent('questions', [q, Q1]);
    const store = makeStore({ quizOpen: { ...session('practice', [q.id, Q1.id]), orders: {} }, dismissedReview: [q.id] });
    open(store);
    expect(screen.queryByText(/^Under review/)).toBeNull();
    expect(store.get().dismissedReview).toEqual([q.id]);
  });

  it('Close goes to the Quiz tab and leaves the quiz open', () => {
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    fireEvent.click(radios(Q1)[2]!);
    fireEvent.click(key('Close'));
    expect(location.hash).toBe('#/quiz');
    expect(store.get().quizOpen?.picked).toBe('a');
    expect(store.get().quizOpen?.queue).toEqual([Q1.id, Q2.id]);
  });
});

describe('session load', () => {
  it('resumes the saved session against the bank and saves it: gone ids dropped, a picked option kept', () => {
    const store = makeStore({ quizOpen: { ...session('practice', ['mt-b-q999', Q1.id, Q2.id]), queue: [Q1.id, 'mt-b-q999', Q2.id], picked: 'a' } });
    open(store);
    const s = store.get().quizOpen;
    expect(s?.queue).toEqual([Q1.id, Q2.id]);
    expect(s?.total).toBe(2);
    expect(screen.getByText(wholeText('1 of 2'))).toBeTruthy();
    expect(radios(Q1)[2]?.checked).toBe(true);
  });

  it('saves nothing on resume when the bank changed nothing', () => {
    const store = makeStore({ quizOpen: { ...session('practice', [Q1.id, Q2.id]), picked: 'a' } });
    const before = store.get().quizOpen;
    const saves = vi.fn();
    store.subscribe(saves);
    open(store);
    expect(group(Q1)).toBeTruthy();
    expect(store.get().quizOpen).toBe(before);
    expect(saves).not.toHaveBeenCalled();
  });

  it('a checked question stays checked on resume, with its feedback', () => {
    const r = record(Q1, 'a', false);
    open(makeStore({ quizOpen: { ...session('practice', [Q1.id, Q2.id]), picked: 'a', checked: r, done: [r] } }));
    expect(screen.getByText('Wrong: you picked C. The answer is B.')).toBeTruthy();
    expect(screen.getByText(wholeText('1 of 2'))).toBeTruthy();
    expect(key('Next question')).toBeTruthy();
  });

  it('clears the quiz and goes to the Quiz tab when nothing of it is left to ask', () => {
    const store = makeStore({ quizOpen: session('practice', ['mt-b-q998', 'mt-b-q999']) });
    open(store);
    expect(store.get().quizOpen).toBeNull();
    expect(location.hash).toBe('#/quiz');
  });

  it('goes to the Quiz tab when no quiz is open', () => {
    open(makeStore());
    expect(location.hash).toBe('#/quiz');
  });

  it('leaves for the Quiz tab when its quiz goes while it is up, rather than draw a dead screen', () => {
    // Say Try again on the corrupt banner adopted a save with no quiz in it, after this screen had resumed one.
    const store = makeStore({ quizOpen: session('practice', [Q1.id, Q2.id]) });
    open(store);
    expect(group(Q1)).toBeTruthy();
    act(() => store.update((p) => ({ ...p, quizOpen: null })));
    expect(location.hash).toBe('#/quiz');
    expect(screen.getByText('Elsewhere')).toBeTruthy();
  });

  it('waits for the bank before resuming, and shows the load error with Try again', async () => {
    resetContentCache();
    vi.stubGlobal('fetch', offlineFetch());
    const quiz = session('practice', [Q1.id, Q2.id]);
    const store = makeStore({ quizOpen: quiz });
    open(store);
    expect(await screen.findByText("The question bank didn't load. It isn't saved on this phone yet. Connect once, then try again.")).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Practice' })).toBeTruthy();
    expect(key('Try again')).toBeTruthy();
    expect(store.get().quizOpen).toEqual(quiz);
    expect(location.hash).toBe('#/quiz/session');
  });
});

// ---- Pieces --------------------------------------------------------------------------------------------------

describe('Feedback', () => {
  it('names a pick missing from a rebuilt order by its text, never by a letter', () => {
    render(<Feedback q={Q1} order={['b', 'c', 'd']} record={record(Q1, 'a', false)} notes={null} />);
    expect(screen.getByText('Wrong: you picked “Ten litres a minute”. The answer is A.')).toBeTruthy();
  });

  it('says so when the pick is no longer an option at all', () => {
    render(<Feedback q={Q1} order={['a', 'b', 'c', 'd']} record={record(Q1, 'z', false)} notes={null} />);
    expect(screen.getByText('Wrong: you picked an answer that has since changed. The answer is B.')).toBeTruthy();
  });

  it('names the course sources the explanation was checked against', () => {
    const q = question('mt-b-q903', { slides: ['MED 805', 'EMS Drugs'] });
    render(<Feedback q={q} order={['a', 'b', 'c', 'd']} record={record(q, 'b', true)} notes={null} />);
    expect(screen.getByText('Source: MED 805, EMS Drugs')).toBeTruthy();
  });

  it('claims no source when the explanation was not found in the course material', () => {
    render(<Feedback q={Q1} order={['a', 'b', 'c', 'd']} record={record(Q1, 'b', true)} notes={null} />);
    expect(screen.queryByText(/^Source:/)).toBeNull();
  });
});

describe('OptionList', () => {
  it('reveals nothing when reveal is off, even once checked', () => {
    const { container } = render(
      <OptionList q={Q1} order={ORDER_1} picked="a" checked={record(Q1, 'a', false)} reveal={false} onPick={() => {}} />,
    );
    expect(container.querySelector('.opt-ok, .opt-bad')).toBeNull();
    expect(screen.queryByText('Answer')).toBeNull();
  });
});

// ---- The result ----------------------------------------------------------------------------------------------

describe('result screen', () => {
  const finished = (mode: QuizMode, done: AnswerRecord[], patch: Partial<Session> = {}): Session =>
    ({ ...session(mode, [Q1.id, Q2.id]), queue: [], done, ...patch });

  it('scores a practice: each question with a chip, wrong rows with Yours, Answer and the explanation as text', () => {
    const store = makeStore({ quizLast: finished('practice', [record(Q1, 'a', false), record(Q2, 'd', true)]) });
    const { container } = open(store, '#/quiz/result');
    expect(screen.getByRole('heading', { level: 1, name: 'Practice results' })).toBeTruthy();
    expect(screen.getByText(wholeText('1 of 2 right'))).toBeTruthy();

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const [wrong, right] = rows as [HTMLElement, HTMLElement];
    expect(within(wrong).getByText('Wrong')).toBeTruthy();
    expect(wrong.querySelector('.tag-hi')?.textContent).toBe('!!!Wrong');
    expect(within(wrong).getByText(Q1.stem)).toBeTruthy();
    expect(within(wrong).getByText('Ten litres a minute')).toBeTruthy();            // Yours, as text
    expect(within(wrong).getByText('Two to four litres a minute')).toBeTruthy();    // Answer, as text
    expect(within(wrong).getByText('Yours')).toBeTruthy();
    expect(within(wrong).getByText('Answer')).toBeTruthy();
    expect(within(wrong).getByText('Nasal cannula runs at 2 to 4 L/min.')).toBeTruthy();
    // The explanation's notes link, as Feedback shows it (I3): a Test shows no feedback, so this is its only way in.
    const link = within(wrong).getByRole('link', { name: 'Notes 11, Oxygen Masks' });
    expect(link.getAttribute('href')).toBe('#/notes/s11/oxygen-masks');

    expect(right.querySelector('.tag-ok')?.textContent).toBe('✓Right');
    expect(within(right).queryByText('Yours')).toBeNull();
    expect(within(right).queryByRole('link')).toBeNull();

    expect([...container.querySelectorAll('.primary')].map((k) => k.textContent)).toEqual(['Practise 20 more']);
    expect(key('Done').className).toBe('btn2');
  });

  it('a wrong row names the course sources under its explanation', () => {
    const cited = { ...Q1, slides: ['MED 301'] };
    primeContent('questions', [cited, Q2]);
    const store = makeStore({ quizLast: finished('practice', [record(cited, 'a', false), record(Q2, 'd', true)]) });
    open(store, '#/quiz/result');
    const [wrong] = screen.getAllByRole('listitem') as [HTMLElement, HTMLElement];
    expect(within(wrong).getByText('Source: MED 301')).toBeTruthy();
  });

  it('Practise 20 more starts a practice over the same bank and topic', () => {
    const many = Array.from({ length: 25 }, (_, i) => question(`mt-b-q${String(100 + i)}`));
    primeContent('questions', [Q1, Q2, ...many]);
    const store = makeStore({ quizLast: finished('practice', [record(Q1, 'a', false), record(Q2, 'd', true)]) });
    open(store, '#/quiz/result');
    afterReading();   // past the result's hold
    fireEvent.click(key('Practise 20 more'));
    const s = store.get().quizOpen;
    expect(s?.mode).toBe('practice');
    expect(s?.queue).toHaveLength(20);
    expect(s?.filter).toEqual({ group: 'all', topic: 'respiratory' });
    expect(location.hash).toBe('#/quiz/session');
  });

  it('a test offers New test, over the same filter', () => {
    const store = makeStore({ quizLast: finished('test', [record(Q1, 'b', true), record(Q2, 'a', false)]) });
    const { container } = open(store, '#/quiz/result');
    expect(screen.getByRole('heading', { level: 1, name: 'Test results' })).toBeTruthy();
    expect([...container.querySelectorAll('.primary')].map((k) => k.textContent)).toEqual(['New test']);
    afterReading();   // past the result's hold
    fireEvent.click(key('New test'));
    expect(store.get().quizOpen?.mode).toBe('test');
    expect(store.get().quizOpen?.filter).toEqual({ group: 'all', topic: 'respiratory' });
    expect(location.hash).toBe('#/quiz/session');
  });

  it('a review reads Cleared c of total, one row per distinct question with its last answer', () => {
    const done = [record(Q1, 'a', false), record(Q2, 'd', true), record(Q1, 'b', true), record(Q1, 'b', true)];
    const store = makeStore({
      quizLast: finished('review', done),
      questions: { [Q1.id]: { ...stat(2), seen: 3 }, [Q2.id]: stat(1) },
    });
    open(store, '#/quiz/result');
    expect(screen.getByRole('heading', { level: 1, name: 'Review results' })).toBeTruthy();
    expect(screen.getByText(wholeText('Cleared 1 of 2'))).toBeTruthy();
    expect(screen.queryByText(/ right$/)).toBeNull();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(Q1.stem)).toBeTruthy();
    expect(within(rows[0]!).getByText('Right')).toBeTruthy();   // its last answer
    expect(within(rows[1]!).getByText(Q2.stem)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Practise 20 more' }).className).toBe('primary');
  });

  it('Done and Close go to the Quiz tab', () => {
    const store = makeStore({ quizLast: finished('practice', [record(Q1, 'b', true), record(Q2, 'd', true)]) });
    const { unmount } = open(store, '#/quiz/result');
    afterReading();   // past the result's hold; Close, in the header, has none
    fireEvent.click(key('Done'));
    expect(location.hash).toBe('#/quiz');
    unmount();
    open(store, '#/quiz/result');
    fireEvent.click(key('Close'));
    expect(location.hash).toBe('#/quiz');
    expect(store.get().quizLast).not.toBeNull();
  });

  it('goes to the Quiz tab when there is no result', () => {
    open(makeStore(), '#/quiz/result');
    expect(location.hash).toBe('#/quiz');
  });

  it('leaves for the Quiz tab when its result goes while it is up', () => {
    const store = makeStore({ quizLast: finished('practice', [record(Q1, 'b', true)]) });
    open(store, '#/quiz/result');
    expect(screen.getByRole('heading', { level: 1, name: 'Practice results' })).toBeTruthy();
    act(() => store.update((p) => ({ ...p, quizLast: null })));
    expect(location.hash).toBe('#/quiz');
  });

  describe('holds its keys for 400 ms after it shows', () => {
    // The result takes the session's place in the same render: See results sits where Practise 20 more lands, and
    // Finish test spans New test and Done. The second tap of a double tap must not leave the result unseen.
    it('after See results: Practise 20 more and Done do nothing at 100 ms, and focus stays; Practise 20 more works at 450 ms', () => {
      const store = makeStore({ quizOpen: session('practice', [Q1.id]) });
      open(store);
      fireEvent.click(radios(Q1)[1]!);
      fireEvent.click(key('Check'));
      afterReading();
      fireEvent.click(key('See results'));
      expect(location.hash).toBe('#/quiz/result');
      const last = store.get().quizLast;

      vi.advanceTimersByTime(100);
      const more = key('Practise 20 more');
      more.focus();
      fireEvent.click(more);
      fireEvent.click(key('Done'));
      expect(location.hash).toBe('#/quiz/result');
      expect(store.get().quizOpen).toBeNull();
      expect(store.get().quizLast).toBe(last);
      expect(document.activeElement).toBe(more);
      expect(screen.getByText(wholeText('1 of 1 right'))).toBeTruthy();

      vi.advanceTimersByTime(350);   // 450 ms after the result showed
      fireEvent.click(more);
      expect(store.get().quizOpen?.mode).toBe('practice');
      expect(location.hash).toBe('#/quiz/session');
    });

    it('after Finish test: New test does nothing at 100 ms and starts a test at 450 ms; Done then works too', () => {
      const store = makeStore({ quizOpen: session('test', [Q1.id]) });
      const { unmount } = open(store);
      fireEvent.click(radios(Q1)[2]!);
      fireEvent.click(key('Finish test'));
      expect(location.hash).toBe('#/quiz/result');

      vi.advanceTimersByTime(100);
      fireEvent.click(key('New test'));
      expect(store.get().quizOpen).toBeNull();
      expect(location.hash).toBe('#/quiz/result');

      vi.advanceTimersByTime(350);
      fireEvent.click(key('New test'));
      expect(store.get().quizOpen?.mode).toBe('test');
      expect(location.hash).toBe('#/quiz/session');
      unmount();

      open(store, '#/quiz/result');
      vi.advanceTimersByTime(450);
      fireEvent.click(key('Done'));
      expect(location.hash).toBe('#/quiz');
    });
  });
});

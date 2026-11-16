// Task 16: the Quiz tab (mode cards, review states, bank progress, an open quiz) and the practice/test setup.
import { render, screen, fireEvent, act, within } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import * as v from 'valibot';
import questionsDoc from '../../public/data/questions.json';
import overridesDoc from '../../public/data/overrides.json';
import { MemoryStorage } from './helpers';
import { contentErrorCopy, primeContent, resetContentCache } from '../../src/data/load';
import { mergeQuestions, type Question } from '../../src/data/questions';
import { OverridesDocSchema, RawQuestionsDocSchema } from '../../src/data/schema';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import type { Progress, QStat, QuizFilter, QuizMode, QuizSession } from '../../src/progress/types';
import { matchRoute } from '../../src/app/routes';
import { startSession } from '../../src/quiz/engine';
import { mulberry32 } from '../../src/lib/rng';
import { QuizTab, ReplacesNote } from '../../src/quiz/QuizTab';
import { QuizSetup } from '../../src/quiz/QuizSetup';
import { BankProgress } from '../../src/quiz/BankProgress';
import { filterLabel, resumeLine, reviewLeft, startQuiz } from '../../src/quiz/useQuiz';

const REAL: Question[] = mergeQuestions(v.parse(RawQuestionsDocSchema, questionsDoc), v.parse(OverridesDocSchema, overridesDoc));
const BY_ID = new Map(REAL.map((q) => [q.id, q]));
const MT_IDS = REAL.filter((q) => q.bank !== 'hmls').map((q) => q.id);
const ALL: QuizFilter = { group: 'all', topic: 'all' };
const QUESTIONS_ERROR = "The question bank didn't load. It isn't saved on this phone yet. Connect once, then try again.";

const BASE = import.meta.env.BASE_URL;
const FILES: Record<string, unknown> = { [`${BASE}data/questions.json`]: questionsDoc, [`${BASE}data/overrides.json`]: overridesDoc };
const fileFetch = () => vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  return url in FILES ? new Response(JSON.stringify(FILES[url]), { status: 200 }) : new Response('Not found', { status: 404 });
});
const offlineFetch = () => vi.fn(async (_input: RequestInfo | URL): Promise<Response> => { throw new TypeError('Failed to fetch'); });
const pendingFetch = () => vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}));

/** A stat that has been answered once: `rightSinceWrong` 0 or 1 is in review, 2 is cleared, null was never wrong. */
const stat = (rightSinceWrong: number | null): QStat =>
  ({ seen: 1, right: rightSinceWrong === 0 ? 0 : 1, lastAt: '2026-11-09T10:00:00.000Z', lastRight: rightSinceWrong !== 0, rightSinceWrong });
const statsFor = (ids: string[], rsw: number | null) => Object.fromEntries(ids.map((id) => [id, stat(rsw)]));

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

function renderIn(store: ProgressStore, ui: ComponentChildren) {
  return render(<ProgressContext.Provider value={store}>{ui}</ProgressContext.Provider>);
}

const setupMatch = (mode: string) => matchRoute(`#/quiz/setup?mode=${mode}`);

/** Matches the element whose whole text is `text`, not its ancestors: for text split by <b> or a hidden span. */
const wholeText = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((c) => c.textContent !== text);

/** A session over `ids` with `answered` of them done; `checked` leaves the last answer on screen, before Next. */
function practiceAfter(ids: string[], answered: number, { checked = false, mode = 'practice' as QuizMode } = {}): QuizSession {
  const s = startSession(mode, ids, ALL, BY_ID, mulberry32(1), new Date('2026-11-10T09:00:00Z'));
  const done = ids.slice(0, answered).map((qid) => ({ qid, picked: 'a', right: true, at: '2026-11-10T09:01:00.000Z' }));
  const queue = ids.slice(checked ? answered - 1 : answered);
  return { ...s, queue, done, checked: checked ? done[done.length - 1]! : null, picked: checked ? 'a' : null };
}

beforeEach(() => {
  resetContentCache();
  primeContent('questions', REAL);
  location.hash = '#/quiz';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetContentCache();
});

describe('ReplacesNote', () => {
  it('says the one line every start key that replaces an open quiz points at, with its id and class', () => {
    const { container } = render(<><ReplacesNote id="n1" /><ReplacesNote id="n2" class="setup-note" /></>);
    const [a, b] = [...container.querySelectorAll('p')];
    expect(a?.outerHTML).toBe('<p class="mode-replace" id="n1">This replaces your open quiz.</p>');
    expect(b?.outerHTML).toBe('<p class="setup-note" id="n2">This replaces your open quiz.</p>');
  });
});

describe('Quiz tab', () => {
  it('has the Theory quiz heading and the three mode cards, Practice and Test opening their setup', () => {
    renderIn(makeStore(), <QuizTab />);
    expect(screen.getByRole('heading', { level: 1, name: 'Theory quiz' })).toBeTruthy();
    const practice = screen.getByRole('link', { name: 'Practice' });
    expect(practice.getAttribute('href')).toBe('#/quiz/setup?mode=practice');
    expect(practice.closest('h2')).not.toBeNull();
    expect(document.getElementById(practice.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Pick a bank and topic. See the answer straight away.');
    const test = screen.getByRole('link', { name: 'Test' });
    expect(test.getAttribute('href')).toBe('#/quiz/setup?mode=test');
    expect(document.getElementById(test.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('20 or 50 questions. Score at the end.');
    expect(screen.getByRole('heading', { level: 2, name: 'Review wrong' })).toBeTruthy();
    expect(screen.getByText('Questions you got wrong, until you get each right twice.')).toBeTruthy();
  });

  describe('review states', () => {
    it('with no stats shows the Review empty copy, and Start practice starts 20 from both banks', () => {
      const store = makeStore();
      renderIn(store, <QuizTab />);
      expect(screen.getByText('Nothing to review yet. Questions you get wrong will collect here.')).toBeTruthy();
      const start = screen.getByRole('button', { name: 'Start practice' });
      expect(start.className).toBe('primary');
      fireEvent.click(start);
      const open = store.get().quizOpen;
      expect(open?.mode).toBe('practice');
      expect(open?.queue).toHaveLength(20);
      expect(open?.filter).toEqual(ALL);
      expect(location.hash).toBe('#/quiz/session');
    });

    it('with 12 cleared shows the Review cleared copy, and Practise 20 more starts practice over both banks', () => {
      const store = makeStore({ questions: statsFor(MT_IDS.slice(0, 12), 2) });
      renderIn(store, <QuizTab />);
      expect(screen.getByText('All 12 cleared. New mistakes will show up here.')).toBeTruthy();
      expect(screen.queryByText(/Nothing to review yet/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Practise 20 more' }));
      const open = store.get().quizOpen;
      expect(open?.mode).toBe('practice');
      expect(open?.queue).toHaveLength(20);
      expect(open?.filter).toEqual({ group: 'all', topic: 'all' });
      expect(location.hash).toBe('#/quiz/session');
    });

    it('with 3 wrong offers Review 3 you got wrong, which opens a review of those 3', () => {
      const wrong = MT_IDS.slice(5, 8);
      const store = makeStore({ questions: { ...statsFor(wrong, 0), ...statsFor(MT_IDS.slice(0, 4), 2) } });
      renderIn(store, <QuizTab />);
      expect(screen.queryByText(/cleared\. New mistakes/)).toBeNull();
      const review = screen.getByRole('button', { name: 'Review 3 you got wrong' });
      expect(review.className).toBe('primary');
      fireEvent.click(review);
      const open = store.get().quizOpen;
      expect(open?.mode).toBe('review');
      expect(open?.queue).toHaveLength(3);
      expect([...(open?.queue ?? [])].sort()).toEqual([...wrong].sort());
      expect(location.hash).toBe('#/quiz/session');
    });

    it('reads the stats from the store when clicked, not from the last render', () => {
      const store = makeStore({ questions: statsFor(MT_IDS.slice(0, 2), 0) });
      renderIn(store, <QuizTab />);
      const review = screen.getByRole('button', { name: 'Review 2 you got wrong' });
      // Outside act, Preact defers the re-render for this write, so the click lands on the old render.
      store.update((p) => ({ ...p, questions: { ...p.questions, [MT_IDS[2]!]: stat(1) } }));
      expect(review.textContent).toBe('Review 2 you got wrong');
      fireEvent.click(review);
      expect(store.get().quizOpen?.queue).toHaveLength(3);
    });
  });

  describe('bank progress', () => {
    it('shows each bank with its answered count over the real merged data, and a track', () => {
      const { container } = renderIn(makeStore(), <QuizTab />);
      expect(screen.getByText('Medical and trauma')).toBeTruthy();
      expect(screen.getByText(wholeText('0 of 346 answered'))).toBeTruthy();
      expect(screen.getByText('HMLS')).toBeTruthy();
      expect(screen.getByText(wholeText('0 of 61 answered'))).toBeTruthy();   // " answered" is for screen readers only
      expect(container.querySelectorAll('.track')).toHaveLength(2);
    });

    it('counts a question once it has been answered, and fills its track', () => {
      const answered = [...MT_IDS.slice(0, 96), 'hmls-q001', 'hmls-q002'];
      const { container } = renderIn(makeStore({ questions: statsFor(answered, null) }), <QuizTab />);
      expect(screen.getByText(wholeText('96 of 346 answered'))).toBeTruthy();
      expect(screen.getByText(wholeText('2 of 61 answered'))).toBeTruthy();
      const fills = [...container.querySelectorAll<HTMLElement>('.track i')].map((i) => i.style.width);
      expect(fills).toEqual([`${(96 / 346) * 100}%`, `${(2 / 61) * 100}%`]);
    });
  });

  describe('content states', () => {
    it('shows the §7 copy and Try again when the bank fails to load, and Try again loads it', async () => {
      resetContentCache();
      vi.stubGlobal('fetch', offlineFetch());
      renderIn(makeStore(), <QuizTab />);
      expect(await screen.findByText(QUESTIONS_ERROR)).toBeTruthy();
      expect(contentErrorCopy('questions')).toBe(QUESTIONS_ERROR);
      expect(screen.getByRole('heading', { level: 1, name: 'Theory quiz' })).toBeTruthy();

      vi.stubGlobal('fetch', fileFetch());
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText(wholeText('0 of 346 answered'))).toBeTruthy();
      expect(screen.queryByText(QUESTIONS_ERROR)).toBeNull();
    });

    it('shows nothing for the first 300 ms of a load, then a skeleton', () => {
      vi.useFakeTimers();
      resetContentCache();
      vi.stubGlobal('fetch', pendingFetch());
      renderIn(makeStore(), <QuizTab />);
      expect(screen.getByRole('heading', { level: 1, name: 'Theory quiz' })).toBeTruthy();
      expect(screen.queryByRole('progressbar')).toBeNull();
      act(() => { vi.advanceTimersByTime(299); });
      expect(screen.queryByRole('progressbar')).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByRole('progressbar')).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Practice' })).toBeNull();
    });
  });

  describe('an open quiz', () => {
    const ids = MT_IDS.slice(0, 20);

    it('shows a resume panel first, with Resume as the one primary key', () => {
      const store = makeStore({ quizOpen: practiceAfter(ids, 2), questions: statsFor(MT_IDS.slice(30, 33), 0) });
      const { container } = renderIn(store, <QuizTab />);
      expect(screen.getByText('Quiz in progress: All topics, both banks, question 3 of 20.')).toBeTruthy();
      const resume = screen.getByRole('link', { name: 'Resume' });
      expect(resume.getAttribute('href')).toBe('#/quiz/session');
      expect([...container.querySelectorAll('.primary')]).toEqual([resume]);
      expect(screen.getByRole('button', { name: 'Review 3 you got wrong' }).className).toBe('btn2');
      // the resume panel comes before the mode cards
      const panel = screen.getByText(/^Quiz in progress/);
      const practice = screen.getByRole('link', { name: 'Practice' });
      expect(panel.compareDocumentPosition(practice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('counts a checked question as the one showing, before Next', () => {
      renderIn(makeStore({ quizOpen: practiceAfter(ids, 3, { checked: true }) }), <QuizTab />);
      expect(screen.getByText('Quiz in progress: All topics, both banks, question 3 of 20.')).toBeTruthy();
    });

    it('says how many are left in review, not counting the re-queued copy before Next', () => {
      const [a, b, c] = MT_IDS as [string, string, string];
      const base = startSession('review', [a, b, c], ALL, BY_ID, mulberry32(1), new Date('2026-11-10T09:00:00Z'));
      const record = { qid: a, picked: 'a', right: false, at: '2026-11-10T09:01:00.000Z' };
      const checked: QuizSession = { ...base, queue: [a, b, c, a], done: [record], checked: record, picked: 'a' };
      renderIn(makeStore({ quizOpen: checked }), <QuizTab />);
      expect(screen.getByText('Quiz in progress: All topics, both banks, 3 left.')).toBeTruthy();
    });

    it('warns on the review card that its key replaces the open quiz, tied to the key', () => {
      const store = makeStore({ quizOpen: practiceAfter(ids, 2), questions: statsFor(MT_IDS.slice(30, 33), 0) });
      renderIn(store, <QuizTab />);
      const key = screen.getByRole('button', { name: 'Review 3 you got wrong' });
      const note = screen.getByText('This replaces your open quiz.');
      expect(note.id).not.toBe('');
      expect(key.getAttribute('aria-describedby')?.split(' ')).toContain(note.id);
    });

    it('warns on the empty and cleared review keys too', () => {
      const { unmount } = renderIn(makeStore({ quizOpen: practiceAfter(ids, 2) }), <QuizTab />);
      const start = screen.getByRole('button', { name: 'Start practice' });
      expect(start.getAttribute('aria-describedby')).toBe(screen.getByText('This replaces your open quiz.').id);
      unmount();
      renderIn(makeStore({ quizOpen: practiceAfter(ids, 2), questions: statsFor(MT_IDS.slice(30, 42), 2) }), <QuizTab />);
      const more = screen.getByRole('button', { name: 'Practise 20 more' });
      expect(more.getAttribute('aria-describedby')).toBe(screen.getByText('This replaces your open quiz.').id);
    });

    it('hides the panel when none of the open quiz is left to ask', () => {
      const gone: QuizSession = { ...practiceAfter(ids, 0), queue: ['mt-a-q999'] };
      renderIn(makeStore({ quizOpen: gone }), <QuizTab />);
      expect(screen.queryByText(/^Quiz in progress/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Start practice' }).className).toBe('primary');
    });
  });

  it('has no replace note on the review card without an open quiz', () => {
    renderIn(makeStore({ questions: statsFor(MT_IDS.slice(30, 33), 0) }), <QuizTab />);
    expect(screen.queryByText('This replaces your open quiz.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review 3 you got wrong' }).hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('Quiz setup', () => {
  it('practice: HMLS plus All topics starts 20 HMLS questions', () => {
    const store = makeStore();
    renderIn(store, <QuizSetup match={setupMatch('practice')} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Practice' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Bank' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Length' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'HMLS' }));
    fireEvent.click(screen.getByRole('button', { name: /^All topics/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    const open = store.get().quizOpen;
    expect(open?.mode).toBe('practice');
    expect(open?.queue).toHaveLength(20);
    expect(open?.queue.every((id) => id.startsWith('hmls-'))).toBe(true);
    expect(open?.filter).toEqual({ group: 'hmls', topic: 'all' });
    expect(location.hash).toBe('#/quiz/session');
  });

  it('test: 50 selected gives a test of 50', () => {
    const store = makeStore();
    renderIn(store, <QuizSetup match={setupMatch('test')} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Test' })).toBeTruthy();
    const length = screen.getByRole('group', { name: 'Length' });
    expect((within(length).getByRole('radio', { name: '20 questions' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(length).getByRole('radio', { name: '50 questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start test' }));
    const open = store.get().quizOpen;
    expect(open?.mode).toBe('test');
    expect(open?.total).toBe(50);
    expect(open?.queue).toHaveLength(50);
  });

  it('shows topic chips with counts for the chosen bank, one pressed, and a topic gone from the bank resets to All topics', () => {
    renderIn(makeStore(), <QuizSetup match={setupMatch('practice')} />);
    const topics = screen.getByRole('group', { name: 'Topic' });
    const chips = within(topics).getAllByRole('button');
    expect(chips[0]?.textContent).toBe('All topics 407');
    expect(chips.map((c) => c.textContent)).toContain('Respiratory 34');
    expect(chips.map((c) => c.textContent)).toContain('HMLS 61');
    expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'true')).toEqual([chips[0]]);

    fireEvent.click(within(topics).getByRole('button', { name: /^Respiratory/ }));
    expect(within(topics).getByRole('button', { name: /^Respiratory/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(topics).getByRole('button', { name: /^All topics/ }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('radio', { name: 'HMLS' }));
    const hmlsChips = within(screen.getByRole('group', { name: 'Topic' })).getAllByRole('button');
    expect(hmlsChips.map((c) => c.textContent)).toEqual(['All topics 61', 'HMLS 61']);
    expect(hmlsChips[0]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('starts a topic in one bank, labelled for the session', () => {
    const store = makeStore();
    renderIn(store, <QuizSetup match={setupMatch('practice')} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Medical and trauma' }));
    fireEvent.click(screen.getByRole('button', { name: /^Burns/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    const open = store.get().quizOpen;
    expect(open?.filter).toEqual({ group: 'mt', topic: 'burns' });
    expect(open?.queue).toHaveLength(14);   // the bank has 14 burns questions, fewer than 20
    expect(open?.queue.every((id) => BY_ID.get(id)?.topic === 'burns')).toBe(true);
  });

  it('disables Start with a reason when nothing matches, and starts no session', () => {
    primeContent('questions', REAL.filter((q) => q.bank !== 'hmls'));
    const store = makeStore();
    renderIn(store, <QuizSetup match={setupMatch('practice')} />);
    fireEvent.click(screen.getByRole('radio', { name: 'HMLS' }));
    const start = screen.getByRole('button', { name: 'Start practice' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    const reason = screen.getByText('No questions match. Pick another bank or topic.');
    expect(start.getAttribute('aria-describedby')).toBe(reason.id);
    fireEvent.click(start);
    expect(store.get().quizOpen).toBeNull();
    expect(location.hash).toBe('#/quiz');
  });

  it('warns that starting replaces an open quiz, in Start’s description', () => {
    const { unmount } = renderIn(makeStore(), <QuizSetup match={setupMatch('practice')} />);
    expect(screen.queryByText('This replaces your open quiz.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start practice' }).hasAttribute('aria-describedby')).toBe(false);
    unmount();
    renderIn(makeStore({ quizOpen: practiceAfter(MT_IDS.slice(0, 20), 2) }), <QuizSetup match={setupMatch('test')} />);
    const note = screen.getByText('This replaces your open quiz.');
    expect(note.id).not.toBe('');
    expect(screen.getByRole('button', { name: 'Start test' }).getAttribute('aria-describedby')?.split(' ')).toContain(note.id);
  });

  it('says when fewer questions match than the test length, in Start’s description', () => {
    renderIn(makeStore(), <QuizSetup match={setupMatch('test')} />);
    expect(screen.queryByText(/^Only \d+ questions? match/)).toBeNull();   // 407 match, more than 20

    fireEvent.click(screen.getByRole('radio', { name: 'Medical and trauma' }));
    fireEvent.click(screen.getByRole('button', { name: /^Burns/ }));
    const start = screen.getByRole('button', { name: 'Start test' });
    const short = screen.getByText('Only 14 questions match, so the test has 14.');
    expect(start.getAttribute('aria-describedby')?.split(' ')).toContain(short.id);

    fireEvent.click(screen.getByRole('button', { name: /^Respiratory/ }));
    expect(screen.queryByText(/^Only \d+ questions? match/)).toBeNull();   // 34 match, more than 20
    fireEvent.click(screen.getByRole('radio', { name: '50 questions' }));
    expect(screen.getByText('Only 34 questions match, so the test has 34.')).toBeTruthy();
  });

  it('says it once for a single matching question', () => {
    const oneBurns = REAL.find((q) => q.topic === 'burns');
    primeContent('questions', REAL.filter((q) => q.topic !== 'burns' || q === oneBurns));
    renderIn(makeStore(), <QuizSetup match={setupMatch('test')} />);
    fireEvent.click(screen.getByRole('button', { name: /^Burns/ }));
    expect(screen.getByText('Only 1 question matches, so the test has 1.')).toBeTruthy();
  });

  it('never says it in practice', () => {
    renderIn(makeStore(), <QuizSetup match={setupMatch('practice')} />);
    fireEvent.click(screen.getByRole('button', { name: /^Burns/ }));
    expect(screen.queryByText(/^Only \d+ questions? match/)).toBeNull();
  });

  it('groups the topic chips in a fieldset with a legend, like Bank and Length', () => {
    renderIn(makeStore(), <QuizSetup match={setupMatch('test')} />);
    for (const name of ['Bank', 'Topic', 'Length']) {
      const group = screen.getByRole('group', { name });
      expect(group.tagName).toBe('FIELDSET');
      expect(group.querySelector(':scope > legend')?.textContent).toBe(name);
    }
    expect(screen.queryByRole('heading', { name: 'Topic' })).toBeNull();
  });

  it('treats a missing or unknown mode as practice', () => {
    renderIn(makeStore(), <QuizSetup match={matchRoute('#/quiz/setup?mode=nope')} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Practice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start practice' })).toBeTruthy();
  });

  it('shows the §7 copy and Try again when the bank fails to load', async () => {
    resetContentCache();
    vi.stubGlobal('fetch', offlineFetch());
    renderIn(makeStore(), <QuizSetup match={setupMatch('practice')} />);
    expect(await screen.findByText(QUESTIONS_ERROR)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start practice' })).toBeNull();
  });
});

describe('startQuiz', () => {
  it('practises every id a filter names (a notes section), not 20', () => {
    const store = makeStore();
    const ids = MT_IDS.slice(40, 65);
    expect(startQuiz(store, REAL, 'practice', { group: 'all', topic: 'all', ids })).toBe(true);
    const open = store.get().quizOpen;
    expect(open?.queue).toHaveLength(25);
    expect([...(open?.queue ?? [])].sort()).toEqual([...ids].sort());
    expect(open?.filter.ids).toEqual(ids);
  });

  it('never starts an empty session', () => {
    const store = makeStore();
    location.hash = '#/quiz/setup';
    expect(startQuiz(store, REAL, 'practice', { group: 'hmls', topic: 'respiratory' })).toBe(false);
    expect(startQuiz(store, REAL, 'review', ALL)).toBe(false);
    expect(startQuiz(store, REAL, 'test', { group: 'all', topic: 'all', ids: [] }, 20)).toBe(false);
    expect(store.get().quizOpen).toBeNull();
    expect(location.hash).toBe('#/quiz/setup');
  });

  it('defaults a test to 20, and review keeps to its filter', () => {
    const store = makeStore({ questions: { ...statsFor(['hmls-q001', 'hmls-q002'], 0), ...statsFor(MT_IDS.slice(0, 3), 1) } });
    startQuiz(store, REAL, 'test', ALL);
    expect(store.get().quizOpen?.total).toBe(20);
    startQuiz(store, REAL, 'review', { group: 'hmls', topic: 'all' });
    expect([...(store.get().quizOpen?.queue ?? [])].sort()).toEqual(['hmls-q001', 'hmls-q002']);
  });
});

describe('filterLabel', () => {
  it('names the topic and the bank, or the notes', () => {
    expect(filterLabel({ group: 'all', topic: 'respiratory' })).toBe('Respiratory, both banks');
    expect(filterLabel({ group: 'hmls', topic: 'all' })).toBe('All topics, HMLS');
    expect(filterLabel({ group: 'mt', topic: 'all' })).toBe('All topics, Medical and trauma');
    expect(filterLabel({ group: 'mt', topic: 'ops' })).toBe('Ops and conduct, Medical and trauma');
    expect(filterLabel({ group: 'all', topic: 'all' })).toBe('All topics, both banks');
    expect(filterLabel({ group: 'all', topic: 'all', ids: ['mt-a-q001'] })).toBe('From your notes');
  });

  it('says HMLS once when the topic is the bank', () => {
    expect(filterLabel({ group: 'hmls', topic: 'hmls' })).toBe('HMLS');
  });
});

describe('resumeLine and reviewLeft', () => {
  it('counts an unchecked review question and drops to the next on a cleared answer', () => {
    const [a, b, c] = MT_IDS as [string, string, string];
    const s = startSession('review', [a, b, c], ALL, BY_ID, mulberry32(1), new Date('2026-11-10T09:00:00Z'));
    expect(reviewLeft(s)).toBe(3);
    const record = { qid: a, picked: 'b', right: true, at: '2026-11-10T09:01:00.000Z' };
    expect(reviewLeft({ ...s, done: [record], checked: record })).toBe(3);   // cleared, still showing
    expect(reviewLeft({ ...s, queue: [b, c], done: [record] })).toBe(2);
    expect(resumeLine({ ...s, queue: [b, c], done: [record] })).toBe('Quiz in progress: All topics, both banks, 2 left.');
  });

  it('numbers a test question like practice', () => {
    const s = practiceAfter(MT_IDS.slice(0, 20), 0, { mode: 'test' });
    expect(resumeLine({ ...s, filter: { group: 'hmls', topic: 'all' } })).toBe('Quiz in progress: All topics, HMLS, question 1 of 20.');
  });
});

describe('BankProgress', () => {
  it('renders its title, the rows with answered on the first only (and for screen readers on the rest), and an aside', () => {
    const { container } = render(
      <BankProgress title="Theory quiz" aside={<a href="#/quiz">Review 2</a>} rows={[
        { group: 'mt', label: 'Medical and trauma', answered: 0, total: 0 },
        { group: 'hmls', label: 'HMLS', answered: 12, total: 61 },
      ]} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Theory quiz' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review 2' })).toBeTruthy();
    expect(screen.getByText(wholeText('0 of 0 answered'))).toBeTruthy();
    const hidden = screen.getByText(wholeText('12 of 61 answered')).querySelector('.vh');
    expect(hidden?.textContent).toBe(' answered');
    const fills = [...container.querySelectorAll<HTMLElement>('.track i')].map((i) => i.style.width);
    expect(fills).toEqual(['0%', `${(12 / 61) * 100}%`]);
    for (const t of container.querySelectorAll('.track')) expect(t.getAttribute('aria-hidden')).toBe('true');
  });
});

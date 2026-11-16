// Task 20: Settings (#/settings): text size, haptics, the offline line and reset progress; and offlineReady().
import { render, screen, fireEvent, act, waitFor } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { MemoryStorage } from './helpers';
import { resetContentCache } from '../../src/data/load';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, persistOnce, type ProgressStore } from '../../src/progress/store';
import type { Progress, QuizSession } from '../../src/progress/types';
import { App } from '../../src/app/App';
import { back } from '../../src/app/routes';
import { watchInstall } from '../../src/lib/install';
import { offlineReady } from '../../src/lib/offline';
import { ToastHost, clearToasts } from '../../src/ui/toast';
import { SMART_NOT_SAVED, Settings } from '../../src/settings/Settings';
import { testKey, type KeyCheck } from '../../src/smart/claude';
import { DEFAULT_SMART, SMART_STORAGE_KEY, readSmart, type SmartSettings } from '../../src/smart/settings';

// The browser's answer to navigator.storage.persist(), as index.ts kept it at start-up: each test says which.
vi.mock('../../src/progress/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/progress/store')>();
  return { ...actual, persistOnce: vi.fn(async () => false) };
});

// back() steps through real history; a spy says where Back goes.
vi.mock('../../src/app/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/routes')>();
  return { ...actual, back: vi.fn() };
});

// Test key's answer, as each test sets it: the SDK never runs under jsdom, and no test calls the network (D20).
vi.mock('../../src/smart/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/smart/claude')>();
  return { ...actual, testKey: vi.fn(async () => 'ok' as const) };
});

const NOT_OFFLINE = 'Not saved for offline use yet. Open the app once with a connection.';

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

function renderIn(store: ProgressStore, ui: ComponentChildren = <Settings />) {
  return render(<ProgressContext.Provider value={store}>{ui}<ToastHost /></ProgressContext.Provider>);
}

const confirmInput = () => screen.getByLabelText('Type RESET to confirm') as HTMLInputElement;
const resetKey = () => screen.getByRole('button', { name: 'Reset progress' }) as HTMLButtonElement;
const type = (text: string) => fireEvent.input(confirmInput(), { target: { value: text } });

/** Gives jsdom a navigator.serviceWorker for one test. */
function withServiceWorker(controller: object | null): () => void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller, addEventListener: () => {}, removeEventListener: () => {} },
  });
  return () => { delete (navigator as { serviceWorker?: unknown }).serviceWorker; };
}

beforeEach(() => {
  clearToasts();
  resetContentCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
  vi.mocked(back).mockClear();
  location.hash = '#/settings';
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToasts();
  resetContentCache();
  delete document.documentElement.dataset.textSize;
});

describe('Settings', () => {
  it('has a Settings heading and a Back key that goes back to Today', () => {
    renderIn(makeStore());
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalledWith('/');
  });

  it('has no primary key', () => {
    renderIn(makeStore());
    expect(document.querySelector('.primary')).toBeNull();
  });
});

describe('Settings: text size', () => {
  it('is a radio group of Standard, Large and Larger, with the setting checked', () => {
    renderIn(makeStore({ settings: { textSize: 'large', haptics: true, answerBy: 'typing' } }));
    const group = screen.getByRole('group', { name: 'Text size' });
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual(['Standard', 'Large', 'Larger']);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
  });

  it('applies Larger to the page at once and saves it', () => {
    const store = makeStore();
    render(<App store={store} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Larger' }));
    expect(document.documentElement.dataset.textSize).toBe('larger');
    expect(store.get().settings.textSize).toBe('larger');
    expect((screen.getByRole('radio', { name: 'Larger' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('Settings: haptics', () => {
  it('is a switch, "Vibrate on answers", described as Android only', () => {
    renderIn(makeStore());
    const sw = screen.getByRole('switch', { name: 'Vibrate on answers' });
    expect(sw.tagName.toLowerCase()).toBe('button');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById(sw.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Android only');
  });

  it('flips settings.haptics each press', () => {
    const store = makeStore();
    renderIn(store);
    const sw = screen.getByRole('switch', { name: 'Vibrate on answers' });
    fireEvent.click(sw);
    expect(store.get().settings.haptics).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(store.get().settings.haptics).toBe(true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Settings: offline', () => {
  it('shows the version and build date', () => {
    renderIn(makeStore());
    expect(screen.getByText(/^Version 0\.1\.0, built \d{4}-\d{2}-\d{2}\.$/)).toBeTruthy();
  });

  it('says it is not saved for offline use with no service worker in control', () => {
    renderIn(makeStore());
    expect(screen.getByText(NOT_OFFLINE)).toBeTruthy();
    expect(screen.queryByText('Saved for offline use.')).toBeNull();
  });

  it('says it is saved once a service worker controls the page', () => {
    const restore = withServiceWorker({});
    try {
      renderIn(makeStore());
      expect(screen.getByText('Saved for offline use.')).toBeTruthy();
      expect(screen.queryByText(NOT_OFFLINE)).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('offlineReady', () => {
  const nav = (sw: unknown) => ({ serviceWorker: sw }) as unknown as Navigator;

  it('is true only with a controlling service worker', () => {
    expect(offlineReady(nav({ controller: {} }))).toBe(true);
    expect(offlineReady(nav({ controller: null }))).toBe(false);
    expect(offlineReady(nav(undefined))).toBe(false);
  });

  it('is false where reaching the service worker throws', () => {
    const throwing = Object.defineProperty({}, 'serviceWorker', { get() { throw new Error('SecurityError'); } }) as Navigator;
    expect(offlineReady(throwing)).toBe(false);
  });

  it('reads the real navigator by default', () => {
    expect(offlineReady()).toBe(false);   // jsdom has no service worker
  });
});

// Task 19 (user ruling, 2026-11-13: Android Chrome): the Install group, from Chrome's beforeinstallprompt as
// watchInstall() keeps it.
describe('Settings: install', () => {
  const AVAILABLE = 'Install EMTNotes to open it full screen from your home screen.';
  const INSTALLED = 'Installed on this phone.';
  const UNAVAILABLE =
    "Chrome hasn't offered to install yet. Use its menu: Install app. If it says Open in app, EMTNotes is already installed.";
  const installKey = () => screen.queryByRole('button', { name: 'Install app' });
  /** Chrome offers to install: its beforeinstallprompt, with the trainee's answer to the prompt. */
  const offer = (outcome: 'accepted' | 'dismissed') => {
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome, platform: 'web' }),
    });
    act(() => { window.dispatchEvent(e); });
    return e;
  };
  let stop: () => void = () => {};

  beforeEach(() => { stop = watchInstall(window); });
  afterEach(() => { stop(); });

  it('sits between Offline and Storage', () => {
    renderIn(makeStore());
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups).toEqual(['Haptics', 'Offline', 'Install', 'Storage', 'Smart tester', 'Reset progress']);
  });

  it("says where Chrome's own install is until Chrome offers, with no key", () => {
    renderIn(makeStore());
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    expect(installKey()).toBeNull();
  });

  it('offers Install app once Chrome has, and says it is installing once the trainee accepts', async () => {
    renderIn(makeStore());
    const e = offer('accepted');
    expect(screen.getByText(AVAILABLE)).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(installKey()?.className).toBe('btn2');   // a Secondary: Settings has no primary key
    fireEvent.click(installKey()!);
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Installing EMTNotes.')).toBeTruthy();
    expect(screen.getByText(INSTALLED)).toBeTruthy();
    expect(installKey()).toBeNull();
    expect(document.activeElement).toBe(screen.getByText(INSTALLED));   // a tap that never focused the key
  });

  it("moves focus from the gone key to the group's line once the prompt closes, not to <body>", async () => {
    renderIn(makeStore());
    offer('dismissed');
    installKey()!.focus();
    fireEvent.click(installKey()!);
    await waitFor(() => expect(installKey()).toBeNull());
    expect(document.activeElement).toBe(screen.getByText(UNAVAILABLE));
    expect(screen.getByText(UNAVAILABLE).getAttribute('tabindex')).toBe('-1');
  });

  it('leaves focus alone when it was elsewhere as the key goes', () => {
    renderIn(makeStore());
    offer('accepted');
    const backKey = screen.getByRole('button', { name: 'Back' });
    backKey.focus();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });   // installed from Chrome's menu, no tap here
    expect(document.activeElement).toBe(backKey);
  });

  it('says nothing more when the trainee turns the prompt down, and the used offer goes', async () => {
    renderIn(makeStore());
    offer('dismissed');
    fireEvent.click(installKey()!);
    await waitFor(() => expect(installKey()).toBeNull());
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText('Installing EMTNotes.')).toBeNull();
  });

  it('says it is installed, with no key, once Chrome has installed it', () => {
    renderIn(makeStore());
    offer('accepted');
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.getByText(INSTALLED)).toBeTruthy();
    expect(screen.queryByText(AVAILABLE)).toBeNull();
    expect(installKey()).toBeNull();
  });
});

describe('Settings: storage', () => {
  const KEPT = 'Your progress is kept, even when the phone runs low on space.';
  const NOT_KEPT = 'The phone may clear your progress when it runs low on space. Installing the app usually stops that.';

  it('says progress is kept when the browser granted persistent storage', async () => {
    vi.mocked(persistOnce).mockResolvedValueOnce(true);
    renderIn(makeStore());
    expect(screen.getByRole('heading', { level: 2, name: 'Storage' })).toBeTruthy();
    expect(await screen.findByText(KEPT)).toBeTruthy();
    expect(screen.queryByText(NOT_KEPT)).toBeNull();
  });

  it('says the phone may clear it, and what helps, when the browser refused or has no persistent storage', async () => {
    vi.mocked(persistOnce).mockResolvedValueOnce(false);
    renderIn(makeStore());
    expect(await screen.findByText(NOT_KEPT)).toBeTruthy();
    expect(screen.queryByText(KEPT)).toBeNull();
  });
});

describe('Settings: reset progress', () => {
  const open: QuizSession = { id: 'q', mode: 'practice', filter: { group: 'all', topic: 'all' }, startedAt: '2026-11-11T09:00:00.000Z',
    total: 1, queue: ['mt-a-q001'], orders: {}, picked: null, checked: null, done: [] };
  const used = (): Partial<Progress> => ({
    questions: { 'mt-a-q001': { seen: 2, right: 1, lastAt: '2026-11-10T09:00:00.000Z', lastRight: false, rightSinceWrong: 0 } },
    notes: { lastSection: 's07', read: ['s01', 's07'] },
    quizOpen: open,
    settings: { textSize: 'larger', haptics: false, answerBy: 'typing' },
    flags: { offlineToastShown: true },
  });

  it('says what it clears and what stays, as the description of both the field and the key', () => {
    renderIn(makeStore());
    const what = screen.getByText('Clears quiz history, reading place and runs on this phone. Your settings stay.');
    expect(what.id).not.toBe('');
    expect(confirmInput().getAttribute('aria-describedby')).toBe(what.id);
    expect(resetKey().getAttribute('aria-describedby')).toBe(what.id);
  });

  // spellcheck is checked in tests/e2e/today.spec.ts: jsdom has no spellcheck property, so Preact drops a false one
  // here, where a browser sets el.spellcheck = false.
  it('takes the confirmation in capitals, with no autocomplete', () => {
    renderIn(makeStore());
    const input = confirmInput();
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });

  it('is enabled only once RESET is typed, in any case and with spaces around it', () => {
    renderIn(makeStore());
    expect(resetKey().disabled).toBe(true);
    type('rese');
    expect(resetKey().disabled).toBe(true);
    type('RESETS');
    expect(resetKey().disabled).toBe(true);
    // The brief also lists "reset " as disabled, but its own rule, value.trim().toUpperCase() === 'RESET', accepts it.
    type('reset ');
    expect(resetKey().disabled).toBe(false);
    type('RESET');
    expect(resetKey().disabled).toBe(false);
  });

  it('clears progress, keeps settings and flags, says so and empties the field', () => {
    const store = makeStore(used());
    renderIn(store);
    type('RESET');
    fireEvent.click(resetKey());
    const p = store.get();
    expect(p.questions).toEqual({});
    expect(p.notes).toEqual({ lastSection: null, read: [] });
    expect(p.quizOpen).toBeNull();
    expect(p.settings).toEqual({ textSize: 'larger', haptics: false, answerBy: 'typing' });
    expect(p.flags).toEqual({ offlineToastShown: true });
    expect(screen.getByText('Progress reset.')).toBeTruthy();
    expect(confirmInput().value).toBe('');
    expect(resetKey().disabled).toBe(true);
  });

  it.each([
    ['another window saved', () => {
      const s = new MemoryStorage();
      const store = createProgressStore(s);
      createProgressStore(s).update((p) => ({ ...p, dismissedReview: ['q'] }));   // the other window saves first
      return store;
    }],
    ['no slot could be read', () => createProgressStore(new MemoryStorage({ 'crewleader.save.0': 'garbage {' }))],
    ['storage is out of reach', () => createProgressStore(null)],
    ['the save fails', () => {
      const s = new MemoryStorage();
      const store = createProgressStore(s);
      s.failWrites = true;
      return store;
    }],
  ])("doesn't say Progress reset. when %s: it says the reset wasn't saved", (_, make) => {
    const store = make();
    store.update((p) => ({ ...p, ...used() }));
    renderIn(store);
    type('RESET');
    fireEvent.click(resetKey());
    expect(store.get().questions).toEqual({});   // memory is reset all the same
    expect(screen.queryByText('Progress reset.')).toBeNull();
    expect(screen.getByText('Progress reset in this window, but not saved.')).toBeTruthy();
  });

  it('keeps focus in the reset section once its key is disabled', () => {
    renderIn(makeStore(used()));
    type('RESET');
    resetKey().focus();
    fireEvent.click(resetKey());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Reset progress' }));
  });
});

// ---- Plan 3 Task 9: the smart tester (D13, D16, D18) ---------------------------------------------------------------

describe('Settings: the smart tester', () => {
  const INTRO = "Optional. Uses your own Claude API key to check lines the keyword rules couldn't place. Off until you add a key and turn it on.";
  // Final review I2: it says what the masking really does. Only the made-up patient's values are replaced, so the
  // trainee's own name, said in a sentence the keyword rules couldn't place, goes as said.
  const SENDS = "When a line has a sentence the keyword rules couldn't place, EMTNotes sends Anthropic that sentence, the steps it " +
    "could belong to, and the made-up case's complaint, type and ETA, and the patient's age, sex and race. It first replaces the " +
    "made-up patient's name, IC number and address. Anything else in that sentence, such as your own name, goes as you said it. " +
    'It never sends your other runs, quiz or notes. Anthropic also sees what any web request shows, such as your IP address.';
  const SAFETY = 'Your key stays in this browser on this phone and goes only to Anthropic. Anyone who can open EMTNotes on this ' +
    'phone can use it.';
  const FALLBACK = 'Offline, or when a check takes longer than 6 seconds, the keyword rules grade the line on their own.';
  const KEY = 'sk-ant-abcd1234';
  const keyField = () => screen.getByLabelText('Claude API key') as HTMLInputElement;
  const smartSwitch = () => screen.getByRole('switch', { name: 'Use the smart tester' }) as HTMLButtonElement;
  const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
  const saved = (): SmartSettings => readSmart();
  const seed = (s: Partial<SmartSettings>) => localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ ...DEFAULT_SMART, ...s }));
  const saveKey = (key = KEY) => {
    fireEvent.input(keyField(), { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
  };

  beforeEach(() => { vi.mocked(testKey).mockReset(); });

  it('with no key: the intro, a password field, Save key off while blank, the switch off and disabled, Opus checked', () => {
    renderIn(makeStore());
    expect(screen.getByRole('heading', { level: 2, name: 'Smart tester' })).toBeTruthy();
    expect(screen.getByText(INTRO)).toBeTruthy();
    const field = keyField();
    expect(field.type).toBe('password');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.getAttribute('autocapitalize')).toBe('off');
    const save = screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.input(field, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);
    fireEvent.input(field, { target: { value: KEY } });
    expect(save.disabled).toBe(false);
    expect(smartSwitch().disabled).toBe(true);
    expect(smartSwitch().getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(smartSwitch().getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Needs a connection. Each check is billed to your Anthropic account.');
    const model = screen.getByRole('group', { name: 'Model' });
    expect([...model.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.checked)).toEqual([true, false, false]);
    expect(radio('Claude Opus 5.5').checked).toBe(true);
    expect(document.getElementById(radio('Claude Sonnet 5.5').getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Faster, about half the cost.');
    expect((screen.getByRole('button', { name: 'Test key' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Remove key' })).toBeNull();
  });

  it('Save key keeps the key on this phone only: in crewleader.smart, never in progress, and Reset progress keeps it', () => {
    const store = makeStore();
    renderIn(store);
    saveKey();
    expect(screen.getByText('Key saved on this phone, ending 1234.')).toBeTruthy();
    expect(screen.queryByLabelText('Claude API key')).toBeNull();   // the field goes, its value with it
    expect(localStorage.getItem(SMART_STORAGE_KEY)).toContain(KEY);
    expect(saved()).toEqual({ ...DEFAULT_SMART, key: KEY });
    expect(JSON.stringify(store.get())).not.toContain(KEY);
    expect(smartSwitch().disabled).toBe(false);
    expect(smartSwitch().getAttribute('aria-checked')).toBe('false');   // saved, still off until turned on
    type('RESET');
    fireEvent.click(resetKey());
    expect(saved().key).toBe(KEY);
    expect(screen.getByText('Key saved on this phone, ending 1234.')).toBeTruthy();
    expect(JSON.stringify(store.get())).not.toContain(KEY);
  });

  it('trims the key before saving it, and moves focus to the line that says it is saved', () => {
    renderIn(makeStore());
    keyField().focus();
    saveKey(`  ${KEY}  `);
    expect(saved().key).toBe(KEY);
    expect(document.activeElement).toBe(screen.getByText('Key saved on this phone, ending 1234.'));
  });

  it('the switch turns the tester on and off once a key is saved, and the model radios choose the model', () => {
    renderIn(makeStore());
    saveKey();
    fireEvent.click(smartSwitch());
    expect(saved().on).toBe(true);
    expect(smartSwitch().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('Claude Haiku 5.5'));
    expect(saved().model).toBe('claude-haiku-5-5');
    expect(radio('Claude Haiku 5.5').checked).toBe(true);
    fireEvent.click(smartSwitch());
    expect(saved()).toEqual({ ...DEFAULT_SMART, key: KEY, model: 'claude-haiku-5-5' });
  });

  it("Remove key clears the key, turns the switch off, brings the field back, and keeps focus in the group's heading", () => {
    seed({ on: true, key: KEY, checks: 2, spentUsd: 0.5 });
    renderIn(makeStore());
    expect(smartSwitch().getAttribute('aria-checked')).toBe('true');
    screen.getByRole('button', { name: 'Remove key' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(saved()).toEqual({ ...DEFAULT_SMART, checks: 2, spentUsd: 0.5 });
    expect(localStorage.getItem(SMART_STORAGE_KEY)).not.toContain(KEY);
    expect(screen.queryByText('Key saved on this phone, ending 1234.')).toBeNull();
    expect(smartSwitch().getAttribute('aria-checked')).toBe('false');
    expect(smartSwitch().disabled).toBe(true);
    expect(keyField().value).toBe('');
    // not the field: focusing it would put the phone's keyboard up unasked
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Smart tester' }));
  });

  it('shows the usage and what it sends, why the key is safe, and the fallback', () => {
    seed({ key: KEY, checks: 3, spentUsd: 0.0234 });
    renderIn(makeStore());
    expect(screen.getByText('3 checks so far on this phone, about US$0.02.')).toBeTruthy();
    expect(screen.getByText(SENDS)).toBeTruthy();
    // never the old promises: "any name" replaced, nothing "about you" sent (final review I2)
    const about = document.querySelector<HTMLElement>('.smart-about')!.textContent!;
    expect(about).not.toContain('any name');
    expect(about).not.toContain('anything about you');
    expect(screen.getByText(SAFETY)).toBeTruthy();
    expect(screen.getByText(FALLBACK)).toBeTruthy();
  });

  it('Reset count sets the checks and the spend back to 0, keeping the key', () => {
    seed({ on: true, key: KEY, checks: 1, spentUsd: 1.5 });
    renderIn(makeStore());
    expect(screen.getByText('1 check so far on this phone, about US$1.50.')).toBeTruthy();
    screen.getByRole('button', { name: 'Reset count' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Reset count' }));
    expect(saved()).toEqual({ ...DEFAULT_SMART, on: true, key: KEY });
    expect(screen.getByText('0 checks so far on this phone, about US$0.00.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reset count' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('0 checks so far on this phone, about US$0.00.'));   // not <body>
  });

  it.each([
    ['ok', 'The key works.'],
    ['bad-key', "That key didn't work. Check it in the Claude Console."],
    ['browser-blocked', "This key's organisation doesn't allow calls from a browser, so the smart tester can't use it."],
    ['rate-limited', 'Too many requests right now. Try again in a minute.'],
    ['offline', "Couldn't reach Anthropic. Check your connection."],
    // final review M4: online, an opaque network error (a refused CORS call) never claims you're offline
    ['unreachable', "Couldn't reach Anthropic from this browser. If other sites load, the browser may be refusing the call."],
    ['error', 'Something went wrong. Try again later.'],
  ] as const)('Test key: %s says "%s" in its status line', async (result: KeyCheck, copy) => {
    vi.mocked(testKey).mockResolvedValueOnce(result);
    seed({ key: KEY, model: 'claude-sonnet-5-5' });
    renderIn(makeStore());
    const status = document.querySelector<HTMLElement>('.smart-check')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Test key' }));
    expect(testKey).toHaveBeenCalledWith(KEY, 'claude-sonnet-5-5');
    await waitFor(() => expect(status.textContent).toBe(copy));
  });

  it('Test key says it is checking until the answer comes, and a new model clears an old answer', async () => {
    let answer: (r: KeyCheck) => void = () => {};
    vi.mocked(testKey).mockImplementationOnce(() => new Promise<KeyCheck>((resolve) => { answer = resolve; }));
    seed({ key: KEY });
    renderIn(makeStore());
    fireEvent.click(screen.getByRole('button', { name: 'Test key' }));
    expect(screen.getByText('Checking the key.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test key' }));   // a second press while checking does nothing
    expect(testKey).toHaveBeenCalledTimes(1);
    await act(async () => { answer('ok'); });
    expect(screen.getByText('The key works.')).toBeTruthy();
    fireEvent.click(radio('Claude Sonnet 5.5'));
    expect(screen.queryByText('The key works.')).toBeNull();
  });

  it('Save key never turns the tester on: a saved { on: true, key: null } stays Off until the switch is pressed (review M2)', () => {
    localStorage.setItem(SMART_STORAGE_KEY, JSON.stringify({ on: true, key: null }));
    renderIn(makeStore());
    expect(smartSwitch().getAttribute('aria-checked')).toBe('false');
    saveKey();
    expect(saved()).toEqual({ ...DEFAULT_SMART, key: KEY });
    expect(smartSwitch().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(smartSwitch());
    expect(saved().on).toBe(true);
    expect(smartSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it("a change storage refuses says so and changes nothing: the key isn't shown as saved (review M3)", () => {
    renderIn(makeStore());
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      saveKey();
      expect(screen.getByText(SMART_NOT_SAVED)).toBeTruthy();
      expect(SMART_NOT_SAVED).toBe("The smart tester's settings couldn't be saved on this phone, so nothing changed.");
      expect(screen.queryByText('Key saved on this phone, ending 1234.')).toBeNull();
      expect(keyField().value).toBe(KEY);   // still in the field, to try again
      expect(saved().key).toBeNull();
      fireEvent.click(radio('Claude Haiku 5.5'));
      expect(radio('Claude Opus 5.5').checked).toBe(true);   // the saved model stays checked
      expect(radio('Claude Haiku 5.5').checked).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  it('a Remove key storage refuses keeps the key shown as saved, and says so', () => {
    seed({ on: true, key: KEY });
    renderIn(makeStore());
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
      expect(screen.getByText(SMART_NOT_SAVED)).toBeTruthy();
      expect(screen.getByText('Key saved on this phone, ending 1234.')).toBeTruthy();
      expect(smartSwitch().getAttribute('aria-checked')).toBe('true');
    } finally {
      setItem.mockRestore();
    }
  });

  it('follows a change another window saves (the storage event)', () => {
    renderIn(makeStore());
    expect(screen.queryByText('Key saved on this phone, ending 1234.')).toBeNull();
    seed({ key: KEY });
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: SMART_STORAGE_KEY })); });
    expect(screen.getByText('Key saved on this phone, ending 1234.')).toBeTruthy();
  });
});

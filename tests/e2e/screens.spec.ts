// Task 22: every Plan 1 screen at 390px, pinned by a committed screenshot baseline in tests/e2e/__screens__/, and
// checked with axe (WCAG 2.2 AA), for sideways scroll and for 44px targets. A later plan that changes a screen on
// purpose updates its baseline with --update-snapshots, and says so.
// Plan 2 (Task 20) adds Run start, the run in Coached and Exam with the step list and the Pause sheet, the debrief,
// Today with a last run and its headline, and the PAM tab; and re-baselines today (Start your first run, and the run
// items as links) and settings (the Install group, and the stubbed storage line).
// Plan 3 (Task 12) adds run-voice (the composer with the banded Speak key) and pam-history (a Coached run, an Exam run
// and a drill); and re-baselines pam-tab (Task 6: the run history replaces Last run), run-start (Task 5: Answer by),
// settings (Task 9: the Smart tester group), and run-coached, run-exam, run-step-list and run-paused (Task 1, D25: two
// routes higher up the chat lose "Not sure what this is.", so the chat, kept at its newest line, sits 1px lower).
// The Plan 3 final fix wave re-baselines settings (I2: the Smart tester's privacy copy now says what it replaces and
// that your own name goes as said, one line longer) and run-start (M2: Voice's sub-line says where the audio goes, two
// lines longer).
// The app's rename to EMTNotes re-baselines today and today-last-run (the app bar's name), pam-tab and pam-history (the
// run history's note, now one line, so its panel ends a line higher) and settings (the Install line and the Smart
// tester's privacy copy, rewrapped with no line gained or lost).
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { defaultProgress, type AnswerBy, type AnswerRecord, type RunMode } from '../../src/progress/types';
import {
  COPD, COPD_GAP_MS, COPD_TO_BREATHING, copdDrillRecord, copdRecord, fakeSpeech, playRun, practiceSession, progressWith, seed,
} from './seed';

// No service worker: its "Ready to use offline." lands about a second after the first load, so it would be in some
// baselines and not others. tests/e2e/offline.spec.ts covers it. The phone's time zone is set, so a run's "Today,
// 16:00" reads the same on any machine.
test.use({ serviceWorkers: 'block', timezoneId: 'Asia/Singapore' });
// axe over the whole of a long notes section takes a while.
test.describe.configure({ timeout: 60_000 });

const AT = '2026-11-11T09:00:00.000Z';
/** `hours` before AT, as a run's start time. */
const before = (hours: number) => new Date(Date.parse(AT) - hours * 3_600_000).toISOString();

// Fixed inputs. Every screen sees the same day and time. And Settings' Storage line reads the browser's answer to
// persist(): stubbed to say no, as headless Chromium does today, so settings.png no longer depends on it (Task 19 carry).
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(AT));
  await page.addInitScript(() => {
    const storage = navigator.storage as StorageManager | undefined;
    if (storage === undefined) return;
    for (const name of ['persist', 'persisted'] as const) {
      Object.defineProperty(storage, name, { configurable: true, value: () => Promise.resolve(false) });
    }
  });
});
/** mt-b-q115 in bank order (A–D = a–d, answer b) first, then mt-a-q001. */
const OPEN = () => practiceSession(['mt-b-q115', 'mt-a-q001'], { 'mt-b-q115': ['a', 'b', 'c', 'd'] });
/** Those two finished: q115 wrong (picked c), q001 right. */
const LAST = () => {
  const done: AnswerRecord[] = [
    { qid: 'mt-b-q115', picked: 'c', right: false, at: AT },
    { qid: 'mt-a-q001', picked: 'b', right: true, at: AT },
  ];
  return { ...OPEN(), queue: [], done };
};

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** The touch targets §8 holds to 44px: option rows (the quiz's and the setup's native radios sit in their labels),
 *  any ARIA radio, every button, the tab bar's links, the text-link keys, icon keys that are links (Today's
 *  Settings), the Notes rows and search hits, Today's checklist and Continue links, the text fields, the composer's
 *  Step list and Send keys, the chat's "↓ n new" pill (in no baseline: run.spec.ts measures it, ruling D10), and the
 *  notes' drill links to PAM steps. Plan 3 (Task 12) adds the banded Speak key, the run history's rows (each one link),
 *  and the Settings keys of the Smart tester group (Save key, Remove key, Test key, Reset count, and its switch row).
 *  Not a.mode-a: its own box is the title's line, and its target is the whole card, through ::after. */
const TARGETS = [
  'label:has(input[type=radio])', '[role=radio]', 'button', 'nav a', '.link', '.ibtn',
  '.nrow', '.nhit', '.fr-link', '.cont-a', 'input:not([type=radio])',
  '.sq', '.send', '.newpill', '.xstep',
  '.mic', '.hist-row', '.smart-group .btn2', '.switch-row',
].join(', ');

/** The visible targets under 44px tall or wide, named well enough to find. */
const smallTargets = (page: Page) => page.evaluate((selector) =>
  [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => el.checkVisibility({ visibilityProperty: true }) && el.getClientRects().length > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        target: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().replace(/\s+/g, '.')}` : ''}`,
        name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '',
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      };
    })
    .filter((t) => t.w < 44 || t.h < 44), TARGETS);

const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A full-page capture leaves a sticky bar where the first screenful has it, over the content below it (the tab
 *  bar across Notes rows 11 and 12). Unstuck, a bar sits where a scroll to the end shows it, after the content, so
 *  every row is in the baseline. A page that fits the screen looks the same either way. This is sound only for a
 *  sticky bar, which stays in flow: a fixed bar that covered the last content on a phone would look right once
 *  unstuck. So each bar is checked to be sticky first. */
const BARS = '.tabs, .qkeys';
const UNSTICK = `${BARS} { position: relative; }`;

/** The comparison: no more than 50 pixels may differ, at a per-pixel colour threshold of 0.1. The noise between
 *  runs is 0, and the smallest regression measured in review (s01's "20 mins" becoming "30 mins") is 108 pixels;
 *  a chip changing hue is over 1,000. Playwright takes the stricter of maxDiffPixels and maxDiffPixelRatio, so 50
 *  governs every shot (1% of the smallest is 3,292). At the default threshold of 0.2 a text-2 to text-3 swap
 *  differs by 0 pixels; at 0.1, by 2,204. A one-letter wording change can still pass: headings and counts are
 *  pinned by DOM assertions instead. */
const COMPARE = { maxDiffPixels: 50, maxDiffPixelRatio: 0.01, threshold: 0.1 } as const;

/** Masked parts are drawn in the line grey (--c-line), not Playwright's magenta, which reads as the "wrong" status. */
const MASK = '#36444A';

interface Shot {
  /** false for a viewport screenshot (the long s01 section); the checks still cover the whole page. */
  fullPage?: boolean;
  /** Parts that change from build to build, covered in the screenshot. */
  mask?: Locator[];
}

/** The four checks for one screen. Soft, so a first run reports every failure at once. */
async function checkScreen(page: Page, name: string, { fullPage = true, mask }: Shot = {}): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  expect.soft(await fitsWidth(page), `${name}: no sideways scroll`).toBe(true);
  expect.soft(await smallTargets(page), `${name}: targets under 44px tall or wide`).toEqual([]);
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect.soft(violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) })),
    `${name}: axe violations`).toEqual([]);
  if (fullPage) {
    const notSticky = await page.locator(BARS).evaluateAll((els) => els
      .map((el) => ({ bar: el.className, position: getComputedStyle(el).position }))
      .filter((b) => b.position !== 'sticky'));
    expect(notSticky, `${name}: only a sticky bar may be unstuck for the capture`).toEqual([]);
    await page.addStyleTag({ content: UNSTICK });   // after the checks, which see the page as it is
  }
  await expect.soft(page).toHaveScreenshot(`${name}.png`,
    { fullPage, mask, maskColor: MASK, animations: 'disabled', ...COMPARE });
}

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test('Today, first run', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: 'Start here' })).toBeVisible();
  await expect(page.getByText(/of 346 answered/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Start with/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start your first run' })).toBeVisible();
  await checkScreen(page, 'today');
});

/** Three whole COPD runs, the newest an hour before AT: the pocket check missed in the oldest and the newest, so
 *  Today's headline names it, "in 2 of your last 3 runs". */
const threeRuns = async () => [
  await copdRecord('run-a', before(50), { pocket: true }),
  await copdRecord('run-b', before(26)),
  await copdRecord('run-c', before(1), { pocket: true }),
];

test('Today, with a last run and its headline', async ({ page }) => {
  await seed(page, progressWith({ runs: await threeRuns() }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: /missed in 2 of your last 3 runs$/ })).toBeVisible();
  await expect(page.getByText('Today, 16:00')).toBeVisible();
  await expect(page.getByRole('img', { name: /^Run strip/ })).toBeVisible();
  await expect(page.getByText(/of 346 answered/)).toBeVisible();
  await checkScreen(page, 'today-last-run');
});

/** The PAM tab's run history: its rows, each one link to its debrief, newest first. */
const historyLinks = (page: Page) => page.getByRole('list', { name: 'Run history' }).getByRole('link');

test('PAM tab', async ({ page }) => {
  await seed(page, progressWith({ runs: await threeRuns() }));
  await page.goto('/#/pam');
  await expect(heading(page, 'PAM')).toBeVisible();
  await expect(page.locator('main .primary')).toHaveText(['New case']);
  // The run history replaces Plan 2's Last run card and its Open debrief link (Plan 3 Task 6, D10).
  await expect(page.getByRole('link', { name: 'Open debrief' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Last run' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Run history' })).toBeVisible();
  const rows = historyLinks(page);
  await expect(rows).toHaveCount(3);
  for (const [i, id] of ['run-c', 'run-b', 'run-a'].entries()) await expect(rows.nth(i)).toHaveAttribute('href', `#/debrief/${id}`);
  await expect(rows.first()).toHaveAccessibleName(/^Breathlessness, Ang Mo Kio\. Coached\. Today, 16:00 · \d\d:\d\d of 20:00\. 1 to fix$/);
  await checkScreen(page, 'pam-tab');
});

test('PAM tab, run history: a Coached run with 3 faults, a clean Exam run and a drill', async ({ page }) => {
  await seed(page, progressWith({ runs: [
    await copdDrillRecord('run-drill', before(50)),
    await copdRecord('run-exam', before(26), {}, 'exam'),
    await copdRecord('run-three', before(1), { moi: true, grip: true, pocket: true }),
  ] }));
  await page.goto('/#/pam');
  await expect(heading(page, 'PAM')).toBeVisible();
  const rows = historyLinks(page);
  await expect(rows).toHaveCount(3);
  // Each row's name is its whole text, built once as its aria-label: the case and mode, when and the time used, then
  // the verdict, with a full stop between (Task 12 review M1).
  await expect(rows.nth(0)).toHaveAccessibleName(/^Breathlessness, Ang Mo Kio\. Coached\. Today, 16:00 · \d\d:\d\d of 20:00\. 3 to fix$/);
  await expect(rows.nth(1)).toHaveAccessibleName(
    /^Breathlessness, Ang Mo Kio\. Exam\. Yesterday, 15:00 · \d\d:\d\d of 20:00\. Nothing to fix this run\.$/);
  await expect(rows.nth(2)).toHaveAccessibleName(
    /^Breathlessness, Ang Mo Kio\. Drill on steps 11 to 13\. 9 Nov, 15:00 · untimed\. Nothing to fix this run\.$/);
  // A full run's row has its half-size strip; a drill's has none.
  await expect(rows.nth(0).locator('svg.strip-mini')).toHaveCount(1);
  await expect(rows.nth(1).locator('svg.strip-mini')).toHaveCount(1);
  await expect(rows.nth(2).locator('svg.strip-mini')).toHaveCount(0);
  await checkScreen(page, 'pam-history');
});

test('Run start', async ({ page }) => {
  // A recogniser of the app's kind on every phone, so Voice reads the same whatever Chromium ships (Task 5).
  await page.addInitScript(fakeSpeech([]));
  await page.goto('/#/pam/start');
  await expect(heading(page, 'New case')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Random' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Coached' })).toBeChecked();
  // Answer by (Plan 3 Task 5): Typing by default, Voice offered.
  await expect(page.getByRole('group', { name: 'Answer by' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Typing' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Voice' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Take the call' })).toBeVisible();
  await checkScreen(page, 'run-start');
});

test.describe('the run, at step 10 (mockup screen 2)', () => {
  /** Mdm Tan's run at Breathing, open on #/run, settled: the SpO2 tile shows its reading (ruling P33), the clock its
   *  time, and the chat is at its newest line. The run screen is the viewport by design, so its shots are too. */
  const open = async (page: Page, mode: RunMode, answerBy: AnswerBy = 'typing') => {
    const runOpen = await playRun(COPD, mode, [...COPD_TO_BREATHING], { gapMs: COPD_GAP_MS });
    await seed(page, progressWith({ runOpen, settings: { ...defaultProgress().settings, answerBy } }));
    await page.goto('/#/run');
    await expect(heading(page, 'Breathlessness')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Vitals' }).getByText('86')).toBeVisible();
    await expect(page.getByRole('timer', { name: 'Run clock' })).toHaveText('02:15RBS by 3:00');
    const chat = page.getByRole('log', { name: 'Run chat' });
    await expect(chat.locator('.msg').last()).toContainText('Simple face mask on, 6 L/min.');
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => chat.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
  };

  test('Coached, with the head grip Order flag and the simple face mask Wrong', async ({ page }) => {
    await open(page, 'coached');
    await expect(page.getByText('step 6 flagged')).toBeVisible();
    const flags = page.getByRole('log', { name: 'Run chat' }).getByRole('status');
    await expect(flags.filter({ hasText: 'Wrong' })).toBeVisible();
    await expect(flags.filter({ hasText: 'Head grip belongs to step 6, Introduction.' })).toBeAttached();   // higher up the chat
    await checkScreen(page, 'run-coached', { fullPage: false });
  });

  test('Coached, answering by Voice: Send squared, the banded Speak key in the right-hand slot', async ({ page }) => {
    await page.addInitScript(fakeSpeech([]));   // never pressed: the composer at rest
    await open(page, 'coached', 'voice');
    const speak = page.getByRole('button', { name: 'Speak' });
    await expect(speak).toHaveClass('mic');
    await expect(speak).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Send' })).toHaveClass('sq');
    // Speak is the composer's last key, in the slot Send takes when typing (mockup .as-mic).
    await expect(page.locator('.composer button').last()).toHaveAccessibleName('Speak');
    await checkScreen(page, 'run-voice', { fullPage: false });
  });

  test('Exam, the same lines', async ({ page }) => {
    await open(page, 'exam');
    await expect(page.getByRole('list', { name: /^Steps: / })).toHaveCount(0);
    await expect(page.getByRole('log', { name: 'Run chat' }).getByRole('status')).toHaveCount(0);
    await checkScreen(page, 'run-exam', { fullPage: false });
  });

  test('Coached, with the step list open', async ({ page }) => {
    await open(page, 'coached');
    await page.getByRole('button', { name: 'Step list' }).click();
    const sheet = page.getByRole('region', { name: 'Step list' });
    await expect(sheet.getByRole('button', { name: '10 Breathing' })).toBeFocused();   // the first step still to play
    await expect(sheet.getByRole('button', { name: '1 Respond call' })).toBeDisabled();
    await checkScreen(page, 'run-step-list', { fullPage: false });
  });

  test('Paused', async ({ page }) => {
    await open(page, 'coached');
    await page.getByRole('button', { name: 'Pause' }).click();
    const sheet = page.getByRole('dialog', { name: 'Paused' });
    await expect(sheet.getByRole('button', { name: 'Resume' })).toBeFocused();
    await expect(sheet.getByText('Mode: Coached')).toBeVisible();
    await checkScreen(page, 'run-paused', { fullPage: false });
  });
});

test('Debrief, three to fix (mockup screen 3)', async ({ page }) => {
  const r = await copdRecord('run-three', before(1), { moi: true, grip: true, pocket: true });
  await seed(page, progressWith({ runs: [r] }));
  await page.goto(`/#/debrief/${r.id}`);
  await expect(heading(page, 'Debrief')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '3 to fix' })).toBeVisible();
  await expect(page.getByRole('list', { name: '3 to fix' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('img', { name: /^Run replay/ })).toBeVisible();
  await checkScreen(page, 'debrief');
});

test('Quiz tab', async ({ page }) => {
  await page.goto('/#/quiz');
  await expect(heading(page, 'Theory quiz')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Bank progress' })).toBeVisible();
  await checkScreen(page, 'quiz-tab');
});

test('Quiz setup, practice', async ({ page }) => {
  await page.goto('/#/quiz/setup?mode=practice');
  await expect(heading(page, 'Practice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled();
  await checkScreen(page, 'quiz-setup-practice');
});

test('Quiz session, answered wrong', async ({ page }) => {
  await seed(page, progressWith({ quizOpen: OPEN() }));
  await page.goto('/#/quiz/session');
  await expect(heading(page, 'Practice')).toBeVisible();
  // The radio covers its row: tap the row for C itself, not its text.
  await page.locator('label.opt').filter({ has: page.getByRole('radio', { name: /^C / }) }).tap();
  await expect(page.getByRole('radio', { name: /^C / })).toBeChecked();
  await page.getByRole('button', { name: 'Check' }).tap();
  await expect(page.getByText('Wrong: you picked C. The answer is B.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
  await checkScreen(page, 'quiz-session-wrong');
});

test('Quiz result', async ({ page }) => {
  await seed(page, progressWith({ quizLast: LAST() }));
  await page.goto('/#/quiz/result');
  await expect(heading(page, 'Practice results')).toBeVisible();
  await expect(page.getByText('1 of 2 right')).toBeVisible();
  await checkScreen(page, 'quiz-result');
});

test('Notes tab', async ({ page }) => {
  await page.goto('/#/notes');
  await expect(heading(page, 'Notes')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sections' }).getByRole('listitem')).toHaveCount(20);
  await checkScreen(page, 'notes-tab');
});

test('Notes search for "ensapa"', async ({ page }) => {
  await page.goto('/#/notes');
  await expect(page.getByRole('list', { name: 'Sections' })).toBeVisible();
  const field = page.getByRole('searchbox', { name: 'Search your notes' });
  await field.fill('ensapa');
  await expect(page.getByRole('list', { name: 'Matches' })).toBeVisible();
  await field.press('Enter');   // the search key: puts the keyboard away, the results stay
  await expect(field).not.toBeFocused();
  await checkScreen(page, 'notes-search-ensapa');
});

test.describe('the reader', () => {
  /** s01 is long: its baselines are the first screenful, from the top. */
  const atTop = async (page: Page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  };

  test('s01, Full text', async ({ page }) => {
    await page.goto('/#/notes/s01');
    await expect(heading(page, '1. Primary Survey')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Highlights only' })).toHaveAttribute('aria-pressed', 'false');
    await atTop(page);
    await checkScreen(page, 'reader-s01-full', { fullPage: false });
  });

  test('s01, Highlights only', async ({ page }) => {
    await page.goto('/#/notes/s01');
    await expect(heading(page, '1. Primary Survey')).toBeVisible();
    await page.getByRole('button', { name: 'Highlights only' }).click();
    await expect(page.getByRole('button', { name: 'Highlights only' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('mark', { hasText: 'NEVER move the patient' })).toBeVisible();
    await atTop(page);
    await checkScreen(page, 'reader-s01-highlights', { fullPage: false });
  });

  test('s02, with its 4-column table', async ({ page }) => {
    await page.goto('/#/notes/s02');
    await expect(heading(page, '2. Secondary Survey')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Table: Code, Hospital, Code, Hospital' })).toBeAttached();
    await checkScreen(page, 'reader-s02');
  });
});

test('Settings', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(heading(page, 'Settings')).toBeVisible();
  await expect(page.getByText(/^Version .*, built \d{4}-\d{2}-\d{2}\.$/)).toBeVisible();
  // The Storage line waits for the browser's answer to persist(), stubbed to say no: in before the capture.
  await expect(page.getByText(/^The phone may clear your progress/)).toBeVisible();
  // Playwright's Chromium never offers to install (ruling W4), so the Install group always says so, with no key.
  await expect(page.getByText("Chrome hasn't offered to install yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0);
  // The Smart tester group (Plan 3 Task 9), as a phone with no key has it: the key field, Save key off until a key is
  // typed, the switch off and disabled, Opus the model, and nothing spent.
  await expect(page.getByRole('heading', { level: 2, name: 'Smart tester' })).toBeVisible();
  await expect(page.getByLabel('Claude API key')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save key' })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Use the smart tester' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'Use the smart tester' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Claude Opus 5.5' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Test key' })).toBeDisabled();
  await expect(page.getByText('0 checks so far on this phone, about US$0.00.')).toBeVisible();
  // The version and build date change with every build: masked, so a later day's build still matches.
  await checkScreen(page, 'settings', { mask: [page.locator('.set-line')] });
});

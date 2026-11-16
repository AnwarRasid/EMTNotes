// Task 20: the run screen in the built app, on both projects (the 390px phone and the Pixel 7): a Coached run from
// Today to its debrief, a reload, Android's back, reopening the app, Exam, tap mode, the clock's limits, the "↓ n new"
// pill, and the layout fitting the screen with the chat as its one scroller (spec §6.2, §8).
import { test, expect, type Page } from '@playwright/test';
// A key that has just taken another's place ignores presses this long (ruling S5). useQuiz loads in Playwright's Node:
// Preact is plain JS there, and nothing it imports touches the DOM until called.
import { READ_HOLD_MS } from '../../src/quiz/useQuiz';
import { COPD, COPD_GAP_MS, COPD_TO_BREATHING, canonicalLine, copdRecord, playRun, progressWith, seed, toApproach } from './seed';

// No service worker: its "Ready to use offline." toast lands about a second after the first load and would sit over
// the composer. tests/e2e/offline.spec.ts covers it.
test.use({ serviceWorkers: 'block' });

/** The Giddiness case, the only one under that complaint. */
const GIDDY = 'hypo-hougang-01';
/** Approach's sound-out: the first line said in a timed step starts the clock. */
const APPROACH = 'Approaching casualty from the front. If you can hear me, please do not move your head.';
/** The activation, the run's first line: Dispatch's, after its visually hidden speaker prefix. */
const ACTIVATION = /^Dispatch: Activation: /;
/** Where the fake clock starts in the tests that install one; any time does. */
const START = new Date('2026-11-14T09:00:00.000Z').getTime();

const chat = (page: Page) => page.getByRole('log', { name: 'Run chat' });
const timer = (page: Page) => page.getByRole('timer', { name: 'Run clock' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Speak to the scene' });
const paused = (page: Page) => page.getByRole('dialog', { name: 'Paused' });

/** The clock's digits and its limit line, each matched whole. */
async function clockReads(page: Page, digits: string, line: string): Promise<void> {
  await expect(timer(page).getByText(digits, { exact: true })).toBeVisible();
  await expect(timer(page).getByText(line, { exact: true })).toBeVisible();
}

/** Sends `text` from the composer and waits until it is the chat's newest line of the trainee's. */
async function say(page: Page, text: string): Promise<void> {
  await field(page).fill(text);
  await field(page).press('Enter');
  await expect(chat(page).locator('.msg.me').last()).toContainText(text);
}

/** The run screen up, with its case's content in (the chat shows the activation). */
async function runReady(page: Page): Promise<void> {
  await expect(chat(page).locator('.syscard').first()).toHaveText(ACTIVATION);
  await expect(field(page)).toBeEnabled();
}

/** A seeded Giddiness run at Approach (its first four steps said, the clock still to start), open on #/run. */
async function giddyAtApproach(page: Page, mode: 'coached' | 'exam' = 'coached'): Promise<void> {
  await seed(page, progressWith({ runOpen: await playRun(GIDDY, mode, toApproach(GIDDY)) }));
  await page.goto('/#/run');
  await runReady(page);
}

/**
 * Effects wait on a timer in Preact (the frame after a render: a requestAnimationFrame, or a 100 ms timeout), and a
 * paused fake clock fires none. Moves the clock on by `ms` (1 by default), so the timers due run, without moving the
 * run clock's shown second. A jump (pauseAt, fastForward) has already passed the frame, so 1 ms runs the effects it
 * queued; after a new render, a whole frame (FRAME_MS) must pass first.
 */
const flush = (page: Page, ms = 1) => page.clock.runFor(ms);
/** One frame of the fake requestAnimationFrame (16 ms), and a little over. */
const FRAME_MS = 20;

test('a Coached run from Today to its debrief', async ({ page }) => {
  await page.clock.install({ time: START });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'PAM' }).click();
  await page.getByRole('link', { name: 'New case' }).click();
  await expect(page).toHaveURL(/#\/pam\/start$/);
  await page.getByRole('radio', { name: 'Pick by complaint' }).check();
  await page.getByRole('button', { name: 'Giddiness' }).click();
  await expect(page.getByRole('button', { name: 'Giddiness' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Take the call' }).click();

  await expect(page).toHaveURL(/#\/run$/);
  // The activation names the complaint picked; the case's address and the rest are its data.
  await expect(chat(page).locator('.syscard').first()).toHaveText(/^Dispatch: Activation: .*\bgiddiness\b/i);
  await clockReads(page, '--:--', 'Starts at Approach');
  await expect(page.getByRole('list', { name: /^Steps: / })).toBeVisible();   // Coached's step bar, which Exam has not

  const [call, ...rest] = toApproach(GIDDY);
  await say(page, call!);
  await expect(chat(page).locator('.msg.them').last()).toContainText('Ops Ctr, roger.');
  for (const line of rest) await say(page, line);
  await clockReads(page, '--:--', 'Starts at Approach');

  // Paused from here, so the clock reads exactly 00:00 as it starts (ruling T20 b).
  await page.clock.pauseAt(START + 10 * 60_000);
  await say(page, APPROACH);
  await clockReads(page, '00:00', 'RBS by 3:00');
  await say(page, 'Buddy, do a head grip.');
  await say(page, 'Is there any catastrophic bleeding?');
  await expect(chat(page).getByRole('status').filter({ hasText: 'Order' })).toBeVisible();
  await page.clock.resume();

  await page.getByRole('button', { name: 'Pause' }).click();
  await paused(page).getByRole('button', { name: 'End run' }).click();
  await expect(paused(page).getByText(/^End run at \d\d:\d\d\? Steps .+ count as missed\.$/)).toBeVisible();
  await page.clock.runFor(READ_HOLD_MS);   // the confirming key takes no press for its first 400 ms (ruling S5)
  await paused(page).getByRole('button', { name: 'End run' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: / to fix$/ })).toBeVisible();
});

test('a reload mid-run keeps the run, its lines and its clock', async ({ page }) => {
  await page.clock.install({ time: START });
  await giddyAtApproach(page);
  const T0 = START + 10 * 60_000;
  await page.clock.pauseAt(T0);
  const lines = [APPROACH, 'Buddy, do a head grip.', 'Is there any catastrophic bleeding?'];
  for (const line of lines) await say(page, line);
  // The clock started at T0 with the first line; 7 s in, on the second exactly.
  await page.clock.pauseAt(T0 + 7_000);
  await flush(page);
  await clockReads(page, '00:07', 'RBS by 3:00');
  const before = await timer(page).textContent();

  await page.reload();
  // The new page's effects wait on the paused clock too: let them run, a frame at a time, until the run is up. The run's
  // clock resumes only once the screen is up, so the frames before count nothing, and the dozen or so after it (each
  // try 20 ms) stay well inside the second the clock shows.
  await expect(async () => {
    await flush(page, FRAME_MS);
    await expect(chat(page).locator('.syscard').first()).toHaveText(ACTIVATION, { timeout: 100 });
  }).toPass({ timeout: 15_000 });
  expect(new URL(page.url()).hash).toBe('#/run');
  for (const line of lines) await expect(chat(page).locator('.msg.me').getByText(line)).toBeVisible();
  await flush(page);
  expect(await timer(page).textContent()).toBe(before);
});

test("Android's back opens the Pause sheet and stays on the run", async ({ page }) => {
  await giddyAtApproach(page);
  await page.goBack();
  await expect(paused(page)).toBeVisible();
  expect(page.url()).toMatch(/#\/run$/);
  await paused(page).getByRole('button', { name: 'Resume' }).click();
  await expect(paused(page)).toHaveCount(0);
  await expect(field(page)).toBeVisible();
});

test('reopening the app mid-run offers the run back on Today', async ({ page }) => {
  await giddyAtApproach(page);
  await say(page, APPROACH);
  await expect(timer(page).getByText('RBS by 3:00', { exact: true })).toBeVisible();   // the clock has started
  // The app's start_url: a real navigation, not a hash change within the page (ruling T20 c).
  await page.goto('/');
  await expect(page.getByText(
    /^Run in progress: Giddiness, step \d+, \d\d:\d\d used\. The clock paused when you left\.$/)).toBeVisible();
  await page.getByRole('link', { name: 'Resume' }).click();
  await expect(page).toHaveURL(/#\/run$/);
  await expect(chat(page).locator('.msg.me').getByText(APPROACH)).toBeVisible();
});

/** "MOI is case of giddiness." read at step 4, Rescue scene evaluation: MOI without "suspected", a Phrase fault. Said at
 *  step 1 it would be heard as the call's "case of" instead, so the run is seeded at step 3. */
const MOI_NO_SUSPECTED = 'MOI is case of giddiness.';

test('Coached flags MOI without "suspected" as it is said', async ({ page }) => {
  await seed(page, progressWith({ runOpen: await playRun(GIDDY, 'coached', toApproach(GIDDY).slice(0, 3)) }));
  await page.goto('/#/run');
  await runReady(page);
  await say(page, MOI_NO_SUSPECTED);
  await expect(chat(page).locator('.msg.me').last().getByText('MOI', { exact: true })).toBeVisible();
  await expect(chat(page).getByRole('status').filter({ hasText: 'Phrase' })).toBeVisible();
});

test('Exam has no step bar, no step list and no flags', async ({ page }) => {
  await seed(page, progressWith({ runOpen: await playRun(GIDDY, 'exam', toApproach(GIDDY).slice(0, 3)) }));
  await page.goto('/#/run');
  await runReady(page);
  await expect(page.getByText('Exam', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: /^Steps: / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Step list' })).toHaveCount(0);
  // The same line Coached flags (the test above): Exam keeps it for the debrief.
  await say(page, MOI_NO_SUSPECTED);
  await expect(chat(page).locator('.msg.me').last().getByText('MOI', { exact: true })).toBeVisible();
  await expect(chat(page).getByRole('status')).toHaveCount(0);
});

test('tap mode: a step from the step list plays its line, and its row is done', async ({ page }) => {
  await seed(page, progressWith({ runOpen: await playRun(GIDDY, 'coached', []) }));
  await page.goto('/#/run');
  await runReady(page);
  await page.getByRole('button', { name: 'Step list' }).click();
  const row = page.getByRole('region', { name: 'Step list' }).getByRole('button', { name: '1 Respond call' });
  await row.click();
  const tapped = chat(page).locator('.msg.me.tapped');
  await expect(tapped).toHaveCount(1);
  await expect(tapped.locator('.bub')).toHaveText(`You: ${canonicalLine(GIDDY, 'respond-call')}`);   // after its hidden speaker prefix
  await expect(tapped.locator('.route')).toHaveText('Tapped: step 1, Respond call');
  await expect(row).toBeDisabled();
});

test("the clock's limits: RBS at 3:00, 5 min left at 15:00, the overrun from 20:00", async ({ page }) => {
  await page.clock.install({ time: START });
  await giddyAtApproach(page);
  await page.clock.pauseAt(START + 10 * 60_000);
  await say(page, APPROACH);
  await clockReads(page, '00:00', 'RBS by 3:00');
  await page.clock.fastForward('03:01');
  await flush(page);
  await clockReads(page, '03:01', 'RBS limit passed');
  await page.clock.fastForward('11:59');
  await flush(page);
  await clockReads(page, '15:00', '5 min left');
  await page.clock.fastForward('05:42');
  await flush(page);
  await clockReads(page, '+0:42', 'Past 20:00');
});

test('new lines while the chat is scrolled up wait in a "↓ n new" pill of 44px or more (ruling D10)', async ({ page }) => {
  await seed(page, progressWith({ runOpen: await playRun(COPD, 'coached', [...COPD_TO_BREATHING], { gapMs: COPD_GAP_MS }) }));
  await page.goto('/#/run');
  await runReady(page);
  const log = chat(page);
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await log.evaluate((el) => { el.scrollTop = 0; });
  await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(0);
  await field(page).fill('Checking the radial pulse.');
  await field(page).press('Enter');
  // Its arrow is hidden from screen readers, which hear "2 new".
  const pill = page.getByRole('button', { name: /^\d+ new$/ });
  await expect(pill).toHaveText(/^↓ \d+ new$/);
  const box = await pill.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  await pill.click();
  await expect(pill).toHaveCount(0);
  await expect(log.locator('.msg.me').last()).toBeInViewport();
});

test('the run fits the screen, and the chat is its one scroller', async ({ page }) => {
  await seed(page, progressWith({ runOpen: await playRun(COPD, 'coached', [...COPD_TO_BREATHING], { gapMs: COPD_GAP_MS }) }));
  await page.goto('/#/run');
  await runReady(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  const style = await chat(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { overflowY: s.overflowY, overscrollBehaviorY: s.overscrollBehaviorY };
  });
  expect(style).toEqual({ overflowY: 'auto', overscrollBehaviorY: 'contain' });
});

// Final review M5: a downward drag on the run header or the vitals rail must not reload the page mid-run, so the root
// scroller takes no pull-to-refresh while a focus screen is up (Run start, the run, the debrief); the tabs keep the
// browser's default.
test('no pull-to-refresh while a focus screen is up; the tabs keep the default', async ({ page }) => {
  const record = await copdRecord('run-m5', new Date().toISOString());
  await seed(page, progressWith({ runOpen: await playRun(GIDDY, 'coached', toApproach(GIDDY)), runs: [record] }));
  const root = () => page.evaluate(() => [document.documentElement, document.body].map((el) => getComputedStyle(el).overscrollBehaviorY));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  expect(await root()).toEqual(['auto', 'auto']);
  await page.goto('/#/pam/start');
  await expect(page.getByRole('heading', { level: 1, name: 'New case' })).toBeVisible();
  expect(await root()).toEqual(['none', 'none']);
  await page.goto('/#/run');
  await runReady(page);
  expect(await root()).toEqual(['none', 'none']);
  await page.goto(`/#/debrief/${record.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
  expect(await root()).toEqual(['none', 'none']);
  for (const [hash, name] of [['#/pam', 'PAM'], ['#/quiz', 'Theory quiz'], ['#/notes', 'Notes']] as const) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    expect(await root(), hash).toEqual(['auto', 'auto']);
  }
});

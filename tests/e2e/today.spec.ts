// Task 20: Today, the PAM tab and Settings in the built app at phone width.
import { test, expect, type Page } from '@playwright/test';
import { practiceSession, progressWith, seed } from './seed';

// No service worker here (tests/e2e/offline.spec.ts covers it): its "Ready to use offline." lands about a second
// after the first load and would queue the toasts these tests wait for (Quiz discarded., Progress reset.).
test.use({ serviceWorkers: 'block' });

const STRIP = 'Run strip, 0 to 20 minutes. No runs yet. Limits: RBS by 3:00, whole run by 20:00.';

const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Visible buttons and links in the main content under 44px tall. */
const smallTargets = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('main button, main a')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ text: el.textContent?.trim() || el.getAttribute('aria-label') || '', h: el.getBoundingClientRect().height }))
    .filter((t) => t.h < 44));

/** Today with its content in: the checklist, and the bank counts once the questions load. */
const todayReady = async (page: Page) => {
  await expect(page.getByRole('heading', { level: 2, name: 'Start here' })).toBeVisible();
  await expect(page.getByText(/of 346 answered/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^(Start with|Continue reading)/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

test('Today on a first run: the checklist and the empty strip, no sideways scroll, 44px targets', async ({ page }) => {
  await page.goto('/');
  await todayReady(page);
  await expect(page.getByRole('img', { name: STRIP })).toBeVisible();
  await expect(page.getByText('No runs yet. A run takes about 20 minutes. The clock starts when you say Approach.')).toBeVisible();
  expect(await page.getByRole('img', { name: 'Not done yet' }).count()).toBe(3);
  expect(await fitsWidth(page)).toBe(true);
  expect(await smallTargets(page)).toEqual([]);
  await expect(page.locator('main .primary')).toHaveText(['Start your first run']);
  await expect(page.locator('main .primary')).toHaveAttribute('href', '#/pam/start');
  await page.screenshot({ path: 'test-results/shots/today.png', animations: 'disabled' });
});

test('Today with a quiz open and questions to review: Resume is the one primary key', async ({ page }) => {
  const ids = ['mt-a-q001', 'mt-a-q002', 'mt-a-q003'];
  const session = { ...practiceSession(ids), done: [{ qid: ids[0]!, picked: 'a', right: true, at: '2026-11-11T09:00:00.000Z' }], queue: ids.slice(1) };
  const wrong = { seen: 1, right: 0, lastAt: '2026-11-11T09:00:00.000Z', lastRight: false, rightSinceWrong: 0 };
  await seed(page, progressWith({
    quizOpen: session,
    questions: { 'mt-a-q010': wrong, 'mt-a-q011': wrong },
    notes: { lastSection: 's07', read: ['s01', 's07'] },
  }));
  await page.goto('/');
  await todayReady(page);
  await expect(page.getByText('Quiz in progress: Practice, 1 of 3 answered.')).toBeVisible();
  await expect(page.locator('main .primary')).toHaveText(['Resume']);
  await expect(page.getByRole('link', { name: 'Review 2 you got wrong' })).toBeVisible();
  await expect(page.getByText('This replaces your open quiz.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue reading: 7. Auscultation (6 points)' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Done', exact: true })).toHaveCount(1);
  expect(await fitsWidth(page)).toBe(true);
  expect(await smallTargets(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/shots/today-resume.png', animations: 'disabled', fullPage: true });

  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('Quiz discarded.')).toBeVisible();
  await expect(page.getByText(/^Quiz in progress/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Quiz in progress: Practice, 1 of 3 answered.')).toBeVisible();
});

test.describe('Discard: focus lands on Undo, which holds the 8 s for a keyboard user only', () => {
  const ids = ['mt-a-q001', 'mt-a-q002'];
  const open = async (page: Page) => {
    await page.clock.install();
    await seed(page, progressWith({ quizOpen: practiceSession(ids) }));
    await page.goto('/');
    await expect(page.getByText('Quiz in progress: Practice, 0 of 2 answered.')).toBeVisible();
  };
  const undo = (page: Page) => page.getByRole('button', { name: 'Undo' });
  const ringed = (page: Page) => undo(page).evaluate((el) => el.matches(':focus-visible'));

  for (const how of ['tap', 'click'] as const) {
    test(`a ${how}: no ring on the Undo, and the toast leaves at 8 s`, async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Discard' })[how]();
      await expect(undo(page)).toBeFocused();
      expect(await ringed(page)).toBe(false);
      await page.clock.runFor(7_500);
      await expect(page.getByText('Quiz discarded.')).toBeVisible();
      await page.clock.runFor(1_000);
      await expect(page.getByText('Quiz discarded.')).toHaveCount(0);
    });
  }

  test('a key: the Undo has the ring and the toast stays while it does', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Discard' }).focus();
    await page.keyboard.press('Enter');
    await expect(undo(page)).toBeFocused();
    expect(await ringed(page)).toBe(true);
    await page.clock.runFor(30_000);
    await expect(page.getByText('Quiz discarded.')).toBeVisible();
    await page.keyboard.press('Enter');   // Undo
    await expect(page.getByText('Quiz in progress: Practice, 0 of 2 answered.')).toBeVisible();
  });
});

test.describe('at 375px with the largest text', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const [path, heading] of [['/', null], ['/#/pam', 'PAM'], ['/#/settings', 'Settings']] as const) {
    test(`${path} fits the width`, async ({ page }) => {
      await page.goto(path);
      if (heading) await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      else await todayReady(page);
      await page.evaluate(() => { document.documentElement.dataset.textSize = 'larger'; });
      await page.evaluate(() => document.fonts.ready);
      expect(await fitsWidth(page)).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      await page.screenshot({ path: `test-results/shots/${heading?.toLowerCase() ?? 'today'}-375-larger.png`, animations: 'disabled', fullPage: true });
    });
  }
});

test('the PAM tab offers New case, over the empty strip', async ({ page }) => {
  await page.goto('/#/pam');
  await expect(page.getByRole('heading', { level: 1, name: 'PAM' })).toBeVisible();
  await expect(page.getByRole('img', { name: STRIP })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New case' })).toHaveAttribute('href', '#/pam/start');
  await expect(page.locator('main .primary')).toHaveText(['New case']);
  await page.evaluate(() => document.fonts.ready);
  expect(await fitsWidth(page)).toBe(true);
  await page.screenshot({ path: 'test-results/shots/pam.png', animations: 'disabled' });
});

test('Settings: text size applies at once and is kept, and reset asks for RESET', async ({ page }) => {
  await page.goto('/');
  await todayReady(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await fitsWidth(page)).toBe(true);
  expect(await smallTargets(page)).toEqual([]);

  const input = page.getByLabel('Type RESET to confirm');
  expect(await input.evaluate((el) => [el.getAttribute('autocapitalize'), el.getAttribute('autocomplete'), (el as HTMLInputElement).spellcheck]))
    .toEqual(['characters', 'off', false]);
  await page.screenshot({ path: 'test-results/shots/settings.png', animations: 'disabled', fullPage: true });

  await page.getByRole('radio', { name: 'Larger' }).check();
  await expect(page.locator('html')).toHaveCSS('font-size', '20px');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Larger' })).toBeChecked();
  await expect(page.locator('html')).toHaveCSS('font-size', '20px');

  const reset = page.getByRole('button', { name: 'Reset progress' });
  await expect(reset).toBeDisabled();
  await input.fill('reset');
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.getByText('Progress reset.')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('radio', { name: 'Larger' })).toBeChecked();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Start here' })).toBeVisible();
});

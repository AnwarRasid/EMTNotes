// Task 17: the quiz session and result in the built app at phone width.
import { test, expect, type Page } from '@playwright/test';
import type { AnswerRecord } from '../../src/progress/types';
import { practiceSession, progressWith, seed } from './seed';

const AT = '2026-11-11T09:00:00.000Z';
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

const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Heights of the visible buttons and option labels that are under 44px. */
const smallTargets = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('button, label.opt, a.link')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ text: el.textContent?.trim() ?? '', h: el.getBoundingClientRect().height }))
    .filter((t) => t.h < 44));

test('practice started from the Quiz tab opens a session with a radio group', async ({ page }) => {
  await page.goto('/#/quiz');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page).toHaveURL(/#\/quiz\/session$/);
  const group = page.getByRole('group');
  await expect(group).toBeVisible();
  await expect(group.getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Check' })).toBeDisabled();
});

test('a seeded practice answered wrong shows the verdict, Answer and Yours, and the notes link', async ({ page }) => {
  await seed(page, progressWith({ quizOpen: OPEN() }));
  await page.goto('/#/quiz/session');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();

  await page.locator('label.opt', { hasText: '25% to 70%, 6 to 8 litres/minute' }).click();   // tap row C
  await expect(page.getByRole('radio', { name: /^C / })).toBeChecked();
  await page.getByRole('button', { name: 'Check' }).click();

  await expect(page.getByText('Wrong: you picked C. The answer is B.')).toBeVisible();
  await expect(page.locator('label.opt', { hasText: '24 to 44%, 2 to 4 litres/minute' })).toContainText('Answer');
  await expect(page.locator('label.opt', { hasText: '25% to 70%, 6 to 8 litres/minute' })).toContainText('Yours');
  const link = page.getByRole('link', { name: /^Notes 11/ });
  await expect(link).toHaveAttribute('href', '#/notes/s11/oxygen-masks');
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
  await expect(page.locator('.primary')).toHaveCount(1);

  expect(await smallTargets(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);
  await page.screenshot({ path: 'test-results/shots/quiz-wrong.png', animations: 'disabled' });
});

test.describe('Review Focus 5: at 375px with the largest text', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const larger = (page: Page) => page.evaluate(() => { document.documentElement.dataset.textSize = 'larger'; });

  test('the session and the result never scroll sideways', async ({ page }) => {
    await seed(page, progressWith({ quizOpen: OPEN(), quizLast: LAST() }));
    await page.goto('/#/quiz/session');
    await expect(page.getByRole('group')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await larger(page);
    expect(await fitsWidth(page)).toBe(true);

    await page.locator('label.opt', { hasText: '25% to 70%, 6 to 8 litres/minute' }).click();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Wrong: you picked C. The answer is B.')).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'test-results/shots/quiz-wrong-375-larger.png', fullPage: true, animations: 'disabled' });

    await page.goto('/#/quiz/result');
    await expect(page.getByRole('heading', { level: 1, name: 'Practice results' })).toBeVisible();
    await larger(page);
    await expect(page.getByText('1 of 2 right')).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'test-results/shots/quiz-result-375-larger.png', fullPage: true, animations: 'disabled' });
  });

  test('a question with an ECG image fits too', async ({ page }) => {
    await seed(page, progressWith({ quizOpen: practiceSession(['mt-b-q197']) }));
    await page.goto('/#/quiz/session');
    const img = page.getByRole('img', { name: 'ECG strip for this question' });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await larger(page);
    expect(await fitsWidth(page)).toBe(true);
    await page.screenshot({ path: 'test-results/shots/quiz-image-375-larger.png', fullPage: true, animations: 'disabled' });
  });
});

test('a reload keeps what the app saved since the seed', async ({ page }) => {
  await seed(page, progressWith({ quizOpen: OPEN() }));
  await page.goto('/#/quiz/session');
  await page.locator('label.opt', { hasText: '25% to 70%, 6 to 8 litres/minute' }).click();   // save 2, slot 0
  await page.getByRole('button', { name: 'Check' }).click();                                    // save 3, slot 1: the seed's slot
  await expect(page.getByText('Wrong: you picked C. The answer is B.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Wrong: you picked C. The answer is B.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
});

test.describe('a double tap into the result never leaves it unseen', () => {
  const tapTwice = async (page: Page, name: string) => {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(x, y);   // lands on the result's key in the same place
    await page.waitForTimeout(400);
  };

  test('See results, then Practise 20 more in the same spot', async ({ page }) => {
    await seed(page, progressWith({ quizOpen: practiceSession(['mt-b-q115'], { 'mt-b-q115': ['a', 'b', 'c', 'd'] }) }));
    await page.goto('/#/quiz/session');
    await page.locator('label.opt', { hasText: '24 to 44%' }).tap();
    await page.getByRole('button', { name: 'Check' }).tap();
    await page.waitForTimeout(600);   // reading the feedback
    await tapTwice(page, 'See results');
    await expect(page).toHaveURL(/#\/quiz\/result$/);
    await expect(page.getByText('1 of 1 right')).toBeVisible();
  });

  test('Finish test, then New test or Done under it', async ({ page }) => {
    await seed(page, progressWith({ quizOpen: { ...practiceSession(['mt-b-q115'], { 'mt-b-q115': ['a', 'b', 'c', 'd'] }), mode: 'test' } }));
    await page.goto('/#/quiz/session');
    await page.locator('label.opt', { hasText: '24 to 44%' }).tap();
    await tapTwice(page, 'Finish test');
    await expect(page).toHaveURL(/#\/quiz\/result$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Test results' })).toBeVisible();
  });
});

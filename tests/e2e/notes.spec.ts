// Task 19: the notes section reader in the built app at phone width.
import { test, expect, type Page } from '@playwright/test';

const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Visible buttons and links under 44px tall. */
const smallTargets = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('button, a')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ text: el.textContent?.trim() ?? '', h: el.getBoundingClientRect().height }))
    .filter((t) => t.h < 44));

const ready = async (page: Page, title: string) => {
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

test.describe('Review Focus 5: at 375px with the largest text', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const larger = (page: Page) => page.evaluate(() => { document.documentElement.dataset.textSize = 'larger'; });

  test('the hospital-code table stays within the viewport, in a region that can scroll sideways on its own', async ({ page }) => {
    await page.goto('/#/notes/s02');
    await ready(page, '2. Secondary Survey');
    await larger(page);
    const region = page.getByRole('region', { name: 'Table: Code, Hospital, Code, Hospital' });
    await region.scrollIntoViewIfNeeded();
    expect(await fitsWidth(page)).toBe(true);
    const box = await region.evaluate((el) => ({ overflowX: getComputedStyle(el).overflowX, right: el.getBoundingClientRect().right }));
    expect(box.overflowX).toBe('auto');
    expect(box.right).toBeLessThanOrEqual(375);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'test-results/shots/reader-table-375-larger.png', animations: 'disabled' });
  });

  test('every section fits the width', async ({ page }) => {
    await page.goto('/#/notes/s01');
    await ready(page, '1. Primary Survey');
    await larger(page);
    for (let n = 1; n <= 20; n += 1) {
      const id = `s${String(n).padStart(2, '0')}`;
      await page.goto(`/#/notes/${id}`);
      await expect(page.getByText(`Section ${n} of 20`)).toBeVisible();
      await larger(page);
      expect(await fitsWidth(page), id).toBe(true);
      for (const r of await page.locator('.table-scroll').all()) {
        expect(await r.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth), id).toBe(true);
      }
    }
  });
});

test('an anchor lands its heading just under the sticky header', async ({ page }) => {
  await page.goto('/#/notes/s01/delicate-spine');
  await ready(page, '1. Primary Survey');
  const heading = page.locator('#delicate-spine');
  await expect(heading).toBeVisible();
  const [head, top] = await Promise.all([
    page.locator('.reader .mhead').evaluate((el) => el.getBoundingClientRect().bottom),
    heading.evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(top).toBeGreaterThanOrEqual(head);
  expect(top).toBeLessThan(head + 40);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  await page.screenshot({ path: 'test-results/shots/reader-anchor.png', animations: 'disabled' });
});

test('italics use the bundled Barlow italic, not a slanted upright', async ({ page }) => {
  await page.goto('/#/notes/s01');
  await ready(page, '1. Primary Survey');
  const em = page.locator('em', { hasText: '[Once activated for call, use MATRA/IDEN and report to Ops Ctr]' });
  await expect(em).toBeVisible();
  expect(await em.evaluate((el) => getComputedStyle(el).fontStyle)).toBe('italic');
  // A face loads only once text on the page uses it, so a loaded italic face means the italics are drawn with it.
  await expect.poll(() => page.evaluate(() => [...document.fonts]
    .filter((f) => f.family.replace(/["']/g, '') === 'Barlow' && f.style === 'italic' && f.status === 'loaded')
    .map((f) => f.weight))).toEqual(['400']);
  await em.screenshot({ path: 'test-results/shots/reader-italic.png', animations: 'disabled' });
});

test('the section 7 figure loads', async ({ page }) => {
  await page.goto('/#/notes/s07');
  const img = page.getByRole('img', { name: 'Figure 1: Auscultation (6 points)' });
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
});

test('full text and highlights only, with their screenshots', async ({ page }) => {
  await page.goto('/#/notes/s01');
  await ready(page, '1. Primary Survey');
  expect(await fitsWidth(page)).toBe(true);
  expect(await smallTargets(page)).toEqual([]);
  await expect(page.locator('.primary')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/shots/reader.png', animations: 'disabled' });

  await page.getByRole('button', { name: 'Highlights only' }).click();
  await expect(page.getByRole('button', { name: 'Highlights only' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'Approach Patient' })).toBeVisible();
  await expect(page.locator('mark', { hasText: 'NEVER move the patient' })).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
  await page.screenshot({ path: 'test-results/shots/reader-highlights.png', animations: 'disabled' });
});

test('the text size key resizes the page and keeps the setting', async ({ page }) => {
  await page.goto('/#/notes/s01');
  await ready(page, '1. Primary Survey');
  const size = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await size()).toBe('16px');
  await page.getByRole('button', { name: 'Text size: Standard' }).click();
  await expect(page.getByRole('button', { name: 'Text size: Large' })).toBeVisible();
  await expect.poll(size).toBe('18px');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Text size: Large' })).toBeVisible();
  expect(await size()).toBe('18px');
});

test('next turns the page, and Close goes back to the Notes tab', async ({ page }) => {
  await page.goto('/#/notes');
  await page.locator('a[href="#/notes/s01"]').click();
  await ready(page, '1. Primary Survey');
  await page.getByRole('link', { name: /^Next section: 2\. Secondary Survey/ }).click();
  await ready(page, '2. Secondary Survey');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/#\/notes$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Notes' })).toBeVisible();
});

test('Back from a search hit lands on the results, and Clear takes the query out of the address (M3)', async ({ page }) => {
  await page.goto('/#/notes');
  const field = page.getByRole('searchbox', { name: 'Search your notes' });
  await field.fill('ensapa');
  await expect(page).toHaveURL(/#\/notes\?q=ensapa$/);
  await page.getByRole('list', { name: 'Matches' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/#\/notes\/s01\?b=\d+$/);
  await ready(page, '1. Primary Survey');
  await page.goBack();
  await expect(page.getByRole('list', { name: 'Matches' })).toBeVisible();
  await expect(field).toHaveValue('ensapa');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page).toHaveURL(/#\/notes$/);
  await expect(page.getByRole('list', { name: 'Sections' })).toBeVisible();
});

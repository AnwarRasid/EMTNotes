// Task 21: the installed app works with no connection once it has been opened online: the service worker precaches
// the app, the question bank, the notes and their images, and takes over the page that installed it, so the first
// session works offline too. With service workers blocked (Task 22's screens run that way), the app still works
// online and says nothing about offline.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const OFFLINE = "You're offline. Everything still works.";

/** Goes offline and waits until the page has had its offline event (and a moment to answer it). The listener goes
 *  in first, so the event can't slip past it. */
async function goOffline(page: Page, context: BrowserContext): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { wentOffline?: Promise<void> }).wentOffline = new Promise<void>((done) => {
      window.addEventListener('offline', () => setTimeout(done, 300), { once: true });
    });
  });
  await context.setOffline(true);
  await page.evaluate(() => (window as unknown as { wentOffline?: Promise<void> }).wentOffline);
}

test('opened once online, it works offline: the quiz bank, the notes and the section 7 figure', async ({ page, context }) => {
  test.setTimeout(60_000);   // room for the 30 s wait below and everything after it
  await page.goto('/');
  // The worker precaches the whole app (about 4 MB) before it says so: this runs first, while every other worker
  // opens its own pages from the same preview server, so it gets longer than the usual 5 s (Task 20).
  await expect(page.getByText('Ready to use offline.')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Saved for offline use.')).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(OFFLINE)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Quiz' }).click();
  await expect(page.getByText('0 of 346 answered')).toBeVisible();

  await page.goto('/#/notes/s07');
  await expect(page.getByRole('heading', { level: 1, name: '7. Auscultation (6 points)' })).toBeVisible();
  const img = page.locator('img[src$="img/notes/s07-1.png"]');
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  // Once only: the flag was saved before the reload, so going offline again says nothing.
  await expect(page.getByText(OFFLINE)).toHaveCount(0);
  await context.setOffline(false);
  await goOffline(page, context);
  await expect(page.getByText(OFFLINE)).toHaveCount(0);
});

test('in the first session, with no reload: the worker takes over, Settings says so, and offline it all loads', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => { (window as unknown as { firstLoad?: boolean }).firstLoad = true; });
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((done) => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
  });
  await expect(page.getByText('Saved for offline use.')).toBeVisible();   // flipped live, on controllerchange

  await goOffline(page, context);
  // It may queue behind this session's "Ready to use offline.", up to its 5 s.
  await expect(page.getByText(OFFLINE)).toBeVisible({ timeout: 10_000 });

  // Nothing below was loaded online in this session: it all comes from the precache.
  await page.goto('/#/notes/s07');
  await expect(page.getByRole('heading', { level: 1, name: '7. Auscultation (6 points)' })).toBeVisible();
  const img = page.locator('img[src$="img/notes/s07-1.png"]');
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Quiz' }).click();
  await expect(page.getByText('0 of 346 answered')).toBeVisible();
  const statuses = await page.evaluate(() => Promise.all(
    ['./data/steps.json', './data/cases/index.json', './img/q/mt-b-q197.png'].map((u) => fetch(u).then((r) => r.status))));
  expect(statuses).toEqual([200, 200, 200]);

  expect(await page.evaluate(() => (window as unknown as { firstLoad?: boolean }).firstLoad)).toBe(true);   // never reloaded
});

test.describe('with service workers blocked', () => {
  test.use({ serviceWorkers: 'block' });

  test('the app still loads and works, says nothing about offline, and throws nothing', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByText(/of 346 answered/)).toBeVisible();
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByText('Not saved for offline use yet. Open the app once with a connection.')).toBeVisible();
    await page.waitForTimeout(1_500);   // time for a registration to have failed
    await expect(page.getByText('Ready to use offline.')).toHaveCount(0);
    await expect(page.getByText('A new version is ready.')).toHaveCount(0);

    // Offline here, "Everything still works." would be untrue: nothing is cached.
    await goOffline(page, context);
    await expect(page.getByText(OFFLINE)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { SCHEMA_VERSION } from '../../src/progress/types';

test('the shell at 390px: four tab links of 44px or more, no sideways scroll', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  const tabs = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
  await expect(tabs).toHaveText(['Today', 'PAM', 'Quiz', 'Notes']);
  for (const tab of await tabs.all()) {
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);

  await page.screenshot({ path: 'test-results/shots/shell.png' });
});

test.describe('saves held back, and motion', () => {
  // No service worker: its "Ready to use offline." toast would land in the middle of these.
  test.use({ serviceWorkers: 'block' });

  const ANOTHER_WINDOW = 'Your progress changed in another window. Reload this one to keep going.';
  const NEWER_VERSION = 'This copy of EMTNotes is out of date. Reload to update.';

  test("a save in another window raises the Reload banner here at once, and Reload picks that save up (I2)", async ({ context }) => {
    const mine = await context.newPage();
    const other = await context.newPage();
    await mine.goto('/#/settings');
    await other.goto('/#/settings');
    await expect(mine.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(other.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await other.getByRole('radio', { name: 'Larger' }).check();   // the other window saves
    const banner = mine.locator('.banner');
    await expect(banner.getByText(ANOTHER_WINDOW)).toBeVisible();
    await expect(banner.getByText("Changes made here aren't saved.")).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
    await expect(other.locator('.banner')).toHaveCount(0);   // never in the window that saved
    await mine.screenshot({ path: 'test-results/shots/reload-banner.png', animations: 'disabled' });

    await mine.getByRole('link', { name: 'Notes' }).click();   // it stays across screens
    await expect(banner.getByText(ANOTHER_WINDOW)).toBeVisible();
    await banner.getByRole('button', { name: 'Reload' }).click();
    await expect(mine.locator('.banner')).toHaveCount(0);
    await expect.poll(() => mine.evaluate(() => document.documentElement.dataset.textSize)).toBe('larger');
  });

  test("a newer version's save is never written over: this copy says it is out of date (I1)", async ({ page }) => {
    // A save from the next version of the app (one above this build's SCHEMA_VERSION), in slot 1 as seq 1.
    await page.addInitScript((v: number) => {
      if (sessionStorage.getItem('crewleader.e2e.newer') !== null) return;
      localStorage.setItem('crewleader.save.1', JSON.stringify({ v, seq: 1, savedAt: '2026-12-01T09:00:00.000Z', sum: 'whatever it uses', data: { runs: [{ id: 'kept' }] } }));
      sessionStorage.setItem('crewleader.e2e.newer', '1');
    }, SCHEMA_VERSION + 1);
    await page.goto('/#/settings');
    const newer = await page.evaluate(() => localStorage.getItem('crewleader.save.1'));
    await expect(page.locator('.banner').getByText(NEWER_VERSION)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start fresh' })).toHaveCount(0);

    await page.getByRole('radio', { name: 'Larger' }).check();   // would save, if anything could
    await page.getByLabel('Type RESET to confirm').fill('RESET');
    await page.getByRole('button', { name: 'Reset progress' }).click();
    await expect(page.getByText('Progress reset in this window, but not saved.')).toBeVisible();
    expect(await page.evaluate(() => [localStorage.getItem('crewleader.save.0'), localStorage.getItem('crewleader.save.1')]))
      .toEqual([null, newer]);
  });

  /** The animation a toast would run, read from a probe element under the app's own class names. */
  const toastMotion = (page: Page, classes: string, focus = false) => page.evaluate(([c, f]) => {
    const app = document.createElement('div');
    app.className = f ? 'app app-focus' : 'app app-tabs';
    const el = document.createElement('div');
    el.className = c;
    app.append(el);
    document.body.append(app);
    const cs = getComputedStyle(el);
    const motion = { name: cs.animationName, ms: Math.round(parseFloat(cs.animationDuration) * 1000) };
    app.remove();
    return motion;
  }, [classes, focus] as const);

  const keyframes = (page: Page, name: string) => page.evaluate((n) => {
    for (const sheet of [...document.styleSheets]) {
      for (const rule of [...sheet.cssRules]) if (rule instanceof CSSKeyframesRule && rule.name === n) return rule.cssText;
    }
    return null;
  }, name);

  test('reduced motion keeps the toast fades, opacity only and 150 ms at most, and drops movement (M7, spec §9)', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(await toastMotion(page, 'toast')).toEqual({ name: 'toast-in', ms: 220 });   // full motion: it rises in

    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [classes, focus] of [['toast', false], ['toast', true]] as const) {
      const motion = await toastMotion(page, classes, focus);
      expect(motion.name, `${classes}${focus ? ' on a focus screen' : ''}`).toBe('toast-fade-in');
      expect(motion.ms).toBeGreaterThan(0);
      expect(motion.ms).toBeLessThanOrEqual(150);
    }
    const out = await toastMotion(page, 'toast toast-out');
    expect(out.name).toBe('toast-out');
    expect(out.ms).toBeLessThanOrEqual(150);
    for (const name of ['toast-fade-in', 'toast-out']) {
      const css = await keyframes(page, name);
      expect(css, name).toMatch(/opacity/);
      expect(css, name).not.toMatch(/transform|translate/);
    }
    // Everything that moves stays still: the quiz's ring and shake, the skeleton's pulse.
    for (const classes of ['opt opt-ok', 'sk-row']) expect((await toastMotion(page, classes)).name, classes).toBe('none');

    // A real toast, end to end: it shows, fading in.
    await page.getByLabel('Type RESET to confirm').fill('RESET');
    await page.getByRole('button', { name: 'Reset progress' }).click();
    await expect(page.locator('.toast')).toBeVisible();
    expect(await page.locator('.toast').evaluate((el) => getComputedStyle(el).animationName)).toBe('toast-fade-in');
  });
});

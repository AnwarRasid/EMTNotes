// Plan 3 Task 12: voice input in the built app, on both projects (the 390px phone and the Pixel 7), against a fake speech
// recogniser (fakeSpeech): no real mic is ever used. A dictated line goes into the field with soft breaks, shows whole
// as "Your line:", and is sent only by Send (D4); a second tap on Speak stops listening and keeps the words (D3); a
// refused mic says what to do; a Pause drops the listening; the voice composer fits 360px.
import { test, expect, type Page } from '@playwright/test';
import { defaultProgress, type RunSession } from '../../src/progress/types';
import { softBreaks } from '../../src/sim/softBreaks';
import { fakeSpeech, playRun, progressWith, seed } from './seed';

// No service worker: its "Ready to use offline." toast would queue ahead of the voice toasts.
test.use({ serviceWorkers: 'block' });

/** The Giddiness case, the only one under that complaint; its patient is "Mr Lim". */
const GIDDY = 'hypo-hougang-01';
/** The call to Ops as Android Chrome's recogniser gives it: one run of words, no punctuation. */
const DICTATED = 'fmv 123 to ops ctr responding to blk 4xx hougang ave 8 for case of elderly male giddiness';
/** Two sentences for two people, said as one run of words. */
const TWO = 'buddy do a head grip sir what is bothering you';
const MIC_REFUSED = "EMTNotes can't use the mic. Allow it in Chrome's site settings, or type instead.";

const chat = (page: Page) => page.getByRole('log', { name: 'Run chat' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Speak to the scene' });
const speak = (page: Page) => page.getByRole('button', { name: 'Speak' });
const status = (page: Page) => page.locator('.composer [role=status]');
/** The row over the keys: "Hearing: …" while listening, then "Your line: …" (Composer's HearRow), shown, not read out. */
const hearRow = (page: Page) => page.locator('.composer-hear');

/** What the fake recogniser has done so far (fakeSpeech's log). */
const speechLog = (page: Page) => page.evaluate(() => (window as unknown as { __fakeSpeech?: string[] }).__fakeSpeech ?? []);
/** Gives the fake's newest listening its result now, if it still has one pending (fakeSpeech's manual mode). */
const giveResult = (page: Page) => page.evaluate(() => (window as unknown as { __fakeSpeechGive(): void }).__fakeSpeechGive());

/** The run screen up, with its case's content in (the chat shows the activation). */
async function runReady(page: Page): Promise<void> {
  await expect(chat(page).locator('.syscard').first()).toHaveText(/^Dispatch: Activation: /);
  await expect(field(page)).toBeEnabled();
}

/** A seeded run, answered by Voice (a setting, not the run's), open on #/run. */
async function voiceRun(page: Page, runOpen: RunSession): Promise<void> {
  await seed(page, progressWith({ runOpen, settings: { ...defaultProgress().settings, answerBy: 'voice' } }));
  await page.goto('/#/run');
  await runReady(page);
  await expect(speak(page)).toBeVisible();
}

/** Speak pressed, and the fake listening: the key pressed, the status line and the row say so. */
async function listening(page: Page): Promise<void> {
  await speak(page).click();
  await expect(speak(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toHaveText('Listening.');
  await expect(hearRow(page)).toHaveText('Hearing: …');
}

test('a dictated line goes into the field with soft breaks, shows whole as "Your line:", and only Send sends it', async ({ page }) => {
  await page.addInitScript(fakeSpeech([DICTATED]));
  await page.goto('/#/pam/start');
  await expect(page.getByRole('heading', { level: 1, name: 'New case' })).toBeVisible();
  await page.getByRole('radio', { name: 'Voice' }).check();
  await expect(page.getByRole('radio', { name: 'Voice' })).toBeChecked();
  await page.getByRole('radio', { name: 'Pick by complaint' }).check();
  await page.getByRole('button', { name: 'Giddiness' }).click();
  await expect(page.getByRole('button', { name: 'Giddiness' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Take the call' }).click();

  await expect(page).toHaveURL(/#\/run$/);
  await runReady(page);
  await speak(page).click();
  const heard = softBreaks(DICTATED, 'Mr Lim');
  await expect(field(page)).toHaveValue(heard);
  await expect(status(page)).toHaveText('Added to your line.');
  // The key lets go once the result is in, and the whole line shows over the keys for checking, hidden from TalkBack
  // (the field and the status line say it).
  await expect(speak(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(hearRow(page)).toHaveText(`Your line: ${heard}`);
  await expect(hearRow(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(chat(page).locator('.msg.me')).toHaveCount(0);   // voice never sends (D4)
  expect(await speechLog(page)).toEqual(['start', `result:${DICTATED}`, 'end']);

  await page.getByRole('button', { name: 'Send' }).click();
  const mine = chat(page).locator('.msg.me');
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.bub')).toHaveText(`You: ${heard}`);   // after its hidden speaker prefix
  await expect(mine.locator('.route')).toHaveText(/^To Ops Ctr: /);
  await expect(field(page)).toHaveValue('');
  await expect(hearRow(page)).toHaveCount(0);
});

test('a second tap on Speak stops listening and keeps what was heard, unsent', async ({ page }) => {
  await page.addInitScript(fakeSpeech([TWO], { manual: true }));   // the result comes only when listening stops
  await voiceRun(page, await playRun(GIDDY, 'coached', []));
  await listening(page);
  await speak(page).click();
  await expect.poll(() => speechLog(page)).toEqual(['start', 'stop', `result:${TWO}`, 'end']);
  await expect(field(page)).toHaveValue(softBreaks(TWO, 'Mr Lim'));
  await expect(speak(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(status(page)).toHaveText('Added to your line.');
  await expect(chat(page).locator('.msg.me')).toHaveCount(0);
});

test('a refused mic says how to allow it, or to type instead', async ({ page }) => {
  await page.addInitScript(fakeSpeech([], { error: 'not-allowed' }));
  await voiceRun(page, await playRun(GIDDY, 'coached', []));
  await speak(page).click();
  await expect(page.getByText(MIC_REFUSED, { exact: true })).toBeVisible();
  await expect(speak(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(field(page)).toHaveValue('');
  await expect(chat(page).locator('.msg.me')).toHaveCount(0);
});

test('Pause while listening drops the listening: nothing is added once the sheet is open', async ({ page }) => {
  // Manual: the fake listens until told, so the test waits for listening before it pauses, with no timer to race
  // (review M5; the brief's 500 ms timer could fire while a busy host was still asserting).
  await page.addInitScript(fakeSpeech(['buddy do a head grip'], { manual: true }));
  await voiceRun(page, await playRun(GIDDY, 'coached', []));
  await listening(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paused' });
  await expect(sheet).toBeVisible();
  await expect.poll(() => speechLog(page)).toContain('abort');
  // The result the fake was holding, given now: an aborted listening has none, so nothing comes.
  await giveResult(page);
  expect((await speechLog(page)).filter((e) => e.startsWith('result:'))).toEqual([]);
  await expect(field(page)).toHaveValue('');
  await sheet.getByRole('button', { name: 'Resume' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(field(page)).toHaveValue('');
  await expect(speak(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(chat(page).locator('.msg.me')).toHaveCount(0);
});

test.describe('at 360×780', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("the voice composer keeps a field of 160px or more, and the page doesn't scroll sideways", async ({ page }) => {
    await page.addInitScript(fakeSpeech([]));
    await voiceRun(page, await playRun(GIDDY, 'coached', []));   // Coached: the Step list key is in the row too
    await expect(page.getByRole('button', { name: 'Step list' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const box = await field(page).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(160);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

// Plan 3 Task 12: the smart tester in the built app, on both projects (the 390px phone and the Pixel 7), against a fake
// Claude API: page.route answers every Messages call, and every other request to api.anthropic.com is aborted, so no
// test ever reaches the real API. The key is a made-up one, seeded where the app keeps it (crewleader.smart, D16).
// - A credit: a sentence the keyword rules read nothing in goes to the tester, masked (D17), with the SDK's own auth
//   header (Authorization: Bearer, SDK 1.8.0; Task 9 review) and the browser-access header; its credit shows on the line,
//   and the key stays out of progress. A line naming the patient and an IC reaches the tester masked.
// - A slow answer (over the 6 s budget) or a refusal leaves the keyword reading, with one toast a run (D14, D19); a slow
//   one shows its line pending, "Checking…", until then.
// - Offline, or with the tester off, nothing is sent.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page, type Request } from '@playwright/test';
import { SLOT_KEYS } from '../../src/progress/slots';
import type { SmartVerdict } from '../../src/sim/smart';
import { SMART_STORAGE_KEY } from '../../src/smart/settings';
import { COPD, canonicalLine, playRun, progressWith, seed, seedSmart } from './seed';

// No service worker: its "Ready to use offline." toast would queue ahead of the tester's.
test.use({ serviceWorkers: 'block' });
// A slow answer waits out the tester's 6 s budget twice, and its toast's reading time between.
test.describe.configure({ timeout: 90_000 });

/** A made-up key: never a real one. */
const KEY = 'sk-ant-e2e-0000';
/** The tester's one toast a run (src/run/useRun.ts SMART_FAILED). */
const SMART_FAILED = "The smart tester didn't answer, so the keyword rules graded that line.";
/** A pending line's route (src/run/Chat.tsx CHECKING), and the composer's status meanwhile (src/run/Run.tsx CHECKING_LINE). */
const CHECKING = 'Checking…';
const CHECKING_LINE = 'Checking your line.';
/** The COPD case as its file has it: what D17 says never leaves the phone. */
const COPD_FILE = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../../public/data/cases/${COPD}.json`),
  'utf8')) as { area: string; location: string; patient: { name: string; callName: string; ic: string } };

/** Steps 1 to 7 (the call to the level of response) as their canonical lines: a run at step 8, Delicate spine. */
const SEVEN = ['respond-call', 'call-caller', 'preparation', 'scene-evaluation', 'approach-patient', 'introduction', 'loc-avpu']
  .map((id) => canonicalLine(COPD, id));
/** "Did you fall?" reads ask-fall by the keyword rules; "Any ouch at your nape?" reads nothing at step 7 (pre-flight
 *  finding 1), so it alone is sent. */
const NAPE = 'Mdm Tan, did you fall? Any ouch at your nape?';
/** A second sentence the keyword rules read nothing in, for a second check in the same run. */
const SORE = 'Does your nape feel sore?';
/** Two sentences the keyword rules read nothing in, holding the call name, the full name and the IC typed one x short. */
const NAMED = `${COPD_FILE.patient.callName}, any ache at your nape? Is S54xxxxA on your card, ${COPD_FILE.patient.name}?`;
/** The tester's credit for NAPE's second sentence: Delicate spine's neck pain question. */
const CREDIT: SmartVerdict = { sentences: [{ index: 1, points: [{ key: 'delicate-spine/ask-neck-pain', parts: [] }] }] };

const chat = (page: Page) => page.getByRole('log', { name: 'Run chat' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Speak to the scene' });
const lastMine = (page: Page) => chat(page).locator('.msg.me').last();
const pending = (page: Page) => page.locator('.chat-pending .msg.pending');
const composerStatus = (page: Page) => page.locator('.composer [role=status]');

/** What the fake API answers: a verdict, its stop reason, and how long it takes. */
interface Answer { verdict?: SmartVerdict; stopReason?: 'end_turn' | 'refusal'; delayMs?: number }

/**
 * The fake API. Every request to api.anthropic.com is aborted and listed in `other`, unless it is a Messages call:
 * that is listed in `calls` and answered with a Messages body whose one text block is `verdict` as JSON (an empty
 * verdict by default), `stop_reason` 'end_turn' unless given, and 900 tokens in and 40 out, after `delayMs`. A CORS
 * preflight, if one reaches the route, is allowed.
 */
async function fakeApi(page: Page, answer: Answer = {}): Promise<{ calls: Request[]; other: string[] }> {
  const calls: Request[] = [];
  const other: string[] = [];
  await page.route('https://api.anthropic.com/**', (route) => {
    other.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await page.route('**/v1/messages*', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': (await req.allHeaders())['access-control-request-headers'] ?? '*',
      } });
    }
    calls.push(req);
    if (answer.delayMs !== undefined) await new Promise((done) => setTimeout(done, answer.delayMs));
    const body = {
      id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(answer.verdict ?? { sentences: [] }) }],
      stop_reason: answer.stopReason ?? 'end_turn', stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 40 },
    };
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body) });
    } catch {
      // the check gave up first (its 6 s budget) and dropped the request
    }
  });
  return { calls, other };
}

/**
 * Stamps, in the page and on its own clock (performance.now()), each line sent (the composer form's submit, caught
 * first) in window.__sent, each trainee line joining the chat's log in window.__joined with its text, and each toast's
 * message as it shows in window.__toasts (a toast shown twice is two entries). Stamped where it happens, a time is free
 * of the test's polling (review M4).
 */
async function stamp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __sent: number[]; __joined: { text: string; at: number }[]; __toasts: string[] };
    w.__sent = [];
    w.__joined = [];
    w.__toasts = [];
    document.addEventListener('submit', () => { w.__sent.push(performance.now()); }, true);
    new MutationObserver((records) => {
      const at = performance.now();
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.classList.contains('toast')) w.__toasts.push(n.querySelector('.toast-msg')?.textContent ?? '');
          if (n.matches('.msg.me') && n.closest('[role=log]') !== null) w.__joined.push({ text: n.querySelector('.bub')?.textContent ?? '', at });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
/** How many times a toast saying exactly `text` has shown. */
const toastsSaying = (page: Page, text: string) =>
  page.evaluate((t) => (window as unknown as { __toasts: string[] }).__toasts.filter((x) => x === t).length, text);
/** The ms from the `n`-th line sent to `text` joining the chat's log, both stamped in the page. */
const msToJoin = (page: Page, n: number, text: string) => page.evaluate(([i, t]) => {
  const w = window as unknown as { __sent: number[]; __joined: { text: string; at: number }[] };
  const joined = w.__joined.find((j) => j.text === `You: ${t}`);
  const sent = w.__sent[i as number];
  return joined === undefined || sent === undefined ? null : joined.at - sent;
}, [n, text] as const);

/** The COPD run at step 8 (SEVEN said, by the keyword rules in this process), Coached, open on #/run. */
async function atStep8(page: Page): Promise<void> {
  await seed(page, progressWith({ runOpen: await playRun(COPD, 'coached', SEVEN) }));
  await page.goto('/#/run');
  await expect(chat(page).locator('.syscard').first()).toHaveText(/^Dispatch: Activation: /);
  await expect(field(page)).toBeEnabled();
}

/** Sends `text` from the composer, and returns at once. */
async function send(page: Page, text: string): Promise<void> {
  await field(page).fill(text);
  await field(page).press('Enter');
}

/** Sends `text`; returns once it is the chat's newest line of the trainee's (a pending line sits outside the log). */
async function say(page: Page, text: string, timeout?: number): Promise<void> {
  await send(page, text);
  await expect(lastMine(page).locator('.bub')).toHaveText(`You: ${text}`, { timeout });
}

/** The route the keyword rules alone give `line`, said after SEVEN (and `before`), as the run engine plays it here. */
async function keywordRoute(line: string, before: string[] = []): Promise<string> {
  const s = await playRun(COPD, 'coached', [...SEVEN, ...before, line]);
  const route = s.lines.filter((l) => l.who === 'you').at(-1)?.route;
  if (route === undefined) throw new Error(`No route for "${line}".`);
  return route;
}

/** The case's own values D17 says never leave the phone (each read from its file), and the IC as NAMED types it. */
const CASE_VALUES = [COPD_FILE.patient.ic, 'S54xxxxA', COPD_FILE.patient.name, COPD_FILE.patient.callName, COPD_FILE.location,
  COPD_FILE.area];
/** Expects `body` to hold none of CASE_VALUES, in any case, nor the surname as a word. */
function expectNoCaseValue(body: string): void {
  const lower = body.toLowerCase();
  for (const value of CASE_VALUES) expect(lower, 'a case value D17 never sends').not.toContain(value.toLowerCase());
  expect(lower, 'the surname').not.toMatch(/\btan\b/);
}
/** The check's sentences, as the request's user message carries them. */
const sentencesOf = (body: string) =>
  (JSON.parse((JSON.parse(body) as { messages: { content: string }[] }).messages[0]!.content) as { sentences: unknown }).sentences;

test('a sentence the keyword rules read nothing in goes to the tester, masked, and its credit shows on the line', async ({ page }) => {
  await seedSmart(page, { on: true, key: KEY });
  const api = await fakeApi(page, { verdict: CREDIT });
  await atStep8(page);
  await say(page, NAPE);
  await expect(lastMine(page).locator('.stag')).toContainText('Smart tester');
  await expect(lastMine(page).locator('.route')).not.toContainText('Not sure what this is.');

  expect(api.calls).toHaveLength(1);
  expect(api.other).toEqual([]);
  const call = api.calls[0]!;
  expect(call.url()).toBe('https://api.anthropic.com/v1/messages');
  const headers = await call.allHeaders();
  expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(headers.authorization).toBe(`Bearer ${KEY}`);
  expect(headers).not.toHaveProperty('x-api-key');

  const body = call.postData() ?? '';
  expectNoCaseValue(body);
  expect((JSON.parse(body) as { model: string }).model).toBe('claude-opus-5-5');
  expect(sentencesOf(body)).toEqual([{ index: 1, text: 'Any ouch at your nape?' }]);

  // The check's spend is counted where the key is kept, and the key is in no other storage: not in either progress slot
  // (both written by now: the seed's, and the app's save of the line), nor in the session's.
  const stored = await page.evaluate(({ key, slots }) => ({
    holding: [
      ...Object.keys(localStorage).filter((k) => (localStorage.getItem(k) ?? '').includes(key)),
      ...Object.keys(sessionStorage).filter((k) => (sessionStorage.getItem(k) ?? '').includes(key)).map((k) => `session:${k}`),
    ],
    slots: slots.map((k) => localStorage.getItem(k) !== null),
    checks: (JSON.parse(localStorage.getItem('crewleader.smart') ?? '{}') as { checks?: number }).checks,
  }), { key: KEY, slots: [...SLOT_KEYS] });
  expect(stored.holding).toEqual([SMART_STORAGE_KEY]);
  expect(stored.slots).toEqual([true, true]);
  expect(stored.checks).toBe(1);
});

test('a line naming the patient and an IC reaches the tester masked, as "the patient" and "the IC"', async ({ page }) => {
  await seedSmart(page, { on: true, key: KEY });
  const api = await fakeApi(page);   // no credit: the line keeps its keyword reading
  await atStep8(page);
  await say(page, NAMED);
  await expect(lastMine(page).locator('.route')).toHaveText(await keywordRoute(NAMED));
  expect(api.calls).toHaveLength(1);
  expect(api.other).toEqual([]);
  const body = api.calls[0]!.postData() ?? '';
  expect(sentencesOf(body)).toEqual([
    { index: 0, text: 'the patient, any ache at your nape?' },
    { index: 1, text: 'Is the IC on your card, the patient?' },
  ]);
  expectNoCaseValue(body);
});

test('an answer slower than 6 s shows the line pending, then leaves the keyword reading within 7 s, and the run toasts once', async ({ page }) => {
  await seedSmart(page, { on: true, key: KEY });
  await stamp(page);
  const api = await fakeApi(page, { verdict: CREDIT, delayMs: 8_000 });
  await atStep8(page);
  const mine = chat(page).locator('.msg.me');
  await expect(mine).toHaveCount(7);

  await send(page, NAPE);
  // While the check is out: the line waits under the log, "Checking…", and the composer's status line says so.
  await expect(pending(page)).toHaveCount(1);
  await expect(pending(page).locator('.bub')).toHaveText(NAPE);
  await expect(pending(page).locator('.route')).toHaveText(CHECKING);
  await expect(composerStatus(page)).toHaveText(CHECKING_LINE);
  await expect(mine).toHaveCount(7);
  // Then it joins the log once, with the keyword route, and nothing is pending.
  await expect(lastMine(page).locator('.bub')).toHaveText(`You: ${NAPE}`, { timeout: 10_000 });
  expect(await msToJoin(page, 0, NAPE)).toBeLessThan(7_000);
  await expect(mine).toHaveCount(8);
  await expect(pending(page)).toHaveCount(0);
  await expect(composerStatus(page)).toHaveText('');
  await expect(lastMine(page).locator('.route')).toHaveText(await keywordRoute(NAPE));
  await expect(lastMine(page).locator('.stag')).toHaveCount(0);
  await expect(page.getByText(SMART_FAILED, { exact: true })).toBeVisible();
  expect(api.calls).toHaveLength(1);

  // A second check in the run, once the first toast has gone, fails the same way and toasts nothing more: a second
  // toast would have to show anew, not merge into one still showing.
  await expect(page.getByText(SMART_FAILED, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await say(page, SORE, 10_000);
  expect(await msToJoin(page, 1, SORE)).toBeLessThan(7_000);
  await expect(mine).toHaveCount(9);
  await expect(lastMine(page).locator('.route')).toHaveText(await keywordRoute(SORE, [NAPE]));
  expect(api.calls).toHaveLength(2);
  expect(await toastsSaying(page, SMART_FAILED)).toBe(1);
  await expect(page.getByText(SMART_FAILED, { exact: true })).toHaveCount(0);
  expect(api.other).toEqual([]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });   // the two answers still waiting are never wanted
});

test('a refusal, answered at once, leaves the keyword reading the same way (D19)', async ({ page }) => {
  await seedSmart(page, { on: true, key: KEY });
  await stamp(page);
  const api = await fakeApi(page, { verdict: CREDIT, stopReason: 'refusal' });
  await atStep8(page);
  await say(page, NAPE);
  await expect(lastMine(page).locator('.route')).toHaveText(await keywordRoute(NAPE));
  await expect(lastMine(page).locator('.stag')).toHaveCount(0);
  await expect(page.getByText(SMART_FAILED, { exact: true })).toBeVisible();
  expect(api.calls).toHaveLength(1);
  expect(await toastsSaying(page, SMART_FAILED)).toBe(1);
});

test('offline, the same line sends nothing and keeps its keyword reading, without a toast', async ({ page, context }) => {
  await seedSmart(page, { on: true, key: KEY });
  await stamp(page);
  const api = await fakeApi(page, { verdict: CREDIT });   // a credit, were anything sent
  await atStep8(page);
  await context.setOffline(true);
  await say(page, NAPE);
  await expect(lastMine(page).locator('.route')).toHaveText(await keywordRoute(NAPE));
  await expect(lastMine(page).locator('.stag')).toHaveCount(0);
  expect(api.calls).toEqual([]);
  expect(api.other).toEqual([]);
  expect(await toastsSaying(page, SMART_FAILED)).toBe(0);
});

test('with the tester off, a 6-line run sends nothing at all', async ({ page }) => {
  await seedSmart(page, { on: false, key: KEY });
  const api = await fakeApi(page, { verdict: CREDIT });
  await seed(page, progressWith({ runOpen: await playRun(COPD, 'coached', []) }));
  await page.goto('/#/run');
  await expect(chat(page).locator('.syscard').first()).toHaveText(/^Dispatch: Activation: /);
  // Steps 1 to 6: the call to the caller holds "We are on our way to your place now.", which the tester, on, checks.
  for (const line of SEVEN.slice(0, 6)) await say(page, line);
  await expect(chat(page).locator('.msg.me')).toHaveCount(6);
  await expect(chat(page).locator('.stag')).toHaveCount(0);
  expect(api.calls).toEqual([]);
  expect(api.other).toEqual([]);
});

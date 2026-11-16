// Task 20: the save budget profile, on the Pixel 7 only (ruling W2: CPU throttling goes through Chromium's CDP). The
// run is saved after every line (Global Constraints), so the save must stay quick on a mid-range Android phone with a
// heavy history: a median of 30 ms or less and a max of 80 ms or less at 4× CPU throttle. The store times each save as
// the User Timing measure 'crewleader:save' (Task 2). The max leaves out the first save, the warm-up (ruling D12).
// A run at RUN_LIMITS' caps is profiled too, logged for the controller to rule on rather than held to the budget (Task 2
// carry).
// The budget is judged only on a quiet host (Task 20 ruling): the host's CPU use is read before the throttle is set and
// after the lines are sent, and at HOST_BUSY_PCT or more in either the figures are logged and the test skips, its
// thresholds unchanged. Every test logs both readings, and the budget test logs whether it judged and why not.
// A whole-suite run loads the host itself (6 workers), so the budget is judged in a run of its own:
//   npx playwright test tests/e2e/perf.spec.ts --project=pixel --workers=1
import { cpus } from 'node:os';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { SAVE_ERROR } from '../../src/progress/store';
import { RUN_LIMITS, addRunRecord, type Progress, type QStat, type RunSession, type TranscriptLine } from '../../src/progress/types';
import { COPD, COPD_GAP_MS, COPD_TO_BREATHING, copdRecord, playRun, progressWith, seed } from './seed';

// No service worker: its toast and its caching would land in the middle of the timings.
test.use({ serviceWorkers: 'block' });
// A throttled phone renders a 400-line run slowly.
test.describe.configure({ timeout: 180_000 });

const BUDGET = { medianMs: 30, maxMs: 80 } as const;
/** At this much of the host's CPU in use, or more, the timings say more about the host than the save path. */
const HOST_BUSY_PCT = 40;
const SAVE = 'crewleader:save';
const AT = '2026-11-11T09:00:00.000Z';

/** Twelve lines for Mdm Tan's run from step 10 on: the oxygen put right, then circulation to the vital signs. */
const LINES = [
  'Buddy, change to a nasal cannula at 2 litres. I will monitor the patient closely after giving oxygen.',
  'Is there any cyanosis of lips, nasal flaring, tracheal tugging, pursed lips or use of accessory muscles?',
  'Checking the radial pulse. Is there pulse? What is the rate and quality of the pulse?',
  "Sir/Ma'am, I'm going to conduct a Rapid Body Survey to check for any life or limb threatening injuries. Please allow me.",
  'Head, neck, chest, abdomen, pelvis, lower extremities, upper extremities and back, with eye contact.',
  'Checking my gloves for sweat or blood. Are there any abnormalities noted?',
  'Checking for JVD at 45 degrees and pedal edema.',
  "Sir/Ma'am, may I check your pockets for any medications, IC and Medic Awas tag?",
  'Auscultating point 1 right apex, point 2 left apex, point 3 right side, point 4 left side, point 5 right base and point 6 left base.',
  'Is there air entry? Is air entry equal? Are there any abnormal breath sounds?',
  'May I know which arm I can take the BP from? Do you have any AV shunt or fistula, or any chest operations?',
  'Taking the BP on the left arm. ECG, 12-lead. Checking the hypocount.',
];

const stat: QStat = { seen: 3, right: 2, lastAt: AT, lastRight: true, rightSinceWrong: 1 };

/** `lines` transcript lines cycled from `from`, each its own text, cut or padded to `chars` when given. */
function transcript(from: TranscriptLine[], lines: number, chars?: number): TranscriptLine[] {
  return Array.from({ length: lines }, (_, i) => {
    const l = from[i % from.length]!;
    const text = chars === undefined ? l.text : `${i} ${l.text} `.repeat(Math.ceil(chars / (l.text.length + 2))).slice(0, chars);
    return { ...l, text };
  });
}

/**
 * The heavy progress (the brief's step 1): 407 question stats, and 50 run records of 150 transcript lines each, put in
 * through addRunRecord, so only the newest 10 keep their transcripts; then the open run. With `kept`, the transcripts
 * kept are `kept.lines` lines of `kept.chars` characters instead (RUN_LIMITS' caps).
 */
async function heavyProgress(open: RunSession, kept?: { lines: number; chars: number }): Promise<Progress> {
  const questions = Object.fromEntries(Array.from({ length: 407 }, (_, i) => [`mt-a-q${String(i + 1).padStart(3, '0')}`, stat]));
  const base = await copdRecord('base', AT, { pocket: true });
  let p = progressWith({ questions });
  for (let i = 0; i < 50; i++) {
    const startedAt = new Date(Date.parse(AT) - (50 - i) * 3_600_000).toISOString();
    const lines = kept === undefined ? transcript(base.transcript, 150) : transcript(base.transcript, kept.lines, kept.chars);
    p = addRunRecord(p, { ...base, id: `run-${i}`, startedAt, transcript: lines });
  }
  expect(p.runs).toHaveLength(RUN_LIMITS.runsKept);
  expect(p.runs.filter((r) => r.transcript.length > 0)).toHaveLength(RUN_LIMITS.transcriptsKept);
  return { ...p, runOpen: open };
}

/** Mdm Tan's open run at step 10 (mockup screen 2's). */
const openAtStep10 = () => playRun(COPD, 'coached', [...COPD_TO_BREATHING], { gapMs: COPD_GAP_MS });

/** That run filled to `lines` lines, every line `chars` characters: its own lines lengthened, then the tester's. */
async function openAtCaps(lines: number, chars: number): Promise<RunSession> {
  const s = await openAtStep10();
  const pad = (text: string, i: number) => `${text} ${i} `.repeat(Math.ceil(chars / (text.length + 4))).slice(0, chars);
  const own = s.lines.map((l, i) => ({ ...l, text: pad(l.text, i) }));
  const filler = Array.from({ length: lines - own.length }, (_, i) => ({ who: 'tester' as const, text: pad('No change.', i), atMs: null }));
  return { ...s, lines: [...own, ...filler] };
}

/** The host's CPU use over `ms`, in % of all its cores, from the change in os.cpus()' tick counts. */
async function hostCpu(ms = 1_000): Promise<number> {
  const ticks = () => cpus().map((c) => c.times);
  const from = ticks();
  await new Promise((done) => setTimeout(done, ms));
  let busy = 0;
  let all = 0;
  ticks().forEach((t, i) => {
    const f = from[i]!;
    const idle = t.idle - f.idle;
    const total = t.user - f.user + (t.nice - f.nice) + (t.sys - f.sys) + (t.irq - f.irq) + idle;
    busy += total - idle;
    all += total;
  });
  return all > 0 ? Math.round((busy / all) * 100) : 0;
}

/** The seeded app on #/run at 4× CPU throttle, once the run's lines are in. Returns the host's CPU use, in %, read
 *  just before the throttle is set. */
async function throttledRun(page: Page, data: Progress): Promise<number> {
  await seed(page, data);
  const hostBefore = await hostCpu();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/#/run');
  await expect(page.getByRole('log', { name: 'Run chat' }).locator('.syscard').first()).toHaveText(/^Dispatch: Activation: /, { timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: 'Speak to the scene' })).toBeVisible();
  return hostBefore;
}

/** Sends `text` and waits until it is the chat's newest line of the trainee's, so each save is its own measure. */
async function say(page: Page, text: string): Promise<void> {
  const field = page.getByRole('textbox', { name: 'Speak to the scene' });
  await field.fill(text);
  await field.press('Enter');
  await expect(page.getByRole('log', { name: 'Run chat' }).locator('.msg.me').last()).toContainText(text.slice(0, 40));
}

/** Every save's duration so far, in ms, in order. */
const saveDurations = (page: Page) =>
  page.evaluate((name) => performance.getEntriesByName(name).map((e) => Math.round(e.duration * 10) / 10), SAVE);

/** `x` to one decimal, as the figures are logged. */
const tenth = (x: number): number => Math.round(x * 10) / 10;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return tenth(s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
};

/** What each of the two slots holds now: its save number and its size in characters (0 for an empty slot). The seed
 *  is save 1, so a newest seq still at 1 means no save of the app's own went in. */
const slots = (page: Page) => page.evaluate(() => ['crewleader.save.0', 'crewleader.save.1'].map((k) => {
  const raw = localStorage.getItem(k);
  return { seq: raw === null ? 0 : Number(/^\{"v":\d+,"seq":(\d+),/.exec(raw)?.[1] ?? NaN), chars: raw?.length ?? 0 };
}));

/** Logs the run's figures, on the console and as an annotation on the test. */
function report(info: TestInfo, what: string, figures: Record<string, unknown>): void {
  const line = `${what}: ${JSON.stringify(figures)}`;
  console.log(line);
  info.annotations.push({ type: 'save profile', description: line });
}

test('the save budget: 12 lines on a heavy history at 4× throttle, median ≤ 30 ms and max ≤ 80 ms', async ({ page }, info) => {
  const hostBefore = await throttledRun(page, await heavyProgress(await openAtStep10()));
  for (const line of LINES) await say(page, line);
  const all = await saveDurations(page);
  const host = { beforeThrottlePct: hostBefore, afterSendsPct: await hostCpu() };
  // The run screen saves once as it opens (the clock resumed), then once for each line.
  expect(all.length).toBeGreaterThanOrEqual(LINES.length + 1);
  const [warmUp, ...rest] = all;
  const busiest = Math.max(host.beforeThrottlePct, host.afterSendsPct);
  const judged = busiest < HOST_BUSY_PCT;
  const reason = judged ? null : `host busy: ${busiest}% CPU; budget not judged`;
  const figures = { judged, reason, saves: all.length, warmUp, median: median(all), max: tenth(Math.max(...rest)), all,
    slots: await slots(page), host };
  report(info, 'heavy history, 4x throttle', figures);   // the verdict in the run log too: a skip shows only "-" there
  test.skip(!judged, reason ?? undefined);
  expect(figures.median, `median of ${JSON.stringify(all)}`).toBeLessThanOrEqual(BUDGET.medianMs);
  expect(figures.max, `max after the warm-up of ${JSON.stringify(rest)}`).toBeLessThanOrEqual(BUDGET.maxMs);
});

test('logged, not held to the budget: the open run at its caps, 400 lines of 600 characters', async ({ page }, info) => {
  // Two lines short of the cap, so one more line (and its reply) brings it there; then the Pause sheet saves its clock.
  const hostBefore = await throttledRun(page, await heavyProgress(await openAtCaps(RUN_LIMITS.transcriptLines - 2, RUN_LIMITS.lineChars)));
  await say(page, 'Checking the radial pulse. Is there pulse? What is the rate and quality of the pulse?');
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
  }
  const all = await saveDurations(page);
  const [warmUp, ...rest] = all;
  report(info, 'open run at caps, 4x throttle', {
    saves: all.length, warmUp, median: median(all), max: tenth(Math.max(...rest)), all, slots: await slots(page),
    host: { beforeThrottlePct: hostBefore, afterSavesPct: await hostCpu() },
  });
});

/** The newest slot's save number, the records in it that still keep their transcripts (how many, and their ids), and
 *  the open run's line count. */
const keptTranscripts = (page: Page) => page.evaluate(() => {
  type Saved = { seq: number; data: { runs: { id: string; transcript: unknown[] }[]; runOpen: { lines: unknown[] } | null } };
  const saves = ['crewleader.save.0', 'crewleader.save.1'].flatMap((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? [] : [JSON.parse(raw) as Saved];
  });
  const newest = saves.sort((a, b) => b.seq - a.seq)[0];
  if (newest === undefined) return null;
  const kept = newest.data.runs.filter((r) => r.transcript.length > 0).map((r) => r.id);
  return { seq: newest.seq, kept: kept.length, keptIds: kept, openLines: newest.data.runOpen?.lines.length ?? null };
});

test('logged, not held to the budget: every cap at once, 10 transcripts and the open run at 400 lines of 600 characters', async ({ page }, info) => {
  const caps = { lines: RUN_LIMITS.transcriptLines, chars: RUN_LIMITS.lineChars };
  const data = await heavyProgress(await openAtCaps(caps.lines, caps.chars), caps);
  const hostBefore = await throttledRun(page, data);
  // Two such saves don't fit Chrome's localStorage quota beside each other. Since Plan 3 Task 7 (ruling D28) a save over
  // the quota keeps only the newest records' transcripts (RUN_LIMITS.transcriptsOnQuota) and is tried once more, so it
  // fits: no failed save, and no toast. A failing save would still say so in one (Task 2 carry).
  const saveError = await page.getByText(SAVE_ERROR).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
  }
  const all = await saveDurations(page);
  const newest = await keptTranscripts(page);
  info.annotations.push({ type: 'quota', description:
    'Every cap at once is over the localStorage quota: a save at every cap trims old transcripts and retries once (Task 7, D28)' });
  report(info, 'every cap at once, 4x throttle', {
    saves: all.length, median: all.length > 0 ? median(all) : null, max: all.length > 0 ? tenth(Math.max(...all)) : null, all,
    slots: await slots(page), newest,
    seedChars: JSON.stringify(data).length, saveError,
    host: { beforeThrottlePct: hostBefore, afterSavesPct: await hostCpu() },
  });
  // The trim's outcome, held whatever the host: the app's own saves went in, with only the newest transcripts kept.
  expect(saveError, 'no save failed').toBe(false);
  expect(newest?.seq ?? 0, "a save of the app's own is the newest").toBeGreaterThan(1);
  expect(newest?.kept, 'transcripts kept once over the quota').toBe(RUN_LIMITS.transcriptsOnQuota);
  // Which ones (review M10): the newest records' (D28), and never the open run's, which keeps all its lines.
  const newestIds = [...data.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, RUN_LIMITS.transcriptsOnQuota).map((r) => r.id);
  expect([...(newest?.keptIds ?? [])].sort(), 'the newest records keep theirs').toEqual([...newestIds].sort());
  expect(newest?.openLines, 'the open run untrimmed').toBe(RUN_LIMITS.transcriptLines);
});

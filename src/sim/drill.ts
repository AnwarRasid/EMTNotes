// Drills (plan ruling R4, spec §11): a short Coached run on the steps either side of a fault. The steps before it are
// filled in from the case, findings known, and the clock never starts. Run start (Task 12), Pause (Task 15) and the
// debrief (Task 17) start them; the run engine plays them as any other run, within the drill's range.
// Pure: no window, document or preact.
import type { Step } from '../data/schema';
import { activeFaults, type PartHit, type PointHit, type Reading, type RunRecord, type RunSession } from '../progress/types';
import { applicablePoints } from './classify';
import { onScene } from './grader';
import { caseSlots } from './match';
import { fillCanonical, oneDecimal, readingsSpeech } from './replies';
import { DRILL_ETA, caseHit, caseOxygen, checked, replyHeard, startRun, unfinishedSteps, type RunEnv } from './run';

/** The steps whose findings a drill knows once they are prefilled: the oxygen and its SpO2; the ECG and the hypocount;
 *  the GCS and the buddies' readings. */
const FINDINGS = { breathing: 'breathing', investigation: 'investigation', vitals: 'vital-signs' } as const;

/** The steps a drill on step `targetOrder` covers: one either side, clipped to steps 1 to `total`. */
export function drillRange(targetOrder: number, total: number): [number, number] {
  return [Math.max(1, targetOrder - 1), Math.min(total, targetOrder + 1)];
}

/** The last step's order: the steps' count, as they run 1 to 19. */
export const lastOrder = (steps: Step[]): number => steps.reduce((m, s) => Math.max(m, s.order), 0);

/** 'Drill on step 12, Rapid body survey. Steps 1 to 10 are filled in from the case. Start at step 11, Circulation.';
 *  "Step 1 is …" and "Steps 1 and 2 are …" for one and two steps filled in, no such sentence for none. */
function drillLine(target: Step, from: number, start: Step | undefined): string {
  const filled = from <= 1 ? ''
    : from === 2 ? ' Step 1 is filled in from the case.'
    : from === 3 ? ' Steps 1 and 2 are filled in from the case.'
    : ` Steps 1 to ${from - 1} are filled in from the case.`;
  return `Drill on step ${target.order}, ${target.name}.${filled} Start at step ${from}${start === undefined ? '' : `, ${start.name}`}.`;
}

/** What the drill's opening line (drillLine's, a system line) is shown under, in the run chat's hidden prefix and the
 *  debrief's transcript: the drill, not "Dispatch" (Task 11 carry, Task 17). Every other system line stays Dispatch. */
export const DRILL_SPEAKER = 'Drill';
const DRILL_LINE = /^Drill on step \d+, [^.]+\.(?: Steps? .+ (?:is|are) filled in from the case\.)? Start at step \d+(?:, [^.]+)?\.$/;

/** Whether a system line's text is a drill's opening line, as drillLine words it. */
export function isDrillOpening(text: string): boolean {
  return DRILL_LINE.test(text);
}

/**
 * A drill on step `target` (a step id of env.steps; Run start checks it): always Coached (R4), over drillRange of it.
 * - Lines: the activation line, then the drill line (drillLine).
 * - Every step before the range is prefilled: each point of it that applies to the case is done, with all its parts, at
 *   line 0 with no time, by the builder tap mode uses (run.ts caseHit: a check point's choice is the case's own, right).
 *   Each text reply those points set off counts as said (`played`), as a tapped step's would, so saying a prefilled
 *   point again never replays it ("Crew ready. You've arrived on scene." mid-scene, R16). Its findings are
 *   known: with breathing (step 10) prefilled, the case's oxygen device at its lowest flow, right, and the SpO2 read on
 *   it (vitalsPhase, through readingsSpeech); with the investigation (13), the case's ECG and the hypocount (oneDecimal,
 *   ruling P21); with the vital signs (14), the GCS of e + v + m (P21's drill exception to R15) and the seven buddy
 *   readings on the oxygen given.
 * - The run stands at the range's first step; the clock never starts (run.ts never starts it in a drill); the crew has
 *   arrived on scene once preparation is prefilled (from step 4 on), with nothing held (controller addition 1).
 * - Every number is finite, as startRun makes it from any `now` (controller addition 3).
 */
export function startDrill(env: RunEnv, target: string, chain: string[], sourceRunId: string | null,
  ids: { id: string; startedAt: string }, now: number): RunSession {
  const step = env.steps.find(s => s.id === target);
  if (step === undefined) throw new Error(`No step "${target}" to drill.`);
  const [from, to] = drillRange(step.order, lastOrder(env.steps));
  const c = env.case;
  const run = startRun(env, 'coached', ids, now);
  const before = env.steps.filter(s => s.order < from);
  const filled = (id: string): boolean => before.some(s => s.id === id);

  const slots = caseSlots(c, DRILL_ETA);
  const hits: Record<string, PointHit> = {};
  const parts: Record<string, PartHit> = {};
  const played = new Set<string>();
  for (const st of before) {
    const text = fillCanonical(st.canonicalLine, c, DRILL_ETA, st.mustHit);
    for (const a of applicablePoints([st], c)) {
      const said = caseHit(env, a, text, slots, { line: 0, atMs: null, during: st.order });
      hits[a.key] = said.hit;
      Object.assign(parts, said.parts);
      const partIds = (a.point.parts ?? []).map(p => p.id);
      st.replies.forEach((r, index) => { if ('text' in r && replyHeard(r, a.point.id, partIds)) played.add(`${st.id}#${index}`); });
    }
  }

  const oxygen = filled(FINDINGS.breathing) ? caseOxygen(env, null) : null;
  const speech = { case: c, oxygen, eta: DRILL_ETA };
  const { e, v, m } = c.findings.vitals.gcs;
  const readings: Reading[] = [
    ...(filled(FINDINGS.breathing) ? readingsSpeech(['spo2'], speech).readings : []),
    ...(filled(FINDINGS.investigation) ? [{ key: 'hypocount' as const, value: oneDecimal(c.findings.investigation.hypocount), o2: null }] : []),
    ...(filled(FINDINGS.vitals) ? [
      { key: 'gcs' as const, value: String(e + v + m), o2: null },
      ...readingsSpeech(['temp', 'rr', 'skin'], speech).readings,
      ...readingsSpeech(['spo2', 'pr', 'bp', 'crt'], speech).readings,
    ] : []),
  ].map(r => ({ ...r, atMs: null }));

  return checked({
    ...run,
    drill: { target, from, to, chain: [...chain], sourceRunId },
    current: from,
    hits, parts, prefilled: before.map(s => s.id), played: [...played],
    lines: [...run.lines, { who: 'system', text: drillLine(step, from, env.steps.find(s => s.order === from)), atMs: null }],
    readings, oxygen, ecg: filled(FINDINGS.investigation) ? c.expected.ecg : null,
    arrived: onScene(from), held: null,
  });
}

/**
 * Whether the drill has nothing left: no step of its range is unfinished (run.ts unfinishedSteps), so every point in it
 * that applies to the case is done, or disputed (R9: "Not what I meant" takes a point out of the score). The drill's
 * end, the End confirm's "count as missed" and the step bar share that one definition. False for a run that isn't a
 * drill. Pause (Task 15) ends the drill by itself once it is true.
 */
export function drillDone(env: RunEnv, s: RunSession): boolean {
  return s.drill !== null && unfinishedSteps(env, s).length === 0;
}

/** The steps to drill after a run: the step ids of its active faults, each once, in step order. A fault whose step is
 *  no longer in `steps` is left out. The debrief drills the first and chains the rest (Task 17). */
export function drillTargets(r: RunRecord, steps: Step[]): string[] {
  const ids = new Set(activeFaults(r).map(f => f.point.split('/')[0]));
  return steps.filter(s => ids.has(s.id)).sort((a, b) => a.order - b.order).map(s => s.id);
}

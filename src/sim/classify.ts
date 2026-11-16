// End-of-run classification: the trainee's faults, as Missed, Wrong, Order and Phrase (plan rulings R5, R6, R7 and R9).
// A correct answer flagged as a fault is the spec's named anti-goal, so every rule here leans to precision: ties in
// position read as in order, and steps the trainee tapped or that a drill prefilled are never graded.
// Pure: no window, document or preact.
import { conditionHolds, type Case, type MustHit, type Step } from '../data/schema';
import type { Fault, FaultKind, PointHit, RunSession } from '../progress/types';
import { DEVICE_LABEL } from './oxygen';
import { stop } from './replies';

export const pointKey = (stepId: string, pointId: string): string => `${stepId}/${pointId}`;

/** A must-hit point that applies to the case: its step, its index in the step's mustHit, and its 'stepId/pointId' key. */
export interface Applicable { step: Step; point: MustHit; index: number; key: string }

/** Every point that applies to the case (its `when` holds), in step and point order; only steps within `range`
 *  (step orders, inclusive) when one is given. */
export function applicablePoints(steps: Step[], c: Case, range?: [number, number] | null): Applicable[] {
  return [...steps]
    .sort((a, b) => a.order - b.order)
    .filter(st => range == null || (st.order >= range[0] && st.order <= range[1]))
    .flatMap(st => st.mustHit.map((point, index) => ({ step: st, point, index, key: pointKey(st.id, point.id) })))
    .filter(a => a.point.when === undefined || conditionHolds(c, a.point.when));
}

/** Whether the point is done. A point with parts is judged by its parts alone, every one in `s.parts`, so a whole-match
 *  read (palpate-dtbl's "palpate the neck", bp-screen's "which arm") never finishes it (Task 6 carry). */
export function pointDone(a: Applicable, s: RunSession): boolean {
  const parts = a.point.parts ?? [];
  return parts.length === 0 ? Object.hasOwn(s.hits, a.key) : parts.every(p => Object.hasOwn(s.parts, `${a.key}/${p.id}`));
}

/** A point's place in the protocol: its step, and within a step that runs in order (`inOrder`), its index. */
export function rankOf(step: Step, index: number): number {
  return step.order * 100 + (step.inOrder ? index : 0);
}

/**
 * The keys out of place (R6): every key outside the longest non-decreasing run of ranks, so the fewest points are
 * blamed. Where two runs are as long, the one using earlier items is kept, so the blame falls on the latest line out
 * of place: a step 10 point recalled after step 11's pulse is the one blamed, never the pulse said in its right place,
 * and the run's inline flag lands on the line just said (controller ruling, Task 9 fix round 1, amending R6's tie rule).
 *   dp[i]   = 1 + max dp[j] over j < i with rank[j] <= rank[i] (1 when there is none);
 *   prev[i] = that j: on a tie the smaller j;
 *   end     = argmax dp: on a tie the smaller i;
 *   kept    = end, prev[end], prev[prev[end]], …
 */
export function outOfOrder(seq: { key: string; rank: number }[]): Set<string> {
  const rank = seq.map(x => x.rank);
  const dp: number[] = [];
  const prev: number[] = [];
  const r = (i: number) => rank[i] ?? 0;
  const d = (i: number) => dp[i] ?? 0;
  // whether i beats the best so far (-1 for none): only a longer run does, so on a tie the earlier item stays
  const beats = (i: number, best: number) => best < 0 || d(i) > d(best);
  for (let i = 0; i < seq.length; i++) {
    let best = -1;
    for (let j = 0; j < i; j++) if (r(j) <= r(i) && beats(j, best)) best = j;
    dp.push(best < 0 ? 1 : d(best) + 1);
    prev.push(best);
  }
  let end = -1;
  for (let i = 0; i < seq.length; i++) if (beats(i, end)) end = i;
  const kept = new Set<number>();
  for (let i = end; i >= 0; i = prev[i] ?? -1) kept.add(i);
  return new Set(seq.filter((_, i) => !kept.has(i)).map(x => x.key));
}

/** How a fault sorts: Missed and Wrong first (R5's magenta), then Order, then Phrase. */
export const FAULT_RANK: Record<FaultKind, number> = { missed: 0, wrong: 0, order: 1, phrase: 2 };
// Within one point, at the same rank: its Missed before its Wrong.
const KIND_ORDER: Record<FaultKind, number> = { missed: 0, wrong: 1, order: 2, phrase: 3 };

export interface Classified { faults: Fault[]; disputed: Fault[]; stepsClean: number; stepsTotal: number }

/** The detail of a Phrase fault for a check point whose choice was never named; the run's inline flag shows it too. */
export const UNNAMED_DETAIL: Record<NonNullable<MustHit['check']>, string> = {
  oxygen: 'Say which mask and flow rate.',
  ecg: 'Say which ECG: 12-lead or 4-lead.',
  arm: 'Say which arm the BP goes on.',
};

/** 'Key words missing: “suspected”.'; several words read '“front”, “move your head”'. */
export function missingWordsDetail(words: string[]): string {
  return `Key words missing: “${words.join('”, “')}”.`;
}


/** 'nasal cannula 2–4 L/min'; one figure when the range has only one; no flow when the case names none. */
function neededOxygen(o: Case['expected']['oxygen']): string {
  const flow = o.flowMin === null && o.flowMax === null ? null
    : o.flowMin === null || o.flowMax === null || o.flowMin === o.flowMax ? `${o.flowMin ?? o.flowMax} L/min`
    : `${o.flowMin}–${o.flowMax} L/min`;
  return [DEVICE_LABEL[o.device], flow].filter(x => x !== null).join(' ') + (o.optional ? ', or no oxygen' : '');
}

/** A Wrong fault's detail. An oxygen one ends with the case's note on why this device (ruling P37); a BP arm one names
 *  the arm the patient offers (D23). */
function wrongDetail(check: NonNullable<MustHit['check']>, chose: string | null, c: Case): string {
  if (check === 'ecg') return `${chose === null ? '' : `Chose ${chose}. `}This patient needs ${c.expected.ecg}.`;
  if (check === 'arm') {
    return `${chose === null ? '' : `Chose the ${chose}. `}The patient ruled that arm out, so the BP goes on the `
      + `${c.findings.investigation.bpArm} arm.`;
  }
  const note = c.expected.oxygen.note;
  return `${chose === null ? '' : `Gave ${chose}. `}This patient needs ${neededOxygen(c.expected.oxygen)}. Readings didn't improve.`
    + (note === undefined ? '' : ` ${note}`);
}

/** 'step 5, Approach patient'; the number alone for a step that isn't in `steps`. */
function stepName(order: number, steps: Step[]): string {
  const st = steps.find(x => x.order === order);
  return st === undefined ? `step ${order}` : `step ${order}, ${st.name}`;
}

function orderDetail(a: Applicable, during: number, steps: Step[]): string {
  return during === a.step.order
    ? `Done out of order within ${stepName(a.step.order, steps)}.`
    : `Done during ${stepName(during, steps)}. It belongs to ${stepName(a.step.order, steps)}.`;
}

/** The parts of the point said so far, in the order they were said; parts said at one place keep the point's order. */
function saidParts(a: Applicable, s: RunSession) {
  return (a.point.parts ?? []).flatMap((part, index) => {
    const at = s.parts[`${a.key}/${part.id}`];
    return at === undefined ? [] : [{ part, index, line: at.line, pos: at.pos }];
  }).sort((x, y) => x.line - y.line || x.pos - y.pos || x.index - y.index);
}

/** 'Out of order: Pelvis before Abdomen.' for the first part said after one that comes later; null when in order. */
function partOrderDetail(a: Applicable, s: RunSession): string | null {
  if (a.point.ordered !== true) return null;
  const said = saidParts(a, s);
  const at = said.findIndex((x, i) => i > 0 && x.index < (said[i - 1]?.index ?? -1));
  const before = said[at - 1];
  const after = said[at];
  return at < 0 || before === undefined || after === undefined ? null : `Out of order: ${before.part.label} before ${stop(after.part.label)}`;
}

/** 'Missing: Back.' when some of the point's parts were said; null when none were, or it has none. */
function missingPartsDetail(a: Applicable, s: RunSession): string | null {
  const parts = a.point.parts ?? [];
  const said = (id: string) => Object.hasOwn(s.parts, `${a.key}/${id}`);
  if (!parts.some(p => said(p.id))) return null;
  return stop(`Missing: ${parts.filter(p => !said(p.id)).map(p => p.label).join(', ')}`);
}

/** Where a point not done sits in the run: when the trainee first reached a later step, else the end of the run. */
function movedPastAt(a: Applicable, steps: Step[], s: RunSession, endMs: number | null): number | null {
  const times = steps.filter(st => st.order > a.step.order).flatMap(st => {
    const t = s.stepTimes[st.id];
    return Object.hasOwn(s.stepTimes, st.id) && t !== undefined ? [t] : [];
  });
  return times.length > 0 ? Math.min(...times) : endMs;
}

/**
 * The run's faults. Graded points apply to the case, lie within the drill's range in a drill, and sit in a step that
 * was neither tapped nor prefilled. A graded point gets:
 * - Missed when it isn't done, placed when the trainee moved past its step;
 * - Wrong for a wrong oxygen or ECG choice or a ruled-out BP arm, and Phrase for one never named;
 * - Order when its hit is out of place among the graded hits (R6), or its parts are said out of order;
 * - Phrase for each hit missing key words (R7).
 * Faults sort by FAULT_RANK, then step, then point; a disputed point's faults go to `disputed` (R9).
 * `endMs` is the run's elapsed time at the end, or null when the clock never started.
 */
export function classify(steps: Step[], c: Case, s: RunSession, endMs: number | null): Classified {
  const range: [number, number] | null = s.drill === null ? null : [s.drill.from, s.drill.to];
  const ungraded = new Set([...s.tapped, ...s.prefilled]);
  const graded = applicablePoints(steps, c, range).filter(a => !ungraded.has(a.step.id));
  const hitOf = (a: Applicable): PointHit | undefined => (Object.hasOwn(s.hits, a.key) ? s.hits[a.key] : undefined);

  // the graded hits in the order they were said; a tie in position reads as in order
  const said = graded.flatMap(a => {
    const hit = hitOf(a);
    return hit === undefined ? [] : [{ key: a.key, rank: rankOf(a.step, a.index), line: hit.line, pos: hit.pos }];
  }).sort((x, y) => x.line - y.line || x.pos - y.pos || x.rank - y.rank);
  const late = outOfOrder(said);

  const found: { fault: Fault; index: number }[] = [];
  for (const a of graded) {
    const hit = hitOf(a);
    const add = (kind: FaultKind, detail: string | null, atMs: number | null) =>
      found.push({ fault: { kind, point: a.key, step: a.step.order, label: a.point.label, detail, atMs }, index: a.index });
    const passed = movedPastAt(a, steps, s, endMs);
    if (!pointDone(a, s)) add('missed', missingPartsDetail(a, s), passed);
    const check = a.point.check;
    if (hit !== undefined && check !== undefined && hit.check === 'wrong') add('wrong', wrongDetail(check, hit.chose, c), hit.atMs);
    if (hit !== undefined && late.has(a.key)) add('order', orderDetail(a, hit.during, steps), hit.atMs);
    const parts = partOrderDetail(a, s);
    if (parts !== null) add('order', parts, hit === undefined ? passed : hit.atMs);   // on a hit, the hit's time, null too
    if (hit !== undefined && check !== undefined && hit.check === 'unnamed') add('phrase', UNNAMED_DETAIL[check], hit.atMs);
    if (hit !== undefined && hit.missing.length > 0) add('phrase', missingWordsDetail(hit.missing), hit.atMs);
  }
  const sorted = found
    .sort((x, y) => FAULT_RANK[x.fault.kind] - FAULT_RANK[y.fault.kind] || x.fault.step - y.fault.step || x.index - y.index
      || KIND_ORDER[x.fault.kind] - KIND_ORDER[y.fault.kind])
    .map(x => x.fault);
  const faults = sorted.filter(f => !s.disputes.includes(f.point));
  const disputed = sorted.filter(f => s.disputes.includes(f.point));

  const faulted = new Set(faults.map(f => f.step));
  const rangeSteps = steps.filter(st => range === null || (st.order >= range[0] && st.order <= range[1]));
  return {
    faults, disputed,
    stepsClean: rangeSteps.filter(st => !s.tapped.includes(st.id) && !faulted.has(st.order)).length,
    stepsTotal: range === null ? steps.length : range[1] - range[0] + 1,
  };
}

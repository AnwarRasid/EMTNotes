// Task 17: the debrief's pure model (src/sim/debrief.ts): the verdict, the figures, steps clean, what went well, the
// replay and its summary, Today's trace and label, the case line, and the helpers the screen reads through (disputes,
// the oxygen note, the vitals rows, the transcript's labels).
import { CASES, HEAD_GRIP, IDS, MOI, POCKET, STEPS, T0, caseById, debriefRecord, envOf, hitAll, recordOf } from './sim-helpers';
import type { Fault, Reading, RunRecord } from '../../src/progress/types';
import {
  FAULT_WORD, SRACIE, caseLine, figuresOf, fixDetail, fixStep, replayOf, replaySummary, stepsCleanOf, todayStripLabel, todayTraceOf,
  transcriptOf, verdict, verdictSub, vitalsRows, wentWell, withDispute,
} from '../../src/sim/debrief';
import { DRILL_SPEAKER, isDrillOpening, startDrill } from '../../src/sim/drill';
import type { Headline } from '../../src/sim/headline';
import { endRun, startRun } from '../../src/sim/run';

const copd = caseById('copd-amk-01');
const STEP1 = 'FMV 123 to Ops Ctr, responding to Blk 2xx Ang Mo Kio Ave 3 for case of elderly female, breathlessness.';
const R = debriefRecord();
const CLEAN = debriefRecord({ faults: false });
const headlineOn = (point: string): Headline => ({ kind: 'missed', point, step: 12, count: 2, of: 3, label: 'Pocket check' });

describe('verdict', () => {
  it('reads "Nothing to fix this run." for none, else "{n} to fix"', () => {
    expect(verdict(0)).toBe('Nothing to fix this run.');
    expect(verdict(1)).toBe('1 to fix');
    expect(verdict(3)).toBe('3 to fix');
  });
});

describe('FAULT_WORD and SRACIE', () => {
  it('names each kind, and the six SRACIE letters in order', () => {
    expect(FAULT_WORD).toEqual({ missed: 'Missed', wrong: 'Wrong', order: 'Order', phrase: 'Phrase' });
    expect(SRACIE.map((x) => `${x.letter} ${x.name}`)).toEqual(['S sex', 'R race', 'A age', 'C case and signs', 'I IC no.', 'E ETA']);
  });
});

describe('the sample record', () => {
  it('holds the mockup three faults, in fix-list order', () => {
    expect(R.faults.map((f) => [f.kind, f.point, f.step, f.atMs])).toEqual([
      ['missed', POCKET, 12, 200_000], ['order', HEAD_GRIP, 6, 0], ['phrase', MOI, 4, null],
    ]);
    expect(CLEAN.faults).toEqual([]);
  });
});

describe('figuresOf', () => {
  it('reads time used, RBS and steps clean for a full run', () => {
    expect(figuresOf(R, STEPS)).toEqual({ time: '17:42', rbs: '2:41', rbsOk: true, steps: '16', total: '19' });
  });

  it('shows "—" for the time and RBS of a run ended before Approach', async () => {
    const early = await recordOf('copd-amk-01', 'coached', [STEP1]);
    expect(early.usedMs).toBe(0);
    expect(early.stepTimes).toEqual({});
    expect(figuresOf(early, STEPS)).toMatchObject({ time: '—', rbs: '—', rbsOk: false });
  });

  it('rounds a late RBS up through rbsShown, so 3:00.4 reads 3:01 and is not in time; 3:00 exactly is (Task 7 ruling)', () => {
    expect(figuresOf({ ...R, rbsMs: 180_400 }, STEPS)).toMatchObject({ rbs: '3:01', rbsOk: false });
    expect(figuresOf({ ...R, rbsMs: 180_001 }, STEPS)).toMatchObject({ rbs: '3:01', rbsOk: false });
    expect(figuresOf({ ...R, rbsMs: 180_000 }, STEPS)).toMatchObject({ rbs: '3:00', rbsOk: true });
  });
});

describe('stepsCleanOf', () => {
  it('is the steps less those with an active fault or tapped', () => {
    expect(stepsCleanOf(R, STEPS)).toBe(16);
    expect(stepsCleanOf(CLEAN, STEPS)).toBe(19);
  });

  it('rises by 1 when a step’s only fault is disputed', () => {
    expect(stepsCleanOf({ ...R, disputes: [MOI] }, STEPS)).toBe(17);
  });

  it('never counts a tapped step, and counts a step tapped and faulted once', () => {
    expect(stepsCleanOf({ ...CLEAN, tapped: ['loc-avpu'] }, STEPS)).toBe(18);
    expect(stepsCleanOf({ ...R, tapped: ['introduction'] }, STEPS)).toBe(16);
  });

  it('counts within a drill’s range only', () => {
    const drill: RunRecord = { ...CLEAN, drill: true, drillRange: [11, 13], stepsTotal: 3, tapped: ['respond-call'],
      faults: [{ kind: 'missed', point: POCKET, step: 12, label: 'Pocket check', detail: null, atMs: null }] };
    expect(stepsCleanOf(drill, STEPS)).toBe(2);
  });
});

describe('wentWell', () => {
  it('puts "RBS done in 2:41." first, at most four lines, in the brief’s order', () => {
    expect(wentWell(R, STEPS)).toEqual([
      'RBS done in 2:41.', 'Every RBS region, in order.', 'Right oxygen: nasal cannula 2 L/min.', 'Standby call with all of SRACIE.',
    ]);
    expect(wentWell(CLEAN, STEPS)).toHaveLength(4);
  });

  it('includes the standby call with all of SRACIE, and every step clean where the RBS is late', () => {
    const late = { ...CLEAN, rbsMs: 200_000 };
    expect(wentWell(late, STEPS)).toEqual([
      'Every RBS region, in order.', 'Right oxygen: nasal cannula 2 L/min.', 'Standby call with all of SRACIE.', 'Every step clean.',
    ]);
  });

  it('leaves out what a tapped step or a Wrong oxygen did, and a part of SRACIE missing', () => {
    const tapped = { ...CLEAN, tapped: ['rapid-body-survey', 'breathing', 'notification'], rbsMs: null };
    expect(wentWell(tapped, STEPS)).toEqual([]);
    const wrong: Fault = { kind: 'wrong', point: 'breathing/mask-flow', step: 10, label: 'O2', detail: null, atMs: 75_000 };
    expect(wentWell({ ...CLEAN, faults: [wrong] }, STEPS)).not.toContain('Right oxygen: nasal cannula 2 L/min.');
    const partial = { ...CLEAN, record: { ...CLEAN.record!, sracie: ['S', 'R', 'A', 'C', 'I'] } };
    expect(wentWell(partial, STEPS)).not.toContain('Standby call with all of SRACIE.');
  });

  it('never says every RBS region for an RBS missed, even when the miss is disputed', () => {
    const rbs = 'rapid-body-survey/rbs-regions';
    const missed: Fault = { kind: 'missed', point: rbs, step: 12, label: 'RBS', detail: null, atMs: 200_000 };
    expect(wentWell({ ...CLEAN, faults: [missed], disputes: [rbs] }, STEPS)).not.toContain('Every RBS region, in order.');
  });
});

describe('replayOf', () => {
  const replay = replayOf(R, STEPS);

  it('numbers the markers 1 to n in fix-list order', () => {
    expect(replay.markers.map((m) => [m.n, m.kind, m.step])).toEqual([[1, 'missed', 12], [2, 'order', 6], [3, 'phrase', 4]]);
    expect(replayOf({ ...R, disputes: [HEAD_GRIP] }, STEPS).markers.map((m) => [m.n, m.kind])).toEqual([[1, 'missed'], [2, 'phrase']]);
  });

  it('puts a missed pocket check at its moved-past time, and an untimed MOI phrase in the Call segment', () => {
    expect(replay.markers[0]).toEqual({ n: 1, kind: 'missed', atS: 200, step: 12 });
    expect(replay.markers[2]).toEqual({ n: 3, kind: 'phrase', atS: null, step: 4 });
  });

  it('reads the call steps reached, the timed steps’ times in seconds, and the standby call as the end', () => {
    expect(replay.callSteps).toEqual([1, 2, 3, 4]);
    expect(replay.stepsS).toHaveLength(15);
    expect(replay.stepsS).toContain(1000);
    expect(replay).toMatchObject({ endS: 1062, endLabel: 'Standby 17:42' });
    expect(replayOf({ ...R, standbyMs: null }, STEPS)).toMatchObject({ endS: 1062, endLabel: 'End 17:42' });
  });

  it('has no end for a run whose clock never started', async () => {
    const early = await recordOf('copd-amk-01', 'coached', [STEP1]);
    expect(replayOf(early, STEPS)).toMatchObject({ callSteps: [1], stepsS: [], endS: null, endLabel: null });
  });
});

describe('replaySummary', () => {
  it('describes the Call segment, each marker and the end', () => {
    expect(replaySummary(R, STEPS)).toBe('Run replay: a Call segment with untimed steps 1 to 4, then 0 to 20 minutes. '
      + 'Marker 1, pocket check, missed, at 3:20. Marker 2, head grip, order, at 0:00. Marker 3, MOI, phrase, in the Call segment. '
      + 'Standby call at 17:42.');
  });

  it('includes "Marker 2, MOI, phrase, in the Call segment." with the head grip disputed, and ends with the standby call', () => {
    const s = replaySummary({ ...R, disputes: [HEAD_GRIP] }, STEPS);
    expect(s).toContain('Marker 2, MOI, phrase, in the Call segment.');
    expect(s.endsWith('Standby call at 17:42.')).toBe(true);
  });

  it('ends "Ended at" with no standby call, and "The clock never started." when it never did', async () => {
    expect(replaySummary({ ...R, standbyMs: null }, STEPS).endsWith('Ended at 17:42.')).toBe(true);
    const early = await recordOf('copd-amk-01', 'coached', [STEP1]);
    expect(replaySummary(early, STEPS)).toContain('Marker 1, caller intro, missed, in the Call segment.');
    const pocket: Fault = { kind: 'missed', point: POCKET, step: 12, label: 'Pocket check', detail: null, atMs: null };
    const s = replaySummary({ ...early, faults: [pocket] }, STEPS);
    expect(s).toContain('Marker 1, pocket check, missed, before the clock started.');
    expect(s.endsWith('The clock never started.')).toBe(true);
  });

  it('describes only the 8 markers the strip draws, and says how many more the fix list holds', () => {
    const many = { ...R, faults: Array.from({ length: 10 }, (_, i): Fault =>
      ({ kind: 'missed', point: `notification/p${i}`, step: 19, label: `Point ${i}`, detail: null, atMs: 1_000_000 })) };
    const s = replaySummary(many, STEPS);
    expect(s).toContain('Marker 8, Point 7, missed, at 16:40.');
    expect(s).not.toContain('Marker 9');
    expect(s).toContain('2 more faults are in the fix list.');
  });
});

describe('todayTraceOf and todayStripLabel', () => {
  it('marks the headline’s point when this run has it, else the first timed active fault', () => {
    expect(todayTraceOf(R, STEPS, headlineOn(POCKET)).marker).toEqual({ s: 200, label: 'Pocket check', kind: 'missed' });
    expect(todayTraceOf(R, STEPS, headlineOn(HEAD_GRIP)).marker).toEqual({ s: 0, label: 'Head grip', kind: 'order' });
    expect(todayTraceOf(R, STEPS, headlineOn('airway/smell')).marker).toEqual({ s: 200, label: 'Pocket check', kind: 'missed' });
    expect(todayTraceOf(R, STEPS, null).marker?.label).toBe('Pocket check');
    // the headline's point untimed in this run (MOI): the first timed one instead
    expect(todayTraceOf(R, STEPS, headlineOn(MOI)).marker?.label).toBe('Pocket check');
    expect(todayTraceOf(CLEAN, STEPS, null).marker).toBeNull();
  });

  it('carries the replay’s timed steps and end', () => {
    expect(todayTraceOf(R, STEPS, null)).toMatchObject({ endS: 1062, endLabel: 'Standby 17:42' });
    expect(todayTraceOf(R, STEPS, null).stepsS).toHaveLength(15);
  });

  it('reads the steps, the marked point and the standby call', () => {
    expect(todayStripLabel(R, STEPS, headlineOn(POCKET)))
      .toBe('Run strip, 0 to 20 minutes: 15 steps; pocket check missed at about 3:20; standby call at 17:42.');
    expect(todayStripLabel({ ...CLEAN, standbyMs: null }, STEPS, null)).toBe('Run strip, 0 to 20 minutes: 15 steps; no standby call.');
  });
});

describe('caseLine and verdictSub', () => {
  it('read the case and the mode, and the suspected condition with the patient', () => {
    expect(caseLine(R, copd)).toBe('Breathlessness, Ang Mo Kio. Coached.');
    expect(caseLine({ ...R, mode: 'exam' }, copd)).toBe('Breathlessness, Ang Mo Kio. Exam.');
    expect(caseLine({ ...R, drill: true, drillRange: [11, 13] }, copd)).toBe('Breathlessness, Ang Mo Kio. Drill on steps 11 to 13.');
    // a two-step range at either end reads as the app's other step ranges do
    expect(caseLine({ ...R, drill: true, drillRange: [18, 19] }, copd)).toBe('Breathlessness, Ang Mo Kio. Drill on steps 18 and 19.');
    expect(caseLine({ ...R, drill: true, drillRange: [1, 2] }, copd)).toBe('Breathlessness, Ang Mo Kio. Drill on steps 1 and 2.');
    expect(verdictSub(copd)).toBe('Suspected COPD. Mdm Tan, 72.');
  });

  it('still read for a record whose case is gone', () => {
    expect(caseLine(R, null)).toBe('A removed case. Coached.');
    expect(verdictSub(null)).toBe("This case isn't on this phone any more, so it can't be drilled.");
  });
});

describe('withDispute', () => {
  it('sets a point aside and counts it again, keeping the counted points in step', () => {
    const set = withDispute(R, POCKET, true);
    expect(set.disputes).toEqual([POCKET]);
    expect(set.missed).toEqual([]);
    expect(set.order).toEqual([HEAD_GRIP]);
    expect(withDispute(set, POCKET, true).disputes).toEqual([POCKET]);
    const back = withDispute(set, POCKET, false);
    expect(back.disputes).toEqual([]);
    expect(back.missed).toEqual([POCKET]);
    expect(back.faults).toBe(R.faults);
  });
});

describe('fixDetail', () => {
  it('folds the case’s oxygen note out of a Wrong detail, and leaves every other detail whole', () => {
    const note = copd.expected.oxygen.note!;
    const detail = `Gave BVM 15 L/min. This patient needs nasal cannula 2–4 L/min. Readings didn't improve. ${note}`;
    const wrong: Fault = { kind: 'wrong', point: 'breathing/mask-flow', step: 10, label: 'O2', detail, atMs: 75_000 };
    expect(fixDetail(wrong, copd)).toEqual({ text: "Gave BVM 15 L/min. This patient needs nasal cannula 2–4 L/min. Readings didn't improve.", note });
    expect(fixDetail(wrong, null)).toEqual({ text: detail, note: null });
    expect(fixDetail(R.faults[1]!, copd)).toEqual({ text: R.faults[1]!.detail, note: null });
    expect(fixDetail(R.faults[0]!, copd)).toEqual({ text: null, note: null });
  });

  it('folds the asthma note too, the longest a case has', () => {
    const asthma = caseById('asthma-tampines-01');
    const note = asthma.expected.oxygen.note!;
    expect(note.length).toBeGreaterThan(500);
    const wrong: Fault = { kind: 'wrong', point: 'breathing/mask-flow', step: 10, label: 'O2', detail: `Gave BVM. ${note}`, atMs: null };
    expect(fixDetail(wrong, asthma)).toEqual({ text: 'Gave BVM.', note });
  });
});

describe('vitalsRows', () => {
  it('gives one row per reading time in a full run, and Call for a reading with none', () => {
    const rows = vitalsRows(R);
    expect(rows.map((r) => r.time)).toEqual(['01:20', '05:00', '07:00']);
    expect(rows[1]!.cells).toEqual({ temp: '37.2 °C', rr: '28', skin: 'pale, warm, sweaty', spo2: '90% NC', pr: '112', bp: '146/86', crt: 'under 2 s' });
    expect(vitalsRows({ ...R, readings: [{ key: 'pr', value: '100', atMs: null, o2: null }] }).map((r) => r.time)).toEqual(['Call']);
  });

  it('fills a drill’s Drill rows in order, a key taken again starting the next (ruling D8 as amended), with no GCS or hypocount', () => {
    const env = envOf('copd-amk-01');
    const r = endRun(env, startDrill(env, 'position', [], null, IDS, T0), T0);
    // prefilled: SpO2 from breathing, then the head buddy's temp, RR and skin, then the arm buddy's SpO2, PR, BP and CRT
    const rows = vitalsRows(r);
    expect(rows.map((x) => x.time)).toEqual(['Drill', 'Drill']);
    expect(rows.map((x) => Object.keys(x.cells))).toEqual([['spo2', 'temp', 'rr', 'skin'], ['spo2', 'pr', 'bp', 'crt']]);
    const at = (key: Reading['key'], value: string): Reading => ({ key, value, atMs: null, o2: null });
    const drill: RunRecord = { ...r, readings: [at('spo2', '88'), at('pr', '110'), at('rr', '26'), at('bp', '140/80'), at('spo2', '92')] };
    expect(vitalsRows(drill).map((x) => x.cells)).toEqual([{ spo2: '88%', pr: '110', rr: '26', bp: '140/80' }, { spo2: '92%' }]);
  });
});

describe('fixStep', () => {
  const order = (detail: string | null, point = HEAD_GRIP, step = 6): Fault =>
    ({ kind: 'order', point, step, label: 'Head grip', detail, atMs: 0 });

  it('names the step and links its notes', () => {
    expect(fixStep(R.faults[0]!, STEPS)).toEqual({ text: 'Step 12, Rapid body survey.', notesRef: 's01#rapid-body-survey' });
  });

  it('leaves the step out where an Order detail names it, in either form, and keeps the link', () => {
    expect(fixStep(order('Done during step 5, Approach patient. It belongs to step 6, Introduction.'), STEPS))
      .toEqual({ text: null, notesRef: 's01#introduction' });
    expect(fixStep(order('Done out of order within step 6, Introduction.'), STEPS)).toEqual({ text: null, notesRef: 's01#introduction' });
    expect(fixStep(R.faults[1]!, STEPS).text).toBeNull();
  });

  it('keeps the step for the kinds whose detail never names it', () => {
    const wrong: Fault = { kind: 'wrong', point: 'breathing/mask-flow', step: 10, label: 'O2',
      detail: "Gave BVM 15 L/min. This patient needs nasal cannula 2–4 L/min. Readings didn't improve.", atMs: 75_000 };
    expect(fixStep(wrong, STEPS).text).toBe('Step 10, Breathing.');
    expect(fixStep(R.faults[2]!, STEPS).text).toBe('Step 4, Rescue scene evaluation.');   // Phrase: "Key words missing: …"
    const part: Fault = { kind: 'order', point: 'rapid-body-survey/rbs-regions', step: 12, label: 'RBS',
      detail: 'Out of order: Pelvis before Abdomen.', atMs: 140_000 };
    expect(fixStep(part, STEPS).text).toBe('Step 12, Rapid body survey.');
  });

  it('matches the step as a whole phrase: step 1 is not step 12', () => {
    expect(fixStep(order('Done during step 12, Rapid body survey.', 'respond-call/call-sign', 1), STEPS).text).toBe('Step 1, Respond call.');
    expect(fixStep(order('Done during STEP 1, Respond call.', 'respond-call/call-sign', 1), STEPS).text).toBeNull();
  });

  it('a step since gone: its number alone, no link, and not where the detail names it', () => {
    expect(fixStep(order(null, 'gone-step/x', 9), STEPS)).toEqual({ text: 'Step 9.', notesRef: null });
    expect(fixStep(order('Done out of order within step 9.', 'gone-step/x', 9), STEPS)).toEqual({ text: null, notesRef: null });
  });
});

describe('the drill’s opening line (resolution 8)', () => {
  it('is told from every other system line by isDrillOpening, for a drill on every step', () => {
    const env = envOf('copd-amk-01');
    for (const st of STEPS) {
      const s = startDrill(env, st.id, [], null, IDS, T0);
      const line = s.lines.at(-1)!;
      expect(line.who).toBe('system');
      expect(isDrillOpening(line.text)).toBe(true);
    }
    for (const c of CASES) {
      const first = startRun(envOf(c.id), 'coached', IDS, T0).lines[0]!;
      expect(isDrillOpening(first.text)).toBe(false);
    }
  });

  it('reads "Drill" in the transcript, and every other line as saved', () => {
    const env = envOf('copd-amk-01');
    const r = endRun(env, startDrill(env, 'rapid-body-survey', [], null, IDS, T0), T0);
    expect(r.transcript.map((l) => l.who)).toEqual(['Dispatch', 'Dispatch']);
    expect(transcriptOf(r).map((l) => l.who)).toEqual(['Dispatch', DRILL_SPEAKER]);
    expect(DRILL_SPEAKER).toBe('Drill');
    expect(transcriptOf(R)).toEqual(R.transcript);
  });

  it('relabels only a line saved under Dispatch, as the run chat reads only system lines', () => {
    const env = envOf('copd-amk-01');
    const r = endRun(env, startDrill(env, 'rapid-body-survey', [], null, IDS, T0), T0);
    const typed = { who: 'You', text: r.transcript[1]!.text, atMs: null };
    expect(transcriptOf({ ...r, transcript: [...r.transcript, typed] }).map((l) => l.who)).toEqual(['Dispatch', DRILL_SPEAKER, 'You']);
  });
});

describe('the record of a drill', () => {
  it('keeps the run its chain came from (resolution 11)', () => {
    const env = envOf('copd-amk-01');
    const s = hitAll(startDrill(env, 'scene-evaluation', ['introduction'], 'run-0', IDS, T0), STEPS, copd,
      ['preparation', 'scene-evaluation', 'approach-patient']);
    expect(endRun(env, s, T0).sourceRunId).toBe('run-0');
    expect(R.sourceRunId).toBeNull();
  });
});

// Task 17: the debrief screen (#/debrief/:id, mockup screen 3): the verdict, the replay and the figures, the disputable
// fix list with its notes links, tapped steps, what went well, the case record, the transcript, the key bar with Drill
// the fixes and the drill chain, the hold on a fresh arrival (S5), and the reveal.
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { MemoryStorage } from './helpers';
import { CASES, POCKET, STEPS, T0, blankSession, caseById, debriefRecord, debriefSession, envOf, hitAll, recordOf } from './sim-helpers';
import { back, matchRoute } from '../../src/app/routes';
import { primeContent, resetContentCache } from '../../src/data/load';
import { ProgressContext } from '../../src/progress/hooks';
import { createProgressStore, type ProgressStore } from '../../src/progress/store';
import type { Fault, Progress, RunRecord } from '../../src/progress/types';
import { READ_HOLD_MS } from '../../src/quiz/useQuiz';
import { Debrief } from '../../src/run/Debrief';
import { etaMinutes } from '../../src/sim/clock';
import { replaySummary } from '../../src/sim/debrief';
import { startDrill } from '../../src/sim/drill';
import { fillCanonical } from '../../src/sim/replies';
import { endRun } from '../../src/sim/run';
import { ToastHost, clearToasts } from '../../src/ui/toast';

// back() steps through real history; a spy says where Close goes.
vi.mock('../../src/app/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/routes')>();
  return { ...actual, back: vi.fn() };
});

const copd = caseById('copd-amk-01');
const env = envOf('copd-amk-01');
const R = debriefRecord();
const CLEAN = debriefRecord({ faults: false });
const DRILL_IDS = { id: 'drill-1', startedAt: '2026-11-13T15:00:00.000Z' };

/** A drill on step 4 from the sample run, its range (3 to 5) played through, with `chain` still to drill. */
function drillRecord(chain: string[]): RunRecord {
  const s = startDrill(env, 'scene-evaluation', chain, R.id, DRILL_IDS, T0);
  return endRun(env, hitAll(s, STEPS, copd, ['preparation', 'scene-evaluation', 'approach-patient']), T0);
}

/** The sample run with a BVM at 15 L/min given in breathing: an oxygen Wrong fault, its detail ending with the note. */
function bvmRecord(): RunRecord {
  const s = debriefSession({ faults: false });
  const key = 'breathing/mask-flow';
  const hit = s.hits[key]!;
  return endRun(env, { ...s, hits: { ...s.hits, [key]: { ...hit, check: 'wrong', chose: 'BVM 15 L/min', atMs: 75_000 } },
    oxygen: { device: 'bvm', flow: 15, atMs: 75_000, right: false } }, T0);
}

function makeStore(patch: Partial<Progress> = {}): ProgressStore {
  const store = createProgressStore(new MemoryStorage());
  if (Object.keys(patch).length > 0) store.update((p) => ({ ...p, ...patch }));
  return store;
}

function renderAt(store: ProgressStore, hash: string) {
  location.hash = hash;
  return render(<ProgressContext.Provider value={store}><Debrief match={matchRoute(hash)} /><ToastHost /></ProgressContext.Provider>);
}
/** The debrief of `r`, the only run on record. */
const show = (r: RunRecord, query = '') => {
  const store = makeStore({ runs: [r] });
  renderAt(store, `#/debrief/${r.id}${query}`);
  return store;
};

const root = () => document.querySelector<HTMLElement>('.debrief')!;
const keyBar = () => document.querySelector<HTMLElement>('.qkeys')!;
const fixRows = (name = '3 to fix') => within(screen.getByRole('list', { name })).getAllByRole('listitem');
const button = (name: string) => screen.getByRole('button', { name });
const figures = () => document.querySelector<HTMLElement>('.figs')!;

beforeEach(() => {
  resetContentCache();
  primeContent('steps', { contentVersion: 'test', steps: STEPS });
  primeContent('cases', CASES);
});

afterEach(() => {
  vi.mocked(back).mockClear();
  vi.useRealTimers();
  clearToasts();
  resetContentCache();
});

describe('Debrief: the top', () => {
  it('heads with Debrief over the case line, then the verdict and its sub, and the replay named by its summary', () => {
    show(R);
    expect(screen.getByRole('heading', { level: 1, name: 'Debrief' })).toBeTruthy();
    expect(screen.getByText('Breathlessness, Ang Mo Kio. Coached.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '3 to fix' })).toBeTruthy();
    expect(screen.getByText('Suspected COPD. Mdm Tan, 72.')).toBeTruthy();
    expect(screen.getByRole('img', { name: replaySummary(R, STEPS) })).toBeTruthy();
    expect(document.querySelector('.vband')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('Close goes back, to Today when there is nothing to go back to', () => {
    show(R);
    fireEvent.click(button('Close'));
    expect(back).toHaveBeenCalledWith('/');
  });
});

describe('Debrief: the figures', () => {
  it('show Time, RBS done with its ✓ and Steps, each over its limit', () => {
    show(R);
    const f = within(figures());
    expect(f.getByText('17:42')).toBeTruthy();
    expect(f.getByText('/20:00')).toBeTruthy();
    expect(f.getByText('2:41')).toBeTruthy();
    expect(f.getByText('/3:00')).toBeTruthy();
    expect(f.getByLabelText('within 3:00').textContent).toBe('✓');
    expect(f.getByText('Steps')).toBeTruthy();
    expect(f.getByText('16')).toBeTruthy();
    expect(f.getByText('/19')).toBeTruthy();
  });

  it('show a late RBS rounded up and with no ✓ (3:00.4 reads 3:01)', () => {
    show({ ...R, rbsMs: 180_400 });
    const f = within(figures());
    expect(f.getByText('3:01')).toBeTruthy();
    expect(f.queryByLabelText('within 3:00')).toBeNull();
  });
});

describe('Debrief: the fix list', () => {
  it('lists the faults in order, each with its number, chip, label, step and notes link', () => {
    show(R);
    const rows = fixRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('!!!Missed');
    expect(rows[0]!.textContent).toContain('Pocket check, after seeking permission');
    expect(rows[0]!.textContent).toContain('Step 12, Rapid body survey.');
    const notes = within(rows[0]!).getByRole('link', { name: 'Notes 1' });
    expect(notes.getAttribute('href')).toBe('#/notes/s01/rapid-body-survey');
    expect(notes.classList.contains('ilink')).toBe(true);
    expect(rows[1]!.textContent).toContain('!!Order');
    expect(rows[1]!.textContent).toContain('My buddy will do a head grip on you, please allow him');
    // an Order detail names its step already, so the row says it once (Task 17 review, Important 1)
    expect(rows[1]!.querySelector('.fix-s')!.textContent)
      .toBe('Done during step 5, Approach patient. It belongs to step 6, Introduction. Notes 1.');
    expect(rows[2]!.textContent).toContain('!!Phrase');
    expect(rows[2]!.querySelector('.fix-s')!.textContent).toBe('Key words missing: “suspected”. Step 4, Rescue scene evaluation. Notes 1.');
    expect(rows.map((r) => r.querySelector('.num')?.className)).toEqual(['num num-hi', 'num num-med', 'num num-med']);
  });

  it('describes each row’s key by the row’s label, so three “Not what I meant” keys are told apart', () => {
    show(R);
    const keys = screen.getAllByRole('button', { name: 'Not what I meant' });
    const described = keys.map((k) => document.getElementById(k.getAttribute('aria-describedby') ?? '')?.textContent);
    expect(described).toEqual(R.faults.map((f) => f.label));
  });

  it('“Not what I meant” sets a point aside, saved, and “Count it again” brings it back', () => {
    const store = show(R);
    fireEvent.click(within(fixRows()[0]!).getByRole('button', { name: 'Not what I meant' }));
    expect(screen.getByRole('heading', { level: 2, name: '2 to fix' })).toBeTruthy();
    expect(fixRows('2 to fix')).toHaveLength(2);
    expect(store.get().runs[0]!.disputes).toEqual([POCKET]);
    expect(store.get().runs[0]!.missed).toEqual([]);
    const disputed = screen.getByRole('list', { name: 'Disputed, not counted' });
    expect(within(disputed).getByText('Pocket check, after seeking permission')).toBeTruthy();
    // focus follows the row, so a slip can be undone at once
    expect(document.activeElement).toBe(within(disputed).getByRole('button', { name: 'Count it again' }));
    expect(screen.getByRole('img', { name: replaySummary(store.get().runs[0]!, STEPS) })).toBeTruthy();

    fireEvent.click(within(disputed).getByRole('button', { name: 'Count it again' }));
    expect(screen.getByRole('heading', { level: 2, name: '3 to fix' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Disputed, not counted' })).toBeNull();
    expect(store.get().runs[0]!.disputes).toEqual([]);
    expect(store.get().runs[0]!.missed).toEqual([POCKET]);
    expect(document.activeElement).toBe(within(fixRows()[0]!).getByRole('button', { name: 'Not what I meant' }));
  });

  it('keeps a point that has left the steps: its saved label, its step number, no notes link', () => {
    const gone: Fault[] = [
      { kind: 'missed', point: 'rapid-body-survey/gone-point', step: 12, label: 'A point since retired', detail: null, atMs: 200_000 },
      { kind: 'order', point: 'gone-step/x', step: 9, label: 'A step since retired', detail: null, atMs: 60_000 },
    ];
    show({ ...CLEAN, faults: gone });
    const rows = fixRows('2 to fix');
    expect(rows[0]!.textContent).toContain('A point since retired');
    expect(rows[0]!.textContent).toContain('Step 12.');
    expect(within(rows[0]!).queryByRole('link')).toBeNull();
    expect(rows[1]!.textContent).toContain('Step 9.');
    expect(within(rows[1]!).queryByRole('link')).toBeNull();
  });

  it('folds a long oxygen note under “Why this oxygen”, so the row keeps its step, link and key in view', () => {
    const r = bvmRecord();
    const note = copd.expected.oxygen.note!;
    expect(r.faults.map((f) => f.kind)).toEqual(['wrong']);
    show(r);
    const row = fixRows('1 to fix')[0]!;
    expect(row.textContent).toContain('!!!Wrong');
    const sub = row.querySelector('.fix-s')!;
    expect(sub.textContent).toBe("Gave BVM 15 L/min. This patient needs nasal cannula 2–4 L/min. Readings didn't improve. Step 10, Breathing. Notes 1.");
    const why = row.querySelector('details')!;
    expect(why.querySelector('summary')!.textContent).toBe('Why this oxygen');
    expect(why.textContent).toContain(note);
    expect(why.open).toBe(false);
    expect(within(row).getByRole('button', { name: 'Not what I meant' })).toBeTruthy();
  });

  it('says which steps were tapped, and that they are not counted', () => {
    show({ ...CLEAN, tapped: ['introduction'] });
    expect(screen.getByText('Tapped from the step list: Step 6. Not counted.')).toBeTruthy();
  });

  // Task 3 review round 1 (I1): AMS is a medical Load & Go (Plan 3 D21). A trainee who says Stay & Treat there misses the
  // Load & Go point, and the fix list names it by the plan, never "Trauma:".
  it('names a missed Load & Go in the AMS case by its plan, not by the case type', async () => {
    const ams = caseById('ams-sengkang-01');
    const stayAndTreat = 'So, I will Stay & Treat to see whether I can initiate any protocols.';
    const lines = STEPS.map((st) => {
      const line = fillCanonical(st.canonicalLine, ams, etaMinutes(Math.max(0, st.order - 5) * 20_000), st.mustHit);
      return st.id === 'decision-point' ? line.replace('It is a Load & Go case.', stayAndTreat) : line;
    });
    expect(lines[17]).toContain(stayAndTreat);
    const r = await recordOf(ams.id, 'coached', lines);
    const missed = r.faults.find((f) => f.point === 'decision-point/load-and-go');
    expect(missed).toMatchObject({ kind: 'missed', step: 18, label: 'Load & Go: "It is a Load & Go case"' });
    expect(r.faults.map((f) => f.point)).not.toContain('decision-point/stay-and-treat');   // not the AMS case's plan
    show(r);
    const row = document.querySelector<HTMLElement>('.fix[data-point="decision-point/load-and-go"]')!;
    expect(row.textContent).toContain('!!!Missed');
    expect(row.querySelector('.fix-t')!.textContent).toBe('Load & Go: "It is a Load & Go case"');
    expect(row.querySelector('.fix-s')!.textContent).toContain('Step 18, Decision point.');
    expect(root().textContent).not.toContain('Trauma:');
  });
});

describe('Debrief: a clean run', () => {
  it('reads "Nothing to fix this run." with a lone New case link, and what went well', () => {
    show(CLEAN);
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing to fix this run.' })).toBeTruthy();
    const keys = within(keyBar());
    expect(keys.getAllByRole('link').map((a) => a.textContent)).toEqual(['New case']);
    expect(keys.getByRole('link', { name: 'New case' }).getAttribute('href')).toBe('#/pam/start');
    expect(keys.queryAllByRole('button')).toHaveLength(0);
    expect(keyBar().classList.contains('qkeys-one')).toBe(true);
    const well = screen.getByRole('list', { name: 'Went well' });
    expect(within(well).getAllByRole('listitem').map((li) => li.textContent)[0]).toBe('RBS done in 2:41.');
  });
});

describe('Debrief: the case record', () => {
  it('lists what the trainee found, a vitals table by time, the standby call and the SRACIE slots', () => {
    show(R);
    const rec = within(screen.getByRole('region', { name: 'Case record' }));
    expect(rec.getByText(copd.patient.chiefComplaint)).toBeTruthy();
    expect(rec.getByText('nasal cannula 2 L/min')).toBeTruthy();
    expect(rec.getByText('6.8 mmol/L')).toBeTruthy();
    const vitals = within(rec.getByRole('region', { name: 'Vitals' }));
    expect(vitals.getAllByRole('columnheader')).toHaveLength(8);
    for (const name of ['Time', 'SpO2', 'PR', 'RR', 'BP', 'Temp', 'CRT', 'Skin']) expect(vitals.getByRole('columnheader', { name })).toBeTruthy();
    const rows = vitals.getAllByRole('row').slice(1);
    expect(rows.map((tr) => tr.querySelector('th')?.textContent)).toEqual(['01:20', '05:00', '07:00']);
    expect(rows[1]!.textContent).toContain('146/86');
    // the speaker is set apart from what was said, for the eye and the ear alike
    expect(rec.getByText('Request Alpha for unstable case: sex, race, age, case, 2 signs, IC no., ETA').textContent)
      .toBe('You: Request Alpha for unstable case: sex, race, age, case, 2 signs, IC no., ETA');
    const slots = within(rec.getByRole('list', { name: 'SRACIE' })).getAllByRole('listitem');
    expect(slots).toHaveLength(6);
    expect(slots[0]!.getAttribute('aria-label')).toBe('S, sex: covered');
    expect(slots.every((li) => li.classList.contains('sr-on'))).toBe(true);
  });

  it('shows a slot not covered dashed, and "—" for what was never recorded', () => {
    show({ ...R, record: { ...R.record!, sracie: ['S', 'R', 'A', 'C', 'I'], hypocount: null, standby: [] } });
    const rec = within(screen.getByRole('region', { name: 'Case record' }));
    const slots = within(rec.getByRole('list', { name: 'SRACIE' })).getAllByRole('listitem');
    expect(slots[5]!.getAttribute('aria-label')).toBe('E, ETA: not covered');
    expect(slots[5]!.classList.contains('sr-on')).toBe(false);
    expect(rec.getByText('Hypocount').nextElementSibling?.textContent).toBe('—');
    expect(rec.getByText('No standby call.')).toBeTruthy();
  });

  it('in a drill, fills Drill rows until a key is taken again (D8 as amended)', () => {
    // a drill on step 17: the steps before it are filled in, findings and readings known, none of them timed
    show(endRun(env, startDrill(env, 'position', [], null, DRILL_IDS, T0), T0));
    const vitals = within(screen.getByRole('region', { name: 'Vitals' }));
    const rows = vitals.getAllByRole('row').slice(1);
    expect(rows.map((tr) => tr.querySelector('th')?.textContent)).toEqual(['Drill', 'Drill']);
    // the second row is the arm buddy's set: SpO2 again, then PR, BP and CRT; the first holds the first SpO2
    expect(rows.map((tr) => [...tr.querySelectorAll('td')].filter((td) => td.textContent !== '').length)).toEqual([4, 4]);
  });

  it('says so when no vitals were taken', () => {
    show(drillRecord([]));
    expect(screen.queryByRole('region', { name: 'Vitals' })).toBeNull();
    expect(screen.getByText('None taken.')).toBeTruthy();
  });
});

describe('Debrief: the transcript', () => {
  it('is folded away, with its line count, each line with its time and speaker', () => {
    show(R);
    const t = document.querySelector<HTMLDetailsElement>('details.transcript')!;
    expect(t.open).toBe(false);
    expect(t.querySelector('summary')!.textContent).toBe(`Transcript, ${R.transcript.length} lines`);
    const first = t.querySelectorAll('li')[0]!;
    expect(first.textContent).toContain('Dispatch');
    expect(first.textContent).toContain('Call');
  });

  it('labels a drill’s opening line Drill, not Dispatch', () => {
    show(drillRecord([]));
    const lines = [...document.querySelectorAll('details.transcript li')];
    const opening = lines.find((li) => li.textContent?.includes('Drill on step 4'))!;
    expect(opening.querySelector('.tl-who')!.textContent).toBe('Drill');
    expect(lines[0]!.querySelector('.tl-who')!.textContent).toBe('Dispatch');
  });
});

describe('Debrief: the keys', () => {
  it('with faults left: New case and Drill the fixes, which drills the first step and chains the rest', () => {
    const store = show(R);
    const keys = within(keyBar());
    expect(keys.getByRole('link', { name: 'New case' }).getAttribute('href')).toBe('#/pam/start');
    fireEvent.click(keys.getByRole('button', { name: 'Drill the fixes' }));
    expect(store.get().runOpen?.drill).toEqual({
      target: 'scene-evaluation', from: 3, to: 5, chain: ['introduction', 'rapid-body-survey'], sourceRunId: R.id,
    });
    expect(location.hash).toBe('#/run');
  });

  it('with a run open, notes under the drill key that it replaces the run', () => {
    const store = makeStore({ runs: [R], runOpen: blankSession('copd-amk-01') });
    renderAt(store, `#/debrief/${R.id}`);
    const note = within(keyBar()).getByText('This replaces your open run.');
    expect(button('Drill the fixes').getAttribute('aria-describedby')).toBe(note.id);
  });

  it('a drill: Drill debrief, Steps only, Back to Today and the next drill, which keeps the chain on the first run', () => {
    const d = drillRecord(['introduction', 'rapid-body-survey']);
    expect(d.sourceRunId).toBe(R.id);
    const store = show(d);
    expect(screen.getByRole('heading', { level: 1, name: 'Drill debrief' })).toBeTruthy();
    expect(screen.getByText('Breathlessness, Ang Mo Kio. Drill on steps 3 to 5.')).toBeTruthy();
    expect(within(figures()).queryByText('Time')).toBeNull();
    expect(within(figures()).getByText('Steps')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /^Run replay/ })).toBeNull();
    const keys = within(keyBar());
    expect(keys.getByRole('link', { name: 'Back to Today' }).getAttribute('href')).toBe('#/');
    // a no-break space holds "step 6" together where the key's label wraps
    fireEvent.click(keys.getByRole('button', { name: /^Next drill: step\s6, Introduction$/ }));
    expect(store.get().runOpen?.drill).toEqual({ target: 'introduction', from: 5, to: 7, chain: ['rapid-body-survey'], sourceRunId: R.id });
    expect(location.hash).toBe('#/run');
  });

  it('a drill at the end of its chain: Back to Today and New case', () => {
    show(drillRecord([]));
    const keys = within(keyBar());
    expect(keys.getAllByRole('link').map((a) => a.textContent)).toEqual(['Back to Today', 'New case']);
    expect(keys.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Debrief: a record that has lost its case or is gone', () => {
  it('still shows the debrief from the record, with no drill key and New case kept (resolution 10)', () => {
    show({ ...R, caseId: 'gone-case-01' });
    expect(screen.getByText('A removed case. Coached.')).toBeTruthy();
    expect(screen.getByText("This case isn't on this phone any more, so it can't be drilled.")).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '3 to fix' })).toBeTruthy();
    expect(fixRows()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Drill the fixes' })).toBeNull();
    expect(within(keyBar()).getAllByRole('link').map((a) => a.textContent)).toEqual(['New case']);
    expect(screen.getByRole('region', { name: 'Case record' })).toBeTruthy();
  });

  it('a drill whose case is gone offers no next drill', () => {
    show({ ...drillRecord(['introduction']), caseId: 'gone-case-01' });
    expect(screen.queryByRole('button', { name: /^Next drill/ })).toBeNull();
    expect(within(keyBar()).getAllByRole('link').map((a) => a.textContent)).toEqual(['Back to Today', 'New case']);
  });

  it("says a run that isn't on record is gone, with the way back to Today", () => {
    renderAt(makeStore({ runs: [R] }), '#/debrief/run-nope');
    expect(screen.getByText("This run isn't on this phone any more.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Today' }).getAttribute('href')).toBe('#/');
  });
});

describe('Debrief: a fresh arrival', () => {
  it('reveals at ?fresh=1: reveal, then reveal-go on the next frame, and reveal-skip after a pointerdown', async () => {
    show(R, '?fresh=1');
    expect(root().classList.contains('reveal')).toBe(true);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    expect(root().classList.contains('reveal-go')).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(root().classList.contains('reveal-skip')).toBe(true);
  });

  it('staggers the fix rows’ delays from 760 ms by 60 ms, to 940 ms at most', () => {
    const many = { ...R, faults: Array.from({ length: 5 }, (_, i): Fault =>
      ({ kind: 'missed', point: `notification/p${i}`, step: 19, label: `Point ${i}`, detail: null, atMs: 1_000_000 })) };
    show(many, '?fresh=1');
    const delays = [...document.querySelectorAll<HTMLElement>('.fixes .fix')].map((li) => li.style.getPropertyValue('--fix-d'));
    expect(delays).toEqual(['760ms', '820ms', '880ms', '940ms', '940ms']);
  });

  it('does not reveal without it', () => {
    show(R);
    expect(root().classList.contains('reveal')).toBe(false);
  });

  describe('the hold (S5)', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['performance'] }); });
    const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    /** Clicks `el`, and says whether the click was let through (not cancelled). */
    const clickThrough = (el: Element) => { const ev = createEvent.click(el); fireEvent(el, ev); return !ev.defaultPrevented; };

    it('every key ignores presses within READ_HOLD_MS of the debrief appearing', () => {
      const store = show(R, '?fresh=1');
      fireEvent.click(button('Drill the fixes'));   // the second tap of a double tap on the run's End
      expect(store.get().runOpen).toBeNull();
      expect(clickThrough(screen.getByRole('link', { name: 'New case' }))).toBe(false);
      fireEvent.click(within(fixRows()[0]!).getByRole('button', { name: 'Not what I meant' }));
      expect(store.get().runs[0]!.disputes).toEqual([]);
      wait(READ_HOLD_MS - 50);
      fireEvent.click(button('Drill the fixes'));
      expect(store.get().runOpen).toBeNull();
      wait(100);
      expect(clickThrough(screen.getByRole('link', { name: 'New case' }))).toBe(true);
      fireEvent.click(button('Drill the fixes'));
      expect(store.get().runOpen?.drill?.target).toBe('scene-evaluation');
    });

    it('opened later, from Today, the keys take a press at once', () => {
      const store = show(R);
      fireEvent.click(button('Drill the fixes'));
      expect(store.get().runOpen?.drill?.target).toBe('scene-evaluation');
    });
  });
});

describe('base.css', () => {
  it('zeroes every delay under reduced motion (the carry)', () => {
    expect(readFileSync('src/styles/base.css', 'utf8')).toMatch(/prefers-reduced-motion: reduce[^}]*\{[^}]*transition-delay: 0s !important/s);
    expect(readFileSync('src/styles/base.css', 'utf8')).toMatch(/prefers-reduced-motion: reduce[^}]*\{[^}]*animation-delay: 0s !important/s);
  });
});

// ---- Plan 3 Task 7 ---------------------------------------------------------------------------------------------

describe('Debrief: replacing an open run (M1, ruling D26)', () => {
  it('"Drill the fixes" with a run open toasts "Run replaced." with Undo, which puts that run back', () => {
    const open = blankSession('copd-amk-01');
    const store = makeStore({ runs: [R], runOpen: open });
    renderAt(store, `#/debrief/${R.id}`);
    fireEvent.click(button('Drill the fixes'));
    expect(store.get().runOpen?.drill?.sourceRunId).toBe(R.id);
    expect(screen.getByText('Run replaced.')).toBeTruthy();
    fireEvent.click(button('Undo'));
    expect(store.get().runOpen).toEqual(open);
  });

  it('with no run open, "Drill the fixes" toasts nothing', () => {
    show(R);
    fireEvent.click(button('Drill the fixes'));
    expect(screen.queryByText('Run replaced.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('Debrief: a transcript not kept (parked 7, ruling D28)', () => {
  it('a record with an empty transcript says "Only your newest runs keep their transcripts."', () => {
    show({ ...R, transcript: [] });
    expect(screen.getByText('Only your newest runs keep their transcripts.')).toBeTruthy();
    expect(screen.queryByText(/Only the newest \d+ runs/)).toBeNull();
    expect(document.querySelector('details.transcript')).toBeNull();
  });
});

describe('Debrief: the smart tester note (Plan 3 Task 9, D15)', () => {
  it('smartLines 2: a note under the case line says the smart tester credited 2 lines', () => {
    show({ ...R, smartLines: 2 });
    const note = screen.getByText("The smart tester credited 2 lines the keyword rules couldn't place.");
    expect(note.className).toBe('dnote');
    expect(note.previousElementSibling).toBe(screen.getByText('Suspected COPD. Mdm Tan, 72.'));
  });

  it('smartLines 1 says "1 line"', () => {
    show({ ...R, smartLines: 1 });
    expect(screen.getByText("The smart tester credited 1 line the keyword rules couldn't place.")).toBeTruthy();
  });

  it('smartLines 0 shows nothing', () => {
    show(R);
    expect(R.smartLines).toBe(0);
    expect(screen.queryByText(/smart tester/i)).toBeNull();
  });
});

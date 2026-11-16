// The debrief's case record (spec §6.2 Debrief): laid out like the Ambulance Case Record and filled only from what the
// trainee asked for and did, as the run saved it (RunRecord.record and readings). A list of the findings, each "—" when
// never recorded; the vitals with their times, in a table that scrolls sideways inside its own region so the page never
// does; the standby call's lines; and the six SRACIE slots, a covered one lit with the done fill, an uncovered one
// dashed like an empty vitals tile. Readings are cabin white, as everywhere: judging them is the trainee's job.
import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import type { VitalKey } from '../data/schema';
import type { RunRecord } from '../progress/types';
import { SRACIE, VITAL_COLUMNS, vitalsRows } from '../sim/debrief';

/** A reading's cell: SpO2's oxygen and Temp's unit ('90% NC', '37.2 °C') set smaller after the figure, as the vitals
 *  rail sets SpO2's %, so where the column is narrow the unit drops under the figure (Task 20 review). */
function VitalCell({ col, text }: { col: VitalKey; text: string }): JSX.Element {
  const space = text.indexOf(' ');
  if ((col !== 'spo2' && col !== 'temp') || space < 0) return <td>{text}</td>;
  return <td>{text.slice(0, space)} <small class="vu">{text.slice(space + 1)}</small></td>;
}

export function CaseRecord({ r }: { r: RunRecord }): JSX.Element {
  const ids = useId();
  const rec = r.record;
  const facts: readonly [string, string | null][] = [
    ['Complaint', rec?.complaint ?? null], ['MOI', rec?.moi ?? null], ['Oxygen', rec?.oxygen ?? null],
    ['ECG', rec?.ecg ?? null], ['Hypocount', rec?.hypocount ?? null], ['Position', rec?.position ?? null],
    ['Decision', rec?.decision ?? null],
  ];
  const rows = vitalsRows(r);
  const standby = rec?.standby ?? [];
  const lit = rec?.sracie ?? [];
  return (
    <section class="panel crec" aria-labelledby={`${ids}-h`}>
      <h2 class="plabel" id={`${ids}-h`}>Case record</h2>
      <dl class="crec-dl">
        {facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value ?? '—'}</dd></div>)}
      </dl>

      <h3 class="crec-h3" id={`${ids}-v`}>Vitals</h3>
      {rows.length === 0 ? <p class="crec-none">None taken.</p> : (
        // Focusable, so the table scrolls from a keyboard too.
        <div class="table-scroll crec-vitals" role="region" aria-labelledby={`${ids}-v`} tabIndex={0}>
          <table class="vtable tn">
            <thead>
              <tr>
                <th scope="col">Time</th>
                {VITAL_COLUMNS.map((col) => (
                  <th scope="col" key={col.key}>
                    {col.key === 'spo2' ? <><span aria-hidden="true">SpO<sub>2</sub></span><span class="vh">SpO2</span></> : col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{row.time}</th>
                  {VITAL_COLUMNS.map((col) => <VitalCell key={col.key} col={col.key} text={row.cells[col.key] ?? ''} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 class="crec-h3">Standby call</h3>
      {standby.length === 0 ? <p class="crec-none">No standby call.</p> : (
        <ol class="sb-lines">
          {standby.map((l, i) => <li key={i}><b>{l.who}:</b> {l.text}</li>)}
        </ol>
      )}
      <ul class="sracie" aria-label="SRACIE">
        {SRACIE.map((x) => {
          const on = lit.includes(x.letter);
          return (
            <li key={x.letter} class={on ? 'sr-on' : undefined} aria-label={`${x.letter}, ${x.name}: ${on ? 'covered' : 'not covered'}`}>
              <span aria-hidden="true">{x.letter}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

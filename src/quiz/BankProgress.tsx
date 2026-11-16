// Quiz progress per bank: "Medical and trauma, 96 of 346 answered" over a track, from the mockup's Theory quiz panel.
// The Quiz tab shows it as "Bank progress"; Today (Task 20) shows it as "Theory quiz" with the review link as `aside`,
// and right under that link, as `asideNote`, the note that the review replaces an open quiz.
import type { ComponentChildren, JSX } from 'preact';
import { Panel } from '../ui/Panel';

/** One bank's row, as the engine's bankProgress() returns it. */
export interface BankRow { group: 'mt' | 'hmls'; label: string; answered: number; total: number }

export function BankProgress({ title, rows, aside, asideNote }:
  { title: string; rows: BankRow[]; aside?: ComponentChildren; asideNote?: ComponentChildren }): JSX.Element {
  return (
    <Panel class="bankp">
      <div class="bankp-head">
        <h2 class="plabel">{title}</h2>
        {aside}
      </div>
      {asideNote}
      <ul class="bankp-rows">
        {rows.map((r, i) => (
          <li key={r.group}>
            <div class="qrow">
              <span>{r.label}</span>
              {/* The mockup writes "answered" once, on the first row; a screen reader hears it on every row. */}
              <span class="qn tn"><b>{r.answered}</b> of {r.total}{i === 0 ? ' answered' : <span class="vh"> answered</span>}</span>
            </div>
            <div class="track" aria-hidden="true"><i style={{ width: `${r.total > 0 ? (r.answered / r.total) * 100 : 0}%` }} /></div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

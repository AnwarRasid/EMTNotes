// The vitals rail (spec §6.2, mockup screen 2): SpO2, PR, RR and BP, then Temp, Hypo and GCS once each is reported.
// Every reading is cabin white, never a status colour (judging it is the trainee's job). In Coached and drills the first
// four always show, dashed until reported; in Exam a tile shows only once reported. Each tile keeps its own place, so a
// reading arriving never moves another.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Reading, ReadingKey, RunMode } from '../progress/types';

type TileKey = Extract<ReadingKey, 'spo2' | 'pr' | 'rr' | 'bp' | 'temp' | 'hypocount' | 'gcs'>;
/** A tile: its name; `unit` set after the figure (SpO2's %); `side` set at the right of the name, as SpO2's device is,
 *  so the figure gets the tile's whole width (Temp's °C, Hypo's mmol/L; Task 13 review, Minor 7). */
interface TileDef { key: TileKey; label: string; unit?: string; side?: string; always: boolean }

const TILES: readonly TileDef[] = [
  { key: 'spo2', label: 'SpO2', unit: '%', always: true },
  { key: 'pr', label: 'PR', always: true },
  { key: 'rr', label: 'RR', always: true },
  { key: 'bp', label: 'BP', always: true },
  { key: 'temp', label: 'Temp', side: '°C', always: false },
  { key: 'hypocount', label: 'Hypo', side: 'mmol/L', always: false },
  { key: 'gcs', label: 'GCS', always: false },
];

/** A tile's name row: the name, then what sits at its right (the reading's device for SpO2, the unit for Temp and
 *  Hypo). SpO2 is set as SpO₂, the clinical form, since the face draws O and 0 alike; a screen reader hears "SpO2". */
function NameRow({ def, right }: { def: TileDef; right: string | null }): JSX.Element {
  return (
    <div class="vl">
      {def.key === 'spo2'
        ? <span><span aria-hidden="true">SpO<sub>2</sub></span><span class="vh">{def.label}</span></span>
        : <span>{def.label}</span>}
      {right !== null && <span>{right}</span>}
    </div>
  );
}

/** How long a new reading shows "– –" before its value: --t-base (spec §9). */
export const SETTLE_MS = 220;

// How wide a value sets in the tiles' figure face (Barlow Condensed 700, tabular figures), in em, as measured in Chromium:
// each tile sets its value as large as fits, up to 2rem (components.css .vv), so "176/94" fits its tile on a 360px phone
// and at the largest text size. A unit is set at .4375em of the value, so it scales with it.
const DIGIT_EM = 0.498;
const GLYPH_EM: Readonly<Record<string, number>> = { '/': 0.415, '.': 0.223, ' ': 0.2 };
const UNIT_EM: Readonly<Record<string, number>> = { '%': 0.351 };
const GAP_EM = 0.125;
/** "– –", with its .06em letter spacing. */
const DASHES_EM = 1.14;

/** The width of `value` and its unit, in em of the value. */
function widthEm(value: string, unit: string | undefined): number {
  const text = [...value].reduce((w, ch) => w + (GLYPH_EM[ch] ?? DIGIT_EM), 0);
  return unit === undefined ? text : text + GAP_EM + (UNIT_EM[unit] ?? 0.25 * unit.length);
}
/** The style that lets a tile's figure take its width: CSS sets the font as large as fits, up to 2rem. */
const fit = (em: number) => ({ '--vv-em': em.toFixed(3) });

/** The newest reading of each key. */
export function latestReadings(readings: Reading[]): Partial<Record<ReadingKey, Reading>> {
  const out: Partial<Record<ReadingKey, Reading>> = {};
  for (const r of readings) out[r.key] = r;
  return out;
}

/** How many readings of each key the run holds. Readings are only ever added, so a new one, even of the same value,
 *  raises its key's count. */
function countsOf(readings: Reading[]): Partial<Record<ReadingKey, number>> {
  const out: Partial<Record<ReadingKey, number>> = {};
  for (const r of readings) out[r.key] = (out[r.key] ?? 0) + 1;
  return out;
}

export function VitalsRail({ readings, mode }: { readings: Reading[]; mode: RunMode }): JSX.Element {
  // What the run held when the rail opened has settled already (ruling P33: a reload, or a baseline, shows it at once).
  const [opened] = useState(() => countsOf(readings));
  const latest = latestReadings(readings);
  const counts = countsOf(readings);
  const tiles = TILES.filter((t) => latest[t.key] !== undefined || (mode === 'coached' && t.always));
  if (tiles.length === 0) return <></>;
  return (
    <div class="vitals" role="group" aria-label="Vitals">
      {tiles.map((t) => <Tile key={t.key} def={t} reading={latest[t.key] ?? null} n={counts[t.key] ?? 0} from={opened[t.key] ?? 0} />)}
    </div>
  );
}

/**
 * One tile. A reading that arrives while the rail is up (its count `n` above the one on show) shows "– –" for SETTLE_MS,
 * then fades its value in over --t-fast. Under reduced motion base.css drops the fade, and the value swaps in after the
 * same 220 ms. `from` is the count the rail opened with.
 */
function Tile({ def, reading, n, from }: { def: TileDef; reading: Reading | null; n: number; from: number }): JSX.Element {
  const [shown, setShown] = useState(from);
  useEffect(() => {
    if (shown === n) return;
    const t = setTimeout(() => setShown(n), SETTLE_MS);
    return () => clearTimeout(t);
  }, [n, shown]);

  const cls = `vt vt-${def.key}`;
  const side = def.side ?? null;
  if (reading === null) {
    return (
      <div class={`${cls} vt-empty`}>
        <NameRow def={def} right={side} />
        <div class="vv" style={fit(DASHES_EM)}><span class="vh">not yet reported</span><span aria-hidden="true">– –</span></div>
      </div>
    );
  }
  if (shown !== n) {
    return (
      <div class={cls}>
        <NameRow def={def} right={side} />
        <div class="vv vv-wait" style={fit(DASHES_EM)}><span aria-hidden="true">– –</span></div>
      </div>
    );
  }
  return (
    <div class={cls}>
      <NameRow def={def} right={side ?? reading.o2} />
      <div key={shown} class={shown === from ? 'vv tn' : 'vv vv-in tn'} style={fit(widthEm(reading.value, def.unit))}>
        {reading.value}{def.unit !== undefined && <small>{def.unit}</small>}
      </div>
    </div>
  );
}

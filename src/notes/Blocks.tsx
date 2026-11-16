// The trainee's notes drawn as HTML (spec §6.5): headings, paragraphs, lists, tables, the Remark and Added note
// boxes, and figures, keeping their bold, italics, underline and highlights. Text shows as typed, literal `**`
// included. Every top-level block carries data-b, its index, which search hits (?b=) scroll to.
import { createContext, type ComponentChildren, type JSX } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import type { Block, Run } from '../data/schema';
import { blockText, isNumberMarker } from './text';

export type Table = Extract<Block, { k: 'table' }>;
type Row = Table['rows'][number];

/**
 * Each notes figure's size in pixels, so its box is held before the lazy image arrives and nothing below it moves
 * (an anchor scroll stays where it landed). The importer names the files (Task 5); a unit test checks this list
 * against them. A figure missing here still shows, sized when it loads.
 */
export const IMAGE_SIZES: Record<string, readonly [width: number, height: number]> = {
  'img/notes/s07-1.png': [324, 393],
  'img/notes/s08-1.png': [346, 452],
  'img/notes/s08-2.png': [346, 287],
  'img/notes/s09-1.png': [331, 319],
  'img/notes/s09-2.png': [705, 354],
  'img/notes/s10-1.png': [556, 503],
  'img/notes/s10-2.png': [473, 514],
  'img/notes/s10-3.png': [421, 128],
  'img/notes/s10-4.png': [421, 117],
  'img/notes/s10-5.png': [421, 124],
  'img/notes/s10-6.png': [421, 121],
  'img/notes/s10-7.png': [421, 129],
  'img/notes/s10-8.png': [463, 167],
  'img/notes/s10-9.png': [463, 166],
};

/** Each table's region name, for the blocks being drawn (tableNames). */
const TableNames = createContext<ReadonlyMap<Table, string>>(new Map());

/** A section's blocks, each marked with its index as data-b. */
export function Blocks({ blocks }: { blocks: Block[] }): JSX.Element {
  const names = useMemo(() => tableNames(blocks), [blocks]);
  return (
    <TableNames.Provider value={names}>
      {blocks.map((b, i) => <BlockView key={i} block={b} at={i} />)}
    </TableNames.Provider>
  );
}

/** Blocks inside a box or a table cell: no data-b, since only top-level blocks are search targets. */
function Nested({ blocks }: { blocks: Block[] }): JSX.Element {
  return <>{blocks.map((b, i) => <BlockView key={i} block={b} />)}</>;
}

/**
 * A paragraph's, list item's or heading's runs, each with its bold, italics and underline. A stretch of highlighted
 * runs shares one mark, so the fill runs unbroken across their joins ("to " then "Expose and Examine"). Spaces at
 * the ends of a mark or of a formatted run sit outside it: a highlight never paints a bare space, and the words
 * either side stay apart for a screen reader that trims the text inside each element.
 */
export function Runs({ runs }: { runs: Run[] }): JSX.Element {
  return <>{pieces(runs).map((p, i) => <Piece key={i} runs={p} />)}</>;
}

/** The runs in pieces: a highlighted stretch together, every other run on its own. */
function pieces(runs: Run[]): Run[][] {
  const out: Run[][] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (r.h && last?.[0]?.h) last.push(r);
    else out.push([r]);
  }
  return out;
}

/** `t` split into its leading spaces, the rest, and its trailing spaces. */
function edges(t: string): [lead: string, core: string, trail: string] {
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t) ?? [];
  return [lead, core, trail];
}

/** The runs less `start` characters at the front and `end` at the back; a run left empty is dropped. */
function trimmed(runs: Run[], start: number, end: number): Run[] {
  const out = runs.map((r) => {
    const cut = Math.min(start, r.t.length);
    start -= cut;
    return { ...r, t: r.t.slice(cut) };
  });
  for (let k = out.length - 1; k >= 0 && end > 0; k -= 1) {
    const r = out[k]!;
    const cut = Math.min(end, r.t.length);
    end -= cut;
    out[k] = { ...r, t: r.t.slice(0, r.t.length - cut) };
  }
  return out.filter((r) => r.t !== '');
}

function Piece({ runs }: { runs: Run[] }): JSX.Element {
  const text = runs.map((r) => r.t).join('');
  const [lead, core, trail] = edges(text);
  if (core === '') return <>{text}</>;
  const inner = trimmed(runs, lead.length, trail.length).map((r, i) => <Formatted key={i} run={r} />);
  return <>{lead}{runs[0]?.h ? <mark class="hl">{inner}</mark> : inner}{trail}</>;
}

function Formatted({ run }: { run: Run }): JSX.Element {
  const [lead, core, trail] = edges(run.t);
  if (core === '' || !(run.b || run.i || run.u)) return <>{run.t}</>;
  let node: ComponentChildren = core;
  if (run.u) node = <u>{node}</u>;
  if (run.i) node = <em>{node}</em>;
  if (run.b) node = <strong>{node}</strong>;
  return <>{lead}{node}{trail}</>;
}

function BlockView({ block: b, at }: { block: Block; at?: number }): JSX.Element {
  switch (b.k) {
    case 'h':
      return <h2 id={b.id} class={b.group ? 'nh nh-group' : 'nh'} data-b={at}>{b.runs ? <Runs runs={b.runs} /> : b.text}</h2>;
    case 'p':
      return <p class="np" data-b={at}><Runs runs={b.runs} /></p>;
    case 'list':
      // role="list": Safari drops list semantics from a list with list-style none.
      return (
        <ul class="notes-list" role="list" data-b={at}>
          {b.items.map((item, i) => (
            <li key={i} class="nli" data-depth={item.depth}>
              <Marker marker={item.marker} /><span class="nli-text"><Runs runs={item.runs} /></span>
            </li>
          ))}
        </ul>
      );
    case 'table':
      return <TableView table={b} at={at} />;
    case 'box':
      return (
        <aside class={`box box-${b.variant}`} data-b={at}>
          <p class="box-title">{b.title}</p>
          <Nested blocks={b.blocks} />
        </aside>
      );
    case 'img': {
      const size = IMAGE_SIZES[b.src];
      return (
        <img class="nimg" src={`${import.meta.env.BASE_URL}${b.src}`} alt={b.alt} loading="lazy" decoding="async"
          width={size?.[0]} height={size?.[1]} data-b={at} />
      );
    }
  }
}

/** A numbered item's "1." is part of what it says; a bullet or dash is only a mark, so screen readers skip it. */
function Marker({ marker }: { marker: string }): JSX.Element {
  const spoken = isNumberMarker(marker);
  return <span class={spoken ? 'nli-mark nli-num' : 'nli-mark'} aria-hidden={spoken ? undefined : 'true'}>{marker}</span>;
}

/** The plain text of a cell, on one line. */
const cellText = (cell: Block[]) => cell.map(blockText).join(' ').replace(/\s+/g, ' ').trim();

/** The header rows' cells, comma-joined ("Code, Hospital, Code, Hospital"); '' with no header row. */
function headerText(t: Table): string {
  return t.rows.filter((r) => r.header).flatMap((r) => r.cells.map(cellText)).filter((s) => s !== '').join(', ');
}

/**
 * Each table's region name, in document order: "Table: {header cells}", or "Table" with no header row. Tables that
 * would share a name say which they are, so a screen reader's list of regions tells them apart: s03's four
 * Glasgow Coma Scale tables are "Table 1 of 4: Response, Score, Description / technique" to "Table 4 of 4: …".
 */
export function tableNames(blocks: Block[]): Map<Table, string> {
  const tables: Table[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.k === 'table') {
        tables.push(b);
        for (const r of b.rows) for (const cell of r.cells) walk(cell);
      } else if (b.k === 'box') {
        walk(b.blocks);
      }
    }
  };
  walk(blocks);
  const heads = tables.map(headerText);
  const names = new Map<Table, string>();
  tables.forEach((t, i) => {
    const head = heads[i] ?? '';
    const of = heads.filter((h) => h === head).length;
    const nth = heads.slice(0, i + 1).filter((h) => h === head).length;
    const which = of > 1 ? ` ${nth} of ${of}` : '';
    names.set(t, head !== '' ? `Table${which}: ${head}` : `Table${which}`);
  });
  return names;
}

/** A table in a region that scrolls sideways on its own, so a wide one never pushes the page past the screen. It
 *  takes focus, so a keyboard can scroll it too. The header rows at the top form the thead. */
function TableView({ table, at }: { table: Table; at?: number }): JSX.Element {
  const split = table.rows.findIndex((r) => !r.header);
  const head = split < 0 ? table.rows : table.rows.slice(0, split);
  const rest = split < 0 ? [] : table.rows.slice(split);
  const name = useContext(TableNames).get(table) ?? tableNames([table]).get(table);
  return (
    <div class="table-scroll" tabindex={0} role="region" aria-label={name} data-b={at}>
      <table class="ntable">
        {head.length > 0 && <thead>{head.map((r, i) => <RowView key={i} row={r} />)}</thead>}
        {rest.length > 0 && <tbody>{rest.map((r, i) => <RowView key={i} row={r} />)}</tbody>}
      </table>
    </div>
  );
}

function RowView({ row }: { row: Row }): JSX.Element {
  return (
    <tr>
      {row.cells.map((cell, i) => (row.header
        ? <th key={i} scope="col"><Nested blocks={cell} /></th>
        : <td key={i}><Nested blocks={cell} /></td>))}
    </tr>
  );
}

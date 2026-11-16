// Loading: show nothing for the first 300 ms, then a skeleton at the final size (spec §7).
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** True once `active` has stayed true for `ms`; false again the moment it ends. */
export function useDelayedFlag(active: boolean, ms = 300): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!active) return;
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return active && late;
}

/** `rows` placeholder bars, each at least `rowHeight` tall (say '54px' or '3.375rem'). Given a list, row i takes
 *  the i-th height, and rows past its end take the last. */
export function Skeleton({ rows, rowHeight }: { rows: number; rowHeight: string | readonly string[] }): JSX.Element {
  const heightOf = (i: number) => (typeof rowHeight === 'string' ? rowHeight : rowHeight[Math.min(i, rowHeight.length - 1)]);
  return (
    <div class="skeleton" role="progressbar" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} class="sk-row" style={{ minHeight: heightOf(i) }} />)}
    </div>
  );
}

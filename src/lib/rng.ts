// Seeded randomness for the quiz engine. The engine only ever draws from an Rng it is handed, so a seed replays a
// session exactly in tests; randomSeed() is the one place real entropy enters.

/** A source of numbers in [0, 1). */
export type Rng = () => number;

/** mulberry32: a small, fast 32-bit generator. The same seed always gives the same sequence. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh unsigned 32-bit seed, from crypto when the browser has it. */
export function randomSeed(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0]!;
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

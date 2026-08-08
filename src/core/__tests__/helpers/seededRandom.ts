import { afterEach, beforeEach, vi } from 'vitest';

/** mulberry32 — small, fast, well-distributed, identical on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_SEED = 0x5eed;

/**
 * Give every test in the enclosing describe a deterministic Math.random.
 *
 * Call at describe scope, not inside a test.
 *
 * A family of tests asserts simulation outcomes after running real ticks, and
 * those ticks roll for building growth, upgrades, fires, births, deaths, job
 * relocation and vehicle speed jitter. The assertions passed or failed on the
 * draw — a few percent of the time, always in a full-suite run and never in
 * isolation, which is the worst possible signal: every genuine regression had
 * to be triaged against them first.
 *
 * A fixed constant would be worse than the disease: Math.random() === 0 makes
 * every probabilistic branch fire and 0.999 makes none of them, so the test
 * would only ever exercise one artificial extreme. A seeded PRNG keeps a real
 * distribution while being identical on every run.
 *
 * Seeding removes interference; it does not license an assertion that only
 * holds for one seed. Where the outcome genuinely varies, assert the invariant
 * — a ratio, a bound — rather than the draw.
 */
export function useSeededRandom(seed = DEFAULT_SEED): void {
  beforeEach(() => { reseedRandom(seed); });
  afterEach(() => { vi.restoreAllMocks(); });
}

/**
 * Restart the sequence mid-test.
 *
 * For A/B fixtures that run the same city twice and compare: without this the
 * second run continues the stream the first left off at, so the two cities
 * diverge and the comparison measures that divergence rather than the change
 * under test.
 */
export function reseedRandom(seed = DEFAULT_SEED): void {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed));
}

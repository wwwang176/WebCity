import { SIMULATION } from './SimulationConstants';

/**
 * How many slices the per-citizen recomputations are split into. Shared by happiness and
 * health.
 *
 * Recomputing **every** citizen in slow slot 4 means one O(population) pass every 6 ticks.
 * Measured on the same save scaled to 70,891 citizens: **68.5ms** for happiness and 11.5ms
 * for health, against 250ms available per tick at speed 1 — which the player experiences as
 * a stutter every 1.5 seconds (BUG-330).
 *
 * Recomputing one slice per tick instead completes a cycle in `N` ticks. Each citizen stores
 * their own happiness and health, and those not due keep their previous value, so the
 * city-wide average remains the sum over all citizens divided by their count, unaffected by
 * which slice was just recomputed. This is **round-robin, not sampling**: nobody is skipped,
 * they just come up less often.
 *
 * Happiness and health share one hash, so a citizen's two values update on the same tick and
 * their address lookup (`homeFactsFor`) runs once for both.
 *
 * ### Why N grows with population
 *
 * A fixed N (6 slices, say) only flattens the peak without changing the total work: at
 * 300,000 citizens each tick still costs 12.5ms. Letting N grow with population makes the
 * per-tick work constant.
 *
 * The cost is staleness, and it is affordable: a citizen's happiness trends at **0.38 per
 * 100 seconds** measured, while the existing random jitter has a standard deviation of
 * **2.36** — over a whole game day the real drift stays below the noise.
 *
 * ### The cap is not about freshness, it is about not degrading absurdly
 *
 * Uncapped, a million citizens would take 476 ticks (20 game days) per cycle. The cap holds
 * a cycle to 3 game days, so cost only starts growing again beyond 150,000 citizens — and it
 * grows slowly (13.9ms/tick at a million), far better than a fixed one-day lag, which at the
 * same population costs 41.7ms/tick and consumes the entire budget at speed 10.
 */

/** Citizens recomputed per tick. This sets the cost: this number times about 1µs is the
 *  per-tick spend. */
export const CITIZEN_SLICE_PER_TICK = 2100;

/**
 * The longest a cycle may take, in ticks.
 *
 * Three game days (`ticksPerDay` is 24). Only reachable above 150,000 citizens; below that
 * the cap has no effect.
 */
export const CITIZEN_SLICE_MAX = 72;

/**
 * How many slices this city is split into.
 *
 * The floor is `SLOW_TICK_INTERVAL`, the cadence these two things ran at unsliced. A small
 * city computing fewer than that takes the floor instead, so **behaviour is identical to the
 * unsliced version** and each citizen still updates every 6 ticks.
 */
export function citizenSliceCount(population: number): number {
  return sliceCount(population, SIMULATION.SLOW_TICK_INTERVAL);
}

/**
 * How many slices the commute statistics are split into.
 *
 * The same shape as happiness with the floor changed to `MEDIUM_TICK_INTERVAL`, the cadence
 * the commute statistics ran at unsliced (a full-city recompute every 60 ticks). Since
 * `2100 * 60 = 126,000`, anything below 126,000 citizens comes out as 60: **each citizen
 * updates exactly as often as before**, with no loss of freshness.
 *
 * The floor is used instead of a hardcoded 60 because of the cliff above: at a fixed 60 the
 * per-tick work is population / 60, **still linear**, only deferred.
 */
export function commuteSliceCount(population: number): number {
  return sliceCount(population, SIMULATION.MEDIUM_TICK_INTERVAL);
}

function sliceCount(population: number, min: number): number {
  if (!(population > 0)) return min;
  const wanted = Math.ceil(population / CITIZEN_SLICE_PER_TICK);
  // An infinite population makes `wanted` infinite, which `Math.min` absorbs. NaN cannot
  // reach here: `population > 0` is false for NaN.
  return Math.min(CITIZEN_SLICE_MAX, Math.max(min, wanted));
}

/**
 * Which slice this citizen belongs to.
 *
 * Keyed on a hash of the id rather than their position in the list: list order follows the
 * order the city was built, and citizens created at the same time tend to live in the same
 * area. Splitting by position would make each slice a city block, so any reaction would
 * sweep the city block by block instead of starting evenly everywhere. Hashed, every slice
 * is a cross-section of the city.
 *
 * ### A known correlation
 *
 * The multiplier is odd, so `imul(id, M) mod 2 === id mod 2` — **the slice index has the
 * same parity as the id**. With an even slice count (the floor of 6 is even), properties
 * correlated with id parity all land in the same half of the slices. In a real city ids are
 * only sequence numbers and correlate with neither address nor age, so the effect is
 * invisible; but a test that assigns addresses by `i % 2` will never have its two groups
 * processed on the same tick.
 */
export function citizenSliceOf(citizenId: number, slices: number): number {
  // Knuth multiplicative hash. `>>> 0` converts imul's signed result back to unsigned;
  // otherwise the modulo of a negative number is negative.
  return ((Math.imul(citizenId, 2654435761) >>> 0) % slices);
}


/**
 * The cursor for one cycle.
 *
 * The slice count is fixed **at the start of a cycle**. Recomputing it each tick from the
 * current population would let `citizenSliceOf` reassign everyone whenever the population
 * crosses a multiple of `CITIZEN_SLICE_PER_TICK`: citizens already processed could be moved
 * behind the cursor, and citizens not yet processed could be moved into a slice already
 * passed. With the population oscillating around a threshold there is no bound on the lag at
 * all, and a citizen can be constructed who goes hundreds of ticks without an update.
 *
 * With the cursor, "exactly once per citizen per cycle" is a real invariant for anyone
 * present for the whole cycle.
 */
export class SliceCycle {
  private slices = 0;
  private cursor = 0;

  /**
   * Starts the next slice. Returns which slice this tick handles and how many slices this
   * cycle has.
   *
   * `countFor` is called only once a cycle completes; changing the count mid-cycle is the
   * bug described above.
   */
  next(countFor: () => number): { slices: number; index: number } {
    if (this.cursor >= this.slices) {
      // 0 would make `citizenSliceOf`'s modulo return NaN, skipping everyone and never
      // ending a cycle; a negative value would restart the cycle on every call, repeatedly
      // landing some citizens in slice 0 and never reaching the rest; Infinity would make
      // `cursor >= slices` never true, so a cycle would also never end.
      const want = Math.floor(countFor());
      this.slices = Number.isFinite(want) && want >= 1 ? want : 1;
      this.cursor = 0;
    }
    return { slices: this.slices, index: this.cursor++ };
  }

  /** Discards the current cycle, for when the city empties. The next cycle starts from the
   *  new population. */
  reset(): void {
    this.slices = 0;
    this.cursor = 0;
  }
}

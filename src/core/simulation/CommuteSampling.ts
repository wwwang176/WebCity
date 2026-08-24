/**
 * How many citizens a tick actually asks "how are you getting to work today".
 *
 * Asking `working-age employed citizens / 8` makes the count **proportional to
 * population**. Measured on the same save scaled to 100,000 citizens: 13,149 asked per tick
 * at 191ms, against 250ms available per tick at speed 1 — the entire budget, and the game
 * stops running (BUG-328).
 *
 * The vehicles on the road barely move with it (1,278 to 1,598): the garages are what they
 * are, and more citizens do not produce more vehicles. At 12,501 citizens one vehicle
 * spawns per 320 evaluations; at 92,578 it takes 3,300.
 *
 * That loop is **also** estimating how many citizens ride transit today, and an estimate's
 * accuracy depends on the sample size, not on the population it is drawn from: a
 * thousand-person poll has the same margin in a country of 20 million as in one of 300
 * million. So the number asked has no reason to grow linearly with population.
 *
 * Three regimes:
 *
 * | city | asked | why |
 * |---|---|---|
 * | intended <= `SPAN` | all of them | small cities behave **exactly as before** |
 * | medium | `sqrt(intended * SPAN)` | the scale-up factor grows as a square root, keeping small routes' numbers fine-grained |
 * | large | `CEILING` | a square root still grows without bound, and the cost needs a ceiling |
 *
 * The square root alone would ask 4,415 citizens at a million (about 66ms/tick) — better
 * than linear, but still unbounded. A hardcoded ceiling alone would put the scale-up factor
 * at 33 by 100,000 citizens, making a small route's daily ridership a multiple of 33. The
 * two together cover both ends.
 */

/**
 * The other end of the geometric mean.
 *
 * An intended count equal to this value is not reduced, and neither is anything below it, so
 * it is simultaneously the throttling threshold and the throttling strength. At 150 the
 * 12,501-citizen reference city drops from 1,077 asked to 402, with the ridership figures on
 * the panel measured to move by 0.6% after cross-day smoothing.
 */
export const COMMUTE_SAMPLE_SPAN = 150;

/**
 * The largest city asks no more than this.
 *
 * The square root is still unbounded: a million citizens would ask 4,415, about 66ms/tick.
 * Capped here, the cost settles at roughly 15ms however large the city grows.
 *
 * The cost is that very large cities keep increasing the scale-up factor, coarsening small
 * routes' numbers. That is a resolution question rather than an accuracy one — the panel
 * shows the cross-day smoothed value, which grinds it away.
 */
export const COMMUTE_SAMPLE_CEILING = 1000;

/**
 * How many citizens to ask when the intended number is `attempts`.
 *
 * The result is always <= `attempts`: callers use `attempts / result` as the scale-up
 * factor, and anything above 1 would count each citizen as less than one person.
 */
export function commuteSampleSize(attempts: number): number {
  if (!(attempts > 0)) return 0;
  // Small cities need no separate branch: for `attempts <= SPAN`,
  // `sqrt(attempts * SPAN) >= attempts` always holds and the `Math.min` below returns
  // attempts. An early return here could be broken without any test turning red, because it
  // cannot change any behaviour.
  const sqrtGrowth = Math.ceil(Math.sqrt(attempts * COMMUTE_SAMPLE_SPAN));
  return Math.min(attempts, sqrtGrowth, COMMUTE_SAMPLE_CEILING);
}

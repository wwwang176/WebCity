/**
 * How badly served a cell is: distance and load combined into one number.
 *
 * ## Why combine them
 *
 * The dots and the overlay drew distance alone — the road-following cost from the nearest
 * facility over the budget. That answers whether anyone can reach the cell, not how well it is
 * served. Next to a hospital at 200% the distance ratio is 0 and the dot is the greenest there
 * is, while that hospital's effect on the death rate has fallen to nothing (BUG-362).
 *
 * ## The worse of the two, not the average
 *
 * An average makes two mildly bad figures look worse than one very bad one, while what the
 * player has to act on is the worst: a facility too far away calls for a nearer one and a
 * facility too full calls for another to share the load. Different actions, both decided by the
 * worst term.
 *
 * ## How load maps onto 0-1
 *
 * Exactly full (1.0) is 0 and twice capacity (2.0) is 1. That line is not arbitrary: it is how
 * the game already measures how bad overload is. `loadRatioToDeathMultiplier()` gives the death
 * rate x0.3 at load 1.0 (the facility at full effect) and x1.0 at 2.0 and above (**the same as
 * having no facility**), linear in between.
 */

/** The two endpoints mapping load onto severity. */
export const LOAD_SEVERITY = {
  /** Everything up to here counts as fine. */
  FULL: 1.0,
  /** At this point the service is worth nothing at all. */
  USELESS: 2.0,
} as const;

/** No coverage. Distinct from poor coverage: the first calls for a new facility, the second for
 *  a nearer one. */
export const NO_COVERAGE = -1;

/**
 * Load ratio to a 0-1 severity.
 *
 * A negative ratio means not applicable — uncovered, or a service with no notion of load — and
 * returns 0 rather than -1: this value is compared against distance, and a -1 mixed in would
 * always lose.
 */
export function loadSeverity(loadRatio: number): number {
  if (!(loadRatio > LOAD_SEVERITY.FULL)) return 0;
  if (loadRatio >= LOAD_SEVERITY.USELESS) return 1;
  return (loadRatio - LOAD_SEVERITY.FULL) / (LOAD_SEVERITY.USELESS - LOAD_SEVERITY.FULL);
}

/**
 * How badly served this cell is. 0 is best, 1 is worst, `-1` is uncovered.
 *
 * `costRatio` is `getCostRatio()`'s return value, where -1 means uncovered. `loadRatio` is the
 * load over capacity of the facility serving this cell, where -1 means unavailable.
 */
export function serviceSeverity(costRatio: number, loadRatio: number): number {
  if (costRatio < 0) return NO_COVERAGE;
  return Math.max(Math.min(1, costRatio), loadSeverity(loadRatio));
}

/** Return a random integer in [0, max). */
export function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

/** Return a random element from a non-empty array. */
export function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Pick a weighted random element from a pool.
 * @param pool — non-empty array of entries
 * @param totalWeight — pre-computed sum of all weights
 * @param getWeight — accessor for the weight of each entry
 */
export function pickWeighted<T>(pool: readonly T[], totalWeight: number, getWeight: (entry: T) => number): T {
  let r = Math.random() * totalWeight;
  for (const entry of pool) {
    r -= getWeight(entry);
    if (r <= 0) return entry;
  }
  return pool[pool.length - 1]!;
}

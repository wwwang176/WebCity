/**
 * A cheap, deterministic, sufficiently random-looking 32-bit hash.
 *
 * Every procedurally generated name rests on it: citizens, buildings. It is shared because of
 * the property that the city seed has to be multiplied in rather than added; written twice,
 * the second copy makes that mistake again.
 */

/**
 * splitmix32's finalizer. Spreads a change in the low bits across all of them.
 *
 * Without it, consecutive inputs stay consecutive through the modulo, and the inputs here —
 * citizen sequence numbers, cell coordinates — are consecutive by nature.
 */
export function mix32(h: number): number {
  let x = h >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * Folds "which thing", "for what purpose" and "which city" into one hash.
 *
 * `citySeed` is multiplied by an odd prime first. Added directly, two cities whose seeds
 * differ by 1 produce nearly identical results: `key` is consecutive too, the two differences
 * cancel, and the whole name list replays shifted by one.
 *
 * Bitwise operations apply ToInt32 themselves, so negative, fractional and over-32-bit inputs
 * are all normalised here.
 */
export function hash32(key: number, salt: number, citySeed = 0): number {
  return mix32((Math.imul(citySeed, 0x27220a95) ^ key ^ salt) >>> 0);
}

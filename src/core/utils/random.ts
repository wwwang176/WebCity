/** Return a random integer in [0, max). */
export function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

/** Return a random element from a non-empty array. */
export function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

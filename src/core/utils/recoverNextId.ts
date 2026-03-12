/**
 * Recover the next sequential ID from serialized entities.
 * Parses numeric suffix from IDs with the given prefix and returns max + 1.
 * Returns 1 if the array is empty.
 */
export function recoverNextId(entities: readonly { id: string }[], prefix: string): number {
  let maxId = 0;
  for (const e of entities) {
    const num = parseInt(e.id.replace(prefix, ''), 10);
    if (num > maxId) maxId = num;
  }
  return maxId + 1;
}

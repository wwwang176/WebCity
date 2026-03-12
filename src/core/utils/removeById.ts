/**
 * Remove the first element with a matching `id` from an array (mutating).
 * Returns true if an element was removed, false otherwise.
 */
export function removeById<T extends { id: string }>(arr: T[], id: string): boolean {
  const idx = arr.findIndex(item => item.id === id);
  if (idx !== -1) {
    arr.splice(idx, 1);
    return true;
  }
  return false;
}

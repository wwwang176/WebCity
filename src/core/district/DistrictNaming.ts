/**
 * District names.
 *
 * A default of `District ${count + 1}` collides after a merge, which lowers the count: the next
 * new district can take a name that already exists. Two districts with one name are
 * indistinguishable in the sidebar, and policies are set on each of them separately.
 */

/** The sidebar is 156px wide, and a longer name there is just a run of ellipses. */
export const DISTRICT_NAME_MAX = 24;

const DEFAULT_NAME = /^District (\d+)$/;

/**
 * The next unused default name.
 *
 * Fills gaps rather than counting on: after merging District 2 away, the player expects that
 * number back rather than a jump to 4. A district the player renamed to `District 5` counts as
 * taken too; a collision is a collision whoever caused it.
 */
export function nextDistrictName(existing: readonly string[]): string {
  const taken = new Set<number>();
  for (const name of existing) {
    const m = DEFAULT_NAME.exec(name.trim());
    if (m) taken.add(Number(m[1]));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return `District ${n}`;
}

/**
 * A name the player typed.
 *
 * Blank falls back to the existing name, since an empty name is a blank button in the sidebar
 * with nothing to press. Newlines become spaces so pasting multi-line text does not stretch the
 * button.
 */
export function sanitiseDistrictName(raw: string, fallback: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  return flat.slice(0, DISTRICT_NAME_MAX);
}

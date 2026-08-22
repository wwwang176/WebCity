/**
 * Splitting a city-wide load across the facilities that produce it.
 *
 * BUG-138 filtered the capacity getters so a stopped facility stops advertising
 * places it cannot provide. It did not filter the LOADS that divide into them,
 * and three panels were left dividing a full-population numerator by a
 * subset denominator:
 *
 *   tpLoad = sewageProduced * tp.capacity / sewageTotalCapacity
 *
 * With two 2250 plants, one blacked out, and 3000 units produced, both rows
 * read 3000 — 6000 units displayed for 3000 units of sewage, and the dead
 * plant's phantom overload indistinguishable from the live one's real one.
 * With every plant offline the denominator is 0, the `> 0` guard zeroes every
 * share, and each row reads "0 / 2250 · Normal" in green at the exact moment
 * the city treats nothing.
 *
 * The fix is to make the split conserve: load only ever goes to a facility that
 * can carry it, and whatever no facility can carry is reported as such rather
 * than silently dropped.
 */

export interface FacilityShare<T> {
  facility: T;
  capacity: number;
  /** This facility's portion of the total. Zero for anything not working. */
  load: number;
  /** load / capacity, or 0 when there is no capacity — never NaN. */
  ratio: number;
  active: boolean;
}

export interface LoadSplit<T> {
  shares: FacilityShare<T>[];
  /** Load no working facility is carrying. Above zero means real trouble. */
  unassigned: number;
  activeCapacity: number;
  totalCapacity: number;
  /** Capacity the city paid for and cannot currently use. */
  strandedCapacity: number;
}

export function shareFacilityLoad<T>(
  totalLoad: number,
  facilities: readonly T[],
  capacityOf: (f: T) => number,
  isActive: (f: T) => boolean,
): LoadSplit<T> {
  let activeCapacity = 0;
  let totalCapacity = 0;
  const active: boolean[] = [];
  const caps: number[] = [];

  for (let i = 0; i < facilities.length; i++) {
    const cap = capacityOf(facilities[i]!);
    const live = isActive(facilities[i]!);
    caps.push(cap);
    active.push(live);
    totalCapacity += cap;
    if (live) activeCapacity += cap;
  }

  const shares: FacilityShare<T>[] = [];
  let assigned = 0;
  let lastLiveIdx = -1;

  for (let i = 0; i < facilities.length; i++) {
    const cap = caps[i]!;
    const live = active[i]!;
    // A live plant with no capacity carries nothing; dividing by activeCapacity
    // when that is 0 would put NaN in every row.
    const load = live && activeCapacity > 0 ? Math.round(totalLoad * cap / activeCapacity) : 0;
    if (live && cap > 0) lastLiveIdx = i;
    assigned += load;
    shares.push({
      facility: facilities[i]!, capacity: cap, load,
      ratio: cap > 0 ? load / cap : 0,
      active: live,
    });
  }

  // Rounding each share independently loses or gains a unit or two. Settle the
  // difference on one live facility so the parts always add up to the whole —
  // a panel that displays more sewage than the city produces is the defect
  // this module exists to prevent.
  if (lastLiveIdx >= 0 && assigned !== totalLoad) {
    const s = shares[lastLiveIdx]!;
    s.load += totalLoad - assigned;
    s.ratio = s.capacity > 0 ? s.load / s.capacity : 0;
    assigned = totalLoad;
  }

  return {
    shares,
    unassigned: totalLoad - assigned,
    activeCapacity,
    totalCapacity,
    strandedCapacity: totalCapacity - activeCapacity,
  };
}

/**
 * Whether a load exceeds the capacity behind it.
 *
 * The panels wrote `capacity > 0 && load > capacity`. That guard was safe only
 * while capacity could reach 0 solely by there being no facilities at all — in
 * which case a "No station" row was emitted instead. Once BUG-138 filtered out
 * non-operational ones, a city-wide blackout drove capacity to 0 and switched
 * the warning off, in the one case where it matters most.
 */
export function hasShortage(load: number, capacity: number): boolean {
  return load > capacity;
}

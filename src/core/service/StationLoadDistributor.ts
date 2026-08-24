/**
 * StationLoadDistributor — spreads city-wide demand across facilities.
 *
 * ## One answer to who serves a cell
 *
 * Picking the nearest facility by **straight-line distance** disagrees with coverage — the dots,
 * the overlay and `getCostRatio` — which uses the **road-following cost**. A facility across a
 * river, close in a straight line but a long drive away, draws that area's demand while its road
 * coverage never reaches it. That facility reads overloaded while serving nobody, and the one
 * actually serving the area reads empty (BUG-363).
 *
 * So this asks coverage instead: `ownerOf(x, y)` returns the facility the coverage flood found
 * to cover that cell most cheaply. One question, one answer.
 *
 * Still zero-allocation: the caller's Map is cleared and refilled.
 */

export interface LoadDemand {
  x: number;
  y: number;
  weight: number;
}

export interface LoadableFacility {
  id: string;
  x: number;
  y: number;
  capacity: number;
}

export interface LoadDistributionResult {
  /** Total demand / total capacity. Infinity when capacity=0 but demand>0. */
  loadRatio: number;
  /**
   * Demand that landed on no facility.
   *
   * Happens when a demand point loses coverage after the last recompute, through a facility
   * being demolished or cut off. It still counts towards `loadRatio`'s numerator: the demand is
   * real, merely unserved. Zeroing it would make a city look healthier at the moment it
   * collapses.
   */
  unassigned: number;
}

/**
 * Attributes each demand to **the facility serving that cell**.
 *
 * @param facilities The facilities that count this round; the caller filters for operational and
 *   road-connected itself.
 * @param demands Weighted demand points.
 * @param loadMap A reused Map<facilityId, accumulated weight>, cleared and refilled.
 * @param ownerOf Which facility serves that cell. `null`, or an id not in `facilities`, puts the
 *   demand into `unassigned`.
 */
export function distributeLoadToServingFacility(
  facilities: readonly LoadableFacility[],
  demands: readonly LoadDemand[],
  loadMap: Map<string, number>,
  ownerOf: (x: number, y: number) => string | null,
): LoadDistributionResult {
  loadMap.clear();

  if (facilities.length === 0) {
    // Demand is still summed: with no facilities at all, loadRatio should be Infinity, not 0.
    let total = 0;
    for (let i = 0; i < demands.length; i++) total += demands[i]!.weight;
    return { loadRatio: total > 0 ? Infinity : 0, unassigned: total };
  }

  const known = new Set<string>();
  for (let i = 0; i < facilities.length; i++) {
    loadMap.set(facilities[i]!.id, 0);
    known.add(facilities[i]!.id);
  }

  let total = 0;
  let unassigned = 0;
  for (let di = 0; di < demands.length; di++) {
    const d = demands[di]!;
    total += d.weight;
    const id = ownerOf(d.x, d.y);
    // A facility demolished or cut off since coverage was computed: the index survives, but it
    // must not take demand any more.
    if (id !== null && known.has(id)) {
      loadMap.set(id, loadMap.get(id)! + d.weight);
    } else {
      unassigned += d.weight;
    }
  }

  let cap = 0;
  for (let i = 0; i < facilities.length; i++) cap += facilities[i]!.capacity;
  const loadRatio = cap > 0 ? total / cap : (total > 0 ? Infinity : 0);
  return { loadRatio, unassigned };
}

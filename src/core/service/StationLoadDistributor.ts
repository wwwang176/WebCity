/**
 * StationLoadDistributor — nearest-neighbor demand allocation for service facilities.
 *
 * Extracted from PoliceService / FireService where identical ~23-line methods
 * were copy-pasted (DRY violation). Pure function with zero GC — reuses the
 * caller's Map for load storage.
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
}

/**
 * Distribute weighted demands to nearest facility (Euclidean distance).
 * Mutates `loadMap` in place (cleared then filled) — zero allocation.
 *
 * @param facilities - all facilities (stations/hospitals) with positions and capacity
 * @param demands - weighted demand points (citizen positions with weight)
 * @param loadMap - reusable Map<facilityId, accumulatedWeight> — cleared and populated
 * @returns loadRatio (total demand / total capacity)
 */
export function distributeLoadToNearest(
  facilities: readonly LoadableFacility[],
  demands: readonly LoadDemand[],
  loadMap: Map<string, number>,
): LoadDistributionResult {
  loadMap.clear();

  if (facilities.length === 0) {
    return { loadRatio: 0 };
  }

  for (let i = 0; i < facilities.length; i++) {
    loadMap.set(facilities[i]!.id, 0);
  }

  let total = 0;
  for (let di = 0; di < demands.length; di++) {
    const d = demands[di]!;
    total += d.weight;
    let nearestId = '';
    let nearestDist = Infinity;
    for (let fi = 0; fi < facilities.length; fi++) {
      const f = facilities[fi]!;
      const dx = d.x - f.x;
      const dy = d.y - f.y;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = f.id;
      }
    }
    if (nearestId) {
      loadMap.set(nearestId, (loadMap.get(nearestId) ?? 0) + d.weight);
    }
  }

  const cap = facilities.reduce((s, f) => s + f.capacity, 0);
  const loadRatio = cap > 0 ? total / cap : (total > 0 ? Infinity : 0);
  return { loadRatio };
}

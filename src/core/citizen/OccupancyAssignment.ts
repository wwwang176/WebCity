import type { Citizen } from './types';
import { type HousingCandidate, canAfford, scoreHousing } from './HousingScore';
import { type WorkplaceCandidate, scoreWorkplace } from './WorkplaceScore';

export interface BuildingSlot {
  pos: string;
  capacity: number;
}

const MAX_CANDIDATES = 30;

/**
 * Count how many citizens are currently assigned to each building position.
 * Generic over the assignment field (homeId or workplaceId) via accessor.
 * Extracted from SimulationLoop for SRP — occupancy counting is independent of simulation.
 */
export function countOccupancy(
  citizens: readonly Citizen[],
  getAssignment: (c: Citizen) => string | null,
): Map<string, number> {
  const occupancy = new Map<string, number>();
  for (const c of citizens) {
    const pos = getAssignment(c);
    if (pos !== null) {
      occupancy.set(pos, (occupancy.get(pos) ?? 0) + 1);
    }
  }
  return occupancy;
}

/**
 * Assign unassigned citizens to buildings that have remaining capacity.
 * Generic over the assignment field via getter/setter callbacks.
 * Mutates citizens and the occupancy map in-place.
 * Extracted from SimulationLoop for SRP — assignment logic is independent of simulation.
 */
export function assignToBuildings(
  citizens: readonly Citizen[],
  buildings: readonly BuildingSlot[],
  occupancy: Map<string, number>,
  getAssignment: (c: Citizen) => string | null,
  setAssignment: (c: Citizen, pos: string) => void,
): void {
  for (const citizen of citizens) {
    if (getAssignment(citizen) !== null) continue;
    for (const b of buildings) {
      const occ = occupancy.get(b.pos) ?? 0;
      if (occ < b.capacity) {
        setAssignment(citizen, b.pos);
        occupancy.set(b.pos, occ + 1);
        break;
      }
    }
  }
}

/** Fisher-Yates shuffle (in-place) */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/**
 * Score-based housing assignment: each citizen picks from top-3 scored candidates.
 * Mutates citizens (homeId) and occupancy map in-place.
 */
export function assignWithPreference(
  citizens: readonly Citizen[],
  candidates: readonly HousingCandidate[],
  occupancy: Map<string, number>,
): void {
  for (const citizen of citizens) {
    if (citizen.homeId !== null) continue;

    // Step 1: Filter — has capacity + can afford
    let available = candidates.filter(c => {
      const occ = occupancy.get(c.pos) ?? 0;
      return occ < c.capacity && canAfford(citizen.incomeLevel, c.level);
    });

    // Step 1.5: Fallback — if no affordable candidates, relax constraint
    if (available.length === 0) {
      available = candidates.filter(c => {
        const occ = occupancy.get(c.pos) ?? 0;
        return occ < c.capacity;
      });
    }
    if (available.length === 0) continue;

    // Performance: sample if too many candidates
    let pool = [...available];
    if (pool.length > MAX_CANDIDATES) {
      shuffle(pool);
      pool = pool.slice(0, MAX_CANDIDATES);
    }

    // Step 2: Score
    const scored = pool.map(c => ({
      candidate: c,
      score: scoreHousing(citizen, c),
    }));

    // Step 3: Pick from top-3 randomly
    scored.sort((a, b) => b.score - a.score);
    const topN = scored.slice(0, Math.min(3, scored.length));
    const pick = topN[Math.floor(Math.random() * topN.length)]!;

    // Step 4: Assign
    citizen.homeId = pick.candidate.pos;
    citizen.homelessSince = null;
    occupancy.set(pick.candidate.pos, (occupancy.get(pick.candidate.pos) ?? 0) + 1);
  }
}

/**
 * Score-based workplace assignment: each citizen picks from top-3 scored workplaces.
 * Mutates citizens (workplaceId) and occupancy map in-place.
 * @param reachable Optional road-reachability map: homeId → Set of reachable workplace positions.
 *   When provided, citizens with a homeId in the map can only be assigned to reachable workplaces.
 *   Citizens without homeId or whose homeId is not in the map are unfiltered.
 */
export function assignWorkWithPreference(
  citizens: readonly Citizen[],
  candidates: readonly WorkplaceCandidate[],
  occupancy: Map<string, number>,
  reachable?: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (const citizen of citizens) {
    if (citizen.workplaceId !== null) continue;
    // Skip citizens without a home — need homeId for reachability check.
    // They'll get a home this tick and a workplace next tick.
    if (citizen.homeId === null) continue;

    // Filter — has capacity + reachable from home
    const reachableSet = reachable?.get(citizen.homeId);
    let available = candidates.filter(c => {
      const occ = occupancy.get(c.pos) ?? 0;
      if (occ >= c.capacity) return false;
      if (reachableSet && !reachableSet.has(c.pos)) return false;
      return true;
    });
    if (available.length === 0) continue;

    // Performance: sample if too many candidates
    let pool = [...available];
    if (pool.length > MAX_CANDIDATES) {
      shuffle(pool);
      pool = pool.slice(0, MAX_CANDIDATES);
    }

    // Score
    const scored = pool.map(c => ({
      candidate: c,
      score: scoreWorkplace(citizen, c.pos, c.zoneType),
    }));

    // Pick from top-3 randomly
    scored.sort((a, b) => b.score - a.score);
    const topN = scored.slice(0, Math.min(3, scored.length));
    const pick = topN[Math.floor(Math.random() * topN.length)]!;

    // Assign
    citizen.workplaceId = pick.candidate.pos;
    citizen.unemployedSince = null;
    occupancy.set(pick.candidate.pos, (occupancy.get(pick.candidate.pos) ?? 0) + 1);
  }
}

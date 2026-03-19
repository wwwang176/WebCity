import type { Citizen } from './types';
import { type HousingCandidate, scoreHousing } from './HousingScore';
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

// Reusable buffers for candidate selection (avoids per-citizen allocations)
interface ScoredCandidate<T> { candidate: T; score: number; }
const _scoredBuf: ScoredCandidate<unknown>[] = [];

/** Pick a candidate from top-3 scored entries using a pre-allocated buffer. */
function pickTop3<T>(buf: ScoredCandidate<T>[], count: number): T {
  // Partial sort: find top-3 by selection
  const top = Math.min(3, count);
  for (let i = 0; i < top; i++) {
    let bestIdx = i;
    for (let j = i + 1; j < count; j++) {
      if (buf[j]!.score > buf[bestIdx]!.score) bestIdx = j;
    }
    if (bestIdx !== i) {
      const tmp = buf[i]!;
      buf[i] = buf[bestIdx]!;
      buf[bestIdx] = tmp;
    }
  }
  return buf[Math.floor(Math.random() * top)]!.candidate;
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
  // Build available pool once — reusable across citizens
  const pool: HousingCandidate[] = [];

  for (const citizen of citizens) {
    if (citizen.homeId !== null) continue;

    // Collect available candidates inline
    pool.length = 0;
    for (const c of candidates) {
      const occ = occupancy.get(c.pos) ?? 0;
      if (occ < c.capacity) pool.push(c);
    }
    if (pool.length === 0) continue;

    // Sample if too many
    if (pool.length > MAX_CANDIDATES) {
      shuffle(pool);
      pool.length = MAX_CANDIDATES;
    }

    // Score into reusable buffer
    let count = 0;
    for (const c of pool) {
      if (count >= _scoredBuf.length) _scoredBuf.push({ candidate: c, score: 0 });
      else { _scoredBuf[count]!.candidate = c; }
      _scoredBuf[count]!.score = scoreHousing(citizen, c);
      count++;
    }

    const pick = pickTop3(_scoredBuf as ScoredCandidate<HousingCandidate>[], count);

    citizen.homeId = pick.pos;
    citizen.homelessSince = null;
    occupancy.set(pick.pos, (occupancy.get(pick.pos) ?? 0) + 1);
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
  const pool: WorkplaceCandidate[] = [];

  for (const citizen of citizens) {
    if (citizen.workplaceId !== null) continue;
    if (citizen.homeId === null) continue;

    // Filter — has capacity + reachable from home
    const reachableSet = reachable?.get(citizen.homeId);
    pool.length = 0;
    for (const c of candidates) {
      const occ = occupancy.get(c.pos) ?? 0;
      if (occ >= c.capacity) continue;
      if (reachableSet && !reachableSet.has(c.pos)) continue;
      pool.push(c);
    }
    if (pool.length === 0) continue;

    // Sample if too many
    if (pool.length > MAX_CANDIDATES) {
      shuffle(pool);
      pool.length = MAX_CANDIDATES;
    }

    // Score into reusable buffer
    let count = 0;
    for (const c of pool) {
      if (count >= _scoredBuf.length) _scoredBuf.push({ candidate: c, score: 0 });
      else { _scoredBuf[count]!.candidate = c; }
      _scoredBuf[count]!.score = scoreWorkplace(citizen, c.pos, c.zoneType);
      count++;
    }

    const pick = pickTop3(_scoredBuf as ScoredCandidate<WorkplaceCandidate>[], count);

    citizen.workplaceId = pick.pos;
    citizen.unemployedSince = null;
    occupancy.set(pick.pos, (occupancy.get(pick.pos) ?? 0) + 1);
  }
}

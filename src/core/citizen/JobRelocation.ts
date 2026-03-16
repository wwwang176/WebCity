import type { Citizen } from './types';
import { isWorkingAge } from './types';
import { scoreWorkplaceWithCost } from './WorkplaceScore';
import type { ZoneType } from '../grid/types';
import { parsePosKeyUnsafe, manhattanDistance } from '../grid/GridHelpers';
import type { ReadableGrid } from '../grid/GridHelpers';
import { roadDistanceToTargets } from '../service/RoadCoverageFlood';
import type { CachedRoute } from '../traffic/CommuteCache';

export interface WorkplaceCandidateWithZone {
  pos: string;
  capacity: number;
  zoneType: ZoneType;
}

export interface JobRelocationConfig {
  commuteLengthThreshold: number;
  manhattanFallback: number;
  happinessThreshold: number;
  scoreGap: number;
  maxRelocateRatio: number;
  tickInterval: number;
  dijkstraMaxBudget: number;
}

export const DEFAULT_JOB_RELOCATION_CONFIG: JobRelocationConfig = {
  commuteLengthThreshold: 500,
  manhattanFallback: 15,
  happinessThreshold: 35,
  scoreGap: 15,
  maxRelocateRatio: 0.05,
  tickInterval: 120,
  dijkstraMaxBudget: 60,
};

/** Extract actual commute path length from a CachedRoute. */
export function getCommuteLength(route: CachedRoute): number | null {
  if (route.status === 'failed') return null;
  if (route.status !== 'ready' || !route.morningPath) return null;
  return route.morningPath.reduce((sum, e) => sum + e.length, 0);
}

/** Determine if citizen should be considered and whether their route is confirmed failed. */
function getTriggerReason(
  citizen: Citizen,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  config: JobRelocationConfig,
): 'none' | 'failed' | 'long_commute' | 'unhappy' | 'manhattan_fallback' {
  const route = cache.get(citizen.id);

  if (route) {
    if (route.status === 'failed') return 'failed';
    // Stale route — road network changed, can't trust old path data
    if (route.generation !== cache.roadGeneration) return 'failed';
    const len = getCommuteLength(route);
    if (len !== null && len > config.commuteLengthThreshold) return 'long_commute';
  } else {
    const home = parsePosKeyUnsafe(citizen.homeId!);
    const work = parsePosKeyUnsafe(citizen.workplaceId!);
    if (manhattanDistance(home.x, home.y, work.x, work.y) > config.manhattanFallback) return 'manhattan_fallback';
  }

  if (citizen.happiness < config.happinessThreshold) return 'unhappy';

  return 'none';
}

/**
 * Job relocation tick: citizens with long/failed commutes or low happiness
 * attempt to switch to a closer/better workplace.
 * If the commute route is confirmed failed and no reachable workplace exists,
 * the citizen becomes unemployed (workplaceId = null).
 */
export function jobRelocationTick(
  citizens: readonly Citizen[],
  candidates: readonly WorkplaceCandidateWithZone[],
  occupancy: Map<string, number>,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  grid: ReadableGrid,
  currentTick: number,
  config?: Partial<JobRelocationConfig>,
): { count: number; relocatedIds: number[] } {
  const cfg: JobRelocationConfig = { ...DEFAULT_JOB_RELOCATION_CONFIG, ...config };

  if (candidates.length === 0) return { count: 0, relocatedIds: [] };

  // 1. Filter eligible citizens with their trigger reasons
  const eligible: { citizen: Citizen; reason: string }[] = [];
  for (const c of citizens) {
    if (c.workplaceId === null || c.homeId === null || !isWorkingAge(c.age)) continue;
    const reason = getTriggerReason(c, cache, cfg);
    if (reason !== 'none') eligible.push({ citizen: c, reason });
  }
  if (eligible.length === 0) return { count: 0, relocatedIds: [] };

  // 2. Split into urgent (failed route — no cap) and non-urgent (rate-limited)
  const urgent = eligible.filter(e => e.reason === 'failed');
  const nonUrgent = eligible.filter(e => e.reason !== 'failed');
  const maxNonUrgent = Math.max(1, Math.floor(nonUrgent.length * cfg.maxRelocateRatio));
  const relocatedIds: number[] = [];

  // 3. Process all urgent citizens first (no rate limit)
  //    Then process non-urgent citizens up to the cap
  const ordered = [...urgent, ...nonUrgent];
  let nonUrgentCount = 0;

  for (const { citizen, reason } of ordered) {
    if (reason !== 'failed' && nonUrgentCount >= maxNonUrgent) continue;

    const currentPos = citizen.workplaceId!;
    const homePos = parsePosKeyUnsafe(citizen.homeId!);

    // Find current workplace's zoneType
    const currentCandidate = candidates.find(c => c.pos === currentPos);
    const currentZoneType = currentCandidate?.zoneType;

    // Filter alternatives with remaining capacity (exclude current)
    const alternatives = candidates.filter(c => {
      if (c.pos === currentPos) return false;
      const occ = occupancy.get(c.pos) ?? 0;
      return occ < c.capacity;
    });

    if (alternatives.length === 0) {
      // No alternatives — only become unemployed if route is failed AND current unreachable
      if (reason === 'failed') {
        const distCheck = roadDistanceToTargets(grid, homePos, new Set([currentPos]), cfg.dijkstraMaxBudget);
        if (!distCheck.has(currentPos)) {
          const oldOcc = occupancy.get(currentPos) ?? 0;
          occupancy.set(currentPos, Math.max(0, oldOcc - 1));
          (citizen as Citizen).workplaceId = null;
          (citizen as Citizen).unemployedSince = currentTick;
          relocatedIds.push(citizen.id);
        }
      }
      continue;
    }

    // Build target set for Dijkstra: alternatives + current position
    const targetSet = new Set<string>(alternatives.map(c => c.pos));
    targetSet.add(currentPos);

    // Dijkstra from home to all targets
    const distMap = roadDistanceToTargets(grid, homePos, targetSet, cfg.dijkstraMaxBudget);

    // Score current workplace
    const currentScore = currentZoneType !== undefined
      ? scoreWorkplaceWithCost(citizen, currentZoneType, distMap.get(currentPos) ?? null)
      : -Infinity;

    // Score alternatives and find best
    let bestCandidate: WorkplaceCandidateWithZone | null = null;
    let bestScore = -Infinity;
    for (const alt of alternatives) {
      const score = scoreWorkplaceWithCost(citizen, alt.zoneType, distMap.get(alt.pos) ?? null);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = alt;
      }
    }

    if (bestCandidate !== null && bestScore - currentScore >= cfg.scoreGap) {
      // Relocate to better workplace
      const oldOcc = occupancy.get(currentPos) ?? 0;
      occupancy.set(currentPos, Math.max(0, oldOcc - 1));
      citizen.workplaceId = bestCandidate.pos;
      (citizen as Citizen).unemployedSince = null;
      occupancy.set(bestCandidate.pos, (occupancy.get(bestCandidate.pos) ?? 0) + 1);
      relocatedIds.push(citizen.id);
      if (reason !== 'failed') nonUrgentCount++;
    } else if (reason === 'failed') {
      // Route confirmed failed — current workplace unreachable
      // Try to pick any reachable alternative (even without scoreGap)
      let reachableAlt: WorkplaceCandidateWithZone | null = null;
      let reachableScore = -Infinity;
      for (const alt of alternatives) {
        if (!distMap.has(alt.pos)) continue;
        const score = scoreWorkplaceWithCost(citizen, alt.zoneType, distMap.get(alt.pos)!);
        if (score > reachableScore) {
          reachableScore = score;
          reachableAlt = alt;
        }
      }

      const oldOcc = occupancy.get(currentPos) ?? 0;
      occupancy.set(currentPos, Math.max(0, oldOcc - 1));

      if (reachableAlt) {
        citizen.workplaceId = reachableAlt.pos;
        (citizen as Citizen).unemployedSince = null;
        occupancy.set(reachableAlt.pos, (occupancy.get(reachableAlt.pos) ?? 0) + 1);
      } else {
        // No reachable alternative — become unemployed
        (citizen as Citizen).workplaceId = null;
        (citizen as Citizen).unemployedSince = currentTick;
      }
      relocatedIds.push(citizen.id);
    }
  }

  return { count: relocatedIds.length, relocatedIds };
}

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
  /** The commute length, in ticks, past which a citizen wants a different job. */
  commuteTimeThreshold: number;
  /** The fallback when commute time cannot be estimated: how many cells of straight-line
   *  distance counts as too far. */
  manhattanFallback: number;
  happinessThreshold: number;
  scoreGap: number;
  maxRelocateRatio: number;
  tickInterval: number;
  dijkstraMaxBudget: number;
}

export const DEFAULT_JOB_RELOCATION_CONFIG: JobRelocationConfig = {
  /**
   * Set from the commute time distributions measured across six cities and one real save: a
   * mixed-use town's median is 11, a compact city 24.7, the real save 42.9, a zoned city with no
   * transit 70.2 and a gridlocked one 108, while metro riders with home and work beside stations
   * stay within 34 however far they live.
   *
   * At 60, towns and compact cities almost never trigger, about 40% of a badly planned city
   * wants a different job, and no metro rider is caught — which is what makes living far away
   * beside a station work.
   */
  commuteTimeThreshold: 60,
  manhattanFallback: 15,
  happinessThreshold: 35,
  scoreGap: 15,
  maxRelocateRatio: 0.05,
  tickInterval: 120,
  /** The road cost budget (see `core/road/roadCost.ts`). 60 on the old scale, x18 as integers. */
  dijkstraMaxBudget: 1080,
};

/** How many ticks this commute takes. Returns a non-finite value when it cannot be estimated. */
export type CommuteTimeOf = (citizen: Citizen) => number;

/**
 * Whether this citizen should consider a different job, and whether it is urgent.
 *
 * One main rule: **how long the commute takes**. Distance still costs, since driving time rises
 * with distance and congestion, but that cost can be offset by transit, so living far away beside
 * a station is not forced into a job change while living nearby in daily gridlock is.
 *
 * Two mutually exclusive rules — path length with a cached route and straight-line distance
 * without — filtered nobody: a path length of 500 never holds in a 60x60 city, and a
 * straight-line distance of 15 matched 99.9%. The rule also depended on whether the system
 * happened to have finished computing: once cache coverage on load was fixed, everyone fell on
 * the "has a route" side and the whole mechanism silently stopped.
 */
function getTriggerReason(
  citizen: Citizen,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  config: JobRelocationConfig,
  commuteTimeOf: CommuteTimeOf,
): 'none' | 'failed' | 'long_commute' | 'unhappy' {
  const route = cache.get(citizen.id);

  if (route) {
    if (route.status === 'failed') return 'failed';
    // The road network just changed and the cache has not been recomputed. Treating that as
    // unreachable triggers a wave of mass unemployment.
    if (route.generation !== cache.roadGeneration) return 'none';
  }

  const time = commuteTimeOf(citizen);
  if (Number.isFinite(time)) {
    if (time > config.commuteTimeThreshold) return 'long_commute';
  } else {
    // The fallback when time cannot be estimated, as just after roads are built and before there
    // is a reachability map.
    const home = parsePosKeyUnsafe(citizen.homeId!);
    const work = parsePosKeyUnsafe(citizen.workplaceId!);
    if (manhattanDistance(home.x, home.y, work.x, work.y) > config.manhattanFallback) return 'long_commute';
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
/** Optional distance lookup matching roadDistanceToTargets signature. */
export type DistanceLookup = (
  grid: ReadableGrid,
  homePos: { x: number; y: number },
  targets: Set<string>,
  maxBudget: number,
) => Map<string, number>;

/**
 * Which citizens should change jobs this round, and why.
 *
 * Two groups: those who **cannot reach** work (urgent) and those whose **commute is too long**
 * (not urgent). Their order matters, because `occupancy` changes as relocations proceed and later
 * citizens see earlier decisions.
 *
 * Separate because how many citizens qualify is a useful observation in itself: it does no
 * distance lookups, so the trigger conditions can be checked without running a round.
 */
export function collectJobRelocationTriggers(
  citizens: readonly Citizen[],
  candidates: readonly WorkplaceCandidateWithZone[],
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  config?: Partial<JobRelocationConfig>,
  commuteTimeOf: CommuteTimeOf = () => NaN,
): { urgent: { citizen: Citizen; reason: string }[]; nonUrgent: { citizen: Citizen; reason: string }[] } {
  const cfg: JobRelocationConfig = config
    ? { ...DEFAULT_JOB_RELOCATION_CONFIG, ...config }
    : DEFAULT_JOB_RELOCATION_CONFIG;
  const urgent: { citizen: Citizen; reason: string }[] = [];
  const nonUrgent: { citizen: Citizen; reason: string }[] = [];
  if (candidates.length === 0) return { urgent, nonUrgent };
  for (const c of citizens) {
    if (c.workplaceId === null || c.homeId === null || !isWorkingAge(c.age)) continue;
    const reason = getTriggerReason(c, cache, cfg, commuteTimeOf);
    if (reason === 'none') continue;
    (reason === 'failed' ? urgent : nonUrgent).push({ citizen: c, reason });
  }
  return { urgent, nonUrgent };
}

/**
 * Job relocation: citizens who cannot reach work, or whose commute is too long, change jobs. **A
 * whole round runs within one tick.**
 *
 * ### Why it is no longer sliced
 *
 * This round was once sliced to 2 citizens per tick, as an analgesic for BUG-109, when every
 * citizen needed a full Dijkstra: 1,474ms for a round in a city of 2,436.
 *
 * The underlying fix followed: a level-aware workplace distance cache that works over elevated
 * roads made the lookup O(1), and the fallback road graph is now built once per round. **The
 * analgesic stayed.**
 *
 * Measured on a player's 12,354-population save, a round takes **7.7ms**; at 100,000 it takes
 * **29ms**. At 2 citizens per tick, a round takes 503 ticks, and at 100,000 it takes **9,478
 * ticks, about 400 game days**. Job relocation was effectively switched off in a large city.
 *
 * And a window of hundreds of ticks lets the list go stale: candidate workplaces demolished,
 * citizens dead or emigrated — exactly the class of problem BUG-331 covered. Finishing within one
 * tick removes the window.
 *
 * ### Order
 *
 * Everyone **unable to reach** work first (urgent), then everyone whose **commute is too long**
 * (not urgent). The order matters, because `occupancy` changes as relocations proceed and later
 * citizens see earlier decisions.
 */
export function jobRelocationTick(
  citizens: readonly Citizen[],
  candidates: readonly WorkplaceCandidateWithZone[],
  occupancy: Map<string, number>,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number },
  grid: ReadableGrid,
  currentTick: number,
  config?: Partial<JobRelocationConfig>,
  distanceLookup?: DistanceLookup,
  commuteTimeOf: CommuteTimeOf = () => NaN,
): { count: number; relocatedIds: number[] } {
  const cfg: JobRelocationConfig = config
    ? { ...DEFAULT_JOB_RELOCATION_CONFIG, ...config }
    : DEFAULT_JOB_RELOCATION_CONFIG;

  const { urgent, nonUrgent } = collectJobRelocationTriggers(
    citizens, candidates, cache, cfg, commuteTimeOf);

  const ordered = [...urgent, ...nonUrgent];
  const maxNonUrgent = Math.max(1, Math.floor(nonUrgent.length * cfg.maxRelocateRatio));
  const lookup = distanceLookup ?? roadDistanceToTargets;

  let nonUrgentCount = 0;
  const relocatedIds: number[] = [];

  for (const { citizen, reason } of ordered) {
    if (reason !== 'failed' && nonUrgentCount >= maxNonUrgent) continue;
    // Citizens with a null homeId or workplaceId were filtered out by
    // `collectJobRelocationTriggers`, and the list and its processing are in one tick, so nothing
    // in between clears them to null. The sliced version needed a second check here, because that
    // list had to survive hundreds of ticks.
    const currentPos = citizen.workplaceId!;
    const homePos = parsePosKeyUnsafe(citizen.homeId!);

    // Find current workplace's zoneType
    const currentCandidate = candidates.find(c => c.pos === currentPos);
    const currentZoneType = currentCandidate?.zoneType;

    // Build target set inline (avoid .filter() + .map() arrays)
    const targetSet = new Set<string>();
    targetSet.add(currentPos);
    let hasAlternatives = false;
    for (const c of candidates) {
      if (c.pos === currentPos) continue;
      const occ = occupancy.get(c.pos) ?? 0;
      if (occ < c.capacity) {
        targetSet.add(c.pos);
        hasAlternatives = true;
      }
    }

    if (!hasAlternatives) {
      // No alternatives — only become unemployed if route is failed AND current unreachable
      if (reason === 'failed') {
        const distCheck = lookup(grid, homePos, new Set([currentPos]), cfg.dijkstraMaxBudget);
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

    // Dijkstra from home to all targets
    const distMap = lookup(grid, homePos, targetSet, cfg.dijkstraMaxBudget);

    // Score current workplace
    const currentScore = currentZoneType !== undefined
      ? scoreWorkplaceWithCost(citizen, currentZoneType, distMap.get(currentPos) ?? null)
      : -Infinity;

    // Score alternatives inline and find best
    let bestCandidate: WorkplaceCandidateWithZone | null = null;
    let bestScore = -Infinity;
    for (const alt of candidates) {
      if (alt.pos === currentPos) continue;
      const occ = occupancy.get(alt.pos) ?? 0;
      if (occ >= alt.capacity) continue;
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
      for (const alt of candidates) {
        if (alt.pos === currentPos) continue;
        const occ = occupancy.get(alt.pos) ?? 0;
        if (occ >= alt.capacity) continue;
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

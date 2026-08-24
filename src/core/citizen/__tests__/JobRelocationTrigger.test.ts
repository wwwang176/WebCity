import { describe, it, expect } from 'vitest';
import {
  collectJobRelocationTriggers, DEFAULT_JOB_RELOCATION_CONFIG,
  type WorkplaceCandidateWithZone,
} from '../JobRelocation';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import type { CachedRoute } from '../../traffic/CommuteCache';
import type { ReadableGrid } from '../../grid/GridHelpers';

/**
 * Which commutes should make someone want a different job.
 *
 * Two mutually exclusive rules — path length with a cached route (threshold 500) and
 * straight-line distance without (threshold 15) — asked the wrong question both ways: the
 * measured maximum path length in a 60x60 city is 99, so 500 never holds, and 99.9% of
 * straight-line distances exceed 15, which lets everyone through. What actually filtered was the
 * 5%-per-round quota, taken in list order and unrelated to how good a commute is.
 *
 * Worse, the if/else applied entirely different rules to two identical citizens depending on
 * whether the system happened to have computed a route for one of them. Once cache coverage on
 * load was fixed, everyone fell on the "has a route" side and the whole mechanism silently
 * stopped.
 *
 * There is now one rule: **how long the commute takes**. Distance still costs, since driving time
 * rises with it, but that cost can be offset by transit, which is what makes living far away
 * beside a station a choice.
 */

function makeCitizen(id: number, overrides: Partial<Citizen> = {}): Citizen {
  return {
    id, birthTick: 0, age: 100, lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE, happiness: 80, health: 80,
    homeId: '5,1', workplaceId: '40,1',
    unemployedSince: null, homelessSince: null,
    emigrationTolerance: 25, educationProgress: 0,
    ...overrides,
  };
}

const grid: ReadableGrid = {
  getCell(x: number, y: number) {
    if (x < 0 || y < 0 || x >= 60 || y >= 3) return null;
    return { roadType: y === 0 ? RoadType.TWO_LANE : RoadType.NONE };
  },
};

const candidates: WorkplaceCandidateWithZone[] = [
  { pos: '40,1', zoneType: ZoneType.COMMERCIAL_LOW, capacity: 20 },
  { pos: '6,1', zoneType: ZoneType.COMMERCIAL_LOW, capacity: 20 },
];

const noRoutes = { get: () => undefined, roadGeneration: 0 };

function readyRoute(id: number): CachedRoute {
  return {
    citizenId: id, homeId: '5,1', workplaceId: '40,1',
    morningPath: [{ id: 'a', from: {} as any, to: {} as any, length: 40, type: 'straight' }],
    eveningPath: null, status: 'ready', generation: 0,
  };
}

/** How many citizens are judged to need a different job. Does no distance lookups. */
function pendingWith(
  citizens: Citizen[],
  commuteTime: (c: Citizen) => number,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number } = noRoutes,
): number {
  const { urgent, nonUrgent } = collectJobRelocationTriggers(
    citizens, candidates, cache, undefined, commuteTime);
  return urgent.length + nonUrgent.length;
}

const THRESHOLD = DEFAULT_JOB_RELOCATION_CONFIG.commuteTimeThreshold;

describe('換工作的觸發條件', () => {
  it('should leave a citizen with a tolerable commute alone', () => {
    expect(pendingWith([makeCitizen(1)], () => THRESHOLD - 1)).toBe(0);
  });

  it('should flag a citizen whose commute is too long', () => {
    expect(pendingWith([makeCitizen(1)], () => THRESHOLD + 1)).toBe(1);
  });

  it('should judge the same way whether or not a route is cached', () => {
    // The real defect in the old implementation: the rule must not depend on whether the system
    // happened to have finished computing.
    const withCache = { get: (id: number) => readyRoute(id), roadGeneration: 0 };
    const long = () => THRESHOLD + 20;
    const short = () => THRESHOLD - 20;

    expect(pendingWith([makeCitizen(1)], long, withCache)).toBe(1);
    expect(pendingWith([makeCitizen(1)], long, noRoutes)).toBe(1);
    expect(pendingWith([makeCitizen(1)], short, withCache)).toBe(0);
    expect(pendingWith([makeCitizen(1)], short, noRoutes)).toBe(0);
  });

  it('should leave a distant citizen alone when transit makes the trip quick', () => {
    // The point of all of it. Living far away, a long drive, but with both ends beside stations:
    // the commute is short and should not force a job change.
    const farButWellServed = makeCitizen(1, { homeId: '0,1', workplaceId: '55,1' });
    expect(pendingWith([farButWellServed], () => 22)).toBe(0);
  });

  it('should flag a nearby citizen stuck in traffic', () => {
    const nearButJammed = makeCitizen(1, { homeId: '30,1', workplaceId: '36,1' });
    expect(pendingWith([nearButJammed], () => THRESHOLD + 30)).toBe(1);
  });

  it('should still treat an unreachable commute as urgent', () => {
    const failed: CachedRoute = { ...readyRoute(1), status: 'failed', morningPath: null };
    const cache = { get: () => failed, roadGeneration: 0 };
    expect(pendingWith([makeCitizen(1)], () => 1, cache), '走不到的人被放過了').toBe(1);
  });

  it('should still consider an unhappy citizen', () => {
    expect(pendingWith([makeCitizen(1, { happiness: 10 })], () => 1)).toBe(1);
  });

  it('should ignore a stale route rather than treat it as failed', () => {
    // The road network just changed and the cache has not been recomputed. Treating that as
    // unreachable triggers a wave of mass unemployment.
    const stale = { get: (id: number) => ({ ...readyRoute(id), generation: -1 }), roadGeneration: 0 };
    expect(pendingWith([makeCitizen(1)], () => 1, stale)).toBe(0);
  });

  it('should fall back to straight-line distance when the commute time is unknown', () => {
    // A fallback is still needed when time cannot be estimated, or nothing is judged at all for
    // the few ticks after roads are built.
    const far = makeCitizen(1, { homeId: '0,1', workplaceId: '55,1' });
    const near = makeCitizen(2, { homeId: '30,1', workplaceId: '31,1' });
    expect(pendingWith([far], () => NaN)).toBe(1);
    expect(pendingWith([near], () => NaN)).toBe(0);
  });
});

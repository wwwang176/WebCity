import { describe, it, expect, vi } from 'vitest';
import {
  jobRelocationTick,

  type JobRelocationConfig,
  DEFAULT_JOB_RELOCATION_CONFIG,
  type WorkplaceCandidateWithZone,
} from '../JobRelocation';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import type { CachedRoute } from '../../traffic/CommuteCache';
import type { ReadableGrid } from '../../grid/GridHelpers';
import { toPosKey } from '../../grid/GridHelpers';

function makeCitizen(overrides: Partial<Citizen> = {}): Citizen {
  return {
    id: 1,
    birthTick: 0,
    age: 100,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    happiness: 50,
    health: 80,
    homeId: '5,5',
    workplaceId: '6,6',
    unemployedSince: null,
    homelessSince: null,
    emigrationTolerance: 25,
    educationProgress: 0,
    ...overrides,
  };
}

function makeRoute(overrides: Partial<CachedRoute> = {}): CachedRoute {
  return {
    citizenId: 1,
    homeId: '5,5',
    workplaceId: '6,6',
    morningPath: null,
    eveningPath: null,
    status: 'ready',
    generation: 0,
    ...overrides,
  };
}

/** Create a grid with roads along y=0 from x=0 to x=width-1 */
function makeRoadGrid(width: number, height: number): ReadableGrid {
  return {
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      if (y === 0) return { roadType: RoadType.TWO_LANE };
      return { roadType: RoadType.NONE };
    },
  };
}

/** A cache-like object for tests */
function makeCacheMap(entries: [number, CachedRoute][], roadGeneration = 0): { get(id: number): CachedRoute | undefined; roadGeneration: number } {
  const map = new Map(entries);
  return { get: (id: number) => map.get(id), roadGeneration };
}

describe('jobRelocationTick', () => {
  // Grid: road along y=0, buildings along y=1
  // Home at (5,1), current work at (40,1), better work at (6,1)
  const grid = makeRoadGrid(50, 3);

  const config: JobRelocationConfig = {
    ...DEFAULT_JOB_RELOCATION_CONFIG,
    scoreGap: 5,
    maxRelocateRatio: 1.0, // allow all for testing
  };

  it('triggers relocation when commute is too long', () => {
    const citizen = makeCitizen({ id: 1, homeId: '5,1', workplaceId: '40,1' });
    const longRoute = makeRoute({
      citizenId: 1,
      status: 'ready',
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 200, type: 'straight' },
      ],
    });
    const cache = makeCacheMap([[1, longRoute]]);

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 1], ['6,1', 0]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, config);
    expect(result.count).toBe(1);
    expect(citizen.workplaceId).toBe('6,1');
    // Occupancy updated
    expect(occupancy.get('40,1')).toBe(0);
    expect(occupancy.get('6,1')).toBe(1);
  });

  it('triggers relocation when route status is failed', () => {
    const citizen = makeCitizen({ id: 2, homeId: '5,1', workplaceId: '40,1' });
    const failedRoute = makeRoute({ citizenId: 2, status: 'failed' });
    const cache = makeCacheMap([[2, failedRoute]]);

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 1], ['6,1', 0]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, config);
    expect(result.count).toBe(1);
    expect(citizen.workplaceId).toBe('6,1');
  });

  it('triggers relocation when happiness is low', () => {
    const citizen = makeCitizen({ id: 3, homeId: '5,1', workplaceId: '40,1', happiness: 20 });
    const cache = makeCacheMap([]); // no cache, but happiness triggers

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 1], ['6,1', 0]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, {
      ...config,
      manhattanFallback: 5, // manhattan from (5,1) to (40,1) = 35 > 5, triggers
    });
    expect(result.count).toBe(1);
  });

  it('uses manhattan fallback when no cache entry exists', () => {
    const citizen = makeCitizen({ id: 4, homeId: '5,1', workplaceId: '40,1' });
    const cache = makeCacheMap([]); // no cache

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 1], ['6,1', 0]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, {
      ...config,
      manhattanFallback: 15, // manhattan 35 > 15 triggers
    });
    expect(result.count).toBe(1);
  });

  it('does NOT trigger when manhattan fallback threshold not exceeded', () => {
    const citizen = makeCitizen({ id: 5, homeId: '5,1', workplaceId: '6,1' });
    const cache = makeCacheMap([]); // no cache

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
      { pos: '7,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['6,1', 1], ['7,1', 0]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, {
      ...config,
      manhattanFallback: 15, // manhattan from (5,1) to (6,1) = 1 <= 15
    });
    expect(result.count).toBe(0);
  });

  it('does NOT relocate when scoreGap is insufficient', () => {
    const citizen = makeCitizen({ id: 6, homeId: '5,1', workplaceId: '6,1' });
    const longRoute = makeRoute({
      citizenId: 6,
      status: 'ready',
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 200, type: 'straight' },
      ],
    });
    const cache = makeCacheMap([[6, longRoute]]);

    // Both candidates equally close — no score gap
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
      { pos: '7,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['6,1', 1], ['7,1', 0]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, {
      ...config,
      scoreGap: 100, // impossible gap
    });
    expect(result.count).toBe(0);
  });

  it('skips candidates at full capacity', () => {
    const citizen = makeCitizen({ id: 7, homeId: '5,1', workplaceId: '40,1' });
    const longRoute = makeRoute({
      citizenId: 7,
      status: 'ready',
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 200, type: 'straight' },
      ],
    });
    const cache = makeCacheMap([[7, longRoute]]);

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
      { pos: '6,1', capacity: 2, zoneType: ZoneType.INDUSTRIAL },
    ];
    // (6,1) is full
    const occupancy = new Map([['40,1', 1], ['6,1', 2]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, config);
    expect(result.count).toBe(0);
  });

  it('respects maxRelocateRatio', () => {
    // 100 candidates but ratio = 0.05 → max 5
    const citizens: Citizen[] = [];
    const cacheEntries: [number, CachedRoute][] = [];
    for (let i = 0; i < 100; i++) {
      citizens.push(makeCitizen({ id: i, homeId: '5,1', workplaceId: '40,1' }));
      cacheEntries.push([i, makeRoute({
        citizenId: i,
        status: 'ready',
        morningPath: [
          { id: 'a', from: {} as any, to: {} as any, length: 200, type: 'straight' },
        ],
      })]);
    }
    const cache = makeCacheMap(cacheEntries);
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 200, zoneType: ZoneType.INDUSTRIAL },
      { pos: '6,1', capacity: 200, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 100], ['6,1', 0]]);

    const result = jobRelocationTick(citizens, candidates, occupancy, cache, grid, 0, {
      ...config,
      maxRelocateRatio: 0.05,
    });
    expect(result.count).toBeLessThanOrEqual(5);
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it('failed routes bypass maxRelocateRatio — all processed at once', () => {
    const citizens: Citizen[] = [];
    const cacheEntries: [number, CachedRoute][] = [];
    for (let i = 0; i < 100; i++) {
      citizens.push(makeCitizen({ id: i, homeId: '5,1', workplaceId: '40,1' }));
      cacheEntries.push([i, makeRoute({ citizenId: i, status: 'failed' })]);
    }
    const cache = makeCacheMap(cacheEntries);

    // Disconnected grid — no roads to reach workplace
    const disconnectedGrid: ReadableGrid = {
      getCell(x: number, y: number) {
        if (x < 0 || y < 0 || x >= 50 || y >= 3) return null;
        if (y === 0 && x >= 4 && x <= 7) return { roadType: RoadType.TWO_LANE };
        return { roadType: RoadType.NONE };
      },
    };

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 200, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 100]]);

    const result = jobRelocationTick(citizens, candidates, occupancy, cache, disconnectedGrid, 0, {
      ...config,
      maxRelocateRatio: 0.05, // would cap at 5, but failed should bypass
    });
    // All 100 should be processed (not capped at 5)
    expect(result.count).toBe(100);
  });

  it('skips citizen with workplaceId === null', () => {
    const citizen = makeCitizen({ id: 10, workplaceId: null });
    const cache = makeCacheMap([]);
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map<string, number>();

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, config);
    expect(result.count).toBe(0);
  });

  it('skips citizen with homeId === null', () => {
    const citizen = makeCitizen({ id: 11, homeId: null });
    const cache = makeCacheMap([]);
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map<string, number>();

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, config);
    expect(result.count).toBe(0);
  });

  it('skips non-working-age citizens', () => {
    const teen = makeCitizen({ id: 12, age: 16, lifeStage: LifeStage.TEEN });
    const senior = makeCitizen({ id: 13, age: 220, lifeStage: LifeStage.SENIOR });
    const cache = makeCacheMap([]);
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map<string, number>();

    const result = jobRelocationTick([teen, senior], candidates, occupancy, cache, grid, 0, config);
    expect(result.count).toBe(0);
  });

  it('returns empty when no candidates trigger', () => {
    // All happy, short commute, no cache issues
    const citizen = makeCitizen({ id: 14, homeId: '5,1', workplaceId: '6,1', happiness: 80 });
    const shortRoute = makeRoute({
      citizenId: 14,
      status: 'ready',
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 10, type: 'straight' },
      ],
    });
    const cache = makeCacheMap([[14, shortRoute]]);
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['6,1', 1]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, config);
    expect(result.count).toBe(0);
    expect(result.relocatedIds).toEqual([]);
  });

  it('relocatedIds matches actually relocated citizens', () => {
    const c1 = makeCitizen({ id: 20, homeId: '5,1', workplaceId: '40,1' });
    const c2 = makeCitizen({ id: 21, homeId: '5,1', workplaceId: '6,1', happiness: 80 });
    const longRoute = makeRoute({
      citizenId: 20,
      status: 'ready',
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 200, type: 'straight' },
      ],
    });
    const shortRoute = makeRoute({
      citizenId: 21,
      status: 'ready',
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 10, type: 'straight' },
      ],
    });
    const cache = makeCacheMap([[20, longRoute], [21, shortRoute]]);

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 10, zoneType: ZoneType.INDUSTRIAL },
      { pos: '6,1', capacity: 10, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 1], ['6,1', 1]]);

    const result = jobRelocationTick([c1, c2], candidates, occupancy, cache, grid, 0, config);
    expect(result.relocatedIds).toContain(20);
    expect(result.relocatedIds).not.toContain(21);
  });

  it('citizen becomes unemployed when no reachable workplace exists', () => {
    // Home at (5,1) with road along y=0
    // Current work at (40,1) — far away, triggers relocation
    // Only candidate at (40,1) — same as current, no improvement possible
    // But road is disconnected so Dijkstra can't reach (40,1)
    const disconnectedGrid: ReadableGrid = {
      getCell(x: number, y: number) {
        if (x < 0 || y < 0 || x >= 50 || y >= 3) return null;
        // Road only from x=4 to x=7 at y=0
        if (y === 0 && x >= 4 && x <= 7) return { roadType: RoadType.TWO_LANE };
        return { roadType: RoadType.NONE };
      },
    };

    const citizen = makeCitizen({ id: 30, homeId: '5,1', workplaceId: '40,1' });
    const failedRoute = makeRoute({ citizenId: 30, status: 'failed' });
    const cache = makeCacheMap([[30, failedRoute]]);

    // Only candidate is the current workplace (far, unreachable)
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 1]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, disconnectedGrid, 0, config);
    // Citizen should become unemployed since no reachable workplace
    expect(result.count).toBe(1);
    expect(citizen.workplaceId).toBeNull();
    expect(occupancy.get('40,1')).toBe(0);
    expect(result.relocatedIds).toContain(30);
  });

  it('stale route (generation mismatch) does NOT trigger relocation', () => {
    // Route was ready at generation 0, but road network is now at generation 1.
    // Stale routes are recalculated gradually via isExpired() in spawnCommuteVehicles,
    // not treated as failed in jobRelocationTick (which would cause mass firing).
    const citizen = makeCitizen({ id: 31, homeId: '5,1', workplaceId: '40,1' });
    const staleRoute = makeRoute({
      citizenId: 31,
      status: 'ready',
      generation: 0,
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 10, type: 'straight' },
      ],
    });
    // roadGeneration=1 but route.generation=0 → stale (not failed)
    const cache = makeCacheMap([[31, staleRoute]], 1);

    const disconnectedGrid: ReadableGrid = {
      getCell(x: number, y: number) {
        if (x < 0 || y < 0 || x >= 50 || y >= 3) return null;
        if (y === 0 && x >= 4 && x <= 7) return { roadType: RoadType.TWO_LANE };
        return { roadType: RoadType.NONE };
      },
    };

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '40,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['40,1', 1]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, disconnectedGrid, 0, config);
    expect(result.count).toBe(0);
    expect(citizen.workplaceId).toBe('40,1'); // keeps job
  });

  it('stale route with reachable workplace does NOT cause unemployment', () => {
    // Route is stale but workplace is actually still reachable via Dijkstra
    const citizen = makeCitizen({ id: 32, homeId: '5,1', workplaceId: '6,1' });
    const staleRoute = makeRoute({
      citizenId: 32,
      status: 'ready',
      generation: 0,
      morningPath: [
        { id: 'a', from: {} as any, to: {} as any, length: 10, type: 'straight' },
      ],
    });
    const cache = makeCacheMap([[32, staleRoute]], 1);

    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '6,1', capacity: 5, zoneType: ZoneType.INDUSTRIAL },
    ];
    const occupancy = new Map([['6,1', 1]]);

    const result = jobRelocationTick([citizen], candidates, occupancy, cache, grid, 0, config);
    // Workplace is reachable — citizen stays employed
    expect(result.count).toBe(0);
    expect(citizen.workplaceId).toBe('6,1');
  });
});

describe('緊急與非緊急的順序', () => {
  it('should handle a failed route even when the non-urgent quota is used up', () => {
    // 走不到公司的人是**緊急**的，不吃 5% 的配額。兩組混在一起的話，前面一堆
    // 「通勤太久」的人會把配額用光，真正走不到公司的人就一直卡在那裡。
    const grid = makeRoadGrid(20, 20);
    // 遠的現職 + 家門口的空缺 —— 非緊急的那批要真的搬得動，配額才會被用掉。
    const candidates = [
      { pos: '18,0', capacity: 100, zoneType: ZoneType.COMMERCIAL_LOW },
      { pos: '1,0', capacity: 100, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const citizens: Citizen[] = [];
    const routes: [number, CachedRoute][] = [];
    // 40 位通勤太久的（非緊急，配額只有 max(1, 40×5%) = 2）
    for (let i = 1; i <= 40; i++) {
      citizens.push(makeCitizen({ id: i, homeId: '0,0', workplaceId: '18,0' }));
    }
    // 一位走不到公司的（緊急）排在最後
    citizens.push(makeCitizen({ id: 99, homeId: '0,0', workplaceId: '18,0' }));
    routes.push([99, makeRoute({ status: 'failed' })]);

    const { relocatedIds } = jobRelocationTick(
      citizens, candidates, new Map([['18,0', 41]]),
      makeCacheMap(routes), grid, 0, undefined, undefined, () => 999,
    );
    // 前提:非緊急的配額真的被用光了，否則這條測試什麼都沒擋到。
    const nonUrgentMoved = relocatedIds.filter(id => id !== 99).length;
    expect(nonUrgentMoved, '非緊急的一個都沒搬，配額沒被用掉').toBeGreaterThan(0);
    expect(relocatedIds, '走不到公司的人被非緊急的配額擋住了').toContain(99);
  });
});

describe('緊急優先於非緊急', () => {
  it('should give the last opening to the stranded citizen, not a long commuter', () => {
    // 兩組的順序只有在**搶同一個名額**時才看得出來 —— occupancy 邊走邊改，
    // 先被處理的人拿走位子。走不到公司的人比通勤久的人更需要那個位子。
    const grid = makeRoadGrid(20, 20);
    const candidates: WorkplaceCandidateWithZone[] = [
      { pos: '18,0', capacity: 100, zoneType: ZoneType.COMMERCIAL_LOW },
      { pos: '1,0', capacity: 1, zoneType: ZoneType.COMMERCIAL_LOW },  // 只剩一個名額
    ];
    // 通勤太久的（非緊急）排在陣列前面，走不到公司的（緊急）排在後面。
    const commuter = makeCitizen({ id: 1, homeId: '0,0', workplaceId: '18,0' });
    const stranded = makeCitizen({ id: 99, homeId: '0,0', workplaceId: '18,0' });
    const cache = makeCacheMap([[99, makeRoute({ citizenId: 99, status: 'failed' })]]);

    jobRelocationTick(
      [commuter, stranded], candidates, new Map([['18,0', 2], ['1,0', 0]]),
      cache, grid, 0, undefined, undefined, () => 999,
    );

    expect(stranded.workplaceId, '走不到公司的人沒搶到那個名額').toBe('1,0');
    expect(commuter.workplaceId, '通勤久的人搶走了唯一的名額').toBe('18,0');
  });
});

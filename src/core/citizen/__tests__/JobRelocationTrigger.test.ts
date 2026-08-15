import { describe, it, expect } from 'vitest';
import {
  beginJobRelocation, DEFAULT_JOB_RELOCATION_CONFIG,
  type WorkplaceCandidateWithZone,
} from '../JobRelocation';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import type { CachedRoute } from '../../traffic/CommuteCache';
import type { ReadableGrid } from '../../grid/GridHelpers';

/**
 * 什麼樣的通勤該讓人想換工作。
 *
 * 舊的判斷是兩條互斥的規則：**有**快取路線就看路徑長度（門檻 500），**沒有**就看
 * 直線距離（門檻 15）。兩個問題都問錯了 —— 實測 60×60 城市裡路徑長度最大值 99，
 * 500 永遠不成立；而直線距離超過 15 的佔 99.9%，等於全部放行。實際在篩人的是
 * 後面那條「每輪最多動 5%」的配額，而配額是照名單順序取的，跟通勤好不好無關。
 *
 * 更糟的是那個 if/else：兩個一模一樣的市民，會因為系統剛好還沒替其中一個算好
 * 路線而套用完全不同的規則。修好載入時的快取覆蓋率之後，所有人都落進「有路線」
 * 那一邊，於是整個機制靜靜地停擺了。
 *
 * 現在只有一條規則：**通勤要花多久**。距離仍然有代價（開車時間隨距離上升），但
 * 那個代價可以被大眾運輸抵銷 —— 這才有「住得遠但住在站旁邊」這種選擇。
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

/** 開一輪，回傳有多少人被判定為需要處理。 */
function pendingWith(
  citizens: Citizen[],
  commuteTime: (c: Citizen) => number,
  cache: { get(id: number): CachedRoute | undefined; roadGeneration: number } = noRoutes,
): number {
  return beginJobRelocation(
    citizens, candidates, new Map([['40,1', citizens.length]]), cache, grid, 0,
    undefined, undefined, commuteTime,
  ).pending;
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
    // 這是舊實作真正的毛病：規則不該取決於系統剛好算好了沒。
    const withCache = { get: (id: number) => readyRoute(id), roadGeneration: 0 };
    const long = () => THRESHOLD + 20;
    const short = () => THRESHOLD - 20;

    expect(pendingWith([makeCitizen(1)], long, withCache)).toBe(1);
    expect(pendingWith([makeCitizen(1)], long, noRoutes)).toBe(1);
    expect(pendingWith([makeCitizen(1)], short, withCache)).toBe(0);
    expect(pendingWith([makeCitizen(1)], short, noRoutes)).toBe(0);
  });

  it('should leave a distant citizen alone when transit makes the trip quick', () => {
    // 整件事的重點。住得遠（開車要很久）但兩端都在站旁邊 —— 通勤時間短，
    // 就不該被逼著換工作。
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
    // 路網剛改過，快取還沒重算。當成「走不到」會引發一波集體失業。
    const stale = { get: (id: number) => ({ ...readyRoute(id), generation: -1 }), roadGeneration: 0 };
    expect(pendingWith([makeCitizen(1)], () => 1, stale)).toBe(0);
  });

  it('should fall back to straight-line distance when the commute time is unknown', () => {
    // 估不出時間時仍然要有個保底，否則路網剛建好那幾 tick 完全不做判斷。
    const far = makeCitizen(1, { homeId: '0,1', workplaceId: '55,1' });
    const near = makeCitizen(2, { homeId: '30,1', workplaceId: '31,1' });
    expect(pendingWith([far], () => NaN)).toBe(1);
    expect(pendingWith([near], () => NaN)).toBe(0);
  });
});

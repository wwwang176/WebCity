import { describe, it, expect } from 'vitest';
import {
  jobRelocationTick, beginJobRelocation,
  DEFAULT_JOB_RELOCATION_CONFIG,
  type WorkplaceCandidateWithZone,
} from '../JobRelocation';
import type { Citizen } from '../types';
import { LifeStage, EducationLevel } from '../types';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import type { CachedRoute } from '../../traffic/CommuteCache';
import type { ReadableGrid } from '../../grid/GridHelpers';

/**
 * 把換工作那一輪切成好幾片。
 *
 * 這是 BUG-109 的止痛，不是治本：每個市民一次 Dijkstra 的成本沒有變，只是
 * 不再擠在同一個 tick。實測 2436 人的城市裡，這一輪要 1474 毫秒 —— 每 3 秒
 * 卡一次，而且隨人口持續變差。
 *
 * **唯一的正確性條件：世界凍結時，分片跑完的結果必須與一次跑完完全相同。**
 * 排程改變了，決策不能變。順序尤其重要 —— `occupancy` 會隨著搬遷邊走邊改，
 * 所以後面的市民看得到前面的決定；順序一亂，結果就不一樣。
 */

function makeCitizen(id: number, overrides: Partial<Citizen> = {}): Citizen {
  return {
    id,
    birthTick: 0,
    age: 100,
    lifeStage: LifeStage.ADULT,
    education: EducationLevel.NONE,
    happiness: 50,
    health: 80,
    homeId: '5,1',
    workplaceId: '40,1',
    unemployedSince: null,
    homelessSince: null,
    emigrationTolerance: 25,
    educationProgress: 0,
    ...overrides,
  };
}

function makeRoute(id: number, overrides: Partial<CachedRoute> = {}): CachedRoute {
  return {
    citizenId: id,
    homeId: '5,1',
    workplaceId: '40,1',
    morningPath: null,
    eveningPath: null,
    status: 'ready',
    generation: 0,
    ...overrides,
  };
}

/** 路在 y=0，建築在 y=1。 */
const grid: ReadableGrid = {
  getCell(x: number, y: number) {
    if (x < 0 || y < 0 || x >= 60 || y >= 3) return null;
    return { roadType: y === 0 ? RoadType.TWO_LANE : RoadType.NONE };
  },
};

const candidates: WorkplaceCandidateWithZone[] = [
  { pos: '40,1', zoneType: ZoneType.COMMERCIAL_LOW, capacity: 20 },
  { pos: '6,1', zoneType: ZoneType.COMMERCIAL_LOW, capacity: 20 },
  { pos: '8,1', zoneType: ZoneType.COMMERCIAL_LOW, capacity: 3 },
  { pos: '12,1', zoneType: ZoneType.OFFICE, capacity: 4 },
];

/**
 * 一批混合觸發原因的市民 —— 有走不到的（緊急），也有通勤太長的（非緊急）。
 * 兩者的處理順序不同，而且非緊急有配額，所以分片必須同時保住這兩件事。
 */
function scenario() {
  const citizens: Citizen[] = [];
  const routes: [number, CachedRoute][] = [];
  for (let i = 0; i < 14; i++) {
    citizens.push(makeCitizen(i + 1));
    routes.push([i + 1, i % 3 === 0
      ? makeRoute(i + 1, { status: 'failed' })
      : makeRoute(i + 1, {
          status: 'ready',
          morningPath: [{ id: 'a', from: {} as any, to: {} as any, length: 900, type: 'straight' }],
        })]);
  }
  const map = new Map(routes);
  return {
    citizens,
    cache: { get: (id: number) => map.get(id), roadGeneration: 0 },
    occupancy: new Map<string, number>([['40,1', 14]]),
  };
}

/** 一輪跑完之後，世界看起來如何。 */
function outcome(citizens: Citizen[], occupancy: Map<string, number>, relocated: number[]) {
  return {
    relocated,
    workplaces: citizens.map(c => `${c.id}:${c.workplaceId}`),
    unemployedSince: citizens.map(c => `${c.id}:${c.unemployedSince}`),
    occupancy: [...occupancy.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}

describe('job relocation slicing', () => {
  it('should reach exactly the same outcome as running it in one go', () => {
    const whole = scenario();
    const oneShot = jobRelocationTick(
      whole.citizens, candidates, whole.occupancy, whole.cache, grid, 0,
    );

    const sliced = scenario();
    const slicer = beginJobRelocation(
      sliced.citizens, candidates, sliced.occupancy, sliced.cache, grid, 0,
    );
    const relocated: number[] = [];
    let guard = 0;
    while (slicer.pending > 0) {
      relocated.push(...slicer.runSlice(2));
      if (++guard > 100) throw new Error('切片沒有收斂');
    }

    expect(outcome(sliced.citizens, sliced.occupancy, relocated))
      .toEqual(outcome(whole.citizens, whole.occupancy, oneShot.relocatedIds));
  });

  it('should never do more distance lookups than the slice budget allows', () => {
    // 這才是整件事的重點。切片如果不真的限制工作量，卡頓不會消失。
    const s = scenario();
    let calls = 0;
    const counting = (g: any, home: any, targets: Set<string>, budget: number) => {
      calls++;
      return DEFAULT_LOOKUP(g, home, targets, budget);
    };
    const slicer = beginJobRelocation(
      s.citizens, candidates, s.occupancy, s.cache, grid, 0, undefined, counting,
    );

    let guard = 0;
    while (slicer.pending > 0) {
      calls = 0;
      slicer.runSlice(3);
      expect(calls, '一片做了超過預算的 Dijkstra').toBeLessThanOrEqual(3);
      if (++guard > 100) throw new Error('切片沒有收斂');
    }
    expect(guard, '一片都沒跑到').toBeGreaterThan(1);
  });

  it('should finish the sweep, not stall on skipped citizens', () => {
    // 非緊急超過配額的市民會被跳過，而跳過**不該**消耗預算 —— 否則配額用完
    // 之後每一片都在空轉，pending 永遠降不到 0。
    const s = scenario();
    const slicer = beginJobRelocation(
      s.citizens, candidates, s.occupancy, s.cache, grid, 0,
      { ...DEFAULT_JOB_RELOCATION_CONFIG, maxRelocateRatio: 0.01 },
    );
    let guard = 0;
    while (slicer.pending > 0) {
      slicer.runSlice(1);
      if (++guard > 60) throw new Error('配額用完之後卡住了');
    }
    expect(slicer.pending).toBe(0);
  });

  it('should survive a home demolished midway through the round', () => {
    // 名單是開一輪的時候拍下來的，而一輪要跑幾十個 tick。玩家在中間拆掉一棟
    // 住宅，這個人的 homeId 就變成 null（`Reconcile` 會清掉），而底下是拿 `!`
    // 直接餵進 parsePosKeyUnsafe 的 —— 整個模擬迴圈會在那個 tick 丟例外。
    const s = scenario();
    const slicer = beginJobRelocation(
      s.citizens, candidates, s.occupancy, s.cache, grid, 0,
    );
    slicer.runSlice(2);
    for (const c of s.citizens) c.homeId = null;   // 那一排房子被拆了

    let guard = 0;
    expect(() => {
      while (slicer.pending > 0) {
        slicer.runSlice(2);
        if (++guard > 100) throw new Error('切片沒有收斂');
      }
    }, '住宅在一輪中間被拆掉就丟例外').not.toThrow();
  });

  it('should report pending work up front so the caller can size its slices', () => {
    const s = scenario();
    const slicer = beginJobRelocation(
      s.citizens, candidates, s.occupancy, s.cache, grid, 0,
    );
    expect(slicer.pending, '沒有市民需要換工作，這組情境等於沒測').toBeGreaterThan(0);
    expect(slicer.pending).toBeLessThanOrEqual(s.citizens.length);
  });
});

// 預設的距離查詢 —— 與 jobRelocationTick 內部用的是同一個。
import { roadDistanceToTargets } from '../../service/RoadCoverageFlood';
const DEFAULT_LOOKUP = roadDistanceToTargets;

describe('一輪跑到一半市民不在了', () => {
  it('should skip citizens who died or emigrated mid-round', () => {
    // 名單是開輪時拍的，而一輪要跑上百個 tick。移除市民只是把物件從
    // CitizenManager 的陣列裡拿掉 —— 這份名單握的是物件參照，欄位都還在。
    // 不擋墓碑的話死人也會被換工作，吃掉配額，讓活著的人少一次機會。
    const s = scenario();
    const slicer = beginJobRelocation(
      s.citizens, candidates, s.occupancy, s.cache, grid, 0,
    );
    for (const c of s.citizens) c.removed = true;

    const relocated: number[] = [];
    let guard = 0;
    while (slicer.pending > 0) {
      relocated.push(...slicer.runSlice(2));
      if (++guard > 200) throw new Error('切片沒有收斂');
    }
    expect(relocated, '已經不在城裡的人還是被換了工作').toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { distributeLoadToServingFacility, type LoadDemand } from '../StationLoadDistributor';

interface StubFacility { id: string; x: number; y: number; capacity: number }

/** 一張手寫的「這一格歸誰」表。真的那一份來自覆蓋洪水。 */
function owners(table: Record<string, string>) {
  return (x: number, y: number) => table[`${x},${y}`] ?? null;
}

describe('把需求攤到服務那一格的設施頭上', () => {
  it('should call it infinitely overloaded when there is no facility at all', () => {
    // 0 會被讀成「很輕鬆」。一座設施都沒有而需求存在,那是最糟的情況。
    const r = distributeLoadToServingFacility([], [{ x: 5, y: 5, weight: 10 }], new Map(), () => null);

    expect(r.loadRatio).toBe(Infinity);
    expect(r.unassigned).toBe(10);
  });

  it('should be quiet when nothing is demanded', () => {
    const facs: StubFacility[] = [{ id: 'p1', x: 0, y: 0, capacity: 100 }];
    const loadMap = new Map<string, number>();
    const r = distributeLoadToServingFacility(facs, [], loadMap, () => 'p1');

    expect(r.loadRatio).toBe(0);
    expect(loadMap.get('p1')).toBe(0);
  });

  it('should follow the coverage, not the straight line', () => {
    // B 在直線上比較近，但覆蓋說這一格是 A 在服務（開車過去 B 要繞一大圈）。
    // 舊的規則會把需求記在 B 頭上 —— 於是 B 顯示爆量卻服務不到人，A 顯示很空。
    const facs: StubFacility[] = [
      { id: 'A', x: 0, y: 0, capacity: 100 },
      { id: 'B', x: 10, y: 0, capacity: 100 },
    ];
    const demands: LoadDemand[] = [{ x: 9, y: 0, weight: 7 }];
    const loadMap = new Map<string, number>();

    distributeLoadToServingFacility(facs, demands, loadMap, owners({ '9,0': 'A' }));

    expect(loadMap.get('A'), '沒有跟著覆蓋走').toBe(7);
    expect(loadMap.get('B')).toBe(0);
  });

  it('should add up several demands on the same facility', () => {
    const facs: StubFacility[] = [
      { id: 'A', x: 0, y: 0, capacity: 100 },
      { id: 'B', x: 10, y: 0, capacity: 100 },
    ];
    const loadMap = new Map<string, number>();
    distributeLoadToServingFacility(
      facs,
      [{ x: 1, y: 0, weight: 5 }, { x: 2, y: 0, weight: 3 }, { x: 9, y: 0, weight: 7 }],
      loadMap,
      owners({ '1,0': 'A', '2,0': 'A', '9,0': 'B' }),
    );

    expect(loadMap.get('A')).toBe(8);
    expect(loadMap.get('B')).toBe(7);
  });

  it('should keep unserved demand in the city total', () => {
    // 需求點在上一次覆蓋重算之後失去覆蓋。歸零的話，城市會在崩潰的當下
    // 顯示得比實際健康。
    const facs: StubFacility[] = [{ id: 'A', x: 0, y: 0, capacity: 100 }];
    const loadMap = new Map<string, number>();
    const r = distributeLoadToServingFacility(
      facs,
      [{ x: 1, y: 0, weight: 30 }, { x: 50, y: 50, weight: 20 }],
      loadMap,
      owners({ '1,0': 'A' }),
    );

    expect(loadMap.get('A')).toBe(30);
    expect(r.unassigned, '沒服務到的需求消失了').toBe(20);
    expect(r.loadRatio, '分子該是 50 不是 30').toBeCloseTo(0.5, 6);
  });

  it('should ignore an owner that is no longer one of the facilities', () => {
    // 覆蓋算過之後才被拆掉或斷電的設施:擁有者表還指著它，但它不該再收需求。
    // 硬記上去的話，那個 id 會在 loadMap 裡冒出來,而面板拿它去查設施會查不到。
    const facs: StubFacility[] = [{ id: 'A', x: 0, y: 0, capacity: 100 }];
    const loadMap = new Map<string, number>();
    const r = distributeLoadToServingFacility(
      facs, [{ x: 1, y: 0, weight: 40 }], loadMap, owners({ '1,0': 'DEMOLISHED' }),
    );

    expect(loadMap.has('DEMOLISHED'), '拆掉的設施跑進負載表了').toBe(false);
    expect(r.unassigned).toBe(40);
  });

  it('should measure the ratio against the whole city capacity', () => {
    const facs: StubFacility[] = [
      { id: 'A', x: 0, y: 0, capacity: 50 },
      { id: 'B', x: 10, y: 0, capacity: 50 },
    ];
    const loadMap = new Map<string, number>();
    const r = distributeLoadToServingFacility(
      facs,
      [{ x: 0, y: 0, weight: 30 }, { x: 10, y: 0, weight: 60 }],
      loadMap,
      owners({ '0,0': 'A', '10,0': 'B' }),
    );

    expect(r.loadRatio).toBeCloseTo(0.9, 6);
  });

  it('should call it infinite when the facilities have no capacity', () => {
    const facs: StubFacility[] = [{ id: 'A', x: 0, y: 0, capacity: 0 }];
    const loadMap = new Map<string, number>();
    const r = distributeLoadToServingFacility(
      facs, [{ x: 0, y: 0, weight: 5 }], loadMap, owners({ '0,0': 'A' }),
    );

    expect(r.loadRatio).toBe(Infinity);
  });

  it('should clear whatever the caller left in the map', () => {
    const facs: StubFacility[] = [{ id: 'A', x: 0, y: 0, capacity: 100 }];
    const loadMap = new Map<string, number>();
    loadMap.set('stale', 999);

    distributeLoadToServingFacility(facs, [{ x: 0, y: 0, weight: 10 }], loadMap, owners({ '0,0': 'A' }));

    expect(loadMap.has('stale')).toBe(false);
    expect(loadMap.get('A')).toBe(10);
  });
});

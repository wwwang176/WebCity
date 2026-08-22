import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection } from '../types';
import { UnifiedRoadLookup } from '../UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { buildRoadCellGraph } from '../RoadCellGraph';
import { ROAD_COVERAGE } from '../roadCost';
import { roadConnectivity } from '../RoadConnectivity';

const EW = RoadDirection.EAST | RoadDirection.WEST;

interface Cell { roadType: number; roadFlags: number }

function city(w: number, h: number) {
  const cells = new Map<string, Cell>();
  const em = new ElevationManager();
  const grid = {
    width: w, height: h,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      return cells.get(`${x},${y}`) ?? { roadType: RoadType.NONE, roadFlags: 0 };
    },
    forEachCell(fn: (c: { roadType: number }, x: number, y: number) => void) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(this.getCell(x, y)!, x, y);
    },
  };
  return {
    em,
    road(x: number, y: number, roadType = RoadType.TWO_LANE, roadFlags = EW) {
      cells.set(`${x},${y}`, { roadType, roadFlags });
    },
    row(x1: number, x2: number, y: number, roadType = RoadType.TWO_LANE) {
      for (let x = x1; x <= x2; x++) cells.set(`${x},${y}`, { roadType, roadFlags: EW });
    },
    graph() {
      return buildRoadCellGraph(new UnifiedRoadLookup(grid, em));
    },
  };
}

describe('A 格和 B 格通不通', () => {
  it('should say connected for two points on the same road', () => {
    const c = city(20, 6);
    c.row(0, 9, 2);

    const r = roadConnectivity(c.graph(), { x: 0, y: 2 }, { x: 9, y: 2 });

    expect(r.connected).toBe(true);
    // 兩端各自附掛到 reach 內的路,所以最便宜的一條是 x=2 走到 x=7:
    // 五格雙線道 × 36。取的必須是最便宜的那一條,不是最後碰到的那一個目標。
    expect(r.cost).toBe(5 * 36);
  });

  it('should say not connected for two roads that never meet', () => {
    const c = city(20, 8);
    c.row(0, 5, 1);
    c.row(12, 18, 6);

    const r = roadConnectivity(c.graph(), { x: 0, y: 1 }, { x: 18, y: 6 });

    expect(r.connected).toBe(false);
    expect(r.cost, '走不到卻給了一個成本').toBe(-1);
  });

  it('should cost nothing to reach where you already are', () => {
    const c = city(20, 6);
    c.row(0, 9, 2);

    expect(roadConnectivity(c.graph(), { x: 4, y: 2 }, { x: 4, y: 2 }))
      .toEqual({ connected: true, cost: 0 });
  });

  it('should not stop at a coverage budget', () => {
    // 這就是 BUG-368 的重點。服務覆蓋走到預算耗盡就停，所以它的「0 覆蓋」
    // 分不出「不連通」與「連通但太遠」。這一支必須分得出來。
    const c = city(60, 6);
    c.row(0, 49, 2, RoadType.RURAL); // 鄉道每格 60，走 49 格 = 2940

    const r = roadConnectivity(c.graph(), { x: 0, y: 2 }, { x: 49, y: 2 });

    expect(r.connected, '走到覆蓋預算就停了').toBe(true);
    expect(r.cost).toBeGreaterThan(ROAD_COVERAGE.BASE_COST);
  });

  it('should attach a building cell to a road within reach', () => {
    // 家與工作都不是道路格 —— 它們附掛到 reach 內的路上，跟服務覆蓋同一條規則。
    const c = city(20, 8);
    c.row(0, 9, 2);

    const r = roadConnectivity(c.graph(), { x: 1, y: 4 }, { x: 9, y: 2 });

    expect(r.connected).toBe(true);
  });

  it('should say not connected when a point is too far from any road', () => {
    const c = city(20, 12);
    c.row(0, 9, 2);

    const r = roadConnectivity(c.graph(), { x: 1, y: 9 }, { x: 9, y: 2 });

    expect(r.connected).toBe(false);
    expect(r.cost).toBe(-1);
  });

  it('should walk across a bridge that is the only link', () => {
    // 兩塊地面各自成塊，中間只有一座高架橋接著。
    const c = city(20, 6);
    c.row(0, 4, 2);
    c.row(8, 14, 2);
    for (let x = 4; x <= 8; x++) {
      c.em.set(x, 2, 1, {
        roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
        isRamp: x === 4 || x === 8,
        rampAscendDirection: x === 4 ? RoadDirection.EAST : RoadDirection.WEST,
      });
    }

    const r = roadConnectivity(c.graph(), { x: 0, y: 2 }, { x: 14, y: 2 });

    expect(r.connected, '橋沒有被當成路').toBe(true);
  });

  it('should not invent a link where the bridge has no ramp', () => {
    // 同樣兩塊地，橋兩端沒有匝道 —— 下不來的橋不是通路。
    const c = city(20, 6);
    c.row(0, 4, 2);
    c.row(8, 14, 2);
    for (let x = 4; x <= 8; x++) {
      c.em.set(x, 2, 1, {
        roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0,
        isRamp: false, rampAscendDirection: 0,
      });
    }

    expect(roadConnectivity(c.graph(), { x: 0, y: 2 }, { x: 14, y: 2 }).connected).toBe(false);
  });

  it('should give the same answer in both directions', () => {
    const c = city(20, 6);
    c.row(0, 9, 2, RoadType.RURAL);
    c.row(9, 9, 2);
    const g = c.graph();

    const there = roadConnectivity(g, { x: 0, y: 2 }, { x: 9, y: 2 });
    const back = roadConnectivity(g, { x: 9, y: 2 }, { x: 0, y: 2 });

    expect(back).toEqual(there);
  });

  it('should say not connected when the city has no roads at all', () => {
    const c = city(20, 6);

    expect(roadConnectivity(c.graph(), { x: 1, y: 1 }, { x: 5, y: 5 }))
      .toEqual({ connected: false, cost: -1 });
  });
});

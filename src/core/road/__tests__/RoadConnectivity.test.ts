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
    // Each end attaches to a road within reach, so the cheapest route is x=2 to x=7: five
    // two-lane cells at 36. What is taken has to be the cheapest route rather than the last
    // target reached.
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
    // The point of BUG-368. Service coverage stops when its budget runs out, so its zero coverage
    // cannot distinguish disconnected from connected but too far. This has to.
    const c = city(60, 6);
    c.row(0, 49, 2, RoadType.RURAL); // rural is 60 per cell, so 49 cells is 2940

    const r = roadConnectivity(c.graph(), { x: 0, y: 2 }, { x: 49, y: 2 });

    expect(r.connected, '走到覆蓋預算就停了').toBe(true);
    expect(r.cost).toBeGreaterThan(ROAD_COVERAGE.BASE_COST);
  });

  it('should attach a building cell to a road within reach', () => {
    // Neither a home nor a workplace is a road cell: each attaches to a road within reach, the
    // same rule service coverage uses.
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
    // Two separate patches of ground, joined only by a viaduct.
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
    // The same two patches with no ramps at either end of the bridge: a bridge with no way down
    // is not a route.
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

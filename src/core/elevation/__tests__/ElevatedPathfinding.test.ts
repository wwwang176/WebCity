import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { ElevationManager } from '../ElevationManager';
import { findElevatedPath } from '../ElevatedPathfinding';

function makeGrid(size: number): Grid {
  return new Grid(size, size);
}

describe('findElevatedPath', () => {
  let grid: Grid;
  let em: ElevationManager;

  beforeEach(() => {
    grid = makeGrid(20);
    em = new ElevationManager();
  });

  it('finds path on ground-only network', () => {
    // Ground road from (0,0) to (5,0)
    for (let x = 0; x <= 5; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b1010 });
    }
    const path = findElevatedPath(grid, em, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(6);
  });

  it('finds path through elevated segment connected by ramps', () => {
    // Ground road at x=0..2 and x=8..10
    for (let x = 0; x <= 2; x++) grid.setCell(x, 5, { roadType: RoadType.HIGHWAY, roadFlags: 0b1010 });
    for (let x = 8; x <= 10; x++) grid.setCell(x, 5, { roadType: RoadType.HIGHWAY, roadFlags: 0b1010 });

    // Elevated bridge from x=2 to x=8 at level 1
    // x=2: ramp (connects ground ↔ elevated)
    em.set(2, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b1000, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });
    // x=3..7: elevated
    for (let x = 3; x <= 7; x++) {
      em.set(x, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b1010, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    }
    // x=8: ramp (connects elevated ↔ ground)
    em.set(8, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b0100, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0 });

    const path = findElevatedPath(grid, em, { x: 0, y: 5 }, { x: 10, y: 5 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    // Path should go through elevated nodes
    expect(path!.some(k => k.includes(',5,1'))).toBe(true);
  });

  it('returns null when no path exists', () => {
    grid.setCell(0, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b1000 });
    grid.setCell(10, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b0100 });
    // Disconnected — no path
    const path = findElevatedPath(grid, em, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(path).toBeNull();
  });

  it('prefers ground path when available (shorter)', () => {
    // Continuous ground road
    for (let x = 0; x <= 5; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b1010 });
    }
    const path = findElevatedPath(grid, em, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(path).not.toBeNull();
    // All ground nodes (no level suffix)
    expect(path!.every(k => !k.includes(',0,'))).toBe(true);
  });
});

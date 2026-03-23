import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { ElevationManager } from '../ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { LaneGraph } from '../../traffic/LaneGraph';
import { findElevatedPath } from '../ElevatedPathfinding';

// Flags: N=0b0001, S=0b0010, W=0b0100, E=0b1000
const EW = 0b1100; // East + West
const NS = 0b0011; // North + South

function makeGrid(size: number): Grid {
  return new Grid(size, size);
}

function buildLookupAndGraph(grid: Grid, em: ElevationManager) {
  const lookup = new UnifiedRoadLookup(grid, em);
  const lg = new LaneGraph();
  lg.buildFromGrid(lookup, lookup.getAllCellKeys());
  return { lookup, lg };
}

describe('findElevatedPath', () => {
  let grid: Grid;
  let em: ElevationManager;

  beforeEach(() => {
    grid = makeGrid(20);
    em = new ElevationManager();
  });

  it('finds path on ground-only network', () => {
    // Horizontal road (0,0)→(5,0): needs E+W flags, endpoints get one direction
    grid.setCell(0, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b1000 }); // E only
    for (let x = 1; x <= 4; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE, roadFlags: EW });
    }
    grid.setCell(5, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b0100 }); // W only
    const { lookup, lg } = buildLookupAndGraph(grid, em);
    const path = findElevatedPath(grid, lookup, { x: 0, y: 0 }, { x: 5, y: 0 }, 5000, lg);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(6);
  });

  it('finds path through elevated segment connected by ramps', () => {
    // Ground road at x=0..2 (E-W) and x=8..10 (E-W)
    grid.setCell(0, 5, { roadType: RoadType.HIGHWAY, roadFlags: 0b1000 }); // E
    grid.setCell(1, 5, { roadType: RoadType.HIGHWAY, roadFlags: EW });
    grid.setCell(2, 5, { roadType: RoadType.HIGHWAY, roadFlags: EW }); // also connects to ramp east
    grid.setCell(8, 5, { roadType: RoadType.HIGHWAY, roadFlags: EW }); // connects from ramp west
    grid.setCell(9, 5, { roadType: RoadType.HIGHWAY, roadFlags: EW });
    grid.setCell(10, 5, { roadType: RoadType.HIGHWAY, roadFlags: 0b0100 }); // W

    // Elevated bridge: ramp at x=3 (W+E flags), body x=4..7 (E+W), ramp at x=8 is tricky
    // Ramp at x=3: connects from ground(x=2) via W, to elevated(x=4) via E
    em.set(3, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0b1000 });
    for (let x = 4; x <= 6; x++) {
      em.set(x, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    }
    // Ramp at x=7: connects from elevated(x=6) via W, to ground(x=8) via E
    em.set(7, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: EW, railType: 0, railFlags: 0, isRamp: true, rampAscendDirection: 0b0100 });

    const { lookup, lg } = buildLookupAndGraph(grid, em);
    const path = findElevatedPath(grid, lookup, { x: 0, y: 5 }, { x: 10, y: 5 }, 5000, lg);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    expect(path!.some(k => k.includes(',5,1'))).toBe(true);
  });

  it('returns null when no path exists', () => {
    grid.setCell(0, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b1000 }); // E only
    grid.setCell(10, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b0100 }); // W only, disconnected
    const { lookup, lg } = buildLookupAndGraph(grid, em);
    const path = findElevatedPath(grid, lookup, { x: 0, y: 0 }, { x: 10, y: 0 }, 5000, lg);
    expect(path).toBeNull();
  });

  it('prefers ground path when available (shorter)', () => {
    grid.setCell(0, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b1000 });
    for (let x = 1; x <= 4; x++) {
      grid.setCell(x, 0, { roadType: RoadType.TWO_LANE, roadFlags: EW });
    }
    grid.setCell(5, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b0100 });
    const { lookup, lg } = buildLookupAndGraph(grid, em);
    const path = findElevatedPath(grid, lookup, { x: 0, y: 0 }, { x: 5, y: 0 }, 5000, lg);
    expect(path).not.toBeNull();
    expect(path!.every(k => !k.includes(',0,'))).toBe(true);
  });
});

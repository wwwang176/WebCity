import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import { validateElevatedPath } from '../ElevatedPathValidation';
import { getElevatedPath } from '../ElevatedPath';
import { ElevationManager } from '../ElevationManager';
import { RoadType } from '../../road/types';

function makeGrid(size: number): Grid {
  return new Grid(size, size);
}

function setWaterColumn(grid: Grid, x: number) {
  for (let y = 0; y < grid.height; y++) {
    grid.setCell(x, y, { terrainType: TerrainType.WATER });
  }
}

describe('validateElevatedPath', () => {
  let grid: Grid;
  let em: ElevationManager;

  beforeEach(() => {
    grid = makeGrid(20);
    em = new ElevationManager();
  });

  // --- Water crossing: no turns ---

  it('allows straight elevated path over water', () => {
    setWaterColumn(grid, 5);
    setWaterColumn(grid, 6);
    setWaterColumn(grid, 7);
    // Straight horizontal path at level 1 over water
    const path = getElevatedPath({ x: 2, y: 3 }, { x: 10, y: 3 }, 0, 1);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBeNull();
  });

  it('rejects L-shaped path that turns over water', () => {
    setWaterColumn(grid, 5);
    setWaterColumn(grid, 6);
    // L-shaped path: horizontal to x=6, then turns vertical — bend at x=6 which is water
    // from (3,3) to (6,6): horizontal 3→6, then vertical 3→6
    // Bend point at (6,3) which is water
    const path = getElevatedPath({ x: 3, y: 3 }, { x: 6, y: 6 }, 0, 1);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBe('WATER_CROSSING_NO_TURN');
  });

  it('allows L-shaped path where bend is NOT on water', () => {
    setWaterColumn(grid, 8);
    // L from (0,0) to (5,5): bend at (5,0) — no water there
    // Water at x=8 is not touched
    const path = getElevatedPath({ x: 0, y: 0 }, { x: 5, y: 5 }, 0, 1);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBeNull();
  });

  // --- Water at level 0 blocked ---

  it('rejects water cells at level 0', () => {
    setWaterColumn(grid, 5);
    // Flat path at level 0 crossing water
    const path = getElevatedPath({ x: 3, y: 3 }, { x: 7, y: 3 }, 0, 0);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBe('WATER_TILE');
  });

  // --- Ramp on water blocked ---

  it('rejects ramp cells on water', () => {
    // Water starts at x=1, ramp would be at x=0 (ok) but body enters water at level 1
    // Actually let's put water at x=0 where the ramp would be
    grid.setCell(0, 0, { terrainType: TerrainType.WATER });
    const path = getElevatedPath({ x: 0, y: 0 }, { x: 5, y: 0 }, 0, 1);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBe('RAMP_ON_WATER');
  });

  // --- Mountain blocked at all levels ---

  it('rejects mountain cells even at elevated level', () => {
    grid.setCell(3, 0, { terrainType: TerrainType.MOUNTAIN });
    const path = getElevatedPath({ x: 0, y: 0 }, { x: 5, y: 0 }, 0, 1);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBe('MOUNTAIN_TILE');
  });

  // --- Level collision ---

  it('rejects path that collides with existing elevated segment at same level', () => {
    em.set(3, 0, 1, { roadType: 1, roadFlags: 0b0101, railType: 0, railFlags: 0, isRamp: false });
    const path = getElevatedPath({ x: 0, y: 0 }, { x: 5, y: 0 }, 0, 1);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBe('LEVEL_OCCUPIED');
  });

  it('allows path at different level from existing elevated segment', () => {
    em.set(3, 0, 1, { roadType: 1, roadFlags: 0b0101, railType: 0, railFlags: 0, isRamp: false });
    const path = getElevatedPath({ x: 0, y: 0 }, { x: 5, y: 0 }, 0, 2);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBeNull();
  });

  // --- Out of bounds ---

  it('rejects path with out-of-bounds cells', () => {
    const path = getElevatedPath({ x: 18, y: 0 }, { x: 22, y: 0 }, 0, 1);
    expect(path).not.toBeNull();
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBe('OUT_OF_BOUNDS');
  });

  // --- Infrastructure on ground blocked ---

  it('allows elevated path over ground infrastructure (level > 0 flies over)', () => {
    // Set a power plant (infra building) at ground level
    // buildingId for power plant can be looked up, but for test just use a known infra id
    // Actually, elevated roads at level > 0 should fly over ground infra
    // The ramp cell (level 0) cannot be on infra though
    grid.setCell(4, 0, { roadType: RoadType.TWO_LANE, roadFlags: 0b1010 });
    const path = getElevatedPath({ x: 0, y: 0 }, { x: 7, y: 0 }, 0, 1);
    expect(path).not.toBeNull();
    // Ramp at x=0 (plain ground), elevated at x=1..7 — x=4 has ground road, elevated flies over
    const error = validateElevatedPath(grid, em, path!);
    expect(error).toBeNull();
  });
});

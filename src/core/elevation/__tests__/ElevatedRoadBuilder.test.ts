import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import { RoadNetwork } from '../../road/RoadNetwork';
import { ElevationManager } from '../ElevationManager';
import { ElevatedRoadBuilder } from '../ElevatedRoadBuilder';
import { ELEVATION_COST } from '../types';

function makeGrid(size: number): Grid {
  return new Grid(size, size);
}

function setWaterColumn(grid: Grid, x: number) {
  for (let y = 0; y < grid.height; y++) {
    grid.setCell(x, y, { terrainType: TerrainType.WATER });
  }
}

function placeGroundRoad(grid: Grid, x: number, y: number, roadType = RoadType.HIGHWAY) {
  grid.setCell(x, y, { roadType, roadFlags: 0b1010 }); // E-W
}

describe('ElevatedRoadBuilder', () => {
  let grid: Grid;
  let network: RoadNetwork;
  let em: ElevationManager;
  let builder: ElevatedRoadBuilder;

  beforeEach(() => {
    grid = makeGrid(20);
    network = new RoadNetwork();
    em = new ElevationManager();
    builder = new ElevatedRoadBuilder(grid, em, network);
  });

  // --- Basic elevated road ---

  it('builds elevated road from ground road start', () => {
    placeGroundRoad(grid, 2, 5);
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 8, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(true);
    expect(result.cost).toBeGreaterThan(0);
    // Origin (2,5) stays ground — no elevated segment stored
    // Ramp starts at (3,5)
    expect(em.get(3, 5, 1)?.isRamp).toBe(true);
    // Middle cells are elevated
    expect(em.get(5, 5, 1)).not.toBeNull();
    expect(em.get(5, 5, 1)?.roadType).toBe(RoadType.HIGHWAY);
    expect(em.get(5, 5, 1)?.isRamp).toBe(false);
  });

  // --- Start point validation ---

  it('rejects start on empty ground (no road)', () => {
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 8, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('START_NOT_ON_ROAD');
  });

  it('allows start on existing elevated segment', () => {
    placeGroundRoad(grid, 0, 5);
    // First build an elevated segment
    builder.buildElevatedRoad({ x: 0, y: 5 }, { x: 5, y: 5 }, RoadType.HIGHWAY, 100000, 1);
    // Now extend from the elevated end
    const result = builder.buildElevatedRoad(
      { x: 5, y: 5 }, { x: 10, y: 5 },
      RoadType.HIGHWAY, 100000, 1, // same level, no ramp needed
    );
    expect(result.success).toBe(true);
  });

  // --- End point auto-ramp ---

  it('auto-generates end ramp when endpoint is ground road', () => {
    placeGroundRoad(grid, 2, 5);
    placeGroundRoad(grid, 10, 5);
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 10, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(true);
    // End ramp should exist near x=10
    expect(em.get(9, 5, 1)?.isRamp).toBe(true);
  });

  it('leaves end hanging when endpoint is empty', () => {
    placeGroundRoad(grid, 2, 5);
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 8, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(true);
    // Last cell should be elevated, not ramp (no ground road to connect to)
    expect(em.get(8, 5, 1)).not.toBeNull();
    expect(em.get(8, 5, 1)?.isRamp).toBe(false);
  });

  // --- Cost calculation ---

  it('charges elevated cost multiplier', () => {
    placeGroundRoad(grid, 2, 5);
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 6, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(true);
    const baseCost = ROAD_CONFIGS[RoadType.HIGHWAY].cost;
    // 5 cells: [2]=origin(free) [3]=ramp(×1.5) [4]=elevated(×2) [5]=elevated(×2) [6]=elevated(×2)
    const expectedCost = baseCost * ELEVATION_COST.RAMP + 3 * baseCost * ELEVATION_COST.ELEVATED;
    expect(result.cost).toBe(expectedCost);
  });

  it('charges bridge multiplier over water', () => {
    placeGroundRoad(grid, 2, 5);
    setWaterColumn(grid, 5);
    setWaterColumn(grid, 6);
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 9, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(true);
    const baseCost = ROAD_CONFIGS[RoadType.HIGHWAY].cost;
    // [2]=origin(free), [3]=ramp, [4]=elevated, [5]=bridge, [6]=bridge, [7]=elevated, [8]=elevated, [9]=elevated
    const expected =
      baseCost * ELEVATION_COST.RAMP +       // [3] ramp
      baseCost * ELEVATION_COST.ELEVATED * 1 + // [4] elevated
      baseCost * ELEVATION_COST.BRIDGE * 2 +   // [5,6] bridge
      baseCost * ELEVATION_COST.ELEVATED * 3;  // [7,8,9] elevated
    expect(result.cost).toBe(expected);
  });

  it('rejects when insufficient funds', () => {
    placeGroundRoad(grid, 2, 5);
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 8, y: 5 },
      RoadType.HIGHWAY, 1, 1,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');
  });

  // --- Water crossing ---

  it('allows straight bridge over water', () => {
    placeGroundRoad(grid, 2, 5);
    setWaterColumn(grid, 5);
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 8, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(true);
  });

  it('rejects L-shaped path turning over water', () => {
    placeGroundRoad(grid, 2, 5);
    setWaterColumn(grid, 6);
    // L-shape: from (2,5) to (6,8) — bend at (6,5) which is water
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 6, y: 8 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('WATER_CROSSING_NO_TURN');
  });

  // --- Demolish elevated ---

  it('removes highest level first', () => {
    placeGroundRoad(grid, 0, 5);
    // Build level 1
    builder.buildElevatedRoad({ x: 0, y: 5 }, { x: 5, y: 5 }, RoadType.HIGHWAY, 100000, 1);
    expect(em.get(3, 5, 1)).not.toBeNull();

    builder.removeElevated(3, 5);
    expect(em.get(3, 5, 1)).toBeNull();
  });

  it('removes higher level before lower level', () => {
    // Manually set up two levels
    em.set(3, 5, 1, { roadType: RoadType.HIGHWAY, roadFlags: 0b1010, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });
    em.set(3, 5, 2, { roadType: RoadType.HIGHWAY, roadFlags: 0b0101, railType: 0, railFlags: 0, isRamp: false, rampAscendDirection: 0 });

    builder.removeElevated(3, 5);
    // Level 2 removed, level 1 remains
    expect(em.get(3, 5, 2)).toBeNull();
    expect(em.get(3, 5, 1)).not.toBeNull();
  });

  // --- Network integration ---

  it('adds elevated edges to network with level suffix', () => {
    placeGroundRoad(grid, 2, 5);
    builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 6, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    // Ramp at (3,5) and elevated at (4,5), (5,5), (6,5)
    expect(network.hasNode('3,5,1')).toBe(true);
    expect(network.hasNode('4,5,1')).toBe(true);
    expect(network.hasNode('5,5,1')).toBe(true);
  });

  // --- Path too short ---

  it('rejects when path too short for ramps', () => {
    placeGroundRoad(grid, 2, 5);
    // Single cell path — can't fit a ramp
    const result = builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 2, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('PATH_TOO_SHORT');
  });

  // --- High架 under blocking zone ---

  it('blocks zone placement under elevated road', () => {
    placeGroundRoad(grid, 2, 5);
    builder.buildElevatedRoad(
      { x: 2, y: 5 }, { x: 8, y: 5 },
      RoadType.HIGHWAY, 100000, 1,
    );
    // hasElevatedSegment should be true for cells under the elevated road
    expect(em.hasElevatedSegment(5, 5)).toBe(true);
  });
});

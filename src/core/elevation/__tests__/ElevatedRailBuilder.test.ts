import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { RailType, RAIL } from '../../rail/types';
import { RailNetwork } from '../../rail/RailNetwork';
import { ElevationManager } from '../ElevationManager';
import { ElevatedRailBuilder } from '../ElevatedRailBuilder';
import { ELEVATION_COST } from '../types';

function makeGrid(size: number): Grid {
  return new Grid(size, size);
}

function setWaterColumn(grid: Grid, x: number) {
  for (let y = 0; y < grid.height; y++) {
    grid.setCell(x, y, { terrainType: TerrainType.WATER });
  }
}

function placeGroundRail(grid: Grid, x: number, y: number) {
  grid.setCell(x, y, { railType: RailType.STANDARD, railFlags: 0b1010 });
}

function placeGroundRoad(grid: Grid, x: number, y: number) {
  grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: 0b1010 });
}

describe('ElevatedRailBuilder', () => {
  let grid: Grid;
  let network: RailNetwork;
  let em: ElevationManager;
  let builder: ElevatedRailBuilder;

  beforeEach(() => {
    grid = makeGrid(20);
    network = new RailNetwork();
    em = new ElevationManager();
    builder = new ElevatedRailBuilder(grid, em, network);
  });

  it('builds elevated rail from ground rail start', () => {
    placeGroundRail(grid, 2, 5);
    const result = builder.buildElevatedTrack(
      { x: 2, y: 5 }, { x: 8, y: 5 }, 100000, 1,
    );
    expect(result.success).toBe(true);
    expect(result.cost).toBeGreaterThan(0);
    expect(em.get(5, 5, 1)?.railType).toBe(RailType.STANDARD);
  });

  it('also allows start on ground road (rail can coexist with road)', () => {
    placeGroundRoad(grid, 2, 5);
    const result = builder.buildElevatedTrack(
      { x: 2, y: 5 }, { x: 8, y: 5 }, 100000, 1,
    );
    expect(result.success).toBe(true);
  });

  it('rejects start on empty ground', () => {
    const result = builder.buildElevatedTrack(
      { x: 2, y: 5 }, { x: 8, y: 5 }, 100000, 1,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('START_NOT_ON_ROAD');
  });

  it('charges elevated rail cost', () => {
    placeGroundRail(grid, 2, 5);
    const result = builder.buildElevatedTrack(
      { x: 2, y: 5 }, { x: 6, y: 5 }, 100000, 1,
    );
    expect(result.success).toBe(true);
    const base = RAIL.COST_PER_CELL;
    // [2]=origin(free) [3]=ramp [4]=elevated [5]=elevated [6]=elevated
    const expected = base * ELEVATION_COST.RAMP + 3 * base * ELEVATION_COST.ELEVATED;
    expect(result.cost).toBe(expected);
  });

  it('charges bridge multiplier for rail over water', () => {
    placeGroundRail(grid, 2, 5);
    setWaterColumn(grid, 5);
    const result = builder.buildElevatedTrack(
      { x: 2, y: 5 }, { x: 8, y: 5 }, 100000, 1,
    );
    expect(result.success).toBe(true);
    // Verify bridge cost applied
    const base = RAIL.COST_PER_CELL;
    const expectedBridgePortion = base * ELEVATION_COST.BRIDGE; // 1 water cell
    expect(result.cost!).toBeGreaterThanOrEqual(expectedBridgePortion);
  });

  it('auto-generates end ramp when endpoint has ground rail', () => {
    placeGroundRail(grid, 2, 5);
    placeGroundRail(grid, 8, 5);
    const result = builder.buildElevatedTrack(
      { x: 2, y: 5 }, { x: 8, y: 5 }, 100000, 1,
    );
    expect(result.success).toBe(true);
    // End ramp near x=8
    expect(em.get(7, 5, 1)?.isRamp).toBe(true);
  });

  it('removes highest rail level first', () => {
    em.set(5, 5, 1, { roadType: 0, roadFlags: 0, railType: RailType.STANDARD, railFlags: 0b1010, isRamp: false, rampAscendDirection: 0 });
    em.set(5, 5, 2, { roadType: 0, roadFlags: 0, railType: RailType.STANDARD, railFlags: 0b0101, isRamp: false, rampAscendDirection: 0 });
    builder.removeElevated(5, 5);
    expect(em.get(5, 5, 2)).toBeNull();
    expect(em.get(5, 5, 1)).not.toBeNull();
  });
});

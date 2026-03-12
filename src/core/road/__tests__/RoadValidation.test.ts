import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import { RoadType, ROAD_CONFIGS } from '../types';
import { validateRoadPath, calculateRoadCost } from '../RoadValidation';
import { RailType } from '../../rail/types';

describe('validateRoadPath', () => {
  it('returns null for a valid path on grass terrain', () => {
    const grid = new Grid(10, 10);
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    expect(validateRoadPath(grid, cells)).toBeNull();
  });

  it('returns OUT_OF_BOUNDS when cell is outside grid', () => {
    const grid = new Grid(5, 5);
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }]; // y=5 is out of 5x5 grid
    expect(validateRoadPath(grid, cells)).toBe('OUT_OF_BOUNDS');
  });

  it('returns WATER_TILE for water terrain', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 5, { terrainType: TerrainType.WATER });
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    expect(validateRoadPath(grid, cells)).toBe('WATER_TILE');
  });

  it('returns MOUNTAIN_TILE for mountain terrain', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 5, { terrainType: TerrainType.MOUNTAIN });
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    expect(validateRoadPath(grid, cells)).toBe('MOUNTAIN_TILE');
  });

  it('returns INFRASTRUCTURE_EXISTS for infrastructure buildings', () => {
    const grid = new Grid(10, 10);
    grid.setCell(3, 5, { buildingId: 252 }); // Police station
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    expect(validateRoadPath(grid, cells)).toBe('INFRASTRUCTURE_EXISTS');
  });

  it('returns PARALLEL_RAIL when road would be parallel to existing rail', () => {
    const grid = new Grid(10, 10);
    // Rail going E-W on cell (3,5)
    grid.setCell(3, 5, { railType: 1, railFlags: 0b1100 });
    // Road going E-W through (2,5)→(4,5)
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    expect(validateRoadPath(grid, cells)).toBe('PARALLEL_RAIL');
  });

  it('returns null when road is perpendicular to rail', () => {
    const grid = new Grid(10, 10);
    // Rail going N-S on cell (5,4)
    grid.setCell(5, 4, { railType: 1, railFlags: 0b0011 });
    // Road going E-W through (4,4)→(6,4)
    const cells = [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }];
    expect(validateRoadPath(grid, cells)).toBeNull();
  });
});

describe('calculateRoadCost', () => {
  it('returns full cost for new cells', () => {
    const grid = new Grid(10, 10);
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    const cost = calculateRoadCost(grid, cells, RoadType.TWO_LANE);
    expect(cost).toBe(3 * ROAD_CONFIGS[RoadType.TWO_LANE].cost);
  });

  it('returns differential cost when upgrading existing road', () => {
    const grid = new Grid(10, 10);
    grid.setCell(2, 5, { roadType: RoadType.TWO_LANE });
    grid.setCell(3, 5, { roadType: RoadType.TWO_LANE });
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }];
    const cost = calculateRoadCost(grid, cells, RoadType.FOUR_LANE);
    expect(cost).toBe(2 * (ROAD_CONFIGS[RoadType.FOUR_LANE].cost - ROAD_CONFIGS[RoadType.TWO_LANE].cost));
  });

  it('returns zero when building same road type over existing', () => {
    const grid = new Grid(10, 10);
    grid.setCell(2, 5, { roadType: RoadType.TWO_LANE });
    const cells = [{ x: 2, y: 5 }];
    const cost = calculateRoadCost(grid, cells, RoadType.TWO_LANE);
    expect(cost).toBe(0);
  });

  it('handles mixed new + existing cells', () => {
    const grid = new Grid(10, 10);
    grid.setCell(2, 5, { roadType: RoadType.TWO_LANE });
    // cell (2,5) has existing road, cell (3,5) is new
    const cells = [{ x: 2, y: 5 }, { x: 3, y: 5 }];
    const cost = calculateRoadCost(grid, cells, RoadType.FOUR_LANE);
    const diff = ROAD_CONFIGS[RoadType.FOUR_LANE].cost - ROAD_CONFIGS[RoadType.TWO_LANE].cost;
    const full = ROAD_CONFIGS[RoadType.FOUR_LANE].cost;
    expect(cost).toBe(diff + full);
  });
});

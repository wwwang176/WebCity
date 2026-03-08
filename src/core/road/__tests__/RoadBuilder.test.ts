import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType, ZoneType } from '../../grid/types';
import { RoadBuilder } from '../RoadBuilder';
import { RoadNetwork } from '../RoadNetwork';
import { RoadType, RoadDirection, ROAD_CONFIGS } from '../types';

describe('RoadBuilder', () => {
  it('should build a horizontal road between two points', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    for (let x = 2; x <= 6; x++) {
      const cell = grid.getCell(x, 5);
      expect(cell!.roadType).toBe(RoadType.TWO_LANE);
    }
  });

  it('should set correct road flags for middle cells', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    const cell = grid.getCell(3, 5);
    expect(cell!.roadFlags & RoadDirection.EAST).toBeTruthy();
    expect(cell!.roadFlags & RoadDirection.WEST).toBeTruthy();
  });

  it('should set correct road flags for start endpoint', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    const cell = grid.getCell(2, 5);
    expect(cell!.roadFlags & RoadDirection.EAST).toBeTruthy();
    expect(cell!.roadFlags & RoadDirection.WEST).toBeFalsy();
  });

  it('should set correct road flags for end endpoint', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    const cell = grid.getCell(6, 5);
    expect(cell!.roadFlags & RoadDirection.WEST).toBeTruthy();
    expect(cell!.roadFlags & RoadDirection.EAST).toBeFalsy();
  });

  it('should have correct properties for TWO_LANE road', () => {
    const config = ROAD_CONFIGS[RoadType.TWO_LANE];
    expect(config.lanes).toBe(2);
    expect(config.speedLimit).toBe(50);
  });

  it('should have correct properties for SIX_LANE road', () => {
    const config = ROAD_CONFIGS[RoadType.SIX_LANE];
    expect(config.lanes).toBe(6);
    expect(config.speedLimit).toBe(60);
  });

  it('should fail to build road on water', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { terrainType: TerrainType.WATER });
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('WATER_TILE');
  });

  it('should fail when insufficient funds', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');
  });

  it('should deduct correct cost on success', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    // 5 cells * 200 cost = 1000
    expect(result.cost).toBe(5 * ROAD_CONFIGS[RoadType.TWO_LANE].cost);
  });

  it('should build a vertical road', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 5, y: 2 }, { x: 5, y: 6 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    const cell = grid.getCell(5, 4);
    expect(cell!.roadFlags & RoadDirection.NORTH).toBeTruthy();
    expect(cell!.roadFlags & RoadDirection.SOUTH).toBeTruthy();
  });

  // --- Road types ---

  it('should build RURAL road with correct type and cost', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 0, y: 3 }, { x: 4, y: 3 }, RoadType.RURAL, 10000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(5 * ROAD_CONFIGS[RoadType.RURAL].cost);
    expect(grid.getCell(2, 3)!.roadType).toBe(RoadType.RURAL);
  });

  it('should build FOUR_LANE road with correct type and cost', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 0, y: 3 }, { x: 4, y: 3 }, RoadType.FOUR_LANE, 10000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(5 * ROAD_CONFIGS[RoadType.FOUR_LANE].cost);
    expect(grid.getCell(2, 3)!.roadType).toBe(RoadType.FOUR_LANE);
  });

  it('should have correct config for all road types', () => {
    expect(ROAD_CONFIGS[RoadType.RURAL].cost).toBe(100);
    expect(ROAD_CONFIGS[RoadType.RURAL].lanes).toBe(2);
    expect(ROAD_CONFIGS[RoadType.RURAL].maxDensity).toBe('LOW');

    expect(ROAD_CONFIGS[RoadType.TWO_LANE].cost).toBe(200);
    expect(ROAD_CONFIGS[RoadType.FOUR_LANE].cost).toBe(400);
    expect(ROAD_CONFIGS[RoadType.FOUR_LANE].lanes).toBe(4);
    expect(ROAD_CONFIGS[RoadType.FOUR_LANE].maxDensity).toBe('HIGH');

    expect(ROAD_CONFIGS[RoadType.HIGHWAY].cost).toBe(800);
    expect(ROAD_CONFIGS[RoadType.HIGHWAY].speedLimit).toBe(100);
    expect(ROAD_CONFIGS[RoadType.HIGHWAY].maxDensity).toBe('NONE');
  });

  // --- L-shaped path ---

  it('should build an L-shaped path (horizontal then vertical)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 2 }, { x: 5, y: 5 }, RoadType.TWO_LANE, 100000);

    expect(result.success).toBe(true);

    // Horizontal segment: (2,2) → (5,2)
    for (let x = 2; x <= 5; x++) {
      expect(grid.getCell(x, 2)!.roadType).toBe(RoadType.TWO_LANE);
    }
    // Vertical segment: (5,3) → (5,5)
    for (let y = 3; y <= 5; y++) {
      expect(grid.getCell(5, y)!.roadType).toBe(RoadType.TWO_LANE);
    }
    // Corner cell (5,2) should have both E-W and N-S flags
    const corner = grid.getCell(5, 2)!;
    expect(corner.roadFlags & RoadDirection.WEST).toBeTruthy();
    expect(corner.roadFlags & RoadDirection.SOUTH).toBeTruthy();
  });

  it('should calculate correct cost for L-shaped path', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    // From (2,2) to (5,5): horiz 2→5 = 4 cells, vert 3→5 = 3 cells → total 7
    const result = builder.buildRoad({ x: 2, y: 2 }, { x: 5, y: 5 }, RoadType.TWO_LANE, 100000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(7 * ROAD_CONFIGS[RoadType.TWO_LANE].cost);
  });

  // --- Flag merging ---

  it('should merge flags when building crossing roads', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 3 }, { x: 5, y: 7 }, RoadType.TWO_LANE, 100000);

    const center = grid.getCell(5, 5)!;
    expect(center.roadFlags & RoadDirection.NORTH).toBeTruthy();
    expect(center.roadFlags & RoadDirection.SOUTH).toBeTruthy();
    expect(center.roadFlags & RoadDirection.EAST).toBeTruthy();
    expect(center.roadFlags & RoadDirection.WEST).toBeTruthy();
  });

  it('should overwrite roadType when building different type over existing', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 3, y: 5 }, { x: 7, y: 5 }, RoadType.TWO_LANE, 100000);
    builder.buildRoad({ x: 5, y: 3 }, { x: 5, y: 7 }, RoadType.FOUR_LANE, 100000);

    // Intersection cell takes the type of the last road built
    const center = grid.getCell(5, 5)!;
    expect(center.roadType).toBe(RoadType.FOUR_LANE);
  });

  // --- Terrain blocking ---

  it('should fail to build road on mountain', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { terrainType: TerrainType.MOUNTAIN });
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('MOUNTAIN_TILE');
  });

  it('should fail to build road over power plant (buildingId 254)', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { buildingId: 254 });
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INFRASTRUCTURE_EXISTS');
  });

  it('should fail to build road over water plant (buildingId 253)', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { buildingId: 253 });
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INFRASTRUCTURE_EXISTS');
  });

  // --- Zone/building clearing ---

  it('should clear zoned buildings when building road over them', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    const cell = grid.getCell(4, 5)!;
    expect(cell.zoneType).toBe(ZoneType.NONE);
    expect(cell.buildingId).toBe(0);
    expect(cell.roadType).toBe(RoadType.TWO_LANE);
  });

  // --- Road removal ---

  it('should clear road data on removal', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    builder.removeRoad(4, 5);
    const cell = grid.getCell(4, 5)!;
    expect(cell.roadType).toBe(RoadType.NONE);
    expect(cell.roadFlags).toBe(0);
  });

  it('should update neighbor flags when road removed', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 10000);

    // Before removal, cell (3,5) has EAST flag
    expect(grid.getCell(3, 5)!.roadFlags & RoadDirection.EAST).toBeTruthy();

    builder.removeRoad(4, 5);

    // After removal, cell (3,5) should lose EAST flag and cell (5,5) should lose WEST flag
    expect(grid.getCell(3, 5)!.roadFlags & RoadDirection.EAST).toBeFalsy();
    expect(grid.getCell(5, 5)!.roadFlags & RoadDirection.WEST).toBeFalsy();
  });

  it('should do nothing when removing non-road cell', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    // Should not throw
    builder.removeRoad(5, 5);
    expect(grid.getCell(5, 5)!.roadType).toBe(RoadType.NONE);
  });

  // --- Single cell road ---

  it('should build a single-cell road (from === to)', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 5, y: 5 }, { x: 5, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(ROAD_CONFIGS[RoadType.TWO_LANE].cost);
    expect(grid.getCell(5, 5)!.roadType).toBe(RoadType.TWO_LANE);
    // Single cell has no directional flags
    expect(grid.getCell(5, 5)!.roadFlags).toBe(0);
  });

  // --- Network integration ---

  it('should add nodes and edges to network when provided', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.RURAL, 10000);

    expect(network.getNodeCount()).toBe(5);
    expect(network.getEdgeCount()).toBe(4);
    expect(network.isConnected('2,5', '6,5')).toBe(true);
  });

  it('should remove node from network when road removed', () => {
    const grid = new Grid(20, 20);
    const network = new RoadNetwork();
    const builder = new RoadBuilder(grid, network);
    builder.buildRoad({ x: 2, y: 5 }, { x: 6, y: 5 }, RoadType.TWO_LANE, 100000);

    builder.removeRoad(4, 5);
    expect(network.isConnected('2,5', '6,5')).toBe(false);
  });

  // --- Out of bounds ---

  it('should fail when road goes out of bounds', () => {
    const grid = new Grid(10, 10);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 8, y: 5 }, { x: 12, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('OUT_OF_BOUNDS');
  });
});

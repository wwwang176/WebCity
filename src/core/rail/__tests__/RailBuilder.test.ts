import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType, ZoneType } from '../../grid/types';
import { RailBuilder } from '../RailBuilder';
import { RailNetwork } from '../RailNetwork';
import { RailType, TrackDirection, RAIL_COST } from '../types';

describe('RailBuilder', () => {
  // --- Basic track building ---

  it('should build a horizontal track between two points', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(result.success).toBe(true);
    for (let x = 2; x <= 6; x++) {
      const cell = grid.getCell(x, 5);
      expect(cell!.railType).toBe(RailType.STANDARD);
    }
  });

  it('should build a vertical track', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 5, y: 2 }, { x: 5, y: 6 }, 10000);

    expect(result.success).toBe(true);
    const cell = grid.getCell(5, 4);
    expect(cell!.railFlags & TrackDirection.NORTH).toBeTruthy();
    expect(cell!.railFlags & TrackDirection.SOUTH).toBeTruthy();
  });

  // --- Direction flags ---

  it('should set correct flags for middle cells', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    const cell = grid.getCell(3, 5);
    expect(cell!.railFlags & TrackDirection.EAST).toBeTruthy();
    expect(cell!.railFlags & TrackDirection.WEST).toBeTruthy();
  });

  it('should set correct flags for start endpoint', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    const cell = grid.getCell(2, 5);
    expect(cell!.railFlags & TrackDirection.EAST).toBeTruthy();
    expect(cell!.railFlags & TrackDirection.WEST).toBeFalsy();
  });

  it('should set correct flags for end endpoint', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    const cell = grid.getCell(6, 5);
    expect(cell!.railFlags & TrackDirection.WEST).toBeTruthy();
    expect(cell!.railFlags & TrackDirection.EAST).toBeFalsy();
  });

  // --- Cost ---

  it('should deduct correct cost', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(5 * RAIL_COST);
  });

  it('should charge zero for building over existing track', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);
    expect(result.success).toBe(true);
    expect(result.cost).toBe(0);
  });

  it('should fail when insufficient funds', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');
  });

  // --- Terrain blocking ---

  it('should fail to build track on water', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { terrainType: TerrainType.WATER });
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('WATER_TILE');
  });

  it('should fail to build track on mountain', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { terrainType: TerrainType.MOUNTAIN });
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('MOUNTAIN_TILE');
  });

  it('should fail to build track over power plant', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { buildingId: 254 });
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INFRASTRUCTURE_EXISTS');
  });

  it('should fail when track goes out of bounds', () => {
    const grid = new Grid(10, 10);
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 8, y: 5 }, { x: 12, y: 5 }, 10000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('OUT_OF_BOUNDS');
  });

  // --- L-shaped path ---

  it('should build an L-shaped track', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 2 }, { x: 5, y: 5 }, 100000);

    expect(result.success).toBe(true);

    // Horizontal: (2,2) → (5,2)
    for (let x = 2; x <= 5; x++) {
      expect(grid.getCell(x, 2)!.railType).toBe(RailType.STANDARD);
    }
    // Vertical: (5,3) → (5,5)
    for (let y = 3; y <= 5; y++) {
      expect(grid.getCell(5, y)!.railType).toBe(RailType.STANDARD);
    }
    // Corner cell (5,2) should have WEST + SOUTH
    const corner = grid.getCell(5, 2)!;
    expect(corner.railFlags & TrackDirection.WEST).toBeTruthy();
    expect(corner.railFlags & TrackDirection.SOUTH).toBeTruthy();
  });

  // --- Flag merging (junctions) ---

  it('should merge flags when building crossing tracks', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 3, y: 5 }, { x: 7, y: 5 }, 100000);
    builder.buildTrack({ x: 5, y: 3 }, { x: 5, y: 7 }, 100000);

    const center = grid.getCell(5, 5)!;
    expect(center.railFlags & TrackDirection.NORTH).toBeTruthy();
    expect(center.railFlags & TrackDirection.SOUTH).toBeTruthy();
    expect(center.railFlags & TrackDirection.EAST).toBeTruthy();
    expect(center.railFlags & TrackDirection.WEST).toBeTruthy();
  });

  // --- Level crossing (track + road coexistence) ---

  it('should allow track on a cell that already has a road (level crossing)', () => {
    const grid = new Grid(20, 20);
    // Place a road first
    grid.setCell(4, 5, { roadType: 2, roadFlags: 0b0011 }); // TWO_LANE, N+S

    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 3, y: 5 }, { x: 5, y: 5 }, 10000);

    expect(result.success).toBe(true);
    const cell = grid.getCell(4, 5)!;
    // Both road and rail should coexist
    expect(cell.roadType).toBe(2);
    expect(cell.railType).toBe(RailType.STANDARD);
  });

  it('should NOT clear road or buildings when building track over road cell', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { roadType: 2, roadFlags: 0b0011 });

    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 3, y: 5 }, { x: 5, y: 5 }, 10000);

    const cell = grid.getCell(4, 5)!;
    expect(cell.roadType).toBe(2);
    expect(cell.roadFlags).toBe(0b0011);
  });

  // --- Zone clearing ---

  it('should clear zoned buildings when building track over empty cell', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(result.success).toBe(true);
    const cell = grid.getCell(4, 5)!;
    expect(cell.zoneType).toBe(ZoneType.NONE);
    expect(cell.buildingId).toBe(0);
    expect(cell.railType).toBe(RailType.STANDARD);
  });

  // --- Track removal ---

  it('should clear rail data on removal', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    builder.removeTrack(4, 5);
    const cell = grid.getCell(4, 5)!;
    expect(cell.railType).toBe(RailType.NONE);
    expect(cell.railFlags).toBe(0);
  });

  it('should update neighbor flags when track removed', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(grid.getCell(3, 5)!.railFlags & TrackDirection.EAST).toBeTruthy();

    builder.removeTrack(4, 5);

    expect(grid.getCell(3, 5)!.railFlags & TrackDirection.EAST).toBeFalsy();
    expect(grid.getCell(5, 5)!.railFlags & TrackDirection.WEST).toBeFalsy();
  });

  it('should preserve road data when removing track from level crossing', () => {
    const grid = new Grid(20, 20);
    grid.setCell(4, 5, { roadType: 2, roadFlags: 0b1001 });

    const builder = new RailBuilder(grid);
    builder.buildTrack({ x: 3, y: 5 }, { x: 5, y: 5 }, 10000);
    builder.removeTrack(4, 5);

    const cell = grid.getCell(4, 5)!;
    expect(cell.railType).toBe(RailType.NONE);
    expect(cell.roadType).toBe(2); // road preserved
    expect(cell.roadFlags).toBe(0b1001);
  });

  it('should do nothing when removing non-track cell', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    builder.removeTrack(5, 5);
    expect(grid.getCell(5, 5)!.railType).toBe(RailType.NONE);
  });

  // --- Single cell track ---

  it('should build a single-cell track (from === to)', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    const result = builder.buildTrack({ x: 5, y: 5 }, { x: 5, y: 5 }, 10000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(RAIL_COST);
    expect(grid.getCell(5, 5)!.railType).toBe(RailType.STANDARD);
    expect(grid.getCell(5, 5)!.railFlags).toBe(0);
  });

  // --- Network integration ---

  it('should add edges to network when provided', () => {
    const grid = new Grid(20, 20);
    const network = new RailNetwork();
    const builder = new RailBuilder(grid, network);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 10000);

    expect(network.getNodeCount()).toBe(5);
    expect(network.getEdgeCount()).toBe(4);
    expect(network.isConnected('2,5', '6,5')).toBe(true);
  });

  it('should remove node from network when track removed', () => {
    const grid = new Grid(20, 20);
    const network = new RailNetwork();
    const builder = new RailBuilder(grid, network);
    builder.buildTrack({ x: 2, y: 5 }, { x: 6, y: 5 }, 100000);

    builder.removeTrack(4, 5);
    expect(network.isConnected('2,5', '6,5')).toBe(false);
  });

  // --- Station placement validation ---

  it('station must be on track cell', () => {
    const grid = new Grid(20, 20);
    const builder = new RailBuilder(grid);
    // No track at (5,5)
    expect(grid.getCell(5, 5)!.railType).toBe(RailType.NONE);

    // Build track
    builder.buildTrack({ x: 3, y: 5 }, { x: 7, y: 5 }, 10000);
    expect(grid.getCell(5, 5)!.railType).toBe(RailType.STANDARD);
  });
});

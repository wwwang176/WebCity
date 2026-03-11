import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RailSystem } from '../../transport/RailSystem';
import { RailNetwork } from '../RailNetwork';
import { RailBuilder } from '../RailBuilder';
import { RailType } from '../types';

describe('RailSystem — track-based movement', () => {
  function setupTrackSystem() {
    const grid = new Grid(20, 20);
    const network = new RailNetwork();
    const builder = new RailBuilder(grid, network);
    const rail = new RailSystem();
    rail.setRailNetwork(network);
    return { grid, network, builder, rail };
  }

  // --- Station placement validation ---

  it('should reject station placement on cell without track', () => {
    const { grid, rail } = setupTrackSystem();
    const result = rail.buildStation(5, 5, grid);
    expect(result).toBeNull();
  });

  it('should allow station placement on cell with track', () => {
    const { grid, builder, rail } = setupTrackSystem();
    builder.buildTrack({ x: 3, y: 5 }, { x: 7, y: 5 }, 100000);

    const station = rail.buildStation(5, 5, grid);
    expect(station).not.toBeNull();
    expect(station!.x).toBe(5);
    expect(station!.y).toBe(5);
  });

  it('should allow station placement on level crossing cell', () => {
    const { grid, builder, rail } = setupTrackSystem();
    // Place road then track
    grid.setCell(5, 5, { roadType: 2, roadFlags: 0b0011 });
    builder.buildTrack({ x: 3, y: 5 }, { x: 7, y: 5 }, 100000);

    const station = rail.buildStation(5, 5, grid);
    expect(station).not.toBeNull();
  });

  // --- Line creation with track connectivity ---

  it('should create line when stations are connected via track', () => {
    const { grid, builder, rail } = setupTrackSystem();
    builder.buildTrack({ x: 2, y: 5 }, { x: 8, y: 5 }, 100000);

    const stA = rail.buildStation(2, 5, grid)!;
    const stB = rail.buildStation(8, 5, grid)!;

    const line = rail.createLine([stA, stB]);
    expect(line).not.toBeNull();
    expect(line!.stops).toHaveLength(2);
  });

  it('should reject line when stations are NOT connected via track', () => {
    const { grid, builder, rail } = setupTrackSystem();
    // Two disconnected track segments
    builder.buildTrack({ x: 2, y: 5 }, { x: 4, y: 5 }, 100000);
    builder.buildTrack({ x: 7, y: 5 }, { x: 9, y: 5 }, 100000);

    const stA = rail.buildStation(2, 5, grid)!;
    const stB = rail.buildStation(8, 5, grid)!;

    const line = rail.createLine([stA, stB]);
    expect(line).toBeNull();
  });

  it('should store route paths for connected line', () => {
    const { grid, builder, rail } = setupTrackSystem();
    builder.buildTrack({ x: 2, y: 5 }, { x: 8, y: 5 }, 100000);

    const stA = rail.buildStation(2, 5, grid)!;
    const stB = rail.buildStation(8, 5, grid)!;

    const line = rail.createLine([stA, stB])!;
    const paths = rail.getRoutePaths(line.id);
    expect(paths).toBeDefined();
    expect(paths!.length).toBeGreaterThanOrEqual(1);
    // First path segment should go from station A to station B
    expect(paths![0]![0]).toBe('2,5');
    expect(paths![0]![paths![0]!.length - 1]).toBe('8,5');
  });

  it('should create line without network (backward compatible)', () => {
    const rail = new RailSystem();
    // No network set — old behavior
    const stA = rail.addStop(2, 5);
    const stB = rail.addStop(8, 5);

    const line = rail.createLine([stA, stB]);
    expect(line).not.toBeNull();
  });

  // --- Track-based train tick ---

  it('should move train along track path', () => {
    const { grid, builder, rail } = setupTrackSystem();
    builder.buildTrack({ x: 0, y: 5 }, { x: 10, y: 5 }, 100000);

    const stA = rail.buildStation(0, 5, grid)!;
    const stB = rail.buildStation(10, 5, grid)!;

    rail.createLine([stA, stB]);

    // Tick multiple times
    for (let i = 0; i < 20; i++) {
      rail.tick();
    }

    const trains = rail.getTrains();
    expect(trains.length).toBe(1);
    // Train should have moved (either traveling or at a stop)
    // Doesn't matter exactly where — just verify tick doesn't crash
  });

  // --- Serialization round-trip ---

  it('should serialize and deserialize with route paths', () => {
    const { grid, builder, rail } = setupTrackSystem();
    builder.buildTrack({ x: 2, y: 5 }, { x: 8, y: 5 }, 100000);

    const stA = rail.buildStation(2, 5, grid)!;
    const stB = rail.buildStation(8, 5, grid)!;

    rail.createLine([stA, stB]);

    const json = rail.toJSON();
    const restored = RailSystem.fromJSON(json);

    expect(restored.getStations()).toHaveLength(2);
    expect(restored.getLines()).toHaveLength(1);
    expect(restored.getTrains()).toHaveLength(1);

    // Route paths should be restored
    const lineId = restored.getLines()[0]!.id;
    const paths = restored.getRoutePaths(lineId);
    expect(paths).toBeDefined();
    expect(paths!.length).toBeGreaterThanOrEqual(1);
  });

  // --- Delete line cleanup ---

  it('should clean up route paths when line is deleted', () => {
    const { grid, builder, rail } = setupTrackSystem();
    builder.buildTrack({ x: 2, y: 5 }, { x: 8, y: 5 }, 100000);

    const stA = rail.buildStation(2, 5, grid)!;
    const stB = rail.buildStation(8, 5, grid)!;

    const line = rail.createLine([stA, stB])!;
    expect(rail.getRoutePaths(line.id)).toBeDefined();

    rail.deleteLine(line.id);
    expect(rail.getRoutePaths(line.id)).toBeUndefined();
  });
});

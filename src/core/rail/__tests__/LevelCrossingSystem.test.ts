import { describe, it, expect, beforeEach } from 'vitest';
import { LevelCrossingSystem, CrossingState } from '../LevelCrossingSystem';
import { Grid } from '../../grid/Grid';
import { RailType, TrackDirection } from '../types';
import { RoadType } from '../../road/types';
import { RailSystem } from '../../transport/RailSystem';
import { RailNetwork } from '../RailNetwork';

function makeGrid(w: number, h: number): Grid {
  return new Grid(w, h);
}

/** Place road at (x,y) with given flags. */
function placeRoad(grid: Grid, x: number, y: number, flags = 0b1111): void {
  grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
}

/** Place rail at (x,y) with given flags. */
function placeRail(grid: Grid, x: number, y: number, flags: number): void {
  grid.setCell(x, y, { railType: RailType.STANDARD, railFlags: flags });
}

/** Place rail+road crossing at (x,y). */
function placeCrossing(grid: Grid, x: number, y: number, railFlags: number, roadFlags = 0b1111): void {
  grid.setCell(x, y, {
    roadType: RoadType.TWO_LANE,
    roadFlags: roadFlags,
    railType: RailType.STANDARD,
    railFlags: railFlags,
  });
}

describe('LevelCrossingSystem', () => {
  let grid: Grid;
  let crossingSystem: LevelCrossingSystem;

  beforeEach(() => {
    grid = makeGrid(20, 20);
    crossingSystem = new LevelCrossingSystem();
  });

  describe('scanning for crossings', () => {
    it('should detect cells with both rail and road', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);

      const crossings = crossingSystem.getCrossings();
      expect(crossings).toHaveLength(1);
      expect(crossings[0]!.x).toBe(5);
      expect(crossings[0]!.y).toBe(5);
    });

    it('should not detect cells with only rail', () => {
      placeRail(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);

      expect(crossingSystem.getCrossings()).toHaveLength(0);
    });

    it('should not detect cells with only road', () => {
      placeRoad(grid, 5, 5);
      crossingSystem.rebuildFromGrid(grid);

      expect(crossingSystem.getCrossings()).toHaveLength(0);
    });

    it('should detect multiple crossings', () => {
      placeCrossing(grid, 3, 3, TrackDirection.NORTH | TrackDirection.SOUTH);
      placeCrossing(grid, 7, 7, TrackDirection.EAST | TrackDirection.WEST);
      crossingSystem.rebuildFromGrid(grid);

      expect(crossingSystem.getCrossings()).toHaveLength(2);
    });

    it('should clear old crossings on rebuild', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);
      expect(crossingSystem.getCrossings()).toHaveLength(1);

      // Remove the crossing, rebuild
      grid.setCell(5, 5, { railType: RailType.NONE, railFlags: 0 });
      crossingSystem.rebuildFromGrid(grid);
      expect(crossingSystem.getCrossings()).toHaveLength(0);
    });
  });

  describe('crossing state', () => {
    it('should start in CLEAR state', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);

      expect(crossingSystem.getCrossings()[0]!.state).toBe(CrossingState.CLEAR);
    });

    it('should report isCrossingBlocked=false when clear', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);

      expect(crossingSystem.isCrossingBlocked(5, 5)).toBe(false);
    });

    it('should report isCrossingBlocked=false for non-crossing cells', () => {
      expect(crossingSystem.isCrossingBlocked(5, 5)).toBe(false);
    });
  });

  describe('train proximity activation', () => {
    let railSystem: RailSystem;
    let railNetwork: RailNetwork;

    beforeEach(() => {
      railSystem = new RailSystem();
      railNetwork = new RailNetwork();
      railSystem.setRailNetwork(railNetwork);
    });

    it('should activate crossing when train is on a path that includes the crossing cell', () => {
      // Build rail track from (5,0) to (5,10) passing through crossing at (5,5)
      for (let y = 0; y <= 10; y++) {
        const flags = (y > 0 ? TrackDirection.NORTH : 0) | (y < 10 ? TrackDirection.SOUTH : 0);
        placeRail(grid, 5, y, flags);
        railNetwork.addNode(`5,${y}`);
        if (y > 0) railNetwork.addEdge(`5,${y - 1}`, `5,${y}`);
      }
      // Place road crossing at (5,5)
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);

      // Build stations at y=0 and y=10
      const s1 = railSystem.buildStation(5, 0);
      const s2 = railSystem.buildStation(5, 10);
      const line = railSystem.createLine([s1, s2]);
      expect(line).not.toBeNull();

      // Tick once so train starts traveling
      railSystem.tick(); // initial → atStop
      railSystem.tick(); // atStop countdown
      railSystem.tick(); // atStop countdown
      railSystem.tick(); // depart → traveling

      // Now update crossing system with rail state
      crossingSystem.tick(railSystem);

      expect(crossingSystem.isCrossingBlocked(5, 5)).toBe(true);
      expect(crossingSystem.getCrossings()[0]!.state).toBe(CrossingState.ACTIVE);
    });

    it('should not activate crossing when no trains are traveling', () => {
      for (let y = 0; y <= 10; y++) {
        const flags = (y > 0 ? TrackDirection.NORTH : 0) | (y < 10 ? TrackDirection.SOUTH : 0);
        placeRail(grid, 5, y, flags);
        railNetwork.addNode(`5,${y}`);
        if (y > 0) railNetwork.addEdge(`5,${y - 1}`, `5,${y}`);
      }
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);

      // Build stations but don't tick
      const s1 = railSystem.buildStation(5, 0);
      const s2 = railSystem.buildStation(5, 10);
      railSystem.createLine([s1, s2]);

      crossingSystem.tick(railSystem);
      expect(crossingSystem.isCrossingBlocked(5, 5)).toBe(false);
    });

    it('should deactivate crossing after countdown expires', () => {
      for (let y = 0; y <= 4; y++) {
        const flags = (y > 0 ? TrackDirection.NORTH : 0) | (y < 4 ? TrackDirection.SOUTH : 0);
        placeRail(grid, 5, y, flags);
        railNetwork.addNode(`5,${y}`);
        if (y > 0) railNetwork.addEdge(`5,${y - 1}`, `5,${y}`);
      }
      placeCrossing(grid, 5, 2, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);

      const s1 = railSystem.buildStation(5, 0);
      const s2 = railSystem.buildStation(5, 4);
      const line = railSystem.createLine([s1, s2]);
      expect(line).not.toBeNull();

      // Move train to traveling state
      for (let i = 0; i < 4; i++) railSystem.tick();

      // Activate
      crossingSystem.tick(railSystem);
      expect(crossingSystem.isCrossingBlocked(5, 2)).toBe(true);

      // Delete the line so no trains remain
      railSystem.deleteLine(line!.id);

      // With no traveling trains, cooldown should tick down: 3, 2, 1, 0 → CLEAR
      crossingSystem.tick(railSystem); // cooldown 3→2
      expect(crossingSystem.isCrossingBlocked(5, 2)).toBe(true);
      crossingSystem.tick(railSystem); // 2→1
      expect(crossingSystem.isCrossingBlocked(5, 2)).toBe(true);
      crossingSystem.tick(railSystem); // 1→0 → CLEAR
      expect(crossingSystem.isCrossingBlocked(5, 2)).toBe(false);
    });

    it('should activate crossing only for crossings on the train path', () => {
      // Two crossings: (5,5) on the path, (10,10) not on the path
      for (let y = 0; y <= 10; y++) {
        placeRail(grid, 5, y, TrackDirection.NORTH | TrackDirection.SOUTH);
        railNetwork.addNode(`5,${y}`);
        if (y > 0) railNetwork.addEdge(`5,${y - 1}`, `5,${y}`);
      }
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      placeCrossing(grid, 10, 10, TrackDirection.EAST | TrackDirection.WEST);
      crossingSystem.rebuildFromGrid(grid);

      const s1 = railSystem.buildStation(5, 0);
      const s2 = railSystem.buildStation(5, 10);
      railSystem.createLine([s1, s2]);

      // Move to traveling
      for (let i = 0; i < 4; i++) railSystem.tick();
      crossingSystem.tick(railSystem);

      expect(crossingSystem.isCrossingBlocked(5, 5)).toBe(true);
      expect(crossingSystem.isCrossingBlocked(10, 10)).toBe(false);
    });

    it('should work with multiple trains on different routes', () => {
      // Route 1: vertical through (5,5)
      for (let y = 0; y <= 10; y++) {
        placeRail(grid, 5, y, TrackDirection.NORTH | TrackDirection.SOUTH);
        railNetwork.addNode(`5,${y}`);
        if (y > 0) railNetwork.addEdge(`5,${y - 1}`, `5,${y}`);
      }
      // Route 2: horizontal through (8,3)
      for (let x = 6; x <= 12; x++) {
        placeRail(grid, x, 3, TrackDirection.EAST | TrackDirection.WEST);
        railNetwork.addNode(`${x},3`);
        if (x > 6) railNetwork.addEdge(`${x - 1},3`, `${x},3`);
      }
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      placeCrossing(grid, 8, 3, TrackDirection.EAST | TrackDirection.WEST);
      crossingSystem.rebuildFromGrid(grid);

      const s1 = railSystem.buildStation(5, 0);
      const s2 = railSystem.buildStation(5, 10);
      railSystem.createLine([s1, s2]);

      const s3 = railSystem.buildStation(6, 3);
      const s4 = railSystem.buildStation(12, 3);
      railSystem.createLine([s3, s4]);

      // Move all trains to traveling
      for (let i = 0; i < 4; i++) railSystem.tick();
      crossingSystem.tick(railSystem);

      expect(crossingSystem.isCrossingBlocked(5, 5)).toBe(true);
      expect(crossingSystem.isCrossingBlocked(8, 3)).toBe(true);
    });
  });

  describe('crossing orientation', () => {
    it('should detect NS rail orientation for vertical track', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      crossingSystem.rebuildFromGrid(grid);
      expect(crossingSystem.getCrossings()[0]!.railOrientation).toBe('NS');
    });

    it('should detect EW rail orientation for horizontal track', () => {
      placeCrossing(grid, 5, 5, TrackDirection.EAST | TrackDirection.WEST);
      crossingSystem.rebuildFromGrid(grid);
      expect(crossingSystem.getCrossings()[0]!.railOrientation).toBe('EW');
    });

    it('should default to NS for mixed/all-direction flags', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH | TrackDirection.EAST);
      crossingSystem.rebuildFromGrid(grid);
      // When both vertical and horizontal, default to NS
      expect(crossingSystem.getCrossings()[0]!.railOrientation).toBe('NS');
    });
  });
});

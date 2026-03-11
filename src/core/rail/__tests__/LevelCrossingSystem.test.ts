import { describe, it, expect, beforeEach } from 'vitest';
import { LevelCrossingSystem, CrossingState, LEVEL_CROSSING } from '../LevelCrossingSystem';
import { Grid } from '../../grid/Grid';
import { RailType, TrackDirection } from '../types';
import { RoadType } from '../../road/types';

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
  let sys: LevelCrossingSystem;

  beforeEach(() => {
    grid = makeGrid(20, 20);
    sys = new LevelCrossingSystem();
  });

  describe('scanning for crossings', () => {
    it('should detect cells with both rail and road', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);

      const crossings = sys.getCrossings();
      expect(crossings).toHaveLength(1);
      expect(crossings[0]!.x).toBe(5);
      expect(crossings[0]!.y).toBe(5);
    });

    it('should not detect cells with only rail', () => {
      placeRail(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()).toHaveLength(0);
    });

    it('should not detect cells with only road', () => {
      placeRoad(grid, 5, 5);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()).toHaveLength(0);
    });

    it('should detect multiple crossings', () => {
      placeCrossing(grid, 3, 3, TrackDirection.NORTH | TrackDirection.SOUTH);
      placeCrossing(grid, 7, 7, TrackDirection.EAST | TrackDirection.WEST);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()).toHaveLength(2);
    });

    it('should clear old crossings on rebuild', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()).toHaveLength(1);

      grid.setCell(5, 5, { railType: RailType.NONE, railFlags: 0 });
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()).toHaveLength(0);
    });
  });

  describe('crossing state', () => {
    it('should start in CLEAR state', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()[0]!.state).toBe(CrossingState.CLEAR);
    });

    it('should report isCrossingBlocked=false when clear', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);
      expect(sys.isCrossingBlocked(5, 5)).toBe(false);
    });

    it('should report isCrossingBlocked=false for non-crossing cells', () => {
      expect(sys.isCrossingBlocked(5, 5)).toBe(false);
    });
  });

  describe('proximity-based activation', () => {
    it('should activate crossing when train is nearby', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);

      // Train at (5, 4) — Manhattan distance 1 from crossing (5,5) → within radius 2.5
      sys.update(0.016, 1, [{ x: 5, y: 4 }]);

      expect(sys.isCrossingBlocked(5, 5)).toBe(true);
      expect(sys.getCrossings()[0]!.state).toBe(CrossingState.ACTIVE);
    });

    it('should not activate crossing when train is far away', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);

      // Train at (5, 0) — Manhattan distance 5 → outside radius 2.5
      sys.update(0.016, 1, [{ x: 5, y: 0 }]);

      expect(sys.isCrossingBlocked(5, 5)).toBe(false);
    });

    it('should not activate when no trains', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);

      sys.update(0.016, 1, []);
      expect(sys.isCrossingBlocked(5, 5)).toBe(false);
    });

    it('should deactivate after cooldown when train moves away', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);

      // Activate
      sys.update(0.016, 1, [{ x: 5, y: 5 }]);
      expect(sys.isCrossingBlocked(5, 5)).toBe(true);

      // Train moves far away — cooldown starts (1.5s total)
      sys.update(0.5, 1, [{ x: 5, y: 15 }]);
      expect(sys.isCrossingBlocked(5, 5)).toBe(true); // still in cooldown

      sys.update(0.5, 1, [{ x: 5, y: 15 }]);
      expect(sys.isCrossingBlocked(5, 5)).toBe(true); // 1.0s elapsed

      sys.update(0.6, 1, [{ x: 5, y: 15 }]); // 1.6s elapsed → cooldown expired
      expect(sys.isCrossingBlocked(5, 5)).toBe(false);
    });

    it('should activate only nearby crossing, not distant one', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      placeCrossing(grid, 15, 15, TrackDirection.EAST | TrackDirection.WEST);
      sys.rebuildFromGrid(grid);

      sys.update(0.016, 1, [{ x: 5, y: 4 }]);

      expect(sys.isCrossingBlocked(5, 5)).toBe(true);
      expect(sys.isCrossingBlocked(15, 15)).toBe(false);
    });

    it('should handle multiple trains near different crossings', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      placeCrossing(grid, 15, 5, TrackDirection.EAST | TrackDirection.WEST);
      sys.rebuildFromGrid(grid);

      sys.update(0.016, 1, [
        { x: 5, y: 4 },   // near crossing (5,5)
        { x: 14, y: 5 },  // near crossing (15,5)
      ]);

      expect(sys.isCrossingBlocked(5, 5)).toBe(true);
      expect(sys.isCrossingBlocked(15, 5)).toBe(true);
    });

    it('should keep crossing active while train remains nearby', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);

      // Train approaches
      sys.update(0.1, 1, [{ x: 5, y: 3 }]);
      expect(sys.isCrossingBlocked(5, 5)).toBe(true);

      // Train still nearby
      sys.update(0.1, 1, [{ x: 5, y: 5 }]);
      expect(sys.isCrossingBlocked(5, 5)).toBe(true);

      // Train still nearby (just past)
      sys.update(0.1, 1, [{ x: 5, y: 7 }]);
      expect(sys.isCrossingBlocked(5, 5)).toBe(true);
    });
  });

  describe('crossing orientation', () => {
    it('should detect NS rail orientation for vertical track', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()[0]!.railOrientation).toBe('NS');
    });

    it('should detect EW rail orientation for horizontal track', () => {
      placeCrossing(grid, 5, 5, TrackDirection.EAST | TrackDirection.WEST);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()[0]!.railOrientation).toBe('EW');
    });

    it('should default to NS for mixed/all-direction flags', () => {
      placeCrossing(grid, 5, 5, TrackDirection.NORTH | TrackDirection.SOUTH | TrackDirection.EAST);
      sys.rebuildFromGrid(grid);
      expect(sys.getCrossings()[0]!.railOrientation).toBe('NS');
    });
  });
});

describe('LEVEL_CROSSING constants', () => {
  it('activation radius should be positive', () => {
    expect(LEVEL_CROSSING.ACTIVATION_RADIUS).toBeGreaterThan(0);
  });

  it('cooldown duration should be positive', () => {
    expect(LEVEL_CROSSING.COOLDOWN_DURATION).toBeGreaterThan(0);
  });
});

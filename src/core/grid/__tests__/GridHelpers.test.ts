import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import {
  isAdjacentToRoad, toPosKey, parsePosKey, parsePosKeyUnsafe, findAdjacentRoad,
  euclideanDistance, isWithinEuclideanRadius, forEachCellInRadius, CARDINAL_DIRECTIONS,
} from '../GridHelpers';
import { RoadType } from '../../road/types';

describe('isAdjacentToRoad', () => {
  it('returns false when no adjacent roads', () => {
    const grid = new Grid(5, 5);
    expect(isAdjacentToRoad(grid, 2, 2)).toBe(false);
  });

  it('returns true when road is to the north', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 1, { roadType: RoadType.TWO_LANE });
    expect(isAdjacentToRoad(grid, 2, 2)).toBe(true);
  });

  it('returns true when road is to the south', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 3, { roadType: RoadType.TWO_LANE });
    expect(isAdjacentToRoad(grid, 2, 2)).toBe(true);
  });

  it('returns true when road is to the east', () => {
    const grid = new Grid(5, 5);
    grid.setCell(3, 2, { roadType: RoadType.TWO_LANE });
    expect(isAdjacentToRoad(grid, 2, 2)).toBe(true);
  });

  it('returns true when road is to the west', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 2, { roadType: RoadType.TWO_LANE });
    expect(isAdjacentToRoad(grid, 2, 2)).toBe(true);
  });

  it('returns false for diagonal roads', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 1, { roadType: RoadType.TWO_LANE });
    expect(isAdjacentToRoad(grid, 2, 2)).toBe(false);
  });

  it('handles edge cells correctly', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 0, { roadType: RoadType.TWO_LANE });
    expect(isAdjacentToRoad(grid, 0, 0)).toBe(true);
  });
});

describe('toPosKey', () => {
  it('creates "x,y" string', () => {
    expect(toPosKey(3, 7)).toBe('3,7');
  });

  it('handles zero coordinates', () => {
    expect(toPosKey(0, 0)).toBe('0,0');
  });
});

describe('parsePosKey', () => {
  it('parses valid "x,y" string', () => {
    expect(parsePosKey('3,7')).toEqual({ x: 3, y: 7 });
  });

  it('returns null for invalid string', () => {
    expect(parsePosKey('invalid')).toBeNull();
  });

  it('roundtrips with toPosKey', () => {
    expect(parsePosKey(toPosKey(10, 20))).toEqual({ x: 10, y: 20 });
  });
});

describe('parsePosKeyUnsafe', () => {
  it('parses valid "x,y" string', () => {
    expect(parsePosKeyUnsafe('5,12')).toEqual({ x: 5, y: 12 });
  });
});

describe('findAdjacentRoad', () => {
  it('returns the cell itself if it has a road', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 2, { roadType: RoadType.TWO_LANE });
    expect(findAdjacentRoad(grid, 2, 2)).toEqual({ x: 2, y: 2 });
  });

  it('returns adjacent road cell (north)', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 1, { roadType: RoadType.TWO_LANE });
    expect(findAdjacentRoad(grid, 2, 2)).toEqual({ x: 2, y: 1 });
  });

  it('returns adjacent road cell (south)', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 3, { roadType: RoadType.TWO_LANE });
    expect(findAdjacentRoad(grid, 2, 2)).toEqual({ x: 2, y: 3 });
  });

  it('returns adjacent road cell (west)', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 2, { roadType: RoadType.TWO_LANE });
    expect(findAdjacentRoad(grid, 2, 2)).toEqual({ x: 1, y: 2 });
  });

  it('returns adjacent road cell (east)', () => {
    const grid = new Grid(5, 5);
    grid.setCell(3, 2, { roadType: RoadType.TWO_LANE });
    expect(findAdjacentRoad(grid, 2, 2)).toEqual({ x: 3, y: 2 });
  });

  it('returns null when no road is adjacent', () => {
    const grid = new Grid(5, 5);
    expect(findAdjacentRoad(grid, 2, 2)).toBeNull();
  });

  it('ignores diagonal roads', () => {
    const grid = new Grid(5, 5);
    grid.setCell(1, 1, { roadType: RoadType.TWO_LANE });
    grid.setCell(3, 3, { roadType: RoadType.TWO_LANE });
    expect(findAdjacentRoad(grid, 2, 2)).toBeNull();
  });

  it('prefers the cell itself over adjacent road', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 2, { roadType: RoadType.TWO_LANE });
    grid.setCell(2, 1, { roadType: RoadType.FOUR_LANE });
    expect(findAdjacentRoad(grid, 2, 2)).toEqual({ x: 2, y: 2 });
  });
});

describe('euclideanDistance', () => {
  it('returns 0 for same point', () => {
    expect(euclideanDistance(5, 5, 5, 5)).toBe(0);
  });

  it('returns correct horizontal distance', () => {
    expect(euclideanDistance(0, 0, 3, 0)).toBe(3);
  });

  it('returns correct vertical distance', () => {
    expect(euclideanDistance(0, 0, 0, 4)).toBe(4);
  });

  it('returns correct diagonal distance', () => {
    expect(euclideanDistance(0, 0, 3, 4)).toBe(5); // 3-4-5 triangle
  });

  it('is symmetric', () => {
    expect(euclideanDistance(1, 2, 4, 6)).toBe(euclideanDistance(4, 6, 1, 2));
  });
});

describe('isWithinEuclideanRadius', () => {
  it('returns true for center point', () => {
    expect(isWithinEuclideanRadius(5, 5, 5, 5, 3)).toBe(true);
  });

  it('returns true for point within radius', () => {
    // dist = sqrt(4+4) = 2.83
    expect(isWithinEuclideanRadius(0, 0, 2, 2, 3)).toBe(true);
  });

  it('returns false for point outside radius', () => {
    // dist = sqrt(9+9) = 4.24
    expect(isWithinEuclideanRadius(0, 0, 3, 3, 3)).toBe(false);
  });

  it('returns true for point exactly on boundary', () => {
    expect(isWithinEuclideanRadius(0, 0, 3, 0, 3)).toBe(true);
  });

  it('returns false for point just outside boundary', () => {
    // dist = sqrt(9+1) = 3.16
    expect(isWithinEuclideanRadius(0, 0, 3, 1, 3)).toBe(false);
  });
});

describe('forEachCellInRadius', () => {
  it('calls callback for center cell with radius 0', () => {
    const cells: [number, number][] = [];
    forEachCellInRadius(5, 5, 0, (x, y) => cells.push([x, y]));
    expect(cells).toEqual([[5, 5]]);
  });

  it('calls callback for all cells within radius 1 (cross shape)', () => {
    const cells: [number, number][] = [];
    forEachCellInRadius(0, 0, 1, (x, y) => cells.push([x, y]));
    // radius 1: center + 4 cardinal = 5 cells (corners are sqrt(2) > 1)
    expect(cells.length).toBe(5);
    expect(cells).toContainEqual([0, 0]);
    expect(cells).toContainEqual([1, 0]);
    expect(cells).toContainEqual([-1, 0]);
    expect(cells).toContainEqual([0, 1]);
    expect(cells).toContainEqual([0, -1]);
  });

  it('excludes corners outside radius 1', () => {
    const cells: [number, number][] = [];
    forEachCellInRadius(0, 0, 1, (x, y) => cells.push([x, y]));
    expect(cells).not.toContainEqual([1, 1]);
    expect(cells).not.toContainEqual([-1, -1]);
  });

  it('provides correct distance to callback', () => {
    const results: { x: number; y: number; dist: number }[] = [];
    forEachCellInRadius(0, 0, 2, (x, y, dist) => results.push({ x, y, dist }));
    const atTwoZero = results.find(r => r.x === 2 && r.y === 0);
    const atOneOne = results.find(r => r.x === 1 && r.y === 1);
    expect(atTwoZero!.dist).toBeCloseTo(2, 5);
    expect(atOneOne!.dist).toBeCloseTo(Math.SQRT2, 5);
  });

  it('applies offset correctly', () => {
    const cells: [number, number][] = [];
    forEachCellInRadius(10, 20, 0, (x, y) => cells.push([x, y]));
    expect(cells).toEqual([[10, 20]]);
  });

  it('radius 2 produces a circle of 13 cells', () => {
    const cells: [number, number][] = [];
    forEachCellInRadius(0, 0, 2, (x, y) => cells.push([x, y]));
    // Within Euclidean distance 2: all cells where dx^2+dy^2 <= 4
    // (0,0),(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1),(2,0),(-2,0),(0,2),(0,-2) = 13
    expect(cells.length).toBe(13);
  });
});

describe('CARDINAL_DIRECTIONS', () => {
  it('should have exactly 4 entries', () => {
    expect(CARDINAL_DIRECTIONS.length).toBe(4);
  });

  it('each direction should have a valid opposite', () => {
    for (const dir of CARDINAL_DIRECTIONS) {
      const opposite = CARDINAL_DIRECTIONS.find(d => d.flag === dir.opposite);
      expect(opposite).toBeDefined();
      expect(opposite!.opposite).toBe(dir.flag);
    }
  });

  it('dx/dy should be unit vectors (Manhattan)', () => {
    for (const dir of CARDINAL_DIRECTIONS) {
      expect(Math.abs(dir.dx) + Math.abs(dir.dy)).toBe(1);
    }
  });

  it('flags should be compatible with RoadDirection/TrackDirection bitflags', () => {
    const flags = CARDINAL_DIRECTIONS.map(d => d.flag);
    expect(flags).toContain(0b0001); // NORTH
    expect(flags).toContain(0b0010); // SOUTH
    expect(flags).toContain(0b0100); // WEST
    expect(flags).toContain(0b1000); // EAST
  });
});

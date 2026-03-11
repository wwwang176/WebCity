import { describe, it, expect } from 'vitest';
import { Grid } from '../Grid';
import { isAdjacentToRoad, toPosKey, parsePosKey, parsePosKeyUnsafe, findAdjacentRoad } from '../GridHelpers';
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

import { describe, it, expect } from 'vitest';
import { findRoadPath } from '../RoadPathfinding';
import { RoadType } from '../../road/types';

/** Build a minimal grid for testing pathfinding. */
function makeGrid(width: number, height: number, roads: { x: number; y: number }[]) {
  const roadSet = new Set(roads.map(r => `${r.x},${r.y}`));
  return {
    width,
    height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: roadSet.has(`${x},${y}`) ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

describe('findRoadPath', () => {
  it('returns null when origin has no adjacent road', () => {
    const grid = makeGrid(5, 5, []);
    const result = findRoadPath({ x: 1, y: 1 }, { x: 3, y: 3 }, grid);
    expect(result).toBeNull();
  });

  it('returns null when destination has no adjacent road', () => {
    // Only road adjacent to origin, none near destination
    const grid = makeGrid(10, 10, [{ x: 1, y: 0 }]);
    const result = findRoadPath({ x: 1, y: 1 }, { x: 8, y: 8 }, grid);
    expect(result).toBeNull();
  });

  it('returns null when start and end road are the same cell', () => {
    // Both buildings adjacent to the same road cell
    const grid = makeGrid(5, 5, [{ x: 1, y: 1 }]);
    const result = findRoadPath({ x: 0, y: 1 }, { x: 2, y: 1 }, grid);
    expect(result).toBeNull();
  });

  it('returns path when route exists between two buildings', () => {
    // Road along row 1: (0,1) - (1,1) - (2,1) - (3,1) - (4,1)
    const roads = [0, 1, 2, 3, 4].map(x => ({ x, y: 1 }));
    const grid = makeGrid(5, 5, roads);
    // Building at (0,0), destination building at (4,0) — both adjacent to row 1 road
    const result = findRoadPath({ x: 0, y: 0 }, { x: 4, y: 0 }, grid);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null when no road connects start to end', () => {
    // Two disconnected road segments
    const grid = makeGrid(10, 10, [
      { x: 0, y: 1 }, { x: 1, y: 1 },
      { x: 8, y: 1 }, { x: 9, y: 1 },
    ]);
    const result = findRoadPath({ x: 0, y: 0 }, { x: 9, y: 0 }, grid);
    expect(result).toBeNull();
  });
});

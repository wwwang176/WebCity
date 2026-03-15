import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../RoadBuilder';
import { RoadType } from '../types';
import { toPosKey } from '../../grid/GridHelpers';

describe('RoadBuilder.buildRoad returns affectedCells', () => {
  it('should return affectedCells as posKey strings on success', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 5, y: 5 }, RoadType.TWO_LANE, 10000);

    expect(result.success).toBe(true);
    expect(result.affectedCells).toBeDefined();
    expect(result.affectedCells).toHaveLength(4);
    expect(result.affectedCells).toContain(toPosKey(2, 5));
    expect(result.affectedCells).toContain(toPosKey(3, 5));
    expect(result.affectedCells).toContain(toPosKey(4, 5));
    expect(result.affectedCells).toContain(toPosKey(5, 5));
  });

  it('should not return affectedCells on failure', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 5 }, { x: 5, y: 5 }, RoadType.TWO_LANE, 1);

    expect(result.success).toBe(false);
    expect(result.affectedCells).toBeUndefined();
  });

  it('should return affectedCells for L-shaped path', () => {
    const grid = new Grid(20, 20);
    const builder = new RoadBuilder(grid);
    const result = builder.buildRoad({ x: 2, y: 2 }, { x: 4, y: 4 }, RoadType.TWO_LANE, 100000);

    expect(result.success).toBe(true);
    // Horizontal: (2,2)→(4,2) = 3 cells, Vertical: (4,3)→(4,4) = 2 cells → total 5
    expect(result.affectedCells).toHaveLength(5);
  });
});

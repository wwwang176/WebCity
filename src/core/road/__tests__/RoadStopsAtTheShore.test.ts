import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { TerrainType } from '../../grid/types';
import { RoadBuilder } from '../RoadBuilder';
import { RoadType } from '../types';

/**
 * Dragging a road into water cancelled the whole drag and reported "Cannot
 * build on water". The player had drawn a perfectly good road up to the shore
 * and got nothing for it, with no indication of how far they could have gone —
 * so the only way to find the shoreline was to shorten the drag and try again,
 * repeatedly.
 *
 * Building up to the obstacle is what every other city builder does, and it is
 * what the drag already looks like on screen before the mouse is released.
 */
function coastMap(): Grid {
  const grid = new Grid(30, 30);
  // Sea from x = 12 eastwards.
  for (let y = 0; y < 30; y++) {
    for (let x = 12; x < 30; x++) grid.setCell(x, y, { terrainType: TerrainType.WATER });
  }
  return grid;
}

const roadCells = (grid: Grid, y: number): number[] => {
  const xs: number[] = [];
  for (let x = 0; x < grid.width; x++) {
    if (grid.getCell(x, y)!.roadType !== RoadType.NONE) xs.push(x);
  }
  return xs;
};

describe('a road drag stops at the water rather than being thrown away', () => {
  it('should build up to the shore', () => {
    const grid = coastMap();
    const result = new RoadBuilder(grid).buildRoad(
      { x: 2, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1e6,
    );

    expect(result.success, `drag was cancelled: ${JSON.stringify(result)}`).toBe(true);
    expect(roadCells(grid, 5)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('should put no road in the water', () => {
    const grid = coastMap();
    new RoadBuilder(grid).buildRoad({ x: 2, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1e6);

    for (let x = 12; x < 30; x++) {
      expect(grid.getCell(x, 5)!.roadType, `road built on water at x=${x}`).toBe(RoadType.NONE);
    }
  });

  it('should charge only for what it built', () => {
    const grid = coastMap();
    const truncated = new RoadBuilder(grid).buildRoad(
      { x: 2, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1e6,
    );
    const full = new RoadBuilder(coastMap()).buildRoad(
      { x: 2, y: 6 }, { x: 11, y: 6 }, RoadType.TWO_LANE, 1e6,
    );
    expect(truncated.cost).toBe(full.cost);
  });

  it('should still refuse when the drag STARTS in the water', () => {
    // Nothing to truncate to. Silently doing nothing would be worse than the
    // error, because the player would not know why.
    const grid = coastMap();
    const result = new RoadBuilder(grid).buildRoad(
      { x: 15, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1e6,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('WATER_TILE');
  });

  it('should stop at a mountain too', () => {
    // The rule is "stop at the obstacle", not "stop at water".
    const grid = new Grid(30, 30);
    for (let y = 0; y < 30; y++) grid.setCell(9, y, { terrainType: TerrainType.MOUNTAIN });

    const result = new RoadBuilder(grid).buildRoad(
      { x: 2, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1e6,
    );
    expect(result.success).toBe(true);
    expect(roadCells(grid, 5)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('should report the affected cells it actually built', () => {
    // The caller marks these dirty and rebuilds the lane graph from them; a
    // list describing cells that were never built would rebuild the wrong thing.
    const grid = coastMap();
    const result = new RoadBuilder(grid).buildRoad(
      { x: 2, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1e6,
    );
    expect(result.affectedCells?.sort()).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(x => `${x},5`).sort(),
    );
  });

  it('should leave an unobstructed drag exactly as it was', () => {
    // The control: truncation must not shorten a road that had no obstacle.
    const grid = new Grid(30, 30);
    const result = new RoadBuilder(grid).buildRoad(
      { x: 2, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1e6,
    );
    expect(result.success).toBe(true);
    expect(roadCells(grid, 5)).toHaveLength(19);
  });

  it('should not be able to afford more than the funds allow', () => {
    // Truncation must not become a way to sneak past the funds check.
    const grid = coastMap();
    const result = new RoadBuilder(grid).buildRoad(
      { x: 2, y: 5 }, { x: 20, y: 5 }, RoadType.TWO_LANE, 1,
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');
    expect(roadCells(grid, 5)).toEqual([]);
  });
});

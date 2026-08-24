import { SidewalkGraph, type GridLookup } from '../SidewalkGraph';
import { RoadType, RoadDirection } from '../../road/types';

/**
 * One east-west arterial at y=10 with a north-south road every `spacing` cells
 * (`spacing = 0` means no side roads at all). Every other cell is a building, so there are
 * door nodes to use as origins and destinations.
 *
 * Shared by the tests about pedestrians only crossing at junctions: how far a crossing
 * detours is entirely determined by junction spacing, and one layout keeps every test file
 * talking about the same thing.
 */

interface Cell { roadType: number; roadFlags: number; buildingId: number }

export interface GridCity {
  graph: SidewalkGraph;
  /** Rebuilds the same graph instance with a different side-road spacing. */
  rebuildWith(spacing: number): void;
  /** Recomputes only these cells, leaving the rest untouched. */
  updateAt(cellKeys: string[]): void;
}

export function cityWithMainRoad(spacing: number, width = 21): GridCity {
  const graph = new SidewalkGraph();
  let currentLookup: GridLookup | null = null;

  const build = (gap: number): void => {
    const cells = new Map<string, Cell>();
    const isRoad = (x: number, y: number) => y === 10 || (gap > 0 && x % gap === 0);

    for (let x = 0; x < width; x++) {
      for (let y = 6; y <= 14; y++) {
        cells.set(`${x},${y}`, isRoad(x, y)
          ? { roadType: RoadType.TWO_LANE, roadFlags: 0, buildingId: 0 }
          : { roadType: RoadType.NONE, roadFlags: 0, buildingId: 1 });
      }
    }
    for (const [key, cell] of cells) {
      if (cell.roadType === RoadType.NONE) continue;
      const [x, y] = key.split(',').map(Number) as [number, number];
      const at = (dx: number, dy: number) => cells.get(`${x + dx},${y + dy}`);
      let f = 0;
      if (at(0, -1)?.roadType) f |= RoadDirection.NORTH;
      if (at(0, 1)?.roadType) f |= RoadDirection.SOUTH;
      if (at(1, 0)?.roadType) f |= RoadDirection.EAST;
      if (at(-1, 0)?.roadType) f |= RoadDirection.WEST;
      cell.roadFlags = f;
    }

    const lookup: GridLookup = { getCell: (x, y) => cells.get(`${x},${y}`) ?? null };
    currentLookup = lookup;
    const roadKeys: string[] = [], bldKeys: string[] = [];
    for (const [k, c] of cells) {
      if (c.roadType !== RoadType.NONE) roadKeys.push(k);
      else bldKeys.push(k);
    }
    graph.buildFromGrid(lookup, roadKeys, bldKeys);
  };

  build(spacing);
  return {
    graph,
    rebuildWith: build,
    updateAt: (cellKeys) => graph.updateCells(currentLookup!, cellKeys),
  };
}

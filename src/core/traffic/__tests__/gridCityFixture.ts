import { SidewalkGraph, type GridLookup } from '../SidewalkGraph';
import { RoadType, RoadDirection } from '../../road/types';

/**
 * 一條東西向主幹道（y=10），每 `spacing` 格一條南北向道路（`spacing = 0` 代表
 * 完全沒有岔路）。其餘格子全部是建築，這樣才有門節點可以當起訖點。
 *
 * 給「行人只在路口過馬路」相關的測試共用 —— 過馬路要繞多遠完全由路口間距決定，
 * 用同一份佈局，各個測試檔談的才是同一件事。
 */

interface Cell { roadType: number; roadFlags: number; buildingId: number }

export interface GridCity {
  graph: SidewalkGraph;
  /** 換一個岔路間距，重建同一張圖（同一個 SidewalkGraph 實例）。 */
  rebuildWith(spacing: number): void;
  /** 只重算這幾格（增量），不動其餘部分。 */
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

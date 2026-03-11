import type { ZoneType } from '../grid/types';

interface GridLike {
  forEachCell(callback: (cell: { buildingId: number; zoneType: number }, x: number, y: number) => void): void;
}

/** Count buildings on the grid whose zoneType matches the given predicate (OCP-friendly). */
export function countZoneBuildings(grid: GridLike, predicate: (zoneType: ZoneType) => boolean): number {
  let count = 0;
  grid.forEachCell((cell) => {
    if (cell.buildingId > 0 && predicate(cell.zoneType as ZoneType)) count++;
  });
  return count;
}

import type { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { isZoneBuilding } from '../building/InfraConfig';
import { toPosKey } from '../grid/GridHelpers';
import type { ZoneManager } from './ZoneManager';

/**
 * Which cells a rezone will actually clear a building from.
 *
 * Game.applyZone used to work this out with its own copy of the condition —
 * `isZoneBuilding(cell.buildingId) && cell.zoneType !== zoneType` — and act on
 * it immediately: evict the residents, remove the mesh, drop the abandonment
 * stress. Then it called setZoneRect, which applies THREE further guards
 * (buildable cell, not under a viaduct, near a road) and silently refuses any
 * cell that fails them.
 *
 * Pull up the road under a built block and rezone it, and every building there
 * became a zombie: erased from the scene and emptied of citizens, yet still on
 * the grid with its buildingId — counted as zone supply, still taxed, and
 * impossible to interact with. Same for a block that a newly built viaduct
 * passes over.
 *
 * Asking one function keeps the two answers from drifting again.
 */
export function planRezone(
  grid: Grid,
  zones: Pick<ZoneManager, 'canZone'>,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  zoneType: ZoneType,
): string[] {
  const cells: string[] = [];
  for (let y = rect.minY; y <= rect.maxY; y++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      const cell = grid.getCell(x, y);
      if (!cell) continue;
      if (!isZoneBuilding(cell.buildingId) || cell.zoneType === zoneType) continue;
      // The guard setZone will apply. Without it the caller tears down a
      // building that is about to survive.
      if (!zones.canZone(x, y).success) continue;
      cells.push(toPosKey(x, y));
    }
  }
  return cells;
}

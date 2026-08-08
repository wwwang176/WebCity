import { Grid } from '../grid/Grid';
import { ZoneType, type Position } from '../grid/types';
import { isNearRoad, isCellBuildable } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import { isZoneBuilding } from '../building/InfraConfig';
import { type ElevationManager } from '../elevation/ElevationManager';
import { isBlockedByElevation } from '../elevation/ElevationZoneBlock';

export interface ZoneResult {
  success: boolean;
  reason?: string;
}

export class ZoneManager {
  private grid: Grid;
  private elevationManager: ElevationManager | null = null;

  constructor(grid: Grid) {
    this.grid = grid;
  }

  setElevationManager(em: ElevationManager): void {
    this.elevationManager = em;
  }

  /**
   * The placement guards, independent of the target zone type.
   *
   * Exposed so callers can ask BEFORE acting on the assumption that a rezone
   * will land. Game.applyZone pre-scans the rectangle, evicts the residents and
   * removes the mesh of every building it expects to replace, and only then
   * calls setZoneRect — which refuses any cell that fails these three checks.
   * Rezone a block after pulling up its road and every building in it became a
   * zombie: gone from the scene and emptied of citizens, but still on the grid
   * with its buildingId, so it counted toward zone supply and kept earning tax.
   */
  canZone(x: number, y: number): ZoneResult {
    const cell = this.grid.getCell(x, y);
    if (!cell) return { success: false, reason: 'OUT_OF_BOUNDS' };

    // White-list: cell must be buildable (no water/mountain/road/rail/infra)
    if (!isCellBuildable(cell)) return { success: false, reason: 'CELL_NOT_BUILDABLE' };

    // Block zoning under elevated roads/rails
    if (this.elevationManager && isBlockedByElevation(this.elevationManager, x, y)) {
      return { success: false, reason: 'BLOCKED_BY_ELEVATION' };
    }

    if (!isNearRoad(this.grid, x, y, ZONE_ROAD_REACH)) {
      return { success: false, reason: 'NOT_ADJACENT_TO_ROAD' };
    }

    return { success: true };
  }

  setZone(x: number, y: number, zoneType: ZoneType): ZoneResult {
    const guard = this.canZone(x, y);
    if (!guard.success) return guard;
    const cell = this.grid.getCell(x, y)!;

    // If rezoning to a different type and a building exists, demolish it first
    if (isZoneBuilding(cell.buildingId) && cell.zoneType !== zoneType) {
      // `reserved` must be cleared alongside buildingId. setCell is a partial
      // patch, so a BURNED/ABANDONED marker left behind survives onto whatever
      // grows here next: every ruin guard in BuildingGrowthTick requires
      // isZoneBuilding(cell.buildingId), which is false for 0, so the cell falls
      // through to regrowth and the new building is permanently a ruin — untaxed,
      // zero capacity, nobody assigned — while the renderer lights it up as
      // normal. Same defect class as BUG-068 in applyDisasterDamage (BUG-072).
      this.grid.setCell(x, y, { zoneType, buildingId: 0, reserved: 0 });
    } else {
      this.grid.setCell(x, y, { zoneType });
    }
    return { success: true };
  }

  setZoneRect(from: Position, to: Position, zoneType: ZoneType): ZoneResult[] {
    const results: ZoneResult[] = [];
    const x1 = Math.min(from.x, to.x);
    const y1 = Math.min(from.y, to.y);
    const x2 = Math.max(from.x, to.x);
    const y2 = Math.max(from.y, to.y);

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        results.push(this.setZone(x, y, zoneType));
      }
    }
    return results;
  }

  clearZone(x: number, y: number): void {
    this.grid.setCell(x, y, { zoneType: ZoneType.NONE });
  }

}

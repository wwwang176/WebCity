import { Grid } from '../grid/Grid';
import { ZoneType, type Position } from '../grid/types';
import { isAdjacentToRoad, isCellBuildable } from '../grid/GridHelpers';
import { isZoneBuilding } from '../building/InfraConfig';
import { type ElevationManager } from '../elevation/ElevationManager';
import { isBlockedByElevation } from '../elevation/ElevationZoneBlock';

interface ZoneResult {
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

  setZone(x: number, y: number, zoneType: ZoneType): ZoneResult {
    const cell = this.grid.getCell(x, y);
    if (!cell) return { success: false, reason: 'OUT_OF_BOUNDS' };

    // White-list: cell must be buildable (no water/mountain/road/rail/infra)
    if (!isCellBuildable(cell)) return { success: false, reason: 'CELL_NOT_BUILDABLE' };

    // Block zoning under elevated roads/rails
    if (this.elevationManager && isBlockedByElevation(this.elevationManager, x, y)) {
      return { success: false, reason: 'BLOCKED_BY_ELEVATION' };
    }

    if (!isAdjacentToRoad(this.grid, x, y)) {
      return { success: false, reason: 'NOT_ADJACENT_TO_ROAD' };
    }

    // If rezoning to a different type and a building exists, demolish it first
    if (isZoneBuilding(cell.buildingId) && cell.zoneType !== zoneType) {
      this.grid.setCell(x, y, { zoneType, buildingId: 0 });
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

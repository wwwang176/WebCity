import { Grid } from '../grid/Grid';
import { TerrainType, ZoneType } from '../grid/types';
import { RoadType } from '../road/types';
import { isInfrastructureBuilding, isZoneBuilding } from '../building/InfraConfig';

interface ZoneResult {
  success: boolean;
  reason?: string;
}

interface Position {
  x: number;
  y: number;
}

export class ZoneManager {
  private grid: Grid;

  constructor(grid: Grid) {
    this.grid = grid;
  }

  setZone(x: number, y: number, zoneType: ZoneType): ZoneResult {
    const cell = this.grid.getCell(x, y);
    if (!cell) return { success: false, reason: 'OUT_OF_BOUNDS' };

    // Skip unbuildable terrain
    if (cell.terrainType === TerrainType.WATER) return { success: false, reason: 'WATER_TILE' };
    if (cell.terrainType === TerrainType.MOUNTAIN) return { success: false, reason: 'MOUNTAIN_TILE' };
    // Skip roads
    if (cell.roadType !== RoadType.NONE) return { success: false, reason: 'ROAD_EXISTS' };
    // Skip infrastructure buildings (power/water/police/fire/hospital/school/park/garbage/sewage/cemetery/transport)
    if (isInfrastructureBuilding(cell.buildingId)) return { success: false, reason: 'INFRASTRUCTURE_EXISTS' };

    if (!this.isAdjacentToRoad(x, y)) {
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

  private isAdjacentToRoad(x: number, y: number): boolean {
    const dirs = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];
    for (const d of dirs) {
      const cell = this.grid.getCell(x + d.dx, y + d.dy);
      if (cell && cell.roadType !== RoadType.NONE) return true;
    }
    return false;
  }
}

import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { RoadType } from '../road/types';

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

    if (cell.buildingId !== 0) return { success: false, reason: 'BUILDING_EXISTS' };

    if (!this.isAdjacentToRoad(x, y)) {
      return { success: false, reason: 'NOT_ADJACENT_TO_ROAD' };
    }

    this.grid.setCell(x, y, { zoneType });
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

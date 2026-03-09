import { Grid } from '../grid/Grid';
import { TerrainType, ZoneType } from '../grid/types';
import { RoadNetwork } from './RoadNetwork';
import { RoadType, RoadDirection, ROAD_CONFIGS, type BuildRoadResult, type Position } from './types';

function nodeId(x: number, y: number): string {
  return `${x},${y}`;
}

export class RoadBuilder {
  private grid: Grid;
  private network: RoadNetwork | null;

  constructor(grid: Grid, network?: RoadNetwork) {
    this.grid = grid;
    this.network = network ?? null;
  }

  buildRoad(from: Position, to: Position, roadType: RoadType, funds: number): BuildRoadResult {
    const cells = this.getCellsBetween(from, to);
    const config = ROAD_CONFIGS[roadType];

    // Check for water/mountain/infrastructure
    for (const pos of cells) {
      const cell = this.grid.getCell(pos.x, pos.y);
      if (!cell) return { success: false, reason: 'OUT_OF_BOUNDS' };
      if (cell.terrainType === TerrainType.WATER) return { success: false, reason: 'WATER_TILE' };
      if (cell.terrainType === TerrainType.MOUNTAIN) return { success: false, reason: 'MOUNTAIN_TILE' };
      // Block infrastructure (power=254, water=253) but allow zoned buildings
      if (cell.buildingId === 254 || cell.buildingId === 253) return { success: false, reason: 'INFRASTRUCTURE_EXISTS' };
    }

    // Check funds — charge differential for cells that already have a road
    let totalCost = 0;
    for (const pos of cells) {
      const cell = this.grid.getCell(pos.x, pos.y)!;
      if (cell.roadType !== RoadType.NONE) {
        const existingCost = ROAD_CONFIGS[cell.roadType].cost;
        totalCost += Math.max(0, config.cost - existingCost);
      } else {
        totalCost += config.cost;
      }
    }
    if (funds < totalCost) return { success: false, reason: 'INSUFFICIENT_FUNDS' };

    // Build road — clear zoned buildings/zones along the path
    for (let i = 0; i < cells.length; i++) {
      const pos = cells[i]!;
      const curr = this.grid.getCell(pos.x, pos.y);
      if (curr && curr.roadType === RoadType.NONE) {
        // Clear building and zone if present (non-infrastructure)
        if (curr.buildingId !== 0 || curr.zoneType !== ZoneType.NONE) {
          this.grid.setCell(pos.x, pos.y, { buildingId: 0, zoneType: ZoneType.NONE });
        }
      }

      let flags = 0;

      // Connect to previous cell
      if (i > 0) {
        const prev = cells[i - 1]!;
        flags |= this.getDirection(pos, prev);
      }
      // Connect to next cell
      if (i < cells.length - 1) {
        const next = cells[i + 1]!;
        flags |= this.getDirection(pos, next);
      }

      // Merge with existing road flags
      const existing = this.grid.getCell(pos.x, pos.y);
      if (existing && existing.roadType !== RoadType.NONE) {
        flags |= existing.roadFlags;
      }

      this.grid.setCell(pos.x, pos.y, {
        roadType: roadType,
        roadFlags: flags,
      });
    }

    // Update network
    if (this.network) {
      for (let i = 0; i < cells.length - 1; i++) {
        const a = cells[i]!;
        const b = cells[i + 1]!;
        this.network.addEdge(nodeId(a.x, a.y), nodeId(b.x, b.y));
      }
    }

    return { success: true, cost: totalCost };
  }

  removeRoad(x: number, y: number): void {
    const cell = this.grid.getCell(x, y);
    if (!cell || cell.roadType === RoadType.NONE) return;

    // Remove from network
    if (this.network) {
      this.network.removeNode(nodeId(x, y));
    }

    // Clear road data
    this.grid.setCell(x, y, { roadType: RoadType.NONE, roadFlags: 0 });

    // Update neighboring cells' flags
    const dirs: { dx: number; dy: number; flag: number; opposite: number }[] = [
      { dx: 0, dy: -1, flag: RoadDirection.NORTH, opposite: RoadDirection.SOUTH },
      { dx: 0, dy: 1, flag: RoadDirection.SOUTH, opposite: RoadDirection.NORTH },
      { dx: -1, dy: 0, flag: RoadDirection.WEST, opposite: RoadDirection.EAST },
      { dx: 1, dy: 0, flag: RoadDirection.EAST, opposite: RoadDirection.WEST },
    ];

    for (const dir of dirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      const neighbor = this.grid.getCell(nx, ny);
      if (neighbor && neighbor.roadType !== RoadType.NONE) {
        this.grid.setCell(nx, ny, {
          roadFlags: neighbor.roadFlags & ~dir.opposite,
        });
      }
    }
  }

  private getCellsBetween(from: Position, to: Position): Position[] {
    const cells: Position[] = [];
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);

    let x = from.x;
    let y = from.y;

    // First move horizontally, then vertically (L-shaped path)
    while (x !== to.x) {
      cells.push({ x, y });
      x += dx;
    }
    while (y !== to.y) {
      cells.push({ x, y });
      y += dy;
    }
    cells.push({ x: to.x, y: to.y });

    return cells;
  }

  private getDirection(from: Position, to: Position): number {
    if (to.y < from.y) return RoadDirection.NORTH;
    if (to.y > from.y) return RoadDirection.SOUTH;
    if (to.x < from.x) return RoadDirection.WEST;
    if (to.x > from.x) return RoadDirection.EAST;
    return 0;
  }
}

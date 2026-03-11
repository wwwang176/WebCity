import { Grid } from '../grid/Grid';
import { TerrainType, ZoneType } from '../grid/types';
import { toPosKey, CARDINAL_DIRECTIONS, hasVerticalFlag, hasHorizontalFlag, getLShapedPath, getDirectionFlag } from '../grid/GridHelpers';
import { getInfraConfigById } from '../building/InfraConfig';
import { RoadNetwork } from './RoadNetwork';
import { RoadType, RoadDirection, ROAD_CONFIGS, type BuildRoadResult, type Position } from './types';
import { RailType } from '../rail/types';

const nodeId = toPosKey;

export class RoadBuilder {
  private grid: Grid;
  private network: RoadNetwork | null;

  constructor(grid: Grid, network?: RoadNetwork) {
    this.grid = grid;
    this.network = network ?? null;
  }

  buildRoad(from: Position, to: Position, roadType: RoadType, funds: number): BuildRoadResult {
    const cells = getLShapedPath(from, to);
    const config = ROAD_CONFIGS[roadType];

    // Check for water/mountain/infrastructure
    for (const pos of cells) {
      const cell = this.grid.getCell(pos.x, pos.y);
      if (!cell) return { success: false, reason: 'OUT_OF_BOUNDS' };
      if (cell.terrainType === TerrainType.WATER) return { success: false, reason: 'WATER_TILE' };
      if (cell.terrainType === TerrainType.MOUNTAIN) return { success: false, reason: 'MOUNTAIN_TILE' };
      // Block all infrastructure buildings (buildingId 236-254)
      if (getInfraConfigById(cell.buildingId)) return { success: false, reason: 'INFRASTRUCTURE_EXISTS' };
    }

    // Check for parallel rail conflicts
    for (let i = 0; i < cells.length; i++) {
      const pos = cells[i]!;
      const cell = this.grid.getCell(pos.x, pos.y)!;
      if (cell.railType !== undefined && cell.railType !== RailType.NONE) {
        let roadFlags = 0;
        if (i > 0) roadFlags |= this.getDirection(pos, cells[i - 1]!);
        if (i < cells.length - 1) roadFlags |= this.getDirection(pos, cells[i + 1]!);
        const roadVert = hasVerticalFlag(roadFlags);
        const roadHorz = hasHorizontalFlag(roadFlags);
        const railVert = hasVerticalFlag(cell.railFlags);
        const railHorz = hasHorizontalFlag(cell.railFlags);
        if ((roadVert && railVert) || (roadHorz && railHorz)) {
          return { success: false, reason: 'PARALLEL_RAIL' };
        }
      }
    }

    // Check funds — charge differential for cells that already have a road
    let totalCost = 0;
    for (const pos of cells) {
      const cell = this.grid.getCell(pos.x, pos.y)!;
      if (cell.roadType !== RoadType.NONE) {
        const existingCost = ROAD_CONFIGS[cell.roadType as RoadType].cost;
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
        // Clear zoned buildings only (NOT infrastructure)
        const isInfra = getInfraConfigById(curr.buildingId) !== undefined;
        if (!isInfra && (curr.buildingId !== 0 || curr.zoneType !== ZoneType.NONE)) {
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
    for (const dir of CARDINAL_DIRECTIONS) {
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

  private getDirection(from: Position, to: Position): number {
    return getDirectionFlag(from, to);
  }
}

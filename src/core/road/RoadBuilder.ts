import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { toPosKey, CARDINAL_DIRECTIONS, getLShapedPath, getDirectionFlag } from '../grid/GridHelpers';
import { getInfraConfigById } from '../building/InfraConfig';
import { RoadNetwork } from './RoadNetwork';
import { RoadType, type BuildRoadResult, type Position } from './types';
import { validateRoadPath, calculateRoadCost } from './RoadValidation';

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

    // Validate path (terrain, infrastructure, rail conflicts) — delegated to pure function (SRP)
    const validationError = validateRoadPath(this.grid, cells);
    if (validationError) return { success: false, reason: validationError };

    // Calculate cost with differential pricing — delegated to pure function (SRP)
    const totalCost = calculateRoadCost(this.grid, cells, roadType);
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
        flags |= getDirectionFlag(pos, prev);
      }
      // Connect to next cell
      if (i < cells.length - 1) {
        const next = cells[i + 1]!;
        flags |= getDirectionFlag(pos, next);
      }

      // Merge with existing road flags. At crossing intersections (≥3 directions
      // after merge), keep the higher roadType to prevent lane count downgrades.
      // For same-direction rebuilds (≤2 directions), allow the new type to overwrite.
      const existing = this.grid.getCell(pos.x, pos.y);
      let effectiveRoadType = roadType;
      if (existing && existing.roadType !== RoadType.NONE) {
        flags |= existing.roadFlags;
        let mergedDirCount = 0;
        if (flags & 0b0001) mergedDirCount++; // NORTH
        if (flags & 0b0010) mergedDirCount++; // SOUTH
        if (flags & 0b0100) mergedDirCount++; // WEST
        if (flags & 0b1000) mergedDirCount++; // EAST
        if (mergedDirCount >= 3 && existing.roadType > roadType) {
          effectiveRoadType = existing.roadType;
        }
      }

      this.grid.setCell(pos.x, pos.y, {
        roadType: effectiveRoadType,
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

    return { success: true, cost: totalCost, affectedCells: cells.map(p => toPosKey(p.x, p.y)) };
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
}

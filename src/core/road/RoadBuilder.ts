import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { toPosKey, CARDINAL_DIRECTIONS, getLShapedPath, getDirectionFlag } from '../grid/GridHelpers';
import { extractOutOfBoundsEdge } from '../grid/EdgeUtils';
import { getInfraConfigById } from '../building/InfraConfig';
import { RoadNetwork } from './RoadNetwork';
import { RoadType, type BuildRoadResult, type Position } from './types';
import { validateRoadPath, calculateRoadCost } from './RoadValidation';
import { type ElevationManager } from '../elevation/ElevationManager';

const nodeId = toPosKey;

export class RoadBuilder {
  private grid: Grid;
  private network: RoadNetwork | null;
  private elevationManager: ElevationManager | null;

  constructor(grid: Grid, network?: RoadNetwork, elevationManager?: ElevationManager) {
    this.grid = grid;
    this.network = network ?? null;
    this.elevationManager = elevationManager ?? null;
  }

  buildRoad(from: Position, to: Position, roadType: RoadType, funds: number): BuildRoadResult {
    const fullPath = getLShapedPath(from, to);

    // Detect if the last cell is beyond the map edge (user dragged outside)
    // Only HIGHWAY can create external connections; other road types ignore the out-of-bounds cell.
    const rawOob = extractOutOfBoundsEdge(fullPath, this.grid.width, this.grid.height);
    const oob = rawOob && roadType === RoadType.HIGHWAY ? rawOob : null;
    const cells = rawOob ? fullPath.slice(0, rawOob.truncatedLength) : fullPath;

    if (cells.length === 0) return { success: false, reason: 'EMPTY_PATH' };

    // Validate path (terrain, infrastructure, rail conflicts) — delegated to pure function (SRP)
    const validationError = validateRoadPath(this.grid, cells, this.elevationManager ?? undefined);
    if (validationError) return { success: false, reason: validationError };

    // Calculate cost with differential pricing — delegated to pure function (SRP)
    const totalCost = calculateRoadCost(this.grid, cells, roadType);
    if (funds < totalCost) return { success: false, reason: 'INSUFFICIENT_FUNDS' };

    // Build road — clear zoned buildings/zones along the path
    const demolished: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      const pos = cells[i]!;
      const curr = this.grid.getCell(pos.x, pos.y);
      if (curr && curr.roadType === RoadType.NONE) {
        // Clear zoned buildings only (NOT infrastructure)
        const isInfra = getInfraConfigById(curr.buildingId) !== undefined;
        if (!isInfra && (curr.buildingId !== 0 || curr.zoneType !== ZoneType.NONE)) {
          if (curr.buildingId !== 0) demolished.push(toPosKey(pos.x, pos.y));
          this.grid.setCell(pos.x, pos.y, { buildingId: 0, zoneType: ZoneType.NONE, reserved: 0 });
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

      // Add outward flag if this is the last cell and user dragged beyond edge
      if (oob && i === cells.length - 1) {
        flags |= oob.outwardFlag;
      }

      // Merge with existing road flags. Intersection cells are "transparent"
      // in the lane graph (no own points/edges), so we always use the new roadType.
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

    return {
      success: true, cost: totalCost,
      affectedCells: cells.map(p => toPosKey(p.x, p.y)),
      demolishedCells: demolished.length > 0 ? demolished : undefined,
    };
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

import { Grid } from '../grid/Grid';
import { ZoneType, type Position } from '../grid/types';
import { toPosKey, CARDINAL_DIRECTIONS, hasVerticalFlag, hasHorizontalFlag, getLShapedPath, getDirectionFlag } from '../grid/GridHelpers';
import { validatePathTerrain } from '../grid/PathValidation';
import { extractOutOfBoundsEdge } from '../grid/EdgeUtils';
import { RoadType } from '../road/types';
import { getInfraConfigById } from '../building/InfraConfig';
import { RailNetwork } from './RailNetwork';
import { RailType, RAIL, type BuildTrackResult } from './types';
import { type ElevationManager } from '../elevation/ElevationManager';

const nodeId = toPosKey;

export class RailBuilder {
  private grid: Grid;
  private network: RailNetwork | null;
  private elevationManager: ElevationManager | null;

  constructor(grid: Grid, network?: RailNetwork, elevationManager?: ElevationManager) {
    this.grid = grid;
    this.network = network ?? null;
    this.elevationManager = elevationManager ?? null;
  }

  buildTrack(from: Position, to: Position, funds: number): BuildTrackResult {
    const fullPath = getLShapedPath(from, to);

    // Detect if the last cell is beyond the map edge (user dragged outside)
    const oob = extractOutOfBoundsEdge(fullPath, this.grid.width, this.grid.height);
    const cells = oob ? fullPath.slice(0, oob.truncatedLength) : fullPath;

    if (cells.length === 0) return { success: false, reason: 'EMPTY_PATH' };

    // Validate terrain + infrastructure (shared DRY validation)
    const terrainError = validatePathTerrain(this.grid, cells, this.elevationManager ?? undefined);
    if (terrainError) return { success: false, reason: terrainError };

    // Check for parallel road conflicts
    for (let i = 0; i < cells.length; i++) {
      const pos = cells[i]!;
      const cell = this.grid.getCell(pos.x, pos.y)!;
      if (cell.roadType !== RoadType.NONE) {
        let railFlags = 0;
        if (i > 0) railFlags |= getDirectionFlag(pos, cells[i - 1]!);
        if (i < cells.length - 1) railFlags |= getDirectionFlag(pos, cells[i + 1]!);
        const railVert = hasVerticalFlag(railFlags);
        const railHorz = hasHorizontalFlag(railFlags);
        const roadVert = hasVerticalFlag(cell.roadFlags);
        const roadHorz = hasHorizontalFlag(cell.roadFlags);
        if ((railVert && roadVert) || (railHorz && roadHorz)) {
          return { success: false, reason: 'PARALLEL_ROAD' };
        }
      }
    }

    // Calculate cost — skip cells that already have track
    let totalCost = 0;
    for (const pos of cells) {
      const cell = this.grid.getCell(pos.x, pos.y)!;
      if (cell.railType === RailType.NONE) {
        totalCost += RAIL.COST_PER_CELL;
      }
      // Existing track: free (just merge flags)
    }
    if (funds < totalCost) return { success: false, reason: 'INSUFFICIENT_FUNDS' };

    // Place track
    const demolished: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      const pos = cells[i]!;
      const curr = this.grid.getCell(pos.x, pos.y);

      // Clear zoned buildings only (NOT infrastructure, NOT roads — tracks can coexist with roads)
      if (curr && curr.railType === RailType.NONE && curr.roadType === RoadType.NONE) {
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

      // Merge with existing rail flags
      if (curr && curr.railType !== RailType.NONE) {
        flags |= curr.railFlags;
      }

      this.grid.setCell(pos.x, pos.y, {
        railType: RailType.STANDARD,
        railFlags: flags,
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
      demolishedCells: demolished.length > 0 ? demolished : undefined,
    };
  }

  removeTrack(x: number, y: number): void {
    const cell = this.grid.getCell(x, y);
    if (!cell || cell.railType === RailType.NONE) return;

    // Remove from network
    if (this.network) {
      this.network.removeNode(nodeId(x, y));
    }

    // Clear rail data
    this.grid.setCell(x, y, { railType: RailType.NONE, railFlags: 0 });

    // Update neighboring cells' flags
    for (const dir of CARDINAL_DIRECTIONS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      const neighbor = this.grid.getCell(nx, ny);
      if (neighbor && neighbor.railType !== RailType.NONE) {
        this.grid.setCell(nx, ny, {
          railFlags: neighbor.railFlags & ~dir.opposite,
        });
      }
    }
  }
}

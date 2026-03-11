import { Grid } from '../grid/Grid';
import { TerrainType, ZoneType } from '../grid/types';
import { getInfraConfigById } from '../building/InfraConfig';
import { RailNetwork } from './RailNetwork';
import { RailType, TrackDirection, RAIL_COST, type BuildTrackResult } from './types';

interface Position {
  x: number;
  y: number;
}

function nodeId(x: number, y: number): string {
  return `${x},${y}`;
}

export class RailBuilder {
  private grid: Grid;
  private network: RailNetwork | null;

  constructor(grid: Grid, network?: RailNetwork) {
    this.grid = grid;
    this.network = network ?? null;
  }

  buildTrack(from: Position, to: Position, funds: number): BuildTrackResult {
    const cells = this.getCellsBetween(from, to);

    // Validate terrain
    for (const pos of cells) {
      const cell = this.grid.getCell(pos.x, pos.y);
      if (!cell) return { success: false, reason: 'OUT_OF_BOUNDS' };
      if (cell.terrainType === TerrainType.WATER) return { success: false, reason: 'WATER_TILE' };
      if (cell.terrainType === TerrainType.MOUNTAIN) return { success: false, reason: 'MOUNTAIN_TILE' };
      // Block all infrastructure buildings (buildingId 236-254)
      if (getInfraConfigById(cell.buildingId)) {
        return { success: false, reason: 'INFRASTRUCTURE_EXISTS' };
      }
    }

    // Check for parallel road conflicts
    for (let i = 0; i < cells.length; i++) {
      const pos = cells[i]!;
      const cell = this.grid.getCell(pos.x, pos.y)!;
      if (cell.roadType > 0) {
        let railFlags = 0;
        if (i > 0) railFlags |= this.getDirection(pos, cells[i - 1]!);
        if (i < cells.length - 1) railFlags |= this.getDirection(pos, cells[i + 1]!);
        const railVert = (railFlags & (TrackDirection.NORTH | TrackDirection.SOUTH)) !== 0;
        const railHorz = (railFlags & (TrackDirection.WEST | TrackDirection.EAST)) !== 0;
        const roadVert = (cell.roadFlags & (TrackDirection.NORTH | TrackDirection.SOUTH)) !== 0;
        const roadHorz = (cell.roadFlags & (TrackDirection.WEST | TrackDirection.EAST)) !== 0;
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
        totalCost += RAIL_COST;
      }
      // Existing track: free (just merge flags)
    }
    if (funds < totalCost) return { success: false, reason: 'INSUFFICIENT_FUNDS' };

    // Place track
    for (let i = 0; i < cells.length; i++) {
      const pos = cells[i]!;
      const curr = this.grid.getCell(pos.x, pos.y);

      // Clear zoned buildings only (NOT infrastructure, NOT roads — tracks can coexist with roads)
      if (curr && curr.railType === RailType.NONE && curr.roadType === 0) {
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

    return { success: true, cost: totalCost };
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
    const dirs: { dx: number; dy: number; flag: number; opposite: number }[] = [
      { dx: 0, dy: -1, flag: TrackDirection.NORTH, opposite: TrackDirection.SOUTH },
      { dx: 0, dy: 1, flag: TrackDirection.SOUTH, opposite: TrackDirection.NORTH },
      { dx: -1, dy: 0, flag: TrackDirection.WEST, opposite: TrackDirection.EAST },
      { dx: 1, dy: 0, flag: TrackDirection.EAST, opposite: TrackDirection.WEST },
    ];

    for (const dir of dirs) {
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

  private getCellsBetween(from: Position, to: Position): Position[] {
    const cells: Position[] = [];
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);

    let x = from.x;
    let y = from.y;

    // L-shaped path: horizontal first, then vertical
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
    if (to.y < from.y) return TrackDirection.NORTH;
    if (to.y > from.y) return TrackDirection.SOUTH;
    if (to.x < from.x) return TrackDirection.WEST;
    if (to.x > from.x) return TrackDirection.EAST;
    return 0;
  }
}

import { Grid } from '../grid/Grid';
import { TerrainType, type Position } from '../grid/types';
import { toPosKey, getDirectionFlag } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { RailType, RAIL, type BuildTrackResult } from '../rail/types';
import { RailNetwork } from '../rail/RailNetwork';
import { ElevationManager } from './ElevationManager';
import { getElevatedPath } from './ElevatedPath';
import { validateElevatedPath } from './ElevatedPathValidation';
import { ELEVATION_COST } from './types';

/**
 * Builds elevated rail tracks using the ElevationManager.
 * Ground-level tracks are still built by the original RailBuilder.
 *
 * Pure logic module — no Three.js imports.
 */
export class ElevatedRailBuilder {
  constructor(
    private grid: Grid,
    private elevationManager: ElevationManager,
    private network: RailNetwork | null = null,
  ) {}

  buildElevatedTrack(
    from: Position,
    to: Position,
    funds: number,
    targetLevel: number,
  ): BuildTrackResult {
    const startLevel = this.detectLevel(from.x, from.y);
    const startOnGroundPath = this.hasGroundPath(from.x, from.y);
    const startOnElevated = this.elevationManager.hasElevatedSegment(from.x, from.y);

    if (!startOnGroundPath && !startOnElevated) {
      return { success: false, reason: 'START_NOT_ON_ROAD' };
    }

    const endOnGroundPath = this.hasGroundPath(to.x, to.y);
    const endLevel = endOnGroundPath ? 0 : undefined;
    const actualStartLevel = startOnGroundPath && !startOnElevated ? 0 : startLevel;

    const path = getElevatedPath(from, to, actualStartLevel, targetLevel, endLevel);
    if (!path) return { success: false, reason: 'PATH_TOO_SHORT' };

    const excludeIndices = new Set<number>();
    if (startOnElevated) excludeIndices.add(0);
    const error = validateElevatedPath(this.grid, this.elevationManager, path,
      excludeIndices.size > 0 ? excludeIndices : undefined);
    if (error) return { success: false, reason: error };

    // Calculate cost
    const baseCost = RAIL.COST_PER_CELL;
    let totalCost = 0;
    for (const pos of path) {
      if (pos.level === 0 && !pos.isRamp) continue;
      if (pos.isRamp) {
        totalCost += baseCost * ELEVATION_COST.RAMP;
      } else {
        const cell = this.grid.getCell(pos.x, pos.y);
        const isWater = cell?.terrainType === TerrainType.WATER;
        totalCost += baseCost * (isWater ? ELEVATION_COST.BRIDGE : ELEVATION_COST.ELEVATED);
      }
    }

    if (funds < totalCost) return { success: false, reason: 'INSUFFICIENT_FUNDS' };

    // Place elevated segments
    for (let i = 0; i < path.length; i++) {
      const pos = path[i]!;
      if (pos.level === 0 && !pos.isRamp) continue;

      const storeLevel = pos.isRamp ? Math.max(pos.level, pos.targetLevel) : pos.level;
      if (storeLevel === 0) continue;

      let flags = 0;
      if (i > 0) flags |= getDirectionFlag(pos, path[i - 1]!);
      if (i < path.length - 1) flags |= getDirectionFlag(pos, path[i + 1]!);

      const existing = this.elevationManager.get(pos.x, pos.y, storeLevel);
      if (existing) flags |= existing.railFlags;

      // Compute ramp ascend direction: the cardinal direction toward the HIGHER end
      let rampAscendDir = 0;
      if (pos.isRamp) {
        if (pos.rampDirection === 'up' && i < path.length - 1) {
          rampAscendDir = getDirectionFlag(pos, path[i + 1]!);
        } else if (pos.rampDirection === 'down' && i > 0) {
          rampAscendDir = getDirectionFlag(pos, path[i - 1]!);
        }
      }

      this.elevationManager.set(pos.x, pos.y, storeLevel, {
        roadType: existing?.roadType ?? 0,
        roadFlags: existing?.roadFlags ?? 0,
        railType: RailType.STANDARD,
        railFlags: flags,
        isRamp: pos.isRamp,
        rampAscendDirection: rampAscendDir,
      });
    }

    // Update network
    if (this.network) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const aLevel = a.isRamp ? Math.max(a.level, a.targetLevel) : a.level;
        const bLevel = b.isRamp ? Math.max(b.level, b.targetLevel) : b.level;
        this.network.addEdge(this.nodeId(a.x, a.y, aLevel), this.nodeId(b.x, b.y, bLevel));
      }
    }

    return { success: true, cost: totalCost };
  }

  removeElevated(x: number, y: number): void {
    const highest = this.elevationManager.getHighestLevel(x, y);
    if (highest === 0) return;
    this.elevationManager.delete(x, y, highest);
    if (this.network) this.network.removeNode(this.nodeId(x, y, highest));
  }

  /** Rail can start from ground rail OR ground road (coexistence). */
  private hasGroundPath(x: number, y: number): boolean {
    const cell = this.grid.getCell(x, y);
    if (!cell) return false;
    return cell.railType !== RailType.NONE || cell.roadType !== RoadType.NONE;
  }

  private detectLevel(x: number, y: number): number {
    return this.elevationManager.getHighestLevel(x, y);
  }

  private nodeId(x: number, y: number, level: number): string {
    return level === 0 ? toPosKey(x, y) : `${x},${y},${level}`;
  }
}

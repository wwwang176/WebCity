import { Grid } from '../grid/Grid';
import { TerrainType, type Position } from '../grid/types';
import { toPosKey, getDirectionFlag, getLShapedPath, CARDINAL_DIRECTIONS } from '../grid/GridHelpers';
import { extractOutOfBoundsEdge } from '../grid/EdgeUtils';
import { RoadType, ROAD_CONFIGS, type BuildRoadResult } from '../road/types';
import { RoadNetwork } from '../road/RoadNetwork';
import { ElevationManager } from './ElevationManager';
import { getElevatedPath } from './ElevatedPath';
import { validateElevatedPath } from './ElevatedPathValidation';
import { ELEVATION_COST, MAX_ELEVATION_LEVEL } from './types';

/**
 * Builds elevated roads (bridges, viaducts) using the ElevationManager.
 * Ground-level roads are still built by the original RoadBuilder.
 *
 * Pure logic module — no Three.js imports.
 */
export class ElevatedRoadBuilder {
  constructor(
    private grid: Grid,
    private elevationManager: ElevationManager,
    private network: RoadNetwork | null = null,
  ) {}

  /**
   * Build an elevated road from `from` to `to`.
   *
   * @param from Start position (must be on existing ground road or elevated segment)
   * @param to End position
   * @param roadType Road type to build
   * @param funds Available funds
   * @param targetLevel Elevation level (1-3)
   */
  buildElevatedRoad(
    from: Position,
    to: Position,
    roadType: RoadType,
    funds: number,
    targetLevel: number,
  ): BuildRoadResult {
    // Detect out-of-bounds edge (highway external connection)
    const fullPath = getLShapedPath(from, to);
    const rawOob = extractOutOfBoundsEdge(fullPath, this.grid.width, this.grid.height);
    const oob = rawOob && roadType === RoadType.HIGHWAY ? rawOob : null;
    // Truncate `to` if user dragged beyond map edge
    if (rawOob) {
      const lastInBounds = fullPath[rawOob.truncatedLength - 1];
      if (lastInBounds) {
        to = { x: lastInBounds.x, y: lastInBounds.y };
      }
    }

    // Determine start level
    const startOnGround = this.isGroundRoad(from.x, from.y);
    const startOnElevated = this.elevationManager.get(from.x, from.y, targetLevel) !== null
      || this.elevationManager.hasElevatedSegment(from.x, from.y);

    if (!startOnGround && !startOnElevated) {
      return { success: false, reason: 'START_NOT_ON_ROAD' };
    }

    // Determine end level — auto-ramp down if end is on ground road
    const endOnGround = this.isGroundRoad(to.x, to.y);
    const endLevel = endOnGround ? 0 : undefined;

    // Use ground level (0) when starting from ground, otherwise respect user's targetLevel
    const actualStartLevel = startOnGround && !startOnElevated ? 0 : targetLevel;

    // Generate path with elevation
    const path = getElevatedPath(from, to, actualStartLevel, targetLevel, endLevel);
    if (!path) return { success: false, reason: 'PATH_TOO_SHORT' };

    // If start cell is an existing ramp, only allow extending in the ascend direction
    let startIsRamp = false;
    if (startOnElevated && path.length >= 2) {
      const existingSeg = this.elevationManager.get(from.x, from.y, actualStartLevel);
      if (existingSeg?.isRamp) {
        const buildDir = getDirectionFlag(path[0]!, path[1]!);
        if (buildDir !== existingSeg.rampAscendDirection) {
          return { success: false, reason: 'RAMP_OCCUPIED' };
        }
        startIsRamp = true;
      }
    }

    // Validate — exclude start cell from collision check if extending from existing segment
    const excludeIndices = new Set<number>();
    if (startOnElevated) excludeIndices.add(0);
    const error = validateElevatedPath(this.grid, this.elevationManager, path,
      excludeIndices.size > 0 ? excludeIndices : undefined);
    if (error) return { success: false, reason: error };

    // Calculate cost
    const baseCost = ROAD_CONFIGS[roadType].cost;
    let totalCost = 0;
    for (const pos of path) {
      if (pos.level === 0 && !pos.isRamp) {
        // Ground level cell — skip cost (already has road, or is landing)
        continue;
      }
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
    const affectedCells: string[] = [];
    for (let i = 0; i < path.length; i++) {
      const pos = path[i]!;
      if (pos.level === 0 && !pos.isRamp) continue; // Ground cell, skip
      if (i === 0 && startIsRamp) continue; // Preserve existing ramp data

      const storeLevel = pos.isRamp ? Math.max(pos.level, pos.targetLevel) : pos.level;
      if (storeLevel === 0) continue; // Don't store in ElevationManager at level 0

      let flags = 0;
      if (i > 0) {
        const prev = path[i - 1]!;
        flags |= getDirectionFlag(pos, prev);
      }
      if (i < path.length - 1) {
        const next = path[i + 1]!;
        flags |= getDirectionFlag(pos, next);
      }

      // Add outward flag for highway edge connection
      if (oob && i === path.length - 1) {
        flags |= oob.outwardFlag;
      }

      // Merge with existing flags at same level
      const existing = this.elevationManager.get(pos.x, pos.y, storeLevel);
      if (existing) {
        flags |= existing.roadFlags;
      }

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
        roadType,
        roadFlags: flags,
        railType: 0,
        railFlags: 0,
        isRamp: pos.isRamp,
        rampAscendDirection: rampAscendDir,
      });

      affectedCells.push(storeLevel > 0 ? `${pos.x},${pos.y},${storeLevel}` : toPosKey(pos.x, pos.y));
    }

    // Update network with elevated node IDs
    if (this.network) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const aLevel = a.isRamp ? Math.max(a.level, a.targetLevel) : a.level;
        const bLevel = b.isRamp ? Math.max(b.level, b.targetLevel) : b.level;
        const aId = this.elevatedNodeId(a.x, a.y, aLevel);
        const bId = this.elevatedNodeId(b.x, b.y, bLevel);
        this.network.addEdge(aId, bId);
      }

      // Connect ramp start to ground network
      const firstElevated = path[0]!;
      if (firstElevated.isRamp && firstElevated.level === 0) {
        const groundId = toPosKey(firstElevated.x, firstElevated.y);
        const elevatedId = this.elevatedNodeId(firstElevated.x, firstElevated.y, firstElevated.targetLevel);
        this.network.addEdge(groundId, elevatedId);
      }

      // Connect end ramp to ground
      if (endLevel === 0 && path.length >= 2) {
        const lastCell = path[path.length - 1]!;
        if (lastCell.level === 0 && !lastCell.isRamp) {
          const prevCell = path[path.length - 2]!;
          if (prevCell.isRamp) {
            const groundId = toPosKey(lastCell.x, lastCell.y);
            const elevatedId = this.elevatedNodeId(prevCell.x, prevCell.y,
              Math.max(prevCell.level, prevCell.targetLevel));
            this.network.addEdge(groundId, elevatedId);
          }
        }
      }
    }

    // Update ground road flags at origin/landing to form proper junctions
    // Origin: path[0] is ground, path[1] is ramp → add flag from origin toward ramp
    if (path.length >= 2 && path[0]!.level === 0 && !path[0]!.isRamp) {
      const origin = path[0]!;
      const ramp = path[1]!;
      const dirFlag = getDirectionFlag(origin, ramp);
      const existing = this.grid.getCell(origin.x, origin.y);
      if (existing) {
        this.grid.setCell(origin.x, origin.y, { roadFlags: existing.roadFlags | dirFlag });
      }
    }
    // Landing: last cell is ground, second-to-last is ramp → add flag from landing toward ramp
    if (endLevel === 0 && path.length >= 2) {
      const landing = path[path.length - 1]!;
      const prevCell = path[path.length - 2]!;
      if (landing.level === 0 && !landing.isRamp) {
        const dirFlag = getDirectionFlag(landing, prevCell);
        const existing = this.grid.getCell(landing.x, landing.y);
        if (existing) {
          this.grid.setCell(landing.x, landing.y, { roadFlags: existing.roadFlags | dirFlag });
        }
      }
    }

    return {
      success: true,
      cost: totalCost,
      affectedCells,
    };
  }

  /**
   * Remove the highest elevated segment at (x, y).
   */
  removeElevated(x: number, y: number): void {
    const highest = this.elevationManager.getHighestLevel(x, y);
    if (highest === 0) return;

    const seg = this.elevationManager.get(x, y, highest);
    this.elevationManager.delete(x, y, highest);

    // Remove from network
    if (this.network) {
      const nodeId = this.elevatedNodeId(x, y, highest);
      this.network.removeNode(nodeId);
    }

    // Update neighboring elevated segments' flags and restore roadType
    for (const dir of CARDINAL_DIRECTIONS) {
      const neighbor = this.elevationManager.get(x + dir.dx, y + dir.dy, highest);
      if (neighbor && neighbor.roadFlags & dir.opposite) {
        const newFlags = neighbor.roadFlags & ~dir.opposite;
        // Restore roadType from remaining connected elevated neighbors
        let maxType = 0;
        for (const d of CARDINAL_DIRECTIONS) {
          if (!(newFlags & d.flag)) continue;
          const nn = this.elevationManager.get(x + dir.dx + d.dx, y + dir.dy + d.dy, highest);
          if (nn && nn.roadType > maxType) maxType = nn.roadType;
        }
        this.elevationManager.set(x + dir.dx, y + dir.dy, highest, {
          ...neighbor,
          roadFlags: newFlags,
          roadType: maxType > 0 ? maxType : neighbor.roadType,
        });
      }
    }

    // If removed segment was a ramp, clear ground road flags pointing to it
    if (seg?.isRamp) {
      for (const dir of CARDINAL_DIRECTIONS) {
        const groundCell = this.grid.getCell(x + dir.dx, y + dir.dy);
        if (groundCell && groundCell.roadType !== RoadType.NONE && (groundCell.roadFlags & dir.opposite)) {
          this.grid.setCell(x + dir.dx, y + dir.dy, {
            roadFlags: groundCell.roadFlags & ~dir.opposite,
          });
        }
      }
    }
  }

  private isGroundRoad(x: number, y: number): boolean {
    const cell = this.grid.getCell(x, y);
    return cell !== null && cell.roadType !== RoadType.NONE;
  }

  private elevatedNodeId(x: number, y: number, level: number): string {
    return level === 0 ? toPosKey(x, y) : `${x},${y},${level}`;
  }
}

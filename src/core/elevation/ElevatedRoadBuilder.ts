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
    const segAtTargetLevel = this.elevationManager.get(from.x, from.y, targetLevel) !== null;
    const startOnElevated = segAtTargetLevel
      || this.elevationManager.hasElevatedSegment(from.x, from.y);

    if (!startOnGround && !startOnElevated) {
      return { success: false, reason: 'START_NOT_ON_ROAD' };
    }

    // Determine end level — auto-ramp down if end is on ground road
    const endOnGround = this.isGroundRoad(to.x, to.y);
    const endLevel = endOnGround ? 0 : undefined;

    // Start from the level the existing structure is ACTUALLY on, not the level
    // currently selected in the toolbar.
    //
    // hasElevatedSegment is true for a segment at any level, so extending a
    // level-1 viaduct with level 2 selected used to start the path at level 2:
    // getElevatedPath derives its ramp count from the level difference, saw
    // none, and emitted a completely flat level-2 run. UnifiedRoadLookup needs
    // one side of a one-level gap to be a ramp, so that run had no lane edge to
    // the viaduct below it — a paid, maintained, rendered road no vehicle could
    // reach. Validation missed it because it only checks same-level occupancy.
    // Feeding the real level in makes getElevatedPath generate the ramps, which
    // also makes 1 -> 2 ramps buildable from an existing viaduct at all
    // (BUG-097).
    // chooseStartLevel picks the level NEAREST the target rather than the
    // highest one present, which also subsumes the segAtTargetLevel case
    // (distance 0 always wins). getHighestLevel was wrong in both directions:
    // with a ground road under a level-3 deck and level 1 selected it started
    // at 3 and descended instead of ramping up off the ground, and a level-1
    // viaduct under a level-3 one could not be extended at all.
    const actualStartLevel = this.elevationManager.chooseStartLevel(
      from.x, from.y, targetLevel, startOnGround,
    );

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
    const crossLevelStart = startOnElevated && !segAtTargetLevel;
    for (let ci = 0; ci < path.length; ci++) {
      const pos = path[ci]!;
      // The cross-level start cell already exists and is left untouched below —
      // charging for it would bill the player twice for the same segment.
      if (ci === 0 && crossLevelStart) continue;
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

      // Never rewrite an existing segment's paid state. Starting the path at the
      // level the structure is actually on (BUG-097) put path[0] on an EXISTING
      // elevated cell for the first time, and this loop then stamped it with the
      // new roadType and cleared railType/railFlags — a free downgrade of a paid
      // HIGHWAY, or the silent deletion of one cell of an elevated railway
      // bridge. That is exactly the rule BUG-096 established two hunks above
      // (BUG-117).
      // Only for a CROSS-LEVEL start. Redrawing a wider road along an existing
      // viaduct at the same level is a legitimate, paid upgrade and must still
      // apply to the first cell.
      const existingAtStart = i === 0 && startOnElevated && !segAtTargetLevel
        ? this.elevationManager.get(pos.x, pos.y, storeLevel)
        : null;

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
        roadType: existingAtStart ? existingAtStart.roadType : roadType,
        roadFlags: flags,
        railType: existingAtStart?.railType ?? 0,
        railFlags: existingAtStart?.railFlags ?? 0,
        isRamp: existingAtStart ? existingAtStart.isRamp : pos.isRamp,
        rampAscendDirection: existingAtStart
          ? existingAtStart.rampAscendDirection : rampAscendDir,
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

    // Update neighboring elevated segments' connection flags only.
    //
    // Deliberately does NOT touch a neighbour's roadType — the elevated twin of
    // BUG-060, which removed the identical heuristic from RoadBuilder. A road's
    // tier is player-paid state, so re-deriving it from "the highest tier still
    // connected" destroyed paid capacity in one direction and granted free
    // upgrades in the other, with no charge, refund or notification. Up here it
    // is worse than on the ground: an elevated segment's roadType also drives
    // its per-tick maintenance, so the player's bill was rewritten too
    // (BUG-096).
    // Scan the removed segment's own level AND the one below it. A ramp joins two
    // levels, so its neighbours can sit either side; checking only `highest` left
    // the lower neighbour pointing at a segment that no longer exists, and the
    // renderer drew a stub of road into empty air. Cross-level ramps could not be
    // built at all before BUG-097, so this only became reachable with it
    // (BUG-118).
    for (const level of [highest, highest - 1]) {
      if (level < 1) continue;
      for (const dir of CARDINAL_DIRECTIONS) {
        const neighbor = this.elevationManager.get(x + dir.dx, y + dir.dy, level);
        if (neighbor && neighbor.roadFlags & dir.opposite) {
          this.elevationManager.set(x + dir.dx, y + dir.dy, level, {
            ...neighbor,
            roadFlags: neighbor.roadFlags & ~dir.opposite,
          });
        }
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

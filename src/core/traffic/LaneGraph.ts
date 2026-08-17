import { RoadType, RoadDirection, getLaneCount, getLaneWidth } from '../road/types';
import { parsePosKeyUnsafe, euclideanDistance } from '../grid/GridHelpers';
import { computeTurnControlPoint as computeTurnCP, approximateQuadraticBezierLength } from './BezierPath';
import {
  DIR_NORTH, DIR_SOUTH, DIR_EAST, DIR_WEST, POINT_ENTRY, POINT_EXIT,
  NO_PREFERRED_LANE, idealTurnLaneInt, turnLanePenaltyInt,
} from './TurnLane';

// ── Types ──

export type Direction = 'north' | 'south' | 'east' | 'west';

export interface ConnectionPoint {
  id: string;
  position: { x: number; y: number };
  tangent: { tx: number; ty: number };
  cellKey: string;
  lane: number;
  direction: Direction;
  type: 'entry' | 'exit';
}

export interface LaneEdge {
  id: string;
  from: ConnectionPoint;
  to: ConnectionPoint;
  bezierControl?: { x: number; y: number }[];
  length: number;
  type: 'straight' | 'turn' | 'lane_change' | 'merge';
  /** Cell key of the intersection cell skipped by cross-intersection turn edges. */
  viaCellKey?: string;
  /**
   * This edge lies inside an intersection cell - the box that has to stay clear.
   *
   * Set for edges traversing a cell with 3 or more road directions: within-cell
   * edges of that cell, and the cross-intersection turn edges that span it. NOT
   * set on the boundary hops into and out of the cell, nor on L-bends: a bend
   * has no cross traffic to block, so queueing through one is fine.
   *
   * Marked here rather than looked up per frame - `VehicleLookahead` reads it
   * once per edge for every vehicle, every render frame.
   */
  insideJunction?: boolean;
}

// ── Helpers ──

const DIR_FLAGS: { dir: Direction; flag: number; dx: number; dy: number }[] = [
  { dir: 'north', flag: RoadDirection.NORTH, dx: 0, dy: -1 },
  { dir: 'south', flag: RoadDirection.SOUTH, dx: 0, dy: 1 },
  { dir: 'east', flag: RoadDirection.EAST, dx: 1, dy: 0 },
  { dir: 'west', flag: RoadDirection.WEST, dx: -1, dy: 0 },
];

const DIRECTION_OPPOSITES: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

function oppositeDir(d: Direction): Direction {
  return DIRECTION_OPPOSITES[d];
}

function dirVec(d: Direction): { dx: number; dy: number } {
  return DIRECTION_VECTORS[d];
}

const parseCellKey = parsePosKeyUnsafe;

/**
 * Direction and point-type codes for the shared turn-lane arithmetic, which
 * works in the integer form the worker's buffer already stores.
 */
const DIR_CODES: Record<Direction, number> = {
  north: DIR_NORTH, south: DIR_SOUTH, east: DIR_EAST, west: DIR_WEST,
};

function pointCode(p: ConnectionPoint): number {
  return p.type === 'exit' ? POINT_EXIT : POINT_ENTRY;
}

/**
 * The lane a turn should be taken from, or null when the edge carries straight
 * on (or reverses) and no lane is preferred. See `TurnLane.ts`.
 */
export function idealTurnLane(edge: LaneEdge, laneCount: number): number | null {
  const ideal = idealTurnLaneInt(
    DIR_CODES[edge.from.direction], pointCode(edge.from),
    DIR_CODES[edge.to.direction], pointCode(edge.to),
    laneCount,
  );
  return ideal === NO_PREFERRED_LANE ? null : ideal;
}

/**
 * Cost added to a turn taken from the wrong lane (BUG-214). See `TurnLane.ts`
 * for the measurements this is calibrated against.
 */
export function turnLanePenalty(edge: LaneEdge, laneCount: number): number {
  return turnLanePenaltyInt(
    DIR_CODES[edge.from.direction], pointCode(edge.from), edge.from.lane,
    DIR_CODES[edge.to.direction], pointCode(edge.to),
    laneCount,
  );
}

/** Check whether a road cell is an intersection (>=3 active directions). */
export function isIntersectionCell(roadFlags: number): boolean {
  let count = 0;
  for (const { flag } of DIR_FLAGS) {
    if (roadFlags & flag) count++;
  }
  return count >= 3;
}


/**
 * Lane geometry rendering constants
 *
 * 車道寬不在這裡 —— 它隨路型變，見 `road/types` 的 `getLaneWidth`。原本是這裡
 * 一個寫死的 0.18，與路寬各算各的，結果六車道的最外側車道有一部分在路面外。
 */
export const LANE_GEOMETRY = {
  /** Number of samples for Bezier length approximation */
  BEZIER_SAMPLES: 10,
} as const;

// ── Grid Lookup Interface ──

export interface GridLookup {
  getCellByKey(key: string): { roadType: number; roadFlags: number } | null;
  getCompatibleNeighborKeys(sourceKey: string, nx: number, ny: number): string[];
}

// ── LaneGraph ──

export class LaneGraph {
  private points = new Map<string, ConnectionPoint>(); // pointId → point
  private cellPoints = new Map<string, string[]>();      // cellKey → pointId[]
  private edges: LaneEdge[] = [];
  private edgeFromIdx = new Map<string, number[]>();     // pointId → edge indices (from)
  private edgeToIdx = new Map<string, number[]>();       // pointId → edge indices (to)

  // ── Public API ──

  buildFromGrid(grid: GridLookup, cellKeys: string[]): void {
    this.clear();
    // Phase 1: generate connection points for all cells
    for (const key of cellKeys) {
      this.generatePointsForCell(grid, key);
    }
    // Phase 2: generate edges
    for (const key of cellKeys) {
      this.generateEdgesForCell(grid, key);
    }
    this.rebuildEdgeIndices();
  }

  updateCells(grid: GridLookup, affectedCellKeys: string[]): void {
    // Collect the wider affected set (include neighbors at all compatible levels)
    const affected = new Set<string>();
    for (const key of affectedCellKeys) {
      affected.add(key);
      const { x, y } = parseCellKey(key);
      for (const d of DIR_FLAGS) {
        for (const nk of grid.getCompatibleNeighborKeys(key, x + d.dx, y + d.dy)) {
          affected.add(nk);
        }
      }
    }

    // Every cell that OWNS an edge which may have changed. generateEdgesForCell(O)
    // emits exactly two kinds of edge: straight edges leaving O, and turn edges
    // passing THROUGH O (whose from/to live in O's neighbours and which record O
    // only in viaCellKey). So an edge's owner is `viaCellKey ?? from.cellKey`, and
    // both kinds of owner sit at most one ring outside the points being rebuilt.
    //
    // The previous implementation deleted every edge leaving a border cell and
    // then called generateEdgesForCell on it — which can never recreate a turn
    // that merely originates there, permanently stranding the branch (BUG-054).
    const owners = new Set<string>(affected);
    for (const key of affected) {
      const { x, y } = parseCellKey(key);
      for (const d of DIR_FLAGS) {
        for (const nk of grid.getCompatibleNeighborKeys(key, x + d.dx, y + d.dy)) {
          owners.add(nk);
        }
      }
    }

    // Points belong to their own cell; edges are dropped by ownership, so an
    // edge is never deleted by one pass and left for another to recreate.
    for (const key of affected) {
      this.removeCellPoints(key);
    }
    this.edges = this.edges.filter(e => !owners.has(e.viaCellKey ?? e.from.cellKey));

    for (const key of affected) {
      this.generatePointsForCell(grid, key);
    }
    for (const key of owners) {
      this.generateEdgesForCell(grid, key);
    }

    this.rebuildEdgeIndices();
  }

  getConnectionPoints(cellKey: string): ConnectionPoint[] {
    const ids = this.cellPoints.get(cellKey);
    if (!ids) return [];
    return ids.map(id => this.points.get(id)!).filter(Boolean);
  }

  getEdgesBetween(fromCell: string, toCell: string): LaneEdge[] {
    return this.edges.filter(
      e => e.from.cellKey === fromCell && e.to.cellKey === toCell
    );
  }

  getAllEdges(): LaneEdge[] {
    return this.edges;
  }

  getEdgesFrom(pointId: string): LaneEdge[] {
    const idxs = this.edgeFromIdx.get(pointId);
    if (!idxs) return [];
    return idxs.map(i => this.edges[i]!);
  }

  getEdgesTo(pointId: string): LaneEdge[] {
    const idxs = this.edgeToIdx.get(pointId);
    if (!idxs) return [];
    return idxs.map(i => this.edges[i]!);
  }

  getPoint(pointId: string): ConnectionPoint | undefined {
    return this.points.get(pointId);
  }

  // ── Internal ──

  private clear(): void {
    this.points.clear();
    this.cellPoints.clear();
    this.edges = [];
    this.edgeFromIdx.clear();
    this.edgeToIdx.clear();
  }

  /**
   * Drop a cell's connection points. Edges are NOT touched here — updateCells
   * removes them by ownership so that no edge can be deleted by one pass and
   * left unrecreated by another (BUG-054).
   */
  private removeCellPoints(cellKey: string): void {
    const ids = this.cellPoints.get(cellKey);
    if (ids) {
      for (const id of ids) this.points.delete(id);
    }
    this.cellPoints.delete(cellKey);
  }

  private generatePointsForCell(grid: GridLookup, cellKey: string): void {
    const cell = grid.getCellByKey(cellKey);
    if (!cell || cell.roadType === RoadType.NONE) return;
    const { x, y } = parseCellKey(cellKey);


    const dirLanes = getLaneCount(cell.roadType);
    const pointIds: string[] = [];

    // Lane offset: perpendicular displacement from road center.
    // For direction D with lane index L:
    //   perpendicular "right" of travel direction = lateral offset
    //   This separates opposing traffic and multi-lane same-direction traffic.
    //
    // 車道寬隨路型變 —— 六車道要在同樣的半幅路面裡塞三條，所以每條比四車道窄。
    const LANE_WIDTH = getLaneWidth(cell.roadType);

    for (const { dir, flag } of DIR_FLAGS) {
      if (!(cell.roadFlags & flag)) continue;

      for (let lane = 0; lane < dirLanes; lane++) {
        const entryId = `${cellKey}:${dir}:${lane}:entry`;
        const exitId = `${cellKey}:${dir}:${lane}:exit`;

        const v = dirVec(dir);
        // Entry(dir) = vehicle arrives FROM direction `dir`, traveling in opposite(dir)
        // Exit(dir)  = vehicle leaves TOWARDS direction `dir`, traveling in `dir`
        //
        // Lane offset: perpendicular right-hand side of TRAVEL direction.
        // Exit travels in `dir`: right-of-dir
        const exitPerpX = -v.dy;
        const exitPerpY = v.dx;
        // Entry's travel direction = opposite(dir): right-of-opposite(dir) = LEFT-of-dir
        const entryPerpX = v.dy;
        const entryPerpY = -v.dx;

        const lateralOffset = (lane + 0.5) * LANE_WIDTH;

        const entryPos = {
          x: x + v.dx * 0.4 + entryPerpX * lateralOffset,
          y: y + v.dy * 0.4 + entryPerpY * lateralOffset,
        };
        const exitPos = {
          x: x + v.dx * 0.5 + exitPerpX * lateralOffset,
          y: y + v.dy * 0.5 + exitPerpY * lateralOffset,
        };

        const entryPoint: ConnectionPoint = {
          id: entryId,
          position: entryPos,
          tangent: { tx: -v.dx, ty: -v.dy }, // pointing inward
          cellKey,
          lane,
          direction: dir,
          type: 'entry',
        };

        const exitPoint: ConnectionPoint = {
          id: exitId,
          position: exitPos,
          tangent: { tx: v.dx, ty: v.dy }, // pointing outward
          cellKey,
          lane,
          direction: dir,
          type: 'exit',
        };

        this.points.set(entryId, entryPoint);
        this.points.set(exitId, exitPoint);
        pointIds.push(entryId, exitId);
      }
    }

    this.cellPoints.set(cellKey, pointIds);
  }

  private generateEdgesForCell(grid: GridLookup, cellKey: string): void {
    const { x, y } = parseCellKey(cellKey);
    const cell = grid.getCellByKey(cellKey);
    if (!cell || cell.roadType === RoadType.NONE) return;


    const dirLanes = getLaneCount(cell.roadType);
    const activeDirections = DIR_FLAGS.filter(d => cell.roadFlags & d.flag);
    // Everything generated for this cell that stays inside it is "in the box".
    const junction = isIntersectionCell(cell.roadFlags);

    // Track which turn pairs are handled by cross-intersection edges
    // so within-cell turn edges can be skipped for those pairs.
    const handledTurns = this.generateCrossIntersectionTurns(grid, cellKey, x, y, activeDirections, dirLanes, junction);

    this.generateStraightEdges(grid, cellKey, x, y, cell, activeDirections, dirLanes, junction, handledTurns);

    // Lane change edges (within cell, same direction, adjacent lanes)
    if (dirLanes > 1) {
      this.generateLaneChangeEdges(cellKey, activeDirections, dirLanes, junction);
    }
  }

  /**
   * Generate cross-intersection turn edges: approach cell exit → departure cell entry.
   * These span the full turn arc through the intersection, producing a long smooth Bézier
   * instead of three short edges (cross-cell + within-cell turn + cross-cell).
   * Returns a Set of handled turn pairs ("entryDir>exitDir") so within-cell turns can be skipped.
   */
  private generateCrossIntersectionTurns(
    grid: GridLookup,
    cellKey: string,
    x: number, y: number,
    activeDirections: typeof DIR_FLAGS,
    dirLanes: number,
    junction: boolean,
  ): Set<string> {
    const handled = new Set<string>();

    for (const entryD of activeDirections) {
      for (const exitD of activeDirections) {
        // Only turns: entry dir ≠ exit dir and not straight-through
        if (entryD.dir === exitD.dir) continue;
        if (entryD.dir === oppositeDir(exitD.dir)) continue;

        // Approach cell: the cell the vehicle comes FROM (in the entry direction)
        const approachX = x + entryD.dx, approachY = y + entryD.dy;
        const approachKeys = grid.getCompatibleNeighborKeys(cellKey, approachX, approachY);

        // Departure cell: the cell the vehicle goes TO (in the exit direction)
        const departX = x + exitD.dx, departY = y + exitD.dy;
        const departKeys = grid.getCompatibleNeighborKeys(cellKey, departX, departY);

        if (approachKeys.length === 0 || departKeys.length === 0) continue;

        // For each compatible approach-departure pair, generate cross-intersection edges
        for (const approachKey of approachKeys) {
          const approachCell = grid.getCellByKey(approachKey);
          if (!approachCell || approachCell.roadType === RoadType.NONE) continue;

          for (const departKey of departKeys) {
            const departCell = grid.getCellByKey(departKey);
            if (!departCell || departCell.roadType === RoadType.NONE) continue;

            const approachLanes = getLaneCount(approachCell.roadType);
            const departLanes = getLaneCount(departCell.roadType);
            const minLanes = Math.min(dirLanes, approachLanes, departLanes);

            // Compute reference length from lane 0 for uniform cost across all lanes
            const approachExitDir = oppositeDir(entryD.dir);
            const departEntryDir = oppositeDir(exitD.dir);
            const ref0FromId = `${approachKey}:${approachExitDir}:0:exit`;
            const ref0ToId = `${departKey}:${departEntryDir}:0:entry`;
            const ref0From = this.points.get(ref0FromId);
            const ref0To = this.points.get(ref0ToId);
            if (!ref0From || !ref0To) continue;

            const ref0Cp = this.computeTurnControlPoint(ref0From, ref0To);
            const refLength = Math.max(
              this.approxBezierLength(ref0From.position, ref0Cp, ref0To.position),
              0.1,
            );

            for (let lane = 0; lane < minLanes; lane++) {
              const fromId = `${approachKey}:${approachExitDir}:${lane}:exit`;
              const toId = `${departKey}:${departEntryDir}:${lane}:entry`;
              const fromPt = this.points.get(fromId);
              const toPt = this.points.get(toId);
              if (!fromPt || !toPt) continue;

              const edgeId = `xt:${fromId}>${toId}`;
              if (this.edges.some(e => e.id === edgeId)) continue;

              const cp = this.computeTurnControlPoint(fromPt, toPt);
              this.edges.push({
                id: edgeId,
                from: fromPt,
                to: toPt,
                bezierControl: [cp],
                length: refLength,
                type: 'turn',
                viaCellKey: cellKey,
                ...(junction ? { insideJunction: true } : {}),
              });
            }
          }
        }

        handled.add(`${entryD.dir}>${exitD.dir}`);
      }
    }

    return handled;
  }

  private generateStraightEdges(
    grid: GridLookup,
    cellKey: string,
    x: number, y: number,
    cell: { roadType: RoadType; roadFlags: number },
    activeDirections: typeof DIR_FLAGS,
    dirLanes: number,
    junction: boolean,
    handledTurns?: Set<string>,
  ): void {
    // Within-cell traversal edges: entry[otherDir] → exit[dir]
    // Turn edges are skipped if already handled by cross-intersection edges.
    // For fallback turn edges (no neighbor), all lane combinations use a uniform base length
    // (from lane 0→0) so Dijkstra's choice is driven by speed multiplier + penalty, not geometry.
    for (const { dir } of activeDirections) {
      for (const otherD of activeDirections) {
        if (otherD.dir === dir) continue;

        const isTurn = otherD.dir !== oppositeDir(dir);

        // Skip within-cell turn if cross-intersection edge already handles it
        if (isTurn && handledTurns?.has(`${otherD.dir}>${dir}`)) continue;

        // Compute reference length from lane 0→0 for uniform turn cost
        let refLength = 0.5; // fallback
        if (isTurn) {
          const ref0From = this.points.get(`${cellKey}:${otherD.dir}:0:entry`);
          const ref0To = this.points.get(`${cellKey}:${dir}:0:exit`);
          if (ref0From && ref0To) {
            const cp = this.computeTurnControlPoint(ref0From, ref0To);
            refLength = Math.max(this.approxBezierLength(ref0From.position, cp, ref0To.position), 0.1);
          }
        }

        for (let lane = 0; lane < dirLanes; lane++) {
          const fromId = `${cellKey}:${otherD.dir}:${lane}:entry`;
          const toId = `${cellKey}:${dir}:${lane}:exit`;
          const fromPt = this.points.get(fromId);
          const toPt = this.points.get(toId);
          if (!fromPt || !toPt) continue;

          const edgeId = `${fromId}>${toId}`;
          if (this.edges.some(e => e.id === edgeId)) continue;

          if (isTurn) {
            const cp = this.computeTurnControlPoint(fromPt, toPt);
            this.edges.push({
              id: edgeId,
              from: fromPt,
              to: toPt,
              bezierControl: [cp],
              length: refLength,
              type: 'turn',
              ...(junction ? { insideJunction: true } : {}),
            });
          } else {
            const length = euclideanDistance(fromPt.position.x, fromPt.position.y, toPt.position.x, toPt.position.y);
            this.edges.push({
              id: edgeId,
              from: fromPt,
              to: toPt,
              length: Math.max(length, 0.1),
              type: 'straight',
              ...(junction ? { insideJunction: true } : {}),
            });
          }
        }
      }
    }

    // Cross-cell edges: exit → neighbor entry
    for (const { dir, dx, dy } of activeDirections) {
      const nx = x + dx, ny = y + dy;
      const neighborKeys = grid.getCompatibleNeighborKeys(cellKey, nx, ny);
      if (neighborKeys.length === 0) continue;

      for (const neighborKey of neighborKeys) {
        const neighbor = grid.getCellByKey(neighborKey);
        if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

        const neighborDirLanes = getLaneCount(neighbor.roadType);
        const oppositeDirection = oppositeDir(dir);

        // Same-lane connections to non-intersection neighbors
        const minLanes = Math.min(dirLanes, neighborDirLanes);
        for (let lane = 0; lane < minLanes; lane++) {
          const exitId = `${cellKey}:${dir}:${lane}:exit`;
          const entryId = `${neighborKey}:${oppositeDirection}:${lane}:entry`;

          const fromPt = this.points.get(exitId);
          const toPt = this.points.get(entryId);
          if (!fromPt || !toPt) continue;

          const length = euclideanDistance(fromPt.position.x, fromPt.position.y, toPt.position.x, toPt.position.y);
          this.edges.push({
            id: `${exitId}>${entryId}`,
            from: fromPt,
            to: toPt,
            length: Math.max(length, 0.1),
            type: 'straight',
          });
        }
      }
    }
  }

  private generateLaneChangeEdges(
    cellKey: string,
    activeDirections: typeof DIR_FLAGS,
    dirLanes: number,
    junction: boolean,
  ): void {
    // For each (entryDir, exitDir) traversal pair, add adjacent-lane change edges.
    // At L-bends/turns, lane_change edges use the same uniform length as the
    // same-lane turn edge, so Dijkstra doesn't favor cross-lane due to geometry.
    for (const inDir of activeDirections) {
      for (const outDir of activeDirections) {
        if (inDir.dir === outDir.dir) continue; // no U-turn

        // Compute reference length from lane 0 same-lane turn for uniform cost
        const isTurn = inDir.dir !== oppositeDir(outDir.dir);
        let refLength = 0;
        if (isTurn) {
          const ref0From = this.points.get(`${cellKey}:${inDir.dir}:0:entry`);
          const ref0To = this.points.get(`${cellKey}:${outDir.dir}:0:exit`);
          if (ref0From && ref0To) {
            const cp = this.computeTurnControlPoint(ref0From, ref0To);
            refLength = Math.max(this.approxBezierLength(ref0From.position, cp, ref0To.position), 0.3);
          }
        }

        for (let lane = 0; lane < dirLanes - 1; lane++) {
          // lane → lane+1
          const fromId = `${cellKey}:${inDir.dir}:${lane}:entry`;
          const toId = `${cellKey}:${outDir.dir}:${lane + 1}:exit`;
          const fromPt = this.points.get(fromId);
          const toPt = this.points.get(toId);
          if (fromPt && toPt) {
            const edgeId = `lc:${fromId}>${toId}`;
            if (!this.edges.some(e => e.id === edgeId)) {
              const length = isTurn ? refLength
                : Math.max(euclideanDistance(fromPt.position.x, fromPt.position.y, toPt.position.x, toPt.position.y), 0.3);
              const edge: LaneEdge = { id: edgeId, from: fromPt, to: toPt, length, type: 'lane_change' };
              if (junction) edge.insideJunction = true;
              if (isTurn) edge.bezierControl = [this.computeTurnControlPoint(fromPt, toPt)];
              this.edges.push(edge);
            }
          }

          // lane+1 → lane
          const fromId2 = `${cellKey}:${inDir.dir}:${lane + 1}:entry`;
          const toId2 = `${cellKey}:${outDir.dir}:${lane}:exit`;
          const fromPt2 = this.points.get(fromId2);
          const toPt2 = this.points.get(toId2);
          if (fromPt2 && toPt2) {
            const edgeId2 = `lc:${fromId2}>${toId2}`;
            if (!this.edges.some(e => e.id === edgeId2)) {
              const length2 = isTurn ? refLength
                : Math.max(euclideanDistance(fromPt2.position.x, fromPt2.position.y, toPt2.position.x, toPt2.position.y), 0.3);
              const edge2: LaneEdge = { id: edgeId2, from: fromPt2, to: toPt2, length: length2, type: 'lane_change' };
              if (junction) edge2.insideJunction = true;
              if (isTurn) edge2.bezierControl = [this.computeTurnControlPoint(fromPt2, toPt2)];
              this.edges.push(edge2);
            }
          }
        }
      }
    }
  }

  /** Delegate to shared BezierPath.computeTurnControlPoint (DRY). */
  private computeTurnControlPoint(
    from: ConnectionPoint,
    to: ConnectionPoint,
  ): { x: number; y: number } {
    return computeTurnCP(
      from.position,
      { x: from.tangent.tx, y: from.tangent.ty },
      to.position,
      { x: to.tangent.tx, y: to.tangent.ty },
    );
  }

  /** Delegate to shared BezierPath.approximateQuadraticBezierLength (DRY). */
  private approxBezierLength(
    p0: { x: number; y: number },
    cp: { x: number; y: number },
    p2: { x: number; y: number },
  ): number {
    return approximateQuadraticBezierLength(p0, cp, p2, LANE_GEOMETRY.BEZIER_SAMPLES);
  }

  private rebuildEdgeIndices(): void {
    this.edgeFromIdx.clear();
    this.edgeToIdx.clear();
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i]!;
      let fromArr = this.edgeFromIdx.get(e.from.id);
      if (!fromArr) { fromArr = []; this.edgeFromIdx.set(e.from.id, fromArr); }
      fromArr.push(i);

      let toArr = this.edgeToIdx.get(e.to.id);
      if (!toArr) { toArr = []; this.edgeToIdx.set(e.to.id, toArr); }
      toArr.push(i);
    }
  }
}

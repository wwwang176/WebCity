import { RoadType, RoadDirection } from '../road/types';
import { getLaneCount } from './TrafficSimulation';
import { parsePosKeyUnsafe, toPosKey, euclideanDistance } from '../grid/GridHelpers';

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


/** Lane geometry rendering constants */
export const LANE_GEOMETRY = {
  /** Lateral offset per lane (cells) */
  LANE_WIDTH: 0.18,
  /** Number of samples for Bezier length approximation */
  BEZIER_SAMPLES: 10,
} as const;

// ── Grid Lookup Interface ──

export interface GridLookup {
  getCell(x: number, y: number): { roadType: RoadType; roadFlags: number } | null;
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
    // Collect the wider affected set (include neighbors)
    const affected = new Set<string>();
    for (const key of affectedCellKeys) {
      affected.add(key);
      const { x, y } = parseCellKey(key);
      for (const d of DIR_FLAGS) {
        affected.add(toPosKey(x + d.dx, y + d.dy));
      }
    }

    // Remove old points + edges for affected cells
    for (const key of affected) {
      this.removeCellData(key);
    }

    // Regenerate points
    for (const key of affected) {
      this.generatePointsForCell(grid, key);
    }

    // Regenerate edges
    for (const key of affected) {
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

  private removeCellData(cellKey: string): void {
    const ids = this.cellPoints.get(cellKey);
    if (ids) {
      for (const id of ids) this.points.delete(id);
    }
    this.cellPoints.delete(cellKey);
    // Remove edges involving this cell
    this.edges = this.edges.filter(
      e => e.from.cellKey !== cellKey && e.to.cellKey !== cellKey
    );
  }

  private generatePointsForCell(grid: GridLookup, cellKey: string): void {
    const { x, y } = parseCellKey(cellKey);
    const cell = grid.getCell(x, y);
    if (!cell || cell.roadType === RoadType.NONE) return;

    const dirLanes = getLaneCount(cell.roadType);
    const pointIds: string[] = [];

    // Lane offset: perpendicular displacement from road center.
    // For direction D with lane index L:
    //   perpendicular "right" of travel direction = lateral offset
    //   This separates opposing traffic and multi-lane same-direction traffic.
    const LANE_WIDTH = LANE_GEOMETRY.LANE_WIDTH;

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
    const cell = grid.getCell(x, y);
    if (!cell || cell.roadType === RoadType.NONE) return;

    const dirLanes = getLaneCount(cell.roadType);
    const activeDirections = DIR_FLAGS.filter(d => cell.roadFlags & d.flag);
    const isIntersection = activeDirections.length >= 3;

    if (isIntersection) {
      this.generateIntersectionEdges(grid, cellKey, x, y, cell, activeDirections);
    } else {
      this.generateStraightEdges(grid, cellKey, x, y, cell, activeDirections, dirLanes);
    }

    // Lane change edges (within cell, same direction, adjacent lanes)
    if (dirLanes > 1) {
      this.generateLaneChangeEdges(cellKey, activeDirections, dirLanes);
    }
  }

  private generateStraightEdges(
    grid: GridLookup,
    cellKey: string,
    x: number, y: number,
    cell: { roadType: RoadType; roadFlags: number },
    activeDirections: typeof DIR_FLAGS,
    dirLanes: number,
  ): void {
    // For a straight/curve segment: connect exit → neighbor entry
    for (const { dir, dx, dy } of activeDirections) {
      const neighborKey = toPosKey(x + dx, y + dy);
      const neighbor = grid.getCell(x + dx, y + dy);
      if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

      const neighborDirLanes = getLaneCount(neighbor.roadType);
      const oppositeDirection = oppositeDir(dir);

      // Connect: this cell exit[dir] → neighbor entry[oppositeDir] (same-lane only)
      // Straight segments use same-lane connections; lane changes happen within
      // the cell via lane_change edges, not at the cell boundary.
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

      // Also connect within cell: entry[oppositeDir] → exit[dir] (traversal through cell)
      for (let lane = 0; lane < dirLanes; lane++) {
        for (const otherD of activeDirections) {
          if (otherD.dir === dir) continue;
          const fromId = `${cellKey}:${otherD.dir}:${lane}:entry`;
          const toId = `${cellKey}:${dir}:${lane}:exit`;
          const fromPt = this.points.get(fromId);
          const toPt = this.points.get(toId);
          if (!fromPt || !toPt) continue;

          const edgeId = `${fromId}>${toId}`;
          if (this.edges.some(e => e.id === edgeId)) continue;

          // L-bend (non-opposite directions): create turn edge with bezier
          if (otherD.dir !== oppositeDir(dir)) {
            const cp = this.computeTurnControlPoint(fromPt, toPt);
            const length = this.approximateQuadraticBezierLength(
              fromPt.position, cp, toPt.position
            );
            this.edges.push({
              id: edgeId,
              from: fromPt,
              to: toPt,
              bezierControl: [cp],
              length: Math.max(length, 0.1),
              type: 'turn',
            });
          } else {
            // Straight through: keep as straight
            const length = euclideanDistance(fromPt.position.x, fromPt.position.y, toPt.position.x, toPt.position.y);
            this.edges.push({
              id: edgeId,
              from: fromPt,
              to: toPt,
              length: Math.max(length, 0.1),
              type: 'straight',
            });
          }
        }
      }
    }
  }

  private generateIntersectionEdges(
    grid: GridLookup,
    cellKey: string,
    x: number, y: number,
    cell: { roadType: RoadType; roadFlags: number },
    activeDirections: typeof DIR_FLAGS,
  ): void {
    const dirLanes = getLaneCount(cell.roadType);

    // For each incoming direction → each outgoing direction (except U-turn)
    for (const inDir of activeDirections) {
      for (const outDir of activeDirections) {
        if (inDir.dir === outDir.dir) continue; // no U-turn

        for (let lane = 0; lane < dirLanes; lane++) {
          // Entry from inDir, exit to outDir
          const fromId = `${cellKey}:${inDir.dir}:${lane}:entry`;
          const toId = `${cellKey}:${outDir.dir}:${lane}:exit`;
          const fromPt = this.points.get(fromId);
          const toPt = this.points.get(toId);
          if (!fromPt || !toPt) continue;

          // Compute single quadratic Bezier control point (tangent intersection)
          const cp = this.computeTurnControlPoint(fromPt, toPt);

          // Approximate length using quadratic Bezier
          const length = this.approximateQuadraticBezierLength(
            fromPt.position, cp, toPt.position
          );

          this.edges.push({
            id: `${fromId}>${toId}`,
            from: fromPt,
            to: toPt,
            bezierControl: [cp],
            length: Math.max(length, 0.1),
            type: 'turn',
          });
        }
      }
    }

    // Connect exit points to neighbor entries (all-to-all at intersections)
    // Every exit lane can reach every neighbor entry lane, enabling smooth
    // transitions between roads of different widths (e.g. FOUR_LANE → TWO_LANE).
    for (const { dir, dx, dy } of activeDirections) {
      const neighborKey = toPosKey(x + dx, y + dy);
      const neighbor = grid.getCell(x + dx, y + dy);
      if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

      const neighborDirLanes = getLaneCount(neighbor.roadType);
      const oppositeDirection = oppositeDir(dir);

      for (let exitLane = 0; exitLane < dirLanes; exitLane++) {
        for (let entryLane = 0; entryLane < neighborDirLanes; entryLane++) {
          const exitId = `${cellKey}:${dir}:${exitLane}:exit`;
          const entryId = `${neighborKey}:${oppositeDirection}:${entryLane}:entry`;
          const fromPt = this.points.get(exitId);
          const toPt = this.points.get(entryId);
          if (!fromPt || !toPt) continue;

          const edgeId = `${exitId}>${entryId}`;
          this.pushEdgeIfNew(edgeId, fromPt, toPt, 'straight', 0.1);
        }
      }
    }
  }

  private generateLaneChangeEdges(
    cellKey: string,
    activeDirections: typeof DIR_FLAGS,
    dirLanes: number,
  ): void {
    // For each (entryDir, exitDir) traversal pair, add adjacent-lane change edges.
    // e.g. eastbound: entry[west:0] → exit[east:1] (change to outer lane while moving forward)
    for (const inDir of activeDirections) {
      for (const outDir of activeDirections) {
        if (inDir.dir === outDir.dir) continue; // no U-turn
        for (let lane = 0; lane < dirLanes - 1; lane++) {
          // lane → lane+1
          const fromId = `${cellKey}:${inDir.dir}:${lane}:entry`;
          const toId = `${cellKey}:${outDir.dir}:${lane + 1}:exit`;
          const fromPt = this.points.get(fromId);
          const toPt = this.points.get(toId);
          if (fromPt && toPt) {
            const edgeId = `lc:${fromId}>${toId}`;
            if (!this.edges.some(e => e.id === edgeId)) {
              const length = euclideanDistance(fromPt.position.x, fromPt.position.y, toPt.position.x, toPt.position.y);
              this.edges.push({
                id: edgeId,
                from: fromPt,
                to: toPt,
                length: Math.max(length, 0.3),
                type: 'lane_change',
              });
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
              const length2 = euclideanDistance(fromPt2.position.x, fromPt2.position.y, toPt2.position.x, toPt2.position.y);
              this.edges.push({
                id: edgeId2,
                from: fromPt2,
                to: toPt2,
                length: Math.max(length2, 0.3),
                type: 'lane_change',
              });
            }
          }
        }
      }
    }
  }

  private computeTurnControlPoint(
    from: ConnectionPoint,
    to: ConnectionPoint,
  ): { x: number; y: number } {
    // Single control point at the intersection of entry and exit tangent lines
    const entryDir = { x: from.tangent.tx, y: from.tangent.ty };
    const exitDir = { x: to.tangent.tx, y: to.tangent.ty };
    const det = entryDir.x * exitDir.y - entryDir.y * exitDir.x;
    if (Math.abs(det) < 1e-6) {
      // Parallel (straight-through): use midpoint
      return {
        x: (from.position.x + to.position.x) / 2,
        y: (from.position.y + to.position.y) / 2,
      };
    }
    const dx = to.position.x - from.position.x;
    const dy = to.position.y - from.position.y;
    const t = (dx * exitDir.y - dy * exitDir.x) / det;
    return {
      x: from.position.x + t * entryDir.x,
      y: from.position.y + t * entryDir.y,
    };
  }

  /** Push a straight edge only if no edge with the same ID exists yet. */
  private pushEdgeIfNew(
    id: string,
    from: ConnectionPoint,
    to: ConnectionPoint,
    type: LaneEdge['type'],
    minLength: number,
  ): void {
    if (this.edges.some(e => e.id === id)) return;
    const length = euclideanDistance(from.position.x, from.position.y, to.position.x, to.position.y);
    this.edges.push({ id, from, to, length: Math.max(length, minLength), type });
  }

  private approximateQuadraticBezierLength(
    p0: { x: number; y: number },
    cp: { x: number; y: number },
    p2: { x: number; y: number },
  ): number {
    const N = LANE_GEOMETRY.BEZIER_SAMPLES;
    let length = 0;
    let prevX = p0.x, prevY = p0.y;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const u = 1 - t;
      const x = u * u * p0.x + 2 * u * t * cp.x + t * t * p2.x;
      const y = u * u * p0.y + 2 * u * t * cp.y + t * t * p2.y;
      const dx = x - prevX, dy = y - prevY;
      length += Math.sqrt(dx * dx + dy * dy);
      prevX = x;
      prevY = y;
    }
    return length;
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

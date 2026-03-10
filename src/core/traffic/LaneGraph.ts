import { RoadType, RoadDirection } from '../road/types';
import { getLaneCount } from './TrafficSimulation';

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

function oppositeDir(d: Direction): Direction {
  switch (d) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east': return 'west';
    case 'west': return 'east';
  }
}

function dirVec(d: Direction): { dx: number; dy: number } {
  switch (d) {
    case 'north': return { dx: 0, dy: -1 };
    case 'south': return { dx: 0, dy: 1 };
    case 'east': return { dx: 1, dy: 0 };
    case 'west': return { dx: -1, dy: 0 };
  }
}

function parseCellKey(key: string): { x: number; y: number } {
  const [xs, ys] = key.split(',');
  return { x: Number(xs), y: Number(ys) };
}

function countFlags(flags: number): number {
  let n = 0;
  for (const d of DIR_FLAGS) if (flags & d.flag) n++;
  return n;
}

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
        affected.add(`${x + d.dx},${y + d.dy}`);
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
    const LANE_WIDTH = 0.18; // lateral offset per lane

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
      const neighborKey = `${x + dx},${y + dy}`;
      const neighbor = grid.getCell(x + dx, y + dy);
      if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

      const neighborDirLanes = getLaneCount(neighbor.roadType);
      const oppositeDirection = oppositeDir(dir);

      // Connect: this cell exit[dir][lane] → neighbor entry[oppositeDir][lane]
      const minLanes = Math.min(dirLanes, neighborDirLanes);
      for (let lane = 0; lane < minLanes; lane++) {
        const exitId = `${cellKey}:${dir}:${lane}:exit`;
        const entryId = `${neighborKey}:${oppositeDirection}:${lane}:entry`;

        const fromPt = this.points.get(exitId);
        const toPt = this.points.get(entryId);
        if (!fromPt || !toPt) continue;

        const edgeDx = toPt.position.x - fromPt.position.x;
        const edgeDy = toPt.position.y - fromPt.position.y;
        const length = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

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
        // Traffic entering from the opposite side exits in this direction
        // But only if there IS an opposite direction connection
        for (const otherD of activeDirections) {
          if (otherD.dir === dir) continue;
          const fromId = `${cellKey}:${otherD.dir}:${lane}:entry`;
          const toId = `${cellKey}:${dir}:${lane}:exit`;
          const fromPt = this.points.get(fromId);
          const toPt = this.points.get(toId);
          if (!fromPt || !toPt) continue;

          // Avoid duplicating: only create if not already an intersection
          // For straight road (2 directions), this is a through-connection
          const edgeDx = toPt.position.x - fromPt.position.x;
          const edgeDy = toPt.position.y - fromPt.position.y;
          const length = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

          const edgeId = `${fromId}>${toId}`;
          if (!this.edges.some(e => e.id === edgeId)) {
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

          // Generate Bezier control points for the turn
          const bezierControl = this.computeTurnBezier(fromPt, toPt, x, y);

          // Approximate length using control points
          const length = this.approximateBezierLength(
            fromPt.position, bezierControl[0]!, bezierControl[1]!, toPt.position
          );

          this.edges.push({
            id: `${fromId}>${toId}`,
            from: fromPt,
            to: toPt,
            bezierControl,
            length: Math.max(length, 0.1),
            type: 'turn',
          });
        }
      }
    }

    // Also connect exit points to neighbor entries (same as straight)
    for (const { dir, dx, dy } of activeDirections) {
      const neighborKey = `${x + dx},${y + dy}`;
      const neighbor = grid.getCell(x + dx, y + dy);
      if (!neighbor || neighbor.roadType === RoadType.NONE) continue;

      const neighborDirLanes = getLaneCount(neighbor.roadType);
      const oppositeDirection = oppositeDir(dir);
      const minLanes = Math.min(dirLanes, neighborDirLanes);

      for (let lane = 0; lane < minLanes; lane++) {
        const exitId = `${cellKey}:${dir}:${lane}:exit`;
        const entryId = `${neighborKey}:${oppositeDirection}:${lane}:entry`;
        const fromPt = this.points.get(exitId);
        const toPt = this.points.get(entryId);
        if (!fromPt || !toPt) continue;

        const edgeDx = toPt.position.x - fromPt.position.x;
        const edgeDy = toPt.position.y - fromPt.position.y;
        const length = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

        const edgeId = `${exitId}>${entryId}`;
        if (!this.edges.some(e => e.id === edgeId)) {
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

  private generateLaneChangeEdges(
    cellKey: string,
    activeDirections: typeof DIR_FLAGS,
    dirLanes: number,
  ): void {
    // For each direction pair that forms a through-route, add lane change edges
    for (const d of activeDirections) {
      for (let lane = 0; lane < dirLanes - 1; lane++) {
        // lane → lane+1
        const fromId = `${cellKey}:${d.dir}:${lane}:entry`;
        const toId = `${cellKey}:${d.dir}:${lane + 1}:exit`;
        const fromPt = this.points.get(fromId);
        const toPt = this.points.get(toId);
        if (!fromPt || !toPt) continue;

        const dx = toPt.position.x - fromPt.position.x;
        const dy = toPt.position.y - fromPt.position.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        this.edges.push({
          id: `lc:${fromId}>${toId}`,
          from: fromPt,
          to: toPt,
          length: Math.max(length, 0.3),
          type: 'lane_change',
        });

        // lane+1 → lane
        const fromId2 = `${cellKey}:${d.dir}:${lane + 1}:entry`;
        const toId2 = `${cellKey}:${d.dir}:${lane}:exit`;
        const fromPt2 = this.points.get(fromId2);
        const toPt2 = this.points.get(toId2);
        if (!fromPt2 || !toPt2) continue;

        const dx2 = toPt2.position.x - fromPt2.position.x;
        const dy2 = toPt2.position.y - fromPt2.position.y;
        const length2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        this.edges.push({
          id: `lc:${fromId2}>${toId2}`,
          from: fromPt2,
          to: toPt2,
          length: Math.max(length2, 0.3),
          type: 'lane_change',
        });
      }
    }
  }

  private computeTurnBezier(
    from: ConnectionPoint,
    to: ConnectionPoint,
    cx: number, cy: number,
  ): { x: number; y: number }[] {
    // Control points: extend tangent from entry, then curve towards exit
    const strength = 0.35; // bezier handle length
    const cp1 = {
      x: from.position.x + from.tangent.tx * strength,
      y: from.position.y + from.tangent.ty * strength,
    };
    const cp2 = {
      x: to.position.x - to.tangent.tx * strength,
      y: to.position.y - to.tangent.ty * strength,
    };
    return [cp1, cp2];
  }

  private approximateBezierLength(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
  ): number {
    // Approximate by sampling N points
    const N = 10;
    let length = 0;
    let prevX = p0.x, prevY = p0.y;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const u = 1 - t;
      const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
      const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
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

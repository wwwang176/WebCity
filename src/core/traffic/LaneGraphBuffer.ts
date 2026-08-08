/**
 * LaneGraphBuffer — SharedArrayBuffer flat layout for LaneGraph data.
 *
 * Designed for zero-copy sharing between main thread and pathfinding Worker.
 * Main thread writes via writeFromGraph(); Worker reads via GraphReader.
 *
 * Layout:
 *   Header (32 bytes)
 *   Points[maxPoints × POINT_STRIDE]
 *   Edges[maxEdges × EDGE_STRIDE]
 *   AdjOffset[maxPoints × 4]   (Uint32)
 *   AdjCount[maxPoints × 2]    (Uint16)
 *   AdjList[maxEdges × 4]      (Uint32)  — outgoing edge indices per point
 */

import type { LaneGraph, LaneEdge, ConnectionPoint } from './LaneGraph';
import { ROAD_CONFIGS, RoadType, getLaneCount } from '../road/types';
import { parsePosKeyUnsafe } from '../grid/GridHelpers';

// ── Layout constants ──

export const GRAPH_HEADER_BYTES = 32;

/**
 * Per-point stride (20 bytes):
 *   posX: Float32 (0)
 *   posY: Float32 (4)
 *   cellX: Uint16 (8)
 *   cellY: Uint16 (10)
 *   lane: Uint8 (12)
 *   dir: Uint8 (13)     — 0=north,1=south,2=east,3=west
 *   type: Uint8 (14)    — 0=entry,1=exit
 *   laneCount: Uint8 (15) — lanes per direction on this point's road,
 *                           which the turn-lane preference needs (BUG-214)
 *   speedLimit: Float32 (16)
 */
export const POINT_STRIDE = 20;

/**
 * Per-edge stride (16 bytes):
 *   fromIdx: Uint32 (0)
 *   toIdx: Uint32 (4)
 *   length: Float32 (8)
 *   type: Uint8 (12)    — 0=straight,1=turn,2=lane_change,3=merge
 *   pad: Uint8[3] (13-15)
 */
export const EDGE_STRIDE = 16;

const DIR_TO_INT: Record<string, number> = { north: 0, south: 1, east: 2, west: 3 };
const POINT_TYPE_TO_INT: Record<string, number> = { entry: 0, exit: 1 };
const EDGE_TYPE_TO_INT: Record<string, number> = { straight: 0, turn: 1, lane_change: 2, merge: 3 };

// ── WriteFromGraph result ──

export interface GraphMapping {
  /** String pointId → integer index in the buffer. */
  pointIdToIndex: Map<string, number>;
  /** Original LaneEdge objects in buffer order (for result conversion). */
  edgeOriginals: LaneEdge[];
}

// ── GraphReader: read-only typed view ──

export interface PointData {
  posX: number;
  posY: number;
  cellX: number;
  cellY: number;
  lane: number;
  /** Lanes per direction on this point's road. */
  laneCount: number;
  dir: number;
  type: number;
  speedLimit: number;
}

export interface EdgeData {
  fromIdx: number;
  toIdx: number;
  length: number;
  type: number;
}

export class GraphReader {
  private view: DataView;
  private maxPoints: number;
  private maxEdges: number;
  private pointsOffset: number;
  private edgesOffset: number;
  private adjOffsetStart: number;
  private adjCountStart: number;
  private adjListStart: number;

  constructor(sab: SharedArrayBuffer, maxPoints: number, maxEdges: number) {
    this.view = new DataView(sab);
    this.maxPoints = maxPoints;
    this.maxEdges = maxEdges;
    this.pointsOffset = GRAPH_HEADER_BYTES;
    this.edgesOffset = this.pointsOffset + maxPoints * POINT_STRIDE;
    this.adjOffsetStart = this.edgesOffset + maxEdges * EDGE_STRIDE;
    this.adjCountStart = this.adjOffsetStart + maxPoints * 4;
    this.adjListStart = this.adjCountStart + maxPoints * 2;
  }

  getPointCount(): number {
    return this.view.getUint32(0, true);
  }

  getEdgeCount(): number {
    return this.view.getUint32(4, true);
  }

  getVersion(): number {
    return this.view.getUint32(8, true);
  }

  /**
   * Encoded cell of a point (cellX * 65536 + cellY) without allocating.
   *
   * getPoint builds a fresh 8-field object and performs eight DataView reads;
   * callers that only need the cell paid for all of it. findPathVariants swept
   * every point in the graph twice per request that way — 24k-48k points on a
   * 3000-tile road network, 100 requests per flush (BUG-112).
   */
  getPointCellEncoded(idx: number): number {
    const off = this.pointsOffset + idx * POINT_STRIDE;
    return this.view.getUint16(off + 8, true) * 65536 + this.view.getUint16(off + 10, true);
  }

  getPoint(idx: number): PointData {
    const off = this.pointsOffset + idx * POINT_STRIDE;
    return {
      posX: this.view.getFloat32(off, true),
      posY: this.view.getFloat32(off + 4, true),
      cellX: this.view.getUint16(off + 8, true),
      cellY: this.view.getUint16(off + 10, true),
      lane: this.view.getUint8(off + 12),
      dir: this.view.getUint8(off + 13),
      type: this.view.getUint8(off + 14),
      laneCount: this.view.getUint8(off + 15),
      speedLimit: this.view.getFloat32(off + 16, true),
    };
  }

  getEdge(idx: number): EdgeData {
    const off = this.edgesOffset + idx * EDGE_STRIDE;
    return {
      fromIdx: this.view.getUint32(off, true),
      toIdx: this.view.getUint32(off + 4, true),
      length: this.view.getFloat32(off + 8, true),
      type: this.view.getUint8(off + 12),
    };
  }

  /** Get outgoing edge indices for a point. Returns a lightweight view. */
  getEdgesFrom(pointIdx: number): number[] {
    const offset = this.view.getUint32(this.adjOffsetStart + pointIdx * 4, true);
    const count = this.view.getUint16(this.adjCountStart + pointIdx * 2, true);
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.view.getUint32(this.adjListStart + (offset + i) * 4, true));
    }
    return result;
  }

  /** Get raw edge fromIdx without creating an object. */
  getEdgeFromIdx(edgeIdx: number): number {
    return this.view.getUint32(this.edgesOffset + edgeIdx * EDGE_STRIDE, true);
  }

  /** Get raw edge toIdx without creating an object. */
  getEdgeToIdx(edgeIdx: number): number {
    return this.view.getUint32(this.edgesOffset + edgeIdx * EDGE_STRIDE + 4, true);
  }

  /** Get raw edge length without creating an object. */
  getEdgeLength(edgeIdx: number): number {
    return this.view.getFloat32(this.edgesOffset + edgeIdx * EDGE_STRIDE + 8, true);
  }

  /** Get raw edge type without creating an object. */
  getEdgeType(edgeIdx: number): number {
    return this.view.getUint8(this.edgesOffset + edgeIdx * EDGE_STRIDE + 12);
  }
}

// ── LaneGraphBuffer ──

export class LaneGraphBuffer {
  private sab: SharedArrayBuffer;
  private view: DataView;
  private maxPoints: number;
  private maxEdges: number;
  private pointsOffset: number;
  private edgesOffset: number;
  private adjOffsetStart: number;
  private adjCountStart: number;
  private adjListStart: number;

  constructor(maxPoints: number, maxEdges: number) {
    this.maxPoints = maxPoints;
    this.maxEdges = maxEdges;
    this.pointsOffset = GRAPH_HEADER_BYTES;
    this.edgesOffset = this.pointsOffset + maxPoints * POINT_STRIDE;
    this.adjOffsetStart = this.edgesOffset + maxEdges * EDGE_STRIDE;
    this.adjCountStart = this.adjOffsetStart + maxPoints * 4;
    this.adjListStart = this.adjCountStart + maxPoints * 2;

    const totalBytes = this.adjListStart + maxEdges * 4;
    this.sab = new SharedArrayBuffer(totalBytes);
    this.view = new DataView(this.sab);
  }

  getBuffer(): SharedArrayBuffer {
    return this.sab;
  }

  getVersion(): number {
    return this.view.getUint32(8, true);
  }

  getPointCount(): number {
    return this.view.getUint32(0, true);
  }

  getEdgeCount(): number {
    return this.view.getUint32(4, true);
  }

  getMaxPoints(): number {
    return this.maxPoints;
  }

  getMaxEdges(): number {
    return this.maxEdges;
  }

  createReader(): GraphReader {
    return new GraphReader(this.sab, this.maxPoints, this.maxEdges);
  }

  /**
   * Write all points and edges from a LaneGraph into this SAB.
   * Returns mapping for result conversion (edge indices → original LaneEdge objects).
   */
  writeFromGraph(graph: LaneGraph): GraphMapping {
    const allEdges = graph.getAllEdges();

    // Collect unique points from edges
    const pointMap = new Map<string, ConnectionPoint>();
    for (const edge of allEdges) {
      if (!pointMap.has(edge.from.id)) pointMap.set(edge.from.id, edge.from);
      if (!pointMap.has(edge.to.id)) pointMap.set(edge.to.id, edge.to);
    }

    const pointCount = pointMap.size;
    const edgeCount = allEdges.length;

    if (pointCount > this.maxPoints) {
      throw new Error(`Point count ${pointCount} exceeds maxPoints ${this.maxPoints}`);
    }
    if (edgeCount > this.maxEdges) {
      throw new Error(`Edge count ${edgeCount} exceeds maxEdges ${this.maxEdges}`);
    }

    // Build pointId → index mapping
    const pointIdToIndex = new Map<string, number>();
    let idx = 0;
    for (const [id] of pointMap) {
      pointIdToIndex.set(id, idx++);
    }

    // Write header
    this.view.setUint32(0, pointCount, true);
    this.view.setUint32(4, edgeCount, true);
    const newVersion = this.getVersion() + 1;
    this.view.setUint32(8, newVersion, true);

    // Write points
    idx = 0;
    for (const [, point] of pointMap) {
      const off = this.pointsOffset + idx * POINT_STRIDE;
      this.view.setFloat32(off, point.position.x, true);
      this.view.setFloat32(off + 4, point.position.y, true);

      const { x: cellX, y: cellY } = parsePosKeyUnsafe(point.cellKey);
      this.view.setUint16(off + 8, cellX, true);
      this.view.setUint16(off + 10, cellY, true);
      this.view.setUint8(off + 12, point.lane);
      this.view.setUint8(off + 13, DIR_TO_INT[point.direction] ?? 0);
      this.view.setUint8(off + 14, POINT_TYPE_TO_INT[point.type] ?? 0);

      // Pre-fill speedLimit from RoadConfig
      const roadType = this.lookupRoadType(cellX, cellY, point.cellKey);
      const config = ROAD_CONFIGS[roadType as RoadType];
      this.view.setUint8(off + 15, getLaneCount(roadType));
      this.view.setFloat32(off + 16, config ? config.speedLimit : 50, true);

      idx++;
    }

    // Write edges
    const edgeOriginals: LaneEdge[] = [];
    // Track outgoing edges per point for adjacency
    const outgoing = new Array<number[]>(pointCount);
    for (let i = 0; i < pointCount; i++) outgoing[i] = [];

    for (let i = 0; i < edgeCount; i++) {
      const edge = allEdges[i]!;
      edgeOriginals.push(edge);

      const fromIdx = pointIdToIndex.get(edge.from.id)!;
      const toIdx = pointIdToIndex.get(edge.to.id)!;
      const off = this.edgesOffset + i * EDGE_STRIDE;
      this.view.setUint32(off, fromIdx, true);
      this.view.setUint32(off + 4, toIdx, true);
      this.view.setFloat32(off + 8, edge.length, true);
      this.view.setUint8(off + 12, EDGE_TYPE_TO_INT[edge.type] ?? 0);

      outgoing[fromIdx]!.push(i);
    }

    // Write adjacency
    let adjPos = 0;
    for (let i = 0; i < pointCount; i++) {
      const edges = outgoing[i]!;
      this.view.setUint32(this.adjOffsetStart + i * 4, adjPos, true);
      this.view.setUint16(this.adjCountStart + i * 2, edges.length, true);
      for (const edgeIdx of edges) {
        this.view.setUint32(this.adjListStart + adjPos * 4, edgeIdx, true);
        adjPos++;
      }
    }

    return { pointIdToIndex, edgeOriginals };
  }

  /** speedLimit lookup helper — extracts roadType from cellKey for elevated roads. */
  private lookupRoadType(_cellX: number, _cellY: number, cellKey: string): number {
    // For now, we rely on the graph's ConnectionPoint data which doesn't carry roadType.
    // The speedLimit is pre-filled per-point during writeFromGraph by looking up the
    // original graph's edge data. This is a placeholder for the cellKey→roadType lookup.
    // The actual roadType is injected via the graph parameter in writeFromGraphWithLookup.
    return RoadType.TWO_LANE;
  }

  /**
   * Write with explicit roadType lookup for accurate speedLimit.
   * Uses the provided function to resolve cellKey → roadType.
   */
  writeFromGraphWithLookup(
    graph: LaneGraph,
    getRoadType: (cellKey: string) => number,
  ): GraphMapping {
    const allEdges = graph.getAllEdges();

    const pointMap = new Map<string, ConnectionPoint>();
    for (const edge of allEdges) {
      if (!pointMap.has(edge.from.id)) pointMap.set(edge.from.id, edge.from);
      if (!pointMap.has(edge.to.id)) pointMap.set(edge.to.id, edge.to);
    }

    const pointCount = pointMap.size;
    const edgeCount = allEdges.length;

    if (pointCount > this.maxPoints) {
      throw new Error(`Point count ${pointCount} exceeds maxPoints ${this.maxPoints}`);
    }
    if (edgeCount > this.maxEdges) {
      throw new Error(`Edge count ${edgeCount} exceeds maxEdges ${this.maxEdges}`);
    }

    const pointIdToIndex = new Map<string, number>();
    let idx = 0;
    for (const [id] of pointMap) {
      pointIdToIndex.set(id, idx++);
    }

    this.view.setUint32(0, pointCount, true);
    this.view.setUint32(4, edgeCount, true);
    const newVersion = this.getVersion() + 1;
    this.view.setUint32(8, newVersion, true);

    idx = 0;
    for (const [, point] of pointMap) {
      const off = this.pointsOffset + idx * POINT_STRIDE;
      this.view.setFloat32(off, point.position.x, true);
      this.view.setFloat32(off + 4, point.position.y, true);

      const { x: cellX, y: cellY } = parsePosKeyUnsafe(point.cellKey);
      this.view.setUint16(off + 8, cellX, true);
      this.view.setUint16(off + 10, cellY, true);
      this.view.setUint8(off + 12, point.lane);
      this.view.setUint8(off + 13, DIR_TO_INT[point.direction] ?? 0);
      this.view.setUint8(off + 14, POINT_TYPE_TO_INT[point.type] ?? 0);

      const roadType = getRoadType(point.cellKey);
      const config = ROAD_CONFIGS[roadType as RoadType];
      this.view.setUint8(off + 15, getLaneCount(roadType));
      this.view.setFloat32(off + 16, config ? config.speedLimit : 50, true);

      idx++;
    }

    const edgeOriginals: LaneEdge[] = [];
    const outgoing = new Array<number[]>(pointCount);
    for (let i = 0; i < pointCount; i++) outgoing[i] = [];

    for (let i = 0; i < edgeCount; i++) {
      const edge = allEdges[i]!;
      edgeOriginals.push(edge);

      const fromIdx = pointIdToIndex.get(edge.from.id)!;
      const toIdx = pointIdToIndex.get(edge.to.id)!;
      const off = this.edgesOffset + i * EDGE_STRIDE;
      this.view.setUint32(off, fromIdx, true);
      this.view.setUint32(off + 4, toIdx, true);
      this.view.setFloat32(off + 8, edge.length, true);
      this.view.setUint8(off + 12, EDGE_TYPE_TO_INT[edge.type] ?? 0);

      outgoing[fromIdx]!.push(i);
    }

    let adjPos = 0;
    for (let i = 0; i < pointCount; i++) {
      const edges = outgoing[i]!;
      this.view.setUint32(this.adjOffsetStart + i * 4, adjPos, true);
      this.view.setUint16(this.adjCountStart + i * 2, edges.length, true);
      for (const edgeIdx of edges) {
        this.view.setUint32(this.adjListStart + adjPos * 4, edgeIdx, true);
        adjPos++;
      }
    }

    return { pointIdToIndex, edgeOriginals };
  }
}

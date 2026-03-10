/**
 * Pathfinding Worker — handles A-star/BFS path requests off the main thread.
 *
 * Communication protocol:
 * Main → Worker:
 *   { type: 'FIND_PATH', id: number, from: {x,y}, to: {x,y}, gridData: SharedArrayBuffer }
 *   { type: 'SET_GRID', width: number, height: number, gridData: SharedArrayBuffer }
 *   { type: 'BUILD_LANE_GRAPH' }
 *   { type: 'REFINE_LANE_PATH', id: number, cellPath: string[], preferredLane: number }
 *
 * Worker → Main:
 *   { type: 'PATH_RESULT', id: number, path: {x,y}[] | null }
 *   { type: 'LANE_GRAPH_READY' }
 *   { type: 'LANE_PATH_RESULT', id: number, edgePath: SerializedLaneEdge[] | null }
 *   { type: 'READY' }
 */

import { LaneGraph, type LaneEdge, type ConnectionPoint } from '../core/traffic/LaneGraph';
import { refineLanePath } from '../core/traffic/Pathfinding';

export interface SerializedLaneEdge {
  id: string;
  from: ConnectionPoint;
  to: ConnectionPoint;
  bezierControl?: { x: number; y: number }[];
  length: number;
  type: 'straight' | 'turn' | 'lane_change' | 'merge';
}

export interface BatchRequestItem {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  preferredLane: number;
}

export interface PathWorkerMessage {
  type: 'FIND_PATH' | 'SET_GRID' | 'BUILD_LANE_GRAPH' | 'REFINE_LANE_PATH' | 'BATCH_REQUEST';
  id?: number;
  batchId?: number;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  width?: number;
  height?: number;
  gridData?: SharedArrayBuffer;
  cellPath?: string[];
  preferredLane?: number;
  requests?: BatchRequestItem[];
}

export interface BatchResultItem {
  id: number;
  edgePath: SerializedLaneEdge[] | null;
}

export interface PathWorkerResponse {
  type: 'READY' | 'PATH_RESULT' | 'LANE_GRAPH_READY' | 'LANE_PATH_RESULT' | 'BATCH_RESULT';
  id?: number;
  batchId?: number;
  path?: { x: number; y: number }[] | null;
  edgePath?: SerializedLaneEdge[] | null;
  results?: BatchResultItem[];
}

let gridWidth = 0;
let gridHeight = 0;
let gridView: DataView | null = null;
let laneGraph: LaneGraph | null = null;

const BYTES_PER_CELL = 12;

function getRoadType(x: number, y: number): number {
  if (!gridView || x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return 0;
  const offset = (y * gridWidth + x) * BYTES_PER_CELL;
  // roadType is at offset +5 within each cell (matching GridBuffer layout)
  return gridView.getUint8(offset + 5);
}

function getRoadFlags(x: number, y: number): number {
  if (!gridView || x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return 0;
  const offset = (y * gridWidth + x) * BYTES_PER_CELL;
  return gridView.getUint8(offset + 4);
}

/** Build LaneGraph from the SharedArrayBuffer grid data. */
export function buildLaneGraphFromGrid(): LaneGraph {
  const graph = new LaneGraph();
  const cellKeys: string[] = [];
  const cellMap = new Map<string, { roadType: number; roadFlags: number }>();

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const rt = getRoadType(x, y);
      if (rt > 0) {
        const key = `${x},${y}`;
        cellKeys.push(key);
        cellMap.set(key, { roadType: rt, roadFlags: getRoadFlags(x, y) });
      }
    }
  }

  const gridLookup = {
    getCell: (gx: number, gy: number) => cellMap.get(`${gx},${gy}`) ?? null,
  };
  graph.buildFromGrid(gridLookup, cellKeys);
  return graph;
}

/** Serialize a LaneEdge for postMessage transfer. */
function serializeLaneEdge(e: LaneEdge): SerializedLaneEdge {
  return {
    id: e.id,
    from: { ...e.from, position: { ...e.from.position }, tangent: { ...e.from.tangent } },
    to: { ...e.to, position: { ...e.to.position }, tangent: { ...e.to.tangent } },
    bezierControl: e.bezierControl?.map(p => ({ ...p })),
    length: e.length,
    type: e.type,
  };
}

function bfsRoadPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number }[] | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: { x: number; y: number }[] = [start];
  visited.add(key(start.x, start.y));
  const endKey = key(end.x, end.y);

  const dirs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  ];

  let steps = 0;
  while (queue.length > 0 && steps < 1000) {
    const cur = queue.shift()!;
    const curKey = key(cur.x, cur.y);
    steps++;

    if (curKey === endKey) {
      const path: { x: number; y: number }[] = [];
      let k: string | undefined = endKey;
      while (k) {
        const [px, py] = k.split(',').map(Number);
        path.unshift({ x: px!, y: py! });
        k = parent.get(k);
      }
      return path;
    }

    for (const { dx, dy } of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      if (getRoadType(nx, ny) <= 0) continue;
      visited.add(nk);
      parent.set(nk, curKey);
      queue.push({ x: nx, y: ny });
    }
  }

  return null;
}

function findAdjacentRoad(x: number, y: number): { x: number; y: number } | null {
  if (getRoadType(x, y) > 0) return { x, y };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (getRoadType(x + dx!, y + dy!) > 0) return { x: x + dx!, y: y + dy! };
  }
  return null;
}

self.onmessage = (e: MessageEvent<PathWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'SET_GRID': {
      gridWidth = msg.width ?? 0;
      gridHeight = msg.height ?? 0;
      if (msg.gridData) {
        gridView = new DataView(msg.gridData);
      }
      (self as unknown as Worker).postMessage({ type: 'READY' } satisfies PathWorkerResponse);
      break;
    }

    case 'FIND_PATH': {
      if (!msg.from || !msg.to) {
        (self as unknown as Worker).postMessage({
          type: 'PATH_RESULT',
          id: msg.id,
          path: null,
        } satisfies PathWorkerResponse);
        break;
      }

      const startRoad = findAdjacentRoad(msg.from.x, msg.from.y);
      const endRoad = findAdjacentRoad(msg.to.x, msg.to.y);

      if (!startRoad || !endRoad) {
        (self as unknown as Worker).postMessage({
          type: 'PATH_RESULT',
          id: msg.id,
          path: null,
        } satisfies PathWorkerResponse);
        break;
      }

      const path = bfsRoadPath(startRoad, endRoad);
      (self as unknown as Worker).postMessage({
        type: 'PATH_RESULT',
        id: msg.id,
        path,
      } satisfies PathWorkerResponse);
      break;
    }

    case 'BUILD_LANE_GRAPH': {
      laneGraph = buildLaneGraphFromGrid();
      (self as unknown as Worker).postMessage({
        type: 'LANE_GRAPH_READY',
      } satisfies PathWorkerResponse);
      break;
    }

    case 'REFINE_LANE_PATH': {
      if (!laneGraph || !msg.cellPath) {
        (self as unknown as Worker).postMessage({
          type: 'LANE_PATH_RESULT',
          id: msg.id,
          edgePath: null,
        } satisfies PathWorkerResponse);
        break;
      }

      const edgePath = refineLanePath(laneGraph, msg.cellPath, msg.preferredLane ?? 0);
      (self as unknown as Worker).postMessage({
        type: 'LANE_PATH_RESULT',
        id: msg.id,
        edgePath: edgePath ? edgePath.map(serializeLaneEdge) : null,
      } satisfies PathWorkerResponse);
      break;
    }

    case 'BATCH_REQUEST': {
      const requests = msg.requests ?? [];
      const results: BatchResultItem[] = requests.map(req => {
        const startRoad = findAdjacentRoad(req.from.x, req.from.y);
        const endRoad = findAdjacentRoad(req.to.x, req.to.y);
        if (!startRoad || !endRoad) return { id: req.id, edgePath: null };
        if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) return { id: req.id, edgePath: null };

        const cellPath = bfsRoadPath(startRoad, endRoad);
        if (!cellPath || cellPath.length < 2) return { id: req.id, edgePath: null };

        // Convert cell path ({x,y}[]) to cell key strings for refineLanePath
        const cellKeys = cellPath.map(p => `${p.x},${p.y}`);

        if (!laneGraph) return { id: req.id, edgePath: null };
        const edgePath = refineLanePath(laneGraph, cellKeys, req.preferredLane);
        if (!edgePath || edgePath.length === 0) return { id: req.id, edgePath: null };

        return { id: req.id, edgePath: edgePath.map(serializeLaneEdge) };
      });

      (self as unknown as Worker).postMessage({
        type: 'BATCH_RESULT',
        batchId: msg.batchId,
        results,
      } satisfies PathWorkerResponse);
      break;
    }
  }
};

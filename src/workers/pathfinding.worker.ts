/**
 * Pathfinding Worker — handles A-star/BFS path requests off the main thread.
 *
 * Communication protocol:
 * Main → Worker:
 *   { type: 'FIND_PATH', id: number, from: {x,y}, to: {x,y}, gridData: SharedArrayBuffer }
 *   { type: 'SET_GRID', width: number, height: number, gridData: SharedArrayBuffer }
 *
 * Worker → Main:
 *   { type: 'PATH_RESULT', id: number, path: {x,y}[] | null }
 *   { type: 'READY' }
 */

export interface PathWorkerMessage {
  type: 'FIND_PATH' | 'SET_GRID';
  id?: number;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  width?: number;
  height?: number;
  gridData?: SharedArrayBuffer;
}

export interface PathWorkerResponse {
  type: 'READY' | 'PATH_RESULT';
  id?: number;
  path?: { x: number; y: number }[] | null;
}

let gridWidth = 0;
let gridHeight = 0;
let gridView: DataView | null = null;

const BYTES_PER_CELL = 12;

function getRoadType(x: number, y: number): number {
  if (!gridView || x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return 0;
  const offset = (y * gridWidth + x) * BYTES_PER_CELL;
  // roadType is at offset +2 within each cell (matching Grid.ts layout)
  return gridView.getUint8(offset + 2);
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
  }
};

/**
 * The flat byte layout of a `RoadCellGraph`, for the worker.
 *
 * **Format only, no algorithm**: changing the weight formula should not touch this file, and
 * changing the layout should not touch Dijkstra.
 *
 * The layout, little-endian:
 *
 *   Header, 16 bytes: nodeCount u32 / edgeCount u32 / version u32 / reserved u32
 *   nodeX     Uint16[n]      (align 2)
 *   nodeY     Uint16[n]      (align 2)
 *   nodeLevel Uint8[n]
 *   offsets   Uint32[n+1]    (align 4)
 *   targets   Uint32[e]      (align 4)
 *   weights   Uint16[e]      (align 2)
 *
 * Weights are `Uint16`, since costs are integers with a maximum of 60, so no 8-byte alignment is
 * needed — one of the simplifications integer costs brought with them.
 *
 * **Key strings are not serialised**: they are assembled from coordinates and level, saving a
 * structured clone of hundreds of strings.
 */

import { toPosKey } from '../grid/GridHelpers';
import type { RoadCellGraph } from './RoadCellGraph';

export const GRAPH_BUFFER_VERSION = 1;

const HEADER_BYTES = 16;
const align4 = (n: number): number => (n + 3) & ~3;

/**
 * Each section's starting offset, shared by serialisation and deserialisation so the two formulas
 * cannot drift.
 *
 * Exported only so tests can check alignment directly: running a fixture to see whether it throws
 * `RangeError` is unreliable verification and fails silently whenever the node count happens to
 * align.
 */
export function layoutOf(n: number, e: number): {
  oNodeX: number; oNodeY: number; oLevel: number;
  oOffsets: number; oTargets: number; oWeights: number; total: number;
} {
  const oNodeX = HEADER_BYTES;              // 16, already aligned to 4
  const oNodeY = oNodeX + n * 2;
  const oLevel = oNodeY + n * 2;            // a Uint16 section's length is always even
  const oOffsets = align4(oLevel + n);      // Uint32 needs 4-byte alignment
  const oTargets = oOffsets + (n + 1) * 4;
  const oWeights = oTargets + e * 4;        // already aligned to 4, and Uint16 needs only 2
  return { oNodeX, oNodeY, oLevel, oOffsets, oTargets, oWeights, total: oWeights + e * 2 };
}

export function serializeRoadCellGraph(graph: RoadCellGraph): ArrayBuffer {
  const n = graph.nodeKeys.length;
  const e = graph.targets.length;
  const L = layoutOf(n, e);

  const buf = new ArrayBuffer(L.total);
  const dv = new DataView(buf);
  dv.setUint32(0, n, true);
  dv.setUint32(4, e, true);
  dv.setUint32(8, GRAPH_BUFFER_VERSION, true);
  dv.setUint32(12, 0, true);

  new Uint16Array(buf, L.oNodeX, n).set(graph.nodeX);
  new Uint16Array(buf, L.oNodeY, n).set(graph.nodeY);
  new Uint8Array(buf, L.oLevel, n).set(graph.nodeLevel);
  new Uint32Array(buf, L.oOffsets, n + 1).set(graph.offsets);
  new Uint32Array(buf, L.oTargets, e).set(graph.targets);
  new Uint16Array(buf, L.oWeights, e).set(graph.weights);
  return buf;
}

/**
 * Reads the node count without deserialising.
 *
 * Whether a graph is empty is decided with this and **not with `byteLength === 0`**: an empty
 * graph's buffer is a 16-byte header plus one `offsets[0]`, a length of 20.
 */
export function graphBufferNodeCount(buffer: ArrayBuffer): number {
  if (buffer.byteLength < HEADER_BYTES) return 0;
  return new DataView(buffer).getUint32(0, true);
}

export function deserializeRoadCellGraph(buffer: ArrayBuffer): RoadCellGraph {
  const dv = new DataView(buffer);
  const n = dv.getUint32(0, true);
  const e = dv.getUint32(4, true);
  const version = dv.getUint32(8, true);
  if (version !== GRAPH_BUFFER_VERSION) {
    throw new Error(
      `RoadCellGraph buffer version mismatch: got ${version}, expected ${GRAPH_BUFFER_VERSION}`,
    );
  }
  const L = layoutOf(n, e);

  const nodeX = new Uint16Array(buffer, L.oNodeX, n);
  const nodeY = new Uint16Array(buffer, L.oNodeY, n);
  const nodeLevel = new Uint8Array(buffer, L.oLevel, n);

  const nodeKeys: string[] = new Array(n);
  const indexOf = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const lv = nodeLevel[i]!;
    const key = lv === 0 ? toPosKey(nodeX[i]!, nodeY[i]!) : `${nodeX[i]},${nodeY[i]},${lv}`;
    nodeKeys[i] = key;
    indexOf.set(key, i);
  }

  return {
    nodeKeys, indexOf,
    offsets: new Uint32Array(buffer, L.oOffsets, n + 1),
    targets: new Uint32Array(buffer, L.oTargets, e),
    weights: new Uint16Array(buffer, L.oWeights, e),
    nodeX, nodeY, nodeLevel,
  };
}

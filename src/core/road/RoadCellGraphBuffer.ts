/**
 * `RoadCellGraph` 的扁平位元組佈局，給 worker 用。
 *
 * **只有格式，沒有演算法** —— 改權重公式不該碰這個檔案，改佈局不該碰 Dijkstra。
 *
 * 佈局（little-endian）：
 *
 *   Header 16 bytes: nodeCount u32 / edgeCount u32 / version u32 / reserved u32
 *   nodeX     Uint16[n]      （align 2）
 *   nodeY     Uint16[n]      （align 2）
 *   nodeLevel Uint8[n]
 *   offsets   Uint32[n+1]    （align 4）
 *   targets   Uint32[e]      （align 4）
 *   weights   Uint16[e]      （align 2）
 *
 * 權重是 `Uint16`（成本是整數，最大 60），所以不需要 8-byte 對齊 ——
 * 這是成本整數化順帶簡化掉的一段。
 *
 * **key 字串不序列化** —— 從座標與樓層現組，省下數百個字串的 structured clone。
 */

import { toPosKey } from '../grid/GridHelpers';
import type { RoadCellGraph } from './RoadCellGraph';

export const GRAPH_BUFFER_VERSION = 1;

const HEADER_BYTES = 16;
const align4 = (n: number): number => (n + 3) & ~3;

/**
 * 各段的起始位移。序列化與反序列化共用，避免兩邊算式漂移。
 *
 * 匯出僅供測試直接檢查對齊性 —— 用 fixture 跑跑看會不會丟 `RangeError`
 * 是不可靠的驗證，節點數剛好對齊時它就靜默失效。
 */
export function layoutOf(n: number, e: number): {
  oNodeX: number; oNodeY: number; oLevel: number;
  oOffsets: number; oTargets: number; oWeights: number; total: number;
} {
  const oNodeX = HEADER_BYTES;              // 16，已 align 4
  const oNodeY = oNodeX + n * 2;
  const oLevel = oNodeY + n * 2;            // Uint16 段長度必為偶數
  const oOffsets = align4(oLevel + n);      // Uint32 需要 align 4
  const oTargets = oOffsets + (n + 1) * 4;
  const oWeights = oTargets + e * 4;        // 已 align 4，Uint16 只需 align 2
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
 * 不反序列化就讀出節點數。
 *
 * 「圖是不是空的」要用這個判斷，**不能用 `byteLength === 0`** —— 空圖的
 * buffer 有 16 bytes 的 header 加上一個 `offsets[0]`，長度是 20。
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

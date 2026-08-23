import type { LaneEdge } from './LaneGraph';
import { NO_ENTRY, type EdgeVehicleIndex } from './EdgeVehicleIndex';

/** Distance (grid units) to stop behind the intersection edge, matching the rendered stop line position. */
export const STOP_LINE_OFFSET = 0.25;

/** Maximum lookahead distance (grid units) for gap/red-light checks. */
const LOOKAHEAD_DISTANCE = 5;


/** Minimal vehicle state needed for lookahead calculations. */
export interface LookaheadVehicle {
  id: number;
  length: number;
  edgeIndex: number;
  edgeProgress: number;
}

/**
 * Find the gap distance to the nearest vehicle ahead on the same edge path.
 * Returns Infinity if no vehicle is found within LOOKAHEAD_DISTANCE.
 *
 * @param maxHalfLen 路上最長那台車的半個車身。給了就會提前收工:找到一台之後，
 * 再往前的邊上不可能有更近的。
 *
 * 為什麼要「最長的那台」而不是眼前這台:空隙扣的是兩台車的半個車身，公車的車身
 * 是小客車的兩倍多，所以一台停在更後面的公車留下的空隙可能反而更小。用小的數字
 * 當門檻會把它跳過去，車就開進公車尾巴。
 *
 * 不給就不收工，整條掃完 —— 掃 5 格的路徑平均會走 10.3 條邊（12 288 人的存檔實測），
 * 而車流稠密時通常第一、二條邊上就有車了。
 */
export function findGapAhead(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  edgeIndex: EdgeVehicleIndex,
  maxHalfLen = Infinity,
): number {
  let gap = Infinity;
  const myHalfLen = v.length / 2;
  let distAhead = 0;

  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    const myProgress = ei === v.edgeIndex ? v.edgeProgress : 0;
    const edgeRemain = edge.length - myProgress;

    for (let i = edgeIndex.firstOf(edge.id); i !== NO_ENTRY; i = edgeIndex.nextOf(i)) {
      const eVid = edgeIndex.vidAt(i);
      if (eVid === v.id) continue;
      const eProgress = edgeIndex.progressAt(i);
      const eHalfLen = edgeIndex.halfLenAt(i);
      if (ei === v.edgeIndex) {
        if (eProgress < v.edgeProgress) continue;
        if (eProgress === v.edgeProgress && eVid > v.id) continue;
        const dist = (eProgress - v.edgeProgress) - myHalfLen - eHalfLen;
        if (dist < gap) gap = dist;
      } else {
        const dist = distAhead + eProgress - myHalfLen - eHalfLen;
        if (dist < gap) gap = dist;
      }
    }

    distAhead += edgeRemain;
    if (distAhead > LOOKAHEAD_DISTANCE) break;
    // 下一條邊上最樂觀的那台車也擋不到已經找到的這台。
    if (gap <= distAhead - myHalfLen - maxHalfLen) break;
  }

  return gap;
}

/**
 * How far a vehicle may advance without parking itself inside an intersection.
 * Returns Infinity when the box ahead can be cleared (or there is none).
 *
 * Car-following alone only asks where the vehicle ahead stopped, so when that
 * vehicle stops just past an intersection its follower creeps right up and
 * stops in the middle of the box. The next green then hands the cross direction
 * a junction with a stationary car in it, and the whole crossroads locks up.
 *
 * The question to ask before entering is whether the vehicle can come out the
 * other side. Distances here are measured from the vehicle's CENTRE along the
 * path, matching `edgeProgress`:
 *
 *   room          how far the centre may advance before touching the car ahead
 *   [enter, exit] the run of edges marked `insideJunction`
 *
 * Entering is allowed when the CENTRE can clear the box: `room >= exit`.
 * Otherwise stop at the same stop line a red light would use.
 *
 * Deliberately not `room >= exit + halfLen`, which would keep the box wholly
 * clear. Real drivers nose into the box, and holding out for the whole body
 * makes the traffic look stiff. What it costs is bounded and small: at most
 * half a body stays inside — 0.11 grid units, a tenth of the junction's width.
 * The stricter form measured identically (0.314 vs 0.313 ms/frame), so this is
 * a choice about how the traffic looks, not about what it costs.
 *
 * `gap` is the caller's already-computed following distance and is used ONLY to
 * skip work: free-flowing traffic returns after one comparison. It is a lower
 * bound on how far the nearest vehicle of any kind is, so passing too small a
 * number only forfeits the shortcut — the verdict comes from the scan below,
 * which reads the queueing flag and cannot be reached by a shortcut that fires.
 */
export function findBlockedJunctionDistance(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  edgeIndex: EdgeVehicleIndex,
  gap: number,
  minGap: number,
): number {
  if (gap >= LOOKAHEAD_DISTANCE) return Infinity;

  const halfLen = v.length / 2;

  // 1. 前方第一個路口在哪裡。純走訪，不查表。
  let dist = 0;
  let enter = -1;
  let exit = 0;

  for (let ei = v.edgeIndex; ei < edgePath.length && dist <= LOOKAHEAD_DISTANCE; ei++) {
    const edge = edgePath[ei]!;
    const start = dist;
    dist += edge.length - (ei === v.edgeIndex ? v.edgeProgress : 0);
    if (edge.insideJunction) {
      if (enter < 0) enter = start;
      exit = dist;
    } else if (enter >= 0) {
      break;
    }
  }

  if (enter <= 0) return Infinity;  // 前方沒有路口，或者車已經在路口裡了 —— 只能開出去

  // 車身中心要走到這裡才算過了路口。
  const needed = exit;
  // 連車流裡最近的那台都擋不到，就不必再查是誰了。
  if (gap - minGap >= needed) return Infinity;

  // 2. 只有**正在排隊**的車算佔用。
  //
  // 用 findGapAhead 的距離（不分動靜）判斷的話，兩格的正常車距就會讓每一台車
  // 在每一個路口前煞一次 —— 實測整條路的通過量掉一成，而那時候路上根本沒有
  // 塞車。
  //
  // 而「它現在停了沒」又太晚:車隊是往後長的，等前車真的停住，後車已經進了
  // 路口，然後就困在裡面。所以看的是**它正在為前方的東西減速**。
  let d = 0;
  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    for (let i = edgeIndex.firstOf(edge.id); i !== NO_ENTRY; i = edgeIndex.nextOf(i)) {
      const eVid = edgeIndex.vidAt(i);
      if (eVid === v.id || !edgeIndex.queueingAt(i)) continue;
      const eProgress = edgeIndex.progressAt(i);
      let at: number;
      if (ei === v.edgeIndex) {
        if (eProgress < v.edgeProgress) continue;
        if (eProgress === v.edgeProgress && eVid > v.id) continue;
        at = eProgress - v.edgeProgress;
      } else {
        at = d + eProgress;
      }
      // 這台排隊中的車讓我的中心最多只能走到這裡。
      if (at - halfLen - edgeIndex.halfLenAt(i) - minGap < needed) {
        return Math.max(0, enter - halfLen - STOP_LINE_OFFSET);
      }
    }
    d += edge.length - (ei === v.edgeIndex ? v.edgeProgress : 0);
    // 後面每一台的 `at` 都不小於 d，而 e.halfLen >= 0 —— 再遠就擋不到了。
    if (d - halfLen - minGap >= needed) break;
  }

  return Infinity;
}

/**
 * Find the distance to the nearest red light along the edge path.
 * Returns Infinity if no red light is found within LOOKAHEAD_DISTANCE.
 */
export function findRedLightDistance(
  v: LookaheadVehicle,
  edgePath: readonly LaneEdge[],
  canAdvance: (current: string, next: string, via?: string) => boolean,
): number {
  let distAhead = 0;

  for (let ei = v.edgeIndex; ei < edgePath.length; ei++) {
    const edge = edgePath[ei]!;
    const startDist = ei === v.edgeIndex ? v.edgeProgress : 0;
    const edgeRemain = edge.length - startDist;

    if (edge.from.cellKey !== edge.to.cellKey) {
      // If vehicle is already partway through this crossing, let it complete
      // (it entered the intersection when the light was green)
      const alreadyCrossing = ei === v.edgeIndex && v.edgeProgress > 0;
      // Forward viaCellKey so a turn edge is judged on the intersection it
      // skips over, not on the plain road tile it lands in (BUG-058).
      if (!alreadyCrossing && !canAdvance(edge.from.cellKey, edge.to.cellKey, edge.viaCellKey)) {
        const stopDist = distAhead - (ei === v.edgeIndex ? 0 : startDist);
        return Math.max(0, stopDist - v.length / 2 - STOP_LINE_OFFSET);
      }
    }

    distAhead += edgeRemain;
    if (distAhead > LOOKAHEAD_DISTANCE) break;
  }

  return Infinity;
}

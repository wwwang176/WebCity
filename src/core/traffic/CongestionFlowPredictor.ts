import type { LaneEdge } from './LaneGraph';
import type { CommuteCache } from './CommuteCache';
import type { PathCellCache } from './PathCellCache';
import { buildODPools, type CommutingCitizen } from './ODPoolBuilder';
import { pickWeighted } from '../utils/random';
import { manhattanDistance } from '../grid/GridHelpers';
import { TransportMode } from '../transport/types';
import type { AvailableTransport } from '../transport/ModeChoice';
import { SIMULATION } from '../simulation/SimulationConstants';

/**
 * Dependencies for Monte Carlo congestion flow fallback.
 * Injected to decouple from SimulationLoop's concrete state (DIP).
 */
export interface CongestionFlowDeps {
  citizens: Iterable<CommutingCitizen>;
  parsePosKey: (key: string) => { x: number; y: number };
  findLanePath: (from: { x: number; y: number }, to: { x: number; y: number }) => LaneEdge[] | null;
  getAvailableTransit: (from: { x: number; y: number }, to: { x: number; y: number }) => AvailableTransport[];
  chooseTransportMode: (from: { x: number; y: number }, to: { x: number; y: number }, transit: AvailableTransport[], congestion: number) => TransportMode;
}

/**
 * Compute predicted congestion flow from cached commute routes.
 * Uses CommuteCache's routeIndex with reference counts — O(routes × avg path length), zero A*.
 * Flow is normalized by lane count at each cell.
 *
 * 「這條路徑經過哪些格子」交給 `PathCellCache` —— 那個答案只跟路徑有關，而路徑是
 * 共用且不可變的。原本每次重算都從邊重建一次 Set:玩家存檔實測每 60 tick 走過
 * 4 505 318 條邊，去填一張只有 314 個鍵的圖（BUG-327）。
 *
 * @param commuteCache - The shared commute path cache
 * @param cellCache - Per-path cell lists, shared across recomputes
 * @param getLaneCount - Returns lane count for a given cellKey
 * @returns flowMap (cellKey → normalized flow) and totalRefCount (citizens covered by cache)
 */
export function computeCongestionFlow(
  commuteCache: CommuteCache,
  cellCache: PathCellCache,
  getLaneCount: (cellKey: string) => number,
): { flowMap: Map<string, number>; totalRefCount: number } {
  const flowMap = new Map<string, number>();
  let totalRefCount = 0;

  commuteCache.forEachRouteWithRefCount((path, refCount) => {
    totalRefCount += refCount;
    const cells = cellCache.cellsOf(path);
    for (let i = 0; i < cells.length; i++) {
      const cellKey = cells[i]!;
      flowMap.set(cellKey, (flowMap.get(cellKey) ?? 0) + refCount);
    }
  });

  // Normalize by lane count
  for (const [cellKey, rawFlow] of flowMap) {
    const lanes = getLaneCount(cellKey);
    if (lanes > 1) {
      flowMap.set(cellKey, rawFlow / lanes);
    }
  }

  return { flowMap, totalRefCount };
}

/**
 * Monte Carlo fallback for congestion flow prediction.
 * Used when CommuteCache coverage is too low for reliable prediction.
 * Samples random OD pairs and accumulates flow on edges.
 *
 * @returns Map of cellKey → scaled flow value (NOT lane-normalized)
 */
export function computeCongestionFlowMonteCarlo(
  deps: CongestionFlowDeps,
  sampleCountMin: number,
  sampleCountMax: number,
  sampleDivisor: number,
): Map<string, number> {
  const flowMap = new Map<string, number>();

  const pools = buildODPools(deps.citizens, deps.parsePosKey);
  if (!pools) return flowMap;

  const { residential, destinations, totalResWeight, totalDestWeight } = pools;
  const sampleCount = Math.max(
    sampleCountMin,
    Math.min(sampleCountMax, Math.ceil(totalResWeight / sampleDivisor)),
  );

  for (let i = 0; i < sampleCount; i++) {
    const from = pickWeighted(residential, totalResWeight, e => e.weight);
    const to = pickWeighted(destinations, totalDestWeight, e => e.weight);
    if (from.x === to.x && from.y === to.y) continue;

    const manhattan = manhattanDistance(from.x, from.y, to.x, to.y);
    if (manhattan <= SIMULATION.MANHATTAN_DISTANCE_THRESHOLD) continue;

    const availableTransport = deps.getAvailableTransit(from, to);
    const mode = deps.chooseTransportMode(from, to, availableTransport, 0);
    if (mode !== TransportMode.DRIVE) continue;

    const edgePath = deps.findLanePath(from, to);
    if (!edgePath) continue;

    for (const edge of edgePath) {
      flowMap.set(edge.from.cellKey, (flowMap.get(edge.from.cellKey) ?? 0) + 1);
    }
  }

  // Scale up sampled flow to match actual commuter volume
  if (flowMap.size > 0) {
    const scaleFactor = totalResWeight / sampleCount;
    for (const [cellKey, rawFlow] of flowMap) {
      flowMap.set(cellKey, rawFlow * scaleFactor);
    }
  }

  return flowMap;
}

import { TransportMode, TransportType } from './types';
import type { MultiLegRoute } from './MultiModalRouter';

/** Mode choice configuration constants */
export const MODE_CHOICE = {
  /** Maximum Manhattan distance for walking */
  WALK_MAX_DISTANCE: 3,
  /** Transit time must beat driveTime * threshold to be chosen */
  TRANSIT_TIME_MULTIPLIER_THRESHOLD: 1.5,
} as const;

export interface AvailableTransport {
  type: TransportType;
  /** Estimated travel time using this transport mode (in ticks). */
  estimatedTime: number;
  /**
   * 其中有多少是走路。
   *
   * 分開帶著，是因為比較時要對走路多收一份不情願，而回報時不能收 —— 揉成一個
   * 數字就沒辦法只加權其中一段。
   */
  walkTime: number;
}

/**
 * Determine how a citizen should travel from origin to destination.
 *
 * Decision logic:
 * 1. Walk if distance <= 3 (Manhattan distance).
 * 2. Compare drive time against the best transit option.
 * 3. Choose transit if transit time < driveTime * 1.5.
 * 4. Default to driving if no good transit option exists.
 */
export function chooseMode(
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  availableTransport: AvailableTransport[],
  congestionLevel: number,
): TransportMode {
  const dx = Math.abs(destination.x - origin.x);
  const dy = Math.abs(destination.y - origin.y);
  const distance = dx + dy; // Manhattan distance

  // Walk for very short distances
  if (distance <= MODE_CHOICE.WALK_MAX_DISTANCE) {
    return TransportMode.WALK;
  }

  // Base drive time = distance, adjusted by congestion (higher congestion = slower)
  const driveTime = distance * (1 + congestionLevel);

  // Find the best transit option
  let bestTransit: { mode: TransportMode; time: number } | null = null;

  for (const t of availableTransport) {
    const mode = transportTypeToMode(t.type);
    if (mode === null) continue;
    if (bestTransit === null || t.estimatedTime < bestTransit.time) {
      bestTransit = { mode, time: t.estimatedTime };
    }
  }

  // Choose transit if it beats driving within the threshold
  if (
    bestTransit !== null &&
    bestTransit.time < driveTime * MODE_CHOICE.TRANSIT_TIME_MULTIPLIER_THRESHOLD
  ) {
    return bestTransit.mode;
  }

  return TransportMode.DRIVE;
}

const TRANSPORT_TYPE_TO_MODE: Partial<Record<TransportType, TransportMode>> = {
  [TransportType.BUS]: TransportMode.BUS,
  [TransportType.METRO]: TransportMode.METRO,
  [TransportType.RAIL]: TransportMode.RAIL,
  [TransportType.FERRY]: TransportMode.FERRY,
};

export function transportTypeToMode(type: TransportType): TransportMode | null {
  return TRANSPORT_TYPE_TO_MODE[type] ?? null;
}

// ── Multi-modal mode choice ─────────────────────────────────────

export interface MultiModalChoice {
  mode: TransportMode;
  /** Non-null when a multi-leg transit route was chosen */
  multiLeg: MultiLegRoute | null;
  /**
   * 選中的那條路要花多久（tick）。
   *
   * 每一種走法要花多久本來就得算出來才比得出快慢 —— 這裡把它留下來。通勤時間
   * 是市民對城市最直接的感受：距離、壅塞與大眾運輸都反映在同一個數字上，所以
   * 換工作與搬家都拿它判斷，而不是拿直線距離（拿距離的話，住在捷運站旁邊跟住
   * 在荒郊野外沒有差別）。
   *
   * 回報的是**實際選中**那一種的時間，不是最快那一種 —— 大眾運輸只要不比開車
   * 慢過 1.5 倍就會被選，市民花掉的是那個比較慢的時間。
   */
  time: number;
}

export interface ModeChoiceParams {
  /** 0 = 暢通。開車時間隨它上升。 */
  congestionLevel: number;
  /**
   * 步行速度（格/tick）。開車的參考速度是「一格一 tick」，所以這個數字就是
   * 走路對開車的速度比 —— 走路本來就該花比較久穿越同一格。
   */
  walkSpeed: number;
  /**
   * 步行時間放大幾倍來比較。走一分鐘比坐一分鐘難熬。
   *
   * 只影響**比較**：回報的 `time` 一律是實際花掉的時間。兩者混在一起的話，
   * 通勤統計與通勤圖層上會出現一個沒有任何人真的花掉的數字。
   */
  walkWeight: number;
}

/** 一種走法在市民心裡的成本 —— 走路那一段多收一份不情願。 */
function perceived(totalTime: number, walkTime: number, walkWeight: number): number {
  return totalTime + walkTime * (walkWeight - 1);
}

/**
 * Extended mode choice that considers multi-modal (transfer) routes
 * alongside single-transit and driving options.
 */
export function chooseModeMultiModal(
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  singleTransit: AvailableTransport[],
  multiModalRoutes: MultiLegRoute[],
  params: ModeChoiceParams,
): MultiModalChoice {
  const { congestionLevel, walkSpeed, walkWeight } = params;
  const dx = Math.abs(destination.x - origin.x);
  const dy = Math.abs(destination.y - origin.y);
  const distance = dx + dy;

  if (distance <= MODE_CHOICE.WALK_MAX_DISTANCE) {
    // 這麼近就直接走 —— 不比較，因為開車去隔壁本來就不合理。
    return { mode: TransportMode.WALK, multiLeg: null, time: distance / walkSpeed };
  }

  const driveTime = distance * (1 + congestionLevel);
  const threshold = driveTime * MODE_CHOICE.TRANSIT_TIME_MULTIPLIER_THRESHOLD;

  // 比較用加權後的成本，回報用實際時間 —— 兩個數字要分開帶著。
  let bestCost = Infinity;
  let bestTime = Infinity;
  let bestMode: TransportMode = TransportMode.DRIVE;
  let bestMultiLeg: MultiLegRoute | null = null;

  for (const t of singleTransit) {
    const mode = transportTypeToMode(t.type);
    if (mode === null) continue;
    const cost = perceived(t.estimatedTime, t.walkTime, walkWeight);
    if (cost < bestCost) {
      bestCost = cost;
      bestTime = t.estimatedTime;
      bestMode = mode;
      bestMultiLeg = null;
    }
  }

  // 轉乘路線按名目時間排序，但加權後名次可能不同 —— 全部比過，否則兩種走法
  // 等於放在不同的尺上。
  for (const route of multiModalRoutes) {
    const cost = perceived(route.totalTime, route.walkTime, walkWeight);
    if (cost >= bestCost) continue;
    bestCost = cost;
    bestTime = route.totalTime;
    const firstRide = route.legs.find(l => l.type === 'ride');
    bestMode = (firstRide?.transitType && transportTypeToMode(firstRide.transitType))
      ?? TransportMode.BUS;
    bestMultiLeg = route;
  }

  if (bestCost < threshold) {
    return { mode: bestMode, multiLeg: bestMultiLeg, time: bestTime };
  }

  return { mode: TransportMode.DRIVE, multiLeg: null, time: driveTime };
}

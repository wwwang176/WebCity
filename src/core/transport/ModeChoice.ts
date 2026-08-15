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

/**
 * Extended mode choice that considers multi-modal (transfer) routes
 * alongside single-transit and driving options.
 */
export function chooseModeMultiModal(
  origin: { x: number; y: number },
  destination: { x: number; y: number },
  singleTransit: AvailableTransport[],
  multiModalRoutes: MultiLegRoute[],
  congestionLevel: number,
): MultiModalChoice {
  const dx = Math.abs(destination.x - origin.x);
  const dy = Math.abs(destination.y - origin.y);
  const distance = dx + dy;

  if (distance <= MODE_CHOICE.WALK_MAX_DISTANCE) {
    // 走路速度是一格一 tick，所以時間就是格數。
    return { mode: TransportMode.WALK, multiLeg: null, time: distance };
  }

  const driveTime = distance * (1 + congestionLevel);
  const threshold = driveTime * MODE_CHOICE.TRANSIT_TIME_MULTIPLIER_THRESHOLD;

  // Best single-transit option
  let bestTime = Infinity;
  let bestMode: TransportMode = TransportMode.DRIVE;
  let bestMultiLeg: MultiLegRoute | null = null;

  for (const t of singleTransit) {
    const mode = transportTypeToMode(t.type);
    if (mode !== null && t.estimatedTime < bestTime) {
      bestTime = t.estimatedTime;
      bestMode = mode;
      bestMultiLeg = null;
    }
  }

  // Best multi-modal option (already sorted by totalTime, [0] is best)
  if (multiModalRoutes.length > 0) {
    const best = multiModalRoutes[0]!;
    if (best.totalTime < bestTime) {
      bestTime = best.totalTime;
      const firstRide = best.legs.find(l => l.type === 'ride');
      bestMode = (firstRide?.transitType && transportTypeToMode(firstRide.transitType))
        ?? TransportMode.BUS;
      bestMultiLeg = best;
    }
  }

  if (bestTime < threshold) {
    return { mode: bestMode, multiLeg: bestMultiLeg, time: bestTime };
  }

  return { mode: TransportMode.DRIVE, multiLeg: null, time: driveTime };
}

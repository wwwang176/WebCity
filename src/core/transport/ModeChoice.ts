import { TransportMode, TransportType, type TransportStop } from './types';
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
   * How much of `estimatedTime` is spent walking.
   *
   * Carried separately because comparison charges walking an extra reluctance factor
   * while reporting must not. A single merged number cannot weight one leg only.
   */
  walkTime: number;
  /**
   * The two stops this estimate was computed for.
   *
   * Dispatch and rider counting must follow them. Re-picking "the nearest stop" after the
   * mode is chosen lands on a stop of a different route: nearest along the sidewalk and
   * fastest overall are different criteria, and picking independently diverges (BUG-283).
   *
   * Optional because callers that only check the arithmetic — and the accessibility field,
   * which scores but never dispatches — do not need them. `findAvailableTransit`, the path
   * that actually sends pedestrians out, always fills them in.
   */
  boardStop?: TransportStop;
  alightStop?: TransportStop;
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
   * How long the chosen option takes, in ticks.
   *
   * Every option's duration has to be computed to compare them, so it is kept. Commute
   * time is the most direct thing a citizen feels about the city — distance, congestion
   * and transit all land in this one number — so job changes and relocations decide on it
   * rather than on straight-line distance, which cannot tell living next to a metro
   * station apart from living nowhere.
   *
   * This is the time of the option **actually chosen**, not the fastest one: transit is
   * picked as long as it is no more than 1.5x slower than driving, and the citizen spends
   * that slower time.
   */
  time: number;
  /**
   * Boarding and alighting stops when a single transit mode was chosen. `null` for
   * walking, driving and transfer routes — a transfer route carries a pair per leg in
   * `multiLeg.legs`.
   */
  boardStop: TransportStop | null;
  alightStop: TransportStop | null;
}

export interface ModeChoiceParams {
  /** 0 = clear. Driving time rises with it. */
  congestionLevel: number;
  /**
   * Walking speed in tiles per tick. Driving's reference speed is one tile per tick, so
   * this number is the walk-to-drive speed ratio: walking takes longer over the same tile.
   */
  walkSpeed: number;
  /**
   * Factor applied to walking time when comparing. A minute on foot is harder than a
   * minute seated.
   *
   * Affects **comparison** only: the reported `time` is always the time actually spent.
   * Mixing the two would put a number nobody spent into the commute statistics and the
   * commute overlay.
   */
  walkWeight: number;
  /**
   * Factor applied to driving in the citizen's perception (a congestion charge).
   * 1 = no charge.
   *
   * Same rule as `walkWeight`: comparison only, while the reported `time` is the time
   * actually spent. A charge does not make a car drive slower.
   */
  driveDeterrence: number;
}

/** Perceived cost of an option, charging the walking leg an extra reluctance factor. */
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
  const { congestionLevel, walkSpeed, walkWeight, driveDeterrence } = params;
  const dx = Math.abs(destination.x - origin.x);
  const dy = Math.abs(destination.y - origin.y);
  const distance = dx + dy;

  if (distance <= MODE_CHOICE.WALK_MAX_DISTANCE) {
    // Short enough to just walk; driving next door is not worth comparing.
    return {
      mode: TransportMode.WALK, multiLeg: null, time: distance / walkSpeed,
      boardStop: null, alightStop: null,
    };
  }

  const driveTime = distance * (1 + congestionLevel);
  // The charge applies to perceived cost, not to time on the road: the DRIVE branch below
  // reports driveTime.
  const driveCost = driveTime * driveDeterrence;
  const threshold = driveCost * MODE_CHOICE.TRANSIT_TIME_MULTIPLIER_THRESHOLD;

  // Weighted cost for comparison, real time for reporting: the two are tracked separately.
  let bestCost = Infinity;
  let bestTime = Infinity;
  let bestMode: TransportMode = TransportMode.DRIVE;
  let bestMultiLeg: MultiLegRoute | null = null;
  // Replaced together with the winner; keeping a previous candidate's stops would credit
  // the citizen to a route they did not ride.
  let bestBoard: TransportStop | null = null;
  let bestAlight: TransportStop | null = null;

  for (const t of singleTransit) {
    const mode = transportTypeToMode(t.type);
    if (mode === null) continue;
    const cost = perceived(t.estimatedTime, t.walkTime, walkWeight);
    if (cost < bestCost) {
      bestCost = cost;
      bestTime = t.estimatedTime;
      bestMode = mode;
      bestMultiLeg = null;
      bestBoard = t.boardStop ?? null;
      bestAlight = t.alightStop ?? null;
    }
  }

  // Transfer routes are sorted by nominal time, but weighting can reorder them, so all of
  // them are compared; otherwise the two kinds of option sit on different scales.
  for (const route of multiModalRoutes) {
    const cost = perceived(route.totalTime, route.walkTime, walkWeight);
    if (cost >= bestCost) continue;
    bestCost = cost;
    bestTime = route.totalTime;
    const firstRide = route.legs.find(l => l.type === 'ride');
    bestMode = (firstRide?.transitType && transportTypeToMode(firstRide.transitType))
      ?? TransportMode.BUS;
    bestMultiLeg = route;
    // A transfer route carries its stops per leg; these two fields describe single-mode
    // trips only.
    bestBoard = null;
    bestAlight = null;
  }

  if (bestCost < threshold) {
    return {
      mode: bestMode, multiLeg: bestMultiLeg, time: bestTime,
      boardStop: bestBoard, alightStop: bestAlight,
    };
  }

  return {
    mode: TransportMode.DRIVE, multiLeg: null, time: driveTime,
    boardStop: null, alightStop: null,
  };
}

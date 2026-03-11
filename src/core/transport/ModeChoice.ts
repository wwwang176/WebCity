import { TransportMode, TransportType } from './types';

const WALK_MAX_DISTANCE = 3;
const TRANSIT_TIME_MULTIPLIER_THRESHOLD = 1.5;

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
  if (distance <= WALK_MAX_DISTANCE) {
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
    bestTransit.time < driveTime * TRANSIT_TIME_MULTIPLIER_THRESHOLD
  ) {
    return bestTransit.mode;
  }

  return TransportMode.DRIVE;
}

function transportTypeToMode(type: TransportType): TransportMode | null {
  switch (type) {
    case TransportType.BUS:
      return TransportMode.BUS;
    case TransportType.METRO:
      return TransportMode.METRO;
    case TransportType.RAIL:
      return TransportMode.RAIL;
    case TransportType.FERRY:
      return TransportMode.FERRY;
    case TransportType.TAXI:
      return TransportMode.TAXI;
    default:
      return null;
  }
}

import { TransportType } from './types';

/**
 * How far people will walk for each transport type, in tiles.
 *
 * A single global limit would give a bus stop and a metro station identical catchments.
 * People walk further for metro — it is fast, frequent and sparsely stationed — and
 * less far for an infrequent bus, whose stops are dense enough not to need it.
 *
 * These are hard "cannot reach" bounds, not behaviour rules. The finer trade-off is
 * handled by time itself: walking time enters the mode comparison and is scaled by a
 * reluctance factor (see `citizen/WalkWillingness`). The limits only cut off implausible
 * distances and bound the walk-coverage search radius.
 */
export const WALK_RANGE_BY_TYPE = {
  BY_TYPE: {
    [TransportType.BUS]: 5,
    [TransportType.METRO]: 12,
    [TransportType.RAIL]: 12,
    [TransportType.FERRY]: 9,
    [TransportType.AIRPORT]: 12,
  } as Record<TransportType, number>,
  FALLBACK: 8,
  /**
   * The widest of the limits.
   *
   * Walk coverage is computed once per stop and cached under a key that includes the
   * radius, so scanning per transport type recomputes the same stop repeatedly. Scan
   * once at this radius and let each type truncate.
   */
  WIDEST: 12,
} as const;

/** Walk limit for this transport type, in tiles. */
export function walkRangeFor(type: TransportType): number {
  return WALK_RANGE_BY_TYPE.BY_TYPE[type] ?? WALK_RANGE_BY_TYPE.FALLBACK;
}

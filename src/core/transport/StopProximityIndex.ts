import { toPosKey } from '../grid/GridHelpers';
import { walkRangeFor, WALK_RANGE_BY_TYPE } from './WalkRange';
import type { StopReach } from '../traffic/StopWalkReach';
import type { FlatRoute } from './MultiModalRouter';

/**
 * One stop reachable on foot from a given cell.
 *
 * The distance is in **tiles**, not time. The two stop-picking paths divide it
 * differently: single-mode sums both ends and divides once, transfers charge each
 * leg separately. Storing time would force a walking speed at index-build time.
 */
export interface NearbyStop {
  /** Index into the `routes` array. */
  routeIdx: number;
  /** Index into that route's `stops` array. */
  stopIdx: number;
  /** Tiles walked along the sidewalk to reach that stop. */
  walkDistance: number;
}

const NONE: readonly NearbyStop[] = [];

/**
 * Per-cell index of the stops reachable from it, shared by both stop-picking paths.
 *
 * Without it, every citizen asked costs one walk-distance measurement per stop in the
 * city, and the multi-modal path re-measures the alighting side inside the boarding
 * loop even though it does not depend on the boarding stop. Measured on a 42k-citizen
 * save (3 routes, 19 stops, 2.77 reachable stops per citizen): 5.74µs per citizen for
 * the per-stop scan, 0.25µs for two index lookups.
 *
 * Reachability comes from `StopReach`, i.e. measured along the sidewalk graph — the
 * same geometry `TransitAccessField` uses.
 *
 * It differs from `TransitAccessField` in how many stops it keeps per route: that one
 * keeps only the nearest, this one keeps all of them, because transfers choose among
 * candidate stops.
 *
 * Rebuilt together with the routes (`rebuildTransferGraphIfDirty`). Stop positions and
 * sidewalks cannot change between two rebuilds.
 */
export class StopProximityIndex {
  private readonly byCell = new Map<string, NearbyStop[]>();

  private constructor() {}

  static build(routes: readonly FlatRoute[], reach: StopReach): StopProximityIndex {
    const index = new StopProximityIndex();

    for (let ri = 0; ri < routes.length; ri++) {
      const route = routes[ri]!;
      // Always scan at the widest radius and truncate per transport type: the coverage
      // cache is keyed by radius, so scanning per type recomputes the same stop repeatedly.
      const limit = walkRangeFor(route.type);
      for (let si = 0; si < route.stops.length; si++) {
        const stop = route.stops[si]!;
        for (const [cellKey, walkDistance] of reach.cellsWithin(stop.x, stop.y, WALK_RANGE_BY_TYPE.WIDEST)) {
          if (walkDistance > limit) continue;
          const list = index.byCell.get(cellKey);
          if (list) list.push({ routeIdx: ri, stopIdx: si, walkDistance });
          else index.byCell.set(cellKey, [{ routeIdx: ri, stopIdx: si, walkDistance }]);
        }
      }
    }
    return index;
  }

  /** Stops reachable from this cell; empty array when there are none. */
  at(x: number, y: number): readonly NearbyStop[] {
    return this.byCell.get(toPosKey(x, y)) ?? NONE;
  }

  /** Number of indexed cells, for tests and debugging. */
  get size(): number {
    return this.byCell.size;
  }
}

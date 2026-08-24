import { toPosKey } from '../grid/GridHelpers';
import { computeRideDistance } from './TransitAvailability';
import { chooseModeMultiModal, type AvailableTransport, type ModeChoiceParams } from './ModeChoice';
import type { StopReach } from '../traffic/StopWalkReach';
import { expectedWait } from './RouteLoad';
import { walkRangeFor, WALK_RANGE_BY_TYPE } from './WalkRange';
import type { FlatRoute } from './MultiModalRouter';

/**
 * Transit accessibility field: which routes each cell can reach, and how long the walk is.
 *
 * Commute time depends on the origin/destination **pair**, and one housing-allocation
 * pass scores tens of thousands of pairs — routing each one through the multi-modal
 * router is not affordable. The field is built once per route change, after which the
 * commute time between any two points is a few lookups and some arithmetic.
 *
 * It trades accuracy for speed on purpose: it only answers whether both ends touch the
 * same route, and does not model transfers. Actual dispatch still runs the full
 * multi-modal router. The field is used for scoring and trigger checks, which need how
 * painful a commute roughly is, not an exact itinerary.
 *
 * Reachability comes from `StopReach`, i.e. measured along the sidewalk graph. A
 * Manhattan diamond cannot see roads: it counts the cell across the street as two tiles
 * even though pedestrians only cross at junctions, which understates commute times and
 * assigns households to stops on the far side of the road.
 */

/** One stop reachable on foot from a given cell. */
export interface TransitAccess {
  /** Index into the `routes` array. */
  routeIdx: number;
  /** Index into that route's `stops` array. */
  stopIdx: number;
  /** Ticks spent walking to that stop. */
  walkTime: number;
}

const NONE: readonly TransitAccess[] = [];

export class TransitAccessField {
  private readonly byCell = new Map<string, TransitAccess[]>();

  private constructor() {}

  /**
   * Records the cells each stop can be walked to from, along with the walk time.
   *
   * Only the nearest stop of a route is kept: keeping all of them would grow the field
   * to stops × coverage area, and the further stops are never selected.
   */
  static build(
    routes: readonly FlatRoute[], walkSpeed: number, reach: StopReach,
  ): TransitAccessField {
    const field = new TransitAccessField();

    for (let ri = 0; ri < routes.length; ri++) {
      const route = routes[ri]!;
      // Always scan at the widest radius and truncate per transport type: the coverage
      // cache is keyed by radius, so scanning per type recomputes the same stop repeatedly.
      const limit = walkRangeFor(route.type);
      for (let si = 0; si < route.stops.length; si++) {
        const s = route.stops[si]!;
        for (const [cellKey, walkDistance] of reach.cellsWithin(s.x, s.y, WALK_RANGE_BY_TYPE.WIDEST)) {
          if (walkDistance > limit) continue;
          field.record(cellKey, ri, si, walkDistance / walkSpeed);
        }
      }
    }
    return field;
  }

  private record(key: string, routeIdx: number, stopIdx: number, walkTime: number): void {
    const list = this.byCell.get(key);
    if (!list) {
      this.byCell.set(key, [{ routeIdx, stopIdx, walkTime }]);
      return;
    }
    const existing = list.find(a => a.routeIdx === routeIdx);
    if (!existing) {
      list.push({ routeIdx, stopIdx, walkTime });
      return;
    }
    if (walkTime < existing.walkTime) {
      existing.stopIdx = stopIdx;
      existing.walkTime = walkTime;
    }
  }

  /** Routes reachable from this cell; empty array when there are none. */
  at(x: number, y: number): readonly TransitAccess[] {
    return this.byCell.get(toPosKey(x, y)) ?? NONE;
  }

  /** Number of indexed cells, for tests and debugging. */
  get size(): number {
    return this.byCell.size;
  }
}

/**
 * Routes both ends can reach, and how long each takes.
 *
 * The time covers walking to the stop, waiting and riding. Counting only the ride would
 * make a bus on a 40-tick headway look as good as a metro.
 */
function transitOptions(
  from: { x: number; y: number }, to: { x: number; y: number },
  field: TransitAccessField, routes: readonly FlatRoute[], waitFactor: number,
): AvailableTransport[] {
  const fromAccess = field.at(from.x, from.y);
  if (fromAccess.length === 0) return [];
  const toAccess = field.at(to.x, to.y);
  if (toAccess.length === 0) return [];

  const options: AvailableTransport[] = [];
  for (const a of fromAccess) {
    const b = toAccess.find(t => t.routeIdx === a.routeIdx);
    if (!b || b.stopIdx === a.stopIdx) continue;
    const route = routes[a.routeIdx];
    if (!route) continue;

    const rideDistance = computeRideDistance(route.stops, a.stopIdx, b.stopIdx, route.segDists);
    const wait = expectedWait(route.headway, waitFactor, route.loadFactor);
    const walkTime = a.walkTime + b.walkTime;
    options.push({
      type: route.type,
      estimatedTime: walkTime + wait + rideDistance / route.speed,
      walkTime,
      boardStop: route.stops[a.stopIdx],
      alightStop: route.stops[b.stopIdx],
    });
  }
  return options;
}

/**
 * Length of this commute, in ticks.
 *
 * Driving time rises with distance and congestion, transit time is set by the network.
 * Both are on the same scale, so "far out but next to a station" and "close but stuck in
 * traffic every day" can be compared.
 *
 * Mode selection reuses `chooseModeMultiModal` rather than a second implementation: two
 * copies would silently diverge, with scoring assuming metro while dispatch sends the
 * citizen by car.
 */
export function estimateCommuteTime(
  from: { x: number; y: number },
  to: { x: number; y: number },
  choice: ModeChoiceParams,
  field: TransitAccessField,
  routes: readonly FlatRoute[],
  waitFactor: number,
): number {
  return estimateCommute(from, to, choice, field, routes, waitFactor).time;
}

/** As above, but also reports the mode; the overview panel shows the mode split. */
export function estimateCommute(
  from: { x: number; y: number },
  to: { x: number; y: number },
  choice: ModeChoiceParams,
  field: TransitAccessField,
  routes: readonly FlatRoute[],
  waitFactor: number,
): { time: number; mode: string } {
  const options = transitOptions(from, to, field, routes, waitFactor);
  const picked = chooseModeMultiModal(from, to, options, [], choice);
  return { time: picked.time, mode: picked.mode };
}

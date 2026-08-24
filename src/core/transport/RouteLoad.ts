import type { TransportStop } from './types';

/**
 * How good a route is to ride: headway and crowding.
 *
 * Both are derived from the current vehicle count and ridership rather than stored as
 * fields. Stored fields would have to be recomputed at every site that touches a route,
 * and the add-vehicle path would miss it, so adding a vehicle would raise the capacity
 * ceiling without making service any more frequent.
 */

/**
 * Load bands used by the panel. **Both are display thresholds, not simulation constants.**
 *
 * The simulation itself has no thresholds: waiting is continuous
 * (`extraHeadwaysWaited`) and rises with crowding, with no cap and no cliff. These two
 * numbers only decide when the cell turns amber and when it turns red.
 */
export const CROWDING = {
  /** More than half a headway of extra waiting — time to add a vehicle. */
  OVERLOADED_LOAD: 1.5,
  /** Watching two full vehicles go past. */
  HOPELESS_LOAD: 3,
} as const;

/**
 * Ticks for one vehicle to complete a full loop.
 *
 * A full loop rather than a one-way trip: routes are circular, and the next departure
 * comes when the vehicle is back at the start.
 */
export function computeCycleTime(
  stops: readonly TransportStop[],
  segDists: number[] | null,
  speed: number,
): number {
  const n = stops.length;
  if (n < 2 || speed <= 0) return 0;

  // Cached segment distances are only usable when they match the stop count 1:1. Trusting
  // them after a stop change but before a recompute reports another leg's distance (same
  // reason as BUG-064); falling back to straight-line distances is safer.
  const safe = segDists && segDists.length === n ? segDists : null;

  let total = 0;
  for (let i = 0; i < n; i++) {
    if (safe) { total += safe[i]!; continue; }
    const a = stops[i]!;
    const b = stops[(i + 1) % n]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total / speed;
}

/**
 * Headway: cycle time divided by vehicle count.
 *
 * This is what adding a vehicle actually buys. A headway hardwired to a multiple of the
 * stop count would let extra vehicles raise the capacity ceiling without shortening the
 * wait by a second, leaving the player's main lever with no effect on service quality.
 */
export function computeHeadway(cycleTime: number, vehicles: number): number {
  if (vehicles <= 0) return Infinity;
  return cycleTime / vehicles;
}

/**
 * Ticks a vehicle counts as in service per day. **For capacity only; not a calendar day.**
 *
 * The game runs two clocks:
 *
 * | | |
 * |---|---|
 * | Calendar | `ticksPerDay = 24`, driving ageing, wages, growth and statistics |
 * | Animation | tiles a vehicle advances per tick, chosen to look like a bus |
 *
 * Vehicle speed was never derived from physics, so dividing `cycleTime` (animation) by
 * `ticksPerDay` (calendar) treats the two clocks as one. Measured on a 12,500-citizen
 * save, a 282-tile bus route takes 141 ticks per loop against a 24-tick day: **0.17 loops
 * per day**, leaving a 50-seat vehicle with a daily capacity of **8.5 riders**. Any route
 * above roughly 9 riders would saturate, and the player would need three hundred vehicles.
 *
 * With the clocks separated, capacity uses its own scale. **The on-screen vehicle still
 * runs 0.17 loops per day** — the two clocks are deliberately not synchronised. Syncing
 * them would require vehicles to cross twenty-odd tiles per tick, trading the visuals for
 * a tidier formula.
 *
 * Where 480 comes from (the bus route in that save, 2,623 riders/day):
 *
 * | | loops/day | capacity/vehicle/day | vehicles needed |
 * |---|---|---|---|
 * | 24 (calendar, wrong) | 0.17 | 8.5 | 309 |
 * | **480** | **3.4** | **170** | **15** |
 * | 960 | 6.8 | 340 | 8 |
 *
 * 480 over 960 because at 960 a metro can never fill up (four trains carry 12,400
 * riders/day against roughly 17,600 commutes city-wide), which makes the crowding model
 * inert on metro.
 *
 * **This is a balance knob**, not a physical constant.
 */
export const TRANSIT_SERVICE_TICKS_PER_DAY = 480;

/**
 * Riders carried per day.
 *
 * Seat count must be multiplied by loops per day to be in the same unit as ridership.
 * Comparing a day's cumulative riders against `vehicles * seats` mixes a cumulative
 * quantity with an instantaneous one, which would call two buses full at the 100th rider
 * of the day and put the ceiling an order of magnitude too low.
 *
 * "Per day" means `TRANSIT_SERVICE_TICKS_PER_DAY`, not a calendar day; see above. This
 * function deliberately takes no clock parameter, so no caller can pass `ticksPerDay` in.
 */
export function computeDailyCapacity(
  vehicles: number,
  seatsPerVehicle: number,
  cycleTime: number,
): number {
  if (vehicles <= 0 || seatsPerVehicle <= 0 || cycleTime <= 0) return 0;
  const loopsPerDay = TRANSIT_SERVICE_TICKS_PER_DAY / cycleTime;
  return vehicles * seatsPerVehicle * loopsPerDay;
}

/** Load factor. No capacity but riders wanting to board is infinite. */
export function computeLoadFactor(dailyRiders: number, dailyCapacity: number): number {
  if (dailyCapacity > 0) return dailyRiders / dailyCapacity;
  return dailyRiders > 0 ? Infinity : 0;
}

/**
 * Extra vehicles a passenger waits for after failing to board.
 *
 * With `q` the probability of not boarding a given vehicle, the number of vehicles waited
 * for is geometric with expectation `q / (1 - q)`. Substituting `q = 1 - 1 / load` (when
 * L times as many people want to board as there are seats, a fraction `1 - 1/L` is left
 * behind) simplifies to exactly **load - 1**.
 *
 * Uncapped: load 11 means waiting for 10 extra vehicles. A cap would assert that crowding
 * stops getting worse past some point, which is not true.
 *
 * No cliff either. A step at load 1.5 from "still rideable" to "this line does not exist"
 * turns on a single passenger, and measured on a 12,600-citizen save that step produced a
 * limit cycle: adding vehicles pushed load past 1.5, everyone was ejected, load fell back,
 * the riders returned, and it crossed again.
 *
 * A separate refusal threshold is unnecessary: waiting diverges on its own, and waiting
 * forever is equivalent to not being able to board — mode choice compares magnitudes, so a
 * route requiring ten waits loses by itself.
 */
export function extraHeadwaysWaited(loadFactor: number): number {
  return Math.max(0, loadFactor - 1);
}

/**
 * The four load bands, which drive colour and wording.
 *
 * The boundaries mark points where **something actually changes in the model**, not round
 * numbers:
 * - `comfortable` (< 1): enough seats, nobody is left at the stop.
 * - `crowded` (>= 1): **people start failing to board** and extra waits rise from zero.
 * - `overloaded` (>= 1.5): more than half a headway of extra waiting, longer than the base
 *   wait — time to add a vehicle.
 * - `hopeless` (>= 3): watching two full vehicles go past.
 *
 * The last band is a **label, not a cliff**: the simulation does not hide the route, it
 * only makes it very slow.
 *
 * Extracted so the panel and the simulation read the same numbers; two copies would
 * silently diverge.
 */
export type RouteLoadStatus = 'comfortable' | 'crowded' | 'overloaded' | 'hopeless';

export function routeLoadStatus(loadFactor: number): RouteLoadStatus {
  if (loadFactor >= CROWDING.HOPELESS_LOAD) return 'hopeless';
  if (loadFactor >= CROWDING.OVERLOADED_LOAD) return 'overloaded';
  if (extraHeadwaysWaited(loadFactor) > 0) return 'crowded';
  return 'comfortable';
}

/**
 * The usage column in the panel. **Not clamped at 100%.**
 *
 * Clamping would make a 105% route look identical to a 400% one, when the first needs one
 * extra vehicle and the second needs three times the fleet. That column is the player's
 * only basis for deciding how many vehicles to add.
 *
 * A route with no capacity prints an em dash rather than 0%, which would read as empty.
 */
export function formatRouteUsage(riders: number, capacity: number): string {
  if (capacity <= 0) return '\u2014';
  return `${Math.round((riders / capacity) * 100)}%`;
}

/**
 * Expected wait at a stop.
 *
 * Single-mode routing, transfer routing and the accessibility field all need this number,
 * so it lives in one place; separate copies would silently disagree, with scoring assuming
 * a smooth trip while dispatch leaves the citizen waiting.
 */
export function expectedWait(headway: number, waitFactor: number, loadFactor: number): number {
  // The base wait is **half** a headway (passengers arrive at random) while extra waits are
  // **whole** headways. The two have different units, so they add rather than multiply;
  // scaling the whole term by one factor would dilute "one more vehicle" by `waitFactor`.
  return headway * (waitFactor + extraHeadwaysWaited(loadFactor));
}

/**
 * How good a route currently is to ride: headway and load factor.
 *
 * Both are computed from the current vehicle count and ridership rather than read from
 * fields, which would have to be recomputed at every site that touches a route and would
 * be missed on the add-vehicle path.
 *
 * `seatsPerVehicle` of 0 means the system is not capacity-limited; airports use a separate
 * model.
 */
export function routeService(
  route: { stops: readonly TransportStop[]; vehicles: number },
  riders: number,
  seatsPerVehicle: number,
  speed: number,
  segDists: number[] | null,
): { headway: number; loadFactor: number } {
  const cycleTime = computeCycleTime(route.stops, segDists, speed);
  const loadFactor = seatsPerVehicle > 0
    ? computeLoadFactor(
        riders,
        computeDailyCapacity(route.vehicles, seatsPerVehicle, cycleTime),
      )
    : 0;
  return { headway: computeHeadway(cycleTime, route.vehicles), loadFactor };
}

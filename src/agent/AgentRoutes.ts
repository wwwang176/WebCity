import type { TransportRoute, TransportStop } from '../core/transport/types';

/**
 * Route management: creating and deleting routes and changing vehicle counts.
 *
 * ## Why there is a layer in between
 *
 * **No two** transit modes create routes the same way:
 *
 * | | How | Can it fail |
 * |---|---|---|
 * | Bus | `Game.createBusRoute()`, with lane pathfinding along the roads | Yes, when there is no road between stops |
 * | Metro | `metro.createLine()` | No |
 * | Rail | `rail.createLine()`, also choosing passenger or freight | No |
 * | Ferry | validate water connectivity, then `ferry.createRoute()` | Yes, when a dock is unreachable |
 *
 * Those differences are wrapped in each mode's `ModeAdapter`, assembled in `index.ts`. This
 * class does only the **validation common to all four**: the stops exist, there are at least
 * two, their order is preserved, and the route id is real.
 *
 * ## Every method returns a result object rather than throwing
 *
 * The same rule as `AgentApi.act()`. Callers are programs and read `{ ok: false, reason }`, and
 * **a refusal never touches the game** — the tests check that.
 */

export type TransitMode = 'bus' | 'metro' | 'rail' | 'ferry';

export const TRANSIT_MODES: readonly TransitMode[] = ['bus', 'metro', 'rail', 'ferry'];

/**
 * The fewest vehicles a running route may keep.
 *
 * `BaseTransportSystem.removeVehicleFromRoute()` **returns immediately** at `vehicles <= 1`,
 * and all four modes inherit it. Stopping a route means deleting it, not reducing it to zero
 * vehicles.
 */
export const MIN_VEHICLES_ON_A_LIVE_ROUTE = 1;

/** The six things a transit mode must provide. */
export interface ModeAdapter {
  stops(): readonly TransportStop[];
  listRoutes(): readonly TransportRoute[];
  /** `null` when the route cannot be built: no road for a bus, no water route for a ferry. */
  createRoute(stops: readonly TransportStop[], vehicleCount: number): TransportRoute | null;
  deleteRoute(routeId: number): void;
  addVehicle(routeId: number): void;
  removeVehicle(routeId: number): void;
}

export type RouteHost = Record<TransitMode, ModeAdapter>;

export interface StopInfo {
  id: number;
  x: number;
  y: number;
}

export interface RouteInfo {
  routeId: number;
  stopIds: number[];
  vehicleCount: number;
  /** The route is broken — its road was demolished, say — and service is suspended. */
  suspended: boolean;
}

export interface RouteResult {
  ok: boolean;
  mode: string;
  routeId?: number;
  stopIds?: number[];
  vehicleCount?: number;
  reason?: string;
}

export class AgentRoutes {
  constructor(private readonly host: Partial<RouteHost>) {}

  /** Which transit modes can be operated. */
  modes(): readonly TransitMode[] {
    return TRANSIT_MODES;
  }

  /** The stops already built for this mode. Route creation takes its ids from here. */
  stops(mode: string): StopInfo[] {
    const a = this.adapter(mode);
    if (!a) return [];
    return a.stops().map(s => ({ id: s.id, x: s.x, y: s.y }));
  }

  /** The routes this mode is currently running. */
  list(mode: string): RouteInfo[] {
    const a = this.adapter(mode);
    if (!a) return [];
    return a.listRoutes().map(r => ({
      routeId: r.id,
      stopIds: r.stops.map(s => s.id),
      vehicleCount: r.vehicles,
      suspended: r.suspended === true,
    }));
  }

  /**
   * Creates a route calling at these stops in order.
   *
   * **The order of `stopIds` is the order of travel**: nothing is sorted or deduplicated, and
   * 3-1-2 is a different route from 1-2-3.
   */
  create(mode: string, stopIds: readonly number[], vehicleCount = 1): RouteResult {
    const a = this.adapter(mode);
    if (!a) return { ok: false, mode, reason: `unknown transit mode: ${mode}` };

    if (!Number.isInteger(vehicleCount) || vehicleCount < 0) {
      return { ok: false, mode, reason: `vehicleCount must be a whole number of vehicles: ${vehicleCount}` };
    }
    if (stopIds.length < 2) {
      return { ok: false, mode, reason: `a route needs at least 2 stops, got ${stopIds.length}` };
    }

    const byId = new Map(a.stops().map(s => [s.id, s]));
    const chosen: TransportStop[] = [];
    for (const id of stopIds) {
      const s = byId.get(id);
      if (!s) return { ok: false, mode, reason: `no ${mode} stop with id ${id}` };
      chosen.push(s);
    }

    const route = a.createRoute(chosen, vehicleCount);
    if (!route) {
      // A bus with no road or a ferry with no water route. The game layer already decided; this
      // only puts it into words.
      return { ok: false, mode, stopIds: [...stopIds], reason: `${mode} cannot reach every stop on this route` };
    }
    return {
      ok: true, mode,
      routeId: route.id,
      stopIds: route.stops.map(s => s.id),
      vehicleCount: route.vehicles,
    };
  }

  delete(mode: string, routeId: number): RouteResult {
    return this.onRoute(mode, routeId, (a, r) => {
      a.deleteRoute(r.id);
      return { ok: true, mode, routeId };
    });
  }

  addVehicle(mode: string, routeId: number): RouteResult {
    return this.onRoute(mode, routeId, (a, r) => {
      a.addVehicle(r.id);
      return { ok: true, mode, routeId, vehicleCount: this.vehicleCount(mode, routeId) };
    });
  }

  removeVehicle(mode: string, routeId: number): RouteResult {
    return this.onRoute(mode, routeId, (a, r) => {
      // At the floor the game silently does nothing, which would produce an `ok: true` result
      // for an action that had no effect — harder to diagnose than a plain refusal.
      if (r.vehicles <= MIN_VEHICLES_ON_A_LIVE_ROUTE) {
        return {
          ok: false, mode, routeId, vehicleCount: r.vehicles,
          reason: `${mode} route ${routeId} is down to its last vehicle; delete the route instead`,
        };
      }
      a.removeVehicle(r.id);
      return { ok: true, mode, routeId, vehicleCount: this.vehicleCount(mode, routeId) };
    });
  }

  // ── Internal ────────────────────────────────────────────────────

  private adapter(mode: string): ModeAdapter | null {
    return (TRANSIT_MODES as readonly string[]).includes(mode)
      ? this.host[mode as TransitMode] ?? null
      : null;
  }

  /**
   * The common preamble: the mode exists, and the route id belongs to **that mode**.
   *
   * Each mode numbers its routes from the bottom independently, so collisions across modes are
   * normal and the lookup stays within one mode's list.
   */
  private onRoute(
    mode: string,
    routeId: number,
    run: (a: ModeAdapter, route: TransportRoute) => RouteResult,
  ): RouteResult {
    const a = this.adapter(mode);
    if (!a) return { ok: false, mode, reason: `unknown transit mode: ${mode}` };
    const route = a.listRoutes().find(r => r.id === routeId);
    if (!route) return { ok: false, mode, routeId, reason: `no ${mode} route with id ${routeId}` };
    return run(a, route);
  }

  private vehicleCount(mode: string, routeId: number): number {
    return this.list(mode).find(r => r.routeId === routeId)?.vehicleCount ?? 0;
  }
}

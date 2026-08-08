import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';
import { manhattanDistance } from '../grid/GridHelpers';
import { isFacilityOperational, type UtilityChecker } from '../service/FacilityOperational';
import type { InfraType } from '../building/InfraConfig';

export interface TransportSystemConfig {
  type: TransportType;
  speed: number;              // cells per tick
  capacity: number;
  dwellTicks: number;
  operatingCostPerVehicle: number;
  affectedByCongestion: boolean;
}

/**
 * The rider counters were added after the save format shipped, so a stop read
 * back from an older save legitimately has none of them. Declaring them
 * required made `{ dailyRiders: 0, ...s }` look like dead defaults to the
 * compiler (TS2783) when they are the entire reason that line exists.
 */
export type StoredTransportStop =
  Omit<TransportStop, 'dailyRiders' | 'lastDayRiders' | 'smoothedDailyRiders'>
  & Partial<Pick<TransportStop, 'dailyRiders' | 'lastDayRiders' | 'smoothedDailyRiders'>>;

export interface BaseTransportJSON {
  stops: StoredTransportStop[];
  routes: Array<Omit<TransportRoute, 'stops'> & { stops: number[] }>;
  vehicles: TransportVehicle[];
  nextStopId: number;
  nextRouteId: number;
  nextVehicleId: number;
}

export const TRANSPORT_SPEED = {
  MIN_CONGESTION_SPEED: 0.1,
  CONGESTION_SPEED_IMPACT: 0.5,
} as const;

export abstract class BaseTransportSystem {
  protected stops: TransportStop[] = [];
  protected routes: TransportRoute[] = [];
  protected vehicles: TransportVehicle[] = [];
  protected nextStopId = 1;
  protected nextRouteId = 1;
  protected nextVehicleId = 1;
  /** null = no filter (all operational); Set = only listed stop IDs are operational. */
  protected operationalStopIds: Set<number> | null = null;

  /**
   * Monotonic counter bumped by every structural change to stops, routes or
   * vehicles.
   *
   * The transfer graph used to be invalidated by an explicit
   * markTransitNetworkDirty() call that every mutation site had to remember —
   * a rule maintained only by a comment, and one that markLaneGraphDirty had
   * already broken once for the entire transit UI (BUG-090). Consumers now
   * compare this counter instead, so a new mutation site cannot silently skip
   * the invalidation.
   */
  private networkVersion = 0;

  /**
   * Bumped only when the set of stops or routes changes — not when a route's
   * vehicle count does.
   *
   * A rebuild has to happen for both (FlatRoute.isFull reads route.vehicles),
   * but the transfer tracker's per-building panel data is keyed by route label
   * and stays valid across a vehicle-count change. Wiping it on every
   * add/remove-vehicle click emptied the transfer panel for no reason.
   */
  private topologyVersion = 0;

  /** Bump after a vehicle-count change. */
  protected bumpNetworkVersion(): void {
    this.networkVersion++;
  }

  /** Bump after a stop/route change (also bumps the network version). */
  protected bumpTopologyVersion(): void {
    this.topologyVersion++;
    this.networkVersion++;
  }

  /** Structural revision of this system's stops/routes/vehicles. */
  getNetworkVersion(): number {
    return this.networkVersion;
  }

  /** Revision of this system's stop/route topology alone. */
  getTopologyVersion(): number {
    return this.topologyVersion;
  }

  /** Current road congestion level (0 = free-flow, 1 = gridlock). */
  congestionLevel = 0;

  constructor(protected readonly config: TransportSystemConfig) {}

  /** Update which stops are operational (have power + water). */
  updateOperationalStatus(isPowered: UtilityChecker, isWaterSupplied: UtilityChecker, infraType: InfraType): void {
    this.operationalStopIds = new Set<number>();
    for (const s of this.stops) {
      if (isFacilityOperational(s.x, s.y, infraType, isPowered, isWaterSupplied)) {
        this.operationalStopIds.add(s.id);
      }
    }
  }

  /** Check if a stop is currently operational. */
  isStopOperational(id: number): boolean {
    return this.operationalStopIds === null || this.operationalStopIds.has(id);
  }

  // ── Stop management ──────────────────────────────────────────────

  addStop(x: number, y: number): TransportStop {
    const stop: TransportStop = {
      id: this.nextStopId++,
      x,
      y,
      type: this.config.type,
      passengers: 0,
      dailyRiders: 0,
      lastDayRiders: 0,
      smoothedDailyRiders: 0,
    };
    this.stops.push(stop);
    this.bumpTopologyVersion();
    return stop;
  }

  removeStop(stopId: number): void {
    this.bumpTopologyVersion();
    this.stops = this.stops.filter(s => s.id !== stopId);
    const dissolvedIds: number[] = [];
    const modifiedRouteIds: number[] = [];
    this.routes = this.routes.filter(r => {
      const before = r.stops.length;
      r.stops = r.stops.filter(s => s.id !== stopId);
      if (r.stops.length < 2) {
        dissolvedIds.push(r.id);
        return false;
      }
      if (r.stops.length < before) {
        modifiedRouteIds.push(r.id);
      }
      return true;
    });
    // Notify BEFORE removing the vehicles: a subclass cleaning up per-vehicle
    // state needs to know which vehicles belonged to the route. FerrySystem's
    // override walks this.vehicles to find vesselPaths entries to drop, and with
    // the filter first it always found none, leaking one water path per dissolve
    // (BUG-089). RailSystem and BusSystem key by routeId and are unaffected
    // either way.
    for (const id of dissolvedIds) {
      this.onRouteDissolved(id);
      this.onRouteDissolvedHook?.(id);
    }
    this.vehicles = this.vehicles.filter(v => !dissolvedIds.includes(v.routeId));

    // Revalidate modified routes (subclasses may recompute paths / dissolve)
    const lateDissolved: number[] = [];
    for (const routeId of modifiedRouteIds) {
      const route = this.routes.find(r => r.id === routeId);
      if (!route) continue;
      if (!this.onRouteStopRemoved(route)) {
        lateDissolved.push(routeId);
      }
    }
    if (lateDissolved.length > 0) {
      this.routes = this.routes.filter(r => !lateDissolved.includes(r.id));
      // Same ordering as above — notify while the vehicles still exist.
      for (const id of lateDissolved) {
        this.onRouteDissolved(id);
        this.onRouteDissolvedHook?.(id);
      }
      this.vehicles = this.vehicles.filter(v => !lateDissolved.includes(v.routeId));
    }

    // Reset vehicles on surviving modified routes back to first stop
    for (const routeId of modifiedRouteIds) {
      if (lateDissolved.includes(routeId)) continue;
      const route = this.routes.find(r => r.id === routeId);
      if (!route || route.stops.length === 0) continue;
      const first = route.stops[0]!;
      for (const v of this.vehicles) {
        if (v.routeId !== routeId) continue;
        this.onVehicleReset(v.id);
        v.currentStopIndex = 0;
        v.position = { x: first.x, y: first.y };
        v.atStop = false;
        v.traveling = false;
        v.travelTicks = 0;
        v.waitTicks = 0;
      }
    }
  }

  // ── Route management ─────────────────────────────────────────────

  createRoute(stops: TransportStop[], vehicleCount = 1): TransportRoute {
    const route: TransportRoute = {
      id: this.nextRouteId++,
      type: this.config.type,
      stops,
      vehicles: vehicleCount,
      frequency: stops.length * 2,
      operatingCost: vehicleCount * this.config.operatingCostPerVehicle,
    };
    this.routes.push(route);
    this.bumpTopologyVersion();

    for (let i = 0; i < vehicleCount; i++) {
      this.spawnVehicle(route.id, stops[0]!);
    }

    return route;
  }

  deleteRoute(routeId: number): void {
    this.bumpTopologyVersion();
    this.routes = this.routes.filter(r => r.id !== routeId);
    this.vehicles = this.vehicles.filter(v => v.routeId !== routeId);
  }

  addVehicleToRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.stops.length === 0) return;
    this.bumpNetworkVersion();
    this.spawnVehicle(routeId, route.stops[0]!);
    route.vehicles++;
    route.operatingCost = route.vehicles * this.config.operatingCostPerVehicle;
  }

  removeVehicleFromRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.vehicles <= 1) return;
    this.bumpNetworkVersion();
    let idx = -1;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      if (this.vehicles[i]!.routeId === routeId) { idx = i; break; }
    }
    if (idx >= 0) {
      // Hook, so a subclass with per-vehicle state does not have to REPLACE
      // this method to clean it up. FerrySystem did exactly that and its copy
      // omitted the version bump, so removing a vessel left the transfer graph
      // believing the route still had its old vehicle count — and once the
      // explicit markTransitNetworkDirty call sites were deleted, nothing else
      // invalidated it either.
      this.onVehicleRemoved(this.vehicles[idx]!.id);
      this.vehicles.splice(idx, 1);
    }
    route.vehicles--;
    route.operatingCost = route.vehicles * this.config.operatingCostPerVehicle;
  }

  /** Called just before a vehicle is dropped from a route. */
  protected onVehicleRemoved(_vehicleId: number): void {}

  // ── Accessors ────────────────────────────────────────────────────

  getStops(): readonly TransportStop[] { return this.stops; }
  getRoutes(): readonly TransportRoute[] { return this.routes; }
  getVehicles(): readonly TransportVehicle[] { return this.vehicles; }

  getSpeed(): number { return this.config.speed; }

  getOperatingCost(): number {
    return this.routes.reduce((sum, r) => r.suspended ? sum : sum + r.operatingCost, 0);
  }

  /** Roll over daily riders: EMA smooth, then reset dailyRiders. */
  rolloverDailyRiders(): void {
    const alpha = 0.7;
    for (let i = 0; i < this.stops.length; i++) {
      const s = this.stops[i]!;
      s.smoothedDailyRiders = alpha * s.smoothedDailyRiders + (1 - alpha) * s.dailyRiders;
      s.lastDayRiders = s.dailyRiders;
      s.dailyRiders = 0;
    }
  }

  /** Return precomputed segment distances for a route, or null if not available. */
  getSegmentDistances(_routeId: number): number[] | null {
    return null;
  }

  protected spawnVehicle(routeId: number, stop: TransportStop): TransportVehicle {
    const vehicle: TransportVehicle = {
      id: this.nextVehicleId++,
      routeId,
      currentStopIndex: 0,
      passengers: 0,
      capacity: this.getCapacity(),
      position: { x: stop.x, y: stop.y },
      waitTicks: 0,
      atStop: false,
      travelTicks: 0,
      traveling: false,
    };
    this.vehicles.push(vehicle);
    return vehicle;
  }

  // ── Tick ─────────────────────────────────────────────────────────

  /** Check if all stops in a route are operational. */
  private isRouteFullyOperational(route: TransportRoute): boolean {
    if (this.operationalStopIds === null) return true;
    return route.stops.every(s => this.operationalStopIds!.has(s.id));
  }

  tick(): void {
    for (const vehicle of this.vehicles) {
      const route = this.routes.find(r => r.id === vehicle.routeId);
      if (!route || route.stops.length === 0) continue;
      // Freeze vehicles on routes with any non-operational stop
      if (!this.isRouteFullyOperational(route)) continue;

      if (vehicle.atStop) {
        this.tickAtStop(vehicle, route);
      } else if (vehicle.traveling) {
        this.tickTraveling(vehicle, route);
      } else {
        this.tickInitial(vehicle, route);
      }
    }
  }

  protected tickAtStop(vehicle: TransportVehicle, route: TransportRoute): void {
    vehicle.waitTicks--;
    if (vehicle.waitTicks <= 0) {
      vehicle.atStop = false;
      vehicle.currentStopIndex = (vehicle.currentStopIndex + 1) % route.stops.length;
      const nextStop = route.stops[vehicle.currentStopIndex]!;
      const dist = manhattanDistance(nextStop.x, nextStop.y, vehicle.position.x, vehicle.position.y);
      const speed = this.config.speed * this.getSpeedMultiplier();
      vehicle.travelTicks = Math.max(1, Math.ceil(dist / speed));
      vehicle.traveling = true;
      this.onDepart(vehicle, route);
    }
  }

  protected tickTraveling(vehicle: TransportVehicle, route: TransportRoute): void {
    vehicle.travelTicks--;
    if (vehicle.travelTicks <= 0) {
      const stop = route.stops[vehicle.currentStopIndex]!;
      vehicle.position = { x: stop.x, y: stop.y };
      vehicle.traveling = false;
      vehicle.atStop = true;
      vehicle.waitTicks = this.config.dwellTicks;
      this.onArrive(vehicle, stop);
      this.onTravelComplete(vehicle);
    }
  }

  protected tickInitial(vehicle: TransportVehicle, route: TransportRoute): void {
    const stop = route.stops[vehicle.currentStopIndex]!;
    vehicle.position = { x: stop.x, y: stop.y };
    vehicle.atStop = true;
    vehicle.waitTicks = this.config.dwellTicks;
    this.onArrive(vehicle, stop);
  }

  // ── Overridable hooks ────────────────────────────────────────────

  protected getSpeedMultiplier(): number {
    if (!this.config.affectedByCongestion) return 1;
    return Math.max(TRANSPORT_SPEED.MIN_CONGESTION_SPEED, 1 - this.congestionLevel * TRANSPORT_SPEED.CONGESTION_SPEED_IMPACT);
  }

  getCapacity(): number {
    return this.config.capacity;
  }

  protected onArrive(vehicle: TransportVehicle, _stop: TransportStop): void {
    // Visual-only: derive passengers from route loadFactor
    const route = this.findRouteForVehicle(vehicle);
    if (!route) { vehicle.passengers = 0; return; }
    const cap = this.getCapacity();
    const routeCapacity = route.vehicles * cap;
    if (routeCapacity <= 0) { vehicle.passengers = 0; return; }
    let riders = 0;
    for (let i = 0; i < route.stops.length; i++) riders += route.stops[i]!.dailyRiders;
    const loadFactor = Math.min(1, riders / routeCapacity);
    vehicle.passengers = Math.round(loadFactor * cap);
  }

  /** Find the route a vehicle belongs to. */
  protected findRouteForVehicle(vehicle: TransportVehicle): TransportRoute | undefined {
    for (let i = 0; i < this.routes.length; i++) {
      if (this.routes[i]!.id === vehicle.routeId) return this.routes[i]!;
    }
    return undefined;
  }

  /** Called when vehicle departs from a stop. Override for special behavior. */
  protected onDepart(_vehicle: TransportVehicle, _route: TransportRoute): void {
    // default: no-op
  }

  /** Called after a vehicle finishes traveling and arrives at a stop. Override for cleanup. */
  protected onTravelComplete(_vehicle: TransportVehicle): void {
    // default: no-op
  }

  /** External hook: called when a route is dissolved, for traffic vehicle cleanup. */
  onRouteDissolvedHook?: (routeId: number) => void;

  /** Called when a route is dissolved (< 2 stops). Override for metadata cleanup. */
  protected onRouteDissolved(_routeId: number): void {
    // default: no-op
  }

  /**
   * Called when a route survives stop removal but lost a stop.
   * Override to recompute paths. Return false to dissolve the route.
   */
  protected onRouteStopRemoved(_route: TransportRoute): boolean {
    return true; // default: route remains valid
  }

  /** Called when a vehicle is reset to first stop after route modification. */
  protected onVehicleReset(_vehicleId: number): void {
    // default: no-op
  }

  // ── Serialization ────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toJSON(): any {
    return {
      stops: this.stops.map(s => ({ ...s })),
      routes: this.routes.map(r => ({
        ...r,
        stops: r.stops.map(s => s.id),
      })),
      vehicles: this.vehicles.map(v => ({ ...v, position: { ...v.position } })),
      nextStopId: this.nextStopId,
      nextRouteId: this.nextRouteId,
      nextVehicleId: this.nextVehicleId,
    };
  }

  static baseFromJSON<T extends BaseTransportSystem>(
    data: BaseTransportJSON,
    _config: TransportSystemConfig,
    Ctor: { new (...args: any[]): T },
  ): T {
    const sys = new Ctor();
    sys.stops = data.stops.map((s: StoredTransportStop) => ({
      dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0, ...s,
    }));
    sys.routes = data.routes.map((r: any) => ({
      ...r,
      stops: (r.stops as number[]).map((id: number) => sys.stops.find(s => s.id === id)!),
    }));
    sys.vehicles = data.vehicles.map((v: TransportVehicle) => ({ ...v, position: { ...v.position } }));
    sys.nextStopId = data.nextStopId;
    sys.nextRouteId = data.nextRouteId;
    sys.nextVehicleId = data.nextVehicleId;
    // A restored system is structurally different from the empty one the
    // constructor produced, even though no mutator ran.
    sys.bumpTopologyVersion();
    return sys;
  }
}

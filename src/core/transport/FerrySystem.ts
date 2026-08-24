import { TransportType, TransportVehicle, TransportStop, TransportRoute } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';
import { findWaterPath, type WaterGrid, type WaterPathResult } from '../pathfinding/WaterPathfinder';

const FERRY_CONFIG: TransportSystemConfig = {
  type: TransportType.FERRY,
  // Logical speed in world units per tick, matched to the renderer's visual speed:
  // FERRY_VISUAL_SPEED(1.5) * base_tick_interval(0.25s) = 0.375
  speed: 0.375,
  capacity: 100,
  dwellTicks: 6,
  operatingCostPerVehicle: 200,
  affectedByCongestion: false,
};

export interface WaterChecker {
  isWater(x: number, y: number): boolean;
}

/** A vessel's A* water path, used for renderer animation. */
interface VesselPathInfo {
  waterPath: Array<{ x: number; y: number }>;
}

export class FerrySystem extends BaseTransportSystem {
  private waterGrid: WaterGrid | null = null;
  /** A* path info per vessel. */
  private vesselPaths = new Map<number, VesselPathInfo>();
  /** A* path cache keyed by "fromX,fromY>toX,toY", precomputed when a route is created. */
  private waterPathCache = new Map<string, WaterPathResult | null>();

  constructor() {
    super(FERRY_CONFIG);
  }

  /**
   * Sets the water grid used for A* water pathfinding.
   * Clears the cache and re-precomputes the existing routes.
   */
  setWaterGrid(grid: WaterGrid): void {
    this.waterGrid = grid;
    this.waterPathCache.clear();
    for (const route of this.routes) {
      this.precomputeRoutePaths(route);
    }
  }

  private pathCacheKey(from: { x: number; y: number }, to: { x: number; y: number }): string {
    return `${from.x},${from.y}>${to.x},${to.y}`;
  }

  /** Precomputes and caches the A* path for every leg of a route. */
  private precomputeRoutePaths(route: TransportRoute): void {
    if (!this.waterGrid) return;
    for (let i = 0; i < route.stops.length; i++) {
      const from = route.stops[i]!;
      const to = route.stops[(i + 1) % route.stops.length]!;
      const key = this.pathCacheKey(from, to);
      if (!this.waterPathCache.has(key)) {
        this.waterPathCache.set(key, findWaterPath(this.waterGrid, from, to));
      }
    }
  }

  /** Cached A* path; computes and caches it on a miss. */
  private getCachedPath(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): WaterPathResult | null {
    const key = this.pathCacheKey(from, to);
    if (this.waterPathCache.has(key)) {
      return this.waterPathCache.get(key)!;
    }
    // Cache miss: compute now and store.
    const result = this.waterGrid ? findWaterPath(this.waterGrid, from, to) : null;
    this.waterPathCache.set(key, result);
    return result;
  }

  /** Return precomputed segment distances from water path cache. */
  override getSegmentDistances(routeId: number): number[] | null {
    const route = this.routes.find(r => r.id === routeId);
    if (!route) return null;
    const dists: number[] = [];
    for (let i = 0; i < route.stops.length; i++) {
      const from = route.stops[i]!;
      const to = route.stops[(i + 1) % route.stops.length]!;
      const result = this.getCachedPath(from, to);
      if (!result) return null;
      dists.push(result.distance);
    }
    return dists;
  }

  // ── Alias methods for Ferry-specific naming ─────────────────────

  /**
   * Add a dock. The dock must be adjacent to or on water.
   * @param waterChecker Optional checker -- if provided, will reject non-water tiles.
   * @returns The created dock, or null if the location is not on water.
   */
  addDock(
    x: number,
    y: number,
    waterChecker?: WaterChecker,
  ): TransportStop | null {
    if (waterChecker && !waterChecker.isWater(x, y)) {
      return null;
    }
    return this.addStop(x, y);
  }

  removeDock(dockId: number): void {
    this.removeStop(dockId);
  }

  /**
   * Drop every cached A* result that starts or ends at a departed dock.
   *
   * waterPathCache is keyed by COORDINATES, so nothing ties its entries to a dock's
   * lifetime. Without this, every dock ever built and demolished leaves its results
   * behind, and rebuilding on the same tile after reshaping the water answers
   * connectivity from the old map.
   *
   * Scoped to the removed dock deliberately: clearing the whole cache would throw away
   * every other route's paths on each demolition.
   */
  override removeStop(stopId: number): void {
    const dock = this.stops.find(s => s.id === stopId);
    super.removeStop(stopId);
    if (!dock) return;
    const from = `${dock.x},${dock.y}>`;
    const to = `>${dock.x},${dock.y}`;
    for (const key of this.waterPathCache.keys()) {
      if (key.startsWith(from) || key.endsWith(to)) this.waterPathCache.delete(key);
    }
  }

  protected override onRouteDissolved(routeId: number): void {
    for (const v of this.vehicles) {
      if (v.routeId === routeId) this.vesselPaths.delete(v.id);
    }
  }

  protected override onRouteStopRemoved(route: TransportRoute): boolean {
    if (!this.waterGrid) return true;
    // Validate that all consecutive docks are still connected via water
    for (let i = 0; i < route.stops.length; i++) {
      const from = route.stops[i]!;
      const to = route.stops[(i + 1) % route.stops.length]!;
      const result = this.getCachedPath(from, to);
      if (!result) return false; // disconnected → dissolve
    }
    // Recompute all route paths (new segments after stop removal)
    this.precomputeRoutePaths(route);
    return true;
  }

  protected override onVehicleReset(vehicleId: number): void {
    this.vesselPaths.delete(vehicleId);
  }

  override createRoute(stops: TransportStop[], vehicleCount = 1): TransportRoute {
    const route = super.createRoute(stops, vehicleCount);
    this.precomputeRoutePaths(route);
    return route;
  }

  /** Whether the docks are connected by water, answered from the cache. */
  validateRouteConnectivity(docks: TransportStop[]): boolean {
    if (!this.waterGrid || docks.length < 2) return false;
    for (let i = 0; i < docks.length - 1; i++) {
      const result = this.getCachedPath(docks[i]!, docks[i + 1]!);
      if (!result) return false;
    }
    return true;
  }

  getVessels(): readonly TransportVehicle[] {
    return this.getVehicles();
  }

  getDocks(): readonly TransportStop[] {
    return this.getStops();
  }

  /** A vessel's A* path, used for heading calculation and rendering. */
  getVesselPath(vesselId: number): Array<{ x: number; y: number }> | null {
    const info = this.vesselPaths.get(vesselId);
    return info ? info.waterPath : null;
  }


  /** Drops the departing vessel's cached A* path. */
  protected override onVehicleRemoved(vehicleId: number): void {
    this.vesselPaths.delete(vehicleId);
  }

  override deleteRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    // Drop this route's leg paths from the cache.
    if (route) {
      for (let i = 0; i < route.stops.length; i++) {
        const from = route.stops[i]!;
        const to = route.stops[(i + 1) % route.stops.length]!;
        this.waterPathCache.delete(this.pathCacheKey(from, to));
      }
    }
    for (const v of this.vehicles) {
      if (v.routeId === routeId) this.vesselPaths.delete(v.id);
    }
    super.deleteRoute(routeId);
  }

  // ── Override tick methods for A* water pathing ──────────────────

  protected override onDepart(vehicle: TransportVehicle, route: TransportRoute): void {
    const nextDock = route.stops[vehicle.currentStopIndex]!;

    // Take the A* path from the cache; it was precomputed when the route was created.
    const result = this.getCachedPath(vehicle.position, nextDock);
    if (result && result.path.length > 1) {
      this.vesselPaths.set(vehicle.id, {
        waterPath: result.path,
      });
      vehicle.travelTicks = Math.max(1, Math.ceil(result.distance / this.config.speed));
      return;
    }
    // No water path or no grid — fallback travelTicks already set by base
  }

  protected override onTravelComplete(vehicle: TransportVehicle): void {
    this.vesselPaths.delete(vehicle.id);
  }

  // ── Serialization ───────────────────────────────────────────────

  override toJSON() {
    const base = super.toJSON() as BaseTransportJSON;
    return {
      docks: base.stops,
      routes: base.routes,
      vessels: base.vehicles,
      nextDockId: base.nextStopId,
      nextRouteId: base.nextRouteId,
      nextVesselId: base.nextVehicleId,
    };
  }

  static fromJSON(data: ReturnType<FerrySystem['toJSON']>): FerrySystem {
    const baseData: BaseTransportJSON = {
      stops: data.docks,
      routes: data.routes,
      vehicles: data.vessels,
      nextStopId: data.nextDockId,
      nextRouteId: data.nextRouteId,
      nextVehicleId: data.nextVesselId,
    };
    return BaseTransportSystem.baseFromJSON(baseData, FERRY_CONFIG, FerrySystem);
  }
}

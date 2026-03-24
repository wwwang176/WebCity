import { TransportType, type TransportRoute, type TransportStop } from './types';
import { BaseTransportSystem, type TransportSystemConfig } from './BaseTransportSystem';
import { findAdjacentRoadCell, type PlacementGrid } from './TransportPlacement';
import type { LaneEdge } from '../traffic/LaneGraph';
import type { TrafficSimulation, Vehicle } from '../traffic/TrafficSimulation';

const BUS_CONFIG: TransportSystemConfig = {
  type: TransportType.BUS,
  speed: 2,
  capacity: 50,
  dwellTicks: 2,
  operatingCostPerVehicle: 100,
  affectedByCongestion: true,
};

export class BusSystem extends BaseTransportSystem {
  /** Per-route precomputed LaneEdge segments (stop[i] → stop[i+1]). */
  private routeSegments = new Map<number, LaneEdge[][]>();
  /** Per-route TrafficSimulation vehicle IDs. */
  private busVehicleIds = new Map<number, number[]>();

  constructor() {
    super(BUS_CONFIG);
  }

  // ── Path management ─────────────────────────────────────────────

  /**
   * Compute LaneEdge paths for all legs of a route (including wrap-around).
   * Returns the segments array or null if any leg has no path.
   */
  computeRouteSegments(
    route: TransportRoute,
    findEdgePath: (fromX: number, fromY: number, toX: number, toY: number) => LaneEdge[] | null,
  ): LaneEdge[][] | null {
    const stops = route.stops;
    if (stops.length < 2) return null;
    const segments: LaneEdge[][] = [];

    for (let i = 0; i < stops.length; i++) {
      const from = stops[i]!;
      const to = stops[(i + 1) % stops.length]!;

      const fromRX = from.roadX ?? from.x;
      const fromRY = from.roadY ?? from.y;
      const toRX = to.roadX ?? to.x;
      const toRY = to.roadY ?? to.y;

      const edgePath = findEdgePath(fromRX, fromRY, toRX, toRY);
      if (!edgePath || edgePath.length === 0) return null;

      segments.push(edgePath);
    }

    this.routeSegments.set(route.id, segments);
    return segments;
  }

  /**
   * Spawn a bus vehicle into TrafficSimulation for the given route.
   * startSegment places the bus at that segment's stop (round-robin).
   * Returns the vehicle or null if no segments are cached.
   */
  spawnBusInTraffic(routeId: number, traffic: TrafficSimulation, startSegment = 0): Vehicle | null {
    const segments = this.routeSegments.get(routeId);
    if (!segments || segments.length === 0) return null;

    const vehicle = traffic.addBusVehicle(segments, routeId, startSegment);
    const ids = this.busVehicleIds.get(routeId) ?? [];
    ids.push(vehicle.id);
    this.busVehicleIds.set(routeId, ids);
    return vehicle;
  }

  /**
   * Create a bus route AND spawn its vehicle into TrafficSimulation.
   * Returns the route, or null if path computation fails.
   */
  createRouteWithTraffic(
    stops: TransportStop[],
    vehicleCount: number,
    findEdgePath: (fromX: number, fromY: number, toX: number, toY: number) => LaneEdge[] | null,
    traffic: TrafficSimulation,
  ): TransportRoute | null {
    const route = this.createRoute(stops, vehicleCount);
    const segments = this.computeRouteSegments(route, findEdgePath);
    if (!segments) {
      this.deleteRoute(route.id);
      return null;
    }
    const count = Math.max(1, vehicleCount);
    for (let i = 0; i < count; i++) {
      this.spawnBusInTraffic(route.id, traffic, i);
    }
    return route;
  }

  /** Delete a bus route and remove its vehicles from TrafficSimulation. */
  deleteRouteWithTraffic(routeId: number, traffic: TrafficSimulation): void {
    traffic.removeBusVehicles(routeId);
    this.routeSegments.delete(routeId);
    this.busVehicleIds.delete(routeId);
    this.deleteRoute(routeId);
  }

  /** Add one bus vehicle to a route in TrafficSimulation. */
  addVehicleWithTraffic(routeId: number, traffic: TrafficSimulation): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route) return;
    // Round-robin: count existing buses to pick next stop
    const existing = (this.busVehicleIds.get(routeId) ?? []).length;
    this.spawnBusInTraffic(routeId, traffic, existing);
    this.addVehicleToRoute(routeId);
  }

  /** Remove one bus vehicle from a route in TrafficSimulation. */
  removeVehicleWithTraffic(routeId: number, traffic: TrafficSimulation): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.vehicles <= 1) return;
    const removedId = traffic.removeOneBusVehicle(routeId);
    if (removedId >= 0) {
      const ids = this.busVehicleIds.get(routeId);
      if (ids) {
        const idx = ids.indexOf(removedId);
        if (idx >= 0) ids.splice(idx, 1);
      }
    }
    this.removeVehicleFromRoute(routeId);
  }

  /** Return precomputed segment distances from LaneEdge paths. */
  override getSegmentDistances(routeId: number): number[] | null {
    const segments = this.routeSegments.get(routeId);
    if (!segments) return null;
    return segments.map(edges => edges.reduce((sum, e) => sum + e.length, 0));
  }

  // ── Road change handling ────────────────────────────────────────

  /**
   * Called when road cells change. Checks all routes for impact,
   * recalculates paths, suspends unreachable routes, and resumes previously
   * suspended routes that are now reachable.
   * Returns IDs of newly suspended routes (for UI notification).
   */
  onRoadChanged(
    affectedCells: Set<string>,
    findEdgePath: (fromX: number, fromY: number, toX: number, toY: number) => LaneEdge[] | null,
    traffic: TrafficSimulation,
    grid?: PlacementGrid,
  ): number[] {
    const newlySuspendedIds: number[] = [];

    for (const route of this.routes) {
      // Re-resolve stop roadX/roadY in case adjacent road cells changed
      if (grid) {
        for (const stop of route.stops) {
          const adj = findAdjacentRoadCell(grid, stop.x, stop.y);
          if (adj) {
            stop.roadX = adj.roadX;
            stop.roadY = adj.roadY;
          }
        }
      }

      if (route.suspended) {
        // Try to resume suspended routes
        const newSegments = this.computeRouteSegments(route, findEdgePath);
        if (newSegments) {
          route.suspended = false;
          // Re-spawn bus vehicles
          const count = Math.max(1, route.vehicles);
          for (let i = 0; i < count; i++) {
            this.spawnBusInTraffic(route.id, traffic, i);
          }
        }
        continue;
      }

      const segments = this.routeSegments.get(route.id);
      if (!segments) continue;

      // Check if any segment passes through affected cells
      let affected = false;
      for (const seg of segments) {
        for (const edge of seg) {
          if (affectedCells.has(edge.from.cellKey) || affectedCells.has(edge.to.cellKey)) {
            affected = true;
            break;
          }
        }
        if (affected) break;
      }

      if (!affected) continue;

      // Try to recalculate
      const newSegments = this.computeRouteSegments(route, findEdgePath);
      if (!newSegments) {
        // Suspend route instead of dissolving
        route.suspended = true;
        traffic.removeBusVehicles(route.id);
        this.routeSegments.delete(route.id);
        this.busVehicleIds.delete(route.id);
        newlySuspendedIds.push(route.id);
        continue;
      }

      // Update running bus vehicles' segments
      this.updateRunningBusSegments(route.id, newSegments, traffic);
    }

    return newlySuspendedIds;
  }

  /** Get all currently suspended route IDs. */
  getSuspendedRouteIds(): number[] {
    return this.routes.filter(r => r.suspended).map(r => r.id);
  }

  /**
   * Rebuild routeSegments for all routes that don't have them yet
   * (e.g. after loading from save). Spawns bus vehicles for valid routes.
   */
  rebuildAllSegments(
    findEdgePath: (fromX: number, fromY: number, toX: number, toY: number) => LaneEdge[] | null,
    traffic: TrafficSimulation,
    grid?: PlacementGrid,
  ): void {
    for (const route of this.routes) {
      if (this.routeSegments.has(route.id)) continue; // already computed

      // Re-resolve stop roadX/roadY
      if (grid) {
        for (const stop of route.stops) {
          const adj = findAdjacentRoadCell(grid, stop.x, stop.y);
          if (adj) {
            stop.roadX = adj.roadX;
            stop.roadY = adj.roadY;
          }
        }
      }

      const segments = this.computeRouteSegments(route, findEdgePath);
      if (!segments) {
        route.suspended = true;
        continue;
      }

      route.suspended = false;
      // Spawn bus vehicles
      const count = Math.max(1, route.vehicles);
      for (let i = 0; i < count; i++) {
        this.spawnBusInTraffic(route.id, traffic, i);
      }
    }
  }

  /** Update segments for running bus vehicles after path recalculation. */
  private updateRunningBusSegments(
    routeId: number,
    newSegments: LaneEdge[][],
    traffic: TrafficSimulation,
  ): void {
    for (const v of traffic.vehicles) {
      if (!v.busState || v.busState.routeId !== routeId) continue;
      v.busState.segments = newSegments;
      // Reset to current segment start
      const si = Math.min(v.busState.segmentIndex, newSegments.length - 1);
      v.busState.segmentIndex = si;
      v.edgePath = newSegments[si]!;
      v.edgeIndex = 0;
      v.edgeProgress = 0;
    }
  }

  /** Remove a route and its associated data. */
  private dissolveRoute(routeId: number): void {
    this.routes = this.routes.filter(r => r.id !== routeId);
    this.vehicles = this.vehicles.filter(v => v.routeId !== routeId);
    this.routeSegments.delete(routeId);
    this.busVehicleIds.delete(routeId);
  }

  // ── Overrides ───────────────────────────────────────────────────

  /**
   * Bus movement is now handled by TrafficSimulation.advanceEdgeVehicles().
   * This tick only handles legacy TransportVehicle state for backward compat.
   */
  override tick(): void {
    // No-op: bus movement is driven by TrafficSimulation
  }

  protected override onRouteDissolved(routeId: number): void {
    this.routeSegments.delete(routeId);
    this.busVehicleIds.delete(routeId);
  }

  // ── Serialization ───────────────────────────────────────────────

  override toJSON() {
    return {
      ...super.toJSON(),
      congestionLevel: this.congestionLevel,
    };
  }

  static fromJSON(data: ReturnType<BusSystem['toJSON']>): BusSystem {
    const sys = BaseTransportSystem.baseFromJSON(data, BUS_CONFIG, BusSystem);
    sys.congestionLevel = data.congestionLevel;
    return sys;
  }
}

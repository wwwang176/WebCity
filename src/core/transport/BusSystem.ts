import { TransportType, type TransportRoute, type TransportStop } from './types';
import { BaseTransportSystem, type TransportSystemConfig } from './BaseTransportSystem';
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
    findPath: (fromX: number, fromY: number, toX: number, toY: number) => string[] | null,
    refinePath: (cellPath: string[], preferredLane: number) => LaneEdge[] | null,
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

      const cellPath = findPath(fromRX, fromRY, toRX, toRY);
      if (!cellPath) return null;

      const edgePath = refinePath(cellPath, 0); // lane 0 = outermost
      if (!edgePath || edgePath.length === 0) return null;

      segments.push(edgePath);
    }

    this.routeSegments.set(route.id, segments);
    return segments;
  }

  /**
   * Spawn a bus vehicle into TrafficSimulation for the given route.
   * Returns the vehicle or null if no segments are cached.
   */
  spawnBusInTraffic(routeId: number, traffic: TrafficSimulation): Vehicle | null {
    const segments = this.routeSegments.get(routeId);
    if (!segments || segments.length === 0) return null;

    const vehicle = traffic.addBusVehicle(segments, routeId);
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
    findPath: (fromX: number, fromY: number, toX: number, toY: number) => string[] | null,
    refinePath: (cellPath: string[], preferredLane: number) => LaneEdge[] | null,
    traffic: TrafficSimulation,
  ): TransportRoute | null {
    const route = this.createRoute(stops, vehicleCount);
    const segments = this.computeRouteSegments(route, findPath, refinePath);
    if (!segments) {
      this.deleteRoute(route.id);
      return null;
    }
    for (let i = 0; i < Math.max(1, vehicleCount); i++) {
      this.spawnBusInTraffic(route.id, traffic);
    }
    return route;
  }

  // ── Road change handling ────────────────────────────────────────

  /**
   * Called when road cells change. Checks all routes for impact,
   * recalculates paths or dissolves routes as needed.
   * Returns IDs of dissolved routes.
   */
  onRoadChanged(
    affectedCells: Set<string>,
    findPath: (fromX: number, fromY: number, toX: number, toY: number) => string[] | null,
    refinePath: (cellPath: string[], preferredLane: number) => LaneEdge[] | null,
    traffic: TrafficSimulation,
  ): number[] {
    const dissolvedRouteIds: number[] = [];

    for (const route of this.routes) {
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
      const newSegments = this.computeRouteSegments(route, findPath, refinePath);
      if (!newSegments) {
        dissolvedRouteIds.push(route.id);
        continue;
      }

      // Update running bus vehicles' segments
      this.updateRunningBusSegments(route.id, newSegments, traffic);
    }

    // Dissolve failed routes
    for (const routeId of dissolvedRouteIds) {
      this.dissolveRoute(routeId);
      traffic.removeBusVehicles(routeId);
    }

    return dissolvedRouteIds;
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

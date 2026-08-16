import { TransportType, TransportVehicle, TransportStop, TransportRoute } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';
import type { Grid } from '../grid/Grid';
import type { RailNetwork } from '../rail/RailNetwork';
import { RailType } from '../rail/types';
import { parsePosKeyUnsafe, toPosKey } from '../grid/GridHelpers';
import { hasInwardFlag } from '../grid/EdgeUtils';

export enum RailServiceType {
  PASSENGER = 'PASSENGER',
  FREIGHT = 'FREIGHT',
}

export const RAIL = {
  PASSENGER_CAPACITY: 300,
  FREIGHT_CAPACITY: 500,
} as const;

const RAIL_CONFIG: TransportSystemConfig = {
  type: TransportType.RAIL,
  speed: 4,
  capacity: RAIL.PASSENGER_CAPACITY,
  dwellTicks: 3,
  operatingCostPerVehicle: 400,
  affectedByCongestion: false,
};

export interface ExternalConnection {
  populationIn: number;
  goodsIn: number;
  goodsOut: number;
}

const nodeId = toPosKey;

/** Per-vehicle travel metadata for path-based interpolation. */
interface TrainTravelMeta {
  totalTicks: number;
  segIdx: number;
  /** Parsed path points for fast interpolation. */
  points: Array<{ x: number; y: number }>;
  /** Cumulative distances along path. */
  cumDists: number[];
  totalDist: number;
}

export class RailSystem extends BaseTransportSystem {
  /** Track service type per line. */
  private lineServiceTypes = new Map<number, RailServiceType>();

  /** Precomputed rail paths per route: routeId → array of path segments (node ID strings). */
  private routePaths = new Map<number, string[][]>();

  /** Reference to the rail network graph (optional, for track-based validation). */
  private railNetwork: RailNetwork | null = null;

  /** Per-vehicle travel data for path-based position interpolation. */
  private trainTravelData = new Map<number, TrainTravelMeta>();

  /** External connections -- goods/population flowing in and out of the city. */
  externalConnection: ExternalConnection = {
    populationIn: 0,
    goodsIn: 0,
    goodsOut: 0,
  };

  /** True if at least one station connects to the map edge (external). */
  hasExternalConnection = false;

  constructor() {
    super(RAIL_CONFIG);
  }

  // ── Rail network integration ──────────────────────────────────

  setRailNetwork(network: RailNetwork): void {
    this.railNetwork = network;
  }

  /** Get precomputed track paths for a route. */
  getRoutePaths(routeId: number): string[][] | undefined {
    return this.routePaths.get(routeId);
  }

  /** Return precomputed segment distances from rail path nodes. */
  override getSegmentDistances(routeId: number): number[] | null {
    const paths = this.routePaths.get(routeId);
    if (!paths) return null;
    return paths.map(path => {
      let dist = 0;
      for (let i = 1; i < path.length; i++) {
        const a = parsePosKeyUnsafe(path[i - 1]!);
        const b = parsePosKeyUnsafe(path[i]!);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        dist += Math.sqrt(dx * dx + dy * dy);
      }
      return dist;
    });
  }

  // ── Alias methods for Rail-specific naming ──────────────────────

  /**
   * Build a station at (x, y).
   * If grid is provided, validates that the cell has rail track (may return null).
   * If grid is omitted (backward compat / deserialization), always succeeds.
   */
  buildStation(x: number, y: number): TransportStop;
  buildStation(x: number, y: number, grid: Grid): TransportStop | null;
  buildStation(x: number, y: number, grid?: Grid): TransportStop | null {
    if (grid) {
      const cell = grid.getCell(x, y);
      if (!cell || cell.railType === RailType.NONE) return null;
    }
    return this.addStop(x, y);
  }

  removeStation(stationId: number): void {
    this.removeStop(stationId);
  }

  protected override onRouteDissolved(routeId: number): void {
    this.lineServiceTypes.delete(routeId);
    this.routePaths.delete(routeId);
  }

  protected override onRouteStopRemoved(route: TransportRoute): boolean {
    if (!this.railNetwork) {
      this.routePaths.delete(route.id);
      return true;
    }
    const paths = this.computeRoutePaths(route.stops);
    if (!paths) return false; // disconnected → dissolve
    this.routePaths.set(route.id, paths);
    return true;
  }

  /**
   * Compute rail track paths for all segments of a route (DRY helper).
   * Returns null if any consecutive station pair is disconnected.
   */
  private computeRoutePaths(stations: readonly TransportStop[]): string[][] | null {
    if (!this.railNetwork) return null;
    const segCount = stations.length === 2 ? 2 : stations.length;
    const paths: string[][] = [];
    for (let i = 0; i < segCount; i++) {
      const from = stations[i % stations.length]!;
      const to = stations[(i + 1) % stations.length]!;
      const path = this.railNetwork.findPath(
        nodeId(from.x, from.y),
        nodeId(to.x, to.y),
      );
      if (!path) return null;
      paths.push(path);
    }
    return paths;
  }

  protected override onVehicleReset(vehicleId: number): void {
    this.trainTravelData.delete(vehicleId);
  }

  /**
   * Create a line connecting the given stations.
   * If a RailNetwork is set, validates that all consecutive stations are connected
   * via track and precomputes the rail paths. Returns null if not connected.
   */
  createLine(
    stations: TransportStop[],
    serviceType: RailServiceType = RailServiceType.PASSENGER,
    trainCount = 1,
  ): TransportRoute | null {
    // Validate connectivity and compute paths if network is available
    const paths = this.computeRoutePaths(stations);
    if (this.railNetwork && !paths) return null; // No rail connection

    const capacity = serviceType === RailServiceType.PASSENGER
      ? RAIL.PASSENGER_CAPACITY
      : RAIL.FREIGHT_CAPACITY;

    const route = this.createRoute(stations, trainCount);
    this.lineServiceTypes.set(route.id, serviceType);

    // Store precomputed paths
    if (paths) {
      this.routePaths.set(route.id, paths);
    }

    // Update vehicle capacities for this line
    for (const v of this.vehicles) {
      if (v.routeId === route.id) v.capacity = capacity;
    }

    return route;
  }

  deleteLine(lineId: number): void {
    this.deleteRoute(lineId);
    this.lineServiceTypes.delete(lineId);
    this.routePaths.delete(lineId);
  }

  override addVehicleToRoute(lineId: number): void {
    const svcType = this.lineServiceTypes.get(lineId) ?? RailServiceType.PASSENGER;
    super.addVehicleToRoute(lineId);
    // Fix capacity for the newly added vehicle
    const capacity = svcType === RailServiceType.PASSENGER ? RAIL.PASSENGER_CAPACITY : RAIL.FREIGHT_CAPACITY;
    const lastVehicle = this.vehicles[this.vehicles.length - 1];
    if (lastVehicle && lastVehicle.routeId === lineId) {
      lastVehicle.capacity = capacity;
    }
  }

  // ── Path-based movement overrides ────────────────────────────────

  protected override onDepart(vehicle: TransportVehicle, _route: TransportRoute): void {
    const paths = this.routePaths.get(vehicle.routeId);
    if (!paths || paths.length === 0) return;

    const segIdx = (vehicle.currentStopIndex - 1 + paths.length) % paths.length;
    const path = paths[segIdx];
    if (!path || path.length < 2) return;

    // Parse path nodes and compute cumulative distances
    const points: Array<{ x: number; y: number }> = [];
    for (const nid of path) {
      points.push(parsePosKeyUnsafe(nid));
    }
    const cumDists: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i]!.x - points[i - 1]!.x;
      const dy = points[i]!.y - points[i - 1]!.y;
      totalDist += Math.sqrt(dx * dx + dy * dy);
      cumDists.push(totalDist);
    }

    // Recalculate travelTicks based on actual rail path distance (not Manhattan)
    const speed = this.config.speed;
    vehicle.travelTicks = Math.max(1, Math.ceil(totalDist / speed));

    this.trainTravelData.set(vehicle.id, {
      totalTicks: vehicle.travelTicks,
      segIdx,
      points,
      cumDists,
      totalDist,
    });
  }

  protected override onTravelComplete(vehicle: TransportVehicle): void {
    this.trainTravelData.delete(vehicle.id);
  }

  /** Get the parsed path points for a traveling train (for per-frame animation). */
  getTrainTravelPath(trainId: number): ReadonlyArray<{ x: number; y: number }> | null {
    const meta = this.trainTravelData.get(trainId);
    return meta ? meta.points : null;
  }

  /** Get all route path segments as parsed {x,y} point arrays (for TrainAnimator full-path cycling). */
  getRoutePathPoints(routeId: number): ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> | null {
    const paths = this.routePaths.get(routeId);
    if (!paths) return null;
    return paths.map(seg => seg.map(nid => parsePosKeyUnsafe(nid)));
  }

  getTrains(): readonly TransportVehicle[] {
    return this.getVehicles();
  }

  getLines(): readonly TransportRoute[] {
    return this.getRoutes();
  }

  getStations(): readonly TransportStop[] {
    return this.getStops();
  }

  /** Set of station position keys that can reach the map edge via rail BFS. */
  private externalStations = new Set<string>();
  /** Edge rail cell positions (for external train spawning). */
  private edgeRailCells: Array<{ x: number; y: number }> = [];

  /** Check which stations can reach the map edge via rail tracks (BFS). */
  updateExternalConnection(mapWidth: number, mapHeight: number, grid?: { getCell(x: number, y: number): { railType: number; railFlags: number } | null }): void {
    this.externalStations.clear();
    this.edgeRailCells = [];

    if (!grid) {
      // Legacy fallback: check if any station is at the edge
      this.hasExternalConnection = this.stops.some(
        s => s.x === 0 || s.y === 0 || s.x === mapWidth - 1 || s.y === mapHeight - 1
      );
      if (this.hasExternalConnection) {
        for (const s of this.stops) this.externalStations.add(toPosKey(s.x, s.y));
      }
    } else {
      // BFS from edge rail cells that point inward (perpendicular to border)
      const edgeRailCells: [number, number][] = [];
      for (let x = 0; x < mapWidth; x++) {
        for (const y of [0, mapHeight - 1]) {
          const cell = grid.getCell(x, y);
          if (cell && cell.railType !== 0 && hasInwardFlag(x, y, mapWidth, mapHeight, cell.railFlags)) {
            edgeRailCells.push([x, y]);
          }
        }
      }
      for (let y = 1; y < mapHeight - 1; y++) {
        for (const x of [0, mapWidth - 1]) {
          const cell = grid.getCell(x, y);
          if (cell && cell.railType !== 0 && hasInwardFlag(x, y, mapWidth, mapHeight, cell.railFlags)) {
            edgeRailCells.push([x, y]);
          }
        }
      }

      this.edgeRailCells = edgeRailCells.map(([x, y]) => ({ x, y }));

      if (edgeRailCells.length === 0) {
        this.hasExternalConnection = false;
        this.externalConnection = { populationIn: 0, goodsIn: 0, goodsOut: 0 };
        return;
      }

      // BFS through rail cells from edge
      const reachable = new Set<string>();
      const queue: [number, number][] = [];
      for (const [ex, ey] of edgeRailCells) {
        const key = toPosKey(ex, ey);
        if (!reachable.has(key)) {
          reachable.add(key);
          queue.push([ex, ey]);
        }
      }
      const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        for (const [ddx, ddy] of DIRS) {
          const nx = cx + ddx;
          const ny = cy + ddy;
          const key = toPosKey(nx, ny);
          if (reachable.has(key)) continue;
          const cell = grid.getCell(nx, ny);
          if (!cell || cell.railType === 0) continue;
          reachable.add(key);
          queue.push([nx, ny]);
        }
      }

      // Check which stations are reachable from edge
      for (const s of this.stops) {
        if (reachable.has(toPosKey(s.x, s.y))) {
          this.externalStations.add(toPosKey(s.x, s.y));
        }
      }

      this.hasExternalConnection = this.externalStations.size > 0;
    }

    if (this.hasExternalConnection) {
      const lineCount = this.routes.length;
      this.externalConnection = {
        populationIn: Math.max(1, lineCount * 5),
        goodsIn: Math.max(1, lineCount * 10),
        goodsOut: Math.max(1, lineCount * 5),
      };
    } else {
      this.externalConnection = { populationIn: 0, goodsIn: 0, goodsOut: 0 };
    }
  }

  /** Number of stations with external rail access (for freight throughput). */
  getExternalStationCount(): number {
    return this.externalStations.size;
  }

  /** Check if a specific station has external rail access. */
  isStationExternal(x: number, y: number): boolean {
    return this.externalStations.has(toPosKey(x, y));
  }

  /** Count active freight trains. */
  getFreightTrainCount(): number {
    return this.vehicles.filter(t => this.lineServiceTypes.get(t.routeId) === RailServiceType.FREIGHT).length;
  }

  getLineServiceType(lineId: number): RailServiceType | undefined {
    return this.lineServiceTypes.get(lineId);
  }

  // ── External train path ────────────────────────────────────────

  /**
   * Get a path from a random map-edge rail cell to a random external station.
   * Returns parsed points for animation, or null if no external connection.
   */
  getExternalTrainPath(): ReadonlyArray<{ x: number; y: number }> | null {
    if (!this.hasExternalConnection || !this.railNetwork) return null;
    if (this.edgeRailCells.length === 0 || this.externalStations.size === 0) return null;

    const edge = this.edgeRailCells[Math.floor(Math.random() * this.edgeRailCells.length)]!;
    const stationKeys = [...this.externalStations];
    const stationKey = stationKeys[Math.floor(Math.random() * stationKeys.length)]!;

    const path = this.railNetwork.findPath(toPosKey(edge.x, edge.y), stationKey);
    if (!path || path.length < 2) return null;

    return path.map(nid => parsePosKeyUnsafe(nid));
  }

  // ── Serialization ───────────────────────────────────────────────

  override toJSON() {
    const base = super.toJSON() as BaseTransportJSON;
    return {
      stations: base.stops,
      lines: base.routes,
      trains: base.vehicles,
      lineServiceTypes: Array.from(this.lineServiceTypes.entries()),
      routePaths: Array.from(this.routePaths.entries()),
      nextStationId: base.nextStopId,
      nextLineId: base.nextRouteId,
      nextTrainId: base.nextVehicleId,
      hasExternalConnection: this.hasExternalConnection,
      externalConnection: { ...this.externalConnection },
    };
  }

  static fromJSON(data: ReturnType<RailSystem['toJSON']>): RailSystem {
    const baseData: BaseTransportJSON = {
      stops: data.stations,
      routes: data.lines,
      vehicles: data.trains,
      nextStopId: data.nextStationId,
      nextRouteId: data.nextLineId,
      nextVehicleId: data.nextTrainId,
    };
    const sys = BaseTransportSystem.baseFromJSON(baseData, RAIL_CONFIG, RailSystem);
    sys.lineServiceTypes = new Map(data.lineServiceTypes);
    if (data.routePaths) {
      sys.routePaths = new Map(data.routePaths);
    }
    sys.hasExternalConnection = data.hasExternalConnection;
    sys.externalConnection = { ...data.externalConnection };
    return sys;
  }
}

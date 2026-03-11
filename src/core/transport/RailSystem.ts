import { TransportType, TransportVehicle, TransportStop, TransportRoute } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';
import type { Grid } from '../grid/Grid';
import type { RailNetwork } from '../rail/RailNetwork';
import { RailType } from '../rail/types';
import { parsePosKeyUnsafe, toPosKey } from '../grid/GridHelpers';

export enum RailServiceType {
  PASSENGER = 'PASSENGER',
  FREIGHT = 'FREIGHT',
}

const RAIL_PASSENGER_CAPACITY = 300;
const RAIL_FREIGHT_CAPACITY = 500; // cargo units

const RAIL_CONFIG: TransportSystemConfig = {
  type: TransportType.RAIL,
  speed: 4,
  capacity: RAIL_PASSENGER_CAPACITY,
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
    // Also clean up service types and route paths for dissolved lines
    const dissolvedIds: number[] = [];
    const stopExists = this.stops.some(s => s.id === stationId);
    if (stopExists) {
      for (const r of this.routes) {
        const filtered = r.stops.filter(s => s.id !== stationId);
        if (filtered.length < 2) dissolvedIds.push(r.id);
      }
    }
    this.removeStop(stationId);
    for (const id of dissolvedIds) {
      this.lineServiceTypes.delete(id);
      this.routePaths.delete(id);
    }
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
    let paths: string[][] | null = null;
    if (this.railNetwork) {
      paths = [];
      // Round-trip: A→B, B→A  /  Loop: A→B→C→...→A
      const segCount = stations.length === 2 ? 2 : stations.length;
      for (let i = 0; i < segCount; i++) {
        const from = stations[i % stations.length]!;
        const to = stations[(i + 1) % stations.length]!;
        const path = this.railNetwork.findPath(
          nodeId(from.x, from.y),
          nodeId(to.x, to.y),
        );
        if (!path) return null; // No rail connection
        paths.push(path);
      }
    }

    const capacity = serviceType === RailServiceType.PASSENGER
      ? RAIL_PASSENGER_CAPACITY
      : RAIL_FREIGHT_CAPACITY;

    const route = this.createRoute(stations, trainCount);
    route.frequency = stations.length * 4;
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
    const capacity = svcType === RailServiceType.PASSENGER ? RAIL_PASSENGER_CAPACITY : RAIL_FREIGHT_CAPACITY;
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

  protected override tickTraveling(vehicle: TransportVehicle, route: TransportRoute): void {
    // Position interpolation is handled by TrainAnimator (per-frame, not per-tick).
    // Here we only manage the countdown and arrival snap — same as base class,
    // except we clean up trainTravelData on arrival.
    vehicle.travelTicks--;
    if (vehicle.travelTicks <= 0) {
      const stop = route.stops[vehicle.currentStopIndex]!;
      vehicle.position = { x: stop.x, y: stop.y };
      vehicle.traveling = false;
      vehicle.atStop = true;
      vehicle.waitTicks = this.config.dwellTicks;
      this.onArrive(vehicle, stop);
      this.trainTravelData.delete(vehicle.id);
    }
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

  /** Check if any station is at the map edge and update external connection flags. */
  updateExternalConnection(mapWidth: number, mapHeight: number): void {
    this.hasExternalConnection = this.stops.some(
      s => s.x === 0 || s.y === 0 || s.x === mapWidth - 1 || s.y === mapHeight - 1
    );
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

  /** Count active freight trains. */
  getFreightTrainCount(): number {
    return this.vehicles.filter(t => this.lineServiceTypes.get(t.routeId) === RailServiceType.FREIGHT).length;
  }

  getLineServiceType(lineId: number): RailServiceType | undefined {
    return this.lineServiceTypes.get(lineId);
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

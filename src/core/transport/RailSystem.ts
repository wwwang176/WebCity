import { TransportType, TransportVehicle, TransportStop, TransportRoute } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';

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

export class RailSystem extends BaseTransportSystem {
  /** Track service type per line. */
  private lineServiceTypes = new Map<number, RailServiceType>();

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

  // ── Alias methods for Rail-specific naming ──────────────────────

  buildStation(x: number, y: number): TransportStop {
    return this.addStop(x, y);
  }

  removeStation(stationId: number): void {
    // Also clean up service types for dissolved lines
    const dissolvedIds: number[] = [];
    const stopExists = this.stops.some(s => s.id === stationId);
    if (stopExists) {
      for (const r of this.routes) {
        const filtered = r.stops.filter(s => s.id !== stationId);
        if (filtered.length < 2) dissolvedIds.push(r.id);
      }
    }
    this.removeStop(stationId);
    for (const id of dissolvedIds) this.lineServiceTypes.delete(id);
  }

  createLine(
    stations: TransportStop[],
    serviceType: RailServiceType = RailServiceType.PASSENGER,
    trainCount = 1,
  ): TransportRoute {
    const capacity = serviceType === RailServiceType.PASSENGER
      ? RAIL_PASSENGER_CAPACITY
      : RAIL_FREIGHT_CAPACITY;

    // Temporarily override config capacity for vehicle creation
    const route = this.createRoute(stations, trainCount);
    route.frequency = stations.length * 4;
    this.lineServiceTypes.set(route.id, serviceType);

    // Update vehicle capacities for this line
    for (const v of this.vehicles) {
      if (v.routeId === route.id) v.capacity = capacity;
    }

    return route;
  }

  deleteLine(lineId: number): void {
    this.deleteRoute(lineId);
    this.lineServiceTypes.delete(lineId);
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
    sys.hasExternalConnection = data.hasExternalConnection;
    sys.externalConnection = { ...data.externalConnection };
    return sys;
  }
}

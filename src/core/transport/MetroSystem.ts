import { TransportType, TransportVehicle, TransportStop, TransportRoute } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';

const METRO_BUILD_COST_PER_STATION = 5000;

const METRO_CONFIG: TransportSystemConfig = {
  type: TransportType.METRO,
  speed: 3,
  capacity: 200,
  dwellTicks: 2,
  operatingCostPerVehicle: 300,
  affectedByCongestion: false,
};

export class MetroSystem extends BaseTransportSystem {
  constructor() {
    super(METRO_CONFIG);
  }

  // ── Alias methods for Metro-specific naming ─────────────────────

  addStation(x: number, y: number): TransportStop {
    return this.addStop(x, y);
  }

  removeStation(stationId: number): void {
    this.removeStop(stationId);
  }

  createLine(stations: TransportStop[], trainCount = 1): TransportRoute {
    const route = this.createRoute(stations, trainCount);
    // Metro lines have frequency based on station count * 3 (not * 2)
    route.frequency = stations.length * 3;
    return route;
  }

  deleteLine(lineId: number): void {
    this.deleteRoute(lineId);
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

  getBuildCost(stationCount: number): number {
    return stationCount * METRO_BUILD_COST_PER_STATION;
  }

  // ── Train segment info for renderer ─────────────────────────────

  getTrainSegmentInfo(train: TransportVehicle): {
    fromStopIndex: number;
    toStopIndex: number;
    progress: number;  // 0..1 parametric along segment
    atStop: boolean;
  } {
    const route = this.routes.find(r => r.id === train.routeId);
    if (!route || route.stops.length === 0) {
      return { fromStopIndex: 0, toStopIndex: 0, progress: 0, atStop: true };
    }

    if (train.atStop || (!train.traveling && !train.atStop)) {
      // At stop or initial state
      return {
        fromStopIndex: train.currentStopIndex,
        toStopIndex: train.currentStopIndex,
        progress: 0,
        atStop: true,
      };
    }

    // Traveling between stations
    const prevIdx = (train.currentStopIndex - 1 + route.stops.length) % route.stops.length;
    const prev = route.stops[prevIdx]!;
    const next = route.stops[train.currentStopIndex]!;
    const dist = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
    const totalTicks = Math.max(1, Math.ceil(dist / this.config.speed));
    const progress = 1 - train.travelTicks / totalTicks;

    return {
      fromStopIndex: prevIdx,
      toStopIndex: train.currentStopIndex,
      progress: Math.max(0, Math.min(1, progress)),
      atStop: false,
    };
  }

  // ── Override traveling to interpolate position ───────────────────

  protected override tickTraveling(vehicle: TransportVehicle, route: TransportRoute): void {
    vehicle.travelTicks--;
    if (vehicle.travelTicks <= 0) {
      const station = route.stops[vehicle.currentStopIndex]!;
      vehicle.position = { x: station.x, y: station.y };
      vehicle.traveling = false;
      vehicle.atStop = true;
      vehicle.waitTicks = this.config.dwellTicks;
      this.onArrive(vehicle, station);
    } else {
      // Interpolate position between previous and next station
      const prevIdx = (vehicle.currentStopIndex - 1 + route.stops.length) % route.stops.length;
      const prev = route.stops[prevIdx]!;
      const next = route.stops[vehicle.currentStopIndex]!;
      const dist = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
      const totalTicks = Math.max(1, Math.ceil(dist / this.config.speed));
      const t = 1 - vehicle.travelTicks / totalTicks; // 0→1 progress
      vehicle.position = {
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t,
      };
    }
  }

  // ── Serialization ───────────────────────────────────────────────

  override toJSON() {
    const base = super.toJSON() as BaseTransportJSON;
    return {
      stations: base.stops,
      lines: base.routes,
      trains: base.vehicles,
      nextStationId: base.nextStopId,
      nextLineId: base.nextRouteId,
      nextTrainId: base.nextVehicleId,
    };
  }

  static fromJSON(data: ReturnType<MetroSystem['toJSON']>): MetroSystem {
    // Map Metro-specific keys back to base keys
    const baseData: BaseTransportJSON = {
      stops: data.stations,
      routes: data.lines,
      vehicles: data.trains,
      nextStopId: data.nextStationId,
      nextRouteId: data.nextLineId,
      nextVehicleId: data.nextTrainId,
    };
    return BaseTransportSystem.baseFromJSON(baseData, METRO_CONFIG, MetroSystem);
  }
}

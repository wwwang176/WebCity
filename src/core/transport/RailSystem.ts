import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

export enum RailServiceType {
  PASSENGER = 'PASSENGER',
  FREIGHT = 'FREIGHT',
}

const RAIL_PASSENGER_CAPACITY = 300;
const RAIL_FREIGHT_CAPACITY = 500; // cargo units
const RAIL_OPERATING_COST_PER_TRAIN = 400;
const STATION_DWELL_TICKS = 3;
const RAIL_SPEED = 4; // cells per tick (high speed, fixed)

export interface ExternalConnection {
  /** Approximate citizens per tick arriving via rail */
  populationIn: number;
  /** Approximate goods units per tick arriving via rail */
  goodsIn: number;
  /** Approximate goods units per tick departing via rail */
  goodsOut: number;
}

export class RailSystem {
  private stations: TransportStop[] = [];
  private lines: TransportRoute[] = [];
  private trains: TransportVehicle[] = [];
  private nextStationId = 1;
  private nextLineId = 1;
  private nextTrainId = 1;

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

  buildStation(x: number, y: number): TransportStop {
    const station: TransportStop = {
      id: this.nextStationId++,
      x,
      y,
      type: TransportType.RAIL,
      passengers: 0,
    };
    this.stations.push(station);
    return station;
  }

  createLine(
    stations: TransportStop[],
    serviceType: RailServiceType = RailServiceType.PASSENGER,
    trainCount = 1,
  ): TransportRoute {
    const capacity =
      serviceType === RailServiceType.PASSENGER
        ? RAIL_PASSENGER_CAPACITY
        : RAIL_FREIGHT_CAPACITY;

    const line: TransportRoute = {
      id: this.nextLineId++,
      type: TransportType.RAIL,
      stops: stations,
      vehicles: trainCount,
      frequency: stations.length * 4,
      operatingCost: trainCount * RAIL_OPERATING_COST_PER_TRAIN,
    };
    this.lines.push(line);
    this.lineServiceTypes.set(line.id, serviceType);

    for (let i = 0; i < trainCount; i++) {
      const firstStation = stations[0]!;
      this.trains.push({
        id: this.nextTrainId++,
        routeId: line.id,
        currentStopIndex: 0,
        passengers: 0,
        capacity,
        position: { x: firstStation.x, y: firstStation.y },
        waitTicks: 0,
        atStop: false,
        travelTicks: 0,
        traveling: false,
      });
    }

    return line;
  }

  tick(): void {
    for (const train of this.trains) {
      const line = this.lines.find((l) => l.id === train.routeId);
      if (!line || line.stops.length === 0) continue;

      if (train.atStop) {
        train.waitTicks--;
        if (train.waitTicks <= 0) {
          train.atStop = false;
          train.currentStopIndex =
            (train.currentStopIndex + 1) % line.stops.length;
          const nextStation = line.stops[train.currentStopIndex]!;
          const dist = Math.abs(nextStation.x - train.position.x) + Math.abs(nextStation.y - train.position.y);
          train.travelTicks = Math.max(1, Math.ceil(dist / RAIL_SPEED));
          train.traveling = true;
        }
        continue;
      }

      if (train.traveling) {
        train.travelTicks--;
        if (train.travelTicks <= 0) {
          const station = line.stops[train.currentStopIndex]!;
          train.position = { x: station.x, y: station.y };
          train.traveling = false;
          train.atStop = true;
          train.waitTicks = STATION_DWELL_TICKS;
          train.passengers = 0;
          const board = Math.min(station.passengers, train.capacity);
          train.passengers = board;
          station.passengers -= board;
        }
        continue;
      }

      const nextStation = line.stops[train.currentStopIndex]!;
      train.position = { x: nextStation.x, y: nextStation.y };
      train.atStop = true;
      train.waitTicks = STATION_DWELL_TICKS;
      train.passengers = 0;
      const board = Math.min(nextStation.passengers, train.capacity);
      train.passengers = board;
      nextStation.passengers -= board;
    }
  }

  /** Check if any station is at the map edge and update external connection flags. */
  updateExternalConnection(mapWidth: number, mapHeight: number): void {
    this.hasExternalConnection = this.stations.some(
      s => s.x === 0 || s.y === 0 || s.x === mapWidth - 1 || s.y === mapHeight - 1
    );
    if (this.hasExternalConnection) {
      const lineCount = this.lines.length;
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
    return this.trains.filter(t => this.lineServiceTypes.get(t.routeId) === RailServiceType.FREIGHT).length;
  }

  getLineServiceType(lineId: number): RailServiceType | undefined {
    return this.lineServiceTypes.get(lineId);
  }

  getOperatingCost(): number {
    return this.lines.reduce((sum, l) => sum + l.operatingCost, 0);
  }

  getTrains(): readonly TransportVehicle[] {
    return this.trains;
  }

  getLines(): readonly TransportRoute[] {
    return this.lines;
  }

  getStations(): readonly TransportStop[] {
    return this.stations;
  }

  addVehicleToRoute(lineId: number): void {
    const line = this.lines.find(l => l.id === lineId);
    if (!line || line.stops.length === 0) return;
    const svcType = this.lineServiceTypes.get(lineId) ?? RailServiceType.PASSENGER;
    const capacity = svcType === RailServiceType.PASSENGER ? RAIL_PASSENGER_CAPACITY : RAIL_FREIGHT_CAPACITY;
    const first = line.stops[0]!;
    this.trains.push({
      id: this.nextTrainId++,
      routeId: lineId,
      currentStopIndex: 0,
      passengers: 0,
      capacity,
      position: { x: first.x, y: first.y },
      waitTicks: 0,
      atStop: false,
      travelTicks: 0,
      traveling: false,
    });
    line.vehicles++;
    line.operatingCost = line.vehicles * RAIL_OPERATING_COST_PER_TRAIN;
  }

  removeVehicleFromRoute(lineId: number): void {
    const line = this.lines.find(l => l.id === lineId);
    if (!line || line.vehicles <= 1) return;
    const idx = this.trains.findLastIndex(t => t.routeId === lineId);
    if (idx >= 0) this.trains.splice(idx, 1);
    line.vehicles--;
    line.operatingCost = line.vehicles * RAIL_OPERATING_COST_PER_TRAIN;
  }

  deleteLine(lineId: number): void {
    this.lines = this.lines.filter(l => l.id !== lineId);
    this.trains = this.trains.filter(t => t.routeId !== lineId);
    this.lineServiceTypes.delete(lineId);
  }

  removeStation(stationId: number): void {
    this.stations = this.stations.filter(s => s.id !== stationId);
    const dissolvedIds: number[] = [];
    this.lines = this.lines.filter(l => {
      l.stops = l.stops.filter(s => s.id !== stationId);
      if (l.stops.length < 2) { dissolvedIds.push(l.id); return false; }
      return true;
    });
    for (const id of dissolvedIds) this.lineServiceTypes.delete(id);
    this.trains = this.trains.filter(t => !dissolvedIds.includes(t.routeId));
  }

  toJSON() {
    return {
      stations: this.stations.map(s => ({ ...s })),
      lines: this.lines.map(l => ({ ...l, stops: l.stops.map(s => s.id) })),
      trains: this.trains.map(t => ({ ...t, position: { ...t.position } })),
      lineServiceTypes: Array.from(this.lineServiceTypes.entries()),
      nextStationId: this.nextStationId,
      nextLineId: this.nextLineId,
      nextTrainId: this.nextTrainId,
      hasExternalConnection: this.hasExternalConnection,
      externalConnection: { ...this.externalConnection },
    };
  }

  static fromJSON(data: ReturnType<RailSystem['toJSON']>): RailSystem {
    const sys = new RailSystem();
    sys.stations = data.stations.map(s => ({ ...s }));
    sys.lines = data.lines.map(l => ({
      ...l,
      stops: (l.stops as unknown as number[]).map(id => sys.stations.find(s => s.id === id)!),
    }));
    sys.trains = data.trains.map(t => ({ ...t, position: { ...t.position } }));
    sys.lineServiceTypes = new Map(data.lineServiceTypes);
    sys.nextStationId = data.nextStationId;
    sys.nextLineId = data.nextLineId;
    sys.nextTrainId = data.nextTrainId;
    sys.hasExternalConnection = data.hasExternalConnection;
    sys.externalConnection = { ...data.externalConnection };
    return sys;
  }
}

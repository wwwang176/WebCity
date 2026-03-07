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
        }
        continue;
      }

      const nextStation = line.stops[train.currentStopIndex]!;
      train.position = { x: nextStation.x, y: nextStation.y };
      train.atStop = true;
      train.waitTicks = STATION_DWELL_TICKS;
    }
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
}

import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

const METRO_CAPACITY = 200;
const METRO_OPERATING_COST_PER_TRAIN = 300;
const STATION_DWELL_TICKS = 2;
const METRO_BUILD_COST_PER_STATION = 5000;

export class MetroSystem {
  private stations: TransportStop[] = [];
  private lines: TransportRoute[] = [];
  private trains: TransportVehicle[] = [];
  private nextStationId = 1;
  private nextLineId = 1;
  private nextTrainId = 1;

  addStation(x: number, y: number): TransportStop {
    const station: TransportStop = {
      id: this.nextStationId++,
      x,
      y,
      type: TransportType.METRO,
      passengers: 0,
    };
    this.stations.push(station);
    return station;
  }

  createLine(stations: TransportStop[], trainCount = 1): TransportRoute {
    const line: TransportRoute = {
      id: this.nextLineId++,
      type: TransportType.METRO,
      stops: stations,
      vehicles: trainCount,
      frequency: stations.length * 3,
      operatingCost: trainCount * METRO_OPERATING_COST_PER_TRAIN,
    };
    this.lines.push(line);

    for (let i = 0; i < trainCount; i++) {
      const firstStation = stations[0]!;
      this.trains.push({
        id: this.nextTrainId++,
        routeId: line.id,
        currentStopIndex: 0,
        passengers: 0,
        capacity: METRO_CAPACITY,
        position: { x: firstStation.x, y: firstStation.y },
        waitTicks: 0,
        atStop: false,
      });
    }

    return line;
  }

  /**
   * Advance trains along their lines.
   * Metro is NOT affected by road traffic -- no congestion parameter.
   */
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

  getBuildCost(stationCount: number): number {
    return stationCount * METRO_BUILD_COST_PER_STATION;
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

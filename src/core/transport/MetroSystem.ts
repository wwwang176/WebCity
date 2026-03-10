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
const METRO_SPEED = 3; // cells per tick (fixed, no congestion)

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
        travelTicks: 0,
        traveling: false,
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
          const nextStation = line.stops[train.currentStopIndex]!;
          const dist = Math.abs(nextStation.x - train.position.x) + Math.abs(nextStation.y - train.position.y);
          train.travelTicks = Math.max(1, Math.ceil(dist / METRO_SPEED));
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
          // Passenger boarding
          train.passengers = 0;
          const board = Math.min(station.passengers, train.capacity);
          train.passengers = board;
          station.passengers -= board;
        } else {
          // Interpolate position between previous and next station
          const prevIdx = (train.currentStopIndex - 1 + line.stops.length) % line.stops.length;
          const prev = line.stops[prevIdx]!;
          const next = line.stops[train.currentStopIndex]!;
          const dist = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
          const totalTicks = Math.max(1, Math.ceil(dist / METRO_SPEED));
          const t = 1 - train.travelTicks / totalTicks; // 0→1 progress
          train.position = {
            x: prev.x + (next.x - prev.x) * t,
            y: prev.y + (next.y - prev.y) * t,
          };
        }
        continue;
      }

      const nextStation = line.stops[train.currentStopIndex]!;
      train.position = { x: nextStation.x, y: nextStation.y };
      train.atStop = true;
      train.waitTicks = STATION_DWELL_TICKS;
      // Initial boarding
      train.passengers = 0;
      const board = Math.min(nextStation.passengers, train.capacity);
      train.passengers = board;
      nextStation.passengers -= board;
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

  addVehicleToRoute(lineId: number): void {
    const line = this.lines.find(l => l.id === lineId);
    if (!line || line.stops.length === 0) return;
    const first = line.stops[0]!;
    this.trains.push({
      id: this.nextTrainId++,
      routeId: lineId,
      currentStopIndex: 0,
      passengers: 0,
      capacity: METRO_CAPACITY,
      position: { x: first.x, y: first.y },
      waitTicks: 0,
      atStop: false,
      travelTicks: 0,
      traveling: false,
    });
    line.vehicles++;
    line.operatingCost = line.vehicles * METRO_OPERATING_COST_PER_TRAIN;
  }

  removeVehicleFromRoute(lineId: number): void {
    const line = this.lines.find(l => l.id === lineId);
    if (!line || line.vehicles <= 1) return;
    const idx = this.trains.findLastIndex(t => t.routeId === lineId);
    if (idx >= 0) this.trains.splice(idx, 1);
    line.vehicles--;
    line.operatingCost = line.vehicles * METRO_OPERATING_COST_PER_TRAIN;
  }

  deleteLine(lineId: number): void {
    this.lines = this.lines.filter(l => l.id !== lineId);
    this.trains = this.trains.filter(t => t.routeId !== lineId);
  }

  removeStation(stationId: number): void {
    this.stations = this.stations.filter(s => s.id !== stationId);
    const dissolvedLineIds: number[] = [];
    this.lines = this.lines.filter(l => {
      l.stops = l.stops.filter(s => s.id !== stationId);
      if (l.stops.length < 2) {
        dissolvedLineIds.push(l.id);
        return false;
      }
      return true;
    });
    this.trains = this.trains.filter(t => !dissolvedLineIds.includes(t.routeId));
  }

  toJSON() {
    return {
      stations: this.stations.map(s => ({ ...s })),
      lines: this.lines.map(l => ({
        ...l,
        stops: l.stops.map(s => s.id),
      })),
      trains: this.trains.map(t => ({ ...t, position: { ...t.position } })),
      nextStationId: this.nextStationId,
      nextLineId: this.nextLineId,
      nextTrainId: this.nextTrainId,
    };
  }

  static fromJSON(data: ReturnType<MetroSystem['toJSON']>): MetroSystem {
    const sys = new MetroSystem();
    sys.stations = data.stations.map(s => ({ ...s }));
    sys.lines = data.lines.map(l => ({
      ...l,
      stops: (l.stops as unknown as number[]).map(id => sys.stations.find(s => s.id === id)!),
    }));
    sys.trains = data.trains.map(t => ({ ...t, position: { ...t.position } }));
    sys.nextStationId = data.nextStationId;
    sys.nextLineId = data.nextLineId;
    sys.nextTrainId = data.nextTrainId;
    return sys;
  }
}

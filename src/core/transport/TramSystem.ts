import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

const TRAM_CAPACITY = 80;
const TRAM_OPERATING_COST_PER_VEHICLE = 150;
const STOP_DWELL_TICKS = 2;
const TRAM_SPEED = 2; // cells per tick (base speed, affected by congestion)

export class TramSystem {
  private stops: TransportStop[] = [];
  private routes: TransportRoute[] = [];
  private vehicles: TransportVehicle[] = [];
  private nextStopId = 1;
  private nextRouteId = 1;
  private nextVehicleId = 1;

  /**
   * Whether tram tracks occupy road space (affects road capacity).
   * Always true for trams -- they share the road.
   */
  readonly occupiesRoadSpace = true;

  /** Current road congestion level (0 = free-flow, 1 = gridlock). */
  congestionLevel = 0;

  addStop(x: number, y: number): TransportStop {
    const stop: TransportStop = {
      id: this.nextStopId++,
      x,
      y,
      type: TransportType.TRAM,
      passengers: 0,
    };
    this.stops.push(stop);
    return stop;
  }

  createRoute(stops: TransportStop[], vehicleCount = 1): TransportRoute {
    const route: TransportRoute = {
      id: this.nextRouteId++,
      type: TransportType.TRAM,
      stops,
      vehicles: vehicleCount,
      frequency: stops.length * 2,
      operatingCost: vehicleCount * TRAM_OPERATING_COST_PER_VEHICLE,
    };
    this.routes.push(route);

    for (let i = 0; i < vehicleCount; i++) {
      const firstStop = stops[0]!;
      this.vehicles.push({
        id: this.nextVehicleId++,
        routeId: route.id,
        currentStopIndex: 0,
        passengers: 0,
        capacity: TRAM_CAPACITY,
        position: { x: firstStop.x, y: firstStop.y },
        waitTicks: 0,
        atStop: false,
        travelTicks: 0,
        traveling: false,
      });
    }

    return route;
  }

  tick(): void {
    const speedMultiplier = Math.max(0.1, 1 - this.congestionLevel * 0.5);

    for (const v of this.vehicles) {
      const route = this.routes.find((r) => r.id === v.routeId);
      if (!route || route.stops.length === 0) continue;

      if (v.atStop) {
        v.waitTicks--;
        if (v.waitTicks <= 0) {
          v.atStop = false;
          v.currentStopIndex = (v.currentStopIndex + 1) % route.stops.length;
          const nextStop = route.stops[v.currentStopIndex]!;
          const dist = Math.abs(nextStop.x - v.position.x) + Math.abs(nextStop.y - v.position.y);
          v.travelTicks = Math.max(1, Math.ceil(dist / (TRAM_SPEED * speedMultiplier)));
          v.traveling = true;
        }
        continue;
      }

      if (v.traveling) {
        v.travelTicks--;
        if (v.travelTicks <= 0) {
          const stop = route.stops[v.currentStopIndex]!;
          v.position = { x: stop.x, y: stop.y };
          v.traveling = false;
          v.atStop = true;
          v.waitTicks = STOP_DWELL_TICKS;
          v.passengers = 0;
          const board = Math.min(stop.passengers, v.capacity);
          v.passengers = board;
          stop.passengers -= board;
        }
        continue;
      }

      const nextStop = route.stops[v.currentStopIndex]!;
      v.position = { x: nextStop.x, y: nextStop.y };
      v.atStop = true;
      v.waitTicks = STOP_DWELL_TICKS;
      v.passengers = 0;
      const board = Math.min(nextStop.passengers, v.capacity);
      v.passengers = board;
      nextStop.passengers -= board;
    }
  }

  getOperatingCost(): number {
    return this.routes.reduce((sum, r) => sum + r.operatingCost, 0);
  }

  getVehicles(): readonly TransportVehicle[] {
    return this.vehicles;
  }

  getRoutes(): readonly TransportRoute[] {
    return this.routes;
  }

  getStops(): readonly TransportStop[] {
    return this.stops;
  }

  addVehicleToRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.stops.length === 0) return;
    const first = route.stops[0]!;
    this.vehicles.push({
      id: this.nextVehicleId++,
      routeId,
      currentStopIndex: 0,
      passengers: 0,
      capacity: TRAM_CAPACITY,
      position: { x: first.x, y: first.y },
      waitTicks: 0,
      atStop: false,
      travelTicks: 0,
      traveling: false,
    });
    route.vehicles++;
    route.operatingCost = route.vehicles * TRAM_OPERATING_COST_PER_VEHICLE;
  }

  removeVehicleFromRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.vehicles <= 1) return;
    const idx = this.vehicles.findLastIndex(v => v.routeId === routeId);
    if (idx >= 0) this.vehicles.splice(idx, 1);
    route.vehicles--;
    route.operatingCost = route.vehicles * TRAM_OPERATING_COST_PER_VEHICLE;
  }

  deleteRoute(routeId: number): void {
    this.routes = this.routes.filter(r => r.id !== routeId);
    this.vehicles = this.vehicles.filter(v => v.routeId !== routeId);
  }

  removeStop(stopId: number): void {
    this.stops = this.stops.filter(s => s.id !== stopId);
    const dissolvedIds: number[] = [];
    this.routes = this.routes.filter(r => {
      r.stops = r.stops.filter(s => s.id !== stopId);
      if (r.stops.length < 2) { dissolvedIds.push(r.id); return false; }
      return true;
    });
    this.vehicles = this.vehicles.filter(v => !dissolvedIds.includes(v.routeId));
  }

  /** Returns set of "x,y" keys for road cells adjacent to tram stops (capacity-reduced). */
  getAffectedRoadCells(): Set<string> {
    const cells = new Set<string>();
    for (const stop of this.stops) {
      cells.add(`${stop.x - 1},${stop.y}`);
      cells.add(`${stop.x + 1},${stop.y}`);
      cells.add(`${stop.x},${stop.y - 1}`);
      cells.add(`${stop.x},${stop.y + 1}`);
    }
    // Remove stop cells themselves (they're not road cells)
    for (const stop of this.stops) {
      cells.delete(`${stop.x},${stop.y}`);
    }
    return cells;
  }

  toJSON() {
    return {
      stops: this.stops.map(s => ({ ...s })),
      routes: this.routes.map(r => ({ ...r, stops: r.stops.map(s => s.id) })),
      vehicles: this.vehicles.map(v => ({ ...v, position: { ...v.position } })),
      nextStopId: this.nextStopId,
      nextRouteId: this.nextRouteId,
      nextVehicleId: this.nextVehicleId,
    };
  }

  static fromJSON(data: ReturnType<TramSystem['toJSON']>): TramSystem {
    const sys = new TramSystem();
    sys.stops = data.stops.map(s => ({ ...s }));
    sys.routes = data.routes.map(r => ({
      ...r,
      stops: (r.stops as unknown as number[]).map(id => sys.stops.find(s => s.id === id)!),
    }));
    sys.vehicles = data.vehicles.map(v => ({ ...v, position: { ...v.position } }));
    sys.nextStopId = data.nextStopId;
    sys.nextRouteId = data.nextRouteId;
    sys.nextVehicleId = data.nextVehicleId;
    return sys;
  }
}

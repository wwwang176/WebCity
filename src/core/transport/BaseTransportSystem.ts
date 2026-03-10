import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

export interface TransportSystemConfig {
  type: TransportType;
  speed: number;              // cells per tick
  capacity: number;
  dwellTicks: number;
  operatingCostPerVehicle: number;
  affectedByCongestion: boolean;
}

export interface BaseTransportJSON {
  stops: TransportStop[];
  routes: Array<Omit<TransportRoute, 'stops'> & { stops: number[] }>;
  vehicles: TransportVehicle[];
  nextStopId: number;
  nextRouteId: number;
  nextVehicleId: number;
}

export abstract class BaseTransportSystem {
  protected stops: TransportStop[] = [];
  protected routes: TransportRoute[] = [];
  protected vehicles: TransportVehicle[] = [];
  protected nextStopId = 1;
  protected nextRouteId = 1;
  protected nextVehicleId = 1;

  /** Current road congestion level (0 = free-flow, 1 = gridlock). */
  congestionLevel = 0;

  constructor(protected readonly config: TransportSystemConfig) {}

  // ── Stop management ──────────────────────────────────────────────

  addStop(x: number, y: number): TransportStop {
    const stop: TransportStop = {
      id: this.nextStopId++,
      x,
      y,
      type: this.config.type,
      passengers: 0,
    };
    this.stops.push(stop);
    return stop;
  }

  removeStop(stopId: number): void {
    this.stops = this.stops.filter(s => s.id !== stopId);
    const dissolvedIds: number[] = [];
    this.routes = this.routes.filter(r => {
      r.stops = r.stops.filter(s => s.id !== stopId);
      if (r.stops.length < 2) {
        dissolvedIds.push(r.id);
        return false;
      }
      return true;
    });
    this.vehicles = this.vehicles.filter(v => !dissolvedIds.includes(v.routeId));
  }

  // ── Route management ─────────────────────────────────────────────

  createRoute(stops: TransportStop[], vehicleCount = 1): TransportRoute {
    const route: TransportRoute = {
      id: this.nextRouteId++,
      type: this.config.type,
      stops,
      vehicles: vehicleCount,
      frequency: stops.length * 2,
      operatingCost: vehicleCount * this.config.operatingCostPerVehicle,
    };
    this.routes.push(route);

    for (let i = 0; i < vehicleCount; i++) {
      const firstStop = stops[0]!;
      this.vehicles.push({
        id: this.nextVehicleId++,
        routeId: route.id,
        currentStopIndex: 0,
        passengers: 0,
        capacity: this.config.capacity,
        position: { x: firstStop.x, y: firstStop.y },
        waitTicks: 0,
        atStop: false,
        travelTicks: 0,
        traveling: false,
      });
    }

    return route;
  }

  deleteRoute(routeId: number): void {
    this.routes = this.routes.filter(r => r.id !== routeId);
    this.vehicles = this.vehicles.filter(v => v.routeId !== routeId);
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
      capacity: this.getCapacity(),
      position: { x: first.x, y: first.y },
      waitTicks: 0,
      atStop: false,
      travelTicks: 0,
      traveling: false,
    });
    route.vehicles++;
    route.operatingCost = route.vehicles * this.config.operatingCostPerVehicle;
  }

  removeVehicleFromRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.vehicles <= 1) return;
    let idx = -1;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      if (this.vehicles[i]!.routeId === routeId) { idx = i; break; }
    }
    if (idx >= 0) this.vehicles.splice(idx, 1);
    route.vehicles--;
    route.operatingCost = route.vehicles * this.config.operatingCostPerVehicle;
  }

  // ── Accessors ────────────────────────────────────────────────────

  getStops(): readonly TransportStop[] { return this.stops; }
  getRoutes(): readonly TransportRoute[] { return this.routes; }
  getVehicles(): readonly TransportVehicle[] { return this.vehicles; }

  getOperatingCost(): number {
    return this.routes.reduce((sum, r) => sum + r.operatingCost, 0);
  }

  // ── Tick ─────────────────────────────────────────────────────────

  tick(): void {
    for (const vehicle of this.vehicles) {
      const route = this.routes.find(r => r.id === vehicle.routeId);
      if (!route || route.stops.length === 0) continue;

      if (vehicle.atStop) {
        this.tickAtStop(vehicle, route);
      } else if (vehicle.traveling) {
        this.tickTraveling(vehicle, route);
      } else {
        this.tickInitial(vehicle, route);
      }
    }
  }

  protected tickAtStop(vehicle: TransportVehicle, route: TransportRoute): void {
    vehicle.waitTicks--;
    if (vehicle.waitTicks <= 0) {
      vehicle.atStop = false;
      vehicle.currentStopIndex = (vehicle.currentStopIndex + 1) % route.stops.length;
      const nextStop = route.stops[vehicle.currentStopIndex]!;
      const dist = Math.abs(nextStop.x - vehicle.position.x) + Math.abs(nextStop.y - vehicle.position.y);
      const speed = this.config.speed * this.getSpeedMultiplier();
      vehicle.travelTicks = Math.max(1, Math.ceil(dist / speed));
      vehicle.traveling = true;
      this.onDepart(vehicle, route);
    }
  }

  protected tickTraveling(vehicle: TransportVehicle, route: TransportRoute): void {
    vehicle.travelTicks--;
    if (vehicle.travelTicks <= 0) {
      const stop = route.stops[vehicle.currentStopIndex]!;
      vehicle.position = { x: stop.x, y: stop.y };
      vehicle.traveling = false;
      vehicle.atStop = true;
      vehicle.waitTicks = this.config.dwellTicks;
      this.onArrive(vehicle, stop);
    }
  }

  protected tickInitial(vehicle: TransportVehicle, route: TransportRoute): void {
    const stop = route.stops[vehicle.currentStopIndex]!;
    vehicle.position = { x: stop.x, y: stop.y };
    vehicle.atStop = true;
    vehicle.waitTicks = this.config.dwellTicks;
    this.onArrive(vehicle, stop);
  }

  // ── Overridable hooks ────────────────────────────────────────────

  protected getSpeedMultiplier(): number {
    if (!this.config.affectedByCongestion) return 1;
    return Math.max(0.1, 1 - this.congestionLevel * 0.5);
  }

  protected getCapacity(): number {
    return this.config.capacity;
  }

  protected onArrive(vehicle: TransportVehicle, stop: TransportStop): void {
    vehicle.passengers = 0;
    const board = Math.min(stop.passengers, this.getCapacity());
    vehicle.passengers = board;
    stop.passengers -= board;
  }

  /** Called when vehicle departs from a stop. Override for special behavior. */
  protected onDepart(_vehicle: TransportVehicle, _route: TransportRoute): void {
    // default: no-op
  }

  // ── Serialization ────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toJSON(): any {
    return {
      stops: this.stops.map(s => ({ ...s })),
      routes: this.routes.map(r => ({
        ...r,
        stops: r.stops.map(s => s.id),
      })),
      vehicles: this.vehicles.map(v => ({ ...v, position: { ...v.position } })),
      nextStopId: this.nextStopId,
      nextRouteId: this.nextRouteId,
      nextVehicleId: this.nextVehicleId,
    };
  }

  static baseFromJSON<T extends BaseTransportSystem>(
    data: BaseTransportJSON,
    _config: TransportSystemConfig,
    Ctor: { new (...args: any[]): T },
  ): T {
    const sys = new Ctor();
    sys.stops = data.stops.map((s: TransportStop) => ({ ...s }));
    sys.routes = data.routes.map((r: any) => ({
      ...r,
      stops: (r.stops as number[]).map((id: number) => sys.stops.find(s => s.id === id)!),
    }));
    sys.vehicles = data.vehicles.map((v: TransportVehicle) => ({ ...v, position: { ...v.position } }));
    sys.nextStopId = data.nextStopId;
    sys.nextRouteId = data.nextRouteId;
    sys.nextVehicleId = data.nextVehicleId;
    return sys;
  }
}

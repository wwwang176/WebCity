import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

const FERRY_CAPACITY = 100;
const FERRY_OPERATING_COST_PER_VESSEL = 200;
const DOCK_DWELL_TICKS = 3;
const FERRY_SPEED = 2.5; // cells per tick (medium speed, fixed)

export interface WaterChecker {
  isWater(x: number, y: number): boolean;
}

export class FerrySystem {
  private docks: TransportStop[] = [];
  private routes: TransportRoute[] = [];
  private vessels: TransportVehicle[] = [];
  private nextDockId = 1;
  private nextRouteId = 1;
  private nextVesselId = 1;

  /**
   * Add a dock. The dock must be adjacent to or on water.
   * @param waterChecker Optional checker -- if provided, will reject non-water tiles.
   * @returns The created dock, or null if the location is not on water.
   */
  addDock(
    x: number,
    y: number,
    waterChecker?: WaterChecker,
  ): TransportStop | null {
    if (waterChecker && !waterChecker.isWater(x, y)) {
      return null;
    }

    const dock: TransportStop = {
      id: this.nextDockId++,
      x,
      y,
      type: TransportType.FERRY,
      passengers: 0,
    };
    this.docks.push(dock);
    return dock;
  }

  createRoute(docks: TransportStop[], vesselCount = 1): TransportRoute {
    const route: TransportRoute = {
      id: this.nextRouteId++,
      type: TransportType.FERRY,
      stops: docks,
      vehicles: vesselCount,
      frequency: docks.length * 5,
      operatingCost: vesselCount * FERRY_OPERATING_COST_PER_VESSEL,
    };
    this.routes.push(route);

    for (let i = 0; i < vesselCount; i++) {
      const firstDock = docks[0]!;
      this.vessels.push({
        id: this.nextVesselId++,
        routeId: route.id,
        currentStopIndex: 0,
        passengers: 0,
        capacity: FERRY_CAPACITY,
        position: { x: firstDock.x, y: firstDock.y },
        waitTicks: 0,
        atStop: false,
        travelTicks: 0,
        traveling: false,
      });
    }

    return route;
  }

  tick(): void {
    for (const v of this.vessels) {
      const route = this.routes.find((r) => r.id === v.routeId);
      if (!route || route.stops.length === 0) continue;

      if (v.atStop) {
        v.waitTicks--;
        if (v.waitTicks <= 0) {
          v.atStop = false;
          v.currentStopIndex = (v.currentStopIndex + 1) % route.stops.length;
          const nextDock = route.stops[v.currentStopIndex]!;
          const dist = Math.abs(nextDock.x - v.position.x) + Math.abs(nextDock.y - v.position.y);
          v.travelTicks = Math.max(1, Math.ceil(dist / FERRY_SPEED));
          v.traveling = true;
        }
        continue;
      }

      if (v.traveling) {
        v.travelTicks--;
        if (v.travelTicks <= 0) {
          const dock = route.stops[v.currentStopIndex]!;
          v.position = { x: dock.x, y: dock.y };
          v.traveling = false;
          v.atStop = true;
          v.waitTicks = DOCK_DWELL_TICKS;
          v.passengers = 0;
          const board = Math.min(dock.passengers, v.capacity);
          v.passengers = board;
          dock.passengers -= board;
        }
        continue;
      }

      const nextDock = route.stops[v.currentStopIndex]!;
      v.position = { x: nextDock.x, y: nextDock.y };
      v.atStop = true;
      v.waitTicks = DOCK_DWELL_TICKS;
      v.passengers = 0;
      const board = Math.min(nextDock.passengers, v.capacity);
      v.passengers = board;
      nextDock.passengers -= board;
    }
  }

  getOperatingCost(): number {
    return this.routes.reduce((sum, r) => sum + r.operatingCost, 0);
  }

  getVessels(): readonly TransportVehicle[] {
    return this.vessels;
  }

  getRoutes(): readonly TransportRoute[] {
    return this.routes;
  }

  getDocks(): readonly TransportStop[] {
    return this.docks;
  }

  addVehicleToRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.stops.length === 0) return;
    const first = route.stops[0]!;
    this.vessels.push({
      id: this.nextVesselId++,
      routeId,
      currentStopIndex: 0,
      passengers: 0,
      capacity: FERRY_CAPACITY,
      position: { x: first.x, y: first.y },
      waitTicks: 0,
      atStop: false,
      travelTicks: 0,
      traveling: false,
    });
    route.vehicles++;
    route.operatingCost = route.vehicles * FERRY_OPERATING_COST_PER_VESSEL;
  }

  removeVehicleFromRoute(routeId: number): void {
    const route = this.routes.find(r => r.id === routeId);
    if (!route || route.vehicles <= 1) return;
    const idx = this.vessels.findLastIndex(v => v.routeId === routeId);
    if (idx >= 0) this.vessels.splice(idx, 1);
    route.vehicles--;
    route.operatingCost = route.vehicles * FERRY_OPERATING_COST_PER_VESSEL;
  }

  deleteRoute(routeId: number): void {
    this.routes = this.routes.filter(r => r.id !== routeId);
    this.vessels = this.vessels.filter(v => v.routeId !== routeId);
  }

  removeDock(dockId: number): void {
    this.docks = this.docks.filter(d => d.id !== dockId);
    const dissolvedIds: number[] = [];
    this.routes = this.routes.filter(r => {
      r.stops = r.stops.filter(s => s.id !== dockId);
      if (r.stops.length < 2) { dissolvedIds.push(r.id); return false; }
      return true;
    });
    this.vessels = this.vessels.filter(v => !dissolvedIds.includes(v.routeId));
  }

  toJSON() {
    return {
      docks: this.docks.map(d => ({ ...d })),
      routes: this.routes.map(r => ({ ...r, stops: r.stops.map(s => s.id) })),
      vessels: this.vessels.map(v => ({ ...v, position: { ...v.position } })),
      nextDockId: this.nextDockId,
      nextRouteId: this.nextRouteId,
      nextVesselId: this.nextVesselId,
    };
  }

  static fromJSON(data: ReturnType<FerrySystem['toJSON']>): FerrySystem {
    const sys = new FerrySystem();
    sys.docks = data.docks.map(d => ({ ...d }));
    sys.routes = data.routes.map(r => ({
      ...r,
      stops: (r.stops as unknown as number[]).map(id => sys.docks.find(d => d.id === id)!),
    }));
    sys.vessels = data.vessels.map(v => ({ ...v, position: { ...v.position } }));
    sys.nextDockId = data.nextDockId;
    sys.nextRouteId = data.nextRouteId;
    sys.nextVesselId = data.nextVesselId;
    return sys;
  }
}

import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

const FERRY_CAPACITY = 100;
const FERRY_OPERATING_COST_PER_VESSEL = 200;
const DOCK_DWELL_TICKS = 3;

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
        }
        continue;
      }

      const nextDock = route.stops[v.currentStopIndex]!;
      v.position = { x: nextDock.x, y: nextDock.y };
      v.atStop = true;
      v.waitTicks = DOCK_DWELL_TICKS;
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
}

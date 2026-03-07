import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

const TRAM_CAPACITY = 80;
const TRAM_OPERATING_COST_PER_VEHICLE = 150;
const STOP_DWELL_TICKS = 2;

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
      });
    }

    return route;
  }

  tick(): void {
    for (const v of this.vehicles) {
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

      const nextStop = route.stops[v.currentStopIndex]!;
      v.position = { x: nextStop.x, y: nextStop.y };
      v.atStop = true;
      v.waitTicks = STOP_DWELL_TICKS;
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
}

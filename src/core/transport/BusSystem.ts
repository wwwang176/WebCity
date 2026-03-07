import {
  TransportType,
  TransportStop,
  TransportRoute,
  TransportVehicle,
} from './types';

const BUS_CAPACITY = 50;
const BUS_OPERATING_COST_PER_VEHICLE = 100;
const STOP_DWELL_TICKS = 2;

export class BusSystem {
  private stops: TransportStop[] = [];
  private routes: TransportRoute[] = [];
  private vehicles: TransportVehicle[] = [];
  private nextStopId = 1;
  private nextRouteId = 1;
  private nextVehicleId = 1;

  /** Current road congestion level (0 = free-flow, 1 = gridlock). */
  congestionLevel = 0;

  addStop(x: number, y: number): TransportStop {
    const stop: TransportStop = {
      id: this.nextStopId++,
      x,
      y,
      type: TransportType.BUS,
      passengers: 0,
    };
    this.stops.push(stop);
    return stop;
  }

  createRoute(stops: TransportStop[], vehicleCount = 1): TransportRoute {
    const route: TransportRoute = {
      id: this.nextRouteId++,
      type: TransportType.BUS,
      stops,
      vehicles: vehicleCount,
      frequency: stops.length * 2,
      operatingCost: vehicleCount * BUS_OPERATING_COST_PER_VEHICLE,
    };
    this.routes.push(route);

    for (let i = 0; i < vehicleCount; i++) {
      const firstStop = stops[0]!;
      this.vehicles.push({
        id: this.nextVehicleId++,
        routeId: route.id,
        currentStopIndex: 0,
        passengers: 0,
        capacity: BUS_CAPACITY,
        position: { x: firstStop.x, y: firstStop.y },
        waitTicks: 0,
        atStop: false,
      });
    }

    return route;
  }

  tick(): void {
    const speedMultiplier = 1 - this.congestionLevel * 0.5;

    for (const v of this.vehicles) {
      const route = this.routes.find((r) => r.id === v.routeId);
      if (!route || route.stops.length === 0) continue;

      if (v.atStop) {
        v.waitTicks--;
        if (v.waitTicks <= 0) {
          v.atStop = false;
          // Move to the next stop
          v.currentStopIndex = (v.currentStopIndex + 1) % route.stops.length;
        }
        continue;
      }

      // Move towards the next stop (simplified: instant move if speed allows)
      const nextStop = route.stops[v.currentStopIndex]!;
      if (speedMultiplier > 0) {
        v.position = { x: nextStop.x, y: nextStop.y };
        v.atStop = true;
        v.waitTicks = STOP_DWELL_TICKS;
      }
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

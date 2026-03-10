import {
  TransportType,
  TransportStop,
  TransportVehicle,
} from './types';

const TAXI_CAPACITY = 4;
const TAXI_OPERATING_COST_PER_STAND = 50;

export interface TaxiTrip {
  id: number;
  vehicleId: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  completed: boolean;
  ticks: number;
}

export class TaxiSystem {
  private stands: TransportStop[] = [];
  private vehicles: TransportVehicle[] = [];
  private trips: TaxiTrip[] = [];
  private nextStandId = 1;
  private nextVehicleId = 1;
  private nextTripId = 1;

  addStand(x: number, y: number, taxiCount = 3): TransportStop {
    const stand: TransportStop = {
      id: this.nextStandId++,
      x,
      y,
      type: TransportType.TAXI,
      passengers: 0,
    };
    this.stands.push(stand);

    for (let i = 0; i < taxiCount; i++) {
      this.vehicles.push({
        id: this.nextVehicleId++,
        routeId: 0, // taxis don't follow a fixed route
        currentStopIndex: 0,
        passengers: 0,
        capacity: TAXI_CAPACITY,
        position: { x, y },
        waitTicks: 0,
        atStop: true,
        travelTicks: 0,
        traveling: false,
      });
    }

    return stand;
  }

  /**
   * Dispatch a taxi to carry a passenger from `from` to `to`.
   * Uses road network (affected by congestion in practice).
   * @returns The trip, or null if no available taxi.
   */
  dispatch(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): TaxiTrip | null {
    // Find the nearest available (at-stop, no passengers) taxi
    const available = this.vehicles.find((v) => v.atStop && v.passengers === 0);
    if (!available) return null;

    available.atStop = false;
    available.passengers = 1;
    available.position = { x: from.x, y: from.y };

    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const estimatedTicks = dx + dy; // Manhattan distance

    const trip: TaxiTrip = {
      id: this.nextTripId++,
      vehicleId: available.id,
      from,
      to,
      completed: false,
      ticks: estimatedTicks,
    };
    this.trips.push(trip);
    return trip;
  }

  tick(): void {
    for (const trip of this.trips) {
      if (trip.completed) continue;
      trip.ticks--;
      if (trip.ticks <= 0) {
        trip.completed = true;
        const vehicle = this.vehicles.find((v) => v.id === trip.vehicleId);
        if (vehicle) {
          vehicle.passengers = 0;
          vehicle.atStop = true;
          vehicle.position = { x: trip.to.x, y: trip.to.y };
        }
      }
    }
  }

  getOperatingCost(): number {
    return this.stands.length * TAXI_OPERATING_COST_PER_STAND;
  }

  getActiveTrips(): TaxiTrip[] {
    return this.trips.filter((t) => !t.completed);
  }

  getStands(): readonly TransportStop[] {
    return this.stands;
  }

  getVehicles(): readonly TransportVehicle[] {
    return this.vehicles;
  }

  removeStand(standId: number): void {
    const stand = this.stands.find(s => s.id === standId);
    if (!stand) return;
    // Remove vehicles at this stand's position that are idle
    this.vehicles = this.vehicles.filter(v =>
      !(v.position.x === stand.x && v.position.y === stand.y && v.atStop && v.passengers === 0)
    );
    this.stands = this.stands.filter(s => s.id !== standId);
  }

  toJSON() {
    return {
      stands: this.stands.map(s => ({ ...s })),
      vehicles: this.vehicles.map(v => ({ ...v, position: { ...v.position } })),
      trips: this.trips.map(t => ({ ...t, from: { ...t.from }, to: { ...t.to } })),
      nextStandId: this.nextStandId,
      nextVehicleId: this.nextVehicleId,
      nextTripId: this.nextTripId,
    };
  }

  static fromJSON(data: ReturnType<TaxiSystem['toJSON']>): TaxiSystem {
    const sys = new TaxiSystem();
    sys.stands = data.stands.map(s => ({ ...s }));
    sys.vehicles = data.vehicles.map(v => ({ ...v, position: { ...v.position } }));
    sys.trips = data.trips.map(t => ({ ...t, from: { ...t.from }, to: { ...t.to } }));
    sys.nextStandId = data.nextStandId;
    sys.nextVehicleId = data.nextVehicleId;
    sys.nextTripId = data.nextTripId;
    return sys;
  }
}

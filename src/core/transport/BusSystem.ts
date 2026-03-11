import { TransportType, TransportVehicle, TransportStop } from './types';
import { BaseTransportSystem, TransportSystemConfig } from './BaseTransportSystem';

const BUS_CONFIG: TransportSystemConfig = {
  type: TransportType.BUS,
  speed: 2,
  capacity: 50,
  dwellTicks: 2,
  operatingCostPerVehicle: 100,
  affectedByCongestion: true,
};

/** Board/alight passengers when vehicle arrives at a stop. */
function boardPassengers(v: TransportVehicle, stop: TransportStop): void {
  // All passengers alight at every stop (simplified model)
  v.passengers = 0;
  // Board waiting passengers up to remaining capacity
  const available = Math.min(stop.passengers, v.capacity - v.passengers);
  v.passengers += available;
  stop.passengers -= available;
}

export class BusSystem extends BaseTransportSystem {
  constructor() {
    super(BUS_CONFIG);
  }

  protected override onArrive(vehicle: TransportVehicle, stop: TransportStop): void {
    boardPassengers(vehicle, stop);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      congestionLevel: this.congestionLevel,
    };
  }

  static fromJSON(data: ReturnType<BusSystem['toJSON']>): BusSystem {
    const sys = BaseTransportSystem.baseFromJSON(data, BUS_CONFIG, BusSystem);
    sys.congestionLevel = data.congestionLevel;
    return sys;
  }
}

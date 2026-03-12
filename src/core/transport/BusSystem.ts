import { TransportType } from './types';
import { BaseTransportSystem, TransportSystemConfig } from './BaseTransportSystem';

const BUS_CONFIG: TransportSystemConfig = {
  type: TransportType.BUS,
  speed: 2,
  capacity: 50,
  dwellTicks: 2,
  operatingCostPerVehicle: 100,
  affectedByCongestion: true,
};

export class BusSystem extends BaseTransportSystem {
  constructor() {
    super(BUS_CONFIG);
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

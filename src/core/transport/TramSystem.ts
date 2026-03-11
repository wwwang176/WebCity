import { TransportType, TransportVehicle, TransportStop } from './types';
import { BaseTransportSystem, TransportSystemConfig, BaseTransportJSON } from './BaseTransportSystem';

const TRAM_CONFIG: TransportSystemConfig = {
  type: TransportType.TRAM,
  speed: 2,
  capacity: 80,
  dwellTicks: 2,
  operatingCostPerVehicle: 150,
  affectedByCongestion: true,
};

export class TramSystem extends BaseTransportSystem {
  /**
   * Whether tram tracks occupy road space (affects road capacity).
   * Always true for trams -- they share the road.
   */
  readonly occupiesRoadSpace = true;

  constructor() {
    super(TRAM_CONFIG);
  }

  protected override onArrive(vehicle: TransportVehicle, stop: TransportStop): void {
    vehicle.passengers = 0;
    const board = Math.min(stop.passengers, vehicle.capacity);
    vehicle.passengers = board;
    stop.passengers -= board;
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

  override toJSON(): BaseTransportJSON {
    return super.toJSON() as BaseTransportJSON;
  }

  static fromJSON(data: BaseTransportJSON): TramSystem {
    return BaseTransportSystem.baseFromJSON(data, TRAM_CONFIG, TramSystem);
  }
}

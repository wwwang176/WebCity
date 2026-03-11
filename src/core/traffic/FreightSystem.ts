import type { Grid } from '../grid/Grid';
import { ZoneType, isCommercialZone } from '../grid/types';

export interface FreightDemand {
  /** Total cargo produced by industrial buildings per tick. */
  production: number;
  /** Total cargo consumed by commercial buildings per tick. */
  consumption: number;
  /** Unmet demand (consumption - supply). Positive means shortage. */
  shortage: number;
}

/**
 * FreightSystem tracks the flow of goods from industrial zones (producers)
 * to commercial zones (consumers). When commercial buildings can't get
 * enough goods, they suffer a growth penalty.
 */
export class FreightSystem {
  private cargoStorage = 0;
  private lastDemand: FreightDemand = { production: 0, consumption: 0, shortage: 0 };

  /**
   * Run one tick of the freight simulation.
   * Industrial buildings produce cargo; commercial buildings consume it.
   */
  tick(grid: Grid): FreightDemand {
    let production = 0;
    let consumption = 0;

    grid.forEachCell((cell) => {
      if (cell.buildingId === 0) return;
      if (cell.zoneType === ZoneType.INDUSTRIAL) {
        production += 2;
      } else if (isCommercialZone(cell.zoneType as ZoneType)) {
        consumption += 1;
      }
    });

    // Add production to storage
    this.cargoStorage += production;

    // Consume from storage
    const actualConsumption = Math.min(consumption, this.cargoStorage);
    this.cargoStorage -= actualConsumption;

    const shortage = consumption - actualConsumption;

    this.lastDemand = { production, consumption, shortage };
    return this.lastDemand;
  }

  /** Add cargo from external sources (rail freight, airport, etc.). */
  addExternalCargo(amount: number): void {
    this.cargoStorage += amount;
  }

  getCargoStorage(): number {
    return this.cargoStorage;
  }

  getLastDemand(): FreightDemand {
    return this.lastDemand;
  }

  /** Commercial shortage ratio (0 = all supplied, 1 = no supply). */
  getShortageRatio(): number {
    if (this.lastDemand.consumption === 0) return 0;
    return this.lastDemand.shortage / this.lastDemand.consumption;
  }
}

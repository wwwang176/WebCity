import type { Grid } from '../grid/Grid';
import { ZoneType, isCommercialZone } from '../grid/types';
import { toPosKey } from '../grid/GridHelpers';
import { bfsBudgetDrainFlood } from '../service/NetworkCoverage';

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
 * to commercial zones (consumers) via BFS through the road network.
 *
 * Industrial buildings produce cargo that travels along roads to reach
 * commercial buildings. Closer commercial buildings are served first
 * (BFS order). Commercial buildings unreachable or beyond production
 * capacity are marked as unsupplied.
 */
export const FREIGHT = {
  INDUSTRIAL_PRODUCTION_RATE: 2,
  COMMERCIAL_CONSUMPTION_RATE: 1,
  /** Maximum cargo storage capacity. */
  MAX_STORAGE: 200,
} as const;

export class FreightSystem {
  /** Position keys of commercial buildings that received goods this tick. */
  private suppliedCommercial = new Set<string>();
  /** Accumulated surplus cargo. */
  private cargoStorage = 0;
  private lastDemand: FreightDemand = { production: 0, consumption: 0, shortage: 0 };
  /** True after first calculateSupply call. Before that, all buildings are considered supplied. */
  private hasCalculated = false;

  /**
   * Calculate freight supply via BFS from industrial buildings through roads.
   * Closer commercial buildings are served first (BFS order).
   * Called every slow tick.
   */
  calculateSupply(grid: Grid): void {
    this.hasCalculated = true;
    const industrials: { x: number; y: number }[] = [];
    let totalProduction = 0;
    let totalCommercialCount = 0;

    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;
      if (cell.zoneType === ZoneType.INDUSTRIAL) {
        industrials.push({ x, y });
        totalProduction += FREIGHT.INDUSTRIAL_PRODUCTION_RATE;
      } else if (isCommercialZone(cell.zoneType as ZoneType)) {
        totalCommercialCount++;
      }
    });

    // BFS from each industrial building with production budget
    const allSupplied = new Set<string>();
    const getDemand = (x: number, y: number): number => {
      const cell = grid.getCell(x, y);
      if (!cell || cell.buildingId === 0) return 0;
      if (isCommercialZone(cell.zoneType as ZoneType)) return FREIGHT.COMMERCIAL_CONSUMPTION_RATE;
      return 0;
    };

    for (const ind of industrials) {
      bfsBudgetDrainFlood(
        grid,
        { x: ind.x, y: ind.y, output: FREIGHT.INDUSTRIAL_PRODUCTION_RATE },
        allSupplied,
        getDemand,
      );
    }

    // Extract supplied commercial buildings
    this.suppliedCommercial = new Set<string>();
    let suppliedCount = 0;
    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;
      if (isCommercialZone(cell.zoneType as ZoneType) && allSupplied.has(toPosKey(x, y))) {
        this.suppliedCommercial.add(toPosKey(x, y));
        suppliedCount++;
      }
    });

    const totalConsumption = totalCommercialCount * FREIGHT.COMMERCIAL_CONSUMPTION_RATE;
    const actualConsumed = suppliedCount * FREIGHT.COMMERCIAL_CONSUMPTION_RATE;
    const shortage = totalConsumption - actualConsumed;

    this.lastDemand = { production: totalProduction, consumption: totalConsumption, shortage };

    // Update cargo storage: surplus adds, deficit drains
    const surplus = totalProduction - actualConsumed;
    this.cargoStorage = Math.max(0, Math.min(this.cargoStorage + surplus, FREIGHT.MAX_STORAGE));
  }

  /** Check if a commercial building at (x,y) received goods.
   *  Returns true before first calculation or when no industrial buildings exist. */
  isSupplied(x: number, y: number): boolean {
    if (!this.hasCalculated) return true;
    // No industrial in city → no freight expectation → all supplied
    if (this.lastDemand.production === 0) return true;
    return this.suppliedCommercial.has(toPosKey(x, y));
  }

  /** Surplus ratio (0 = balanced, 1 = storage full).
   *  Returns 0 when no commercial buildings exist (nothing to sell to). */
  getSurplusRatio(): number {
    if (FREIGHT.MAX_STORAGE === 0) return 0;
    // No commercial in city → no surplus problem
    if (this.lastDemand.consumption === 0) return 0;
    return this.cargoStorage / FREIGHT.MAX_STORAGE;
  }

  /** Add cargo from external sources (rail freight, airport, etc.). */
  addExternalCargo(amount: number): void {
    this.cargoStorage = Math.min(this.cargoStorage + amount, FREIGHT.MAX_STORAGE);
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

  getSuppliedCount(): number {
    return this.suppliedCommercial.size;
  }
}

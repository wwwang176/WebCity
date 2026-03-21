import type { Grid } from '../grid/Grid';
import { ZoneType, isCommercialZone } from '../grid/types';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { getBuildingType } from '../building/types';

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

/** Per-building freight rates by building ID. */
const INDUSTRIAL_PRODUCTION: Record<number, number> = {
  13: 3,   // Small Factory  (Lv1)
  14: 5,   // Medium Factory (Lv2)
  15: 8,   // Large Factory  (Lv3)
};

const COMMERCIAL_CONSUMPTION: Record<number, number> = {
  7: 1,    // Small Shop     (CL Lv1)
  8: 2,    // Medium Shop    (CL Lv2)
  9: 3,    // Large Shop     (CL Lv3)
  10: 8,   // Small Mall     (CH Lv1)
  11: 14,  // Medium Mall    (CH Lv2)
  12: 20,  // Department Store (CH Lv3)
};

/** Get production rate for an industrial building. */
export function getProductionRate(buildingId: number): number {
  return INDUSTRIAL_PRODUCTION[buildingId] ?? 0;
}

/** Get consumption rate for a commercial building. */
export function getConsumptionRate(buildingId: number): number {
  return COMMERCIAL_CONSUMPTION[buildingId] ?? 0;
}

export const FREIGHT = {
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
    const sources: [number, number][] = [];
    let totalProduction = 0;
    let totalConsumption = 0;

    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;
      if (cell.zoneType === ZoneType.INDUSTRIAL) {
        const rate = getProductionRate(cell.buildingId);
        if (rate > 0) {
          sources.push([x, y]);
          totalProduction += rate;
        }
      } else if (isCommercialZone(cell.zoneType as ZoneType)) {
        totalConsumption += getConsumptionRate(cell.buildingId);
      }
    });

    // Multi-source BFS: all factories share a pooled budget
    const supplied = new Set<string>();
    const visited = new Set<string>();
    const queue: [number, number][] = [];
    let budget = totalProduction;

    for (const [sx, sy] of sources) {
      const key = toPosKey(sx, sy);
      if (!visited.has(key)) {
        visited.add(key);
        supplied.add(key);
        queue.push([sx, sy]);
      }
    }

    while (queue.length > 0) {
      if (budget <= 0) break;
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of FOUR_NEIGHBORS) {
        const nx = x + dx!;
        const ny = y + dy!;
        const key = toPosKey(nx, ny);
        if (visited.has(key)) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell) continue;
        // Only traverse through roads, buildings, or zoned cells
        const canTraverse = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || cell.zoneType !== 0;
        if (!canTraverse) continue;
        visited.add(key);

        if (cell.buildingId > 0 && isCommercialZone(cell.zoneType as ZoneType)) {
          const demand = getConsumptionRate(cell.buildingId);
          if (demand > 0) {
            if (budget < demand) continue; // can't afford this shop
            budget -= demand;
          }
        }
        supplied.add(key);
        queue.push([nx, ny]);
      }
    }

    // Extract supplied commercial buildings and sum actual consumed
    this.suppliedCommercial = new Set<string>();
    let actualConsumed = 0;
    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;
      if (isCommercialZone(cell.zoneType as ZoneType) && supplied.has(toPosKey(x, y))) {
        this.suppliedCommercial.add(toPosKey(x, y));
        actualConsumed += getConsumptionRate(cell.buildingId);
      }
    });

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

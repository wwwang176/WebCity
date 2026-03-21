import type { Grid } from '../grid/Grid';
import { ZoneType, isCommercialZone } from '../grid/types';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

export interface FreightDemand {
  /** Total cargo produced by industrial buildings per tick. */
  production: number;
  /** Total cargo consumed by commercial buildings per tick. */
  consumption: number;
  /** Unmet demand (consumption - supply). Positive means shortage. */
  shortage: number;
}

export interface TradeResult {
  /** Units imported this tick (fills shortage). */
  imported: number;
  /** Units exported this tick (absorbs surplus). */
  exported: number;
  /** Total import throughput capacity available. */
  importCapacity: number;
  /** Total export throughput capacity available. */
  exportCapacity: number;
}

/**
 * FreightSystem tracks the flow of goods from industrial zones (producers)
 * to commercial zones (consumers) via BFS through the road network.
 *
 * After local supply is calculated, trade with external markets fills
 * remaining shortage (import) or absorbs surplus (export) up to the
 * throughput capacity of rail stations and airports.
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

export const TRADE = {
  /** Cargo throughput per rail station with external access. */
  RAIL_THROUGHPUT_PER_STATION: 50,
  /** Import cost multiplier on commercial income (0.7 = 30% penalty). */
  IMPORT_INCOME_MULTIPLIER: 0.7,
  /** Export revenue multiplier on industrial income (0.5 = 50% penalty). */
  EXPORT_INCOME_MULTIPLIER: 0.5,
} as const;

/** Get production rate for an industrial building. */
export function getProductionRate(buildingId: number): number {
  return INDUSTRIAL_PRODUCTION[buildingId] ?? 0;
}

/** Get consumption rate for a commercial building. */
export function getConsumptionRate(buildingId: number): number {
  return COMMERCIAL_CONSUMPTION[buildingId] ?? 0;
}

export class FreightSystem {
  /** Position keys of commercial buildings that received local goods. */
  private suppliedCommercial = new Set<string>();
  /** Position keys of commercial buildings supplied via import. */
  private importedCommercial = new Set<string>();
  /** Whether industrial surplus is being exported. */
  private isExporting = false;
  private lastDemand: FreightDemand = { production: 0, consumption: 0, shortage: 0 };
  private lastTrade: TradeResult = { imported: 0, exported: 0, importCapacity: 0, exportCapacity: 0 };
  private hasCalculated = false;

  /**
   * Calculate freight supply via multi-source BFS from all factories,
   * then apply trade (import/export) based on available throughput.
   * Called every slow tick.
   */
  calculateSupply(grid: Grid, tradeCapacity?: { importCapacity: number; exportCapacity: number }): void {
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
        const canTraverse = cell.roadType !== RoadType.NONE || cell.buildingId !== 0 || cell.zoneType !== 0;
        if (!canTraverse) continue;
        visited.add(key);

        if (cell.buildingId > 0 && isCommercialZone(cell.zoneType as ZoneType)) {
          const demand = getConsumptionRate(cell.buildingId);
          if (demand > 0) {
            if (budget < demand) continue;
            budget -= demand;
          }
        }
        supplied.add(key);
        queue.push([nx, ny]);
      }
    }

    // Extract locally supplied commercial buildings
    this.suppliedCommercial = new Set<string>();
    this.importedCommercial = new Set<string>();
    let actualConsumed = 0;
    const unsuppliedCommercial: { x: number; y: number; demand: number }[] = [];

    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;
      if (!isCommercialZone(cell.zoneType as ZoneType)) return;
      if (supplied.has(toPosKey(x, y))) {
        this.suppliedCommercial.add(toPosKey(x, y));
        actualConsumed += getConsumptionRate(cell.buildingId);
      } else {
        unsuppliedCommercial.push({ x, y, demand: getConsumptionRate(cell.buildingId) });
      }
    });

    let shortage = totalConsumption - actualConsumed;

    // Trade: import fills shortage, export absorbs surplus
    const importCap = tradeCapacity?.importCapacity ?? 0;
    const exportCap = tradeCapacity?.exportCapacity ?? 0;
    let imported = 0;
    let exported = 0;

    if (shortage > 0 && importCap > 0) {
      // Import: fill unsupplied commercial buildings up to import capacity
      let importBudget = Math.min(shortage, importCap);
      for (const shop of unsuppliedCommercial) {
        if (importBudget < shop.demand) continue;
        importBudget -= shop.demand;
        imported += shop.demand;
        this.importedCommercial.add(toPosKey(shop.x, shop.y));
      }
      shortage -= imported;
    }

    if (totalProduction > totalConsumption && exportCap > 0) {
      // Export: absorb surplus up to export capacity
      const surplus = totalProduction - totalConsumption;
      exported = Math.min(surplus, exportCap);
    }

    this.isExporting = exported > 0;
    this.lastDemand = { production: totalProduction, consumption: totalConsumption, shortage };
    this.lastTrade = { imported, exported, importCapacity: importCap, exportCapacity: exportCap };
  }

  /** Building supply status: 'local' | 'imported' | 'unsupplied'. */
  getSupplyStatus(x: number, y: number): 'local' | 'imported' | 'unsupplied' {
    if (!this.hasCalculated) return 'local';
    if (this.lastDemand.production === 0 && this.lastTrade.importCapacity === 0) return 'local';
    const key = toPosKey(x, y);
    if (this.suppliedCommercial.has(key)) return 'local';
    if (this.importedCommercial.has(key)) return 'imported';
    return 'unsupplied';
  }

  /** Backward-compatible: returns true if locally supplied OR imported. */
  isSupplied(x: number, y: number): boolean {
    return this.getSupplyStatus(x, y) !== 'unsupplied';
  }

  /** Whether industrial surplus is being exported via trade facilities. */
  getIsExporting(): boolean {
    return this.isExporting;
  }

  /** Surplus ratio (0 = balanced, 1 = 100% overproduction).
   *  Only positive when production exceeds consumption.
   *  Export reduces effective surplus. */
  getSurplusRatio(): number {
    const { production, consumption } = this.lastDemand;
    if (consumption === 0 || production <= consumption) return 0;
    const surplus = production - consumption;
    const effectiveSurplus = Math.max(0, surplus - this.lastTrade.exported);
    return Math.min(1, effectiveSurplus / consumption);
  }

  /** Add cargo from external sources (rail freight, airport, etc.).
   *  @deprecated Use tradeCapacity parameter in calculateSupply instead. */
  addExternalCargo(_amount: number): void {
    // No-op: external cargo now handled via trade calculation
  }

  getLastDemand(): FreightDemand {
    return this.lastDemand;
  }

  getLastTrade(): TradeResult {
    return this.lastTrade;
  }

  /** Commercial shortage ratio (0 = all supplied, 1 = no supply).
   *  Import-supplied buildings count as supplied. */
  getShortageRatio(): number {
    if (this.lastDemand.consumption === 0) return 0;
    return this.lastDemand.shortage / this.lastDemand.consumption;
  }

  getSuppliedCount(): number {
    return this.suppliedCommercial.size + this.importedCommercial.size;
  }

  getLocalSuppliedCount(): number {
    return this.suppliedCommercial.size;
  }

  getImportedCount(): number {
    return this.importedCommercial.size;
  }
}

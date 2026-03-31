import type { Grid } from '../grid/Grid';
import { ZoneType, isCommercialZone } from '../grid/types';
import { toPosKey, FOUR_NEIGHBORS } from '../grid/GridHelpers';
import { RoadType } from '../road/types';

/** Freight truck route types */
export enum FreightRouteType {
  LOCAL = 'local',
  EXPORT = 'export',
  IMPORT = 'import',
}

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

export type SupplySource = 'local' | 'imported' | 'none';

export interface SupplyStatus {
  source: SupplySource;
  /** 0~1: fraction of demand fulfilled. */
  ratio: number;
}

/**
 * FreightSystem tracks the flow of goods from industrial zones (producers)
 * to commercial zones (consumers) via BFS through the road network.
 *
 * Supply is proportional: if budget can only partially cover a building's
 * demand, it receives a partial ratio (e.g. 0.86 = 86% supplied).
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
  /** Per-building supply status: source + ratio (0~1). */
  private commercialSupply = new Map<string, SupplyStatus>();
  /** Position keys of factories that can export via trade facilities. */
  private exportableFactorySet = new Set<string>();
  private isExporting = false;
  private lastDemand: FreightDemand = { production: 0, consumption: 0, shortage: 0 };
  private lastTrade: TradeResult = { imported: 0, exported: 0, importCapacity: 0, exportCapacity: 0 };
  private hasCalculated = false;

  /**
   * Calculate freight supply in two phases:
   * 1. Local BFS from factories — supplies nearby commercial buildings
   * 2. Trade BFS from trade facilities — imports for remaining, marks exportable factories
   *
   * Both phases support proportional supply: if budget partially covers
   * a building's demand, it gets a fractional ratio.
   */
  calculateSupply(
    grid: Grid,
    tradeCapacity?: {
      importCapacity: number;
      exportCapacity: number;
      tradePositions?: { x: number; y: number }[];
    },
  ): void {
    this.hasCalculated = true;
    const factories: { x: number; y: number; rate: number }[] = [];
    let totalProduction = 0;
    let totalConsumption = 0;

    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;
      if (cell.zoneType === ZoneType.INDUSTRIAL) {
        const rate = getProductionRate(cell.buildingId);
        if (rate > 0) {
          factories.push({ x, y, rate });
          totalProduction += rate;
        }
      } else if (isCommercialZone(cell.zoneType as ZoneType)) {
        totalConsumption += getConsumptionRate(cell.buildingId);
      }
    });

    // ── Phase 1: Local supply BFS from factories ──
    this.commercialSupply.clear();
    let localBudget = totalProduction;
    let actualConsumed = 0;
    {
      const visited = new Set<string>();
      const queue: [number, number][] = [];
      for (const f of factories) {
        const key = toPosKey(f.x, f.y);
        if (!visited.has(key)) { visited.add(key); queue.push([f.x, f.y]); }
      }
      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        for (const [dx, dy] of FOUR_NEIGHBORS) {
          const nx = x + dx!;
          const ny = y + dy!;
          const key = toPosKey(nx, ny);
          if (visited.has(key)) continue;
          const cell = grid.getCell(nx, ny);
          if (!cell) continue;
          if (cell.roadType === RoadType.NONE && cell.buildingId === 0 && cell.zoneType === 0) continue;
          visited.add(key);

          if (cell.buildingId > 0 && isCommercialZone(cell.zoneType as ZoneType)) {
            const demand = getConsumptionRate(cell.buildingId);
            if (demand > 0 && localBudget > 0) {
              const supplied = Math.min(demand, localBudget);
              localBudget -= supplied;
              actualConsumed += supplied;
              this.commercialSupply.set(key, { source: 'local', ratio: supplied / demand });
            }
          }
          queue.push([nx, ny]);
        }
      }
    }

    // ── Phase 2: Trade BFS from trade facilities ──
    const importCap = tradeCapacity?.importCapacity ?? 0;
    const exportCap = tradeCapacity?.exportCapacity ?? 0;
    const tradePositions = tradeCapacity?.tradePositions ?? [];
    let imported = 0;
    let exported = 0;
    const exportableFactories = new Set<string>();

    if (tradePositions.length > 0 && (importCap > 0 || exportCap > 0)) {
      const visited = new Set<string>();
      const queue: [number, number][] = [];
      let importBudget = importCap;

      for (const tp of tradePositions) {
        const key = toPosKey(tp.x, tp.y);
        if (!visited.has(key)) { visited.add(key); queue.push([tp.x, tp.y]); }
      }

      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        for (const [dx, dy] of FOUR_NEIGHBORS) {
          const nx = x + dx!;
          const ny = y + dy!;
          const key = toPosKey(nx, ny);
          if (visited.has(key)) continue;
          const cell = grid.getCell(nx, ny);
          if (!cell) continue;
          if (cell.roadType === RoadType.NONE && cell.buildingId === 0 && cell.zoneType === 0) continue;
          visited.add(key);

          // Mark reachable factories as exportable
          if (cell.buildingId > 0 && cell.zoneType === ZoneType.INDUSTRIAL) {
            exportableFactories.add(key);
          }

          // Import: supply or top-up unsupplied/partial commercial buildings
          if (cell.buildingId > 0 && isCommercialZone(cell.zoneType as ZoneType) && importBudget > 0) {
            const demand = getConsumptionRate(cell.buildingId);
            if (demand > 0) {
              const existing = this.commercialSupply.get(key);
              const alreadySupplied = existing ? existing.ratio * demand : 0;
              const remaining = demand - alreadySupplied;
              if (remaining > 0) {
                const fill = Math.min(remaining, importBudget);
                importBudget -= fill;
                imported += fill;
                actualConsumed += fill;
                const newRatio = (alreadySupplied + fill) / demand;
                // If import contributed, mark as 'imported'; keep 'local' only if fully local
                this.commercialSupply.set(key, {
                  source: 'imported',
                  ratio: Math.min(1, newRatio),
                });
              }
            }
          }

          queue.push([nx, ny]);
        }
      }
    }

    // Calculate export from reachable factories
    if (totalProduction > totalConsumption && exportCap > 0 && exportableFactories.size > 0) {
      let exportableProduction = 0;
      for (const f of factories) {
        if (exportableFactories.has(toPosKey(f.x, f.y))) {
          exportableProduction += f.rate;
        }
      }
      const surplus = totalProduction - totalConsumption;
      exported = Math.min(surplus, exportableProduction, exportCap);
    }

    const shortage = totalConsumption - actualConsumed;
    this.exportableFactorySet.clear();
    for (const key of exportableFactories) this.exportableFactorySet.add(key);
    this.isExporting = exported > 0;
    this.lastDemand = { production: totalProduction, consumption: totalConsumption, shortage: Math.max(0, shortage) };
    this.lastTrade = { imported, exported, importCapacity: importCap, exportCapacity: exportCap };
  }

  /** Get supply status for a commercial building. */
  getSupplyStatus(x: number, y: number): SupplyStatus {
    if (!this.hasCalculated) return { source: 'local', ratio: 1 };
    if (this.lastDemand.production === 0 && this.lastTrade.importCapacity === 0) return { source: 'local', ratio: 1 };
    return this.commercialSupply.get(toPosKey(x, y)) ?? { source: 'none', ratio: 0 };
  }

  /** Backward-compatible: returns true if any supply (ratio > 0). */
  isSupplied(x: number, y: number): boolean {
    return this.getSupplyStatus(x, y).ratio > 0;
  }

  /** Whether industrial surplus is being exported via trade facilities. */
  getIsExporting(): boolean {
    return this.isExporting;
  }

  /** Whether a specific factory is exporting (reachable from trade facility). */
  isFactoryExporting(x: number, y: number): boolean {
    return this.isExporting && this.exportableFactorySet.has(toPosKey(x, y));
  }

  /** Surplus ratio (0 = balanced, 1 = 100% overproduction).
   *  Export reduces effective surplus. */
  getSurplusRatio(): number {
    const { production, consumption } = this.lastDemand;
    if (consumption === 0 || production <= consumption) return 0;
    const surplus = production - consumption;
    const effectiveSurplus = Math.max(0, surplus - this.lastTrade.exported);
    return Math.min(1, effectiveSurplus / consumption);
  }

  /** @deprecated Use tradeCapacity parameter in calculateSupply instead. */
  addExternalCargo(_amount: number): void {}

  getLastDemand(): FreightDemand { return this.lastDemand; }
  getLastTrade(): TradeResult { return this.lastTrade; }

  /** Commercial shortage ratio based on actual supplied volume. */
  getShortageRatio(): number {
    if (this.lastDemand.consumption === 0) return 0;
    return this.lastDemand.shortage / this.lastDemand.consumption;
  }

  getSuppliedCount(): number {
    let count = 0;
    for (const s of this.commercialSupply.values()) { if (s.ratio > 0) count++; }
    return count;
  }

  getLocalSuppliedCount(): number {
    let count = 0;
    for (const s of this.commercialSupply.values()) { if (s.source === 'local' && s.ratio > 0) count++; }
    return count;
  }

  getImportedCount(): number {
    let count = 0;
    for (const s of this.commercialSupply.values()) { if (s.source === 'imported' && s.ratio > 0) count++; }
    return count;
  }
}

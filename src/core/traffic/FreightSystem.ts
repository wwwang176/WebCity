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
   * Calculate freight supply in two phases:
   * 1. Local BFS from factories — supplies nearby commercial buildings
   * 2. Trade BFS from trade facilities (stations/airports) — imports for
   *    remaining unsupplied commercial, marks reachable factories for export
   *
   * In both phases, commercial buildings that can't be afforded are skipped
   * but BFS continues past them (skip-but-continue).
   */
  calculateSupply(
    grid: Grid,
    tradeCapacity?: {
      importCapacity: number;
      exportCapacity: number;
      /** Positions of trade facilities (external rail stations + airports). */
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
    const localSupplied = new Set<string>();
    let localBudget = totalProduction;
    {
      const visited = new Set<string>();
      const queue: [number, number][] = [];
      for (const f of factories) {
        const key = toPosKey(f.x, f.y);
        if (!visited.has(key)) {
          visited.add(key);
          localSupplied.add(key);
          queue.push([f.x, f.y]);
        }
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
            if (demand > 0 && localBudget < demand) {
              // Can't afford — skip supply but continue BFS
              queue.push([nx, ny]);
              continue;
            }
            localBudget -= demand;
          }
          localSupplied.add(key);
          queue.push([nx, ny]);
        }
      }
    }

    // Extract locally supplied commercial
    this.suppliedCommercial = new Set<string>();
    this.importedCommercial = new Set<string>();
    let actualConsumed = 0;
    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;
      if (!isCommercialZone(cell.zoneType as ZoneType)) return;
      if (localSupplied.has(toPosKey(x, y))) {
        this.suppliedCommercial.add(toPosKey(x, y));
        actualConsumed += getConsumptionRate(cell.buildingId);
      }
    });

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
        if (!visited.has(key)) {
          visited.add(key);
          queue.push([tp.x, tp.y]);
        }
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

          // Import: supply unsupplied commercial buildings
          if (cell.buildingId > 0 && isCommercialZone(cell.zoneType as ZoneType)
              && !this.suppliedCommercial.has(key)) {
            const demand = getConsumptionRate(cell.buildingId);
            if (demand > 0 && importBudget >= demand) {
              importBudget -= demand;
              imported += demand;
              this.importedCommercial.add(key);
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
      // Export limited by: surplus, exportable production, and throughput capacity
      exported = Math.min(surplus, exportableProduction, exportCap);
    }

    const shortage = totalConsumption - actualConsumed - imported;
    this.isExporting = exported > 0;
    this.lastDemand = { production: totalProduction, consumption: totalConsumption, shortage: Math.max(0, shortage) };
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

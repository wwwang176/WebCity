export interface TreatmentPlant {
  id: string;
  x: number;
  y: number;
  capacity: number;
}

interface SewageCell {
  x: number;
  y: number;
  amount: number;
}

interface SewageJSON {
  treatmentPlants: TreatmentPlant[];
  untreatedSewage: number;
  nextId: number;
}

import type { PollutionSource } from '../environment/Pollution';
import { isFootprintAdjacentToRoad, type ReadableGrid } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';
import { isFacilityOperational, type UtilityChecker } from './FacilityOperational';
import { Grid } from '../grid/Grid';
import { ZoneType } from '../grid/types';
import { getBuildingType } from '../building/types';
import { getInfraBuildingId } from '../building/InfraConfig';
import { bfsRoadNetworkFlood, bfsBudgetDrainFlood } from './NetworkCoverage';
import { CoverageBits } from './CoverageBits';
import { UtilityFloodScratch } from './UtilityFloodScratch';
import { calculateUtilityCellDemand, type UtilityCellDemandConfig } from './UtilityCellDemand';
import { WATER_CONSUMPTION } from './WaterNetwork';

/** Sewage system configuration constants */
export const SEWAGE = {
  /** Default treatment plant capacity (1.5x water plant output of 1500) */
  DEFAULT_CAPACITY: 2250,
  /** Water pollution multiplier per untreated sewage unit */
  WATER_POLLUTION_MULTIPLIER: 5,
  /** Maximum pollution emitted per building cell */
  MAX_POLLUTION_PER_CELL: 80,
  /** Monthly maintenance cost per treatment plant */
  MAINTENANCE_PER_PLANT: 4,
  /** Sewage rate: fraction of water consumption that becomes sewage, per zone */
  SEWAGE_RATE: {
    RESIDENTIAL: 0.85,
    COMMERCIAL: 0.90,
    INDUSTRIAL: 0.90,
    OFFICE: 0.92,
  },
} as const;

/** Sewage demand = water consumption × sewage rate per zone. */
export const SEWAGE_CONSUMPTION = {
  RESIDENTIAL: { base: WATER_CONSUMPTION.RESIDENTIAL.base * SEWAGE.SEWAGE_RATE.RESIDENTIAL, perCapita: WATER_CONSUMPTION.RESIDENTIAL.perCapita * SEWAGE.SEWAGE_RATE.RESIDENTIAL },
  COMMERCIAL:  { base: WATER_CONSUMPTION.COMMERCIAL.base * SEWAGE.SEWAGE_RATE.COMMERCIAL,   perCapita: WATER_CONSUMPTION.COMMERCIAL.perCapita * SEWAGE.SEWAGE_RATE.COMMERCIAL },
  INDUSTRIAL:  { base: WATER_CONSUMPTION.INDUSTRIAL.base * SEWAGE.SEWAGE_RATE.INDUSTRIAL,   perCapita: WATER_CONSUMPTION.INDUSTRIAL.perCapita * SEWAGE.SEWAGE_RATE.INDUSTRIAL },
  OFFICE:      { base: WATER_CONSUMPTION.OFFICE.base * SEWAGE.SEWAGE_RATE.OFFICE,           perCapita: WATER_CONSUMPTION.OFFICE.perCapita * SEWAGE.SEWAGE_RATE.OFFICE },
} as const;

const SEWAGE_PLANT_ID = getInfraBuildingId('sewage');

/** Infrastructure buildings don't produce sewage in the current model. */
const SEWAGE_DEMAND_CONFIG: UtilityCellDemandConfig = {
  zoneConsumption: SEWAGE_CONSUMPTION,
  infraConsumption: {},
  infraTypeToKey: {},
  excludedBuildingId: SEWAGE_PLANT_ID,
};

export class SewageService {
  private treatmentPlants: TreatmentPlant[] = [];
  private connectedPlantIds = new Set<string>();
  /** Infrastructure positions from the last calculateCoverage, for recalculateCoverage. */
  private lastInfraPositions: Set<string> | undefined;
  private operationalPlantIds: Set<string> | null = null;
  private untreatedSewage = 0;
  private produced = 0;
  private nextId = 1;
  // BFS coverage fields (mirrors WaterNetwork pattern)
  private supplied = new CoverageBits();
  private fullCoverage = new CoverageBits();
  /**
   * The flood's traversal state and this pass's shared records, reused across calls:
   * reallocating map-sized typed arrays every 6 ticks is wasted.
   */
  private readonly floodScratch = new UtilityFloodScratch();
  private totalDemand = 0;
  private roadLookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup | null = null;
  // Per-cell sewage tracking for building-based pollution
  private sewageCells: SewageCell[] = [];

  addTreatmentPlant(x: number, y: number, capacity: number = SEWAGE.DEFAULT_CAPACITY): string {
    const id = `plant-${this.nextId++}`;
    this.treatmentPlants.push({ id, x, y, capacity });
    this.connectedPlantIds.add(id);
    return id;
  }

  /** Report per-cell sewage production (called during civic services tick). */
  reportSewage(x: number, y: number, amount: number): void {
    this.sewageCells.push({ x, y, amount });
  }

  clearSewageCells(): void {
    this.sewageCells.length = 0;
  }

  getSewageCells(): readonly SewageCell[] {
    return this.sewageCells;
  }

  removeTreatmentPlant(id: string): boolean {
    this.connectedPlantIds.delete(id);
    return removeById(this.treatmentPlants, id);
  }

  setRoadLookup(lookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup): void {
    this.roadLookup = lookup;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): CoverageBits {
    this.lastInfraPositions = infrastructurePositions;
    // Only plants that are both road-connected and powered can treat anything.
    // Both sets were already maintained, and getConnectedTreatmentCapacity
    // already applied them — but the coverage flood ignored both, so an
    // unpowered plant kept "supplying" its whole catchment. Since
    // getPollutionSources skips supplied cells, a city whose sewage plants had
    // all lost power emitted zero water pollution: the totals showed untreated
    // sewage climbing while the map showed no penalty at all (BUG-081).
    const active = this.treatmentPlants.filter(
      p => this.connectedPlantIds.has(p.id) && this.isPlantOperational(p.id),
    );

    // Phase 1: full coverage (no budget limit)
    this.floodScratch.beginPass(grid, infrastructurePositions);
    this.fullCoverage.reset(grid.width, grid.height);
    for (const p of active) {
      bfsRoadNetworkFlood(grid, p.x, p.y, this.fullCoverage, this.floodScratch, this.roadLookup);
    }
    // Phase 2: budget-drain per plant (capacity as budget)
    this.supplied.reset(grid.width, grid.height);
    const getDemand = (x: number, y: number) => this.getCellDemandAt(grid, x, y);
    for (const p of active) {
      bfsBudgetDrainFlood(grid, { x: p.x, y: p.y, output: p.capacity }, this.supplied, getDemand, this.floodScratch, this.roadLookup);
    }
    return this.supplied;
  }

  calculateDemand(grid: Grid): void {
    let demand = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId <= 0) return;
      const bt = getBuildingType(cell.buildingId);
      demand += calculateUtilityCellDemand(
        SEWAGE_DEMAND_CONFIG, cell.buildingId, cell.zoneType as ZoneType,
        bt?.residents ?? 0, bt?.workers ?? 0, cell.reserved,
      );
    });
    this.totalDemand = demand;
  }

  isSupplied(x: number, y: number): boolean {
    return this.supplied.has(x, y);
  }

  isInCoverage(x: number, y: number): boolean {
    return this.fullCoverage.has(x, y);
  }

  getDemand(): number {
    return this.totalDemand;
  }

  getCellDemandAt(grid: Grid, x: number, y: number): number {
    const cell = grid.getCell(x, y);
    if (!cell || cell.buildingId <= 0) return 0;
    const bt = getBuildingType(cell.buildingId);
    return calculateUtilityCellDemand(
      SEWAGE_DEMAND_CONFIG, cell.buildingId, cell.zoneType as ZoneType,
      bt?.residents ?? 0, bt?.workers ?? 0, cell.reserved,
    );
  }

  /** Produce sewage from water demand (manual step). */
  produceSewage(sewageAmount: number): void {
    this.untreatedSewage += sewageAmount;
  }

  /** Recompute which treatment plants are adjacent to at least one road cell. */
  updateConnectedPlants(grid: ReadableGrid): void {
    this.connectedPlantIds.clear();
    for (const p of this.treatmentPlants) {
      if (isFootprintAdjacentToRoad(grid, p.x, p.y, 2, 2)) {
        this.connectedPlantIds.add(p.id);
      }
    }
  }

  /**
   * Update which treatment plants are operational (have power; sewage is
   * water-exempt). Returns true if the set changed.
   *
   * The return value is what lets the caller recalculate coverage at once.
   * Coverage is a precomputed Set built at slow-slot 1, while this runs at
   * slot 2 — so a plant that lost power kept "supplying" its whole catchment
   * until the next cycle came round, and since getPollutionSources skips
   * supplied cells, the water-pollution penalty was suppressed for that whole
   * window. Education already recalculates immediately; sewage did not.
   */
  updateOperationalStatus(isPowered: UtilityChecker, isWaterSupplied: UtilityChecker): boolean {
    const next = new Set<string>();
    for (const p of this.treatmentPlants) {
      if (isFacilityOperational(p.x, p.y, 'sewage', isPowered, isWaterSupplied)) {
        next.add(p.id);
      }
    }
    const prev = this.operationalPlantIds;
    const changed = prev === null || prev.size !== next.size
      || [...next].some(id => !prev.has(id));
    this.operationalPlantIds = next;
    return changed;
  }

  /**
   * Repeat the last coverage calculation with the same inputs.
   *
   * calculateCoverage needs the infrastructure position set, which only
   * SimulationLoop assembles; remembering it here lets tickAllCivicServices
   * refresh coverage without reaching for it.
   */
  recalculateCoverage(grid: Grid): void {
    this.calculateCoverage(grid, this.lastInfraPositions);
  }

  private isPlantOperational(id: string): boolean {
    return this.operationalPlantIds === null || this.operationalPlantIds.has(id);
  }

  /**
   * Whether this plant is actually treating anything — road-connected AND
   * powered, the same pair getConnectedTreatmentCapacity settles against.
   *
   * The infrastructure panel needs it to stop attributing a share of the city's
   * sewage to a plant that is not treating any of it (BUG-153).
   */
  isPlantActive(id: string): boolean {
    return this.connectedPlantIds.has(id) && this.isPlantOperational(id);
  }

  /**
   * Full tick: produce sewage from water demand, then treat as much as connected capacity allows.
   * @param sewageProduced Total sewage produced this tick (water demand × sewage rates).
   */
  tick(sewageProduced: number): void {
    this.produced = sewageProduced;
    this.untreatedSewage = 0;
    const connectedCapacity = this.getConnectedTreatmentCapacity();
    this.untreatedSewage = Math.max(0, sewageProduced - connectedCapacity);
  }

  /** Total sewage produced this tick (before treatment). */
  getProduced(): number {
    return this.produced;
  }

  /** Treatment capacity from connected AND operational plants only. */
  private getConnectedTreatmentCapacity(): number {
    let cap = 0;
    for (const p of this.treatmentPlants) {
      if (this.connectedPlantIds.has(p.id) && this.isPlantOperational(p.id)) cap += p.capacity;
    }
    return cap;
  }

  getUntreated(): number {
    return this.untreatedSewage;
  }

  /** Water pollution is proportional to untreated sewage. */
  getWaterPollution(): number {
    return this.untreatedSewage * SEWAGE.WATER_POLLUTION_MULTIPLIER;
  }

  /**
   * Treatment capacity the city can actually use.
   *
   * tick() has always settled against getConnectedTreatmentCapacity, but the
   * infrastructure panel read this unfiltered total — so untreated sewage could
   * be climbing while the panel showed ample capacity, and the two numbers
   * shown side by side contradicted each other.
   */
  getTreatmentCapacity(): number {
    return this.getConnectedTreatmentCapacity();
  }

  getTreatmentPlants(): readonly TreatmentPlant[] {
    return this.treatmentPlants;
  }

  getMaintenanceCost(): number {
    return this.treatmentPlants.length * SEWAGE.MAINTENANCE_PER_PLANT;
  }

  getPollutionSources(): PollutionSource[] {
    if (this.sewageCells.length === 0) return [];
    const sources: PollutionSource[] = [];
    for (const cell of this.sewageCells) {
      if (this.isSupplied(cell.x, cell.y)) continue;
      const amount = Math.min(SEWAGE.MAX_POLLUTION_PER_CELL, cell.amount * SEWAGE.WATER_POLLUTION_MULTIPLIER);
      sources.push({ x: cell.x, y: cell.y, amount, type: 'water' });
    }
    return sources;
  }

  toJSON(): SewageJSON {
    return {
      treatmentPlants: this.treatmentPlants.map(p => ({ ...p })),
      untreatedSewage: this.untreatedSewage,
      nextId: this.nextId,
    };
  }

  static fromJSON(json: SewageJSON & { outlets?: unknown }): SewageService {
    const svc = new SewageService();
    svc.treatmentPlants = json.treatmentPlants.map(p => ({ ...p }));
    for (const p of svc.treatmentPlants) svc.connectedPlantIds.add(p.id);
    svc.untreatedSewage = json.untreatedSewage;
    svc.nextId = json.nextId;
    return svc;
  }
}

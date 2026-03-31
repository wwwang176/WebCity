import { isFootprintAdjacentToRoad, type SizedGrid } from '../grid/GridHelpers';
import { RoadCoverageMap } from './RoadCoverageFlood';
import type { ServiceFacilityProvider } from '../traffic/ServiceVehicleManager';
import { removeById } from '../utils/removeById';

/** Minimum facility shape: must have id and position. */
export interface Facility {
  id: string;
  x: number;
  y: number;
}

/**
 * Abstract base class for civic services that use road-distance coverage.
 * Eliminates duplicate getCoverage/getCostRatio/recalculateCoverage/previewCoverage
 * across PoliceService, HealthService, GarbageService, DeathCareService, etc.
 *
 * Subclasses provide:
 * - coverageBudget: road-distance budget for coverage flood
 * - defaultFacilityWidth/Height: building footprint for coverage origin
 * - idPrefix: e.g. "police_", "hospital_"
 */
export abstract class RoadCoverageService<F extends Facility> implements ServiceFacilityProvider {
  protected facilities: F[] = [];
  protected coverage = new RoadCoverageMap();
  protected connectedFacilityIds = new Set<string>();
  /** null = no filter (all operational); Set = only listed IDs are operational. */
  protected operationalIds: Set<string> | null = null;
  protected nextId = 1;

  protected abstract readonly coverageBudget: number;
  protected abstract readonly defaultFacilityWidth: number;
  protected abstract readonly defaultFacilityHeight: number;
  protected abstract readonly idPrefix: string;
  /** Maintenance cost per facility (used by default getMaintenanceCost). */
  protected abstract readonly maintenanceCostPerFacility: number;

  /** Generate a unique ID for a new facility. */
  protected generateId(): string {
    return `${this.idPrefix}${this.nextId++}`;
  }

  /** Push a facility and mark it connected (placement requires road adjacency). */
  protected pushFacility(f: F): void {
    this.facilities.push(f);
    this.connectedFacilityIds.add(f.id);
  }

  /** Restore nextId from loaded facilities (for fromJSON). Also marks all loaded facilities as connected. */
  protected restoreNextId(): void {
    let max = 0;
    for (const f of this.facilities) {
      const n = parseInt(f.id.replace(this.idPrefix, ''), 10);
      if (n > max) max = n;
      this.connectedFacilityIds.add(f.id);
    }
    this.nextId = max + 1;
  }

  getCoverage(x: number, y: number): boolean {
    return this.coverage.hasCoverage(x, y);
  }

  getCostRatio(x: number, y: number): number {
    return this.coverage.getCostRatio(x, y);
  }

  getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    return this.coverage.getCoveredCells();
  }

  recalculateCoverage(
    grid: SizedGrid,
    facilityWidth = this.defaultFacilityWidth,
    facilityHeight = this.defaultFacilityHeight,
  ): void {
    const active = this.operationalIds
      ? this.facilities.filter(f => this.operationalIds!.has(f.id))
      : this.facilities;
    this.coverage.recalculate(active, grid, this.coverageBudget, facilityWidth, facilityHeight);
    this.updateConnectedFacilities(grid);
  }

  /** Recompute which facilities are adjacent to at least one road cell. */
  protected updateConnectedFacilities(grid: SizedGrid): void {
    this.connectedFacilityIds.clear();
    const w = this.defaultFacilityWidth;
    const h = this.defaultFacilityHeight;
    for (const f of this.facilities) {
      if (isFootprintAdjacentToRoad(grid, f.x, f.y, w, h)) {
        this.connectedFacilityIds.add(f.id);
      }
    }
  }

  /** Check if a facility is currently connected to a road. */
  isFacilityConnected(id: string): boolean {
    return this.connectedFacilityIds.has(id);
  }

  previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    facilityWidth = this.defaultFacilityWidth,
    facilityHeight = this.defaultFacilityHeight,
  ): Map<string, number> {
    return this.coverage.previewMerged(position, grid, this.coverageBudget, facilityWidth, facilityHeight);
  }

  /** Update which facilities are operational (have power + water). */
  updateOperationalStatus(predicate: (f: F) => boolean): void {
    this.operationalIds = new Set<string>();
    for (const f of this.facilities) {
      if (predicate(f)) this.operationalIds.add(f.id);
    }
  }

  /** Check if a facility is currently operational. Returns true if no filter is active. */
  isFacilityOperationalById(id: string): boolean {
    return this.operationalIds === null || this.operationalIds.has(id);
  }

  /** Return only operational facilities. */
  getOperationalFacilities(): readonly F[] {
    if (this.operationalIds === null) return this.facilities;
    return this.facilities.filter(f => this.operationalIds!.has(f.id));
  }

  /** Default maintenance cost: count × per-facility cost. Override for custom logic. */
  getMaintenanceCost(): number {
    return this.facilities.length * this.maintenanceCostPerFacility;
  }

  /** Get all facilities (read-only). Subclasses may alias this (e.g. getStations). */
  getFacilities(): readonly F[] {
    return this.facilities;
  }

  /** Remove a facility by ID. Override for custom cleanup (e.g. GarbageService overflow). */
  removeFacilityById(id: string): boolean {
    this.connectedFacilityIds.delete(id);
    return removeById(this.facilities, id);
  }

  /** ServiceFacilityProvider: return facility positions for service vehicle spawning. */
  getFacilityPositions(): ReadonlyArray<{ x: number; y: number }> {
    return this.facilities;
  }
}

import { isFootprintAdjacentToRoad, isFootprintNearRoad, type SizedGrid } from '../grid/GridHelpers';
import { RoadCoverageMap } from './RoadCoverageFlood';
import type { ServiceFacilityProvider } from '../traffic/ServiceVehicleManager';
import { removeById } from '../utils/removeById';
import { RESERVED_TO_ROTATION } from '../building/InfraPlacement';

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
  /**
   * Chebyshev distance within which a road must exist for a facility to count
   * as connected. Default 1 = strictly orthogonally adjacent. Civic subclasses
   * (police/fire/hospital/schools/cemetery) override to 2 so they may sit one
   * empty tile away from a road — matching their InfraConfig.roadReach.
   */
  protected readonly roadReach: 1 | 2 = 1;

  /** Generate a unique ID for a new facility. */
  protected generateId(): string {
    return `${this.idPrefix}${this.nextId++}`;
  }

  /** Push a facility and mark it connected + operational (placement requires road adjacency). */
  protected pushFacility(f: F): void {
    this.facilities.push(f);
    this.connectedFacilityIds.add(f.id);
    if (this.operationalIds) this.operationalIds.add(f.id);
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

  recalculateCoverage(grid: SizedGrid): void {
    const active = this.operationalIds
      ? this.facilities.filter(f => this.operationalIds!.has(f.id))
      : this.facilities;
    const baseW = this.defaultFacilityWidth;
    const baseH = this.defaultFacilityHeight;
    const getSize = (f: { x: number; y: number }) => {
      const cell = grid.getCell(f.x, f.y);
      const rotation = cell?.reserved !== undefined ? (RESERVED_TO_ROTATION[cell.reserved] ?? 0) : 0;
      const swapped = rotation === 90 || rotation === 270;
      return { w: swapped ? baseH : baseW, h: swapped ? baseW : baseH };
    };
    // Civic services (roadReach=2) need a wider seed ring so a facility sitting
    // one empty tile back from a road can still start the coverage flood.
    this.coverage.setSeedReach(this.roadReach);
    this.coverage.recalculate(active, grid, this.coverageBudget, baseW, baseH, getSize);
    this.updateConnectedFacilities(grid);
  }

  /** Recompute which facilities are within road reach of at least one road cell. */
  protected updateConnectedFacilities(grid: SizedGrid): void {
    this.connectedFacilityIds.clear();
    const baseW = this.defaultFacilityWidth;
    const baseH = this.defaultFacilityHeight;
    const reach = this.roadReach;
    for (const f of this.facilities) {
      const cell = grid.getCell(f.x, f.y);
      const rotation = cell?.reserved !== undefined ? (RESERVED_TO_ROTATION[cell.reserved] ?? 0) : 0;
      const swapped = rotation === 90 || rotation === 270;
      const w = swapped ? baseH : baseW;
      const h = swapped ? baseW : baseH;
      const connected = reach >= 2
        ? isFootprintNearRoad(grid, f.x, f.y, w, h, reach)
        : isFootprintAdjacentToRoad(grid, f.x, f.y, w, h);
      if (connected) {
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
    this.coverage.setSeedReach(this.roadReach);
    return this.coverage.previewMerged(position, grid, this.coverageBudget, facilityWidth, facilityHeight);
  }

  /** Update which facilities are operational (have power + water).
   *  Returns true if the set changed (facility gained or lost operational status). */
  updateOperationalStatus(predicate: (f: F) => boolean): boolean {
    const next = new Set<string>();
    for (const f of this.facilities) {
      if (predicate(f)) next.add(f.id);
    }
    const prev = this.operationalIds;
    const changed = !prev || prev.size !== next.size || [...next].some(id => !prev.has(id));
    this.operationalIds = next;
    return changed;
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

  /**
   * Facilities that actually work: powered AND reachable by road.
   *
   * getOperationalFacilities asks only the first half. Coverage spreads along
   * roads, so a facility with no road covers nobody — but the capacity sums
   * were built from the looser test and kept counting its places. Same name and
   * meaning as GlobalCoverageService.getActiveFacilities, which has asked both
   * questions since BUG-101.
   */
  getActiveFacilities(): readonly F[] {
    return this.getOperationalFacilities().filter(f => this.connectedFacilityIds.has(f.id));
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

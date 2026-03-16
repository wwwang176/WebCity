import type { SizedGrid } from '../grid/GridHelpers';
import { RoadCoverageMap } from './RoadCoverageFlood';

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
export abstract class RoadCoverageService<F extends Facility> {
  protected facilities: F[] = [];
  protected coverage = new RoadCoverageMap();
  protected nextId = 1;

  protected abstract readonly coverageBudget: number;
  protected abstract readonly defaultFacilityWidth: number;
  protected abstract readonly defaultFacilityHeight: number;
  protected abstract readonly idPrefix: string;

  /** Generate a unique ID for a new facility. */
  protected generateId(): string {
    return `${this.idPrefix}${this.nextId++}`;
  }

  /** Restore nextId from loaded facilities (for fromJSON). */
  protected restoreNextId(): void {
    let max = 0;
    for (const f of this.facilities) {
      const n = parseInt(f.id.replace(this.idPrefix, ''), 10);
      if (n > max) max = n;
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
    this.coverage.recalculate(this.facilities, grid, this.coverageBudget, facilityWidth, facilityHeight);
  }

  previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    facilityWidth = this.defaultFacilityWidth,
    facilityHeight = this.defaultFacilityHeight,
  ): Map<string, number> {
    return this.coverage.previewMerged(position, grid, this.coverageBudget, facilityWidth, facilityHeight);
  }
}

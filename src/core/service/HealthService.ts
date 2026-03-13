import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';
import { RoadCoverageMap, ROAD_COVERAGE } from './RoadCoverageFlood';
import type { SizedGrid } from '../grid/GridHelpers';

export interface Hospital {
  id: string;
  x: number;
  y: number;
  radius: number;
  capacity: number;
}

interface HealthServiceJSON {
  hospitals: Hospital[];
}

/** Health service configuration constants */
export const HEALTH = {
  /** Health bonus per hospital covering a cell */
  BONUS_PER_HOSPITAL: 20,
  /** Maximum health bonus from hospital coverage */
  BONUS_CAP: 35,
  MAINTENANCE_PER_HOSPITAL: 8,
} as const;

export class HealthService {
  private hospitals: Hospital[] = [];
  private coverage = new RoadCoverageMap();
  private nextId = 1;

  addHospital(x: number, y: number, radius = 12, capacity = 100): string {
    const id = `hospital_${this.nextId++}`;
    this.hospitals.push({ id, x, y, radius, capacity });
    return id;
  }

  removeHospital(id: string): void {
    removeById(this.hospitals, id);
  }

  getCoverage(x: number, y: number): boolean {
    return this.coverage.hasCoverage(x, y);
  }

  getHealthBonus(x: number, y: number): number {
    const count = this.coverage.getCoverageCount(x, y);
    if (count === 0) return 0;
    return Math.min(count * HEALTH.BONUS_PER_HOSPITAL, HEALTH.BONUS_CAP);
  }

  getHospitals(): readonly Hospital[] {
    return this.hospitals;
  }

  /** Recompute road-distance coverage. Call after hospital or road changes. */
  recalculateCoverage(grid: SizedGrid, facilityWidth = 2, facilityHeight = 3): void {
    this.coverage.recalculate(this.hospitals, grid, ROAD_COVERAGE.HEALTH_BUDGET, facilityWidth, facilityHeight);
  }

  /** Preview coverage for a potential hospital placement, merged with existing. */
  previewCoverage(position: { x: number; y: number }, grid: SizedGrid, facilityWidth = 2, facilityHeight = 3): Map<string, number> {
    return this.coverage.previewMerged(position, grid, ROAD_COVERAGE.HEALTH_BUDGET, facilityWidth, facilityHeight);
  }

  /** Get all covered cells with their road-distance costs (for overlay gradient). */
  getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    return this.coverage.getCoveredCells();
  }

  tick(grid?: SizedGrid): void {
    if (grid) {
      this.recalculateCoverage(grid);
    }
  }

  getMaintenanceCost(): number {
    return this.hospitals.length * HEALTH.MAINTENANCE_PER_HOSPITAL;
  }

  toJSON(): HealthServiceJSON {
    return {
      hospitals: this.hospitals.map(h => ({ ...h })),
    };
  }

  static fromJSON(json: HealthServiceJSON): HealthService {
    const service = new HealthService();
    for (const h of json.hospitals) {
      service.hospitals.push({ ...h });
    }
    service.nextId = recoverNextId(service.hospitals, 'hospital_');
    return service;
  }
}

import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
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

export class HealthService extends RoadCoverageService<Hospital> {
  protected readonly coverageBudget = ROAD_COVERAGE.HEALTH_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 3;
  protected readonly idPrefix = 'hospital_';
  protected readonly maintenanceCostPerFacility = HEALTH.MAINTENANCE_PER_HOSPITAL;

  addHospital(x: number, y: number, radius = 12, capacity = 100): string {
    const id = this.generateId();
    this.facilities.push({ id, x, y, radius, capacity });
    return id;
  }

  removeHospital(id: string): void {
    this.removeFacilityById(id);
  }

  getHealthBonus(x: number, y: number): number {
    const count = this.coverage.getCoverageCount(x, y);
    if (count === 0) return 0;
    return Math.min(count * HEALTH.BONUS_PER_HOSPITAL, HEALTH.BONUS_CAP);
  }

  getHospitals(): readonly Hospital[] {
    return this.facilities;
  }

  tick(grid?: SizedGrid): void {
    if (grid) {
      this.recalculateCoverage(grid);
    }
  }

  toJSON(): HealthServiceJSON {
    return {
      hospitals: this.facilities.map(h => ({ ...h })),
    };
  }

  static fromJSON(json: HealthServiceJSON): HealthService {
    const service = new HealthService();
    for (const h of json.hospitals) {
      service.facilities.push({ ...h });
    }
    service.restoreNextId();
    return service;
  }
}

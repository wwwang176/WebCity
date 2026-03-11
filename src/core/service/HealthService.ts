import { removeById } from '../utils/removeById';
import { RadiusCoverageMap } from './RadiusCoverageMap';

export interface Hospital {
  id: string;
  x: number;
  y: number;
  radius: number;
  capacity: number;
}

export interface HealthServiceJSON {
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
  private coverage = new RadiusCoverageMap();
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

  tick(): void {
    this.coverage.recalculate(this.hospitals);
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
    for (const h of service.hospitals) {
      const num = parseInt(h.id.replace('hospital_', ''), 10);
      if (num >= service.nextId) service.nextId = num + 1;
    }
    return service;
  }
}

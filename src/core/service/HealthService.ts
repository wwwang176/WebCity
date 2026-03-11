import { toPosKey, forEachCellInRadius } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';

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
} as const;

let nextId = 1;

export class HealthService {
  private hospitals: Hospital[] = [];
  /** Maps "x,y" to the number of hospitals covering that point (computed on tick) */
  private coverageCount = new Map<string, number>();

  addHospital(x: number, y: number, radius = 12, capacity = 100): string {
    const id = `hospital_${nextId++}`;
    this.hospitals.push({ id, x, y, radius, capacity });
    return id;
  }

  removeHospital(id: string): void {
    removeById(this.hospitals, id);
  }

  getCoverage(x: number, y: number): boolean {
    return (this.coverageCount.get(toPosKey(x, y)) ?? 0) > 0;
  }

  getHealthBonus(x: number, y: number): number {
    const count = this.coverageCount.get(toPosKey(x, y)) ?? 0;
    if (count === 0) return 0;
    return Math.min(count * HEALTH.BONUS_PER_HOSPITAL, HEALTH.BONUS_CAP);
  }

  getHospitals(): readonly Hospital[] {
    return this.hospitals;
  }

  tick(): void {
    this.coverageCount.clear();
    for (const hospital of this.hospitals) {
      this.applyCoverage(hospital);
    }
  }

  private applyCoverage(hospital: Hospital): void {
    forEachCellInRadius(hospital.x, hospital.y, hospital.radius, (x, y) => {
      const key = toPosKey(x, y);
      this.coverageCount.set(key, (this.coverageCount.get(key) ?? 0) + 1);
    });
  }

  getMaintenanceCost(): number {
    return this.hospitals.length * 8;
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
    return service;
  }
}

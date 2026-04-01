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
  DEFAULT_CAPACITY: 1200,
  DEFAULT_RADIUS: 12,
} as const;

/** Hospital load & death-rate constants */
export const HOSPITAL_LOAD = {
  /** Base hospital demand per covered citizen (30%) */
  BASE_DEMAND: 0.3,
  /** Additional demand from max pollution (doubles to 60%) */
  POLLUTION_DEMAND: 0.3,
  /** Load ratio threshold — below this, hospital works at full effectiveness */
  LOAD_THRESHOLD: 1.0,
  /** Load ratio cap — at or above this, hospital provides no death-rate benefit */
  LOAD_MAX: 2.0,
  /** Best death-rate multiplier (full coverage, no overload) */
  COVERED_MIN: 0.3,
  /** Worst death-rate multiplier (overloaded or uncovered) */
  COVERED_MAX: 1.0,
  /** Extra death-rate multiplier for uncovered citizens in polluted areas */
  UNCOVERED_POLLUTION_FACTOR: 0.5,
} as const;

/** Per-citizen hospital demand weight, scaled by pollution at their home. */
export function citizenHospitalDemand(pollution: number): number {
  return HOSPITAL_LOAD.BASE_DEMAND + HOSPITAL_LOAD.POLLUTION_DEMAND * (pollution / 255);
}

/** Convert hospital load ratio to death-rate multiplier (0.3–1.0). */
export function loadRatioToDeathMultiplier(loadRatio: number): number {
  if (loadRatio <= HOSPITAL_LOAD.LOAD_THRESHOLD) return HOSPITAL_LOAD.COVERED_MIN;
  if (loadRatio >= HOSPITAL_LOAD.LOAD_MAX) return HOSPITAL_LOAD.COVERED_MAX;
  const t = (loadRatio - HOSPITAL_LOAD.LOAD_THRESHOLD)
          / (HOSPITAL_LOAD.LOAD_MAX - HOSPITAL_LOAD.LOAD_THRESHOLD);
  return HOSPITAL_LOAD.COVERED_MIN + t * (HOSPITAL_LOAD.COVERED_MAX - HOSPITAL_LOAD.COVERED_MIN);
}

/** Death-rate multiplier for uncovered citizens based on home pollution. */
export function uncoveredPollutionMultiplier(pollution: number): number {
  return 1 + HOSPITAL_LOAD.UNCOVERED_POLLUTION_FACTOR * (pollution / 255);
}

export class HealthService extends RoadCoverageService<Hospital> {
  protected readonly coverageBudget = ROAD_COVERAGE.HEALTH_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 3;
  protected readonly idPrefix = 'hospital_';
  protected readonly maintenanceCostPerFacility = HEALTH.MAINTENANCE_PER_HOSPITAL;

  private loadRatio = 0;
  private readonly hospitalDemand = new Map<string, number>();

  /** Update city-wide and per-hospital load from covered citizen positions.
   *  Each citizen is assigned to the nearest hospital (Euclidean). */
  updateLoads(coveredCitizens: ReadonlyArray<{ x: number; y: number; pollution: number }>): void {
    this.hospitalDemand.clear();
    for (const h of this.facilities) this.hospitalDemand.set(h.id, 0);

    let totalDemand = 0;
    for (const c of coveredCitizens) {
      const demand = citizenHospitalDemand(c.pollution);
      totalDemand += demand;

      // Assign to nearest hospital by Euclidean distance
      let nearestId = '';
      let nearestDist = Infinity;
      for (const h of this.facilities) {
        const dx = c.x - h.x;
        const dy = c.y - h.y;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) { nearestDist = dist; nearestId = h.id; }
      }
      if (nearestId) {
        this.hospitalDemand.set(nearestId, (this.hospitalDemand.get(nearestId) ?? 0) + demand);
      }
    }

    const cap = this.getTotalCapacity();
    this.loadRatio = cap > 0 ? totalDemand / cap : (totalDemand > 0 ? Infinity : 0);
  }

  /** Rounded demand for a specific hospital (for UI display). */
  getHospitalLoad(hospitalId: string): number {
    return Math.round(this.hospitalDemand.get(hospitalId) ?? 0);
  }

  getLoadRatio(): number {
    return this.loadRatio;
  }

  getTotalCapacity(): number {
    let sum = 0;
    for (const h of this.facilities) sum += h.capacity;
    return sum;
  }

  addHospital(x: number, y: number, radius = HEALTH.DEFAULT_RADIUS, capacity = HEALTH.DEFAULT_CAPACITY): string {
    const id = this.generateId();
    this.pushFacility({ id, x, y, radius, capacity });
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
    service.restoreNextId(); // also marks facilities connected
    return service;
  }
}

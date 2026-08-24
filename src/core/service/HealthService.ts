import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import { distributeWithSpillover } from './SpilloverLoadDistributor';
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
  DEFAULT_CAPACITY: 1750,
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

  /**
   * Update city-wide and per-hospital load from covered citizen positions.
   * Each citizen is assigned to the nearest hospital (Euclidean).
   *
   * `count` is how many people this cell stands for, defaulting to 1. The caller counts a
   * building's residents up first: coordinates and pollution depend only on the building, so
   * passing one entry per citizen allocates 120,000 small objects for a few thousand distinct
   * positions. This only sums per cell anyway, so pre-summing gives the same result.
   */
  updateLoads(coveredCitizens: ReadonlyArray<{ x: number; y: number; pollution: number; count?: number }>): void {
    this.hospitalDemand.clear();
    for (const h of this.facilities) this.hospitalDemand.set(h.id, 0);

    // Nearest hospital first, spilling to the next when full — the hearse rule. Picking a single
    // hospital by straight-line distance let one across a river, close in a line but a long
    // drive away, draw the patients (BUG-363); recognising only the nearest crowded everyone
    // into one and left the second empty (BUG-365).
    //
    // Coverage floods only out of operational facilities, so never allocating to an unpowered
    // hospital comes for free (what BUG-100 asked for).
    //
    // Only hospitals that can take patients count: `getActiveFacilities()` requires both power
    // **and** a road connection, the same set `getTotalCapacity()` uses. Unusable beds in the
    // denominator make a city look healthier as it collapses (BUG-100).
    const result = distributeWithSpillover(
      this.getActiveFacilities(),
      coveredCitizens.map(c => ({
        x: c.x, y: c.y, weight: citizenHospitalDemand(c.pollution) * (c.count ?? 1),
      })),
      this.hospitalDemand,
      (x, y) => this.getCoveringFacilityIds(x, y),
    );
    this.loadRatio = result.loadRatio;
  }

  /** Rounded demand for a specific hospital (for UI display). */
  getHospitalLoad(hospitalId: string): number {
    return Math.round(this.hospitalDemand.get(hospitalId) ?? 0);
  }

  getLoadRatio(): number {
    return this.loadRatio;
  }

  /**
   * Capacity of hospitals that can actually treat anyone.
   *
   * Coverage already excludes non-operational facilities, so the demand side of
   * loadRatio was filtered while the capacity side summed every hospital,
   * including unpowered ones. That understated load exactly when the city was
   * failing — and SimulationLoop multiplies the death rate by getLoadRatio(),
   * so blacked-out hospitals kept suppressing deaths (BUG-100).
   */
  getTotalCapacity(): number {
    // Road connectivity too, not just power: an unreachable hospital covers
    // nobody, and SimulationLoop multiplies the death rate by getLoadRatio(),
    // so its unusable beds suppressed deaths across the whole city.
    let sum = 0;
    for (const h of this.getActiveFacilities()) sum += h.capacity;
    return sum;
  }

  addHospital(x: number, y: number, radius: number = HEALTH.DEFAULT_RADIUS, capacity: number = HEALTH.DEFAULT_CAPACITY): string {
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

  protected override facilityLoadOf(id: string): { load: number; capacity: number } | null {
    const h = this.facilities.find(f => f.id === id);
    return h ? { load: this.getHospitalLoad(id), capacity: h.capacity } : null;
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

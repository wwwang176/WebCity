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
   * `count` 是這一格代表幾個人（預設 1）。呼叫端把同一棟樓的住戶先數起來再送進來 ——
   * 座標與污染只跟樓有關，逐市民送的話 12 萬人要配置 12 萬個小物件，而不重複的
   * 位置只有幾千個。這裡對同一格本來就只做加總，先加起來結果一樣。
   */
  updateLoads(coveredCitizens: ReadonlyArray<{ x: number; y: number; pollution: number; count?: number }>): void {
    this.hospitalDemand.clear();
    for (const h of this.facilities) this.hospitalDemand.set(h.id, 0);

    // 攤給**服務那一格的那一間**醫院 —— 沿馬路走過來最便宜的那一間，跟圓點與
    // 圖層同一個答案。以前這裡用歐氏直線,河對岸一間直線很近、開車要繞一大圈的
    // 醫院會吸走這一區的病人,顯示爆量卻服務不到人（BUG-363）。
    //
    // 覆蓋本來就只從運作中的設施淹出去,所以「不會攤給沒電的那一間」是免費附帶的
    // （BUG-100 當初要的就是這件事）。
    const operationalIds = new Set(this.getOperationalFacilities().map(h => h.id));
    let totalDemand = 0;
    for (const c of coveredCitizens) {
      const demand = citizenHospitalDemand(c.pollution) * (c.count ?? 1);
      totalDemand += demand;

      const id = this.getServingFacilityId(c.x, c.y);
      if (id !== null && operationalIds.has(id)) {
        this.hospitalDemand.set(id, (this.hospitalDemand.get(id) ?? 0) + demand);
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

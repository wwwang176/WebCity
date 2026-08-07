/**
 * EducationService — facade over three SchoolService instances.
 * Keeps the same external API so callers don't need to change.
 */
import type { SizedGrid } from '../grid/GridHelpers';
import { isFacilityOperational, type UtilityChecker } from './FacilityOperational';
import type { InfraType } from '../building/InfraConfig';
import { SchoolService, EDUCATION, DEFAULT_CAPACITY, DEFAULT_RADIUS } from './SchoolService';
import type { SchoolFacility } from './SchoolService';

export type SchoolType = 'elementary' | 'highschool' | 'university';

export type { SchoolFacility as School } from './SchoolService';
export { EDUCATION, DEFAULT_CAPACITY, DEFAULT_RADIUS };

/** All school types in order. */
const SCHOOL_TYPES: readonly SchoolType[] = ['elementary', 'highschool', 'university'];

/** Map SchoolType → InfraType for operational checks. */
const SCHOOL_INFRA_TYPE: Record<SchoolType, InfraType> = {
  elementary: 'school',
  highschool: 'school_high',
  university: 'school_univ',
};

export type EducationLevelResult = 'none' | SchoolType;

/** Enrolled citizen info for per-school assignment. */
export interface EnrolledCitizen {
  x: number;
  y: number;
  schoolKey: 'elementary' | 'highSchool' | 'university';
}

/** Map schoolKey → SchoolType for lookups. */
const SCHOOL_KEY_TO_TYPE: Record<EnrolledCitizen['schoolKey'], SchoolType> = {
  elementary: 'elementary',
  highSchool: 'highschool',
  university: 'university',
};

export class EducationService {
  readonly elementary = new SchoolService('elementary');
  readonly highSchool = new SchoolService('highschool');
  readonly university = new SchoolService('university');

  private serviceFor(type: SchoolType): SchoolService {
    switch (type) {
      case 'elementary': return this.elementary;
      case 'highschool': return this.highSchool;
      case 'university': return this.university;
    }
  }

  addSchool(x: number, y: number, type: SchoolType, radius?: number, capacity?: number): string {
    return this.serviceFor(type).addSchool(x, y, radius, capacity);
  }

  removeSchool(id: string): void {
    // Try all three — only one will contain the ID
    this.elementary.removeSchool(id);
    this.highSchool.removeSchool(id);
    this.university.removeSchool(id);
  }

  /**
   * Update which schools are operational (have power + water).
   * Returns true if any school's status changed, so the caller can recalculate
   * coverage. This used to return void, throwing the flag away: SchoolService
   * answers getCoverage from the array built at recalc time and never consults
   * operationalIds, so an unpowered school kept full coverage until the player
   * happened to edit a road (BUG-080).
   */
  updateOperationalStatus(isPowered: UtilityChecker, isWaterSupplied: UtilityChecker): boolean {
    let changed = false;
    for (const type of SCHOOL_TYPES) {
      const infraType = SCHOOL_INFRA_TYPE[type];
      const typeChanged = this.serviceFor(type).updateOperationalStatus(
        (f) => isFacilityOperational(f.x, f.y, infraType, isPowered, isWaterSupplied),
      );
      changed = changed || typeChanged;
    }
    return changed;
  }

  /** Recompute road-distance coverage for all school types. */
  recalculateCoverage(grid: SizedGrid): void {
    this.elementary.recalculateCoverage(grid);
    this.highSchool.recalculateCoverage(grid);
    this.university.recalculateCoverage(grid);
  }

  /**
   * Returns true if position (x, y) is within coverage of any school of the given type.
   * If type is omitted, checks all types.
   */
  getCoverage(x: number, y: number, type?: SchoolType): boolean {
    if (type !== undefined) return this.serviceFor(type).getCoverage(x, y);
    return this.elementary.getCoverage(x, y) ||
      this.highSchool.getCoverage(x, y) ||
      this.university.getCoverage(x, y);
  }

  /** Cost ratio: best (minimum) across all school types. -1 if uncovered. */
  getCostRatio(x: number, y: number): number {
    let best = -1;
    for (const type of SCHOOL_TYPES) {
      const r = this.serviceFor(type).getCostRatio(x, y);
      if (r >= 0 && (best < 0 || r < best)) best = r;
    }
    return best;
  }

  /** Returns the highest education level available at position (x, y). */
  getEducationLevel(x: number, y: number): EducationLevelResult {
    if (this.university.getCoverage(x, y)) return 'university';
    if (this.highSchool.getCoverage(x, y)) return 'highschool';
    if (this.elementary.getCoverage(x, y)) return 'elementary';
    return 'none';
  }

  /** Total student capacity for a given school type. */
  getTotalCapacity(type: SchoolType): number {
    return this.serviceFor(type).getTotalCapacity();
  }

  getSchools(): readonly SchoolFacility[] {
    return [
      ...this.elementary.getSchools(),
      ...this.highSchool.getSchools(),
      ...this.university.getSchools(),
    ];
  }

  /** Preview coverage for a potential school placement, merged with existing. */
  previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    type: SchoolType,
    facilityWidth?: number,
    facilityHeight?: number,
  ): Map<string, number> {
    return this.serviceFor(type).previewCoverage(position, grid, facilityWidth, facilityHeight);
  }

  /** Get all covered cells across all school types (for overlay gradient). */
  getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    const merged = new Map<string, number>();
    for (const type of SCHOOL_TYPES) {
      const cells = this.serviceFor(type).getCoveredCellsWithCost();
      for (const [key, cost] of cells) {
        const existing = merged.get(key);
        if (existing === undefined || cost < existing) {
          merged.set(key, cost);
        }
      }
    }
    return merged;
  }

  /** Assign enrolled/eligible citizens to nearest school of their type. */
  updateSchoolLoads(
    enrolled: ReadonlyArray<EnrolledCitizen>,
    eligible: ReadonlyArray<EnrolledCitizen>,
  ): void {
    // Partition by type
    const byType: Record<SchoolType, { enrolled: { x: number; y: number }[]; eligible: { x: number; y: number }[] }> = {
      elementary: { enrolled: [], eligible: [] },
      highschool: { enrolled: [], eligible: [] },
      university: { enrolled: [], eligible: [] },
    };
    for (const c of enrolled) byType[SCHOOL_KEY_TO_TYPE[c.schoolKey]].enrolled.push(c);
    for (const c of eligible) byType[SCHOOL_KEY_TO_TYPE[c.schoolKey]].eligible.push(c);

    for (const type of SCHOOL_TYPES) {
      this.serviceFor(type).updateLoads(byType[type].enrolled, byType[type].eligible);
    }
  }

  /** Per-school enrolled student count. */
  getSchoolEnrollment(schoolId: string): number {
    return this.elementary.getEnrollment(schoolId)
      || this.highSchool.getEnrollment(schoolId)
      || this.university.getEnrollment(schoolId);
  }

  /** Per-school total demand. */
  getSchoolDemand(schoolId: string): number {
    return this.elementary.getDemand(schoolId)
      || this.highSchool.getDemand(schoolId)
      || this.university.getDemand(schoolId);
  }

  tick(): void {
    // Coverage and enrollment handled externally via SimulationLoop.
  }

  getMaintenanceCost(): number {
    return this.elementary.getMaintenanceCost()
      + this.highSchool.getMaintenanceCost()
      + this.university.getMaintenanceCost();
  }

  toJSON(): { schools: SchoolFacility[] } {
    return {
      schools: [
        ...this.elementary.toJSON(),
        ...this.highSchool.toJSON(),
        ...this.university.toJSON(),
      ],
    };
  }

  static fromJSON(data: { schools: SchoolFacility[] }): EducationService {
    const service = new EducationService();
    const byType: Record<SchoolType, SchoolFacility[]> = {
      elementary: [],
      highschool: [],
      university: [],
    };
    for (const s of data.schools) {
      if (byType[s.type]) byType[s.type].push(s);
    }
    service.elementary.loadFromArray(byType.elementary);
    service.highSchool.loadFromArray(byType.highschool);
    service.university.loadFromArray(byType.university);
    return service;
  }
}

import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';
import { RoadCoverageMap, ROAD_COVERAGE } from './RoadCoverageFlood';
import type { SizedGrid } from '../grid/GridHelpers';
import { isFacilityOperational, type UtilityChecker } from './FacilityOperational';
import type { InfraType } from '../building/InfraConfig';

export type SchoolType = 'elementary' | 'highschool' | 'university';

export interface School {
  id: string;
  x: number;
  y: number;
  type: SchoolType;
  radius: number;
  capacity: number;
}

export const EDUCATION = {
  MAINTENANCE_PER_SCHOOL: 5,
} as const;

const DEFAULT_RADIUS: Record<SchoolType, number> = {
  elementary: 10,
  highschool: 12,
  university: 15,
};

const DEFAULT_CAPACITY: Record<SchoolType, number> = {
  elementary: 200,
  highschool: 300,
  university: 500,
};

/** Road-coverage budget per school type. Higher level = wider coverage. */
const SCHOOL_BUDGET: Record<SchoolType, number> = {
  elementary: ROAD_COVERAGE.EDUCATION_ELEMENTARY_BUDGET,
  highschool: ROAD_COVERAGE.EDUCATION_HIGHSCHOOL_BUDGET,
  university: ROAD_COVERAGE.EDUCATION_UNIVERSITY_BUDGET,
};

/** Facility footprint per school type (from InfraConfig). */
const SCHOOL_SIZE: Record<SchoolType, { width: number; height: number }> = {
  elementary: { width: 2, height: 2 },
  highschool: { width: 2, height: 3 },
  university: { width: 3, height: 3 },
};

/** Education level ranking for comparison (higher = better). */
const LEVEL_RANK: Record<SchoolType | 'none', number> = {
  none: 0,
  elementary: 1,
  highschool: 2,
  university: 3,
};

/** All school types in order (OCP: add new types here). */
const SCHOOL_TYPES: readonly SchoolType[] = ['elementary', 'highschool', 'university'];

export type EducationLevelResult = 'none' | SchoolType;

/** Map SchoolType → InfraType for operational checks. */
const SCHOOL_INFRA_TYPE: Record<SchoolType, InfraType> = {
  elementary: 'school',
  highschool: 'school_high',
  university: 'school_univ',
};

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
  private schools: School[] = [];
  private nextId = 1;
  private operationalSchoolIds: Set<string> | null = null;
  private readonly schoolEnrollment = new Map<string, number>();
  /** One RoadCoverageMap per school type, each with its own budget. */
  private coverageMaps: Record<SchoolType, RoadCoverageMap> = {
    elementary: new RoadCoverageMap(),
    highschool: new RoadCoverageMap(),
    university: new RoadCoverageMap(),
  };

  addSchool(
    x: number,
    y: number,
    type: SchoolType,
    radius?: number,
    capacity?: number,
  ): string {
    const id = `school-${this.nextId++}`;
    this.schools.push({
      id,
      x,
      y,
      type,
      radius: radius ?? DEFAULT_RADIUS[type],
      capacity: capacity ?? DEFAULT_CAPACITY[type],
    });
    return id;
  }

  removeSchool(id: string): void {
    removeById(this.schools, id);
  }

  /** Update which schools are operational (have power + water). */
  updateOperationalStatus(isPowered: UtilityChecker, isWaterSupplied: UtilityChecker): void {
    this.operationalSchoolIds = new Set<string>();
    for (const s of this.schools) {
      if (isFacilityOperational(s.x, s.y, SCHOOL_INFRA_TYPE[s.type], isPowered, isWaterSupplied)) {
        this.operationalSchoolIds.add(s.id);
      }
    }
  }

  private isSchoolOperational(id: string): boolean {
    return this.operationalSchoolIds === null || this.operationalSchoolIds.has(id);
  }

  /** Recompute road-distance coverage for all school types (only operational schools). */
  recalculateCoverage(grid: SizedGrid): void {
    const types = SCHOOL_TYPES;
    for (const type of types) {
      const facilities = this.schools.filter(s => s.type === type && this.isSchoolOperational(s.id));
      const size = SCHOOL_SIZE[type];
      this.coverageMaps[type].recalculate(
        facilities, grid, SCHOOL_BUDGET[type], size.width, size.height,
      );
    }
  }

  /**
   * Returns true if position (x, y) is within road-distance coverage of any
   * school of the given type. If type is omitted, checks all school types.
   */
  getCoverage(x: number, y: number, type?: SchoolType): boolean {
    if (type !== undefined) {
      return this.coverageMaps[type].hasCoverage(x, y);
    }
    return SCHOOL_TYPES.some(t => this.coverageMaps[t].hasCoverage(x, y));
  }

  /** Cost ratio: best (minimum) across all school types. -1 if uncovered. */
  getCostRatio(x: number, y: number): number {
    let best = -1;
    for (const type of SCHOOL_TYPES) {
      const r = this.coverageMaps[type].getCostRatio(x, y);
      if (r >= 0 && (best < 0 || r < best)) best = r;
    }
    return best;
  }

  /**
   * Returns the highest education level available at position (x, y).
   */
  getEducationLevel(x: number, y: number): EducationLevelResult {
    if (this.coverageMaps.university.hasCoverage(x, y)) return 'university';
    if (this.coverageMaps.highschool.hasCoverage(x, y)) return 'highschool';
    if (this.coverageMaps.elementary.hasCoverage(x, y)) return 'elementary';
    return 'none';
  }

  /** Total student capacity across all schools of a given type. */
  getTotalCapacity(type: SchoolType): number {
    return this.schools.filter(s => s.type === type).reduce((sum, s) => sum + s.capacity, 0);
  }

  getSchools(): readonly School[] {
    return this.schools;
  }

  /** Preview coverage for a potential school placement, merged with existing. */
  previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    type: SchoolType,
    facilityWidth?: number,
    facilityHeight?: number,
  ): Map<string, number> {
    const size = SCHOOL_SIZE[type];
    return this.coverageMaps[type].previewMerged(
      position, grid, SCHOOL_BUDGET[type],
      facilityWidth ?? size.width, facilityHeight ?? size.height,
    );
  }

  /** Get all covered cells across all school types (for overlay gradient). */
  getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    // Merge all three maps, taking min cost
    const merged = new Map<string, number>();
    for (const type of SCHOOL_TYPES) {
      const cells = this.coverageMaps[type].getCoveredCells();
      for (const [key, cost] of cells) {
        const existing = merged.get(key);
        if (existing === undefined || cost < existing) {
          merged.set(key, cost);
        }
      }
    }
    return merged;
  }

  /** Assign enrolled citizens to nearest school of their type (Euclidean). */
  updateSchoolLoads(enrolled: ReadonlyArray<EnrolledCitizen>): void {
    this.schoolEnrollment.clear();
    for (const s of this.schools) this.schoolEnrollment.set(s.id, 0);

    for (const c of enrolled) {
      const schoolType = SCHOOL_KEY_TO_TYPE[c.schoolKey];
      let nearestId = '';
      let nearestDist = Infinity;
      for (const s of this.schools) {
        if (s.type !== schoolType) continue;
        const dx = c.x - s.x;
        const dy = c.y - s.y;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) { nearestDist = dist; nearestId = s.id; }
      }
      if (nearestId) {
        this.schoolEnrollment.set(nearestId, (this.schoolEnrollment.get(nearestId) ?? 0) + 1);
      }
    }
  }

  /** Per-school enrolled student count (for UI display). */
  getSchoolEnrollment(schoolId: string): number {
    return this.schoolEnrollment.get(schoolId) ?? 0;
  }

  tick(): void {
    // Coverage and enrollment handled externally via SimulationLoop.
  }

  getMaintenanceCost(): number {
    return this.schools.length * EDUCATION.MAINTENANCE_PER_SCHOOL;
  }

  toJSON(): { schools: School[] } {
    return { schools: this.schools.map(s => ({ ...s })) };
  }

  static fromJSON(data: { schools: School[] }): EducationService {
    const service = new EducationService();
    for (const s of data.schools) {
      service.schools.push({ ...s });
    }
    service.nextId = recoverNextId(service.schools, 'school-');
    return service;
  }
}

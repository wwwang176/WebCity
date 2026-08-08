/**
 * SchoolService — a single school type (elementary/highschool/university)
 * backed by RoadCoverageService for rotation-aware coverage and connected tracking.
 */
import { RoadCoverageService } from './RoadCoverageService';
import { ROAD_COVERAGE } from './RoadCoverageFlood';
import type { SchoolType } from './EducationService';

export interface SchoolFacility {
  id: string;
  x: number;
  y: number;
  type: SchoolType;
  radius: number;
  capacity: number;
}

const SCHOOL_BUDGET: Record<SchoolType, number> = {
  elementary: ROAD_COVERAGE.EDUCATION_ELEMENTARY_BUDGET,
  highschool: ROAD_COVERAGE.EDUCATION_HIGHSCHOOL_BUDGET,
  university: ROAD_COVERAGE.EDUCATION_UNIVERSITY_BUDGET,
};

const SCHOOL_SIZE: Record<SchoolType, { width: number; height: number }> = {
  elementary: { width: 2, height: 2 },
  highschool: { width: 2, height: 3 },
  university: { width: 3, height: 3 },
};

const SCHOOL_PREFIX: Record<SchoolType, string> = {
  elementary: 'elem-',
  highschool: 'hs-',
  university: 'uni-',
};

export const DEFAULT_RADIUS: Record<SchoolType, number> = {
  elementary: 10,
  highschool: 12,
  university: 15,
};

export const DEFAULT_CAPACITY: Record<SchoolType, number> = {
  elementary: 400,
  highschool: 500,
  university: 800,
};

export const EDUCATION = {
  MAINTENANCE_PER_SCHOOL: 5,
} as const;

export class SchoolService extends RoadCoverageService<SchoolFacility> {
  protected readonly coverageBudget: number;
  protected readonly defaultFacilityWidth: number;
  protected readonly defaultFacilityHeight: number;
  protected readonly idPrefix: string;
  protected readonly maintenanceCostPerFacility = EDUCATION.MAINTENANCE_PER_SCHOOL;

  /** Per-school enrollment and demand tracking */
  private readonly enrollment = new Map<string, number>();
  private readonly demand = new Map<string, number>();

  constructor(readonly schoolType: SchoolType) {
    super();
    this.coverageBudget = SCHOOL_BUDGET[schoolType];
    const size = SCHOOL_SIZE[schoolType];
    this.defaultFacilityWidth = size.width;
    this.defaultFacilityHeight = size.height;
    this.idPrefix = SCHOOL_PREFIX[schoolType];
  }

  addSchool(x: number, y: number, radius?: number, capacity?: number): string {
    const id = this.generateId();
    this.pushFacility({
      id, x, y,
      type: this.schoolType,
      radius: radius ?? DEFAULT_RADIUS[this.schoolType],
      capacity: capacity ?? DEFAULT_CAPACITY[this.schoolType],
    });
    return id;
  }

  removeSchool(id: string): boolean {
    this.enrollment.delete(id);
    this.demand.delete(id);
    return this.removeFacilityById(id);
  }

  getSchools(): readonly SchoolFacility[] {
    return this.getFacilities();
  }

  /**
   * Places the city can actually offer.
   *
   * Coverage already excludes non-operational schools, but this fed
   * educateTick's capacity gate unfiltered — so a blacked-out school kept
   * providing places nobody could reach, and the ServicesPage advertised them.
   * Same shape as the hospital capacity fixed in BUG-100.
   */
  getTotalCapacity(): number {
    return this.getOperationalFacilities().reduce((sum, s) => sum + s.capacity, 0);
  }

  /** Assign enrollment and demand counts to nearest school (Euclidean). */
  updateLoads(
    enrolled: ReadonlyArray<{ x: number; y: number }>,
    eligible: ReadonlyArray<{ x: number; y: number }>,
  ): void {
    this.enrollment.clear();
    this.demand.clear();
    for (const s of this.getFacilities()) {
      this.enrollment.set(s.id, 0);
      this.demand.set(s.id, 0);
    }

    for (const c of enrolled) {
      const id = this.findNearest(c.x, c.y);
      if (id) this.enrollment.set(id, (this.enrollment.get(id) ?? 0) + 1);
    }

    for (const c of [...enrolled, ...eligible]) {
      const id = this.findNearest(c.x, c.y);
      if (id) this.demand.set(id, (this.demand.get(id) ?? 0) + 1);
    }
  }

  private findNearest(x: number, y: number): string | null {
    let nearestId = '';
    let nearestDist = Infinity;
    for (const s of this.getFacilities()) {
      const dx = x - s.x;
      const dy = y - s.y;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) { nearestDist = dist; nearestId = s.id; }
    }
    return nearestId || null;
  }

  getEnrollment(schoolId: string): number {
    return this.enrollment.get(schoolId) ?? 0;
  }

  getDemand(schoolId: string): number {
    return this.demand.get(schoolId) ?? 0;
  }

  toJSON(): SchoolFacility[] {
    return this.getFacilities().map(s => ({ ...s }));
  }

  loadFromArray(schools: SchoolFacility[]): void {
    for (const s of schools) {
      this.pushFacility({
        ...s,
        capacity: s.capacity ?? DEFAULT_CAPACITY[this.schoolType],
        radius: s.radius ?? DEFAULT_RADIUS[this.schoolType],
      });
    }
    this.restoreNextId();
  }
}

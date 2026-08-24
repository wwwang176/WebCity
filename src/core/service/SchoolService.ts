/**
 * SchoolService — a single school type (elementary/highschool/university)
 * backed by RoadCoverageService for rotation-aware coverage and connected tracking.
 */
import { RoadCoverageService } from './RoadCoverageService';
import { distributeWithSpillover } from './SpilloverLoadDistributor';
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
   *
   * Road connectivity is the other half of the same condition, and was missing:
   * coverage spreads along roads, so a school marooned with no road covers
   * nobody at all while its places were still counted.
   */
  getTotalCapacity(): number {
    return this.getActiveFacilities().reduce((sum, s) => sum + s.capacity, 0);
  }

  /**
   * Assign enrollment and demand counts to nearest school (Euclidean).
   *
   * `count` is how many students this cell stands for, defaulting to 1. Students in one building
   * at one school stage produce identical coordinates and pick the same nearest school, so the
   * caller counts them up before passing them in.
   */
  updateLoads(
    enrolled: ReadonlyArray<{ x: number; y: number; count?: number }>,
    eligible: ReadonlyArray<{ x: number; y: number; count?: number }>,
  ): void {
    // Nearest school first, spilling to the next when full — the hearse rule (BUG-365).
    // Recognising only the nearest crowds every student into one school and leaves the second
    // empty.
    //
    // Only schools that can take students count: `getActiveFacilities()` requires power, water
    // and a road connection, the same set `getTotalCapacity()` uses.
    const active = this.getActiveFacilities();
    const covering = (x: number, y: number) => this.getCoveringFacilityIds(x, y);
    const toDemand = (c: { x: number; y: number; count?: number }) =>
      ({ x: c.x, y: c.y, weight: c.count ?? 1 });

    // Both calls must be fed the same set of schools, or one school ends up with an impossible
    // combination such as 200 enrolled and 30 eligible.
    //
    // Replacing `active` above with `getFacilities()` is currently unobservable: `covering` only
    // names schools **that cover that cell**, coverage floods only out of operational
    // facilities, so an unpowered school never appears in the list, and the first call's return
    // value goes unused. That change is equivalent rather than untested. What actually enforces
    // this is the single `active` shared by both calls.
    distributeWithSpillover(active, enrolled.map(toDemand), this.enrollment, covering);
    distributeWithSpillover(
      active, [...enrolled, ...eligible].map(toDemand), this.demand, covering,
    );
  }

  getEnrollment(schoolId: string): number {
    return this.enrollment.get(schoolId) ?? 0;
  }

  /**
   * Load follows **how many want a place**, not how many are enrolled.
   *
   * Enrolment can never exceed capacity, so using it as the load keeps the ratio at or below 1
   * and a school with ten times the demand it can take looks exactly right.
   */
  protected override facilityLoadOf(id: string): { load: number; capacity: number } | null {
    const s = this.facilities.find(f => f.id === id);
    return s ? { load: this.getDemand(id), capacity: s.capacity } : null;
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

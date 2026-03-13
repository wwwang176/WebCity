import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';
import { RoadCoverageMap, ROAD_COVERAGE } from './RoadCoverageFlood';
import type { SizedGrid } from '../grid/GridHelpers';

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

export type EducationLevelResult = 'none' | SchoolType;

export class EducationService {
  private schools: School[] = [];
  private nextId = 1;
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

  /** Recompute road-distance coverage for all school types. */
  recalculateCoverage(grid: SizedGrid): void {
    const types: SchoolType[] = ['elementary', 'highschool', 'university'];
    for (const type of types) {
      const facilities = this.schools.filter(s => s.type === type);
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
    return this.coverageMaps.elementary.hasCoverage(x, y)
      || this.coverageMaps.highschool.hasCoverage(x, y)
      || this.coverageMaps.university.hasCoverage(x, y);
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
    for (const type of ['elementary', 'highschool', 'university'] as SchoolType[]) {
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

  tick(): void {
    // Future: track enrollment, education progress, etc.
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

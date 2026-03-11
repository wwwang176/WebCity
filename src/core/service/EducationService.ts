export type SchoolType = 'elementary' | 'highschool' | 'university';

export interface School {
  id: string;
  x: number;
  y: number;
  type: SchoolType;
  radius: number;
  capacity: number;
}

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

/** Education level ranking for comparison (higher = better). */
const LEVEL_RANK: Record<SchoolType | 'none', number> = {
  none: 0,
  elementary: 1,
  highschool: 2,
  university: 3,
};

export type EducationLevelResult = 'none' | SchoolType;

let nextId = 1;

export class EducationService {
  private schools: School[] = [];

  addSchool(
    x: number,
    y: number,
    type: SchoolType,
    radius?: number,
    capacity?: number,
  ): string {
    const id = `school-${nextId++}`;
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
    const idx = this.schools.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.schools.splice(idx, 1);
    }
  }

  /**
   * Returns true if position (x, y) is within the coverage radius of any
   * school of the given type. If type is omitted, checks all school types.
   */
  getCoverage(x: number, y: number, type?: SchoolType): boolean {
    for (const school of this.schools) {
      if (type !== undefined && school.type !== type) continue;
      const dist = Math.sqrt((x - school.x) ** 2 + (y - school.y) ** 2);
      if (dist < school.radius) return true;
    }
    return false;
  }

  /**
   * Returns the highest education level available at position (x, y).
   */
  getEducationLevel(x: number, y: number): EducationLevelResult {
    let best: EducationLevelResult = 'none';
    for (const school of this.schools) {
      const dist = Math.sqrt((x - school.x) ** 2 + (y - school.y) ** 2);
      if (dist < school.radius && LEVEL_RANK[school.type] > LEVEL_RANK[best]) {
        best = school.type;
      }
    }
    return best;
  }

  getSchools(): readonly School[] {
    return this.schools;
  }

  tick(): void {
    // Future: track enrollment, education progress, etc.
  }

  getMaintenanceCost(): number {
    return this.schools.length * 5;
  }

  toJSON(): { schools: School[] } {
    return { schools: this.schools.map(s => ({ ...s })) };
  }

  static fromJSON(data: { schools: School[] }): EducationService {
    const service = new EducationService();
    for (const s of data.schools) {
      service.schools.push({ ...s });
    }
    return service;
  }
}

import { isWithinEuclideanRadius } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';

export interface Park {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export const PARK = {
  LAND_VALUE_PER_PARK: 15,
  LAND_VALUE_CAP: 30,
  POLLUTION_PER_PARK: -20,
  POLLUTION_CAP: -40,
  HAPPINESS_PER_PARK: 5,
  HAPPINESS_CAP: 10,
  MAINTENANCE_PER_PARK: 2,
} as const;

export class ParkService {
  private parks: Park[] = [];
  private nextId = 1;

  addPark(x: number, y: number, radius = 5): string {
    const id = `park-${this.nextId++}`;
    this.parks.push({ id, x, y, radius });
    return id;
  }

  removePark(id: string): void {
    removeById(this.parks, id);
  }

  getParks(): readonly Park[] {
    return this.parks;
  }

  getCoverage(x: number, y: number): boolean {
    return this.parks.some(p => this.isInRange(p, x, y));
  }

  getLandValueBonus(x: number, y: number): number {
    const count = this.countCoveringParks(x, y);
    if (count === 0) return 0;
    return Math.min(count * PARK.LAND_VALUE_PER_PARK, PARK.LAND_VALUE_CAP);
  }

  getPollutionReduction(x: number, y: number): number {
    const count = this.countCoveringParks(x, y);
    if (count === 0) return 0;
    return Math.max(count * PARK.POLLUTION_PER_PARK, PARK.POLLUTION_CAP);
  }

  getHappinessBonus(x: number, y: number): number {
    const count = this.countCoveringParks(x, y);
    if (count === 0) return 0;
    return Math.min(count * PARK.HAPPINESS_PER_PARK, PARK.HAPPINESS_CAP);
  }

  tick(): void {
    // Placeholder for future park maintenance / decay logic
  }

  getMaintenanceCost(): number {
    return this.parks.length * PARK.MAINTENANCE_PER_PARK;
  }

  toJSON(): Park[] {
    return this.parks.map(p => ({ ...p }));
  }

  static fromJSON(data: Park[]): ParkService {
    const ps = new ParkService();
    for (const p of data) {
      ps.parks.push({ ...p });
    }
    ps.nextId = recoverNextId(ps.parks, 'park-');
    return ps;
  }

  private isInRange(park: Park, x: number, y: number): boolean {
    return isWithinEuclideanRadius(park.x, park.y, x, y, park.radius);
  }

  private countCoveringParks(x: number, y: number): number {
    let count = 0;
    for (const p of this.parks) {
      if (this.isInRange(p, x, y)) count++;
    }
    return count;
  }
}

import { isFootprintAdjacentToRoad, isWithinEuclideanRadius, type ReadableGrid } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';
import { isFacilityOperational, type UtilityChecker } from './FacilityOperational';

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
  DEFAULT_RADIUS: 5,
} as const;

export class ParkService {
  private parks: Park[] = [];
  private connectedParkIds = new Set<string>();
  private operationalParkIds: Set<string> | null = null;
  private nextId = 1;

  addPark(x: number, y: number, radius = PARK.DEFAULT_RADIUS): string {
    const id = `park-${this.nextId++}`;
    this.parks.push({ id, x, y, radius });
    this.connectedParkIds.add(id);
    return id;
  }

  removePark(id: string): void {
    this.connectedParkIds.delete(id);
    removeById(this.parks, id);
  }

  getParks(): readonly Park[] {
    return this.parks;
  }

  /** Update which parks are operational (have power + water). */
  updateOperationalStatus(isPowered: UtilityChecker, isWaterSupplied: UtilityChecker): void {
    this.operationalParkIds = new Set<string>();
    for (const p of this.parks) {
      if (isFacilityOperational(p.x, p.y, 'park', isPowered, isWaterSupplied)) {
        this.operationalParkIds.add(p.id);
      }
    }
  }

  private isParkOperational(id: string): boolean {
    return this.operationalParkIds === null || this.operationalParkIds.has(id);
  }

  getCoverage(x: number, y: number): boolean {
    return this.parks.some(p =>
      this.connectedParkIds.has(p.id) && this.isParkOperational(p.id) && this.isInRange(p, x, y),
    );
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

  /** Recompute which parks are adjacent to at least one road cell. */
  updateConnectedParks(grid: ReadableGrid): void {
    this.connectedParkIds.clear();
    for (const p of this.parks) {
      if (isFootprintAdjacentToRoad(grid, p.x, p.y, 1, 1)) {
        this.connectedParkIds.add(p.id);
      }
    }
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
      ps.parks.push({ ...p, radius: PARK.DEFAULT_RADIUS });
      ps.connectedParkIds.add(p.id);
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
      if (!this.connectedParkIds.has(p.id) || !this.isParkOperational(p.id)) continue;
      if (this.isInRange(p, x, y)) count++;
    }
    return count;
  }
}

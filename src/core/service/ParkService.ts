export interface Park {
  id: string;
  x: number;
  y: number;
  radius: number;
}

const LAND_VALUE_PER_PARK = 15;
const LAND_VALUE_CAP = 30;
const POLLUTION_PER_PARK = -20;
const POLLUTION_CAP = -40;
const HAPPINESS_PER_PARK = 5;
const HAPPINESS_CAP = 10;

let nextParkId = 1;

export class ParkService {
  private parks: Park[] = [];

  addPark(x: number, y: number, radius = 5): string {
    const id = `park-${nextParkId++}`;
    this.parks.push({ id, x, y, radius });
    return id;
  }

  removePark(id: string): void {
    const idx = this.parks.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.parks.splice(idx, 1);
    }
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
    return Math.min(count * LAND_VALUE_PER_PARK, LAND_VALUE_CAP);
  }

  getPollutionReduction(x: number, y: number): number {
    const count = this.countCoveringParks(x, y);
    if (count === 0) return 0;
    return Math.max(count * POLLUTION_PER_PARK, POLLUTION_CAP);
  }

  getHappinessBonus(x: number, y: number): number {
    const count = this.countCoveringParks(x, y);
    if (count === 0) return 0;
    return Math.min(count * HAPPINESS_PER_PARK, HAPPINESS_CAP);
  }

  tick(): void {
    // Placeholder for future park maintenance / decay logic
  }

  toJSON(): Park[] {
    return this.parks.map(p => ({ ...p }));
  }

  static fromJSON(data: Park[]): ParkService {
    const ps = new ParkService();
    for (const p of data) {
      ps.parks.push({ ...p });
    }
    return ps;
  }

  private isInRange(park: Park, x: number, y: number): boolean {
    const dx = x - park.x;
    const dy = y - park.y;
    return Math.sqrt(dx * dx + dy * dy) <= park.radius;
  }

  private countCoveringParks(x: number, y: number): number {
    let count = 0;
    for (const p of this.parks) {
      if (this.isInRange(p, x, y)) count++;
    }
    return count;
  }
}

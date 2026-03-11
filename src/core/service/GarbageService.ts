export type GarbageFacilityType = 'landfill' | 'incinerator';

export interface GarbageFacility {
  id: string;
  x: number;
  y: number;
  type: GarbageFacilityType;
  capacity: number;
  currentLoad: number;
}

const DEFAULT_CAPACITIES: Record<GarbageFacilityType, number> = {
  landfill: 1000,
  incinerator: 500,
};

/** Garbage service configuration constants */
export const GARBAGE = {
  /** Coverage radius in Manhattan distance for garbage collection trucks */
  COVERAGE_RANGE: 15,
  /** Fraction of current load that an incinerator burns each tick */
  INCINERATOR_BURN_RATE: 0.05,
  /** Garbage production: 1 unit per GARBAGE_PER_POP population */
  GARBAGE_PER_POP: 100,
  /** Maintenance cost per garbage facility per tick */
  MAINTENANCE_PER_FACILITY: 3,
  /** Max pollution penalty from garbage overflow */
  MAX_POLLUTION_PENALTY: 100,
  /** Overflow → pollution multiplier */
  OVERFLOW_POLLUTION_MULTIPLIER: 2,
  /** Load ratio above which a facility emits ground pollution */
  POLLUTION_LOAD_THRESHOLD: 0.5,
  /** Max pollution amount emitted per overloaded facility */
  POLLUTION_AMOUNT_SCALE: 40,
} as const;

let nextFacilityId = 1;

import type { PollutionSource } from '../environment/Pollution';

export class GarbageService {
  private facilities: GarbageFacility[] = [];
  private overflow = 0;

  addFacility(x: number, y: number, type: GarbageFacilityType, capacity?: number): string {
    const id = `garbage_${nextFacilityId++}`;
    this.facilities.push({
      id,
      x,
      y,
      type,
      capacity: capacity ?? DEFAULT_CAPACITIES[type],
      currentLoad: 0,
    });
    return id;
  }

  removeFacility(id: string): void {
    const idx = this.facilities.findIndex(f => f.id === id);
    if (idx !== -1) {
      const facility = this.facilities[idx]!;
      // Spill remaining load into overflow
      this.overflow += facility.currentLoad;
      this.facilities.splice(idx, 1);
    }
  }

  getCoverage(x: number, y: number): boolean {
    return this.facilities.some(f => {
      const dist = Math.abs(f.x - x) + Math.abs(f.y - y);
      return dist <= GARBAGE.COVERAGE_RANGE;
    });
  }

  tick(population: number): void {
    // 1. Produce garbage based on population
    const produced = Math.floor(population / GARBAGE.GARBAGE_PER_POP);

    // 2. Incinerators burn a fraction of their current load
    for (const f of this.facilities) {
      if (f.type === 'incinerator' && f.currentLoad > 0) {
        const burned = Math.max(1, Math.floor(f.currentLoad * GARBAGE.INCINERATOR_BURN_RATE));
        f.currentLoad = Math.max(0, f.currentLoad - burned);
      }
    }

    // 3. Distribute new garbage across facilities with remaining capacity
    let remaining = produced + this.overflow;
    this.overflow = 0;

    for (const f of this.facilities) {
      if (remaining <= 0) break;
      const space = f.capacity - f.currentLoad;
      if (space > 0) {
        const added = Math.min(space, remaining);
        f.currentLoad += added;
        remaining -= added;
      }
    }

    // 4. Anything left over goes to overflow
    if (remaining > 0) {
      this.overflow = remaining;
    }
  }

  getOverflow(): number {
    return this.overflow;
  }

  getPollutionPenalty(): number {
    if (this.overflow <= 0) return 0;
    // Pollution scales with overflow amount
    return Math.min(GARBAGE.MAX_POLLUTION_PENALTY, this.overflow * GARBAGE.OVERFLOW_POLLUTION_MULTIPLIER);
  }

  getTotalCapacity(): number {
    return this.facilities.reduce((sum, f) => sum + f.capacity, 0);
  }

  getCurrentLoad(): number {
    return this.facilities.reduce((sum, f) => sum + f.currentLoad, 0);
  }

  getFacilities(): readonly GarbageFacility[] {
    return this.facilities;
  }

  getMaintenanceCost(): number {
    return this.facilities.length * GARBAGE.MAINTENANCE_PER_FACILITY;
  }

  getPollutionSources(): PollutionSource[] {
    const sources: PollutionSource[] = [];
    for (const f of this.facilities) {
      const loadRatio = f.currentLoad / f.capacity;
      if (loadRatio > GARBAGE.POLLUTION_LOAD_THRESHOLD) {
        sources.push({ x: f.x, y: f.y, amount: Math.round(loadRatio * GARBAGE.POLLUTION_AMOUNT_SCALE), type: 'ground' });
      }
    }
    return sources;
  }

  toJSON(): {
    facilities: GarbageFacility[];
    overflow: number;
  } {
    return {
      facilities: this.facilities.map(f => ({ ...f })),
      overflow: this.overflow,
    };
  }

  static fromJSON(data: { facilities: GarbageFacility[]; overflow: number }): GarbageService {
    const gs = new GarbageService();
    gs.facilities = data.facilities.map(f => ({ ...f }));
    gs.overflow = data.overflow;
    // Ensure nextFacilityId stays ahead of restored IDs
    for (const f of gs.facilities) {
      const num = parseInt(f.id.replace('garbage_', ''), 10);
      if (!isNaN(num) && num >= nextFacilityId) {
        nextFacilityId = num + 1;
      }
    }
    return gs;
  }
}

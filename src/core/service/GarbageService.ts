import type { SizedGrid } from '../grid/GridHelpers';
import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import type { PollutionSource } from '../environment/Pollution';

export interface GarbageFacility {
  id: string;
  x: number;
  y: number;
  capacity: number;
  currentLoad: number;
}

/** Garbage service configuration constants */
export const GARBAGE = {
  /** Road-distance coverage budget for garbage collection trucks */
  SERVICE_BUDGET: ROAD_COVERAGE.GARBAGE_BUDGET,
  /** Default capacity per facility */
  DEFAULT_CAPACITY: 1000,
  /** Fraction of current load burned (incinerated) each tick */
  BURN_RATE: 0.05,
  /** Garbage production: 1 unit per GARBAGE_PER_POP population */
  GARBAGE_PER_POP: 100,
  /** Maintenance cost per garbage facility per tick */
  MAINTENANCE_PER_FACILITY: 3,
  /** Max pollution penalty from garbage overflow */
  MAX_POLLUTION_PENALTY: 100,
  /** Overflow → pollution multiplier */
  OVERFLOW_POLLUTION_MULTIPLIER: 2,
  /** Load ratio above which a facility emits extra ground pollution */
  POLLUTION_LOAD_THRESHOLD: 0.5,
  /** Max pollution amount emitted per overloaded facility */
  POLLUTION_AMOUNT_SCALE: 40,
  /** Base ground pollution always emitted by each facility */
  BASE_POLLUTION: 20,
  /** Pollution spread radius (Manhattan distance) for all garbage sources */
  POLLUTION_RADIUS: 5,
} as const;

export class GarbageService extends RoadCoverageService<GarbageFacility> {
  protected readonly coverageBudget = GARBAGE.SERVICE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'garbage_';
  protected readonly maintenanceCostPerFacility = GARBAGE.MAINTENANCE_PER_FACILITY;

  private overflow = 0;

  addFacility(x: number, y: number, capacity?: number): string {
    const id = this.generateId();
    this.pushFacility({
      id,
      x,
      y,
      capacity: capacity ?? GARBAGE.DEFAULT_CAPACITY,
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
      this.connectedFacilityIds.delete(id);
    }
  }

  tick(population: number): void {
    // 1. Produce garbage based on population
    const produced = Math.floor(population / GARBAGE.GARBAGE_PER_POP);

    // 2. Burn (incinerate) a fraction of current load at connected + operational facilities only
    for (const f of this.facilities) {
      if (!this.connectedFacilityIds.has(f.id) || !this.isFacilityOperationalById(f.id)) continue;
      if (f.currentLoad > 0) {
        const burned = Math.max(1, Math.floor(f.currentLoad * GARBAGE.BURN_RATE));
        f.currentLoad = Math.max(0, f.currentLoad - burned);
      }
    }

    // 3. Distribute new garbage across connected + operational facilities with remaining capacity
    let remaining = produced + this.overflow;
    this.overflow = 0;

    for (const f of this.facilities) {
      if (!this.connectedFacilityIds.has(f.id) || !this.isFacilityOperationalById(f.id)) continue;
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

  private forEachFacilityCell(f: GarbageFacility, fn: (cx: number, cy: number) => void): void {
    for (let dy = 0; dy < this.defaultFacilityHeight; dy++) {
      for (let dx = 0; dx < this.defaultFacilityWidth; dx++) {
        fn(f.x + dx, f.y + dy);
      }
    }
  }

  getPollutionSources(): PollutionSource[] {
    const sources: PollutionSource[] = [];
    const radius = GARBAGE.POLLUTION_RADIUS;
    // Only operational facilities emit pollution
    const operational = this.getOperationalFacilities();
    // Base pollution: every cell of every operational facility emits ground pollution
    for (const f of operational) {
      this.forEachFacilityCell(f, (cx, cy) => {
        sources.push({ x: cx, y: cy, amount: GARBAGE.BASE_POLLUTION, type: 'ground', radius });
      });
    }
    // Overload pollution: extra when load exceeds threshold
    for (const f of operational) {
      const loadRatio = f.currentLoad / f.capacity;
      if (loadRatio > GARBAGE.POLLUTION_LOAD_THRESHOLD) {
        const amount = Math.round(loadRatio * GARBAGE.POLLUTION_AMOUNT_SCALE);
        this.forEachFacilityCell(f, (cx, cy) => {
          sources.push({ x: cx, y: cy, amount, type: 'ground', radius });
        });
      }
    }
    // Overflow pollution: distributed evenly across operational facilities
    if (this.overflow > 0 && operational.length > 0) {
      const totalPenalty = this.getPollutionPenalty();
      const perFacility = Math.ceil(totalPenalty / operational.length);
      for (const f of operational) {
        this.forEachFacilityCell(f, (cx, cy) => {
          sources.push({ x: cx, y: cy, amount: perFacility, type: 'ground', radius });
        });
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
    gs.restoreNextId();
    return gs;
  }
}

import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';

export interface Cemetery {
  id: string;
  x: number;
  y: number;
  /** Max bodies that can be stored awaiting cremation */
  capacity: number;
  /** Bodies currently stored */
  used: number;
  /** Bodies cremated per tick */
  processRate: number;
  /** Rolling 30-day window of daily cremation counts */
  recentDaily: number[];
  /** Current write position in ring buffer */
  recentIndex: number;
  /** Cremations accumulated today (before advanceDay flush) */
  todayCremated: number;
  /** Per-cemetery pending deaths awaiting processing */
  pending: number;
}

interface DeathCareJSON {
  cemeteries: Cemetery[];
  pendingDeaths: number;
}

export const DEATH_CARE = {
  MAINTENANCE_PER_FACILITY: 2,
  DEFAULT_CAPACITY: 500,
  DEFAULT_PROCESS_RATE: 5,
} as const;

export class DeathCareService extends RoadCoverageService<Cemetery> {
  protected readonly coverageBudget = ROAD_COVERAGE.DEATHCARE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'cem-';
  protected readonly maintenanceCostPerFacility = DEATH_CARE.MAINTENANCE_PER_FACILITY;

  /** Deaths that occurred outside any cemetery coverage */
  private unassignedDeaths = 0;

  addCemetery(x: number, y: number, capacity = DEATH_CARE.DEFAULT_CAPACITY, processRate = DEATH_CARE.DEFAULT_PROCESS_RATE): string {
    const id = this.generateId();
    this.pushFacility({ id, x, y, capacity, used: 0, processRate, recentDaily: new Array(30).fill(0), recentIndex: 0, todayCremated: 0, pending: 0 });
    return id;
  }

  removeCemetery(id: string): boolean {
    return this.removeFacilityById(id);
  }

  /** Report a death at a specific location. Assigns to nearest covering cemetery. */
  reportDeath(x: number, y: number): void {
    if (!this.getCoverage(x, y)) {
      this.unassignedDeaths++;
      return;
    }
    // Find nearest cemetery by Euclidean distance
    let nearestCem: Cemetery | null = null;
    let nearestDist = Infinity;
    for (const cem of this.facilities) {
      const dx = x - cem.x;
      const dy = y - cem.y;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) { nearestDist = dist; nearestCem = cem; }
    }
    if (nearestCem) {
      nearestCem.pending++;
    } else {
      this.unassignedDeaths++;
    }
  }

  tick(): void {
    const totalPending = this.unassignedDeaths + this.facilities.reduce((s, c) => s + c.pending, 0);
    if (totalPending <= 0 && this.facilities.every(c => c.used === 0)) return;

    for (const cem of this.facilities) {
      // Skip facilities not connected to road or not operational (no power/water)
      if (!this.connectedFacilityIds.has(cem.id) || !this.isFacilityOperationalById(cem.id)) continue;

      let budget = cem.processRate;

      // Phase 1: Cremate this cemetery's pending deaths directly
      if (cem.pending > 0 && budget > 0) {
        const cremated = Math.min(cem.pending, budget);
        cem.pending -= cremated;
        budget -= cremated;
        cem.todayCremated += cremated;
      }

      // Phase 2: Cremate stored bodies
      if (cem.used > 0 && budget > 0) {
        const cremated = Math.min(cem.used, budget);
        cem.used -= cremated;
        cem.todayCremated += cremated;
      }

      // Phase 3: Store remaining pending deaths
      if (cem.pending > 0) {
        const available = cem.capacity - cem.used;
        if (available > 0) {
          const accepted = Math.min(cem.pending, available);
          cem.used += accepted;
          cem.pending -= accepted;
        }
      }
    }
  }

  /** Flush today's cremation count into the 30-day ring buffer and reset. Call once per game day. */
  advanceDay(): void {
    for (const cem of this.facilities) {
      cem.recentDaily[cem.recentIndex] = cem.todayCremated;
      cem.recentIndex = (cem.recentIndex + 1) % 30;
      cem.todayCremated = 0;
    }
  }

  /** Total unprocessed deaths (per-cemetery pending + unassigned). */
  getUnprocessed(): number {
    return this.unassignedDeaths + this.facilities.reduce((s, c) => s + c.pending, 0);
  }

  getHappinessPenalty(): number {
    return this.getUnprocessed() > 0 ? -20 : 0;
  }

  getCemeteries(): readonly Cemetery[] {
    return this.facilities;
  }

  toJSON(): DeathCareJSON {
    return {
      cemeteries: this.facilities.map(c => ({ ...c })),
      pendingDeaths: this.unassignedDeaths,
    };
  }

  static fromJSON(json: DeathCareJSON): DeathCareService {
    const service = new DeathCareService();
    service.facilities = json.cemeteries.map(c => ({
      ...c,
      recentDaily: c.recentDaily ?? new Array(30).fill(0),
      recentIndex: c.recentIndex ?? 0,
      todayCremated: c.todayCremated ?? 0,
      pending: (c as any).pending ?? 0,
    }));
    service.unassignedDeaths = json.pendingDeaths;
    service.restoreNextId();
    return service;
  }
}

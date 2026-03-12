import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';

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
}

interface DeathCareJSON {
  cemeteries: Cemetery[];
  pendingDeaths: number;
}

export const DEATH_CARE = {
  MAINTENANCE_PER_FACILITY: 2,
} as const;

export class DeathCareService {
  private cemeteries: Cemetery[] = [];
  private pendingDeaths = 0;
  private nextId = 1;

  addCemetery(x: number, y: number, capacity = 500, processRate = 5): string {
    const id = `cem-${this.nextId++}`;
    this.cemeteries.push({ id, x, y, capacity, used: 0, processRate, recentDaily: new Array(30).fill(0), recentIndex: 0, todayCremated: 0 });
    return id;
  }

  removeCemetery(id: string): boolean {
    return removeById(this.cemeteries, id);
  }

  reportDeath(): void {
    this.pendingDeaths++;
  }

  tick(): void {
    if (this.pendingDeaths <= 0 && this.cemeteries.every(c => c.used === 0)) return;

    for (const cem of this.cemeteries) {
      let budget = cem.processRate;

      // Phase 1: Cremate pending deaths directly
      if (this.pendingDeaths > 0 && budget > 0) {
        const cremated = Math.min(this.pendingDeaths, budget);
        this.pendingDeaths -= cremated;
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
      if (this.pendingDeaths > 0) {
        const available = cem.capacity - cem.used;
        if (available > 0) {
          const accepted = Math.min(this.pendingDeaths, available);
          cem.used += accepted;
          this.pendingDeaths -= accepted;
        }
      }
    }
  }

  /** Flush today's cremation count into the 30-day ring buffer and reset. Call once per game day. */
  advanceDay(): void {
    for (const cem of this.cemeteries) {
      cem.recentDaily[cem.recentIndex] = cem.todayCremated;
      cem.recentIndex = (cem.recentIndex + 1) % 30;
      cem.todayCremated = 0;
    }
  }

  getUnprocessed(): number {
    return this.pendingDeaths;
  }

  getHappinessPenalty(): number {
    return this.pendingDeaths > 0 ? -20 : 0;
  }

  getCemeteries(): readonly Cemetery[] {
    return this.cemeteries;
  }

  getMaintenanceCost(): number {
    return this.cemeteries.length * DEATH_CARE.MAINTENANCE_PER_FACILITY;
  }

  toJSON(): DeathCareJSON {
    return {
      cemeteries: this.cemeteries.map(c => ({ ...c })),
      pendingDeaths: this.pendingDeaths,
    };
  }

  static fromJSON(json: DeathCareJSON): DeathCareService {
    const service = new DeathCareService();
    service.cemeteries = json.cemeteries.map(c => ({
      ...c,
      recentDaily: c.recentDaily ?? new Array(30).fill(0),
      recentIndex: c.recentIndex ?? 0,
      todayCremated: c.todayCremated ?? 0,
    }));
    service.pendingDeaths = json.pendingDeaths;
    service.nextId = recoverNextId(service.cemeteries, 'cem-');
    return service;
  }
}

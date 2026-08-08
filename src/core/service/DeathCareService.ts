import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { GlobalCoverageService, type PendingItem } from './GlobalCoverageService';

/** A body waiting at a building for pickup. */
export type PendingDeath = PendingItem;

export interface Cemetery {
  id: string;
  x: number;
  y: number;
  /** Max bodies that can be stored awaiting cremation */
  capacity: number;
  /** Bodies currently stored (awaiting cremation) */
  currentLoad: number;
  /** Rolling 7-day window of daily cremation counts */
  recentDaily: number[];
  /** Current write position in ring buffer */
  recentIndex: number;
  /** Cremations accumulated today (before advanceDay flush) */
  todayCremated: number;
  /** Bodies received today (before advanceDay flush) */
  todayReceived: number;
  /** Rolling 7-day window of daily death counts received */
  deathDaily: number[];
  /** Current write position in death ring buffer */
  deathDailyIndex: number;
}

/** Current save schema — what toJSON() produces. */
interface DeathCareJSON {
  cemeteries: Cemetery[];
  pendingDeathQueue?: PendingDeath[];
}

/** fromJSON() input: current schema plus any legacy fields from older save versions. */
type DeathCareJSONInput = DeathCareJSON & {
  /** v0/v1 legacy: scalar death count, migrated to pendingDeathQueue on load. */
  pendingDeaths?: number;
};

export const DEATH_CARE = {
  MAINTENANCE_PER_FACILITY: 2,
  DEFAULT_CAPACITY: 50,
  /** Bodies cremated per tick per cemetery */
  CREMATION_RATE: 1,
  /** Max bodies collected per cemetery per service tick */
  COLLECTION_RATE: 3,
  /** Happiness penalty per body waiting in queue */
  HAPPINESS_PER_BODY: -10,
  /** After this many ticks, penalty per body increases */
  HEAVY_THRESHOLD: 30,
  /** Heavier happiness penalty per body after threshold */
  HEAVY_HAPPINESS_PER_BODY: -25,
  /** Ticks before a body decomposes and is removed (~12 game weeks) */
  DECOMPOSE_TICKS: 1800,
} as const;

export class DeathCareService extends GlobalCoverageService<Cemetery> {
  protected readonly coverageBudget = ROAD_COVERAGE.DEATHCARE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'cem-';
  protected readonly maintenanceCostPerFacility = DEATH_CARE.MAINTENANCE_PER_FACILITY;

  /** Queue of deaths waiting for pickup */
  private pendingDeathQueue: PendingDeath[] = [];

  /** City-wide death tracking: today's count + 7-day ring buffer */
  private todayDeaths = 0;
  private deathHistory: number[] = new Array(7).fill(0);
  private deathHistoryIndex = 0;

  addCemetery(x: number, y: number, capacity: number = DEATH_CARE.DEFAULT_CAPACITY): string {
    const id = this.generateId();
    this.pushFacility({
      id, x, y, capacity, currentLoad: 0,
      recentDaily: new Array(7).fill(0), recentIndex: 0, todayCremated: 0,
      todayReceived: 0,
      deathDaily: new Array(7).fill(0), deathDailyIndex: 0,
    });
    return id;
  }

  removeCemetery(id: string): boolean {
    this.removeDistanceMap(id);
    return this.removeFacilityById(id);
  }

  /** Report a death at a specific location. Adds to pending queue for pickup. */
  reportDeath(x: number, y: number): void {
    this.todayDeaths++;
    this.pendingDeathQueue.push({ x, y, waitTicks: 0 });
  }

  // ── Tick logic ────────────────────────────────────────────────────

  tick(): void {
    // Step 1: Increment wait counters; remove decomposed
    for (let i = this.pendingDeathQueue.length - 1; i >= 0; i--) {
      this.pendingDeathQueue[i]!.waitTicks++;
      if (this.pendingDeathQueue[i]!.waitTicks >= DEATH_CARE.DECOMPOSE_TICKS) {
        this.pendingDeathQueue.splice(i, 1);
      }
    }

    // Step 2: Collect bodies (weighted random by distance)
    this.collectPending(this.pendingDeathQueue, DEATH_CARE.COLLECTION_RATE);

    // Step 3: Cremate at cemeteries
    this.processCemeteries();
  }

  /** Remove all pending deaths at a specific position (building demolished/cleared). */
  clearPendingAt(x: number, y: number): void {
    for (let i = this.pendingDeathQueue.length - 1; i >= 0; i--) {
      const d = this.pendingDeathQueue[i]!;
      if (d.x === x && d.y === y) {
        this.pendingDeathQueue.splice(i, 1);
      }
    }
  }

  private processCemeteries(): void {
    for (const cem of this.facilities) {
      if (!this.connectedFacilityIds.has(cem.id) || !this.isFacilityOperationalById(cem.id)) continue;
      if (cem.currentLoad > 0) {
        const cremated = Math.min(cem.currentLoad, DEATH_CARE.CREMATION_RATE);
        cem.currentLoad -= cremated;
        cem.todayCremated += cremated;
      }
    }
  }

  // ── Day / stats / happiness ───────────────────────────────────────

  /** Flush today's counts into ring buffers and reset. Call once per game day. */
  advanceDay(): void {
    for (const cem of this.facilities) {
      cem.recentDaily[cem.recentIndex] = cem.todayCremated;
      cem.recentIndex = (cem.recentIndex + 1) % 7;
      cem.todayCremated = 0;
      cem.deathDaily[cem.deathDailyIndex] = cem.todayReceived;
      cem.deathDailyIndex = (cem.deathDailyIndex + 1) % 7;
      cem.todayReceived = 0;
    }
    this.deathHistory[this.deathHistoryIndex] = this.todayDeaths;
    this.deathHistoryIndex = (this.deathHistoryIndex + 1) % 7;
    this.todayDeaths = 0;
  }

  /** Total deaths in the last 7 days (city-wide). */
  getRecentDeaths(): number {
    return this.deathHistory.reduce((a, b) => a + b, 0);
  }

  /** Total cremations in the last 7 days (city-wide). */
  getRecentCremations(): number {
    let total = 0;
    for (const cem of this.facilities) {
      total += cem.recentDaily.reduce((a, b) => a + b, 0);
    }
    return total;
  }

  /** Total unprocessed deaths (queue + stored at cemeteries). */
  getUnprocessed(): number {
    return this.pendingDeathQueue.length + this.facilities.reduce((s, c) => s + c.currentLoad, 0);
  }

  /** Happiness penalty scaling with waiting body count and wait duration. */
  getHappinessPenalty(): number {
    const count = this.pendingDeathQueue.length;
    if (count === 0) return 0;
    let penalty = 0;
    for (const death of this.pendingDeathQueue) {
      penalty += death.waitTicks >= DEATH_CARE.HEAVY_THRESHOLD
        ? DEATH_CARE.HEAVY_HAPPINESS_PER_BODY
        : DEATH_CARE.HAPPINESS_PER_BODY;
    }
    return penalty;
  }

  /** Get the pending death queue (read-only, for UI/debugging). */
  getPendingDeathQueue(): readonly PendingDeath[] {
    return this.pendingDeathQueue;
  }

  getCemeteries(): readonly Cemetery[] {
    return this.facilities;
  }

  // ── Serialization ─────────────────────────────────────────────────

  toJSON(): DeathCareJSON {
    return {
      cemeteries: this.facilities.map(c => ({ ...c })),
      pendingDeathQueue: this.pendingDeathQueue.map(d => ({ ...d })),
    };
  }

  static fromJSON(json: DeathCareJSONInput): DeathCareService {
    const service = new DeathCareService();
    service.facilities = (json.cemeteries || []).map((c: any) => ({
      ...c,
      // New field: currentLoad (replaces legacy used + pending + inTransit)
      currentLoad: c.currentLoad ?? ((c.used ?? 0) + (c.pending ?? 0)),
      recentDaily: c.recentDaily?.length === 7 ? c.recentDaily : new Array(7).fill(0),
      recentIndex: c.recentIndex ?? 0,
      todayCremated: c.todayCremated ?? 0,
      todayReceived: c.todayReceived ?? 0,
      deathDaily: c.deathDaily?.length === 7 ? c.deathDaily : new Array(7).fill(0),
      deathDailyIndex: c.deathDailyIndex ?? 0,
    }));
    // New format: pendingDeathQueue array (PendingItem shape)
    if (Array.isArray(json.pendingDeathQueue)) {
      service.pendingDeathQueue = json.pendingDeathQueue.map((d: any) => ({
        x: d.x ?? 0,
        y: d.y ?? 0,
        waitTicks: d.waitTicks ?? 0,
      }));
    } else if (typeof json.pendingDeaths === 'number' && json.pendingDeaths > 0) {
      // Legacy migration: convert old pendingDeaths count to queue entries
      for (let i = 0; i < json.pendingDeaths; i++) {
        service.pendingDeathQueue.push({ x: 0, y: 0, waitTicks: 0 });
      }
    }
    service.restoreNextId();
    return service;
  }
}

import { ROAD_COVERAGE, roadFlood, expandCoverageToBuildings, expandFootprint } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import { toPosKey } from '../grid/GridHelpers';
import type { SizedGrid } from '../grid/GridHelpers';

export interface PendingDeath {
  x: number;
  y: number;
  cemeteryId: string | null;  // null = unassigned
  remainingTicks: number;     // countdown to arrival; -1 = unassigned
  waitTicks: number;          // total tick() calls spent in queue
}

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
  /** Rolling 7-day window of daily cremation counts */
  recentDaily: number[];
  /** Current write position in ring buffer */
  recentIndex: number;
  /** Cremations accumulated today (before advanceDay flush) */
  todayCremated: number;
  /** Per-cemetery pending deaths awaiting processing (at the cemetery) */
  pending: number;
  /** Deaths received today (before advanceDay flush) */
  todayReceived: number;
  /** Rolling 7-day window of daily death counts received */
  deathDaily: number[];
  /** Current write position in death ring buffer */
  deathDailyIndex: number;
  /** Hearses on the road heading to pick up bodies */
  inTransit: number;
}

interface DeathCareJSON {
  cemeteries: Cemetery[];
  pendingDeathQueue?: PendingDeath[];
  /** @deprecated Legacy field — converted to pendingDeathQueue on load */
  pendingDeaths?: number;
}

export const DEATH_CARE = {
  MAINTENANCE_PER_FACILITY: 2,
  DEFAULT_CAPACITY: 500,
  DEFAULT_PROCESS_RATE: 5,
  /** Road-cost units a hearse covers per service tick */
  HEARSE_SPEED: 5,
  /** Happiness penalty per body waiting in queue */
  HAPPINESS_PER_BODY: -10,
  /** After this many ticks, penalty per body increases */
  HEAVY_THRESHOLD: 30,
  /** Heavier happiness penalty per body after threshold */
  HEAVY_HAPPINESS_PER_BODY: -25,
  /** Ticks before a body decomposes and is removed (~12 game weeks) */
  DECOMPOSE_TICKS: 1800,
  /** Max hearses a cemetery can dispatch per service tick */
  HEARSE_DISPATCH_LIMIT: 3,
} as const;

export class DeathCareService extends RoadCoverageService<Cemetery> {
  protected readonly coverageBudget = ROAD_COVERAGE.DEATHCARE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'cem-';
  protected readonly maintenanceCostPerFacility = DEATH_CARE.MAINTENANCE_PER_FACILITY;

  /** Per-cemetery distance maps: cemeteryId → Map<posKey, roadCost> */
  private cemeteryDistanceMaps = new Map<string, Map<string, number>>();
  /** Merged min-distance map across all cemeteries (for coverage queries + overlay) */
  private mergedDistanceMap = new Map<string, number>();

  /** Queue of deaths waiting for hearse pickup */
  private pendingDeathQueue: PendingDeath[] = [];

  /** City-wide death tracking: today's count + 7-day ring buffer */
  private todayDeaths = 0;
  private deathHistory: number[] = new Array(7).fill(0);
  private deathHistoryIndex = 0;

  addCemetery(x: number, y: number, capacity = DEATH_CARE.DEFAULT_CAPACITY, processRate = DEATH_CARE.DEFAULT_PROCESS_RATE): string {
    const id = this.generateId();
    this.pushFacility({
      id, x, y, capacity, used: 0, processRate,
      recentDaily: new Array(7).fill(0), recentIndex: 0, todayCremated: 0,
      pending: 0, todayReceived: 0,
      deathDaily: new Array(7).fill(0), deathDailyIndex: 0,
      inTransit: 0,
    });
    return id;
  }

  removeCemetery(id: string): boolean {
    // Return in-transit deaths assigned to this cemetery back to unassigned
    const cem = this.facilities.find(c => c.id === id);
    if (cem) {
      for (const death of this.pendingDeathQueue) {
        if (death.cemeteryId === id) {
          death.cemeteryId = null;
          death.remainingTicks = -1;
        }
      }
    }
    this.cemeteryDistanceMaps.delete(id);
    return this.removeFacilityById(id);
  }

  /** Report a death at a specific location. Adds to pending queue for hearse pickup. */
  reportDeath(x: number, y: number): void {
    this.todayDeaths++;
    this.pendingDeathQueue.push({ x, y, cemeteryId: null, remainingTicks: -1, waitTicks: 0 });
  }

  // ── Coverage overrides (global, per-cemetery BFS) ─────────────────

  /** Override: compute per-cemetery BFS with unlimited range. */
  override recalculateCoverage(grid: SizedGrid): void {
    this.updateConnectedFacilities(grid);
    this.recomputeDistanceMaps(grid);
  }

  private recomputeDistanceMaps(grid: SizedGrid): void {
    this.cemeteryDistanceMaps.clear();
    this.mergedDistanceMap.clear();

    const active = this.operationalIds
      ? this.facilities.filter(f => this.operationalIds!.has(f.id))
      : this.facilities;

    for (const cem of active) {
      if (!this.connectedFacilityIds.has(cem.id)) continue;
      const positions = expandFootprint(cem.x, cem.y, this.defaultFacilityWidth, this.defaultFacilityHeight);
      const roadCov = roadFlood(grid, positions, Infinity);
      const fullCov = expandCoverageToBuildings(grid, roadCov);
      this.cemeteryDistanceMaps.set(cem.id, fullCov);

      for (const [key, cost] of fullCov) {
        const prev = this.mergedDistanceMap.get(key);
        if (prev === undefined || cost < prev) {
          this.mergedDistanceMap.set(key, cost);
        }
      }
    }
  }

  /** Override: covered if any cemetery can reach via road. */
  override getCoverage(x: number, y: number): boolean {
    return this.mergedDistanceMap.has(toPosKey(x, y));
  }

  /** Override: cost ratio normalized against reference budget (0.0 = nearest, 1.0 = farthest). */
  override getCostRatio(x: number, y: number): number {
    const cost = this.mergedDistanceMap.get(toPosKey(x, y));
    if (cost === undefined) return -1;
    return Math.min(cost / ROAD_COVERAGE.DEATHCARE_BUDGET, 1.0);
  }

  /** Override: return merged distance map for overlay rendering. */
  override getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    return this.mergedDistanceMap;
  }

  /** Override: preview floods entire road network (global coverage).
   *  Rendering uses DEATHCARE_BUDGET as gradient reference — near=green, far=red. */
  override previewCoverage(
    position: { x: number; y: number },
    grid: SizedGrid,
    facilityWidth = this.defaultFacilityWidth,
    facilityHeight = this.defaultFacilityHeight,
  ): Map<string, number> {
    const positions = expandFootprint(position.x, position.y, facilityWidth, facilityHeight);
    const roadCov = roadFlood(grid, positions, Infinity);
    return expandCoverageToBuildings(grid, roadCov);
  }

  // ── Tick logic ────────────────────────────────────────────────────

  tick(): void {
    // Step 1: Increment wait counters + try to assign unassigned deaths
    // Track per-cemetery dispatch count to enforce HEARSE_DISPATCH_LIMIT
    const dispatchCount = new Map<string, number>();
    for (const death of this.pendingDeathQueue) {
      death.waitTicks++;
      if (death.cemeteryId === null) {
        this.tryAssignDeath(death, dispatchCount);
      }
    }

    // Step 2: Tick down assigned deaths; collect arrivals + decomposed bodies
    const remove: number[] = [];
    for (let i = 0; i < this.pendingDeathQueue.length; i++) {
      const death = this.pendingDeathQueue[i]!;

      // Decompose: body has waited too long → remove silently
      if (death.waitTicks >= DEATH_CARE.DECOMPOSE_TICKS) {
        if (death.cemeteryId !== null) {
          const cem = this.facilities.find(c => c.id === death.cemeteryId);
          if (cem) cem.inTransit = Math.max(0, cem.inTransit - 1);
        }
        remove.push(i);
        continue;
      }

      if (death.cemeteryId === null) continue;
      death.remainingTicks--;
      if (death.remainingTicks <= 0) {
        const cem = this.facilities.find(c => c.id === death.cemeteryId);
        if (cem) {
          cem.pending++;
          cem.todayReceived++;
          cem.inTransit = Math.max(0, cem.inTransit - 1);
        }
        remove.push(i);
      }
    }

    // Remove arrived + decomposed (reverse to preserve indices)
    for (let i = remove.length - 1; i >= 0; i--) {
      this.pendingDeathQueue.splice(remove[i]!, 1);
    }

    // Step 3: Process at cemeteries (3-phase)
    this.processCemeteries();
  }

  /** Remove all pending deaths at a specific position (building demolished/cleared). */
  clearPendingAt(x: number, y: number): void {
    for (let i = this.pendingDeathQueue.length - 1; i >= 0; i--) {
      const d = this.pendingDeathQueue[i]!;
      if (d.x === x && d.y === y) {
        if (d.cemeteryId !== null) {
          const cem = this.facilities.find(c => c.id === d.cemeteryId);
          if (cem) cem.inTransit = Math.max(0, cem.inTransit - 1);
        }
        this.pendingDeathQueue.splice(i, 1);
      }
    }
  }

  private processCemeteries(): void {
    for (const cem of this.facilities) {
      if (!this.connectedFacilityIds.has(cem.id) || !this.isFacilityOperationalById(cem.id)) continue;

      let budget = cem.processRate;

      // Phase 1: Cremate pending deaths at cemetery
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

      // Phase 3: Store remaining pending in cemetery storage
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

  /** Try to assign a pending death to the nearest cemetery with available capacity and dispatch slots. */
  private tryAssignDeath(death: PendingDeath, dispatchCount: Map<string, number>): void {
    const posKey = toPosKey(death.x, death.y);
    let bestCem: Cemetery | null = null;
    let bestCost = Infinity;

    for (const cem of this.facilities) {
      if (!this.connectedFacilityIds.has(cem.id) || !this.isFacilityOperationalById(cem.id)) continue;
      if (cem.used + cem.pending + cem.inTransit >= cem.capacity) continue;
      // Enforce per-tick dispatch limit
      if ((dispatchCount.get(cem.id) ?? 0) >= DEATH_CARE.HEARSE_DISPATCH_LIMIT) continue;

      const distMap = this.cemeteryDistanceMaps.get(cem.id);
      if (!distMap) continue;
      const cost = distMap.get(posKey);
      if (cost === undefined) continue;
      if (cost < bestCost) {
        bestCost = cost;
        bestCem = cem;
      }
    }

    if (bestCem) {
      death.cemeteryId = bestCem.id;
      death.remainingTicks = Math.max(1, Math.ceil(bestCost / DEATH_CARE.HEARSE_SPEED));
      bestCem.inTransit++;
      dispatchCount.set(bestCem.id, (dispatchCount.get(bestCem.id) ?? 0) + 1);
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

  /** Total unprocessed deaths (queue + pending at cemeteries). */
  getUnprocessed(): number {
    return this.pendingDeathQueue.length + this.facilities.reduce((s, c) => s + c.pending, 0);
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

  static fromJSON(json: DeathCareJSON): DeathCareService {
    const service = new DeathCareService();
    service.facilities = (json.cemeteries || []).map((c: any) => ({
      ...c,
      recentDaily: c.recentDaily?.length === 7 ? c.recentDaily : new Array(7).fill(0),
      recentIndex: c.recentIndex ?? 0,
      todayCremated: c.todayCremated ?? 0,
      pending: c.pending ?? 0,
      todayReceived: c.todayReceived ?? 0,
      deathDaily: c.deathDaily?.length === 7 ? c.deathDaily : new Array(7).fill(0),
      deathDailyIndex: c.deathDailyIndex ?? 0,
      inTransit: c.inTransit ?? 0,
    }));
    // New format: pendingDeathQueue array
    if (Array.isArray(json.pendingDeathQueue)) {
      service.pendingDeathQueue = json.pendingDeathQueue.map(d => ({
        ...d,
        waitTicks: d.waitTicks ?? 0,
      }));
    } else if (typeof json.pendingDeaths === 'number' && json.pendingDeaths > 0) {
      // Legacy migration: convert old pendingDeaths count to queue entries
      for (let i = 0; i < json.pendingDeaths; i++) {
        service.pendingDeathQueue.push({ x: 0, y: 0, cemeteryId: null, remainingTicks: -1, waitTicks: 0 });
      }
    }
    service.restoreNextId();
    return service;
  }
}

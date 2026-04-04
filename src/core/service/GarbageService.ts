import { ROAD_COVERAGE, roadFlood, expandCoverageToBuildings, expandFootprint } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import { toPosKey } from '../grid/GridHelpers';
import type { SizedGrid } from '../grid/GridHelpers';
import type { PollutionSource } from '../environment/Pollution';
import { SIMULATION } from '../simulation/SimulationConstants';

export interface PendingGarbage {
  x: number;
  y: number;
  facilityId: string | null;   // null = unassigned
  remainingTicks: number;      // countdown to arrival; -1 = unassigned
  waitTicks: number;           // total tick() calls spent in queue
}

export interface GarbageFacility {
  id: string;
  x: number;
  y: number;
  capacity: number;
  currentLoad: number;
  /** Trucks on the road heading to pick up garbage */
  inTransit: number;
  /** Garbage burned today (before advanceDay flush) */
  todayBurned: number;
  /** Rolling 7-day window of daily burn counts */
  burnDaily: number[];
  /** Current write position in burn ring buffer */
  burnDailyIndex: number;
  /** Garbage received today (before advanceDay flush) */
  todayReceived: number;
  /** Rolling 7-day window of daily received counts */
  receivedDaily: number[];
  /** Current write position in received ring buffer */
  receivedDailyIndex: number;
}

/** Per-zone garbage production rates: base per building + perCapita per resident/worker */
export const GARBAGE_PRODUCTION = {
  RESIDENTIAL: { base: 0.05, perCapita: 0.005 },
  COMMERCIAL:  { base: 0.1,  perCapita: 0.005 },
  INDUSTRIAL:  { base: 0.2,  perCapita: 0.01  },
  OFFICE:      { base: 0.02, perCapita: 0.002 },
} as const;

/** Garbage service configuration constants */
export const GARBAGE = {
  /** Road-distance coverage budget (used for overlay gradient reference, not range limit) */
  SERVICE_BUDGET: ROAD_COVERAGE.GARBAGE_BUDGET,
  /** Default capacity per facility */
  DEFAULT_CAPACITY: 1000,
  /** Fixed burn rate: units incinerated per tick per facility */
  BURN_RATE: 5,
  /** Maintenance cost per garbage facility per tick */
  MAINTENANCE_PER_FACILITY: 3,
  /** Max pollution penalty from uncollected garbage */
  MAX_POLLUTION_PENALTY: 100,
  /** Uncollected → pollution multiplier */
  UNCOLLECTED_POLLUTION_MULTIPLIER: 2,
  /** Load ratio above which a facility emits extra ground pollution */
  POLLUTION_LOAD_THRESHOLD: 0.5,
  /** Max pollution amount emitted per overloaded facility */
  POLLUTION_AMOUNT_SCALE: 40,
  /** Base ground pollution always emitted by each facility */
  BASE_POLLUTION: 20,
  /** Pollution spread radius (Manhattan distance) for all garbage sources */
  POLLUTION_RADIUS: 5,
  /** Road-cost units a truck covers per service tick */
  TRUCK_SPEED: 10,
  /** Total garbage trucks per facility */
  TRUCK_COUNT: 5,
  /** Happiness penalty per garbage bag waiting in queue */
  HAPPINESS_PER_BAG: -3,
  /** After this many ticks, penalty per bag increases */
  HEAVY_THRESHOLD: 30,
  /** Heavier happiness penalty per bag after threshold */
  HEAVY_HAPPINESS_PER_BAG: -8,
  /** Ticks before uncollected garbage decomposes (reduces itself but pollutes) */
  DECOMPOSE_TICKS: 600,
} as const;

interface GarbageJSON {
  facilities: GarbageFacility[];
  pendingGarbageQueue?: PendingGarbage[];
  garbageAccumulators?: Record<string, number>;
  /** @deprecated Legacy field — converted to queue on load */
  overflow?: number;
}

export class GarbageService extends RoadCoverageService<GarbageFacility> {
  protected readonly coverageBudget = GARBAGE.SERVICE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'garbage_';
  protected readonly maintenanceCostPerFacility = GARBAGE.MAINTENANCE_PER_FACILITY;

  /** Per-facility distance maps: facilityId → Map<posKey, roadCost> */
  private facilityDistanceMaps = new Map<string, Map<string, number>>();
  /** Merged min-distance map across all facilities */
  private mergedDistanceMap = new Map<string, number>();

  /** Queue of garbage bags waiting for truck pickup */
  private pendingGarbageQueue: PendingGarbage[] = [];

  /** Per-building fractional garbage accumulator */
  private garbageAccumulators = new Map<string, number>();

  /** City-wide tracking */
  private todayProduced = 0;
  private todayBurned = 0;
  private producedHistory: number[] = new Array(7).fill(0);
  private burnedHistory: number[] = new Array(7).fill(0);
  private historyIndex = 0;

  addFacility(x: number, y: number, capacity?: number): string {
    const id = this.generateId();
    this.pushFacility({
      id, x, y,
      capacity: capacity ?? GARBAGE.DEFAULT_CAPACITY,
      currentLoad: 0,
      inTransit: 0,
      todayBurned: 0,
      burnDaily: new Array(7).fill(0),
      burnDailyIndex: 0,
      todayReceived: 0,
      receivedDaily: new Array(7).fill(0),
      receivedDailyIndex: 0,
    });
    return id;
  }

  removeFacility(id: string): void {
    const fac = this.facilities.find(f => f.id === id);
    if (fac) {
      // Return in-transit garbage assigned to this facility back to unassigned
      for (const g of this.pendingGarbageQueue) {
        if (g.facilityId === id) {
          g.facilityId = null;
          g.remainingTicks = -1;
        }
      }
    }
    this.facilityDistanceMaps.delete(id);
    const idx = this.facilities.findIndex(f => f.id === id);
    if (idx !== -1) {
      this.facilities.splice(idx, 1);
      this.connectedFacilityIds.delete(id);
    }
  }

  // ── Per-building garbage reporting ─────────────────────────────────

  /** Report garbage produced at a specific building. Accumulates fractionally; emits queue entry at ≥1. */
  reportGarbage(x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    this.todayProduced += amount;
    const key = toPosKey(x, y);
    const acc = (this.garbageAccumulators.get(key) ?? 0) + amount;
    if (acc >= 1) {
      const bags = Math.floor(acc);
      this.garbageAccumulators.set(key, acc - bags);
      for (let i = 0; i < bags; i++) {
        this.pendingGarbageQueue.push({ x, y, facilityId: null, remainingTicks: -1, waitTicks: 0 });
      }
    } else {
      this.garbageAccumulators.set(key, acc);
    }
  }

  // ── Coverage overrides (global, per-facility BFS) ──────────────────

  override recalculateCoverage(grid: SizedGrid): void {
    this.updateConnectedFacilities(grid);
    this.recomputeDistanceMaps(grid);
  }

  private recomputeDistanceMaps(grid: SizedGrid): void {
    this.facilityDistanceMaps.clear();
    this.mergedDistanceMap.clear();

    const active = this.operationalIds
      ? this.facilities.filter(f => this.operationalIds!.has(f.id))
      : this.facilities;

    for (const fac of active) {
      if (!this.connectedFacilityIds.has(fac.id)) continue;
      const positions = expandFootprint(fac.x, fac.y, this.defaultFacilityWidth, this.defaultFacilityHeight);
      const roadCov = roadFlood(grid, positions, Infinity);
      const fullCov = expandCoverageToBuildings(grid, roadCov);
      this.facilityDistanceMaps.set(fac.id, fullCov);

      for (const [key, cost] of fullCov) {
        const prev = this.mergedDistanceMap.get(key);
        if (prev === undefined || cost < prev) {
          this.mergedDistanceMap.set(key, cost);
        }
      }
    }
  }

  override getCoverage(x: number, y: number): boolean {
    return this.mergedDistanceMap.has(toPosKey(x, y));
  }

  override getCostRatio(x: number, y: number): number {
    const cost = this.mergedDistanceMap.get(toPosKey(x, y));
    if (cost === undefined) return -1;
    return Math.min(cost / GARBAGE.SERVICE_BUDGET, 1.0);
  }

  override getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    return this.mergedDistanceMap;
  }

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
    // Step 1: Increment wait counters + try to assign unassigned bags
    for (const bag of this.pendingGarbageQueue) {
      bag.waitTicks++;
      if (bag.facilityId === null) {
        this.tryAssignBag(bag);
      }
    }

    // Step 2: Tick down assigned bags; collect arrivals + decomposed
    const remove: number[] = [];
    for (let i = 0; i < this.pendingGarbageQueue.length; i++) {
      const bag = this.pendingGarbageQueue[i]!;

      // Decompose: garbage has waited too long → remove (pollution already applied via penalty)
      if (bag.waitTicks >= GARBAGE.DECOMPOSE_TICKS) {
        if (bag.facilityId !== null) {
          const fac = this.facilities.find(f => f.id === bag.facilityId);
          if (fac) fac.inTransit = Math.max(0, fac.inTransit - 1);
        }
        remove.push(i);
        continue;
      }

      if (bag.facilityId === null) continue;
      bag.remainingTicks -= SIMULATION.SLOW_TICK_INTERVAL;
      if (bag.remainingTicks <= 0) {
        const fac = this.facilities.find(f => f.id === bag.facilityId);
        if (fac) {
          fac.currentLoad++;
          fac.todayReceived++;
          fac.inTransit = Math.max(0, fac.inTransit - 1);
        }
        remove.push(i);
      }
    }

    // Remove arrived + decomposed (reverse to preserve indices)
    for (let i = remove.length - 1; i >= 0; i--) {
      this.pendingGarbageQueue.splice(remove[i]!, 1);
    }

    // Step 3: Process at facilities (burn)
    this.processFacilities();
  }

  /** Remove all pending garbage at a specific position (building demolished/cleared). */
  clearPendingAt(x: number, y: number): void {
    for (let i = this.pendingGarbageQueue.length - 1; i >= 0; i--) {
      const g = this.pendingGarbageQueue[i]!;
      if (g.x === x && g.y === y) {
        if (g.facilityId !== null) {
          const fac = this.facilities.find(f => f.id === g.facilityId);
          if (fac) fac.inTransit = Math.max(0, fac.inTransit - 1);
        }
        this.pendingGarbageQueue.splice(i, 1);
      }
    }
    this.garbageAccumulators.delete(toPosKey(x, y));
  }

  private processFacilities(): void {
    for (const fac of this.facilities) {
      if (!this.connectedFacilityIds.has(fac.id) || !this.isFacilityOperationalById(fac.id)) continue;
      if (fac.currentLoad > 0) {
        const burned = Math.min(fac.currentLoad, GARBAGE.BURN_RATE);
        fac.currentLoad -= burned;
        fac.todayBurned += burned;
        this.todayBurned += burned;
      }
    }
  }

  private tryAssignBag(bag: PendingGarbage): void {
    const posKey = toPosKey(bag.x, bag.y);
    let bestFac: GarbageFacility | null = null;
    let bestCost = Infinity;

    for (const fac of this.facilities) {
      if (!this.connectedFacilityIds.has(fac.id) || !this.isFacilityOperationalById(fac.id)) continue;
      if (fac.currentLoad + fac.inTransit >= fac.capacity) continue;
      if (fac.inTransit >= GARBAGE.TRUCK_COUNT) continue;

      const distMap = this.facilityDistanceMaps.get(fac.id);
      if (!distMap) continue;
      const cost = distMap.get(posKey);
      if (cost === undefined) continue;
      if (cost < bestCost) {
        bestCost = cost;
        bestFac = fac;
      }
    }

    if (bestFac) {
      bag.facilityId = bestFac.id;
      bag.remainingTicks = Math.max(1, Math.ceil(bestCost * SIMULATION.SLOW_TICK_INTERVAL / GARBAGE.TRUCK_SPEED));
      bestFac.inTransit++;
    }
  }

  // ── Day / stats / happiness ───────────────────────────────────────

  advanceDay(): void {
    for (const fac of this.facilities) {
      fac.burnDaily[fac.burnDailyIndex] = fac.todayBurned;
      fac.burnDailyIndex = (fac.burnDailyIndex + 1) % 7;
      fac.todayBurned = 0;
      fac.receivedDaily[fac.receivedDailyIndex] = fac.todayReceived;
      fac.receivedDailyIndex = (fac.receivedDailyIndex + 1) % 7;
      fac.todayReceived = 0;
    }
    this.producedHistory[this.historyIndex] = this.todayProduced;
    this.burnedHistory[this.historyIndex] = this.todayBurned;
    this.historyIndex = (this.historyIndex + 1) % 7;
    this.todayProduced = 0;
    this.todayBurned = 0;
  }

  getProducedPerWeek(): number {
    return this.producedHistory.reduce((a, b) => a + b, 0);
  }

  getBurnedPerWeek(): number {
    return this.burnedHistory.reduce((a, b) => a + b, 0);
  }

  /** Total uncollected garbage (queue + load at facilities). */
  getUncollected(): number {
    return this.pendingGarbageQueue.length;
  }

  /** Happiness penalty scaling with waiting bag count and wait duration. */
  getHappinessPenalty(): number {
    const count = this.pendingGarbageQueue.length;
    if (count === 0) return 0;
    let penalty = 0;
    for (const bag of this.pendingGarbageQueue) {
      penalty += bag.waitTicks >= GARBAGE.HEAVY_THRESHOLD
        ? GARBAGE.HEAVY_HAPPINESS_PER_BAG
        : GARBAGE.HAPPINESS_PER_BAG;
    }
    return penalty;
  }

  /** Pollution penalty from uncollected garbage in queue. */
  getPollutionPenalty(): number {
    const uncollected = this.pendingGarbageQueue.length;
    if (uncollected <= 0) return 0;
    return Math.min(GARBAGE.MAX_POLLUTION_PENALTY, uncollected * GARBAGE.UNCOLLECTED_POLLUTION_MULTIPLIER);
  }

  getTotalCapacity(): number {
    return this.facilities.reduce((sum, f) => sum + f.capacity, 0);
  }

  getCurrentLoad(): number {
    return this.facilities.reduce((sum, f) => sum + f.currentLoad, 0);
  }

  /** Get the pending garbage queue (read-only, for UI/debugging). */
  getPendingGarbageQueue(): readonly PendingGarbage[] {
    return this.pendingGarbageQueue;
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
    const operational = this.getOperationalFacilities();
    // Base pollution: every cell of every operational facility emits ground pollution
    for (const f of operational) {
      this.forEachFacilityCell(f, (cx, cy) => {
        sources.push({ x: cx, y: cy, amount: GARBAGE.BASE_POLLUTION, type: 'ground', radius });
      });
    }
    // Overload pollution: extra when load exceeds threshold
    for (const f of operational) {
      const loadRatio = f.capacity > 0 ? f.currentLoad / f.capacity : 0;
      if (loadRatio > GARBAGE.POLLUTION_LOAD_THRESHOLD) {
        const amount = Math.round(loadRatio * GARBAGE.POLLUTION_AMOUNT_SCALE);
        this.forEachFacilityCell(f, (cx, cy) => {
          sources.push({ x: cx, y: cy, amount, type: 'ground', radius });
        });
      }
    }
    // Uncollected pollution: distributed evenly across operational facilities
    const uncollectedPenalty = this.getPollutionPenalty();
    if (uncollectedPenalty > 0 && operational.length > 0) {
      const perFacility = Math.ceil(uncollectedPenalty / operational.length);
      for (const f of operational) {
        this.forEachFacilityCell(f, (cx, cy) => {
          sources.push({ x: cx, y: cy, amount: perFacility, type: 'ground', radius });
        });
      }
    }
    return sources;
  }

  // ── Serialization ─────────────────────────────────────────────────

  toJSON(): GarbageJSON {
    const accObj: Record<string, number> = {};
    for (const [k, v] of this.garbageAccumulators) {
      if (v > 0) accObj[k] = v;
    }
    return {
      facilities: this.facilities.map(f => ({ ...f })),
      pendingGarbageQueue: this.pendingGarbageQueue.map(g => ({ ...g })),
      garbageAccumulators: accObj,
    };
  }

  static fromJSON(data: GarbageJSON): GarbageService {
    const gs = new GarbageService();
    gs.facilities = (data.facilities || []).map((f: any) => ({
      ...f,
      currentLoad: f.currentLoad ?? 0,
      inTransit: f.inTransit ?? 0,
      todayBurned: f.todayBurned ?? 0,
      burnDaily: f.burnDaily?.length === 7 ? f.burnDaily : new Array(7).fill(0),
      burnDailyIndex: f.burnDailyIndex ?? 0,
      todayReceived: f.todayReceived ?? 0,
      receivedDaily: f.receivedDaily?.length === 7 ? f.receivedDaily : new Array(7).fill(0),
      receivedDailyIndex: f.receivedDailyIndex ?? 0,
    }));
    // New format
    if (Array.isArray(data.pendingGarbageQueue)) {
      gs.pendingGarbageQueue = data.pendingGarbageQueue.map(g => ({
        ...g,
        waitTicks: g.waitTicks ?? 0,
      }));
    } else if (typeof data.overflow === 'number' && data.overflow > 0) {
      // Legacy migration: convert overflow to unassigned queue entries at (0,0)
      const bags = Math.floor(data.overflow);
      for (let i = 0; i < bags; i++) {
        gs.pendingGarbageQueue.push({ x: 0, y: 0, facilityId: null, remainingTicks: -1, waitTicks: 0 });
      }
    }
    if (data.garbageAccumulators) {
      for (const [k, v] of Object.entries(data.garbageAccumulators)) {
        gs.garbageAccumulators.set(k, v);
      }
    }
    gs.restoreNextId();
    return gs;
  }
}

import { ROAD_COVERAGE, roadFlood, expandCoverageToBuildings, expandFootprint } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import { toPosKey } from '../grid/GridHelpers';
import type { SizedGrid } from '../grid/GridHelpers';
import type { PollutionSource } from '../environment/Pollution';

/** A garbage bag waiting at a building for truck pickup. */
export interface PendingGarbage {
  x: number;
  y: number;
  waitTicks: number;
}

export interface GarbageFacility {
  id: string;
  x: number;
  y: number;
  capacity: number;
  currentLoad: number;
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
  DEFAULT_CAPACITY: 2000,
  /** Fixed burn rate: units incinerated per tick per facility */
  BURN_RATE: 90,
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
  /** Max bags collected per facility per service tick */
  COLLECTION_RATE: 140,
  /** Happiness penalty per garbage bag waiting in queue */
  HAPPINESS_PER_BAG: -3,
  /** After this many ticks, penalty per bag increases */
  HEAVY_THRESHOLD: 30,
  /** Heavier happiness penalty per bag after threshold */
  HEAVY_HAPPINESS_PER_BAG: -8,
  /** Ticks before uncollected garbage decomposes */
  DECOMPOSE_TICKS: 600,
} as const;

interface GarbageJSON {
  facilities: GarbageFacility[];
  pendingBags?: PendingGarbage[];
  garbageAccumulators?: Record<string, number>;
  /** @deprecated Legacy formats */
  truckTrips?: any[];
  pendingGarbageQueue?: any[];
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

  /** Bags waiting at buildings for truck pickup */
  private pendingBags: PendingGarbage[] = [];

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
    this.facilityDistanceMaps.delete(id);
    const idx = this.facilities.findIndex(f => f.id === id);
    if (idx !== -1) {
      this.facilities.splice(idx, 1);
      this.connectedFacilityIds.delete(id);
    }
  }

  // ── Per-building garbage reporting ─────────────────────────────────

  reportGarbage(x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    this.todayProduced += amount;
    const key = toPosKey(x, y);
    const acc = (this.garbageAccumulators.get(key) ?? 0) + amount;
    if (acc >= 1) {
      const bags = Math.floor(acc);
      this.garbageAccumulators.set(key, acc - bags);
      for (let i = 0; i < bags; i++) {
        this.pendingBags.push({ x, y, waitTicks: 0 });
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
    // Step 1: Increment wait counters; remove decomposed
    for (let i = this.pendingBags.length - 1; i >= 0; i--) {
      this.pendingBags[i]!.waitTicks++;
      if (this.pendingBags[i]!.waitTicks >= GARBAGE.DECOMPOSE_TICKS) {
        this.pendingBags.splice(i, 1);
      }
    }

    // Step 2: Collect from buildings (weighted random by distance)
    this.collectFromBuildings();

    // Step 3: Burn at facilities
    this.processFacilities();
  }

  /** Weighted-random collection: per-position, find nearest facility with room (like cemetery). */
  private collectFromBuildings(): void {
    if (this.pendingBags.length === 0) return;

    // Track budget and room per facility
    const facState = new Map<string, { fac: GarbageFacility; budget: number; room: number }>();
    for (const fac of this.facilities) {
      if (!this.connectedFacilityIds.has(fac.id) || !this.isFacilityOperationalById(fac.id)) continue;
      const room = fac.capacity - fac.currentLoad;
      if (room <= 0) continue;
      facState.set(fac.id, { fac, budget: GARBAGE.COLLECTION_RATE, room });
    }
    if (facState.size === 0) return;

    // Group pending bags by position with weight from nearest facility distance
    const positions = new Map<string, { x: number; y: number; count: number; weight: number }>();
    for (const bag of this.pendingBags) {
      const key = toPosKey(bag.x, bag.y);
      const entry = positions.get(key);
      if (entry) {
        entry.count++;
      } else {
        const cost = this.mergedDistanceMap.get(key);
        if (cost === undefined) continue;
        positions.set(key, { x: bag.x, y: bag.y, count: 1, weight: 1 / Math.max(1, cost) });
      }
    }
    if (positions.size === 0) return;

    // Total budget across all facilities
    let totalBudget = 0;
    for (const s of facState.values()) totalBudget += s.budget;

    const entries = [...positions.values()];
    while (totalBudget > 0 && entries.length > 0) {
      let totalWeight = 0;
      for (const e of entries) totalWeight += e.weight;
      if (totalWeight <= 0) break;

      // Weighted random: pick a position
      let roll = Math.random() * totalWeight;
      let picked = -1;
      for (let i = 0; i < entries.length; i++) {
        roll -= entries[i]!.weight;
        if (roll <= 0) { picked = i; break; }
      }
      if (picked === -1) picked = entries.length - 1;
      const pos = entries[picked]!;
      const posKey = toPosKey(pos.x, pos.y);

      // Find nearest facility with room + budget (like cemetery)
      let bestId: string | null = null;
      let bestCost = Infinity;
      for (const [id, state] of facState) {
        if (state.budget <= 0 || state.room <= 0) continue;
        const distMap = this.facilityDistanceMaps.get(id);
        if (!distMap) continue;
        const cost = distMap.get(posKey);
        if (cost !== undefined && cost < bestCost) {
          bestCost = cost;
          bestId = id;
        }
      }

      if (!bestId) {
        entries.splice(picked, 1);
        continue;
      }

      const state = facState.get(bestId)!;
      const take = Math.min(pos.count, state.budget, state.room);

      let removed = 0;
      for (let i = this.pendingBags.length - 1; i >= 0 && removed < take; i--) {
        if (this.pendingBags[i]!.x === pos.x && this.pendingBags[i]!.y === pos.y) {
          this.pendingBags.splice(i, 1);
          removed++;
        }
      }

      state.fac.currentLoad += removed;
      state.fac.todayReceived += removed;
      state.budget -= removed;
      state.room -= removed;
      totalBudget -= removed;

      pos.count -= removed;
      if (pos.count <= 0) {
        entries.splice(picked, 1);
      }
    }
  }

  clearPendingAt(x: number, y: number): void {
    for (let i = this.pendingBags.length - 1; i >= 0; i--) {
      if (this.pendingBags[i]!.x === x && this.pendingBags[i]!.y === y) {
        this.pendingBags.splice(i, 1);
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
    return Math.round(this.producedHistory.reduce((a, b) => a + b, 0));
  }

  getBurnedPerWeek(): number {
    return Math.round(this.burnedHistory.reduce((a, b) => a + b, 0));
  }

  getUncollected(): number {
    return this.pendingBags.length;
  }

  getHappinessPenalty(): number {
    const count = this.pendingBags.length;
    if (count === 0) return 0;
    let penalty = 0;
    for (const bag of this.pendingBags) {
      penalty += bag.waitTicks >= GARBAGE.HEAVY_THRESHOLD
        ? GARBAGE.HEAVY_HAPPINESS_PER_BAG
        : GARBAGE.HAPPINESS_PER_BAG;
    }
    return penalty;
  }

  getPollutionPenalty(): number {
    const uncollected = this.pendingBags.length;
    if (uncollected <= 0) return 0;
    return Math.min(GARBAGE.MAX_POLLUTION_PENALTY, uncollected * GARBAGE.UNCOLLECTED_POLLUTION_MULTIPLIER);
  }

  getTotalCapacity(): number {
    return this.facilities.reduce((sum, f) => sum + f.capacity, 0);
  }

  getCurrentLoad(): number {
    return this.facilities.reduce((sum, f) => sum + f.currentLoad, 0);
  }

  getPendingGarbageQueue(): readonly PendingGarbage[] {
    return this.pendingBags;
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
    for (const f of operational) {
      this.forEachFacilityCell(f, (cx, cy) => {
        sources.push({ x: cx, y: cy, amount: GARBAGE.BASE_POLLUTION, type: 'ground', radius });
      });
    }
    for (const f of operational) {
      const loadRatio = f.capacity > 0 ? f.currentLoad / f.capacity : 0;
      if (loadRatio > GARBAGE.POLLUTION_LOAD_THRESHOLD) {
        const amount = Math.round(loadRatio * GARBAGE.POLLUTION_AMOUNT_SCALE);
        this.forEachFacilityCell(f, (cx, cy) => {
          sources.push({ x: cx, y: cy, amount, type: 'ground', radius });
        });
      }
    }
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
      pendingBags: this.pendingBags.map(b => ({ ...b })),
      garbageAccumulators: accObj,
    };
  }

  static fromJSON(data: GarbageJSON): GarbageService {
    const gs = new GarbageService();
    gs.facilities = (data.facilities || []).map((f: any) => ({
      ...f,
      currentLoad: f.currentLoad ?? 0,
      todayBurned: f.todayBurned ?? 0,
      burnDaily: f.burnDaily?.length === 7 ? f.burnDaily : new Array(7).fill(0),
      burnDailyIndex: f.burnDailyIndex ?? 0,
      todayReceived: f.todayReceived ?? 0,
      receivedDaily: f.receivedDaily?.length === 7 ? f.receivedDaily : new Array(7).fill(0),
      receivedDailyIndex: f.receivedDailyIndex ?? 0,
    }));
    if (Array.isArray(data.pendingBags)) {
      gs.pendingBags = data.pendingBags.map(b => ({ ...b, waitTicks: b.waitTicks ?? 0 }));
    }
    // Legacy: truckTrips (v2) — bags were on trucks, put them back as pending
    if (!data.pendingBags && Array.isArray(data.truckTrips)) {
      for (const t of data.truckTrips) {
        if (Array.isArray(t.stops)) {
          for (const s of t.stops) {
            for (let i = 0; i < (s.bagCount ?? 0); i++) {
              gs.pendingBags.push({ x: s.x ?? 0, y: s.y ?? 0, waitTicks: 0 });
            }
          }
        }
      }
    }
    // Legacy: pendingGarbageQueue (v1)
    if (!data.pendingBags && !data.truckTrips && Array.isArray(data.pendingGarbageQueue)) {
      for (const g of data.pendingGarbageQueue) {
        gs.pendingBags.push({ x: g.x ?? 0, y: g.y ?? 0, waitTicks: g.waitTicks ?? 0 });
      }
    }
    // Legacy: overflow (v0)
    if (!data.pendingBags && !data.truckTrips && !data.pendingGarbageQueue && typeof data.overflow === 'number' && data.overflow > 0) {
      for (let i = 0; i < Math.floor(data.overflow); i++) {
        gs.pendingBags.push({ x: 0, y: 0, waitTicks: 0 });
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

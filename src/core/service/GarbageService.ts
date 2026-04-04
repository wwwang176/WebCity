import { ROAD_COVERAGE, roadFlood, expandCoverageToBuildings, expandFootprint } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import { toPosKey } from '../grid/GridHelpers';
import type { SizedGrid } from '../grid/GridHelpers';
import type { PollutionSource } from '../environment/Pollution';
import { SIMULATION } from '../simulation/SimulationConstants';

/** A garbage bag waiting at a building for truck pickup. */
export interface PendingGarbage {
  x: number;
  y: number;
  waitTicks: number;           // total tick() calls spent waiting
}

/** A truck trip collecting from multiple buildings and returning to facility. */
export interface TruckTrip {
  facilityId: string;
  stops: { x: number; y: number; bagCount: number }[];
  totalBags: number;
  remainingTicks: number;      // countdown to arrival at facility
}

export interface GarbageFacility {
  id: string;
  x: number;
  y: number;
  capacity: number;
  currentLoad: number;
  /** Trucks currently on the road */
  inTransit: number;
  /** Total bags being transported by all trucks */
  bagsInTransit: number;
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
  RESIDENTIAL: { base: 0.025, perCapita: 0.0025 },
  COMMERCIAL:  { base: 0.05,  perCapita: 0.0025 },
  INDUSTRIAL:  { base: 0.1,   perCapita: 0.005  },
  OFFICE:      { base: 0.01,  perCapita: 0.001  },
} as const;

/** Garbage service configuration constants */
export const GARBAGE = {
  /** Road-distance coverage budget (used for overlay gradient reference, not range limit) */
  SERVICE_BUDGET: ROAD_COVERAGE.GARBAGE_BUDGET,
  /** Default capacity per facility */
  DEFAULT_CAPACITY: 1000,
  /** Fixed burn rate: units incinerated per tick per facility */
  BURN_RATE: 60,
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
  TRUCK_SPEED: 20,
  /** Total garbage trucks per facility */
  TRUCK_COUNT: 8,
  /** Max bags a single truck can carry per trip */
  TRUCK_CAPACITY: 50,
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
  pendingBags?: PendingGarbage[];
  truckTrips?: TruckTrip[];
  garbageAccumulators?: Record<string, number>;
  /** @deprecated Legacy v1 queue format */
  pendingGarbageQueue?: any[];
  /** @deprecated Legacy field — converted to bags on load */
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
  /** Active truck trips */
  private truckTrips: TruckTrip[] = [];

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
      bagsInTransit: 0,
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
    // Return bags from trips assigned to this facility back to pending
    for (let i = this.truckTrips.length - 1; i >= 0; i--) {
      const trip = this.truckTrips[i]!;
      if (trip.facilityId === id) {
        for (const stop of trip.stops) {
          for (let j = 0; j < stop.bagCount; j++) {
            this.pendingBags.push({ x: stop.x, y: stop.y, waitTicks: 0 });
          }
        }
        this.truckTrips.splice(i, 1);
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

  /** Report garbage produced at a specific building. Accumulates fractionally; emits bag at ≥1. */
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
    // Step 1: Increment wait counters on pending bags; remove decomposed
    for (let i = this.pendingBags.length - 1; i >= 0; i--) {
      this.pendingBags[i]!.waitTicks++;
      if (this.pendingBags[i]!.waitTicks >= GARBAGE.DECOMPOSE_TICKS) {
        this.pendingBags.splice(i, 1);
      }
    }

    // Step 2: Tick down active truck trips; handle arrivals
    for (let i = this.truckTrips.length - 1; i >= 0; i--) {
      const trip = this.truckTrips[i]!;
      trip.remainingTicks -= SIMULATION.SLOW_TICK_INTERVAL;
      if (trip.remainingTicks <= 0) {
        const fac = this.facilities.find(f => f.id === trip.facilityId);
        if (fac) {
          fac.currentLoad += trip.totalBags;
          fac.todayReceived += trip.totalBags;
          fac.inTransit = Math.max(0, fac.inTransit - 1);
          fac.bagsInTransit = Math.max(0, fac.bagsInTransit - trip.totalBags);
        }
        this.truckTrips.splice(i, 1);
      }
    }

    // Step 3: Dispatch trucks from facilities with available trucks
    this.dispatchTrucks();

    // Step 4: Process at facilities (burn)
    this.processFacilities();
  }

  /** Remove all pending garbage at a specific position (building demolished/cleared). */
  clearPendingAt(x: number, y: number): void {
    for (let i = this.pendingBags.length - 1; i >= 0; i--) {
      if (this.pendingBags[i]!.x === x && this.pendingBags[i]!.y === y) {
        this.pendingBags.splice(i, 1);
      }
    }
    this.garbageAccumulators.delete(toPosKey(x, y));
    // Note: bags already on trucks (in truckTrips) are committed — they continue to the facility
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

  /** Dispatch trucks: each available truck picks up bags from multiple buildings. */
  private dispatchTrucks(): void {
    if (this.pendingBags.length === 0) return;

    for (const fac of this.facilities) {
      if (!this.connectedFacilityIds.has(fac.id) || !this.isFacilityOperationalById(fac.id)) continue;

      while (fac.inTransit < GARBAGE.TRUCK_COUNT) {
        // Check remaining capacity at facility
        const remainingCap = fac.capacity - fac.currentLoad - fac.bagsInTransit;
        if (remainingCap <= 0) break;

        const trip = this.planTrip(fac, Math.min(GARBAGE.TRUCK_CAPACITY, remainingCap));
        if (!trip) break; // no reachable bags

        fac.inTransit++;
        fac.bagsInTransit += trip.totalBags;
        this.truckTrips.push(trip);

        if (this.pendingBags.length === 0) return;
      }
    }
  }

  /** Plan a trip for one truck: greedily collect nearest bags up to capacity. */
  private planTrip(fac: GarbageFacility, maxBags: number): TruckTrip | null {
    const distMap = this.facilityDistanceMaps.get(fac.id);
    if (!distMap) return null;

    // Group pending bags by position with their costs
    const positionBags = new Map<string, { x: number; y: number; count: number; cost: number }>();
    for (const bag of this.pendingBags) {
      const key = toPosKey(bag.x, bag.y);
      const cost = distMap.get(key);
      if (cost === undefined) continue; // not reachable from this facility
      const entry = positionBags.get(key);
      if (entry) {
        entry.count++;
      } else {
        positionBags.set(key, { x: bag.x, y: bag.y, count: 1, cost });
      }
    }

    if (positionBags.size === 0) return null;

    // Sort positions by distance (nearest first)
    const sorted = [...positionBags.values()].sort((a, b) => a.cost - b.cost);

    // Greedily fill truck
    const stops: { x: number; y: number; bagCount: number }[] = [];
    let totalBags = 0;
    let farthestCost = 0;

    for (const pos of sorted) {
      if (totalBags >= maxBags) break;
      const take = Math.min(pos.count, maxBags - totalBags);
      stops.push({ x: pos.x, y: pos.y, bagCount: take });
      totalBags += take;
      farthestCost = pos.cost; // sorted ascending, so last one is farthest
    }

    if (totalBags === 0) return null;

    // Remove collected bags from pendingBags
    for (const stop of stops) {
      let remaining = stop.bagCount;
      for (let i = this.pendingBags.length - 1; i >= 0 && remaining > 0; i--) {
        if (this.pendingBags[i]!.x === stop.x && this.pendingBags[i]!.y === stop.y) {
          this.pendingBags.splice(i, 1);
          remaining--;
        }
      }
    }

    // Travel time based on farthest stop (truck collects along the way)
    const remainingTicks = Math.max(1, Math.ceil(farthestCost * SIMULATION.SLOW_TICK_INTERVAL / GARBAGE.TRUCK_SPEED));

    return { facilityId: fac.id, stops, totalBags, remainingTicks };
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

  /** Total uncollected garbage bags waiting at buildings. */
  getUncollected(): number {
    return this.pendingBags.length;
  }

  /** Happiness penalty scaling with waiting bag count and wait duration. */
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

  /** Pollution penalty from uncollected garbage. */
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

  /** Get the pending garbage bags (read-only, for UI/happiness). */
  getPendingGarbageQueue(): readonly PendingGarbage[] {
    return this.pendingBags;
  }

  /** Get active truck trips (read-only, for UI/debugging). */
  getTruckTrips(): readonly TruckTrip[] {
    return this.truckTrips;
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
      truckTrips: this.truckTrips.map(t => ({ ...t, stops: t.stops.map(s => ({ ...s })) })),
      garbageAccumulators: accObj,
    };
  }

  static fromJSON(data: GarbageJSON): GarbageService {
    const gs = new GarbageService();
    gs.facilities = (data.facilities || []).map((f: any) => ({
      ...f,
      currentLoad: f.currentLoad ?? 0,
      inTransit: f.inTransit ?? 0,
      bagsInTransit: f.bagsInTransit ?? 0,
      todayBurned: f.todayBurned ?? 0,
      burnDaily: f.burnDaily?.length === 7 ? f.burnDaily : new Array(7).fill(0),
      burnDailyIndex: f.burnDailyIndex ?? 0,
      todayReceived: f.todayReceived ?? 0,
      receivedDaily: f.receivedDaily?.length === 7 ? f.receivedDaily : new Array(7).fill(0),
      receivedDailyIndex: f.receivedDailyIndex ?? 0,
    }));
    // New format: separate bags + trips
    if (Array.isArray(data.pendingBags)) {
      gs.pendingBags = data.pendingBags.map(b => ({ ...b, waitTicks: b.waitTicks ?? 0 }));
    }
    if (Array.isArray(data.truckTrips)) {
      gs.truckTrips = data.truckTrips.map(t => ({ ...t }));
    }
    // Legacy v1: pendingGarbageQueue (with facilityId/remainingTicks)
    if (!data.pendingBags && Array.isArray(data.pendingGarbageQueue)) {
      for (const g of data.pendingGarbageQueue) {
        gs.pendingBags.push({ x: g.x ?? 0, y: g.y ?? 0, waitTicks: g.waitTicks ?? 0 });
      }
    }
    // Legacy v0: overflow number
    if (!data.pendingBags && !data.pendingGarbageQueue && typeof data.overflow === 'number' && data.overflow > 0) {
      const bags = Math.floor(data.overflow);
      for (let i = 0; i < bags; i++) {
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

import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { GlobalCoverageService, type PendingItem } from './GlobalCoverageService';
import { toPosKey } from '../grid/GridHelpers';
import type { PollutionSource } from '../environment/Pollution';

/** A garbage bag waiting at a building for truck pickup. */
export type PendingGarbage = PendingItem;

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

/** Spread radius for rubbish left in the street; the block size derives from it. */
const UNCOLLECTED_RADIUS = 2;

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
  /** Radius for rubbish left in the street — tight, it is a local nuisance. */
  UNCOLLECTED_POLLUTION_RADIUS: UNCOLLECTED_RADIUS,
  /**
   * Rubbish is grouped into blocks this many cells across before emitting.
   *
   * Sized so that merging can never move pollution off the rubbish that caused
   * it: the greatest MANHATTAN distance between two cells of a k-wide block is
   * 2(k-1), and the emitting position always lies inside the block, so every
   * bag stays within `radius` of its own source exactly when 2(k-1) <= radius.
   * A wider block looks fine on a diagram and silently leaves its corners
   * outside the spread — a 5-wide block puts them 4 away from a radius of 2.
   */
  UNCOLLECTED_BLOCK_SIZE: Math.floor(UNCOLLECTED_RADIUS / 2) + 1,
  /**
   * Hard cap on uncollected sources per rebuild, for the pathological city.
   * Pollution.spreadFromSource walks (2r+1)^2 cells for each one.
   */
  UNCOLLECTED_POLLUTION_BLOCKS: 512,
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

/** Current save schema — what toJSON() produces. */
interface GarbageJSON {
  facilities: GarbageFacility[];
  pendingBags?: PendingGarbage[];
  garbageAccumulators?: Record<string, number>;
}

/** fromJSON() input: current schema plus any legacy fields from older save versions. */
type GarbageJSONInput = GarbageJSON & {
  /** v2 legacy: bags held on trucks in transit, migrated to pendingBags on load. */
  truckTrips?: any[];
  /** v1 legacy: queue entries shape, migrated to pendingBags on load. */
  pendingGarbageQueue?: any[];
  /** v0 legacy: scalar overflow count, migrated to pendingBags on load. */
  overflow?: number;
};

export class GarbageService extends GlobalCoverageService<GarbageFacility> {
  protected readonly coverageBudget = GARBAGE.SERVICE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'garbage_';
  protected readonly maintenanceCostPerFacility = GARBAGE.MAINTENANCE_PER_FACILITY;

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

  removeFacility(id: string): boolean {
    this.removeDistanceMap(id);
    return this.removeFacilityById(id);
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
    this.collectPending(this.pendingBags, GARBAGE.COLLECTION_RATE);

    // Step 3: Burn at facilities
    this.processFacilities();
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

  /**
   * Capacity the city can actually use — same filter as collectPending.
   *
   * Summing every facility advertised room in a landfill nothing can reach and
   * nothing can power, exactly the situation where the player needs the panel
   * to tell them the truth. Same shape as the hospital capacity fixed in
   * BUG-100.
   */
  getTotalCapacity(): number {
    return this.getActiveFacilities().reduce((sum, f) => sum + f.capacity, 0);
  }

  getCurrentLoad(): number {
    return this.facilities.reduce((sum, f) => sum + f.currentLoad, 0);
  }

  /**
   * Garbage sitting in landfills the city can actually reach.
   *
   * getTotalCapacity counts only active facilities; the infrastructure panel
   * divided the unfiltered getCurrentLoad into it and printed "1800 / 0" with
   * the bar back at a healthy 0% the moment the only landfill lost its road
   * (BUG-155). Whatever the panel shows, both halves have to describe the same
   * set of landfills.
   */
  getActiveLoad(): number {
    return this.getActiveFacilities().reduce((sum, f) => sum + f.currentLoad, 0);
  }

  /** Landfill space the city has paid for and cannot currently use. */
  getStrandedCapacity(): number {
    return this.facilities.reduce((sum, f) => sum + f.capacity, 0) - this.getTotalCapacity();
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
    // getActiveFacilities, not getOperationalFacilities: a landfill with power
    // but no road connection collects nothing and burns nothing, yet it used to
    // emit BASE_POLLUTION per cell and take a share of the uncollected-garbage
    // penalty — and because that share only lands on the rubbish itself when NO
    // facility works, its mere existence hid the street-level pollution the
    // player was meant to see.
    const operational = this.getActiveFacilities();
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
    if (uncollectedPenalty > 0) {
      if (operational.length > 0) {
        // Divide by the CELLS, not just the facilities.
        //
        // `ceil(penalty / facilityCount)` was then emitted at every cell of
        // every facility, so a 2x2 landfill emitted the whole penalty four
        // times over — measured at 400 against a penalty of 100. The other
        // branch conserves the penalty exactly, so a city that built a landfill
        // was punished about 4x harder for the rubbish it had not yet collected
        // than an identical city that built nothing. That is BUG-101's
        // incentive inversion in a lighter form, and it survived because the
        // two branches were only ever tested apart.
        const cellsPerFacility = this.defaultFacilityWidth * this.defaultFacilityHeight;
        const perCell = uncollectedPenalty / (operational.length * cellsPerFacility);
        for (const f of operational) {
          this.forEachFacilityCell(f, (cx, cy) => {
            sources.push({ x: cx, y: cy, amount: perCell, type: 'ground', radius });
          });
        }
      } else {
        // No working landfill: emit at the rubbish itself.
        //
        // This branch used to be skipped entirely, so a city with no landfill
        // accumulated garbage forever at exactly zero pollution cost — "do
        // nothing" strictly beat "start handling waste", which immediately
        // added BASE_POLLUTION per landfill cell. getPollutionSources is the
        // only route garbage has into the pollution grid, so nothing else
        // compensated (BUG-101). Emitting at the pending bags also fixes the
        // modelling inversion where uncollected rubbish polluted the landfill
        // rather than the street it was sitting on.
        // Group the rubbish into blocks one pollution footprint wide, and emit
        // at each block's weighted centre.
        //
        // The previous version took "the twelve worst piles". Rubbish is
        // normally spread thin — a bag or two per house — so every pile has the
        // same count, the sort is stable, and "worst twelve" degenerates into
        // "the first twelve the map happened to enumerate". In a city with 200
        // rubbish-bearing cells, 188 emitted nothing at all, every source
        // landed in one corner, and splicing collected bags out of pendingBags
        // reshuffled which twelve for no reason the player could see.
        //
        // A block is BLOCK_SIZE cells across, which is the diameter of an
        // uncollected source's own spread — so merging within a block loses no
        // spatial detail the pollution grid could have shown anyway, while
        // bounding the source count by area rather than by rubbish count.
        const size = GARBAGE.UNCOLLECTED_BLOCK_SIZE;
        const blocks = new Map<string, { sx: number; sy: number; count: number }>();
        for (const bag of this.pendingBags) {
          const key = toPosKey(Math.floor(bag.x / size), Math.floor(bag.y / size));
          const e = blocks.get(key);
          if (e) { e.sx += bag.x; e.sy += bag.y; e.count++; }
          else blocks.set(key, { sx: bag.x, sy: bag.y, count: 1 });
        }

        // Still capped, for the pathological city: Pollution.spreadFromSource
        // walks (2r+1)^2 cells per source. Ties now break on position rather
        // than on enumeration order, so the cut is at least stable across ticks.
        // The emitting position is the bag-weighted centre of the block,
        // rounded. Both coordinates lie between the block's own bounds, so the
        // rounded point is still a cell of the block and the coverage argument
        // above holds.
        const ranked = [...blocks.values()]
          .map(e => ({ x: Math.round(e.sx / e.count), y: Math.round(e.sy / e.count), count: e.count }))
          .sort((a, b) => b.count - a.count || a.y - b.y || a.x - b.x)
          .slice(0, GARBAGE.UNCOLLECTED_POLLUTION_BLOCKS);

        // Share of the penalty is proportional to the bags actually represented,
        // so the total is the penalty whatever the cut removed. (BUG-122: an
        // earlier version used Math.ceil per position, which floored the total
        // at the number of rubbish-bearing cells — 10-20x MAX_POLLUTION_PENALTY
        // in a mid-size city, and growing with city size.)
        const totalCount = ranked.reduce((sum, e) => sum + e.count, 0);
        if (totalCount > 0) {
          for (const e of ranked) {
            const amount = uncollectedPenalty * (e.count / totalCount);
            if (amount > 0) {
              sources.push({
                x: e.x, y: e.y,
                amount, type: 'ground', radius: GARBAGE.UNCOLLECTED_POLLUTION_RADIUS,
              });
            }
          }
        }
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

  static fromJSON(data: GarbageJSONInput): GarbageService {
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

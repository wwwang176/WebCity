import type { GameState } from '../core/simulation/GameState';
import { getBuildingType } from '../core/building/types';
import { ZoneType } from '../core/grid/types';
import { calculateBalance } from '../core/economy/Budget';
import { getCivicServices, getTotalServiceMaintenanceCost } from '../core/service/ServiceRegistry';
import { getTransitSystems } from '../core/transport/TransportRegistry';
import { buildTransitRows, type TransitSystemRow } from '../ui/modals/overview/transitRows';
import type { EconomyBreakdownResult } from '../core/economy/EconomyBreakdown';
import type { TrafficStatsResult } from '../core/traffic/TrafficStats';
import type { CommuteStats } from '../core/citizen/CommuteStats';
import type { TransferStats } from '../core/transport/TransferStatsQuery';
import type { ChartHistory } from '../core/economy/ChartSeries';
import type { ElevatedSegment } from '../core/elevation/types';
import type { RoadCellGraph } from '../core/road/RoadCellGraph';
import { roadConnectivity, type ConnectivityResult } from '../core/road/RoadConnectivity';
import { buildSummaryStats, type SummaryStats } from '../core/stats/SummaryStats';
import { buildDemographicsStats, type DemographicsStats } from '../core/stats/DemographicsStats';
import { buildEnvironmentStats, type EnvironmentStats } from '../core/stats/EnvironmentStats';
import { buildFreightStats, type FreightStats } from '../core/stats/FreightStats';
import { buildInfraStats, type InfraStats } from '../core/stats/InfraStats';
import { buildServicesStats, type ServicesStats } from '../core/stats/ServiceStats';
import { ABANDONED, BURNED } from '../core/building/InfraPlacement';
import { citizenName } from '../core/citizen/CitizenName';
import { citizenWorkLabel } from '../core/citizen/CitizenPresentation';
import {
  buildCoverage, buildOverlayCells, overlayKind, COVERAGE_SERVICES,
  type CoverageInfo, type CoverageService, type OverlayCellInfo, type OverlayKind,
} from './overlays';

/**
 * Reading the city.
 *
 * ## This layer emits facts, not the panels' aggregates
 *
 * The eight Overview pages compute their numbers in their own `createMemo`s, across two
 * thousand-odd lines of TSX. Copying those computations here would put the same number in two
 * places and let them drift apart silently (BUG-342 came from exactly that).
 *
 * So the rules are:
 *
 * - **Reuse anything already extracted into a pure module.** Transit goes through
 *   `transitRows.ts`, the same function the panel itself uses.
 * - **Emit raw facts otherwise**, leaving aggregation to the caller. A panel compresses a
 *   hundred buildings into one line because a person can only read one line; a program sums
 *   them itself.
 * - **Pass through whatever `Game` already computed** — ledger breakdown, commute, traffic,
 *   transfers, billable districts and abandonment stress are the same values the panels read,
 *   handed on untouched (see `StatsHost`).
 */

/**
 * The statistics on `Game` that the panels read.
 *
 * A structural type rather than `Game` itself, so this can be tested without Three.js:
 * `Game.ts` imports Three.js directly and unit tests cannot load it.
 *
 * **Return values are forwarded untouched**, never recomputed or copied. The same number kept
 * in two places drifts apart (BUG-342).
 */
export interface StatsHost {
  getEconomyBreakdown(): EconomyBreakdownResult;
  getBillableDistricts(): readonly BillableDistrict[];
  getCommuteStats(): CommuteStats;
  getTrafficStats(): TrafficStatsResult;
  getTransferStats(): TransferStats;
  getAbandonmentStress(x: number, y: number): number;
  getSelectedBuilding(): unknown;
  /** Per-cell values of one overlay. The overlay need not be switched on. */
  getOverlayData(type: string): ReadonlyMap<string, number> | undefined;
  /** The colour a value takes on that overlay. */
  getOverlayColor(type: string, value: number): number;
  /** The road-cost map, that service's budget, and per-cell facility load and serving facility. */
  getCoverageCosts(service: string): {
    costs: ReadonlyMap<string, number>;
    budget: number;
    loadAt: (x: number, y: number) => number;
    servingFacilityAt: (x: number, y: number) => string | null;
  } | null;
  /** The facilities producing those colours. */
  getOverlaySourceCells(type: string): { x: number; y: number }[];
  /** The 10-step gradient used to highlight buildings. */
  coverageGradient(): readonly number[];
  /**
   * Every elevated segment in the city.
   *
   * **Not part of `GameState`**: `ElevationManager` is a field of `Game`, so `read` can only
   * get it here. Without it, the only way a program can confirm a bridge exists is to
   * deliberately rebuild it and read the `Elevation level already occupied` error (BUG-367).
   */
  elevatedSegments(): Array<{ x: number; y: number; level: number; data: ElevatedSegment }>;
  /**
   * The cell-level road graph including elevated roads and ramps. `null` means the road lookup
   * is not wired up yet.
   *
   * The copy `SimulationLoop` caches by `commuteCache.roadGeneration`, used by service coverage
   * and commute reachability alike. **Do not rebuild it here**; that is O(road cells).
   */
  roadCellGraph(): RoadCellGraph | null;
  /**
   * Per-day chart history.
   *
   * **Not part of `GameState`**: the UI store accumulates one entry per day and it is not
   * saved, so it is empty after loading a save and only grows while the game runs.
   */
  chartHistory(): ChartHistory;
}

/** One billable district's road extent and paying-driver count. */
export interface BillableDistrict {
  id: string;
  roadCells: number;
  chargedDrivers: number;
}

export interface CityInfo {
  season: string;
  week: number;
  day: number;
  hourOfDay: number;
  funds: number;
  /** Net balance per tick. */
  balance: number;
  population: number;
  employed: number;
  happiness: number;
  rci: { residential: number; commercial: number; industrial: number };
  power: { supply: number; demand: number };
  water: { supply: number; demand: number };
}

/** One elevated road or rail segment. `level` is 1-3 and `x`/`y` is the cell it stands on. */
export interface ElevatedInfo extends ElevatedSegment {
  x: number;
  y: number;
  level: number;
}

export interface BuildingInfo {
  x: number;
  y: number;
  buildingId: number;
  name: string;
  zone: string;
  level: number;
  /** How many people this cell holds: residents for housing, jobs otherwise. */
  capacity: number;
  residents: number;
  workers: number;
  landValue: number;
  pollution: number;
  /** Abandoned or burned out. */
  derelict: boolean;
}

export interface CitizenInfo {
  id: number;
  /**
   * The name shown in the panel.
   *
   * Derived from the id and the city seed, not saved, so **the same id has a different name in
   * a different city**. Refer to a citizen by `id`; the name is for people to read.
   */
  name: string;
  age: number;
  /** BABY / CHILD / TEEN / ADULT / SENIOR. */
  lifeStage: string;
  education: string;
  happiness: number;
  health: number;
  homeId: string | null;
  workplaceId: string | null;
  /**
   * The text of the panel's "Work" row.
   *
   * Not a synonym for `workplaceId`: citizens without a job split into `Unemployed` (of working
   * age), `Retired` (past it), `Student` and `Too young to work`. Reading the last three as
   * unemployed makes a fully employed city's housing look like 100% unemployment.
   */
  workLabel: string;
  /** The tick from which this citizen has had no job. `null` means they have not started
   *  looking. */
  unemployedSince: number | null;
  /** The tick from which this citizen has had nowhere to live. */
  homelessSince: number | null;
}

export interface ServiceInfo {
  key: string;
  maintenance: number;
}

export interface BuildingQuery {
  /** Restrict to these zone types. Omit for all of them. */
  zone?: readonly string[];
  /** Restrict to this rectangle. */
  rect?: { x1: number; y1: number; x2: number; y2: number };
  /** Maximum rows. Defaults to 500: a whole city can run to thousands, too many to read. */
  limit?: number;
  /** Restrict to abandoned or burned-out buildings. */
  derelictOnly?: boolean;
}

export interface CitizenQuery {
  limit?: number;
  /** Restrict to residents of this building, keyed `"x,y"`. */
  homeId?: string;
  /** Restrict to people working at this building. */
  workplaceId?: string;
  /** Restrict to people without a job. */
  unemployedOnly?: boolean;
}

const ZONE_NAMES: Record<number, string> = {
  [ZoneType.NONE]: 'none',
  [ZoneType.RESIDENTIAL_LOW]: 'residential_low',
  [ZoneType.RESIDENTIAL_HIGH]: 'residential_high',
  [ZoneType.COMMERCIAL_LOW]: 'commercial_low',
  [ZoneType.COMMERCIAL_HIGH]: 'commercial_high',
  [ZoneType.INDUSTRIAL]: 'industrial',
  [ZoneType.OFFICE]: 'office',
};

const DEFAULT_BUILDING_LIMIT = 500;
const DEFAULT_CITIZEN_LIMIT = 200;

/**
 * The `reserved` values meaning "this building is not operating".
 *
 * Both render dark grey, neither lights up, and developers clear both, so to a reader they are
 * one thing.
 *
 * **Imported from `InfraPlacement` rather than written as literals.** Hardcoding `[1, 2]` while
 * `BURNED` is actually 3 (2 is unused) reported `derelict: false` for every burned-out
 * building, so `derelictOnly` matched nothing while nine charred houses were on screen
 * (BUG-360).
 */
const DERELICT_RESERVED: readonly number[] = [ABANDONED, BURNED];

/** A raw citizen as `CitizenManager` emits it. */
interface RawCitizen {
  id: number;
  age: number;
  lifeStage: unknown;
  education: unknown;
  happiness: number;
  health: number;
  educationProgress: number;
  homeId: string | null;
  workplaceId: string | null;
  unemployedSince: number | null;
  homelessSince: number | null;
}

/**
 * One citizen, as the panel presents them.
 *
 * The name and the "Work" row both come from the core functions the panel reads. Assembling
 * either here would produce an API saying `Unemployed` while the screen says `Retired`.
 */
function describeCitizen(c: RawCitizen, citySeed: number): CitizenInfo {
  return {
    id: c.id,
    name: citizenName(c.id, citySeed),
    age: c.age,
    lifeStage: String(c.lifeStage),
    education: String(c.education),
    happiness: Math.round(c.happiness),
    health: Math.round(c.health),
    homeId: c.homeId ?? null,
    workplaceId: c.workplaceId ?? null,
    workLabel: citizenWorkLabel(c),
    unemployedSince: c.unemployedSince ?? null,
    homelessSince: c.homelessSince ?? null,
  };
}

export class AgentRead {
  constructor(
    private readonly getState: () => GameState,
    private readonly stats: StatsHost,
  ) {}

  city(): CityInfo {
    const s = this.getState();
    const clock = s.clock;
    return {
      season: String(clock.getSeason()),
      week: clock.getWeek() + 1,
      day: clock.getDay(),
      hourOfDay: clock.getHourOfDay(),
      funds: Math.floor(s.budget.funds),
      balance: Math.round(calculateBalance(s.budget)),
      population: s.citizens.getPopulation(),
      employed: s.citizens.getEmployedCount(),
      happiness: Math.round(s.citizens.getAverageHappiness()),
      rci: {
        residential: s.rciDemand?.residential ?? 0,
        commercial: s.rciDemand?.commercial ?? 0,
        industrial: s.rciDemand?.industrial ?? 0,
      },
      power: { supply: s.power.getSupply(), demand: Math.round(s.power.getDemand()) },
      water: { supply: s.water.getSupply(), demand: Math.round(s.water.getDemand()) },
    };
  }

  buildings(query: BuildingQuery = {}): BuildingInfo[] {
    const s = this.getState();
    const grid = s.grid;
    const limit = query.limit ?? DEFAULT_BUILDING_LIMIT;
    const wanted = query.zone ? new Set(query.zone) : null;
    const r = query.rect;
    const out: BuildingInfo[] = [];

    const x1 = r ? Math.min(r.x1, r.x2) : 0;
    const x2 = r ? Math.max(r.x1, r.x2) : grid.width - 1;
    const y1 = r ? Math.min(r.y1, r.y2) : 0;
    const y2 = r ? Math.max(r.y1, r.y2) : grid.height - 1;

    for (let y = Math.max(0, y1); y <= Math.min(grid.height - 1, y2); y++) {
      for (let x = Math.max(0, x1); x <= Math.min(grid.width - 1, x2); x++) {
        if (out.length >= limit) return out;
        const cell = grid.getCell(x, y);
        if (!cell || cell.buildingId <= 0) continue;

        const derelict = DERELICT_RESERVED.includes(cell.reserved);
        if (query.derelictOnly && !derelict) continue;

        const zone = ZONE_NAMES[cell.zoneType] ?? 'none';
        if (wanted && !wanted.has(zone)) continue;

        const bt = getBuildingType(cell.buildingId);
        const key = `${x},${y}`;
        out.push({
          x, y,
          buildingId: cell.buildingId,
          name: bt?.name ?? `#${cell.buildingId}`,
          zone,
          level: bt?.level ?? 0,
          capacity: (bt?.residents ?? 0) + (bt?.workers ?? 0),
          residents: s.citizens.getCitizensByHome(key).length,
          workers: s.citizens.getCitizensByWorkplace(key).length,
          landValue: cell.landValue,
          pollution: cell.pollution,
          derelict,
        });
      }
    }
    return out;
  }

  citizens(query: CitizenQuery = {}): CitizenInfo[] {
    const s = this.getState();
    const limit = query.limit ?? DEFAULT_CITIZEN_LIMIT;

    let pool: readonly RawCitizen[];
    if (query.homeId) pool = s.citizens.getCitizensByHome(query.homeId) as readonly RawCitizen[];
    else if (query.workplaceId) pool = s.citizens.getCitizensByWorkplace(query.workplaceId) as readonly RawCitizen[];
    else pool = s.citizens.getCitizens() as readonly RawCitizen[];

    const out: CitizenInfo[] = [];
    for (const c of pool) {
      if (out.length >= limit) break;
      if (query.unemployedOnly && c.workplaceId) continue;
      out.push(describeCitizen(c, s.citySeed));
    }
    return out;
  }

  /**
   * One citizen, the same record the citizen detail panel shows.
   *
   * `null` when not found: citizens die and ids are not reused.
   */
  citizen(id: number): CitizenInfo | null {
    const s = this.getState();
    const c = s.citizens.getCitizen(id) as RawCitizen | undefined;
    return c ? describeCitizen(c, s.citySeed) : null;
  }

  services(): { total: number; items: ServiceInfo[] } {
    const s = this.getState();
    const keys = ['power', 'water', 'police', 'fire', 'health',
      'education', 'parks', 'garbage', 'sewage', 'deathCare'];
    const svcs = getCivicServices(s);
    return {
      total: Math.round(getTotalServiceMaintenanceCost(s)),
      items: svcs.map((svc, i) => ({
        key: keys[i] ?? `#${i}`,
        maintenance: Math.round(svc.getMaintenanceCost()),
      })),
    };
  }

  /** Transit, through the same `buildTransitRows()` the Overview Traffic page uses. */
  transit(): TransitSystemRow[] {
    const s = this.getState();
    return buildTransitRows(
      getTransitSystems(s).map(({ type, system }) => ({
        type,
        routes: system.getRoutes(),
        stops: system.getStops(),
        seatsPerVehicle: system.getCapacity(),
        speed: system.getSpeed(),
        vehicleCount: system.getVehicles().length,
        operatingCost: system.getOperatingCost(),
        segmentDistances: (routeId: number) => system.getSegmentDistances(routeId),
      })),
    );
  }

  // ── Already computed by Game ────────────────────────────────────
  //
  // Pass-through only. **There is no room to process anything here**: the panels read these
  // same functions, and a transformation in between is a second copy that will drift.
  //
  // Two fields are a `Map` / `Set` (`commuteStats().byHome` and a district's `cells`), which
  // `JSON.stringify` turns into `{}`. A caller sending them across a process boundary spreads
  // them itself with `[...map]`.

  /** The ledger breakdown, income and spending line by line, as the Economy panel shows it. */
  economyBreakdown(): EconomyBreakdownResult {
    return this.stats.getEconomyBreakdown();
  }

  /** Road cell counts and paying-driver counts per billable district. */
  billableDistricts(): readonly BillableDistrict[] {
    return this.stats.getBillableDistricts();
  }

  /** The commute time distribution. `byHome` is a `Map`. */
  commuteStats(): CommuteStats {
    return this.stats.getCommuteStats();
  }

  /** Traffic volume, the most congested segments, and average path length. */
  trafficStats(): TrafficStatsResult {
    return this.stats.getTrafficStats();
  }

  /** Transfer rate and transfer hotspots. */
  transferStats(): TransferStats {
    return this.stats.getTransferStats();
  }

  /** Abandonment stress on one cell, for spotting a building about to go derelict. */
  abandonmentStress(x: number, y: number): number {
    return this.stats.getAbandonmentStress(x, y);
  }

  /**
   * The currently selected building, the same record the detail panel shows.
   *
   * Selection is made by clicking — `act({ tool: 'select', x1, y1 })`. This only reads it. The
   * shape varies by building kind (`zone` / `infra` / `transport` and so on), so the type is
   * not narrowed here.
   */
  selected(): unknown {
    return this.stats.getSelectedBuilding();
  }

  // ── The eight Overview pages ────────────────────────────────────
  //
  // One method per page, matching the tabs on screen. **The panels read the same functions**,
  // so this layer has no arithmetic of its own and cannot drift into an API saying 75% while
  // the screen says 68% (BUG-342).
  //
  // The other two pages are above: Economy is `economyBreakdown()`, and Traffic is
  // `trafficStats()` + `transit()` + `transferStats()`.

  /** Summary: population, housing and jobs, attractiveness, and **the largest penalty**. */
  summary(): SummaryStats {
    return buildSummaryStats(this.getState());
  }

  /** Demographics: age and education distributions plus education x occupation and
   *  education x housing level cross-tabs. */
  demographics(): DemographicsStats {
    return buildDemographicsStats(this.getState());
  }

  /** Environment: ground pollution, noise, water pollution, fires and ruins. */
  environment(): EnvironmentStats {
    return buildEnvironmentStats(this.getState());
  }

  /**
   * The freight supply chain: output, consumption, imports and exports, and the throughput of
   * the three external connections.
   *
   * What shops actually receive is `effectiveProduction` (output - exports + imports), not
   * `production`.
   */
  freight(): FreightStats {
    return buildFreightStats(this.getState());
  }

  /** Infrastructure: power and water supply and demand, landfill, sewage and cemetery stocks
   *  and flows. */
  infra(): InfraStats {
    return buildInfraStats(this.getState());
  }

  /**
   * Services: coverage for all nine, plus load and capacity per facility.
   *
   * `capacity` sums only **operating** facilities — a police station without power does not
   * patrol. The broken ones are still listed in `facilities` with `operational: false`, which
   * is what makes a coverage drop explicable.
   *
   * Distinct from `services()`, which gives monthly maintenance costs.
   */
  serviceStats(): ServicesStats {
    return buildServicesStats(this.getState());
  }

  /**
   * Per-day economy and population history, the data behind the Economy page's two charts.
   *
   * **Not saved**: the UI accumulates one entry per day, so this is empty after loading a save.
   */
  chartHistory(): ChartHistory {
    return this.stats.chartHistory();
  }

  // ── Overlays ────────────────────────────────────────────────────

  /**
   * Service coverage — **the building colours the player sees on screen**.
   *
   * Green to yellow to red in 10 steps. The colour follows `severity`, **the worse of distance
   * and facility load**. `ratio` is the distance half (1 is exactly at the boundary) and `load`
   * the load half (1 is exactly full, 2 is demand at twice capacity). `facilityId` is the
   * facility serving that cell: it says which building to act on when an area turns red.
   *
   * **Presence in `cells` is coverage**, so this one answer covers both whether a cell is
   * covered and how marginally.
   *
   * The overlay need not be switched on: this is computed from state, independently of what is
   * displayed.
   */
  coverage(service: string): CoverageInfo | { service: string; reason: string } {
    if (!(COVERAGE_SERVICES as readonly string[]).includes(service)) {
      return { service, reason: `no road-cost coverage for ${service} (have: ${COVERAGE_SERVICES.join(', ')})` };
    }
    const src = this.stats.getCoverageCosts(service);
    if (!src) return { service, reason: `no road-cost coverage for ${service}` };

    return buildCoverage(service as CoverageService, {
      budget: src.budget,
      costs: src.costs,
      loadAt: src.loadAt,
      servingFacilityAt: src.servingFacilityAt,
      sources: this.stats.getOverlaySourceCells(service),
      gradient: this.stats.coverageGradient(),
    });
  }

  /**
   * The ground-tint overlay layer.
   *
   * `kind` says how to read the numbers: coverage-type ground layers are **binary**, 80 or 0
   * per cell, so a uniform field of 80 is not a sampling failure but the only two values there
   * are. For how marginal coverage is, see `coverage()`.
   */
  overlay(type: string): { type: string; kind: OverlayKind; cells: OverlayCellInfo[] } {
    return {
      type,
      kind: overlayKind(type),
      cells: buildOverlayCells(
        this.stats.getOverlayData(type),
        (value) => this.stats.getOverlayColor(type, value),
      ),
    };
  }

  /**
   * The raw fields of every cell in a rectangle.
   *
   * The most expensive read here: a full 60x60 is 3,600 rows. For checking whether a small plot
   * is buildable, not for surveying the whole city.
   */
  cells(rect: { x1: number; y1: number; x2: number; y2: number }) {
    const grid = this.getState().grid;
    const x1 = Math.max(0, Math.min(rect.x1, rect.x2));
    const x2 = Math.min(grid.width - 1, Math.max(rect.x1, rect.x2));
    const y1 = Math.max(0, Math.min(rect.y1, rect.y2));
    const y2 = Math.min(grid.height - 1, Math.max(rect.y1, rect.y2));
    const out: Array<{ x: number; y: number } & Record<string, number>> = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const cell = grid.getCell(x, y);
        if (cell) out.push({ x, y, ...cell });
      }
    }
    return out;
  }

  /**
   * Elevated road and rail segments, one row per segment, so two levels on one cell are two
   * rows.
   *
   * The `roadType` / `railType` that `cells()` returns are **all ground level** — it emits
   * `Grid`, while elevated segments live in `ElevationManager`. Bridges, ramps and stacked
   * levels are visible only here.
   *
   * Ordered by y, then x, then level, so two reads can be diffed.
   */
  elevated(rect?: { x1: number; y1: number; x2: number; y2: number }): ElevatedInfo[] {
    const bounds = rect ? {
      x1: Math.min(rect.x1, rect.x2), x2: Math.max(rect.x1, rect.x2),
      y1: Math.min(rect.y1, rect.y2), y2: Math.max(rect.y1, rect.y2),
    } : null;

    const out: ElevatedInfo[] = [];
    for (const e of this.stats.elevatedSegments()) {
      if (bounds && (e.x < bounds.x1 || e.x > bounds.x2 || e.y < bounds.y1 || e.y > bounds.y2)) continue;
      out.push({ x: e.x, y: e.y, level: e.level, ...e.data });
    }
    out.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.level - b.level));
    return out;
  }

  /**
   * Whether two cells are reachable from each other.
   *
   * `coverage()` cannot answer this: it is a flood **bounded by a budget**, so zero coverage
   * cannot distinguish "not connected" from "connected but too far" (BUG-368). This has no
   * bound.
   *
   * `cost` uses the same scale as `coverage()`, so comparing it against a `ROAD_COVERAGE`
   * budget answers whether a police station here would reach there. Unreachable is `-1`.
   *
   * Neither end need be a road cell: like zones and civic buildings, each attaches to a road
   * within 2 cells.
   */
  connected(from: { x: number; y: number }, to: { x: number; y: number }): ConnectivityResult {
    const graph = this.stats.roadCellGraph();
    // Reporting "connected" while the road lookup is unwired is far worse than reporting the
    // opposite: it would let a caller believe a bridge is finished.
    if (!graph) return { connected: false, cost: -1 };
    return roadConnectivity(graph, from, to);
  }
}

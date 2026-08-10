import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand, applyBusinessTaxPenalty, BUSINESS_TAX } from '../economy/RCIDemand';
import { buildingGrowthTick } from '../building/BuildingGrowthTick';
import { abandonmentStressTick } from '../building/AbandonmentStressTick';
import { migrationTick } from '../citizen/Migration';
import { birthTick } from '../citizen/Birth';
import { residentsAtHome } from '../citizen/HomeCapacity';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue, checkParkProximity } from '../economy/LandValue';
import { ZoneType, TerrainType, isResidentialZone, isCommercialZone, zoneToRCI } from '../grid/types';
import { RoadType } from '../road/types';
import { getLaneCount } from '../road/types';
import { LaneGraph, type LaneEdge } from '../traffic/LaneGraph';
import { findLanePath, findLanePathVariants } from '../traffic/LaneGraphPathfinder';
import { CommuteCache, type CachedRoute } from '../traffic/CommuteCache';
import { LaneGraphBuffer, type GraphMapping } from '../traffic/LaneGraphBuffer';
import { PathRequestBatcher } from '../traffic/PathRequestBatcher';
import type { WorkerRequest } from '../traffic/PathfindingWorkerHandler';
import { computeCongestionFlow, computeCongestionFlowMonteCarlo, type CongestionFlowDeps } from '../traffic/CongestionFlowPredictor';
import { getBuildingType } from '../building/types';
import { avgEducationScore } from '../building/BuildingUpgrade';
import { ECONOMY } from '../economy/TaxMultipliers';
import { DEFAULT_TAX_RATE } from '../economy/Tax';
import { getInfraBuildingId, getInfraConfigById, isZoneBuilding } from '../building/InfraConfig';
import { countZoneBuildings, countResidentialCapacity, countWorkplaceJobs, sumBuildingCapacity } from '../building/BuildingQueries';
import { forEachGridPollutionSource, GRID_POLLUTION } from '../environment/GridPollutionSources';
import { forEachServicePollutionSource } from '../environment/PollutionSourceRegistry';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../building/InfraPlacement';
import { calculateAbandonmentStress, ABANDONMENT, type AbandonmentConditions } from '../building/BuildingAbandonment';
import { isWorkingAge, type Citizen } from '../citizen/types';
import { countOccupancy, assignWithPreference, assignWorkWithPreference } from '../citizen/OccupancyAssignment';
import { buildHousingCandidates, buildWorkplaceCandidates } from '../citizen/BuildingCandidateBuilder';
import { calculateCityHappinessContext } from '../citizen/CityHappinessContext';
import { computeOccupancyRatios } from '../citizen/OccupancyRatio';
import type { WorkplaceCandidate } from '../citizen/WorkplaceScore';
import { relocationTick } from '../citizen/Relocation';
import { beginJobRelocation, jobRelocationTick, DEFAULT_JOB_RELOCATION_CONFIG,
  type JobRelocationSlicer } from '../citizen/JobRelocation';
import { roadDistanceToTargets } from '../service/RoadCoverageFlood';
import type { SchoolType, EnrolledCitizen } from '../service/EducationService';
import { EDUCATION_PROGRESSION, MIN_SCHOOL_AGE, type EducationRule, type DeathContext } from '../citizen/CitizenManager';
import { chooseMode, chooseModeMultiModal, type AvailableTransport } from '../transport/ModeChoice';
import { buildTransferGraph, buildStopRouteCache, findMultiModalRoutes, flattenSystems, type TransferGraph, type FlatRoute } from '../transport/MultiModalRouter';
import { calculateCitizenHealth, type HealthFactors } from '../citizen/CitizenHealth';
import { loadRatioToDeathMultiplier, uncoveredPollutionMultiplier } from '../service/HealthService';
import { TransportMode } from '../transport/types';
import { getSystemForMode, getTransitSystems, getTransitNetworkVersion, getTransitTopologyVersion, getTotalTransportOperatingCost, tickAllTransportSystems } from '../transport/TransportRegistry';
import { getTotalServiceMaintenanceCost, tickAllCivicServices, collectFacilityOperationalStatus, type FacilityOpEntry } from '../service/ServiceRegistry';
import { parsePosKey, parsePosKeyUnsafe, toPosKey, FOUR_NEIGHBORS, manhattanDistance, countRoadTiles, findNearRoad, type ReadableGrid } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import type { ResidentialShoppingStatus } from '../economy/ShoppingAccess';
import { applyFireDamage } from '../service/FireDamageProcessor';
import { getCellServiceScore, getResidentialServiceRatios, getCellServiceCostScore } from '../service/ServiceCoverageQuery';
import { calculatePoliceLoads, calculateFireLoads } from '../service/PoliceFireLoadCalculator';
import { getAvgResidentialPollution, avgResidentialAt, calculateCrimeRate } from '../environment/CityMetrics';
import { syncTrafficDensityToGrid } from '../environment/SyncTrafficDensity';
import { collectTradePositions, type TradePosition } from '../traffic/FreightTradeCollector';
import { calculateZoneIncomes } from '../economy/IncomeCalculator';
import { buildIncomeCalcDeps } from '../economy/IncomeCalcAdapter';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../economy/ExpenseCalculator';
import { calculateElevatedMaintenance } from '../elevation/ElevationMaintenance';
import { randomInt } from '../utils/random';
import { findAvailableTransit } from '../transport/TransitAvailability';
import { ServiceVehicleManager, type ServiceFacilityProvider, type ServiceVehicleType } from '../traffic/ServiceVehicleManager';
import { SidewalkGraph } from '../traffic/SidewalkGraph';
import { PedestrianManager, getMaxPedestrians, buildTripPool, sampleTrip, type AggregatedTrip, type WalkingTripPool } from '../traffic/PedestrianManager';
import { PedestrianTripType } from '../traffic/PedestrianAgent';
import { TRADE } from '../traffic/FreightSystem';
import { spawnFreightVehicles, rebuildActiveFreight, type FreightSpawnContext } from '../traffic/FreightVehicleSpawner';
import { HIGHWAY_EXTERNAL } from '../traffic/HighwayConnection';

import { SIMULATION } from './SimulationConstants';
import { TransferTracker } from '../transport/TransferTracker';
import { computeTransferStats, findTransferRouteStops, TRANSIT_ICONS } from '../transport/TransferStatsQuery';


/** Map CitizenManager schoolKey to EducationService SchoolType */
const SCHOOL_KEY_TO_TYPE: Record<EducationRule['schoolKey'], SchoolType> = {
  elementary: 'elementary',
  highSchool: 'highschool',
  university: 'university',
};

export class SimulationLoop {
  private state: GameState;
  private _elevationManager: import('../elevation/ElevationManager').ElevationManager | null = null;
  private _roadLookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup | null = null;
  // Per-day / per-month phase markers. Seeded from the clock in the constructor
  // rather than starting at -1: they are not serialized, so after loading a save
  // taken mid-day the first tick re-ran the whole daily block (an extra
  // independent death roll per citizen, plus advanceDay() rotating the 7-day
  // ring buffers a slot early and discarding a day of statistics) and the whole
  // monthly block (a second fertility roll for every fertile adult). Neither is
  // idempotent, which made save-and-load a population lever (BUG-088).
  private lastDeathDay: number;
  private lastBirthMonth: number;
  private lastRiderDay: number;

  // Lane-level connection graph for edge-based vehicle movement
  laneGraph: LaneGraph = new LaneGraph();
  private laneGraphDirty = true;

  // Building index: active zone buildings (excludes ABANDONED/BURNED). Rebuilt every slow tick.
  private buildingPositions: { pos: string; x: number; y: number; buildingId: number }[] = [];

  // Cached trade positions (rail stations + airports + highway edges) for freight vehicle spawning.
  private cachedTradePositions: { x: number; y: number; throughput: number; tradeKey: string }[] = [];

  /** Reusable scratch array for eligible commuting citizens. */
  private commuteEligibleScratch: Citizen[] = [];
  /** Citizens who currently have a vehicle on the road (rebuilt each tick from live vehicles). */
  private activeCommuters = new Set<number>();
  /** Freight source buildings with trucks on the road: key → count (rebuilt each tick). */
  private activeFreight = new Map<string, number>();

  // Commute path cache: stores computed LaneEdge paths for citizen commutes
  commuteCache: CommuteCache = new CommuteCache();

  // ── Pathfinding Worker (optional — async off-main-thread pathfinding) ──
  private graphBuffer: LaneGraphBuffer | null = null;
  private graphMapping: GraphMapping | null = null;
  private pathBatcher: PathRequestBatcher | null = null;
  private pathWorker: Worker | null = null;

  // Service vehicle manager: spawns patrol vehicles within service coverage
  private serviceVehicleManager = new ServiceVehicleManager();

  // Sidewalk graph: built alongside laneGraph
  private sidewalkGraphDirty = true;

  // Walking trip pool: rebuilt each rush period from commute mode distribution
  private walkingTripPool: WalkingTripPool = { trips: [], totalWeight: 0, prefixSums: [] };
  private tripPoolDirty = true;
  private tripAggMap = new Map<string, AggregatedTrip>();
  private pendingTrips: AggregatedTrip[] = [];

  // Multi-modal transfer graph (rebuilt when transit network changes)
  private transferGraph: TransferGraph = { byStop: new Map(), stopRouteCache: new Map() };
  private transferGraphDirty = true;
  /** Transit structural version at the last transfer-graph rebuild. */
  private lastTransitVersion = -1;
  /** Transit stop/route topology version at the last transfer-tracker reset. */
  private lastTransitTopologyVersion = -1;
  private flatRoutes: FlatRoute[] = [];
  /** Transfer usage tracking (extracted — SRP). */
  readonly transferTracker = new TransferTracker();

  /** Reusable Set for infrastructure positions (power/water plants). */
  private infraPositions = new Set<string>();
  /** Previous facility operational state keyed by "x,y" → operational boolean. */
  private prevFacilityOps = new Map<string, boolean>();
  /** Reusable scratch array for working-age citizens. */
  private workingAgeScratch: Citizen[] = [];
  /** Reusable Set for congestion flow cell collection. */
  private flowCellSet = new Set<string>();
  /** Reusable Map for traffic density sync (avoids per-call Map allocation). */
  private trafficFlowMap = new Map<string, number>();

  /** Per-building occupancy ratio (0.0–1.0) for rendering (updated after housing assignment). */
  occupancyRatios: Map<string, number> = new Map();

  /** Per-building abandonment stress (0–100). Key is "x,y". */
  abandonmentStress: Map<string, number> = new Map();

  /** Workplace distance cache — observer-invalidated, worker-computed. */
  private wpDistCache: import('../workplace/WorkplaceDistanceCache').WorkplaceDistanceCache | null = null;

  /** Set the workplace distance cache (called by Game.ts after construction). */
  setWorkplaceDistanceCache(cache: import('../workplace/WorkplaceDistanceCache').WorkplaceDistanceCache): void {
    this.wpDistCache = cache;
  }

  /** Called when building state changes (growth/demolish/burn/upgrade) */
  onBuildingsChanged?: () => void;
  /** Called when terrain-related state changes (pollution/land value) */
  onTerrainChanged?: () => void;

  /** Fine-grained building callbacks for incremental rendering */
  onBuildingAdded?: (x: number, y: number, zoneType: number, level: number) => void;
  onBuildingRemoved?: (x: number, y: number) => void;
  onBuildingUpdated?: (x: number, y: number, zoneType: number, level: number, burned: boolean, abandoned?: boolean) => void;
  /** Called when facility operational status changes (for light sync). */
  onFacilityOperationalChanged?: (changes: FacilityOpEntry[]) => void;

  setElevationManager(em: import('../elevation/ElevationManager').ElevationManager): void {
    this._elevationManager = em;
    this.state.highwayConnection.setElevationManager(em);
  }

  setRoadLookup(lookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup): void {
    this._roadLookup = lookup;
  }

  /**
   * Enable async off-main-thread pathfinding via a Web Worker.
   * When set, pathfinding requests are batched and sent to the worker each tick.
   * Results arrive 1-2 ticks later and are written into the CommuteCache routeIndex.
   */
  setPathfindingWorker(worker: Worker, maxPoints = 131072, maxEdges = 262144): void {
    this.pathWorker = worker;
    this.graphBuffer = new LaneGraphBuffer(maxPoints, maxEdges);
    this.pathBatcher = new PathRequestBatcher(worker, { pointIdToIndex: new Map(), edgeOriginals: [] });

    // Wire up result callback: convert edge indices → LaneEdge[] and store in routeIndex
    this.pathBatcher.onResult = (routeKey: string, variants: number[][]) => {
      if (!this.graphMapping || variants.length === 0) return;
      const edgeOriginals = this.graphMapping.edgeOriginals;
      const laneEdgeVariants: LaneEdge[][] = [];
      for (const v of variants) {
        const edges: LaneEdge[] = [];
        for (const idx of v) {
          const original = edgeOriginals[idx];
          if (original) edges.push(original);
        }
        if (edges.length > 0) laneEdgeVariants.push(edges);
      }
      if (laneEdgeVariants.length > 0) {
        this.commuteCache.setRouteVariants(routeKey, laneEdgeVariants);
      }
    };

    // Send INIT_GRAPH to worker
    const msg: WorkerRequest = {
      type: 'INIT_GRAPH',
      graphSAB: this.graphBuffer.getBuffer(),
      maxPoints,
      maxEdges,
    };
    worker.postMessage(msg);
  }

  constructor(state: GameState) {
    this.state = state;
    // The current day/month have already had their blocks run — either by the
    // session that produced this save, or (for a new game at tick 0) because no
    // time has elapsed yet. Both blocks belong to day/month *transitions*.
    this.lastDeathDay = state.clock.getDay();
    this.lastRiderDay = state.clock.getDay();
    this.lastBirthMonth = state.clock.getMonth();
    // Auto-clear commute cache when citizens are evicted from any building
    this.state.citizens.onEvicted = (ids) => {
      for (const id of ids) this.commuteCache.remove(id);
    };
  }

  // hasRunDayBlockFor / hasRunMonthBlockFor were removed: they simply re-read
  // the field the constructor had just assigned from the clock, so every test
  // built on them asserted `getDay() === getDay()` and stayed green with the
  // whole fix reverted. LoadDoesNotRerunDailyBlocks now observes the blocks'
  // effects (ring-buffer rotation, rider rollover, newborn count) instead.

  tick(): void {
    if (!this.state.clock.advance()) return;

    const tick = this.state.clock.tick;
    // Slow-update operations are staggered across 6 tick offsets to spread CPU load.
    // Each subsystem still runs every 6 ticks, but on different frames.
    const slowSlot = tick % SIMULATION.SLOW_TICK_INTERVAL;

    // Mark building index dirty each tick so the first caller gets a fresh scan.
    // Subsequent rebuildBuildingIndex() calls within the same tick are no-ops.
    this.buildingIndexDirty = true;

    // The capacity gate stays here — every path that adds a citizen this tick
    // reads it, births included.
    //
    // A month boundary is always tick % 720 === 0, hence always slow-slot 0, so
    // births and runMigration (slot 5) never fall on the same tick — ordering
    // them relative to each other changes nothing. What did matter is that the
    // aggregate capacity gate in createCitizen counts citizens who have no home
    // at all; see the bypass in runBirths.
    this.state.citizens.updateResidentialCapacity(countResidentialCapacity(this.state.grid));

    // ── Slot 0: Economy (RCI demand + budget) ──
    if (slowSlot === 0) {
      const rci = calculateRCIDemand({
        residentialSupply: countZoneBuildings(this.state.grid, isResidentialZone),
        commercialSupply: countZoneBuildings(this.state.grid, isCommercialZone),
        industrialSupply: countZoneBuildings(this.state.grid, t => t === ZoneType.INDUSTRIAL),
        population: this.state.citizens.getPopulation(),
        jobOpenings: this.countJobOpenings(),
        exportDemand: SIMULATION.EXPORT_DEMAND,
        freightShortageRatio: this.state.freight.getShortageRatio(),
        freightSurplusRatio: this.state.freight.getSurplusRatio(),
      });
      this.state.rciDemand = applyBusinessTaxPenalty(
        rci, this.state.taxRates.business ?? BUSINESS_TAX.BASELINE,
      );
      this.state.budget = tickBudget(this.state.budget);
      this.state.globalMarket.tick();
    }

    // ── Slot 1: Power / Water / Sewage coverage ──
    if (slowSlot === 1) {
      this.infraPositions.clear();
      for (const p of this.state.power.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
      for (const p of this.state.water.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
      for (const p of this.state.sewage.getTreatmentPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
      this.state.power.calculateDemand(this.state.grid);
      this.state.power.calculateCoverage(this.state.grid, this.infraPositions);
      this.state.water.calculateDemand(this.state.grid);
      this.state.water.calculateCoverage(this.state.grid, this.infraPositions);
      this.state.sewage.calculateDemand(this.state.grid);
      this.state.sewage.calculateCoverage(this.state.grid, this.infraPositions);
    }

    // ── Slot 2: Civic services + fire + service vehicles ──
    if (slowSlot === 2) {
      tickAllCivicServices(this.state);
      this.emitFacilityOperationalChanges();
      this.processFireEvents();
      this.tickServiceVehicles();
    }

    // ── Slot 3: Building growth + upgrades + abandonment ──
    if (slowSlot === 3) {
      this.tryBuildingGrowth();
      this.tryBuildingUpgrades();
      this.processAbandonmentStress();
    }

    // ── Slot 4: Education + happiness + health ──
    if (slowSlot === 4) {
      const capacity = {
        elementary: this.state.education.getTotalCapacity('elementary'),
        highSchool: this.state.education.getTotalCapacity('highschool'),
        university: this.state.education.getTotalCapacity('university'),
      };
      this.state.citizens.educateTick((x, y, schoolKey) => {
        const type = SCHOOL_KEY_TO_TYPE[schoolKey];
        return this.state.education.getCoverage(x, y, type);
      }, capacity);
      this.updateCitizenHappiness();
      this.updateCitizenHealth();
      this.updateHospitalLoads();
      this.updateSchoolLoads();
      this.updatePoliceFireLoads();
    }

    // ── Slot 5: Migration + housing + freight + shopping ──
    if (slowSlot === 5) {
      this.runMigration();
      this.assignCitizenHousing();

      // Freight: collect trade positions + BFS supply calculation (delegated to FreightTradeCollector)
      const perStationThroughput = TRADE.RAIL_THROUGHPUT_PER_STATION;
      const railStations: { x: number; y: number; throughput: number }[] = [];
      if (this.state.rail.hasExternalConnection) {
        for (const s of this.state.rail.getStations()) {
          if (this.state.rail.isStationExternal(s.x, s.y)) {
            railStations.push({ x: s.x, y: s.y, throughput: perStationThroughput });
          }
        }
      }
      const highwayCells: { x: number; y: number; throughput: number }[] = [];
      if (this.state.highwayConnection.hasExternalConnection) {
        const hwThroughput = this.state.highwayConnection.getThroughput();
        const hwEdge = this.state.highwayConnection.getEdgeHighwayCells();
        const perCell = hwEdge.length > 0 ? Math.ceil(hwThroughput / hwEdge.length) : 0;
        for (const c of hwEdge) highwayCells.push({ x: c.x, y: c.y, throughput: perCell });
      }
      const tradeResult = collectTradePositions(this.state.grid, {
        railStations,
        airports: this.state.airport.getAirports().map(ap => ({ x: ap.x, y: ap.y, cargoPerTick: ap.cargoPerTick })),
        highwayCells,
      }, (bid) => getInfraConfigById(bid));
      this.state.freight.calculateSupply(this.state.grid, {
        importCapacity: tradeResult.totalThroughput,
        exportCapacity: tradeResult.totalThroughput,
        tradePositions: tradeResult.positions,
      });
      this.cachedTradePositions = tradeResult.positions;
      this.state.shopping.calculate(this.state.grid);
      // Income calculated last in the 6-tick cycle (after all subsystems have updated)
      this.calculateIncome();
    }

    // ── Medium-frequency operations (every 60 ticks, offset to slot 2 to avoid collision with slot 0) ──
    if (tick >= 2 && (tick - 2) % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.updatePollution();
      this.updateLandValue();
      this.onTerrainChanged?.();
      this.runRelocation();
      this.state.rail.updateExternalConnection(this.state.grid.width, this.state.grid.height, this.state.grid);
      this.state.highwayConnection.updateExternalConnection(this.state.grid.width, this.state.grid.height, this.state.grid);
    }

    // ── Per-day operations ──
    //
    // Births come AFTER this block, not before it. A month boundary is
    // floor(day/30) changing and a day boundary is floor(tick/24) changing, so
    // the month boundary at tick 720 is also a day boundary — and running
    // births first meant birthTick picked parents from ages last recomputed a
    // day earlier, and every newborn was in the list deathTick then walked,
    // facing a death roll before it was a tick old.

    // 5a. Daily: update citizen ages from birthTick + death check
    const currentDay = this.state.clock.getDay();
    if (currentDay !== this.lastDeathDay) {
      this.lastDeathDay = currentDay;
      this.state.citizens.updateAges(this.state.clock.tick);
      this.state.deathCare.advanceDay();
      this.state.fire.advanceDay();
      this.state.garbage.advanceDay();

      this.updateHospitalLoads();
      const hospitalMult = loadRatioToDeathMultiplier(this.state.health.getLoadRatio());

      const deadIds = this.state.citizens.deathTick(
        (citizen): DeathContext => {
          if (!citizen.homeId) return { hospitalMult: 1.0, pollutionMult: 1.0 };
          const pos = parsePosKey(citizen.homeId);
          if (!pos) return { hospitalMult: 1.0, pollutionMult: 1.0 };
          const covered = this.state.health.getCoverage(pos.x, pos.y);
          if (covered) return { hospitalMult, pollutionMult: 1.0 };
          const cell = this.state.grid.getCell(pos.x, pos.y);
          return { hospitalMult: 1.0, pollutionMult: uncoveredPollutionMultiplier(cell?.pollution ?? 0) };
        }
      );
      for (const d of deadIds) {
        this.commuteCache.remove(d.id);
        if (d.homeId) {
          const pos = parsePosKey(d.homeId);
          if (pos) { this.state.deathCare.reportDeath(pos.x, pos.y); continue; }
        }
        this.state.deathCare.reportDeath(0, 0);
      }
    }

    // 5a2. Daily: roll over transit stop rider counts
    if (currentDay !== this.lastRiderDay) {
      this.lastRiderDay = currentDay;
      this.rolloverTransitRiders();
    }

    // 5b. Monthly: births, now that today's ages are current and today's deaths
    // have been taken.
    this.runBirths();

    // ── Per-tick operations ──

    // 換工作：每 JOB_RELOCATION_INTERVAL 個 tick 開一輪，然後**每個 tick**
    // 推進一小片。以前是整輪擠在開輪的那一個 tick 裡跑完（BUG-109）。
    if (tick >= 4 && (tick - 4) % SIMULATION.JOB_RELOCATION_INTERVAL === 0) {
      this.runJobRelocation();
    }
    this.advanceJobRelocation();

    // Rebuild lane graph if roads changed
    if (this.laneGraphDirty) {
      this.rebuildLaneGraph();
      this.laneGraphDirty = false;
    }
    // Rebuild sidewalk graph if roads changed
    if (this.sidewalkGraphDirty) {
      this.rebuildSidewalkGraph();
      this.sidewalkGraphDirty = false;
    }

    // Transfer graph must be refreshed BEFORE spawning, and independently of
    // whether spawning happens at all — spawnVehicles bails out on an empty or
    // capped city, which used to strand the rebuild (see the method's comment).
    this.rebuildTransferGraphIfDirty();

    // Traffic - spawn commute vehicles (every tick)
    this.spawnVehicles();

    // Transport systems (every tick) — pass utility checkers for operational status
    this.state.bus.congestionLevel = this.state.traffic.getCongestionLevel();
    {
      const isPow = (x: number, y: number) => this.state.power.isPowered(x, y);
      const isWat = (x: number, y: number) => this.state.water.isSupplied(x, y);
      tickAllTransportSystems(this.state, isPow, isWat);
    }

    // Congestion flow prediction (first tick + every 60 ticks, offset to slot 2)
    if (tick === 1 || (tick >= 2 && (tick - 2) % SIMULATION.MEDIUM_TICK_INTERVAL === 0)) {
      this.computeCongestionFlow();
    }
  }

  getState(): GameState {
    return this.state;
  }


  /**
   * Posts nobody is filling.
   *
   * This used to subtract the whole POPULATION from total jobs, treating every
   * baby, schoolchild and retiree as an occupied desk. Roughly 43% of a city's
   * citizens are outside working age once retirement is in play, so a city with
   * a normal age pyramid reported zero openings while that share of its offices
   * and factories stood permanently empty — suppressing the residential demand
   * that would have brought in the workers to fill them.
   */
  private countJobOpenings(): number {
    const totalJobs = this.countTotalJobs();
    return Math.max(0, totalJobs - this.state.citizens.getEmployedCount());
  }

  private tryBuildingGrowth(): void {
    const grid = this.state.grid;

    // Delegated to BuildingGrowthTick (SRP — building growth logic separated from orchestration)
    const result = buildingGrowthTick({
      grid,
      tryGrow: (x, y, conditions) => this.state.buildingGrowth.tryGrow(x, y, conditions),
      rciDemand: this.state.rciDemand,
      isPowered: (x, y) => this.state.power.isPowered(x, y),
      isWatered: (x, y) => this.state.water.isSupplied(x, y),
      getDistrictAt: (x, y) => this.state.districts.getDistrictAt(x, y),
      canBuildInDistrict: (id, zt) => this.state.policies.canBuildInDistrict(id, zt),
      clearPendingDeathAt: (x, y) => this.state.deathCare.clearPendingAt(x, y),
      clearPendingGarbageAt: (x, y) => this.state.garbage.clearPendingAt(x, y),
      growthAttempts: SIMULATION.GROWTH_ATTEMPTS,
      burnedClearanceChance: SIMULATION.BURNED_CLEARANCE_CHANCE,
      getBuildingLevel: (bid) => getBuildingType(bid)?.level ?? 1,
      randomInt,
      randomFloat: Math.random,
    });

    // Fire fine-grained callbacks
    for (const r of result.removed) {
      this.abandonmentStress.delete(`${r.x},${r.y}`);
      this.onBuildingRemoved?.(r.x, r.y);
    }
    for (const a of result.added) {
      this.onBuildingAdded?.(a.x, a.y, a.zoneType, a.level);
    }

    if (result.changed) {
      this.onBuildingsChanged?.();
      this.wpDistCache?.invalidate();
      // Incrementally update sidewalk graph for new/removed buildings
      if (result.affectedCells.length > 0) {
        this.applyBuildingRemoval(result.affectedCells);
      }
    }
  }

  private runMigration(): void {
    const pop = this.state.citizens.getPopulation();
    // Use actual average citizen happiness; empty city gets default 70
    const avgHappiness = pop > 0
      ? this.state.citizens.getAverageHappiness()
      : SIMULATION.DEFAULT_HAPPINESS;
    // Calculate unemployment rate inline (no filter arrays)
    const citizens = this.state.citizens.getCitizens();
    let workingAgeCount = 0;
    let unemployedCount = 0;
    for (const c of citizens) {
      if (isWorkingAge(c.age)) {
        workingAgeCount++;
        if (c.workplaceId === null) unemployedCount++;
      }
    }
    const unemploymentRate = workingAgeCount > 0 ? unemployedCount / workingAgeCount : 0;

    // Calculate workplace zone ratios for education-weighted immigration.
    //
    // Numerator and denominator must be the same unit. These used to be a
    // building COUNT over a JOB count: the smallest office has 15 workers, so an
    // all-office city topped out at a ratio of 0.067 against a 0.3 threshold,
    // and the smallest factory has 10, capping industrial at 0.1 against 0.5 —
    // both HIGH_OFFICE and HIGH_INDUSTRIAL weightings were unreachable. Using
    // sumBuildingCapacity on both sides also inherits its ruin/multi-cell
    // exclusions, so a heavily abandoned city can no longer push the ratio above
    // 1 and trip the thresholds at exactly the wrong moment (BUG-085).
    const totalWorkplaces = countWorkplaceJobs(this.state.grid) || 1;
    const officeJobs = sumBuildingCapacity(this.state.grid, t => t === ZoneType.OFFICE, bt => bt.workers);
    const industrialJobs = sumBuildingCapacity(this.state.grid, t => t === ZoneType.INDUSTRIAL, bt => bt.workers);

    const city = {
      jobOpenings: this.countJobOpenings(),
      vacantHomes: this.countVacantHomes(),
      avgHappiness,
      taxRate: this.state.taxRates.residential ?? DEFAULT_TAX_RATE,
      pollution: this.getAvgPollution(),
      crimeRate: this.getAvgCrime(),
      unemploymentRate,
      hasUniversity: this.state.education.getTotalCapacity('university') > 0,
      officeRatio: officeJobs / totalWorkplaces,
      industrialRatio: industrialJobs / totalWorkplaces,
      avgLandValue: this.getAvgLandValue(),
    };
    // Build per-building vacancy list for family immigration
    const homeOcc = countOccupancy(citizens, c => c.homeId);
    const vacancies: import('../citizen/Migration').HousingVacancy[] = [];
    this.rebuildBuildingIndex();
    for (const bp of this.buildingPositions) {
      const cell = this.state.grid.getCell(bp.x, bp.y);
      if (!cell || !cell.buildingId) continue;
      const bt = getBuildingType(cell.buildingId);
      if (!bt || bt.residents <= 0) continue;
      const pos = `${bp.x},${bp.y}`;
      vacancies.push({ pos, capacity: bt.residents, occupied: homeOcc.get(pos) ?? 0 });
    }

    const { emigratedIds } = migrationTick(this.state.citizens, city, pop, this.state.clock.tick, vacancies);
    for (const id of emigratedIds) {
      this.commuteCache.remove(id);
    }
  }

  private updateCitizenHappiness(): void {
    const taxRate = this.state.taxRates.residential ?? DEFAULT_TAX_RATE;
    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Calculate city-wide happiness context (SRP: pure calculation in CityHappinessContext)
    const citizens = this.state.citizens.getCitizens();
    let adultCount = 0;
    for (const c of citizens) { if (isWorkingAge(c.age)) adultCount++; }
    const ctx = calculateCityHappinessContext({
      totalJobs: this.countTotalJobs(),
      adultCount,
      // Noise-free pollution here: `cell.pollution` is ground + water + noise,
      // and Happiness applies a threshold penalty to avgPollution AND another to
      // avgNoise, so a purely traffic-noisy district was penalised twice — -18
      // where -8 was intended. updateLandValue already keeps the two separate;
      // only this path conflated them (BUG-093). The grid field stays as the
      // total, which is what the pollution overlay should show.
      avgPollution: this.getAvgPollutionExcludingNoise(),
      avgNoise: this.getAvgNoise(),
      avgCrime: this.getAvgCrime(),
      residentialBuildingCount: countZoneBuildings(this.state.grid, isResidentialZone),
      serviceRatios: this.getServiceRatios(),
    });

    // Check if any parks exist for happiness bonus
    const hasParkCoverage = this.state.parks.getParks().length > 0;
    const currentTick = this.state.clock.tick;

    // Shopping access: only penalise when population >= threshold (early game protection)
    const enableShopping = pop >= SIMULATION.SHOPPING_POP_THRESHOLD;

    // Pre-build pending death counts per position for per-citizen happiness
    const pendingDeathCounts = new Map<string, number>();
    for (const d of this.state.deathCare.getPendingDeathQueue()) {
      const key = toPosKey(d.x, d.y);
      pendingDeathCounts.set(key, (pendingDeathCounts.get(key) ?? 0) + 1);
    }
    // Pre-build pending garbage counts per position
    const pendingGarbageCounts = new Map<string, number>();
    for (const g of this.state.garbage.getPendingGarbageQueue()) {
      const key = toPosKey(g.x, g.y);
      pendingGarbageCounts.set(key, (pendingGarbageCounts.get(key) ?? 0) + 1);
    }

    // Reusable factors object — mutated per citizen, no allocation per iteration
    const factors: HappinessFactors = {
      commuteDistance: 0, hasPark: hasParkCoverage,
      pollution: ctx.avgPollution, noiseLevel: ctx.avgNoise,
      crimeRate: ctx.avgCrime, isEmployed: true,
      taxRate, serviceCoverage: ctx.serviceCoverage,
      currentTick, homePowered: true, homeWatered: true,
      workplaceZoneType: undefined,
      shoppingAccess: undefined,
      pendingDeathsAtHome: 0,
      pendingGarbageAtHome: 0,
    };

    for (const citizen of citizens) {
      // Vary commute per citizen (+/- 3 random jitter)
      factors.commuteDistance = Math.max(1, ctx.avgCommute + (Math.random() * SIMULATION.COMMUTE_JITTER - SIMULATION.COMMUTE_JITTER / 2));

      // Check if citizen's home has power and water
      factors.homePowered = true;
      factors.homeWatered = true;
      factors.shoppingAccess = undefined;
      factors.pendingDeathsAtHome = 0;
      factors.pendingGarbageAtHome = 0;
      if (citizen.homeId) {
        const pos = parsePosKey(citizen.homeId);
        if (pos) {
          factors.homePowered = this.state.power.isPowered(pos.x, pos.y);
          factors.homeWatered = this.state.water.isSupplied(pos.x, pos.y);
          if (enableShopping) {
            factors.shoppingAccess = this.state.shopping.getResidentialAccess(pos.x, pos.y).ratio;
          }
          factors.pendingDeathsAtHome = pendingDeathCounts.get(citizen.homeId) ?? 0;
          factors.pendingGarbageAtHome = pendingGarbageCounts.get(citizen.homeId) ?? 0;
        }
      }

      // Get workplace zone type for job mismatch penalty
      factors.workplaceZoneType = undefined;
      if (citizen.workplaceId) {
        const wpos = parsePosKey(citizen.workplaceId);
        if (wpos) {
          const wcell = this.state.grid.getCell(wpos.x, wpos.y);
          if (wcell) factors.workplaceZoneType = wcell.zoneType;
        }
      }

      // Read the authoritative per-citizen field. The old statistical model
      // (Math.random() < ctx.employmentRate, where employmentRate is
      // totalJobs/adultCount over raw grid capacity) made the whole unemployment
      // ladder unreachable: any city with more job slots than adults has
      // employmentRate === 1, so every citizen was flagged employed regardless of
      // whether they actually held a job (BUG-057).
      factors.isEmployed = !isWorkingAge(citizen.age) || citizen.workplaceId !== null;
      citizen.happiness = calculateHappiness(citizen, factors);
    }
  }

  private updateHospitalLoads(): void {
    const coveredCitizens: Array<{ x: number; y: number; pollution: number }> = [];
    for (const c of this.state.citizens.getCitizens()) {
      if (!c.homeId) continue;
      const pos = parsePosKey(c.homeId);
      if (!pos || !this.state.health.getCoverage(pos.x, pos.y)) continue;
      const cell = this.state.grid.getCell(pos.x, pos.y);
      coveredCitizens.push({ x: pos.x, y: pos.y, pollution: cell?.pollution ?? 0 });
    }
    this.state.health.updateLoads(coveredCitizens);
  }

  private updateSchoolLoads(): void {
    const enrolled: EnrolledCitizen[] = [];
    const eligible: EnrolledCitizen[] = [];
    for (const c of this.state.citizens.getCitizens()) {
      if (!c.homeId || c.age < MIN_SCHOOL_AGE) continue;
      const pos = parsePosKey(c.homeId);
      if (!pos) continue;
      const rule = EDUCATION_PROGRESSION.find(r => c.education === r.requiredEducation);
      if (!rule) continue;
      if (c.educationProgress > 0) {
        enrolled.push({ x: pos.x, y: pos.y, schoolKey: rule.schoolKey });
      } else {
        // Eligible but not enrolled (waiting for capacity)
        const schoolType = ({ elementary: 'elementary', highSchool: 'highschool', university: 'university' } as const)[rule.schoolKey];
        if (this.state.education.getCoverage(pos.x, pos.y, schoolType)) {
          eligible.push({ x: pos.x, y: pos.y, schoolKey: rule.schoolKey });
        }
      }
    }
    this.state.education.updateSchoolLoads(enrolled, eligible);
  }

  private updatePoliceFireLoads(): void {
    const citizens = this.state.citizens.getCitizens();
    const grid = this.state.grid;
    const getResidents = (id: number) => getBuildingType(id)?.residents ?? 1;

    const policeDemands = calculatePoliceLoads(citizens, this.state.police, grid);
    const fireDemands = calculateFireLoads(citizens, this.state.fire, grid, getResidents);

    this.state.police.updateStationLoads(policeDemands);
    this.state.fire.updateStationLoads(fireDemands);
  }

  /** Reusable health factors object — mutated per citizen, no allocation per iteration. */
  private healthFactors: HealthFactors = {
    hospitalCostRatio: -1, hasParkCoverage: false,
    pollution: 0, hasHome: false, age: 0,
  };

  private updateCitizenHealth(): void {
    const citizens = this.state.citizens.getCitizens();
    if (citizens.length === 0) return;

    const f = this.healthFactors;

    for (const c of citizens) {
      f.hasHome = !!c.homeId;
      f.hospitalCostRatio = -1;
      f.hasParkCoverage = false;
      f.pollution = 0;
      f.age = c.age;

      if (c.homeId) {
        const pos = parsePosKey(c.homeId);
        if (pos) {
          f.hospitalCostRatio = this.state.health.getCostRatio(pos.x, pos.y);
          f.hasParkCoverage = this.state.parks.getCoverage(pos.x, pos.y);
          const cell = this.state.grid.getCell(pos.x, pos.y);
          if (cell) f.pollution = cell.pollution;
        }
      }

      c.health = calculateCitizenHealth(f);
    }
  }

  // Only check service coverage for residential buildings — residents care about
  // their own power/water, not whether distant factories have coverage.
  private getServiceRatios() {
    return getResidentialServiceRatios(this.state);
  }

  private countTotalJobs(): number {
    return countWorkplaceJobs(this.state.grid);
  }

  private getAvgLandValue(): number {
    let total = 0;
    let count = 0;
    this.state.grid.forEachCell((cell) => {
      if (cell.buildingId > 0) { total += cell.landValue; count++; }
    });
    return count > 0 ? total / count : 0;
  }

  private getAvgPollution(): number {
    return getAvgResidentialPollution(this.state.grid);
  }

  private getAvgNoise(): number {
    // Read live noise, not cell.noiseLevel. That field is written only by
    // updateLandValue, which runs every MEDIUM_TICK_INTERVAL (60 ticks), while
    // growth and happiness run every 6 — so every residential building grown in
    // the last 10 slow ticks passes the `buildingId > 0` filter carrying a
    // noiseLevel of 0. BUG-092 removed the empty-zoned-cell half of the
    // dilution and left this half in place (BUG-121).
    return avgResidentialAt(this.state.grid, (x, y) =>
      this.state.pollution.getPollutionAt(x, y).noise);
  }

  /** Residential pollution excluding the noise component — see the happiness call site. */
  private getAvgPollutionExcludingNoise(): number {
    return avgResidentialAt(this.state.grid, (x, y) => {
      const p = this.state.pollution.getPollutionAt(x, y);
      return p.ground + p.water;
    });
  }

  private getAvgCrime(): number {
    return calculateCrimeRate(
      this.state.citizens.getPopulation(),
      this.state.police.getStations().length,
    );
  }

  private countVacantHomes(): number {
    const capacity = countResidentialCapacity(this.state.grid);
    return Math.max(0, capacity - this.state.citizens.getPopulation());
  }

  private calculateIncome(): void {
    // DRY: same adapter used by Game.getEconomyBreakdown
    const incomes = calculateZoneIncomes(buildIncomeCalcDeps(this.state));
    let totalIncome = incomes.residential + incomes.commercial + incomes.industrial + incomes.office;

    // Apply city-wide specialization revenue multiplier
    const citySpecBonus = this.state.citySpec.getBonus();
    totalIncome *= citySpecBonus.revenueMultiplier;

    this.state.budget.income = totalIncome;
    // Expenses: road maintenance + service + district policies + transport
    this.state.budget.expenses = calculateTotalExpenses({
      roadMaintenance: this.countRoadTiles() * ECONOMY.ROAD_MAINTENANCE_PER_TILE,
      serviceCost: getTotalServiceMaintenanceCost(this.state),
      policyCost: calculateDistrictPolicyCost(this.state.districts.getAllDistricts()),
      transportCost: getTotalTransportOperatingCost(this.state),
      elevatedMaintenance: this._elevationManager
        ? calculateElevatedMaintenance(this._elevationManager) : 0,
    });
  }

  private countRoadTiles(): number {
    return countRoadTiles(this.state.grid);
  }

  /**
   * Detect facility operational status changes and fire callback for light sync.
   */
  private emitFacilityOperationalChanges(): void {
    if (!this.onFacilityOperationalChanged) return;
    const current = collectFacilityOperationalStatus(this.state);
    const changes: FacilityOpEntry[] = [];
    const newMap = new Map<string, boolean>();
    for (const entry of current) {
      const key = `${entry.x},${entry.y}`;
      newMap.set(key, entry.operational);
      const prev = this.prevFacilityOps.get(key);
      if (prev !== entry.operational) {
        changes.push(entry);
      }
    }
    // Also detect removed facilities (were in prev but not in current)
    for (const [key, wasOp] of this.prevFacilityOps) {
      if (!newMap.has(key) && wasOp) {
        const [x, y] = key.split(',').map(Number);
        changes.push({ x: x!, y: y!, operational: false });
      }
    }
    this.prevFacilityOps = newMap;
    if (changes.length > 0) {
      this.onFacilityOperationalChanged(changes);
    }
  }

  /**
   * Process fire events: try triggering random fires and resolve completed ones.
   * Resolved fires with high damage mark buildings as BURNED (reserved=3).
   * BURNED buildings remain on map as charred ruins until demolished/rebuilt.
   */
  private processFireEvents(): void {
    const pop = this.state.citizens.getPopulation();
    const fire = this.state.fire;

    // Try to start a random fire (very low probability)
    fire.tryRandomFire(this.state.grid, pop);

    // Resolve completed fires and apply damage (delegated to FireDamageProcessor — SRP)
    const resolved = fire.resolveCompletedFires();
    const { changed, updates } = applyFireDamage(this.state.grid, resolved);

    for (const u of updates) {
      // A burned building is out of service, so its occupants must be released
      // exactly like abandonment/demolish/disaster do. Without this they are
      // stranded permanently: rebuildBuildingIndex drops BURNED cells from the
      // housing/workplace candidates while the citizens still hold the posKey,
      // and neither assignWithPreference (skips a non-null homeId) nor
      // relocationTick (bails without a current candidate) can ever recover
      // them (BUG-056).
      if (u.burned) this.takeBuildingOutOfService(u.x, u.y);
      this.onBuildingUpdated?.(u.x, u.y, u.zoneType, u.level, u.burned);
    }
    if (changed) { this.onBuildingsChanged?.(); this.wpDistCache?.invalidate(); }
  }

  /**
   * Release the occupants of a building that has just stopped functioning.
   * Every path that takes a zone building out of service must go through here
   * so a newly added state cannot silently skip eviction (BUG-056).
   */
  private takeBuildingOutOfService(x: number, y: number): void {
    this.state.citizens.evictBuilding(toPosKey(x, y), this.state.clock.tick);
  }

  private updatePollution(): void {
    const grid = this.state.grid;
    const pm = this.state.pollution;

    // Sync predicted traffic flow → grid trafficDensity for noise pollution
    this.syncTrafficDensity();

    pm.clearSources();

    // Add pollution sources directly (no intermediate arrays)
    forEachGridPollutionSource(grid, (src) => pm.addPollutionSource(src), (x, y) => {
      const em = this._elevationManager;
      if (!em) return 0;
      // The noisiest elevated ROAD tier, across all levels. Reading the highest
      // LEVEL's roadType reported 0 whenever an elevated rail deck sat over an
      // elevated motorway — the BUG-099 symptom, one layer up.
      // Loudest by NOISE, not by enum ordinal: ONE_WAY sorts above HIGHWAY
      // numerically while being far quieter.
      return em.getHighestRoadType(x, y, t => GRID_POLLUTION.ROAD_SPEED_FACTOR[t] ?? 0);
    });
    // OCP: service-based pollution sources via registry — adding new sources only needs registry update
    forEachServicePollutionSource(this.state, (src) => pm.addPollutionSource(src));

    pm.calculateSpread();

    // Write pollution back to grid cells (single-field write, no object allocation)
    grid.forEachCell((cell, x, y) => {
      const p = pm.getPollutionAt(x, y);
      const total = Math.min(SIMULATION.CELL_VALUE_MAX, p.ground + p.water + p.noise);
      if (cell.pollution !== total) {
        grid.setField(x, y, 'pollution', total);
      }
    });
  }

  /** Delegated to SyncTrafficDensity module (SRP) with reusable Map (zero GC). */
  private syncTrafficDensity(): void {
    syncTrafficDensityToGrid(
      this.state.grid, this.state.traffic,
      this._elevationManager, this.trafficFlowMap,
    );
  }

  private updateLandValue(): void {
    const grid = this.state.grid;
    const parkBuildingId = getInfraBuildingId('park');

    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;

      const pollution = this.state.pollution.getPollutionAt(x, y);
      const serviceCoverage = getCellServiceScore(this.state, x, y);

      // Check if near water, forest (natural park), or placed park within 2 cells
      let waterfront = false;
      for (const [dx, dy] of FOUR_NEIGHBORS) {
        if (grid.getField(x + dx!, y + dy!, 'terrainType') === TerrainType.WATER) {
          waterfront = true; break;
        }
      }
      const parkProximity = checkParkProximity(
        grid, x, y,
        this.state.parks.getCoverage(x, y),
        parkBuildingId,
      );

      // Industrial zones are less affected by their own pollution
      const pollutionFactor = cell.zoneType === ZoneType.INDUSTRIAL ? SIMULATION.INDUSTRIAL_POLLUTION_FACTOR : 1;
      const value = calculateLandValue({
        serviceCoverage,
        parkProximity,
        waterfront,
        pollution: (pollution.ground + pollution.water) * pollutionFactor,
        noise: pollution.noise * pollutionFactor,
        crimeRate: this.getAvgCrime(),
        policyBonus: this.state.policies.getLandValueBonus(
          this.state.districts.getDistrictAt(x, y)?.id ?? null,
        ),
      });

      // Write land value, service coverage, and noise to grid (avoid temp object)
      const noiseVal = Math.min(SIMULATION.CELL_VALUE_MAX, Math.round(pollution.noise));
      if (cell.landValue !== value || cell.serviceCoverage !== serviceCoverage || cell.noiseLevel !== noiseVal) {
        grid.setCell(x, y, { landValue: value, serviceCoverage, noiseLevel: noiseVal });
      }
    });
  }

  private tryBuildingUpgrades(): void {
    const grid = this.state.grid;
    const upgrade = this.state.buildingUpgrade;
    let changed = false;

    // Sample cells each tick rather than scanning all (performance)
    const attempts = SIMULATION.UPGRADE_ATTEMPTS;
    for (let i = 0; i < attempts; i++) {
      const x = randomInt(grid.width);
      const y = randomInt(grid.height);
      const cell = grid.getCell(x, y);
      if (!cell || cell.buildingId === 0) continue;

      // Compute average worker education for industrial/office upgrade checks
      const posKey = `${x},${y}`;
      const workers = this.state.citizens.getCitizensByWorkplace(posKey);
      const conditions = {
        landValue: cell.landValue,
        avgEducation: avgEducationScore(workers),
      };

      // Try upgrade first, then downgrade
      if (upgrade.tryUpgrade(x, y, conditions) || upgrade.tryDowngrade(x, y, conditions)) {
        changed = true;
        // Notify with updated state
        const updated = grid.getCell(x, y);
        if (updated) {
          const newLevel = getBuildingType(updated.buildingId)?.level ?? 1;
          // The 6th argument (`abandoned`) is not optional in practice: the
          // renderer defaults it to false and re-adds the light spot, so an
          // omitted value visually resurrects a ruin. The abandonment path a few
          // hundred lines below passes it correctly; this one did not (BUG-086).
          this.onBuildingUpdated?.(
            x, y, updated.zoneType, newLevel,
            updated.reserved === BURNED,
            updated.reserved === ABANDONED,
          );
        }
      }
    }
    if (changed) { this.onBuildingsChanged?.(); this.wpDistCache?.invalidate(); }
  }

  /**
   * Process abandonment stress for all active buildings.
   * Scans grid directly (decoupled from buildingPositions used by housing assignment).
   * Each building has a deterministic resilience factor (0.5–1.5) based on
   * position hash, so buildings abandon at different rates under same conditions.
   */
  private processAbandonmentStress(): void {
    // Delegated to AbandonmentStressTick (SRP — stress calculation separated from orchestration)
    const result = abandonmentStressTick({
      forEachCell: (fn) => this.state.grid.forEachCell(fn),
      getCell: (x, y) => this.state.grid.getCell(x, y),
      isZoneBuilding,
      getBuildingLevel: (bid) => getBuildingType(bid)?.level ?? 0,
      getPollution: (x, y) => this.state.pollution.getPollutionAt(x, y),
      getCrimeReduction: (x, y) => this.state.police.getCrimeReduction(x, y),
      getServiceScore: (x, y, isRes) => getCellServiceCostScore(this.state, x, y, isRes),
      isPowered: (x, y) => this.state.power.isPowered(x, y),
      isWatered: (x, y) => this.state.water.isSupplied(x, y),
      getFreightSupplyRatio: (x, y) => this.state.freight.getSupplyStatus(x, y).ratio,
      getFreightSurplusRatio: () => this.state.freight.getSurplusRatio(),
      baseCrime: this.getAvgCrime(),
      businessTax: this.state.taxRates.business ?? DEFAULT_TAX_RATE,
      residentialTax: this.state.taxRates.residential ?? DEFAULT_TAX_RATE,
      stressMap: this.abandonmentStress,
    });

    // Apply abandonment to grid + evict citizens (side effects stay in orchestrator)
    for (const a of result.abandoned) {
      this.state.grid.setCell(a.x, a.y, { reserved: ABANDONED });
      this.takeBuildingOutOfService(a.x, a.y);
      this.onBuildingUpdated?.(a.x, a.y, a.zoneType, a.level, false, true);
    }

    if (result.changed) { this.onBuildingsChanged?.(); this.wpDistCache?.invalidate(); }
  }

  /**
   * Monthly births.
   *
   * Its own method so the tick can place it explicitly — it used to sit near
   * the top, ahead of the per-day ageing and death pass it shares a tick with.
   */
  private runBirths(): void {
    const currentMonth = this.state.clock.getMonth();
    if (currentMonth === this.lastBirthMonth) return;
    this.lastBirthMonth = currentMonth;
    birthTick(this.state.citizens, {
      // Since BUG-140 took the aggregate gate off this path, this lookup is
      // the ONLY bound on birth-driven growth — so it has to agree with
      // countResidentialCapacity cell for cell. It used to answer
      // FALLBACK_RESIDENTS (8) for an address with no building at all, which
      // that figure counts as 0 (BUG-164).
      getResidents: (homeId) => residentsAtHome(this.state.grid, homeId),
    }, this.state.clock.tick);
  }

  /** Get the abandonment stress for a building at (x, y). */
  getAbandonmentStress(x: number, y: number): number {
    return this.abandonmentStress.get(`${x},${y}`) ?? 0;
  }

  /** Clear abandonment stress for a building (e.g., after demolish). */
  clearBuildingState(x: number, y: number): void {
    this.abandonmentStress.delete(`${x},${y}`);
  }

  /** Dirty flag — set to true when buildings change; cleared after rebuild. */
  private buildingIndexDirty = true;

  /** Mark building index as needing rebuild (call after growth/demolish/burn). */
  markBuildingIndexDirty(): void { this.buildingIndexDirty = true; }

  /**
   * Rebuild the building position list if dirty.
   * Scans all active zone buildings (excludes ABANDONED/BURNED).
   * Deduplicates multiple callers per tick via dirty flag.
   */
  private rebuildBuildingIndex(): void {
    if (!this.buildingIndexDirty) return;
    this.buildingIndexDirty = false;
    this.buildingPositions.length = 0;
    this.state.grid.forEachCell((cell, x, y) => {
      if (isZoneBuilding(cell.buildingId) && cell.reserved !== ABANDONED && cell.reserved !== BURNED) {
        this.buildingPositions.push({ pos: toPosKey(x, y), x, y, buildingId: cell.buildingId });
      }
    });
  }

  /**
   * Assign homeId and workplaceId to citizens who don't have them.
   * homeId/workplaceId store "x,y" position strings (unique per building).
   * Called after migration so newly created citizens get housing.
   */
  private assignCitizenHousing(): void {
    this.rebuildBuildingIndex();

    const housingCandidates = buildHousingCandidates(
      this.buildingPositions, this.state.grid, this.state.pollution, this.state.parks,
    );
    const workplaceCandidates = buildWorkplaceCandidates(this.buildingPositions);

    if (housingCandidates.length === 0 && workplaceCandidates.length === 0) return;

    const citizens = this.state.citizens.getCitizens();

    // Assign workplaces first (housing scoring needs workplaceId for commute)
    const workOccupancy = countOccupancy(citizens, (c) => c.workplaceId);
    // Reuse scratch array for working-age citizens (avoid per-tick filter allocation)
    const workingAgeCitizens = this.workingAgeScratch;
    workingAgeCitizens.length = 0;
    for (const c of citizens) {
      if (isWorkingAge(c.age)) workingAgeCitizens.push(c);
    }

    // The workplace-distance worker only receives the grid buffer, whose
    // roadType byte is the GROUND layer. Elevated segments live in
    // ElevationManager and are invisible to it, so in a city where a viaduct
    // provides the only link between a district and its jobs the cache reported
    // "unreachable" while the synchronous fallback — which is handed
    // _roadLookup and IS level-aware — reported the opposite. Residents lost
    // their jobs whenever the cache happened to be ready and got them back when
    // it went stale, oscillating between the two answers.
    //
    // Correctness wins over speed: the cache is simply not used while any
    // elevated ROAD exists. Serialising the elevated layers into the worker
    // buffer is the real fix and is recorded in TODO.md (BUG-109).
    //
    // hasAnyElevatedRoad, not hasAnySegment: elevated RAIL shares the same
    // layers map with roadType NONE and contributes nothing to road
    // reachability, so the broader question let one elevated metro tile
    // permanently disable the cache for an otherwise entirely flat city —
    // a budgeted Dijkstra per unemployed home, every slow cycle, forever.
    const canUseWpCache = !this._elevationManager || !this._elevationManager.hasAnyElevatedRoad();

    // Trigger async cache update if stale
    if (canUseWpCache && this.wpDistCache && this.wpDistCache.isStale && workplaceCandidates.length > 0) {
      const wpPositions = workplaceCandidates.map(c => {
        const p = parsePosKeyUnsafe(c.pos);
        return { pos: c.pos, x: p.x, y: p.y };
      });
      // Copy grid buffer for worker (ArrayBuffer → new copy for transfer)
      const srcBuf = this.state.grid.getBuffer();
      const copy = new ArrayBuffer(srcBuf.byteLength);
      new Uint8Array(copy).set(new Uint8Array(srcBuf));
      this.wpDistCache.requestUpdate(
        this.state.grid.width, this.state.grid.height,
        copy, wpPositions, DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
      );
    }

    // Build reachability map: use cache if ready, otherwise sync Dijkstra fallback
    const reachable = (canUseWpCache && this.wpDistCache?.isReady)
      ? this.buildWorkplaceReachabilityFromCache(workingAgeCitizens, workplaceCandidates)
      : this.buildWorkplaceReachability(workingAgeCitizens, workplaceCandidates);
    assignWorkWithPreference(workingAgeCitizens, workplaceCandidates, workOccupancy, reachable);

    // Then assign housing with preference scoring
    const homeOccupancy = countOccupancy(citizens, (c) => c.homeId);
    assignWithPreference(citizens, housingCandidates, homeOccupancy);

    // Update occupancy ratios for rendering (must re-count AFTER assignments)
    this.occupancyRatios = computeOccupancyRatios(citizens, this.buildingPositions);

    // Force occupancy to 0 for abandoned/burned buildings (windows must be dark)
    for (const bp of this.buildingPositions) {
      const cell = this.state.grid.getCell(bp.x, bp.y);
      if (cell && (cell.reserved === ABANDONED || cell.reserved === BURNED)) {
        this.occupancyRatios.set(bp.pos, 0);
      }
    }
  }

  /**
   * Run relocation tick: unhappy citizens may move to better housing.
   * Called every MEDIUM_TICK_INTERVAL ticks.
   */
  private runRelocation(): void {
    this.rebuildBuildingIndex();

    const housingCandidates = buildHousingCandidates(
      this.buildingPositions, this.state.grid, this.state.pollution, this.state.parks,
    );

    if (housingCandidates.length === 0) return;

    const citizens = this.state.citizens.getCitizens();
    const homeOccupancy = countOccupancy(citizens, (c) => c.homeId);
    const { relocatedIds } = relocationTick(citizens, housingCandidates, homeOccupancy);
    for (const id of relocatedIds) {
      this.commuteCache.remove(id);
    }
  }

  /**
   * Build a reachability map for workplace assignment.
   * For each unique homeId among unassigned citizens, run Dijkstra to find
   * which workplace positions are reachable via the road network.
   */
  private buildWorkplaceReachability(
    citizens: readonly Citizen[],
    workplaceCandidates: readonly WorkplaceCandidate[],
  ): Map<string, Set<string>> {
    const reachable = new Map<string, Set<string>>();
    if (workplaceCandidates.length === 0) return reachable;

    // Collect unique homeIds of unassigned citizens
    const homeIds = new Set<string>();
    for (const c of citizens) {
      if (c.workplaceId === null && c.homeId !== null) {
        homeIds.add(c.homeId);
      }
    }
    if (homeIds.size === 0) return reachable;

    // All workplace positions as Dijkstra targets
    const targetSet = new Set<string>(workplaceCandidates.map(c => c.pos));

    for (const homeId of homeIds) {
      const homePos = parsePosKeyUnsafe(homeId);
      const distMap = roadDistanceToTargets(
        this.state.grid, homePos, targetSet,
        DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
        this._roadLookup,
      );
      reachable.set(homeId, new Set(distMap.keys()));
    }

    return reachable;
  }

  /** Cache-based reachability: O(1) per homeId, no Dijkstra. */
  private buildWorkplaceReachabilityFromCache(
    citizens: readonly Citizen[],
    workplaceCandidates: readonly WorkplaceCandidate[],
  ): Map<string, Set<string>> {
    const reachable = new Map<string, Set<string>>();
    const cache = this.wpDistCache!;
    for (const c of citizens) {
      if (c.workplaceId === null && c.homeId !== null && !reachable.has(c.homeId)) {
        reachable.set(c.homeId, cache.getReachableWorkplaces(c.homeId));
      }
    }
    return reachable;
  }

  /**
   * Run job relocation tick: citizens with long/failed commutes may switch workplace.
   * Called every JOB_RELOCATION_INTERVAL ticks (after housing relocation).
   */
  /**
   * 這一輪還沒跑完的切片器。null 表示上一輪已經收工，可以開新的一輪。
   *
   * 下一輪只在上一輪跑完之後才開始 —— 這讓它自己節流：城市越大，輪與輪之間
   * 的間隔越長，而每個 tick 的成本維持不變。
   */
  private jobRelocationSlicer: JobRelocationSlicer | null = null;

  /**
   * 推進換工作那一輪。每個 tick 呼叫，成本由 `JOB_RELOCATION_SLICE` 封頂。
   *
   * 以前這一整輪擠在一個 tick 裡跑完 —— 2436 人的城市量到 1474 毫秒，
   * 每 3 秒卡一次（BUG-109）。總工作量沒有變，只是不再擠在一起。
   */
  private advanceJobRelocation(): void {
    const slicer = this.jobRelocationSlicer;
    if (!slicer) return;
    const relocatedIds = slicer.runSlice(SIMULATION.JOB_RELOCATION_SLICE);
    // 搬遷的市民要清掉通勤快取，路線才會重算。
    for (const id of relocatedIds) this.commuteCache.remove(id);
    if (slicer.pending === 0) this.jobRelocationSlicer = null;
  }

  private runJobRelocation(): void {
    // 上一輪還沒跑完就不開新的。
    if (this.jobRelocationSlicer) return;

    this.rebuildBuildingIndex();

    const workplaceCandidates = buildWorkplaceCandidates(this.buildingPositions);
    if (workplaceCandidates.length === 0) return;

    const citizens = this.state.citizens.getCitizens();
    const workOccupancy = countOccupancy(citizens, (c) => c.workplaceId);

    // Use cache-based distance lookup when ready (O(1) per lookup, no Dijkstra).
    // Otherwise provide a closure that captures this._roadLookup for level-aware Dijkstra.
    //
    // The same elevation guard as assignCitizenHousing. This is the second
    // consumer of the cache and BUG-109's fix only guarded the first: the
    // worker sees the ground roadType byte and cannot see a viaduct, so a
    // ready cache would relocate workers as though the viaduct were not there.
    // It is currently unreachable — requestUpdate is blocked upstream, so the
    // cache can never reach READY while an elevated road exists — but that is
    // correctness by coupling, and it evaporates the day the cache is warmed
    // by any other route.
    const roadLookup = this._roadLookup;
    const canUseWpCache = !this._elevationManager || !this._elevationManager.hasAnyElevatedRoad();
    const distanceLookup = (canUseWpCache && this.wpDistCache?.isReady)
      ? (_grid: any, homePos: { x: number; y: number }, targets: Set<string>, _budget: number) => {
          const homeKey = toPosKey(homePos.x, homePos.y);
          return this.wpDistCache!.getDistancesFromHome(homeKey, targets);
        }
      : (grid: ReadableGrid, homePos: { x: number; y: number }, targets: Set<string>, budget: number) =>
          roadDistanceToTargets(grid, homePos, targets, budget, roadLookup);

    // 開一輪，交給 advanceJobRelocation 逐 tick 推進。
    this.jobRelocationSlicer = beginJobRelocation(
      citizens,
      workplaceCandidates,
      workOccupancy,
      this.commuteCache,
      this.state.grid,
      this.state.clock.tick,
      undefined,
      distanceLookup,
    );
  }

  /** Mark the lane graph as needing rebuild (call after road build/demolish).
   *  If affectedCells is provided, only invalidate cached routes through those cells.
   *  If omitted, no cache invalidation (e.g. road building adds new cells but doesn't break existing routes).
   */
  /** Cells affected by the most recent road change (for bus route revalidation). */
  private dirtyRoadCells: Set<string> | null = null;

  /** Force an immediate lane graph rebuild if dirty. Call before operations
   *  that need the latest graph (e.g. bus route creation). */
  ensureLaneGraph(): void {
    if (this.laneGraphDirty) {
      this.rebuildLaneGraph();
      this.laneGraphDirty = false;
    }
  }

  /** Pre-compute commute paths and spawn initial vehicles on load.
   *  Call after lane graph, road coverage, and power/water are ready.
   *  @param spawnRatio fraction of commuters to place on roads (0-1)
   *  @param onProgress called with (0-1) for sub-progress updates */
  async warmup(spawnRatio = 0.2, onProgress?: (ratio: number) => void): Promise<{ pathsComputed: number; vehiclesSpawned: number }> {
    this.ensureLaneGraph();
    if (!this._roadLookup) return { pathsComputed: 0, vehiclesSpawned: 0 };

    const citizens = this.state.citizens.getCitizens();
    let pathsComputed = 0;
    let vehiclesSpawned = 0;

    for (let i = 0; i < citizens.length; i++) {
      const c = citizens[i]!;
      if (!c.homeId || !c.workplaceId) continue;
      const home = parsePosKey(c.homeId);
      const work = parsePosKey(c.workplaceId);
      if (!home || !work) continue;

      // Compute morning path (home → work)
      const morningKey = `${c.homeId}->${c.workplaceId}`;
      let morningVariants = this.commuteCache.getRouteVariants(morningKey) ?? null;
      if (!morningVariants) {
        morningVariants = findLanePathVariants(this.laneGraph, this._roadLookup, home, work);
        if (morningVariants.length > 0) {
          this.commuteCache.setRouteVariants(morningKey, morningVariants);
        }
      }

      // Compute evening path (work → home)
      const eveningKey = `${c.workplaceId}->${c.homeId}`;
      let eveningVariants = this.commuteCache.getRouteVariants(eveningKey) ?? null;
      if (!eveningVariants) {
        eveningVariants = findLanePathVariants(this.laneGraph, this._roadLookup, work, home);
        if (eveningVariants.length > 0) {
          this.commuteCache.setRouteVariants(eveningKey, eveningVariants);
        }
      }

      const morningPath = morningVariants?.length ? morningVariants[Math.floor(Math.random() * morningVariants.length)]! : null;
      const eveningPath = eveningVariants?.length ? eveningVariants[Math.floor(Math.random() * eveningVariants.length)]! : null;
      if (!morningPath && !eveningPath) continue;

      // Cache both directions for this citizen
      this.commuteCache.set(c.id, {
        citizenId: c.id,
        homeId: c.homeId,
        workplaceId: c.workplaceId,
        morningPath: morningPath && morningPath.length > 0 ? morningPath : null,
        eveningPath: eveningPath && eveningPath.length > 0 ? eveningPath : null,
        status: 'ready',
        generation: this.commuteCache.roadGeneration,
      });
      pathsComputed++;

      // Spawn vehicle for a fraction of commuters (random direction)
      if (Math.random() < spawnRatio) {
        const spawnPath = Math.random() < 0.5 ? morningPath : eveningPath;
        if (spawnPath && spawnPath.length > 0) {
          this.state.traffic.addVehicleOnEdges(spawnPath, c.id);
          vehiclesSpawned++;
        }
      }

      // Report sub-progress every 100 citizens
      if (i % 100 === 0 && onProgress) {
        onProgress(i / citizens.length);
        await new Promise(r => requestAnimationFrame(r));
      }
    }

    onProgress?.(1);
    return { pathsComputed, vehiclesSpawned };
  }


  /** Immediately remove service vehicles of a given type (e.g. when facility demolished). */
  removeServiceVehicles(serviceType: ServiceVehicleType): void {
    this.serviceVehicleManager.removeAllOfType(this.state.traffic, serviceType);
  }

  /**
   * Invalidate only the multi-modal transfer graph.
   *
   * Deliberately NOT markLaneGraphDirty: transit edits do not change the road
   * network, so dragging the lane graph, commute cache and workplace-distance
   * cache along would be a far more expensive invalidation than needed.
   *
   * Transit MUTATIONS no longer need to call this — BaseTransportSystem bumps
   * its own version counter and isTransferGraphDirty() compares it. The method
   * remains for callers that change something the counter cannot see.
   */
  /**
   * Is the transfer graph awaiting a rebuild?
   *
   * True when a road edit set the flag, OR when any transit system's structural
   * version has moved since the last rebuild. The version check is what makes
   * this robust: the flag alone depended on every mutation site remembering to
   * call markTransitNetworkDirty, which markLaneGraphDirty had already silently
   * broken for the whole transit UI once (BUG-090).
   */
  isTransferGraphDirty(): boolean {
    return this.transferGraphDirty || getTransitNetworkVersion(this.state) !== this.lastTransitVersion;
  }

  /** Number of transit routes currently flattened into the transfer graph. */
  getTransitRouteCount(): number {
    return this.flatRoutes.length;
  }

  /**
   * Rebuild the multi-modal transfer graph if the transit network changed.
   *
   * Runs unconditionally from tick(). It used to live inside
   * spawnCommuteVehicles, behind three early returns — no population, commute
   * vehicles at the cap, and no eligible (not-already-driving) citizens. A city
   * large enough to sit permanently at the vehicle cap therefore never rebuilt:
   * new lines were invisible to trip planning and deleted lines stayed in
   * flatRoutes, still collecting dailyRiders.
   */
  private rebuildTransferGraphIfDirty(): void {
    // Daily rollover for transfer usage counts (7-day ring buffer). Same
    // stranding problem as the rebuild: a capped city stopped ageing the ring.
    const day = this.state.clock.getDay();
    if (day !== this.transferTracker.getLastDay()) {
      this.transferTracker.setLastDay(day);
      let peds = 0;
      for (const a of this.state.pedestrianManager.agents) {
        if (a.tripType === 4) peds++;
      }
      this.transferTracker.rolloverDay(peds);
    }

    if (!this.isTransferGraphDirty()) return;
    const systems = this.getTransitSystemInfos();
    this.flatRoutes = flattenSystems(systems);
    this.transferGraph = buildTransferGraph(this.flatRoutes, SIMULATION.TRANSFER_WALK_RANGE);
    buildStopRouteCache(
      this.flatRoutes, this.transferGraph,
      SIMULATION.WALK_SPEED, SIMULATION.AVERAGE_WAIT_FACTOR, SIMULATION.MAX_TRIP_LEGS,
    );
    this.transferGraphDirty = false;
    this.lastTransitVersion = getTransitNetworkVersion(this.state);

    // Only wipe the panel's per-building attribution when the stop/route
    // topology actually moved. Route labels survive a vehicle-count change, so
    // clearing on every rebuild blanked the transfer panel each time the player
    // clicked +/- on a line.
    const topology = getTransitTopologyVersion(this.state);
    if (topology !== this.lastTransitTopologyVersion) {
      this.lastTransitTopologyVersion = topology;
      this.transferTracker.clearBuildings();
    }
  }

  markLaneGraphDirty(affectedCells?: string[], skipUnreachableCheck = false): void {
    this.laneGraphDirty = true;
    this.sidewalkGraphDirty = true;
    this.tripPoolDirty = true;
    this.transferGraphDirty = true;
    this.commuteCache.bumpGeneration();
    // Drop in-flight worker results NOW, not on the next tick's graph sync.
    //
    // markLaneGraphDirty runs synchronously from the input event and clears
    // routeIndex; the worker's BATCH_RESULT is a message task, so it lands
    // before rebuildLaneGraph runs. onResult then wrote pre-demolition routes
    // straight back into the cache, and spawnCommuteVehicles stamped them with
    // the NEW roadGeneration — so isExpired() was permanently false and cars
    // kept spawning onto road that no longer exists until the next edit.
    // clearPending drops inflightBatches, so handleMessage ignores the reply;
    // it was simply being called one tick too late (BUG-107).
    this.pathBatcher?.clearPending();
    this.wpDistCache?.invalidate();
    if (affectedCells) {
      if (!this.dirtyRoadCells) this.dirtyRoadCells = new Set();
      for (const cellKey of affectedCells) {
        this.commuteCache.invalidateCell(cellKey);
        this.dirtyRoadCells.add(cellKey);
      }
      // Invalidate pedestrian path cache for affected cells
      this.state.pedestrianManager.invalidateCells(affectedCells);
      // Only check unreachable jobs when roads are removed (demolish).
      // Building new roads/tracks only adds connectivity, never breaks it.
      if (!skipUnreachableCheck) {
        this.immediateUnreachableJobCheck(affectedCells);
      }
    }
  }

  /**
   * When roads are cut, immediately unemploy citizens whose workplace
   * is no longer reachable from home (don't wait for jobRelocationTick).
   * Only checks citizens whose cached commute paths pass through the
   * affected cells (via CommuteCache cellIndex), avoiding a full scan.
   */
  private immediateUnreachableJobCheck(affectedCells: string[]): void {
    // Collect citizen IDs whose commute routes pass through demolished cells
    const affectedIds = new Set<number>();
    for (const cellKey of affectedCells) {
      const ids = this.commuteCache.getCitizensByCell(cellKey);
      if (ids) for (const id of ids) affectedIds.add(id);
    }
    if (affectedIds.size === 0) return;

    // Build temporary id→citizen map for O(1) lookup
    const citizenById = new Map<number, Citizen>();
    for (const c of this.state.citizens.getCitizens()) {
      if (affectedIds.has(c.id)) citizenById.set(c.id, c);
    }

    const grid = this.state.grid;
    const tick = this.state.clock.tick;
    const reachCache = new Map<string, boolean>();

    for (const id of affectedIds) {
      const citizen = citizenById.get(id);
      if (!citizen || !citizen.workplaceId || !citizen.homeId || !isWorkingAge(citizen.age)) continue;

      const key = `${citizen.homeId}->${citizen.workplaceId}`;
      let reachable = reachCache.get(key);

      if (reachable === undefined) {
        const home = parsePosKeyUnsafe(citizen.homeId);
        const distMap = roadDistanceToTargets(
          grid, home, new Set([citizen.workplaceId]),
          DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
          this._roadLookup,
        );
        reachable = distMap.has(citizen.workplaceId);
        reachCache.set(key, reachable);
      }

      if (!reachable) {
        citizen.workplaceId = null;
        citizen.unemployedSince = tick;
        this.commuteCache.remove(citizen.id);
      }
    }
  }

  private rebuildLaneGraph(): void {
    const grid = this.state.grid;

    // Use UnifiedRoadLookup for all road cells (ground + elevated)
    const lookup = this._roadLookup;
    if (lookup) {
      if (this.dirtyRoadCells && this.dirtyRoadCells.size > 0) {
        // Incremental update: only rebuild affected cells + neighbors
        this.laneGraph.updateCells(lookup, [...this.dirtyRoadCells]);
      } else {
        // Full rebuild (save load, initial build, or unknown changes)
        const cellKeys = lookup.getAllCellKeys();
        this.laneGraph.buildFromGrid(lookup, cellKeys);
      }
    } else {
      // Fallback: ground-only (no elevation manager set)
      const cellKeys: string[] = [];
      grid.forEachCell((cell, x, y) => {
        if (cell.roadType !== RoadType.NONE) cellKeys.push(toPosKey(x, y));
      });
      const cellKeySet = new Set(cellKeys);
      this.laneGraph.buildFromGrid({
        getCellByKey(key: string) {
          const { x, y } = parsePosKeyUnsafe(key);
          const cell = grid.getCell(x, y);
          if (!cell || cell.roadType === RoadType.NONE) return null;
          return { roadType: cell.roadType, roadFlags: cell.roadFlags };
        },
        getCompatibleNeighborKeys(_sourceKey: string, nx: number, ny: number) {
          const k = toPosKey(nx, ny);
          return cellKeySet.has(k) ? [k] : [];
        },
      }, cellKeys);
    }

    const lg = this.laneGraph;
    const busLookup = this._roadLookup;
    const findEdgePath = (fx: number, fy: number, tx: number, ty: number) =>
      busLookup ? findLanePath(lg, busLookup, { x: fx, y: fy }, { x: tx, y: ty }) : null;

    // Rebuild segments for routes loaded from save (no segments yet)
    this.state.bus.rebuildAllSegments(findEdgePath, this.state.traffic, grid);

    // Revalidate bus routes affected by road changes
    if (this.dirtyRoadCells && this.dirtyRoadCells.size > 0) {
      this.state.bus.onRoadChanged(
        this.dirtyRoadCells,
        findEdgePath,
        this.state.traffic,
        grid,
      );
      this.dirtyRoadCells = null;
    }

    // Invalidate all service vehicles — their edgePaths reference stale LaneEdges.
    // They will be re-spawned on next tickServiceVehicles().
    this.serviceVehicleManager.removeAll(this.state.traffic);

    // Commute and freight vehicles need the same treatment, but only the ones
    // actually affected. The reasoning in the line above applies to them too and
    // they were simply never handled: buses have their own onRoadChanged path,
    // service vehicles are wiped wholesale, and everything else kept driving
    // along edges belonging to demolished cells. Nothing rescued them — stallTime
    // only accrues when a vehicle is blocked, and a ghost road blocks nothing, so
    // they ran the full path to "arrival" in plain sight (BUG-108).
    //
    // Scoped to cells where the road is GONE, not merely rebuilt.
    //
    // The dirty set is every cell the edit touched, and RoadBuilder reports the
    // whole L-path — including existing cells whose roadType did not change. A
    // vehicle whose route crosses those is fine: updateCells replaces the edge
    // objects, but the geometry is identical and nothing downstream depends on
    // edge identity (signals key on cellKey, car-following on edge.id). Retiring
    // on dirtiness alone made every road extension or upgrade visibly delete the
    // traffic already driving on that stretch (BUG-116).
    //
    // Ask the exact question — "does the graph still own every edge on this
    // vehicle's remaining path?" — instead of approximating it from cell keys.
    //
    // Both previous approximations were wrong in a different direction, and the
    // full-vs-incremental branch they needed contradicted itself: the
    // incremental side argued that identical geometry makes an object swap
    // harmless, while the full side deleted all traffic on exactly that
    // reasoning's opposite. It also could not tell a NULL affected-set ("we
    // don't know") from an EMPTY one ("we know, and nothing changed"), so
    // dragging the demolish tool over bare grass wiped every car in the city.
    // Edge ids are deterministic, so a rebuild that changes nothing retires
    // nobody and the distinction disappears.
    const liveEdgeIds = new Set<string>();
    for (const e of this.laneGraph.getAllEdges()) liveEdgeIds.add(e.id);
    this.state.traffic.retireVehiclesOnDeadEdges(liveEdgeIds);

    // Sync graph to SharedArrayBuffer for Worker pathfinding
    this.syncGraphToWorker();
  }

  /** Write the current LaneGraph into the SharedArrayBuffer and notify the Worker. */
  private syncGraphToWorker(): void {
    if (!this.graphBuffer || !this.pathWorker) return;
    const lookup = this._roadLookup;
    if (lookup) {
      this.graphMapping = this.graphBuffer.writeFromGraphWithLookup(
        this.laneGraph,
        (cellKey) => {
          const info = lookup.getCellByKey(cellKey);
          return info ? info.roadType : RoadType.NONE;
        },
      );
    } else {
      this.graphMapping = this.graphBuffer.writeFromGraph(this.laneGraph);
    }
    if (this.pathBatcher) {
      this.pathBatcher.updateMapping(this.graphMapping);
      this.pathBatcher.clearPending();
    }
    // Re-init worker with updated SAB (GraphReader re-reads header with new counts)
    const msg: WorkerRequest = {
      type: 'INIT_GRAPH',
      graphSAB: this.graphBuffer.getBuffer(),
      maxPoints: this.graphBuffer.getMaxPoints(),
      maxEdges: this.graphBuffer.getMaxEdges(),
    };
    this.pathWorker.postMessage(msg);
  }

  private rebuildSidewalkGraph(): void {
    const grid = this.state.grid;
    const roadCellKeys: string[] = [];
    const buildingCellKeys: string[] = [];
    const gridLookup = {
      getCell: (x: number, y: number) => {
        const cell = grid.getCell(x, y);
        if (!cell) return null;
        return {
          roadType: cell.roadType,
          roadFlags: cell.roadFlags,
          railType: cell.railType,
          buildingId: cell.buildingId,
        };
      },
    };

    grid.forEachCell((cell, x, y) => {
      if (cell.roadType !== RoadType.NONE) {
        roadCellKeys.push(toPosKey(x, y));
      } else if (cell.buildingId > 0) {
        buildingCellKeys.push(toPosKey(x, y));
      }
    });

    this.state.sidewalkGraph.buildFromGrid(gridLookup, roadCellKeys, buildingCellKeys);
    // Re-link the EXISTING pedestrianManager to the rebuilt graph.
    //
    // This used to construct a new one, discarding every walking pedestrian and
    // the whole path cache. markLaneGraphDirty always sets sidewalkGraphDirty,
    // and it fires on road build, road demolish, any other demolish and on
    // rezoning over existing buildings — so every one of those edits made the
    // pedestrians on screen vanish and forced an immediate storm of multi-target
    // A* to refill. It also reset levelCrossings to null, which would have
    // silently un-wired BUG-105 on the first edit (BUG-104).
    this.state.pedestrianManager.setSidewalkGraph(this.state.sidewalkGraph);

    // Retire agents whose remaining route contains an edge the rebuilt graph no
    // longer owns — the pedestrian mirror of retireVehiclesOnDeadEdges, and for
    // the same reason: a cell-key sweep could not see a cell that flipped from
    // BUILDING to road, which still has a road but lost every building_entrance
    // node it had, so an agent kept walking to the door of a razed house.
    this.retireStrandedPedestrians();
  }

  /**
   * Retire every agent whose remaining route contains an edge the graph no
   * longer owns.
   *
   * This lived inside rebuildSidewalkGraph, which meant it only ran on the
   * road-edit path. buildingGrowthTick mutates the same graph directly through
   * updateCells and never sets sidewalkGraphDirty, so the sweep never saw it —
   * and building demolition is by far the highest-frequency source of destroyed
   * building_entrance edges. An agent walking to the door of a house that had
   * just been razed carried on walking there for up to DESPAWN_TIMEOUT, which
   * is the precise symptom the sweep was written to remove (BUG-161).
   */
  private retireStrandedPedestrians(): void {
    this.state.pedestrianManager.retireAgentsOnDeadEdges(this.state.sidewalkGraph.getEdgeIds());
  }

  /**
   * Fold a set of cells whose BUILDINGS changed into the sidewalk graph.
   *
   * updateCells deletes the four door and four corner nodes of every cell it
   * touches, along with every building_access edge on them — so this is a
   * second, independent way for a pedestrian's route to be destroyed, and it
   * runs far more often than road editing does. It set no dirty flag, so
   * rebuildSidewalkGraph never ran for it and the retirement sweep never saw
   * it: an agent walking to the door of a house the growth tick had just razed
   * carried on walking there for up to DESPAWN_TIMEOUT (BUG-161).
   */
  applyBuildingRemoval(affectedCells: string[]): void {
    if (affectedCells.length === 0) return;
    const grid = this.state.grid;
    this.state.sidewalkGraph.updateCells({
      getCell: (gx: number, gy: number) => {
        const c = grid.getCell(gx, gy);
        if (!c) return null;
        return { roadType: c.roadType, roadFlags: c.roadFlags, railType: c.railType, buildingId: c.buildingId };
      },
    }, affectedCells);
    this.state.pedestrianManager.clearPathCache();
    this.retireStrandedPedestrians();
  }

  private spawnVehicles(): void {
    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Vehicle cap: ~30% of population can be on the road simultaneously
    // Exclude service vehicles from the cap (they are cosmetic and should not block commute traffic)
    const vehicleCap = Math.min(SIMULATION.VEHICLE_CAP_MAX, SIMULATION.VEHICLE_CAP_BASE + Math.floor(pop * SIMULATION.VEHICLE_CAP_POP_RATIO));
    const commuteVehicles = this.state.traffic.getVehicleCount() - this.state.traffic.getServiceVehicleCount();
    if (commuteVehicles >= vehicleCap) return;

    this.rebuildBuildingIndex();

    const grid = this.state.grid;

    // Vehicles are cosmetic — spawn uniformly every tick regardless of time-of-day.
    // Random citizen sampling ensures route distribution matches real commute patterns.
    this.spawnCommuteVehicles(grid, vehicleCap);

    // Spawn external highway traffic
    this.spawnExternalHighwayTraffic(grid, vehicleCap);

    // Spawn freight trucks (industrial↔commercial, factory↔trade, trade↔commercial)
    this.spawnFreightTraffic(grid, vehicleCap);

    // Pedestrians: uniform density, trip pool rebuilt on demand
    this.spawnPedestriansFromPool(pop);
    this.state.pedestrianManager.setDensityMultiplier(1.0);
  }


  /**
   * Spawn commute vehicles by randomly sampling citizens with jobs.
   * Direction (home→work vs work→home) is randomized per citizen — vehicles are cosmetic.
   */
  private spawnCommuteVehicles(
    grid: { getCell(x: number, y: number): { roadType: number } | null; width: number; height: number },
    vehicleCap: number,
  ): void {
    // Rebuild activeCommuters from live vehicles (O(vehicleCount), lightweight)
    const active = this.activeCommuters;
    active.clear();
    for (const v of this.state.traffic.vehicles) {
      if (v.citizenId !== undefined && !v.arrived) active.add(v.citizenId);
    }

    // Build eligible citizen list (exclude citizens already on the road)
    const citizens = this.state.citizens.getCitizens();
    const eligible = this.commuteEligibleScratch;
    eligible.length = 0;
    for (const c of citizens) {
      if (isWorkingAge(c.age) && c.homeId !== null && c.workplaceId !== null && !active.has(c.id)) {
        eligible.push(c);
      }
    }
    if (eligible.length === 0) return;

    // The daily transfer-usage rollover and the transfer-graph rebuild used to
    // live here, behind this and two earlier early returns — see
    // rebuildTransferGraphIfDirty(). Both now run from tick().

    const maxPerTick = Math.max(SIMULATION.MIN_SPAWN_PER_TICK, Math.ceil(eligible.length / SIMULATION.SPAWN_SPREAD_TICKS));
    let spawned = 0;

    for (let i = 0; i < maxPerTick; i++) {
      if (this.state.traffic.getVehicleCount() >= vehicleCap) break;

      // Random citizen sampling — route distribution matches real commute patterns
      const citizen = eligible[randomInt(eligible.length)]!;

      // Random direction (cosmetic — visually indistinguishable)
      const toWork = Math.random() < 0.5;
      const fromStr = toWork ? citizen.homeId! : citizen.workplaceId!;
      const toStr = toWork ? citizen.workplaceId! : citizen.homeId!;

      const fromPos = parsePosKey(fromStr);
      const toPos = parsePosKey(toStr);
      if (!fromPos || !toPos) continue;
      if (fromPos.x === toPos.x && fromPos.y === toPos.y) continue;

      // --- Transport mode choice (with multi-modal transfer support) ---
      const availableTransport = this.getAvailableTransit(fromPos, toPos);
      const congestion = this.state.traffic.getCongestionLevel();
      const multiModalRoutes = findMultiModalRoutes(
        this.flatRoutes, fromPos, toPos,
        SIMULATION.WALK_TO_STOP_RANGE, SIMULATION.WALK_SPEED,
        SIMULATION.AVERAGE_WAIT_FACTOR, this.transferGraph, SIMULATION.MAX_TRIP_LEGS,
      );
      const { mode, multiLeg } = chooseModeMultiModal(
        fromPos, toPos, availableTransport, multiModalRoutes, congestion,
      );

      if (mode !== TransportMode.DRIVE) {
        // Collect walking trips for pedestrian spawning (trip pool)
        if (this.tripPoolDirty) {
          if (mode === TransportMode.WALK) {
            this.pendingTrips.push({
              fromX: fromPos.x, fromY: fromPos.y,
              toX: toPos.x, toY: toPos.y,
              tripType: PedestrianTripType.FULL_WALK, count: 1,
            });
          } else if (multiLeg) {
            // Multi-modal: generate pedestrian trips for each walk leg
            const legs = multiLeg.legs;
            for (let li = 0; li < legs.length; li++) {
              const leg = legs[li]!;
              if (leg.type !== 'walk') continue;
              this.pendingTrips.push({
                fromX: leg.fromX, fromY: leg.fromY,
                toX: leg.toX, toY: leg.toY,
                tripType: li === 0 ? PedestrianTripType.FIRST_MILE
                  : li === legs.length - 1 ? PedestrianTripType.LAST_MILE
                  : PedestrianTripType.TRANSFER_WALK,
                count: 1,
              });
            }
          } else {
            // Single-transit: first-mile + last-mile
            const transitSystem2 = getSystemForMode(this.state, mode);
            if (transitSystem2) {
              const originStop = this.findNearestStop(transitSystem2.getStops(), fromPos);
              const destStop = this.findNearestStop(transitSystem2.getStops(), toPos);
              if (originStop) {
                this.pendingTrips.push({
                  fromX: fromPos.x, fromY: fromPos.y,
                  toX: originStop.x, toY: originStop.y,
                  tripType: PedestrianTripType.FIRST_MILE, count: 1,
                });
              }
              if (destStop) {
                this.pendingTrips.push({
                  fromX: destStop.x, fromY: destStop.y,
                  toX: toPos.x, toY: toPos.y,
                  tripType: PedestrianTripType.LAST_MILE, count: 1,
                });
              }
            }
          }
        }

        // Increment dailyRiders on each boarding stop
        if (multiLeg) {
          const rideLegs = multiLeg.legs.filter(l => l.type === 'ride');
          for (const leg of rideLegs) {
            if (leg.routeIdx !== undefined && leg.boardStopIdx !== undefined) {
              const route = this.flatRoutes[leg.routeIdx];
              if (route) {
                const stop = route.stops[leg.boardStopIdx] as { dailyRiders: number } | undefined;
                if (stop) stop.dailyRiders++;
              }
            }
          }
          // Track transfer usage per route label
          if (rideLegs.length >= 2) {
            const label = rideLegs.map(l => {
              const icons = TRANSIT_ICONS;
              return icons[l.transitType ?? ''] ?? '?';
            }).join('\u2192');
            this.transferTracker.recordTransfer(label);
            this.transferTracker.recordBuilding(label, citizen.homeId!, citizen.workplaceId!);
          }
        } else {
          const transitSystem = getSystemForMode(this.state, mode);
          if (transitSystem) {
            const nearest = this.findNearestStop(transitSystem.getStops(), fromPos);
            if (nearest) { nearest.dailyRiders++; }
          }
        }
        continue;
      }

      // --- Check commute cache first ---
      const cached = this.commuteCache.get(citizen.id);
      const currentTick = this.state.clock.tick;
      const routeKey = `${fromStr}->${toStr}`;

      if (cached && cached.status === 'ready'
          && !this.commuteCache.isDirty(citizen.id)
          && !this.commuteCache.isExpired(cached, currentTick)) {
        const variants = this.commuteCache.getRouteVariants(routeKey);
        if (variants && variants.length > 0) {
          const edgePath = variants[Math.floor(Math.random() * variants.length)]!;
          this.state.traffic.addVehicleOnEdges(edgePath, citizen.id);
          spawned++;
          continue;
        }
        // Variants pool cleared (e.g. by invalidateCell) — fall through to recompute
      }

      // --- Compute path and populate cache ---
      let variants = this.commuteCache.getRouteVariants(routeKey) ?? null;

      if (!variants) {
        // Enqueue to Worker, skip this tick — path will be available next tick
        if (this.pathBatcher && this.graphMapping) {
          if (!this.pathBatcher.isPending(routeKey)) {
            const starts = this.collectPointIndices(fromPos, 'exit');
            const ends = this.collectPointIndices(toPos, 'entry');
            if (starts.length > 0 && ends.length > 0) {
              this.pathBatcher.enqueue(routeKey, starts, ends, toPos);
            }
          }
        }
        continue;
      }

      const edgePath = variants && variants.length > 0
        ? variants[Math.floor(Math.random() * variants.length)]!
        : null;

      if (edgePath && edgePath.length > 0) {
        this.state.traffic.addVehicleOnEdges(edgePath, citizen.id);

        const existingRoute = this.commuteCache.get(citizen.id);
        const isRoadChange = existingRoute != null && existingRoute.generation !== this.commuteCache.roadGeneration;
        const cachedRoute: CachedRoute = {
          citizenId: citizen.id,
          homeId: citizen.homeId!,
          workplaceId: citizen.workplaceId!,
          morningPath: toWork ? edgePath : (isRoadChange ? null : (existingRoute?.morningPath ?? null)),
          eveningPath: toWork ? (isRoadChange ? null : (existingRoute?.eveningPath ?? null)) : edgePath,
          status: 'ready',
          generation: this.commuteCache.roadGeneration,
        };
        this.commuteCache.set(citizen.id, cachedRoute);
        spawned++;
      } else {
        this.commuteCache.set(citizen.id, {
          citizenId: citizen.id,
          homeId: citizen.homeId!,
          workplaceId: citizen.workplaceId!,
          morningPath: null,
          eveningPath: null,
          status: 'failed',
          generation: this.commuteCache.roadGeneration,
        });
      }
    }

    // Flush batched pathfinding requests to worker
    if (this.pathBatcher) this.pathBatcher.flush(100);
  }

  /**
   * Collect LaneGraph connection point indices for a building position.
   * Used by async worker pathfinding to map building → graph entry/exit points.
   */
  private collectPointIndices(
    pos: { x: number; y: number },
    pointType: 'entry' | 'exit',
  ): number[] {
    if (!this.graphMapping || !this._roadLookup) return [];
    const mapping = this.graphMapping;
    const lookup = this._roadLookup;
    const reach = ZONE_ROAD_REACH;
    const results: number[] = [];
    const suffix = pointType;

    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const keys = lookup.getAllKeysAtPosition(pos.x + dx, pos.y + dy);
        for (const key of keys) {
          // Check all points in this cell that match the desired type
          const pts = this.laneGraph.getConnectionPoints(key);
          for (const pt of pts) {
            if (pt.type === suffix) {
              const idx = mapping.pointIdToIndex.get(pt.id);
              if (idx !== undefined) results.push(idx);
            }
          }
        }
      }
    }
    return results;
  }


  private getTransitSystemInfos() {
    return getTransitSystems(this.state).map(({ type, system }) => ({
      type,
      speed: system.getSpeed(),
      vehicleCapacity: system.getCapacity(),
      routes: system.getRoutes(),
      getSegmentDistances: (routeId: number) => system.getSegmentDistances(routeId),
    }));
  }

  /**
   * Find available transit options that cover travel between origin and destination.
   * A transit route "covers" a trip if it has stops within walking distance (≤ 5 cells)
   * of both the origin and the destination.
   */
  private getAvailableTransit(
    origin: { x: number; y: number },
    destination: { x: number; y: number },
  ): AvailableTransport[] {
    return findAvailableTransit(this.getTransitSystemInfos(), origin, destination, SIMULATION.WALK_TO_STOP_RANGE);
  }

  /**
   * Spawn external vehicles entering/leaving the city via highway edge connections.
   * Vehicles are real TrafficSimulation entities that participate in congestion.
   */
  private spawnExternalHighwayTraffic(
    grid: { getCell(x: number, y: number): { roadType: number } | null; width: number; height: number },
    vehicleCap: number,
  ): void {
    if (!this.state.highwayConnection.hasExternalConnection) return;
    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Reserve 10% of vehicle cap for commute traffic
    const currentCount = this.state.traffic.getVehicleCount() - this.state.traffic.getServiceVehicleCount();
    if (currentCount >= vehicleCap * HIGHWAY_EXTERNAL.CAP_RATIO) return;

    const count = Math.min(
      HIGHWAY_EXTERNAL.MAX_PER_TICK,
      Math.floor(pop / 100 * HIGHWAY_EXTERNAL.SPAWN_PER_100_POP),
    );
    if (count <= 0) return;

    const edgeCells = this.state.highwayConnection.getEdgeHighwayCells();
    if (edgeCells.length === 0) return;

    for (let i = 0; i < count; i++) {
      if (this.state.traffic.getVehicleCount() - this.state.traffic.getServiceVehicleCount() >= vehicleCap * HIGHWAY_EXTERNAL.CAP_RATIO) break;
      if (this.buildingPositions.length === 0) return;

      const isIncoming = Math.random() < 0.5;
      const edge = edgeCells[Math.floor(Math.random() * edgeCells.length)]!;
      const bp = this.buildingPositions[Math.floor(Math.random() * this.buildingPositions.length)]!;

      if (!this._roadLookup) continue;
      if (isIncoming) {
        const endRoad = findNearRoad(grid, bp.x, bp.y, ZONE_ROAD_REACH);
        if (!endRoad || (endRoad.x === edge.x && endRoad.y === edge.y)) continue;
        const routeKey = `${toPosKey(edge.x, edge.y)}->${toPosKey(endRoad.x, endRoad.y)}`;
        let variants = this.commuteCache.getRouteVariants(routeKey) ?? null;
        if (!variants) {
          if (this.pathBatcher && this.graphMapping && !this.pathBatcher.isPending(routeKey)) {
            const starts = this.collectPointIndices(edge, 'exit');
            const ends = this.collectPointIndices(endRoad, 'entry');
            if (starts.length > 0 && ends.length > 0) this.pathBatcher.enqueue(routeKey, starts, ends, endRoad);
          }
        } else {
          const edgePath = variants[Math.floor(Math.random() * variants.length)]!;
          if (edgePath && edgePath.length > 0) this.state.traffic.addVehicleOnEdges(edgePath);
        }
      } else {
        const startRoad = findNearRoad(grid, bp.x, bp.y, ZONE_ROAD_REACH);
        if (!startRoad || (startRoad.x === edge.x && startRoad.y === edge.y)) continue;
        const routeKey = `${toPosKey(startRoad.x, startRoad.y)}->${toPosKey(edge.x, edge.y)}`;
        let variants = this.commuteCache.getRouteVariants(routeKey) ?? null;
        if (!variants) {
          if (this.pathBatcher && this.graphMapping && !this.pathBatcher.isPending(routeKey)) {
            const starts = this.collectPointIndices(startRoad, 'exit');
            const ends = this.collectPointIndices(edge, 'entry');
            if (starts.length > 0 && ends.length > 0) this.pathBatcher.enqueue(routeKey, starts, ends, edge);
          }
        } else {
          const edgePath = variants[Math.floor(Math.random() * variants.length)]!;
          if (edgePath && edgePath.length > 0) this.state.traffic.addVehicleOnEdges(edgePath);
        }
      }
    }
  }

  /** Reusable map: building position → zone type (rebuilt with building index). */
  private buildingZoneTypes = new Map<string, ZoneType>();

  /**
   * Spawn freight trucks (delegated to FreightVehicleSpawner — SRP).
   * Routes are cached in shared CommuteCache.routeIndex.
   */
  private spawnFreightTraffic(
    grid: { getCell(x: number, y: number): { roadType: number; zoneType: number } | null; width: number; height: number },
    vehicleCap: number,
  ): void {
    const freight = this.state.freight;
    const lastTrade = freight.getLastTrade();
    const lastDemand = freight.getLastDemand();
    const freightCap = Math.floor(vehicleCap * SIMULATION.FREIGHT_CAP_RATIO);

    // Rebuild activeFreight from live vehicles
    rebuildActiveFreight(this.state.traffic.vehicles, this.activeFreight);

    // Build zone type lookup from grid (reuse map, avoid per-call allocation)
    this.buildingZoneTypes.clear();
    for (const bp of this.buildingPositions) {
      const cell = grid.getCell(bp.x, bp.y);
      if (cell) this.buildingZoneTypes.set(bp.pos, cell.zoneType);
    }

    const roadLookup = this._roadLookup;
    const laneGraph = this.laneGraph;
    const commuteCache = this.commuteCache;

    spawnFreightVehicles({
      grid,
      production: lastDemand.production,
      imported: lastTrade.imported,
      exported: lastTrade.exported,
      freightCap,
      buildingPositions: this.buildingPositions,
      buildingZoneTypes: this.buildingZoneTypes,
      cachedTradePositions: this.cachedTradePositions,
      activeFreight: this.activeFreight,
      findPath: (fromRoad, toRoad) => {
        if (!roadLookup) return null;
        const routeKey = `${toPosKey(fromRoad.x, fromRoad.y)}->${toPosKey(toRoad.x, toRoad.y)}`;
        let variants = commuteCache.getRouteVariants(routeKey) ?? null;
        if (!variants) {
          // Enqueue to Worker, skip this tick
          if (this.pathBatcher && this.graphMapping && !this.pathBatcher.isPending(routeKey)) {
            const starts = this.collectPointIndices(fromRoad, 'exit');
            const ends = this.collectPointIndices(toRoad, 'entry');
            if (starts.length > 0 && ends.length > 0) {
              this.pathBatcher.enqueue(routeKey, starts, ends, toRoad);
            }
          }
          return null;
        }
        return variants && variants.length > 0
          ? variants[Math.floor(Math.random() * variants.length)]!
          : null;
      },
      addFreightVehicle: (edgePath, sourceKey) => {
        this.state.traffic.addFreightVehicle(edgePath, sourceKey);
      },
      freightTrucksPerThroughput: SIMULATION.FREIGHT_TRUCKS_PER_THROUGHPUT,
    });
  }

  /** Roll over dailyRiders for all transit systems (EMA smooth + reset). */
  private rolloverTransitRiders(): void {
    for (const { system } of getTransitSystems(this.state)) {
      system.rolloverDailyRiders();
    }
  }

  /** Tick service vehicle manager: spawn/repath patrol vehicles in coverage areas. */
  private tickServiceVehicles(): void {
    // RoadCoverageService implements ServiceFacilityProvider — no adapter needed
    const services: Record<ServiceVehicleType, ServiceFacilityProvider | null> = {
      police: this.state.police.getFacilities().length > 0 ? this.state.police : null,
      fire: this.state.fire.getFacilities().length > 0 ? this.state.fire : null,
      health: this.state.health.getFacilities().length > 0 ? this.state.health : null,
      garbage: this.state.garbage.getFacilities().length > 0 ? this.state.garbage : null,
    };
    this.serviceVehicleManager.tick(
      this.state.traffic,
      services,
      this.state.grid,
      this.laneGraph,
      this._roadLookup ?? undefined,
    );
  }

  /**
   * Compute predicted congestion flow using cached route reference counts.
   * Falls back to Monte Carlo sampling when cache coverage is too low.
   * Delegated to CongestionFlowPredictor (SRP).
   */
  private computeCongestionFlow(): void {
    const grid = this.state.grid;

    // Primary: cache-based flow prediction
    const { flowMap, totalRefCount } = computeCongestionFlow(
      this.commuteCache,
      this.flowCellSet,
      (cellKey) => {
        const { x, y } = parsePosKeyUnsafe(cellKey);
        const cell = grid.getCell(x, y);
        return cell ? getLaneCount(cell.roadType) : 1;
      },
    );

    // Fallback: Monte Carlo when cache coverage is too low
    if (totalRefCount < SIMULATION.SAMPLE_COUNT_MIN) {
      const mcDeps: CongestionFlowDeps = {
        citizens: this.state.citizens.getCitizens(),
        parsePosKey: parsePosKeyUnsafe,
        findLanePath: (from, to) => this._roadLookup
          ? findLanePath(this.laneGraph, this._roadLookup, from, to)
          : null,
        getAvailableTransit: (from, to) => this.getAvailableTransit(from, to),
        chooseTransportMode: chooseMode,
      };
      const mcFlow = computeCongestionFlowMonteCarlo(
        mcDeps,
        SIMULATION.SAMPLE_COUNT_MIN,
        SIMULATION.SAMPLE_COUNT_MAX,
        SIMULATION.SAMPLE_DIVISOR,
      );
      // Merge MC flow into main flowMap
      for (const [cellKey, flow] of mcFlow) {
        flowMap.set(cellKey, (flowMap.get(cellKey) ?? 0) + flow);
      }
    }

    this.state.traffic.updatePredictedFlow(flowMap);
  }

  /**
   * Build the walking trip pool from pending trips (aggregated),
   * then spawn pedestrians by weighted random sampling.
   */
  private spawnPedestriansFromPool(population: number): void {
    // Finalize trip pool if it was being rebuilt this rush period
    if (this.tripPoolDirty && this.pendingTrips.length > 0) {
      // Aggregate identical routes using a reusable map
      this.tripAggMap.clear();
      for (const t of this.pendingTrips) {
        const key = `${t.fromX},${t.fromY}→${t.toX},${t.toY}`;
        const existing = this.tripAggMap.get(key);
        if (existing) {
          existing.count += t.count;
        } else {
          // Reuse the trip object from pendingTrips instead of spreading
          this.tripAggMap.set(key, t);
        }
      }
      // Build trips array from map values directly
      const trips: AggregatedTrip[] = [];
      for (const v of this.tripAggMap.values()) trips.push(v);
      this.walkingTripPool = buildTripPool(trips);
      this.pendingTrips.length = 0;
      this.tripPoolDirty = false;
    }

    // Hand the pool to PedestrianManager for continuous per-frame spawning
    this.state.pedestrianManager.setTripPool(this.walkingTripPool, population);
  }

  getTransferHistory() {
    return this.transferTracker.getHistory();
  }

  setTransferHistory(data: { history: Map<string, number>[]; index: number; today: Map<string, number>; pedsSnapshot: number; lastDay?: number }) {
    this.transferTracker.setHistory(data as any);
  }

  /** Get buildings that recently used a specific transfer route label. */
  getTransferBuildings(label: string): { homes: string[]; works: string[] } {
    return this.transferTracker.getBuildings(label);
  }

  /** Get stop coordinates for a specific transfer route label (delegated — SRP). */
  getTransferRouteStops(label: string): Array<{ x: number; y: number; type: string }> {
    return findTransferRouteStops(this.transferGraph.stopRouteCache, label);
  }

  /** Transfer stats for UI display (delegated to TransferStatsQuery — SRP). */
  getTransferStats() {
    return computeTransferStats({
      transferTracker: this.transferTracker,
      walkingTripPool: this.walkingTripPool,
      stopRouteCache: this.transferGraph.stopRouteCache,
      totalActivePeds: this.state.pedestrianManager.agents.length,
      transferEdgeCount: this.transferGraph.byStop.size,
    });
  }

  private findNearestStop(
    stops: readonly { x: number; y: number; passengers: number; dailyRiders: number }[],
    pos: { x: number; y: number },
  ): { x: number; y: number; passengers: number; dailyRiders: number } | null {
    let best: { x: number; y: number; passengers: number; dailyRiders: number } | null = null;
    let bestDist = Infinity;
    for (const s of stops) {
      const dist = manhattanDistance(s.x, s.y, pos.x, pos.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    return best;
  }

}


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
import { routeCongestion, cityCongestion } from '../traffic/RouteCongestion';
import { collectEdgeCells } from '../traffic/CommuteCacheHelpers';
import { findLanePath, findLanePathVariants, findBuildingAccessPoints } from '../traffic/LaneGraphPathfinder';
import { CommuteCache, type CachedRoute } from '../traffic/CommuteCache';
import { LaneGraphBuffer, type GraphMapping } from '../traffic/LaneGraphBuffer';
import { PathRequestBatcher } from '../traffic/PathRequestBatcher';
import type { WorkerRequest } from '../traffic/PathfindingWorkerHandler';
import { computeCongestionFlow, computeCongestionFlowMonteCarlo, type CongestionFlowDeps } from '../traffic/CongestionFlowPredictor';
import { PathCellCache } from '../traffic/PathCellCache';
import { commuteSampleSize } from './CommuteSampling';
import { citizenSliceCount, commuteSliceCount, citizenSliceOf, SliceCycle } from './CitizenSlicing';
import { buildCitizenLocationIndex, type CitizenLocationIndex }
  from '../citizen/CitizenLocationIndex';
import { CongestionFlowSweep } from '../traffic/CongestionFlowSweep';
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
import { TransitAccessField, estimateCommuteTime, estimateCommute } from '../transport/TransitAccessField';
import { computeCommuteStats, type CommuteStats, type CommuteRecord } from '../citizen/CommuteStats';
import { calculateCityHappinessContext } from '../citizen/CityHappinessContext';
import { computeOccupancyRatios } from '../citizen/OccupancyRatio';
import type { WorkplaceCandidate } from '../citizen/WorkplaceScore';
import { relocationTick, DEFAULT_RELOCATION_CONFIG } from '../citizen/Relocation';
import { jobRelocationTick, DEFAULT_JOB_RELOCATION_CONFIG } from '../citizen/JobRelocation';
import { roadDistanceToTargets } from '../service/RoadCoverageFlood';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../road/RoadCellGraphBuffer';
import type { SchoolType, EnrolledCitizen } from '../service/EducationService';
import { EDUCATION_PROGRESSION, MIN_SCHOOL_AGE, type EducationRule, type DeathContext } from '../citizen/CitizenManager';
import { chooseMode, chooseModeMultiModal, type AvailableTransport } from '../transport/ModeChoice';
import { buildTransferGraph, buildStopRouteCache, findMultiModalRoutes, flattenSystems, refreshRouteService, type TransferGraph, type FlatRoute } from '../transport/MultiModalRouter';
import { calculateCitizenHealth, type HealthFactors } from '../citizen/CitizenHealth';
import { loadRatioToDeathMultiplier, uncoveredPollutionMultiplier } from '../service/HealthService';
import { TransportMode } from '../transport/types';
import { getTransitSystems, getTransitNetworkVersion, getTransitTopologyVersion, getTotalTransportOperatingCost, tickAllTransportSystems } from '../transport/TransportRegistry';
import { getTotalServiceMaintenanceCost, tickAllCivicServices, collectFacilityOperationalStatus, type FacilityOpEntry } from '../service/ServiceRegistry';
import { parsePosKey, parsePosKeyUnsafe, toPosKey, FOUR_NEIGHBORS, countRoadTiles, findNearRoad, type ReadableGrid } from '../grid/GridHelpers';
import { ZONE_ROAD_REACH } from '../grid/constants';
import type { ResidentialShoppingStatus } from '../economy/ShoppingAccess';
import { applyFireDamage } from '../service/FireDamageProcessor';
import { getCellServiceScore, getResidentialServiceRatios, getCellServiceCostScore } from '../service/ServiceCoverageQuery';
import { calculatePoliceLoads, calculateFireLoads } from '../service/PoliceFireLoadCalculator';
import { getAvgResidentialPollution, avgResidentialAt, calculateCrimeRate, rawCityCrime } from '../environment/CityMetrics';
import { syncTrafficDensityToGrid } from '../environment/SyncTrafficDensity';
import { collectTradePositions, type TradePosition } from '../traffic/FreightTradeCollector';
import { calculateZoneIncomes } from '../economy/IncomeCalculator';
import { buildIncomeCalcDeps } from '../economy/IncomeCalcAdapter';
import { totalPolicyExpense, totalPolicyRevenue, calculateTotalExpenses } from '../economy/ExpenseCalculator';
import { computeCityScales, type CityScales } from '../district/PolicyBilling';
import { tripDriveDeterrence } from '../district/PolicyManager';
import { billableDistricts } from '../district/DistrictManager';
import { calculateElevatedMaintenance } from '../elevation/ElevationMaintenance';
import { randomInt } from '../utils/random';
import { findAvailableTransit } from '../transport/TransitAvailability';
import { StopProximityIndex } from '../transport/StopProximityIndex';
import { ServiceVehicleManager, type ServiceFacilityProvider, type ServiceVehicleType } from '../traffic/ServiceVehicleManager';
import { SidewalkGraph } from '../traffic/SidewalkGraph';
import { PedestrianManager, getMaxPedestrians, buildTripPool, sampleTrip, type AggregatedTrip, type WalkingTripPool } from '../traffic/PedestrianManager';
import { PedestrianTripType } from '../traffic/PedestrianAgent';
import { WALK_DISUTILITY, walkWeightOf } from '../citizen/WalkWillingness';
import { EducationLevel } from '../citizen/types';
import type { ModeChoiceParams } from '../transport/ModeChoice';
import { SidewalkStopReach } from '../traffic/StopWalkReach';
import { WALK_RANGE_BY_TYPE } from '../transport/WalkRange';
import { TRADE } from '../traffic/FreightSystem';
import { spawnFreightVehicles, rebuildActiveFreight, type FreightSpawnContext } from '../traffic/FreightVehicleSpawner';
import { HIGHWAY_EXTERNAL } from '../traffic/HighwayConnection';

import { SIMULATION } from './SimulationConstants';
import { TransferTracker } from '../transport/TransferTracker';
import { computeTransferStats, findTransferRouteStops, TRANSIT_ICONS } from '../transport/TransferStatsQuery';


/**
 * The environment of one address. Happiness and health both need these, and they depend
 * only on the building, so every resident of the same building resolves to the same values.
 * See `SimulationLoop.homeFactsFor`.
 */
interface HomeFacts {
  x: number;
  y: number;
  powered: boolean;
  watered: boolean;
  shoppingRatio: number;
  hospitalCostRatio: number;
  parkCoverage: boolean;
  pollution: number;
}

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
  /**
   * Average load across the whole network, 0..1. Updated with the per-cell flow field
   * (every 60 ticks). Used as the fallback when a trip has no route-specific value.
   */
  private cityCongestionLevel = 0;
  /** Per-route congestion. Cleared entirely whenever the flow field is replaced. */
  private readonly routeCongestionCache = new Map<string, number>();
  /** Collection buffer for `collectEdgeCells`, reused across calls. */
  private readonly congestionCellScratch = new Set<string>();
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
  /**
   * Cells whose SIDEWALKS need rebuilding.
   *
   * Separate from `dirtyRoadCells` because rebuildLaneGraph clears that set at
   * the end of its own run, and rebuildSidewalkGraph goes second — sharing it
   * meant the sidewalk graph always saw an empty set and fell back to rebuilding
   * all of it.
   */
  private dirtySidewalkCells: Set<string> | null = null;

  // Walking trip pool: rebuilt each rush period from commute mode distribution
  private walkingTripPool: WalkingTripPool = { trips: [], totalWeight: 0, prefixSums: [] };
  private tripPoolDirty = true;
  /**
   * How many citizens' commute modes this rebuild sweep has sampled.
   *
   * "Collected zero walking trips" and "has not collected yet" are different states, and
   * `pendingTrips.length` cannot tell them apart. Zero is the correct answer once every
   * transit line has been demolished; using the length as the condition would freeze the
   * pool at its pre-demolition contents and keep pedestrians walking out of stations that
   * no longer exist.
   */
  private tripSamplesTaken = 0;
  /**
   * How many citizens a sweep must sample before it counts: one sweep is the city's whole
   * commuting population.
   *
   * A single tick only reaches a handful of citizens (375 of 8,808 commuters on a
   * 12,500-citizen save), and walking trips arrive in **bursts**: a batch of citizens
   * switches to transit at a congestion peak and none appear otherwise. Measured over
   * 45,338 consecutive samples, 260 walking trips arrived in five bursts, so committing at
   * an arbitrary tick collects zero of them nine times out of ten and leaves no pedestrians
   * on the streets.
   *
   * The initial value is 1 rather than 0, since 0 would treat "nothing sampled yet" as
   * having met the target and make an empty city commit every tick.
   */
  private tripSweepTarget = 1;
  private tripAggMap = new Map<string, AggregatedTrip>();
  private pendingTrips: AggregatedTrip[] = [];

  // Multi-modal transfer graph (rebuilt when transit network changes)
  private transferGraph: TransferGraph = { byStop: new Map(), stopRouteCache: new Map() };
  private transferGraphDirty = true;
  /**
   * Which cells each stop can be walked to from. Results are retained: the rebuild trigger
   * also fires when the player changes a route's vehicle count, which has nothing to do
   * with sidewalks.
   */
  private stopReach!: SidewalkStopReach;
  /** Which routes each cell can reach. Rebuilt together with transferGraph. */
  private transitAccess!: TransitAccessField;
  /** Which stops each cell can reach. Both stop-picking paths use it; rebuilt with the routes. */
  private stopIndex!: StopProximityIndex;

  /**
   * Length of a commute in ticks: the single scale shared by housing scoring, job scoring
   * and job-change decisions.
   *
   * Driving time rises with distance and congestion, transit time is set by the network,
   * and both are on the same scale. That makes "far out but next to a station" comparable
   * with "close but stuck in traffic every day", so the transport the player builds shows up
   * directly in where citizens live and work.
   */
  private commuteTimeBetween = (fromPos: string, toPos: string): number | null => {
    const a = parsePosKey(fromPos);
    const b = parsePosKey(toPos);
    if (!a || !b) return null;
    return estimateCommuteTime(
      a, b, this.modeChoiceFor(undefined, this.driveDeterrenceFor(a, b), this.congestionFor(a, b)),
      this.transitAccess, this.flatRoutes, SIMULATION.AVERAGE_WAIT_FACTOR,
    );
  };

  /**
   * How this citizen weighs the available options.
   *
   * With no citizen given, the default reluctance weight applies. Housing scoring asks how
   * good a home is for a specific citizen and does have one; commute statistics describe
   * the city-wide distribution, where any individual's temperament would be wrong, so the
   * average is used.
   */
  private modeChoiceFor(
    education: EducationLevel | undefined,
    driveDeterrence: number,
    congestionLevel: number,
  ): ModeChoiceParams {
    return {
      congestionLevel,
      walkSpeed: SIMULATION.WALK_SPEED,
      walkWeight: education === undefined
        ? WALK_DISUTILITY.FALLBACK
        : walkWeightOf(education),
      driveDeterrence,
    };
  }

  /**
   * The driving-reluctance multiplier this trip pays (the congestion charge).
   *
   * Either end inside a charged cordon counts: the charge is levied at the gantry, and
   * driving in and driving out are the same trip. With both ends inside, the higher of the
   * two applies rather than their product, because a trip crosses one gantry.
   */
  private driveDeterrenceFor(from: { x: number; y: number }, to: { x: number; y: number }): number {
    return this.chargedCordonFor(from, to).deterrence;
  }

  /**
   * The reluctance multiplier this trip pays, and which cordon receives it.
   *
   * With both ends inside a cordon the higher one applies and the revenue is credited to
   * that district. A trip crosses one gantry, so crediting both districts would collect the
   * same toll twice.
   */
  private chargedCordonFor(
    from: { x: number; y: number }, to: { x: number; y: number },
  ): { deterrence: number; districtId: string | null } {
    const at = (p: { x: number; y: number }) => {
      const id = this.state.districts.getDistrictAt(p.x, p.y)?.id ?? null;
      return { id, deterrence: this.state.policies.getDriveDeterrence(id) };
    };
    const a = at(from);
    const b = at(to);
    const deterrence = tripDriveDeterrence(a.deterrence, b.deterrence);
    if (deterrence <= 1) return { deterrence, districtId: null };
    return { deterrence, districtId: a.deterrence >= b.deterrence ? a.id : b.id };
  }
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
  /** Which cells a path passes through, shared across recomputes: paths are immutable, so
   *  the answer cannot change (BUG-327). */
  private readonly flowCellCache = new PathCellCache();
  /** Flow recomputation spread over several ticks; doing it in one drops five or six
   *  frames (BUG-327). */
  private readonly flowSweep = new CongestionFlowSweep();
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

  /**
   * Counterpart to `setRoadLookup`. The BUG-109 acceptance test builds its own graph from
   * the same lookup to check the cached answers; without a getter it would have to assemble
   * a second lookup, and the test would lie whenever the two disagreed.
   */
  getRoadLookup(): import('../road/UnifiedRoadLookup').UnifiedRoadLookup | null {
    return this._roadLookup;
  }

  /**
   * The road-cell graph, **rebuilt once per road generation**.
   *
   * Synchronous queries call `roadDistanceToTargets` once per citizen, and building the
   * graph is O(road cells * 4), so rebuilding per query costs more than it saves. The graph
   * only changes when the network does, so it is held here: forward for synchronous
   * queries, transposed and serialized for the worker.
   *
   * The generation comes from `commuteCache.roadGeneration`, which `markLaneGraphDirty`
   * bumps. **Building and demolishing elevated roads must go through that path too**
   * (`Game.ts` calls it), otherwise the graph goes stale — `ElevationManager` has no event
   * mechanism of its own. See `__tests__/ElevatedRoadInvalidatesGraph.test.ts`.
   */
  private _cellGraph: import('../road/RoadCellGraph').RoadCellGraph | null = null;
  private _cellGraphGeneration = -1;

  private getCellGraph(): import('../road/RoadCellGraph').RoadCellGraph | null {
    const lookup = this._roadLookup;
    if (!lookup) return null;
    const gen = this.commuteCache.roadGeneration;
    if (this._cellGraph === null || this._cellGraphGeneration !== gen) {
      this._cellGraph = buildRoadCellGraph(lookup);
      this._cellGraphGeneration = gen;
    }
    return this._cellGraph;
  }

  /**
   * The road-cell graph for external readers, sharing the instance used by the cache and
   * commuting. A rebuild is O(road cells), so rebuilding on every connectivity question
   * from the agent API would be expensive.
   */
  roadCellGraph(): import('../road/RoadCellGraph').RoadCellGraph | null {
    return this.getCellGraph();
  }

  setRoadLookup(lookup: import('../road/UnifiedRoadLookup').UnifiedRoadLookup): void {
    this._roadLookup = lookup;
  }

  /**
   * Whether this worker has ever returned a path.
   *
   * It decides whether "there is no path" counts: from a worker that has never produced
   * one, an empty answer means the worker itself is broken. Retained across road
   * generations, since whether a worker can find paths is unrelated to the network's shape.
   */
  private pathWorkerFoundAPath = false;

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
      if (!this.graphMapping) return;
      if (variants.length === 0) {
        // The worker finished and the answer is "no path exists in this road generation".
        // That differs from "not finished yet", and dropping the empty result makes the two
        // indistinguishable to `advanceCommuteFill`: the retry counter climbs to its quota
        // and every subsequent sweep recomputes the same answer on the main thread
        // (BUG-369).
        //
        // **Only a worker that has proven it can find paths is trusted.** A worker is not
        // simply present or absent: it can be alive and responding while returning nothing
        // for every origin-destination pair (no SAB, graph never synced, and so on), and
        // then an empty answer means the worker is broken rather than that no path exists.
        // Taking such answers at face value stalls the fill permanently, which
        // `WarmupCoverage` pins.
        if (this.pathWorkerFoundAPath) this.commuteCache.markUnroutable(routeKey);
        return;
      }
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
        this.pathWorkerFoundAPath = true;
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
    // Field initialisers run before the constructor body, when `this.state` is not yet
    // assigned, so these must be built here rather than as field initialisers.
    this.stopReach = new SidewalkStopReach(state.sidewalkGraph);
    this.transitAccess = TransitAccessField.build([], SIMULATION.WALK_SPEED, this.stopReach);
    this.stopIndex = StopProximityIndex.build([], this.stopReach);
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
      this.recalculateUtilityCoverage();
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
      }, capacity, this.state.ordinances.getCompulsorySchoolingStages());
      this.refreshHappinessContext();
      this.updateHospitalLoads();
      this.updateSchoolLoads();
      this.updatePoliceFireLoads();
      // Relocation: one batch per slow slot, 10 batches per cycle, so each citizen comes up
      // once every 60 ticks. Placed here because the position index has just been rebuilt
      // and occupancy counts are available directly (BUG-331).
      this.runRelocation();
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

      // The smoking ban applies to everyone; free clinics only protect citizens within
      // hospital coverage, because outside it nobody sees a doctor and the subsidy is never
      // paid out. The two multipliers therefore enter different branches below.
      const banMult = this.state.ordinances.getDeathRateMultiplier();
      const clinicMult = this.state.ordinances.getCoveredDeathRateMultiplier();

      const deadIds = this.state.citizens.deathTick(
        (citizen): DeathContext => {
          if (!citizen.homeId) return { hospitalMult: 1.0, pollutionMult: 1.0, policyMult: banMult };
          const pos = parsePosKey(citizen.homeId);
          if (!pos) return { hospitalMult: 1.0, pollutionMult: 1.0, policyMult: banMult };
          const covered = this.state.health.getCoverage(pos.x, pos.y);
          if (covered) return { hospitalMult, pollutionMult: 1.0, policyMult: banMult * clinicMult };
          const cell = this.state.grid.getCell(pos.x, pos.y);
          return {
            hospitalMult: 1.0,
            pollutionMult: uncoveredPollutionMultiplier(cell?.pollution ?? 0),
            policyMult: banMult,
          };
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

    // Job changes: one full pass every JOB_RELOCATION_INTERVAL ticks, **completed within
    // that single tick**. A whole pass costs 7.7ms, and slicing it into a couple of citizens
    // per tick made the feature stop working in large cities (BUG-333).
    if (tick >= 4 && (tick - 4) % SIMULATION.JOB_RELOCATION_INTERVAL === 0) {
      this.runJobRelocation();
    }


    // Happiness is sliced: one slice per tick, a full cycle every `slices` ticks (BUG-330).
    // The context still changes only every 6 ticks, so its freshness is unchanged.
    this.updateCitizenHappinessSlice();
    this.updateCitizenHealthSlice();

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

    // Headway and load factor must be the **current** numbers. Computing them only in the
    // rebuild above is not enough, since that runs solely when the player changes the
    // network topology: ridership growth would never reach them, so routes would never fill
    // up and waiting would never lengthen with crowding (BUG-343). Route counts are in the
    // single digits, so recomputing per tick costs a few multiplications.
    refreshRouteService(this.flatRoutes);

    // Fill in commute routes that have not been computed yet. Before vehicle spawning, so a
    // route filled this tick is usable immediately.
    this.advanceCommuteFill();

    // Traffic - spawn commute vehicles (every tick)
    this.spawnVehicles();

    // Transport systems (every tick) — pass utility checkers for operational status
    // Buses run on the roads and slow down as the network fills. This uses the network-wide
    // average load; a per-route version needs bus routes wired into the per-cell flow field
    // and is recorded in TODO.
    this.state.bus.congestionLevel = this.cityCongestionLevel;
    {
      const isPow = (x: number, y: number) => this.state.power.isPowered(x, y);
      const isWat = (x: number, y: number) => this.state.water.isSupplied(x, y);
      tickAllTransportSystems(this.state, isPow, isWat);
    }

    // Congestion flow prediction (first tick + every 60 ticks, offset to slot 2)
    //
    // Computed in one go on the first tick, so mode choice has numbers to read immediately
    // after a load. After that a sweep starts every 60 ticks and is spread over the
    // following few dozen ticks (BUG-327).
    if (tick === 1) {
      this.computeCongestionFlow();
    } else if (tick >= 2 && (tick - 2) % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.flowSweep.begin(this.commuteCache);
    }
    this.advanceCongestionFlow();

    // Commute estimation takes turns: one slice per tick, a full cycle every
    // `commuteSliceCount()` ticks. Each citizen is recomputed at the same rate as before
    // slicing (once every 60 ticks up to 126,000 citizens).
    this.advanceCommuteSlice();

    // Aggregation (shared by the overlay and the overview panel) still runs every 60 ticks,
    // offset by one from the flow prediction. The first tick computes everything: with only
    // 1/60 of citizens on record, congestion-charge revenue would be undercounted.
    if (tick === 1) {
      this.rebuildAllCommuteRecords();
      this.refreshCommuteStats();
    } else if (tick >= 3 && (tick - 3) % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.refreshCommuteStats();
    }
  }

  private commuteStats: CommuteStats = computeCommuteStats([], () => null, 0, 0);
  private commuteStatsVersion = 0;

  /**
   * Each citizen's most recently computed commute. **A cache, not a roster**: aggregation
   * always walks the list of living citizens and this only answers what a given citizen's
   * value is. Entries left behind by the dead or departed cannot vote.
   *
   * Not serialized: it can be recomputed entirely from current state.
   */
  private commuteRecords = new Map<number, CommuteRecord>();
  private readonly commuteCycle = new SliceCycle();
  /**
   * Who each slice of this cycle handles. **Bucketed at the start of a cycle, after which
   * each tick walks only its own bucket.**
   *
   * Without this layer, every tick scans all citizens to select its own slice, costing
   * population * slices filter operations per cycle. Measured at 100,000 citizens: 551ms
   * per cycle before bucketing, of which estimation was only 115 and the rest was
   * filtering. Bucketing adds one O(population) walk per cycle in place of 60.
   *
   * Buckets hold **references** and are not rebuilt mid-cycle, so the list goes stale
   * within a cycle:
   *
   * - Citizens who leave or die mid-cycle remain in their bucket and are processed once
   *   more. Nobody can read that record (aggregation walks the living), and it is dropped
   *   at the start of the next cycle — **guaranteed within a cycle, not immediately**.
   * - Citizens who arrive mid-cycle have no bucket yet and are picked up next cycle.
   *
   * Both lags are one cycle, identical to recomputing the whole city every 60 ticks.
   */
  private commuteBuckets: Citizen[][] = [];

  /** Length, mode and toll status of this commute. Returns null when it cannot be computed. */
  private commuteRecordFor(c: Citizen): CommuteRecord | null {
    if (!c.homeId || !c.workplaceId) return null;
    const home = parsePosKey(c.homeId);
    const work = parsePosKey(c.workplaceId);
    if (!home || !work) return null;
    const cordon = this.chargedCordonFor(home, work);
    const picked = estimateCommute(
      home, work,
      this.modeChoiceFor(c.education, cordon.deterrence, this.congestionFor(home, work)),
      this.transitAccess, this.flatRoutes, SIMULATION.AVERAGE_WAIT_FACTOR,
    );
    // A toll is paid only by someone still driving whose trip touches a cordon. The revenue
    // is credited to that district.
    return {
      ...picked,
      chargedDistrictId: picked.mode === TransportMode.DRIVE ? cordon.districtId : null,
    };
  }

  /**
   * The slice due this tick.
   *
   * Recomputing the **whole city** every 60 ticks puts 128ms into a single tick at 100,000
   * citizens, against 25ms available per tick at speed 10. The slice count has a floor of
   * 60, so each citizen is recomputed exactly as often as before; only the work is spread.
   *
   * This is **round-robin, not sampling**. Sampling was rejected on two grounds:
   * `chargedDriversByDistrict` directly determines congestion-charge revenue, so estimating
   * it from a sample would make the player's income jitter with who was drawn; and drawing a
   * fixed k citizens is a **systematic bias** — if the drawn citizens are unrepresentative,
   * that building shows the wrong number permanently and never self-corrects.
   *
   * ### Lag (twice the unsliced version; the cost of slicing)
   *
   * Any change — a move, a job change, toggling an ordinance — takes two steps to reach the
   * statistics:
   *
   * 1. The record waits for that citizen's slice (up to one cycle).
   * 2. Aggregation runs on its own cadence (`(tick - 3) % 60`, up to another cycle).
   *
   * Worst case is about **120 ticks (5 game days)** against 60 unsliced. That is inherent to
   * slicing plus periodic publication; getting back to one cycle would mean maintaining
   * running totals incrementally, which is the BUG-331 family (totals drift from reality
   * silently and without failing outright) and not worth trading for a lag the player cannot
   * see.
   *
   * The effect on money runs one way only: **enabling** a congestion charge takes an extra
   * cycle to reach full revenue. **Disabling** takes effect immediately, because billing
   * iterates the ordinances currently enabled on a district
   * (`calculateDistrictPolicyCost`); an ordinance not on the list is not billed regardless
   * of how many charged drivers remain in the statistics.
   */
  private advanceCommuteSlice(): void {
    // An empty city needs no special case: the slice count floors at 60, the loop walks zero
    // citizens, and the prune clears records left by the previous city. An early return would
    // keep those records forever.
    const citizens = this.state.citizens.getCitizens();

    const { slices, index } = this.commuteCycle.next(() => commuteSliceCount(citizens.length));
    // Start of a cycle: rebuild the buckets and drop records for citizens who have left.
    // `index === 0` marks the start.
    //
    // The prune sits here rather than in every tick for two reasons: the buckets have just
    // been rebuilt, so no departed citizen is added back for the rest of the cycle; and the
    // living list is already being walked for bucketing, making the prune free.
    if (index === 0) {
      this.commuteBuckets = Array.from({ length: slices }, () => []);
      const alive = new Set<number>();
      for (const c of citizens) {
        this.commuteBuckets[citizenSliceOf(c.id, slices)]!.push(c);
        alive.add(c.id);
      }
      for (const id of this.commuteRecords.keys()) {
        if (!alive.has(id)) this.commuteRecords.delete(id);
      }
    }

    for (const c of this.commuteBuckets[index] ?? []) {
      const rec = this.commuteRecordFor(c);
      if (rec) this.commuteRecords.set(c.id, rec);
      else this.commuteRecords.delete(c.id);
    }
  }

  /**
   * Computes the whole city in one pass, for loading and the first tick. Neither moment can
   * afford records for only 1/60 of citizens: `chargedDriversByDistrict` is the billing base
   * for the congestion charge, and undercounting it undercollects revenue.
   */
  private rebuildAllCommuteRecords(): void {
    this.commuteRecords.clear();
    for (const c of this.state.citizens.getCitizens()) {
      const rec = this.commuteRecordFor(c);
      if (rec) this.commuteRecords.set(c.id, rec);
    }
  }

  /**
   * Aggregates the stored records into the numbers the overlay and panel need.
   *
   * Not serialized: it can be recomputed entirely from current state, and storing it would
   * add another piece of the save format to migrate. The cost is an empty panel until the
   * first slow tick after loading.
   */
  private refreshCommuteStats(): void {
    this.commuteStats = computeCommuteStats(
      this.state.citizens.getCitizens(),
      (c) => this.commuteRecords.get(c.id) ?? null,
      DEFAULT_JOB_RELOCATION_CONFIG.commuteTimeThreshold,
      SIMULATION.COMMUTE_WORST_HOMES,
    );
    this.commuteStatsVersion++;
  }

  /**
   * How many times the statistics have changed. The renderer uses it to decide whether to
   * rebuild the commute overlay.
   *
   * The overlay is a **snapshot**: `setOverlay` runs only when the overlay is switched or a
   * subsystem rebuilds. Without this version, opening the overlay after a load yields an
   * empty snapshot, and building a metro does not change its colours until something else in
   * the city happens to change.
   */
  getCommuteStatsVersion(): number {
    return this.commuteStatsVersion;
  }

  /** City-wide commute statistics, shared by the overlay and the overview panel. */
  getCommuteStats(): CommuteStats {
    return this.commuteStats;
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
      hasElevatedAbove: (x, y) => this._elevationManager?.hasElevatedSegment(x, y) ?? false,
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
        this.applyBuildingChange(result.affectedCells);
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
      crimeRate: this.getCityCrime(),
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

  /**
   * Recomputes the city-wide context shared by the slices of the following ticks.
   *
   * Called on the same cadence as the unsliced happiness update (slow slot 4, every 6
   * ticks), so the context each citizen sees is exactly as fresh as before.
   */
  private refreshHappinessContext(): void {
    const taxRate = this.state.taxRates.residential ?? DEFAULT_TAX_RATE;
    const pop = this.state.citizens.getPopulation();
    // An empty city needs no context. Invalidation is `updateCitizenHappinessSlice`'s job:
    // it runs every tick and sets `happinessContext` back to null as soon as the city
    // empties, so clearing it again here would guard nothing.
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
      avgCrime: this.getCityCrime(),
      residentialBuildingCount: countZoneBuildings(this.state.grid, isResidentialZone),
      serviceRatios: this.getServiceRatios(),
    });

    // Check if any parks exist for happiness bonus
    const hasParkCoverage = this.state.parks.getParks().length > 0;

    // Shopping access: only penalise when population >= threshold (early game protection)
    const enableShopping = pop >= SIMULATION.SHOPPING_POP_THRESHOLD;

    this.happinessContext = { ctx, hasParkCoverage, taxRate, enableShopping };
  }

  /** Reused pending-queue counts. Cleared and rebuilt each tick, never carried across ticks. */
  private readonly pendingDeathCounts = new Map<string, number>();
  private readonly pendingGarbageCounts = new Map<string, number>();

  /**
   * The environment of this address, computed once per tick.
   *
   * Returns null when the key does not resolve to coordinates — which should not happen,
   * but `parsePosKey` is allowed to fail.
   */
  private homeFactsFor(homeId: string): HomeFacts | null {
    const tick = this.state.clock.tick;
    if (this.homeFactsTick !== tick) {
      this.homeFacts.clear();
      this.homeFactsTick = tick;
    }
    const hit = this.homeFacts.get(homeId);
    if (hit !== undefined) return hit;

    const pos = parsePosKey(homeId);
    let facts: HomeFacts | null = null;
    if (pos) {
      const cell = this.state.grid.getCell(pos.x, pos.y);
      facts = {
        x: pos.x, y: pos.y,
        powered: this.state.power.isPowered(pos.x, pos.y),
        watered: this.state.water.isSupplied(pos.x, pos.y),
        shoppingRatio: this.state.shopping.getResidentialAccess(pos.x, pos.y).ratio,
        hospitalCostRatio: this.state.health.getCostRatio(pos.x, pos.y),
        parkCoverage: this.state.parks.getCoverage(pos.x, pos.y),
        pollution: cell?.pollution ?? 0,
      };
    }
    this.homeFacts.set(homeId, facts);
    return facts;
  }

  /**
   * Whether the counts have ever been taken.
   *
   * "The first pass must always count" cannot be expressed with the versions alone: they
   * start at 0, and **a service queue restored from a save already has entries** at version
   * 0. Using `-1` as a sentinel would require both fields to be -1 at once, stating one fact
   * in two places where each masks the other's failure.
   */
  private pendingCountsEverCounted = false;
  /** The queue versions at the last count. */
  private pendingCountsDeathVersion = 0;
  private pendingCountsGarbageVersion = 0;

  /**
   * Counts the pending body and garbage queues into entries per cell.
   *
   * Rebuilt every tick: queue length is how many pickups are outstanding and is unrelated to
   * population. Folding it into a slow-slot snapshot would let only the first few slices of
   * a cycle see the events as they were.
   */
  private refreshPendingCounts(): void {
    // Reuse the previous table while neither queue has changed. This runs every tick, while
    // the queues change only every 6 ticks — see `GlobalCoverageService.pendingVersion`.
    const deathVersion = this.state.deathCare.pendingVersion;
    const garbageVersion = this.state.garbage.pendingVersion;
    if (this.pendingCountsEverCounted
      && deathVersion === this.pendingCountsDeathVersion
      && garbageVersion === this.pendingCountsGarbageVersion) return;
    this.pendingCountsEverCounted = true;
    this.pendingCountsDeathVersion = deathVersion;
    this.pendingCountsGarbageVersion = garbageVersion;

    this.pendingDeathCounts.clear();
    for (const d of this.state.deathCare.getPendingDeathQueue()) {
      const key = toPosKey(d.x, d.y);
      this.pendingDeathCounts.set(key, (this.pendingDeathCounts.get(key) ?? 0) + 1);
    }
    this.pendingGarbageCounts.clear();
    for (const g of this.state.garbage.getPendingGarbageQueue()) {
      const key = toPosKey(g.x, g.y);
      this.pendingGarbageCounts.set(key, (this.pendingGarbageCounts.get(key) ?? 0) + 1);
    }
  }

  /**
   * Who each slice of this cycle handles — one set for happiness, one for health.
   *
   * Same shape and rationale as `commuteBuckets` (documented in full there): without this
   * layer, every tick scans all citizens to select its own slice, costing
   * population * slices filter operations per cycle. 42,000 citizens split into 20 slices of
   * about 2,110 each means **scanning 42,000 citizens per tick to find 2,110**. Measured,
   * `citizenSliceOf` accounted for 8.3% of the happiness pass and 40.6% of the health pass,
   * on top of the loop's own traversal.
   *
   * Two separate sets rather than one shared: each cycle calls `next()` independently, and
   * happiness returns early when no context is available yet (that tick does not advance).
   * Once they diverge, a shared bucket set would be rebuilt in the middle of the other's
   * cycle.
   *
   * Staleness within a cycle matches the commute side: citizens who leave or die mid-cycle
   * remain in their bucket and are processed once more, writing into an object nobody reads;
   * citizens who arrive mid-cycle have no bucket yet and are picked up next cycle. New
   * citizens already carry default happiness and health, and city-wide averages walk the
   * living list.
   */
  private happinessBuckets: Citizen[][] = [];
  private healthBuckets: Citizen[][] = [];

  /**
   * Recomputes happiness for the slice of citizens due this tick.
   *
   * Each citizen stores their own happiness and those not due keep their previous value, so
   * the city-wide average remains the sum over all citizens divided by their count,
   * unaffected by which slice was just recomputed. This is **round-robin, not sampling**:
   * nobody is skipped, and every citizen comes up within `slices` ticks.
   *
   * Measured at 70,891 citizens, the unsliced version put 68.5ms into a single tick
   * (BUG-330).
   */
  private updateCitizenHappinessSlice(): void {
    const citizens = this.state.citizens.getCitizens();
    if (citizens.length === 0) {
      // Empty city: the context is invalidated too, so citizens who move in later do not
      // inherit the previous city's tax rates and services.
      this.happinessContext = null;
      this.happinessCycle.reset();
      this.lastHappinessSlice = { slices: 0, index: -1, updated: 0 };
      return;
    }
    // The context is built in slow slot 4 while slices run every tick, so the first few ticks
    // of a new game or after a load have none. Without this fallback those slices are skipped
    // and the first cycle covers only part of the population.
    if (this.happinessContext === null) this.refreshHappinessContext();
    const cached = this.happinessContext;
    if (cached === null) return;
    const { ctx, hasParkCoverage, taxRate, enableShopping } = cached;

    this.refreshPendingCounts();
    const pendingDeathCounts = this.pendingDeathCounts;
    const pendingGarbageCounts = this.pendingGarbageCounts;

    const currentTick = this.state.clock.tick;
    const { slices, index: mySlice } =
      this.happinessCycle.next(() => citizenSliceCount(citizens.length));
    // Start of a cycle: rebuild the buckets. `index === 0` marks the start, and `SliceCycle`
    // guarantees the slice count only changes there, so the bucket count and `slices` cannot
    // disagree within a cycle.
    if (mySlice === 0) {
      this.happinessBuckets = Array.from({ length: slices }, () => []);
      for (const c of citizens) this.happinessBuckets[citizenSliceOf(c.id, slices)]!.push(c);
    }
    const myCitizens = this.happinessBuckets[mySlice] ?? [];
    let updated = 0;

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

    for (const citizen of myCitizens) {
      updated++;

      // Vary commute per citizen (+/- 3 random jitter)
      factors.commuteDistance = Math.max(1, ctx.avgCommute + (Math.random() * SIMULATION.COMMUTE_JITTER - SIMULATION.COMMUTE_JITTER / 2));

      // Check if citizen's home has power and water
      factors.homePowered = true;
      factors.homeWatered = true;
      factors.shoppingAccess = undefined;
      factors.pendingDeathsAtHome = 0;
      factors.pendingGarbageAtHome = 0;
      if (citizen.homeId) {
        const home = this.homeFactsFor(citizen.homeId);
        if (home) {
          factors.homePowered = home.powered;
          factors.homeWatered = home.watered;
          if (enableShopping) factors.shoppingAccess = home.shoppingRatio;
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
    this.lastHappinessSlice = { slices, index: mySlice, updated };
  }

  /**
   * How many citizens live in and work at each building. Built once in slow slot 4 and
   * shared by the hospital, school and police/fire services.
   *
   * All three compute per-cell demand, and every resident of the same building yields the
   * same answer. Scanning per citizen in each service costs two `parsePosKey` calls, two
   * `getCoverage` calls and one `getCell` per citizen: measured at 120,000 citizens,
   * `updatePoliceFireLoads` 102ms, `updateHospitalLoads` 33ms, `updateSchoolLoads` 21ms.
   */
  private citizenLocations: CitizenLocationIndex = buildCitizenLocationIndex([]);
  private citizenLocationsTick = -1;

  /**
   * Ensures this tick's location index is current.
   *
   * **Every consumer is responsible for it**, rather than building it once in slow slot 4:
   * the daily death settlement also calls `updateHospitalLoads`, and that runs after slot 5
   * (migration, housing, relocation), so a slot-4 index would miss citizens who just moved
   * in and count citizens who just moved out. Loading is worse: a SimulationLoop constructed
   * after slot 4 but before the day boundary still has an empty index, hospital demand comes
   * out as 0, and the death rate gets a wrongly low multiplier.
   *
   * Repeat calls within a tick are free, so the three services in slot 4 still build it once.
   */
  private ensureCitizenLocations(): void {
    const tick = this.state.clock.tick;
    if (this.citizenLocationsTick === tick) return;
    this.citizenLocations = buildCitizenLocationIndex(this.state.citizens.getCitizens());
    this.citizenLocationsTick = tick;
  }

  private updateHospitalLoads(): void {
    this.ensureCitizenLocations();
    const coveredCitizens: Array<{ x: number; y: number; pollution: number; count: number }> = [];
    for (const [home, count] of this.citizenLocations.homeCounts) {
      const pos = parsePosKey(home);
      if (!pos || !this.state.health.getCoverage(pos.x, pos.y)) continue;
      const cell = this.state.grid.getCell(pos.x, pos.y);
      coveredCitizens.push({ x: pos.x, y: pos.y, pollution: cell?.pollution ?? 0, count });
    }
    this.state.health.updateLoads(coveredCitizens);
  }

  private updateSchoolLoads(): void {
    // Count by building, school stage and headcount first. The separator is `|` rather than a
    // comma because elevated cells have three-part keys (`27,55,1`) that a comma would split
    // incorrectly.
    const enrolledCounts = new Map<string, number>();
    const eligibleCounts = new Map<string, number>();
    for (const c of this.state.citizens.getCitizens()) {
      if (!c.homeId || c.age < MIN_SCHOOL_AGE) continue;
      const rule = EDUCATION_PROGRESSION.find(r => c.education === r.requiredEducation);
      if (!rule) continue;
      const key = `${c.homeId}|${rule.schoolKey}`;
      const target = c.educationProgress > 0 ? enrolledCounts : eligibleCounts;
      target.set(key, (target.get(key) ?? 0) + 1);
    }

    const split = (key: string) => {
      const at = key.lastIndexOf('|');
      return {
        pos: parsePosKey(key.slice(0, at)),
        schoolKey: key.slice(at + 1) as EnrolledCitizen['schoolKey'],
      };
    };

    const enrolled: EnrolledCitizen[] = [];
    for (const [key, count] of enrolledCounts) {
      const { pos, schoolKey } = split(key);
      if (!pos) continue;
      enrolled.push({ x: pos.x, y: pos.y, schoolKey, count });
    }

    const eligible: EnrolledCitizen[] = [];
    for (const [key, count] of eligibleCounts) {
      const { pos, schoolKey } = split(key);
      if (!pos) continue;
      // Eligible but not enrolled (waiting for capacity)
      const schoolType = ({ elementary: 'elementary', highSchool: 'highschool', university: 'university' } as const)[schoolKey];
      if (!this.state.education.getCoverage(pos.x, pos.y, schoolType)) continue;
      eligible.push({ x: pos.x, y: pos.y, schoolKey, count });
    }

    this.state.education.updateSchoolLoads(enrolled, eligible);
  }

  private updatePoliceFireLoads(): void {
    this.ensureCitizenLocations();
    const grid = this.state.grid;
    const getResidents = (id: number) => getBuildingType(id)?.residents ?? 1;
    const index = this.citizenLocations;

    const policeDemands = calculatePoliceLoads(index, this.state.police, grid);
    const fireDemands = calculateFireLoads(index, this.state.fire, grid, getResidents);

    this.state.police.updateStationLoads(policeDemands);
    this.state.fire.updateStationLoads(fireDemands);
  }

  /** Reusable health factors object — mutated per citizen, no allocation per iteration. */
  private healthFactors: HealthFactors = {
    hospitalCostRatio: -1, hasParkCoverage: false,
    pollution: 0, hasHome: false, age: 0,
  };

  /**
   * Recomputes health for the slice of citizens due this tick.
   *
   * Uses the same slicing as happiness (`SliceCycle` + `citizenSliceOf`), so both land on
   * the same tick for a given citizen and their address is looked up once. Health is stored
   * per citizen and those not due keep their previous value. Measured at 120,000 citizens,
   * the unsliced version took 28ms.
   */
  private updateCitizenHealthSlice(): void {
    const citizens = this.state.citizens.getCitizens();
    if (citizens.length === 0) {
      this.healthCycle.reset();
      this.lastHealthSlice = { slices: 0, index: -1, updated: 0 };
      return;
    }

    const { slices, index: mySlice } =
      this.healthCycle.next(() => citizenSliceCount(citizens.length));
    if (mySlice === 0) {
      this.healthBuckets = Array.from({ length: slices }, () => []);
      for (const c of citizens) this.healthBuckets[citizenSliceOf(c.id, slices)]!.push(c);
    }
    const f = this.healthFactors;
    let updated = 0;

    for (const c of this.healthBuckets[mySlice] ?? []) {
      updated++;

      f.hasHome = !!c.homeId;
      f.hospitalCostRatio = -1;
      f.hasParkCoverage = false;
      f.pollution = 0;
      f.age = c.age;

      if (c.homeId) {
        const home = this.homeFactsFor(c.homeId);
        if (home) {
          f.hospitalCostRatio = home.hospitalCostRatio;
          f.hasParkCoverage = home.parkCoverage;
          f.pollution = home.pollution;
        }
      }

      c.health = calculateCitizenHealth(f);
    }
    this.lastHealthSlice = { slices, index: mySlice, updated };
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

  /**
   * The city's effective crime rate: the base value plus city-wide ordinances.
   *
   * Happiness, migration attractiveness and abandonment stress all read this number.
   * Without the ordinance term the panel reads Crime -13 while residents feel nothing.
   *
   * Public because `SummaryStats` computes the same number from `GameState` (via
   * `effectiveCityCrime`), and checking that the two agree requires this side to be
   * reachable.
   *
   * Clamped at 0: a negative crime rate becomes a bonus downstream, most visibly in land
   * value, where `calculateLandValue` does `value -= crimeRate * CRIME_PENALTY`, so stacking
   * more suppressors would earn more.
   */
  getCityCrime(): number {
    return Math.max(0, this.getRawCityCrime());
  }

  /**
   * The city-wide crime rate before clamping.
   *
   * Per-cell consumers need this one: clamping may happen only once, and only after both the
   * city-wide and district terms are added. Clamping the city-wide half first turns a base
   * of 1 plus a camera network's -100 into 0, so a casino's +120 lands at 120, where
   * clamping after summing everything gives 21. The same cell would then read 21 on the
   * land-value path and 120 on the abandonment path.
   */
  private getRawCityCrime(): number {
    return rawCityCrime(
      this.state.citizens.getPopulation(),
      this.state.police.getStations().length,
      this.state.ordinances.getCrimeBonus(),
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

    // Congestion-charge tolls, currently the only revenue-earning ordinance. Added **after**
    // the specialization bonus, which applies to industry tax revenue rather than to fees.
    totalIncome += totalPolicyRevenue(
      this.billableDistricts(), this.state.ordinances, this.cityScales());

    this.state.budget.income = totalIncome;
    // Expenses: road maintenance + service + district policies + transport
    this.state.budget.expenses = calculateTotalExpenses({
      roadMaintenance: this.countRoadTiles() * ECONOMY.ROAD_MAINTENANCE_PER_TILE,
      serviceCost: getTotalServiceMaintenanceCost(this.state),
      policyCost: totalPolicyExpense(
        this.billableDistricts(), this.state.ordinances, this.cityScales(),
      ),
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
    }, (x, y) => this.state.policies.getIndustrialPollutionMultiplier(
      this.state.districts.getDistrictAt(x, y)?.id ?? null));
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
      const districtId = this.state.districts.getDistrictAt(x, y)?.id ?? null;
      const value = calculateLandValue({
        serviceCoverage,
        parkProximity,
        waterfront,
        pollution: (pollution.ground + pollution.water) * pollutionFactor,
        noise: pollution.noise * pollutionFactor,
        // Ordinances move this cell in both directions: land value up (organic food) and
        // crime up (tourism). The district is looked up once, since this runs per cell.
        //
        // District and city-wide effects add: the two scopes are independent decisions, not
        // alternatives.
        //
        // Crime is clamped at 0: `calculateLandValue` does `value -= crimeRate *
        // CRIME_PENALTY`, so a negative crime rate turns straight into a land-value bonus.
        // A curfew stacked on a camera network can push crime negative, at which point
        // "low crime" becomes "land value out of nowhere", and stacking more earns more.
        crimeRate: Math.max(0, this.getAvgCrime()
          + this.state.policies.getCrimeBonus(districtId)
          + this.state.ordinances.getCrimeBonus()),
        policyBonus: this.state.policies.getLandValueBonus(districtId)
          + this.state.ordinances.getLandValueBonus(),
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
      getCrimeReduction: (x, y) => this.state.police.getCrimeReduction(x, y)
        + this.state.policies.getCrimeBonus(this.state.districts.getDistrictAt(x, y)?.id ?? null),
      getServiceScore: (x, y, isRes) => getCellServiceCostScore(this.state, x, y, isRes),
      isPowered: (x, y) => this.state.power.isPowered(x, y),
      isWatered: (x, y) => this.state.water.isSupplied(x, y),
      getFreightSupplyRatio: (x, y) => this.state.freight.getSupplyStatus(x, y).ratio,
      getFreightSurplusRatio: () => this.state.freight.getSurplusRatio(),
      baseCrime: this.getRawCityCrime(),
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
      fertilityMultiplier: this.state.ordinances.getFertilityMultiplier(),
    }, this.state.clock.tick);
  }

  /**
   * The city-wide scales this billing period uses.
   *
   * Subsidy ordinances bill per actual beneficiary, so the bill needs the age structure and
   * hospital coverage, not just the headcount.
   */
  cityScales(): CityScales {
    return computeCityScales(
      this.state.citizens.getCitizens(),
      (x, y) => this.state.health.getCoverage(x, y),
    );
  }

  /** Per-district billing data: road cells and paying citizens. Shared by the ledger, the
   *  panel and settlement. */
  billableDistricts() {
    return billableDistricts(
      this.state.grid, this.state.districts.getAllDistricts(), this.commuteStats);
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

    // Trigger async cache update if stale.
    //
    // The worker receives a RoadCellGraph, in which levels and ramps are resolved at build
    // time, and both paths share one flood core. A gate that disabled the cache whenever any
    // elevated road existed (BUG-109) was needed only while the worker got a flat cell
    // buffer it could not see elevation in.
    if (this.wpDistCache && this.wpDistCache.isStale && workplaceCandidates.length > 0) {
      const wpPositions = workplaceCandidates.map(c => {
        const p = parsePosKeyUnsafe(c.pos);
        return { pos: c.pos, x: p.x, y: p.y };
      });
      // Copy grid buffer for worker (ArrayBuffer → new copy for transfer)
      const srcBuf = this.state.grid.getBuffer();
      const copy = new ArrayBuffer(srcBuf.byteLength);
      new Uint8Array(copy).set(new Uint8Array(srcBuf));
      // The graph is where the worker's traversal rules come from; levels and ramps are
      // resolved at build time. The **transposed** graph is sent: cost is charged at the
      // destination cell, so a reverse flood over the forward graph would pay the source
      // cell's price (BUG-237).
      const graph = this.getCellGraph();
      if (graph) {
        const graphBuffer = serializeRoadCellGraph(transposeRoadCellGraph(graph));
        this.wpDistCache.requestUpdate(
          this.state.grid.width, this.state.grid.height,
          copy, graphBuffer, wpPositions, DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
        );
      }
      // Without a lookup there is no graph, so no update is requested this pass and
      // assignment falls through to the synchronous path.
    }

    // Build reachability map: use cache if ready, otherwise sync Dijkstra fallback
    // `hasTable` rather than `isReady`: a table one cycle behind beats a synchronous
    // Dijkstra by far. Measured on a 40,000-citizen save, the cached path took 161ms against
    // 2,684ms synchronous, while the cache is only "current" for 6-8 seconds and
    // reassignment runs every 13, so which one you land on is luck.
    const reachable = this.wpDistCache?.hasTable
      ? this.buildWorkplaceReachabilityFromCache(workingAgeCitizens, workplaceCandidates)
      : this.buildWorkplaceReachability(workingAgeCitizens, workplaceCandidates);
    assignWorkWithPreference(workingAgeCitizens, workplaceCandidates, workOccupancy, reachable, this.commuteTimeBetween);

    // Then assign housing with preference scoring
    const homeOccupancy = countOccupancy(citizens, (c) => c.homeId);
    assignWithPreference(citizens, housingCandidates, homeOccupancy, this.commuteTimeBetween);

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
   * The last run: which tick, which batch, the quota, how many were considered and how many
   * moved.
   *
   * `tick` lets readers tell "this ran on this tick" from "this is left over from last
   * time". It runs only every 6 ticks, so without checking the tick the same result would be
   * counted six times.
   */
  lastHousingRelocation =
    { tick: -1, slice: -1, quota: 0, considered: 0, relocated: 0, cityUnhappy: 0 };

  /**
   * Run relocation tick: unhappy citizens may move to better housing.
   *
   * **One batch** per slow slot, a full cycle every `HOUSING_RELOCATION_SLICES` batches, so
   * each citizen comes up once every 60 ticks.
   *
   * The whole thing completes **within a single tick**: the housing candidates, the
   * occupancy counts and the citizen list are taken, used and discarded on the spot.
   * Spreading one batch's list over dozens of ticks makes all three snapshots stale
   * (BUG-331).
   */
  private runRelocation(): void {
    this.rebuildBuildingIndex();

    const housingCandidates = buildHousingCandidates(
      this.buildingPositions, this.state.grid, this.state.pollution, this.state.parks,
    );
    if (housingCandidates.length === 0) {
      this.lastHousingRelocation = {
        tick: this.state.clock.tick, slice: -1, quota: 0,
        considered: 0, relocated: 0, cityUnhappy: 0,
      };
      return;
    }

    const citizens = this.state.citizens.getCitizens();
    const slices = SIMULATION.HOUSING_RELOCATION_SLICES;
    const mySlice = Math.floor(this.state.clock.tick / SIMULATION.SLOW_TICK_INTERVAL) % slices;
    // Batched by a hash of the id rather than by position in the list: citizens created at
    // the same time tend to live in the same area, so splitting by position makes each batch
    // a city block and any reaction sweep the city one block at a time (as in
    // CitizenSlicing).
    const inSlice = (c: Citizen) => citizenSliceOf(c.id, slices) === mySlice;

    // One pass counts both this batch's size and the **city-wide** number of unhappy
    // citizens.
    const cfg = DEFAULT_RELOCATION_CONFIG;
    let considered = 0;
    let cityUnhappy = 0;
    for (const c of citizens) {
      if (inSlice(c)) considered++;
      if (c.homeId !== null && c.happiness < cfg.happinessThreshold) cityUnhappy++;
    }

    // The quota is computed **city-wide** and then split across the ten batches by a
    // staircase, summing to exactly the 5% an unsliced run would move. Taking 5% per batch
    // instead would let `Math.max(1, Math.floor(...))` round every small batch up to 1 and
    // move several times as many citizens per cycle.
    const cycleQuota = Math.max(1, Math.floor(cityUnhappy * cfg.maxRelocateRatio));
    const quota = Math.floor((mySlice + 1) * cycleQuota / slices)
      - Math.floor(mySlice * cycleQuota / slices);

    // Occupancy counts **every citizen**, not just this batch: whether a home has room is
    // unrelated to whose turn it is.
    const homeOccupancy = countOccupancy(citizens, (c) => c.homeId);
    const { relocatedIds } = relocationTick(
      citizens, housingCandidates, homeOccupancy, undefined, inSlice, quota);
    // A citizen who moved needs their commute cache cleared so the route is recomputed.
    for (const id of relocatedIds) this.commuteCache.remove(id);
    this.lastHousingRelocation = {
      tick: this.state.clock.tick, slice: mySlice, quota,
      considered, relocated: relocatedIds.length, cityUnhappy,
    };
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

    // The graph must be passed. Without it, `roadDistanceToTargets` builds **one per home**,
    // and building it is O(road cells * 4), while this loop iterates every distinct address
    // in the city.
    const cellGraph = this.getCellGraph() ?? undefined;
    for (const homeId of homeIds) {
      const homePos = parsePosKeyUnsafe(homeId);
      const distMap = roadDistanceToTargets(
        this.state.grid, homePos, targetSet,
        DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
        this._roadLookup, cellGraph,
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
  private runJobRelocation(): void {
    this.rebuildBuildingIndex();

    const workplaceCandidates = buildWorkplaceCandidates(this.buildingPositions);
    if (workplaceCandidates.length === 0) return;

    const citizens = this.state.citizens.getCitizens();
    const workOccupancy = countOccupancy(citizens, (c) => c.workplaceId);

    // Use cache-based distance lookup when ready (O(1) per lookup, no Dijkstra).
    // Otherwise fall back to the synchronous graph walk.
    //
    // The cache is level-aware and both paths share one flood core, so they cannot give
    // different answers; no elevated-road gate is needed (BUG-109).
    //
    // The fallback must be passed the graph: this closure is **called once per citizen**,
    // and building the graph is O(road cells * 4). The graph is cached by road generation, so
    // a whole pass builds it once.
    const roadLookup = this._roadLookup;
    const cellGraph = this.getCellGraph() ?? undefined;
    const distanceLookup = this.wpDistCache?.hasTable
      ? (_grid: any, homePos: { x: number; y: number }, targets: Set<string>, _budget: number) => {
          const homeKey = toPosKey(homePos.x, homePos.y);
          return this.wpDistCache!.getDistancesFromHome(homeKey, targets);
        }
      : (grid: ReadableGrid, homePos: { x: number; y: number }, targets: Set<string>, budget: number) =>
          roadDistanceToTargets(grid, homePos, targets, budget, roadLookup, cellGraph);

    const { relocatedIds } = jobRelocationTick(
      citizens,
      workplaceCandidates,
      workOccupancy,
      this.commuteCache,
      this.state.grid,
      this.state.clock.tick,
      undefined,
      distanceLookup,
      // Commute duration, with driving, walking and transit all converted to one time scale.
      (c: Citizen) => {
        if (!c.homeId || !c.workplaceId) return NaN;
        return this.commuteTimeBetween(c.homeId, c.workplaceId) ?? NaN;
      },
    );
    // A citizen who changed jobs needs their commute cache cleared so the route is
    // recomputed.
    for (const id of relocatedIds) this.commuteCache.remove(id);
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
   *  @param onProgress called with (0-1) for sub-progress updates
   *
   * **Only the routes actually needed right now are computed.** Computing both directions
   * for every employed citizen, when only the `spawnRatio` fraction produces a vehicle,
   * measured on a 2,146-citizen save as 1,805 citizens x 2 directions = 3,610 A* runs at
   * roughly 8ms each, holding the loading screen for 20 seconds, four fifths of it for
   * citizens who never take to the road.
   *
   * The citizens skipped come to no harm: when `spawnCommuteVehicles` finds no route it
   * hands the request to the pathfinding worker and uses the result next tick, which is
   * asynchronous and on another thread.
   */
  async warmup(spawnRatio = 0.2, onProgress?: (ratio: number) => void): Promise<{ pathsComputed: number; vehiclesSpawned: number }> {
    this.ensureLaneGraph();
    if (!this._roadLookup) return { pathsComputed: 0, vehiclesSpawned: 0 };

    const citizens = this.state.citizens.getCitizens();
    let pathsComputed = 0;
    let vehiclesSpawned = 0;

    for (let i = 0; i < citizens.length; i++) {
      // Report sub-progress every 100 citizens.
      //
      // At the **start** of the loop: the `continue` below is the common case (only the
      // `spawnRatio` fraction proceeds), so reporting at the end would leave the progress bar
      // motionless most of the time.
      if (i % 100 === 0 && onProgress) {
        onProgress(i / citizens.length);
        await new Promise(r => requestAnimationFrame(r));
      }

      const c = citizens[i]!;
      if (!c.homeId || !c.workplaceId) continue;

      // Decide whether this citizen takes to the road before deciding whether to compute a
      // path. The other order spends four fifths of the searches on citizens who do not.
      if (Math.random() >= spawnRatio) {
        this.markCommutePending(c);
        continue;
      }

      const home = parsePosKey(c.homeId);
      const work = parsePosKey(c.workplaceId);
      if (!home || !work) { this.markCommutePending(c); continue; }

      // A vehicle drives one direction, so only that direction's path is needed.
      const toWork = Math.random() < 0.5;
      const fromPos = toWork ? home : work;
      const toPos = toWork ? work : home;
      const routeKey = toWork
        ? `${c.homeId}->${c.workplaceId}`
        : `${c.workplaceId}->${c.homeId}`;

      let variants = this.commuteCache.getRouteVariants(routeKey) ?? null;
      if (!variants) {
        variants = findLanePathVariants(this.laneGraph, this._roadLookup, fromPos, toPos);
        if (variants.length > 0) {
          this.commuteCache.setRouteVariants(routeKey, variants);
        }
      }
      if (!variants || variants.length === 0) { this.markCommutePending(c); continue; }

      const path = variants[Math.floor(Math.random() * variants.length)]!;
      if (path.length === 0) { this.markCommutePending(c); continue; }

      // Only the direction taken is filled; the other stays null, which is the same shape
      // the ordinary path (`spawnCommuteVehicles`) writes.
      this.commuteCache.set(c.id, {
        citizenId: c.id,
        homeId: c.homeId,
        workplaceId: c.workplaceId,
        morningPath: toWork ? path : null,
        eveningPath: toWork ? null : path,
        status: 'ready',
        generation: this.commuteCache.roadGeneration,
      });
      pathsComputed++;

      this.state.traffic.spawnVehicleOnEdges(path, c.id);
      vehiclesSpawned++;
    }

    // The statistics are computed once here. They are not serialized, so they are empty the
    // moment loading finishes; what differs is when the player sees that. This runs behind
    // the loading screen, whereas the first tick is already in-game, and opening the commute
    // overlay immediately would show a blank map.
    //
    // The accessibility field is built first, otherwise the commutes computed here contain no
    // transit at all and are corrected only on the first tick, making the colours jump once
    // after entering the game.
    //
    // The sidewalk graph must come earlier still: stop catchments are measured along it, and
    // while it is empty every stop serves nobody. Loading only calls ensureLaneGraph, so
    // without this the sidewalk graph waits for the first tick.
    this.ensureSidewalkGraph();
    this.rebuildTransferGraphIfDirty();
    this.rebuildAllCommuteRecords();
    this.refreshCommuteStats();

    onProgress?.(1);
    return { pathsComputed, vehiclesSpawned };
  }

  /**
   * Records that a citizen commutes but their path has not been computed yet.
   *
   * Without the marker, consumers cannot tell "not computed yet" from "computed, and there
   * is no commute". `JobRelocation` falls back to guessing the commute from straight-line
   * Manhattan distance when it finds no entry, so the first job-change pass after loading
   * would decide who switches jobs from guesses.
   *
   * Citizens who already have an entry are left alone: this only fills blanks and never
   * overwrites a computed result.
   */
  private markCommutePending(c: { id: number; homeId: string | null; workplaceId: string | null }): void {
    if (!c.homeId || !c.workplaceId) return;
    if (this.commuteCache.get(c.id)) return;
    this.commuteCache.set(c.id, {
      citizenId: c.id,
      homeId: c.homeId,
      workplaceId: c.workplaceId,
      morningPath: null,
      eveningPath: null,
      status: 'pending',
      generation: this.commuteCache.roadGeneration,
    });
  }

  /**
   * How many times the background fill has handed each route to the worker.
   *
   * This is the "compute it here once the worker fails to answer" counter. A worker can be
   * alive and responding while returning nothing for every origin-destination pair; without
   * COOP/COEP in production there is not even a SharedArrayBuffer, and `Game.ts` swallows a
   * failure to construct the worker silently. Without this limit the fill queues forever.
   *
   * Cleared entirely whenever the road network changes: a newly built road may be exactly
   * what connects them.
   */
  private commuteFillAttempts = new Map<string, number>();
  private commuteFillAttemptsGeneration = -1;
  /** Last tick's intended sample size, actual sample size and scale-up factor. Read by tests
   *  and the panel (BUG-328). */
  lastCommuteSample: { attempts: number; samples: number; scale: number } =
    { attempts: 0, samples: 0, scale: 1 };
  /**
   * City-wide context, recomputed every SLOW_TICK_INTERVAL ticks (the same cadence as the
   * unsliced version) and shared by the slices. It contains an O(population) adult count,
   * and rerunning that every tick would consume what slicing saves (BUG-330).
   *
   * The pending body and garbage queues are **not** here: they are short-lived events, while
   * a snapshot must survive a whole cycle. A large city's cycle is 72 ticks, so only the 6
   * ticks around the refresh would see the snapshot and the other 66 slices would never know
   * a body was at the door. The queues are only as long as the outstanding pickups, so
   * rebuilding them per tick is free.
   */
  private happinessContext: {
    ctx: ReturnType<typeof calculateCityHappinessContext>;
    hasParkCoverage: boolean;
    taxRate: number;
    enableShopping: boolean;
  } | null = null;
  /** Cursor for the happiness cycle. The slice count is fixed at the start of a cycle; see
   *  `SliceCycle`. */
  private readonly happinessCycle = new SliceCycle();
  /** Cursor for the health cycle. Shares the happiness hash, so a citizen's two values update
   *  on the same tick. */
  private readonly healthCycle = new SliceCycle();
  /** Last tick's slice count and index. Read by tests and measurement. */
  lastHappinessSlice = { slices: 0, index: -1, updated: 0 };
  /** The same figures for health. */
  lastHealthSlice = { slices: 0, index: -1, updated: 0 };

  /**
   * Addresses already resolved this tick, shared by happiness and health.
   *
   * Both need whether the address has power and water, how polluted it is, its healthcare
   * cost ratio and park coverage — all of which depend only on the building. With 12,434
   * citizens in 103 buildings, resolving per citizen queries the same building 120 times.
   * Measured, that section took 18.4ms per pass at 61,436 citizens and 6.0ms once memoized
   * by address.
   *
   * **Cleared every tick**, not every 6. Power cuts, water shortages and pollution are all
   * visible to the player and can change abruptly, so a cache spanning ticks lags. Rebuilding
   * costs only as many addresses as this slice touches.
   */
  private readonly homeFacts = new Map<string, HomeFacts | null>();
  private homeFactsTick = -1;
  /** How far through the citizen list the fill got last time. See advanceCommuteFill
   *  (BUG-329). */
  private commuteFillCursor = 0;
  /** How many citizens were examined this tick. The time saved is this number; read by tests. */
  private commuteFillScanned = 0;

  /** Whether this citizen's commute routes are complete in the cache: both directions, and
   *  from the current road generation. */
  private commuteRouteSettled(entry: CachedRoute | undefined, generation: number): boolean {
    if (!entry || entry.generation !== generation) return false;
    // Routes already computed and known to be impassable are not recomputed each tick.
    if (entry.status === 'failed') return true;
    return entry.morningPath !== null && entry.eveningPath !== null;
  }

  /**
   * Fills in commuting citizens whose paths have not been computed, a few per tick.
   *
   * `warmup` computes paths only for the small fraction that actually take to the road and
   * leaves the rest marked `pending` for this. **Vehicle spawning cannot finish the job**:
   * once the vehicle cap is reached `spawnCommuteVehicles` breaks immediately and writes no
   * further cache entries. Measured on a 2,146-citizen save with the pathfinding worker
   * running normally, it stalled at 643 of 1,750, predicted traffic was 5.4x too low and
   * noise pollution fell across the map. With the fill in place, 30 ticks brought it back to
   * 3,501 against 3,504 before.
   *
   * Both directions are needed: predicted traffic measures a whole day's commuting, one trip
   * each morning and evening. Filling one direction halves the reading.
   *
   * Most citizens are filled **for free**: those living in the same building and working in
   * the same place share a route, and an existing entry in the pool is simply pointed at.
   * Only routes that must genuinely be computed consume the budget.
   */
  private advanceCommuteFill(): void {
    if (!this._roadLookup) return;
    const citizens = this.state.citizens.getCitizens();
    if (citizens.length === 0) return;

    const generation = this.commuteCache.roadGeneration;
    if (this.commuteFillAttemptsGeneration !== generation) {
      this.commuteFillAttempts.clear();
      this.commuteFillAttemptsGeneration = generation;
    }
    const useWorker = this.pathBatcher !== null && this.graphMapping !== null;
    // Two separate budgets. Handing work to the worker is only queueing and costs the main
    // thread nothing, so it can be generous; computing one here costs a dozen milliseconds.
    // With a shared budget, the routes that fall back to the main thread after the worker
    // fails to answer would run 32 computations in a single tick.
    let enqueueBudget = SIMULATION.COMMUTE_FILL_ENQUEUE_PER_TICK;
    let searchBudget = SIMULATION.COMMUTE_FILL_SEARCH_PER_TICK;
    let enqueued = false;

    // Resume where the last pass stopped rather than rescanning the whole list each tick.
    //
    // Once the budget runs out, `continue` skips only the current citizen and the loop still
    // walks the remaining ten thousand or more — two `parsePosKey` calls, two string
    // concatenations and two `getRouteVariants` calls each, all wasted. Measured on a player
    // save, this consumed 46-66% of `update()` for the first 11 seconds after entering the
    // game (BUG-329).
    //
    // The cursor also fixes fairness: scanning from the start every tick means citizens later
    // in the list wait for everyone before them to settle.
    const total = citizens.length;
    const scanLimit = Math.min(total, SIMULATION.COMMUTE_FILL_SCAN_PER_TICK);
    if (this.commuteFillCursor >= total) this.commuteFillCursor = 0;
    this.commuteFillScanned = 0;

    for (let scanned = 0; scanned < scanLimit; scanned++) {
      const c = citizens[this.commuteFillCursor]!;
      // Advance the cursor before examining the citizen, so none of the `continue`s below
      // leaves them stuck in place.
      this.commuteFillCursor = (this.commuteFillCursor + 1) % total;
      this.commuteFillScanned++;

      if (!c.homeId || !c.workplaceId) continue;
      if (!isWorkingAge(c.age)) continue;

      const entry = this.commuteCache.get(c.id);
      if (this.commuteRouteSettled(entry, generation)) continue;

      const home = parsePosKey(c.homeId);
      const work = parsePosKey(c.workplaceId);
      if (!home || !work) continue;

      const morningKey = `${c.homeId}->${c.workplaceId}`;
      const eveningKey = `${c.workplaceId}->${c.homeId}`;
      const stale = entry !== undefined && entry.generation !== generation;
      let morning = stale ? null : (entry?.morningPath ?? null);
      let evening = stale ? null : (entry?.eveningPath ?? null);

      for (const [key, from, to, isMorning] of [
        [morningKey, home, work, true],
        [eveningKey, work, home, false],
      ] as const) {
        if (isMorning ? morning !== null : evening !== null) continue;

        const variants = this.commuteCache.getRouteVariants(key);
        if (variants && variants.length > 0) {
          // Already in the pool: somebody computed this route, and pointing at it is free.
          const path = variants[Math.floor(Math.random() * variants.length)]!;
          if (isMorning) morning = path; else evening = path;
          continue;
        }
        // Already computed for this road generation, and the answer was "no path". Asking
        // again gives the same answer: `findLanePathVariants` is deterministic for a given
        // lane graph.
        if (this.commuteCache.isUnroutable(key)) continue;
        // The worker is an accelerator, not a dependency. After a few queued attempts without
        // a path, compute it here; queueing forever never finishes against a worker that
        // returns nothing.
        const tries = this.commuteFillAttempts.get(key) ?? 0;
        if (useWorker && tries < SIMULATION.COMMUTE_FILL_MAX_ATTEMPTS) {
          if (enqueueBudget <= 0) continue;
          // Requests already with the worker are not work: charging them to the budget would
          // let the same citizens re-queue every tick and fill the quota.
          if (this.pathBatcher!.isPending(key)) continue;
          const starts = this.collectPointIndices(from, 'exit');
          const ends = this.collectPointIndices(to, 'entry');
          if (starts.length === 0 || ends.length === 0) continue;
          enqueueBudget--;
          this.commuteFillAttempts.set(key, tries + 1);
          this.pathBatcher!.enqueue(key, starts, ends, to);
          enqueued = true;
          continue;
        }

        if (searchBudget <= 0) continue;
        searchBudget--;
        this.commuteFillAttempts.set(key, tries + 1);
        const computed = findLanePathVariants(this.laneGraph, this._roadLookup, from, to);
        if (computed.length > 0) {
          this.commuteCache.setRouteVariants(key, computed);
          const path = computed[Math.floor(Math.random() * computed.length)]!;
          if (isMorning) morning = path; else evening = path;
        } else {
          this.commuteCache.markUnroutable(key);
        }
      }

      if (morning === null && evening === null) {
        // Marked failed only once both directions are **known** to have no path, so
        // JobRelocation can take over instead of the same answer being recomputed every pass.
        // Running out of budget does not count: that is "not known yet", not "no path".
        //
        // The condition reads the answers themselves rather than "did I compute one this
        // pass". The latter never lets a worker-returned "no path" close the case, so that
        // citizen is re-examined on every pass.
        if (this.commuteCache.isUnroutable(morningKey) && this.commuteCache.isUnroutable(eveningKey)) {
          this.commuteCache.set(c.id, {
            citizenId: c.id, homeId: c.homeId, workplaceId: c.workplaceId,
            morningPath: null, eveningPath: null,
            status: 'failed', generation,
          });
        }
        continue;
      }

      this.commuteCache.set(c.id, {
        citizenId: c.id,
        homeId: c.homeId,
        workplaceId: c.workplaceId,
        morningPath: morning,
        eveningPath: evening,
        status: 'ready',
        generation,
      });
    }

    if (enqueued) this.pathBatcher!.flush(100);
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
    this.transferGraph = buildTransferGraph(
      this.flatRoutes, SIMULATION.TRANSFER_WALK_RANGE, this.stopReach,
    );
    buildStopRouteCache(
      this.flatRoutes, this.transferGraph,
      SIMULATION.WALK_SPEED, SIMULATION.AVERAGE_WAIT_FACTOR, SIMULATION.MAX_TRIP_LEGS,
    );
    // The accessibility field is rebuilt with the routes: scoring and job-change decisions
    // rely on it to make commute time O(1).
    this.transitAccess = TransitAccessField.build(this.flatRoutes, SIMULATION.WALK_SPEED, this.stopReach);
    this.stopIndex = StopProximityIndex.build(this.flatRoutes, this.stopReach);
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
      // Pedestrians are generated from the pool of "walk to which stop" trips, and the pool
      // stores coordinates. After a stop is demolished those coordinates remain: measured on
      // a 12,500-citizen save, demolishing every metro station and running 12 seconds left
      // all 40 trips intact and 328 pedestrians still walking towards three stations that no
      // longer existed.
      //
      // Tied to the **topology** version only: changing a route's vehicle count does not
      // change which stop anyone walks to, and a rebuild costs a full sweep of the citizens.
      //
      // The old pool is **discarded immediately**, without waiting for the recollection.
      // Collection takes a full sweep of the city (about 24 ticks on that save), and
      // generating from the old pool meanwhile keeps emitting pedestrians from the stations
      // the player just demolished.
      //
      // A **road** change does not discard it: those coordinates are still valid and only the
      // walking route changes, while players edit roads far more often, so discarding would
      // make pedestrians vanish for a sweep after every road drawn.
      this.walkingTripPool = buildTripPool([]);
      this.tripPoolDirty = true;
    }
  }

  /**
   * Recomputes power, water and sewage coverage and demand.
   *
   * `isPowered` / `isSupplied` only read the cache this fills and compute nothing
   * themselves. The six-tick cadence is normally enough, but a cell built just now did not
   * exist at the last recompute, so the panel truthfully reports missing power and water
   * until the next pass — and forever while paused (BUG-284). Placement and demolition paths
   * therefore call this themselves.
   *
   * All three share the same infrastructure positions and are bound together: called
   * separately, a caller would have to remember all three, and the one missed would give no
   * sign.
   */
  recalculateUtilityCoverage(): void {
    this.infraPositions.clear();
    for (const p of this.state.power.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
    for (const p of this.state.water.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
    for (const p of this.state.sewage.getTreatmentPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
    this.state.power.calculateDemand(this.state.grid, this.state.ordinances.getPowerDemandMultiplier());
    this.state.power.calculateCoverage(this.state.grid, this.infraPositions);
    this.state.water.calculateDemand(
      this.state.grid, this.state.ordinances.getWaterDemandMultiplier());
    this.state.water.calculateCoverage(this.state.grid, this.infraPositions);
    this.state.sewage.calculateDemand(this.state.grid);
    this.state.sewage.calculateCoverage(this.state.grid, this.infraPositions);
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
    // `skipUnreachableCheck` says exactly whether roads were removed (see the comment below:
    // new roads only add connectivity). That is also the only case in which a stale distance
    // table **overstates** reachability; adding roads only makes it understate, which is the
    // safe direction.
    //
    // So only the removal case discards the table. Building roads, drawing districts and
    // demolishing buildings can all keep it (see `WorkplaceDistanceCache`).
    if (skipUnreachableCheck) this.wpDistCache?.invalidate();
    else this.wpDistCache?.invalidateTopology();
    if (affectedCells) {
      if (!this.dirtyRoadCells) this.dirtyRoadCells = new Set();
      if (!this.dirtySidewalkCells) this.dirtySidewalkCells = new Set();
      for (const cellKey of affectedCells) {
        this.commuteCache.invalidateCell(cellKey);
        this.dirtyRoadCells.add(cellKey);
        this.dirtySidewalkCells.add(cellKey);
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
    // As above: without the graph, one is built per affected commute.
    const cellGraph = this.getCellGraph() ?? undefined;

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
          this._roadLookup, cellGraph,
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

  /** Build the sidewalk graph now if it is stale. */
  ensureSidewalkGraph(): void {
    if (!this.sidewalkGraphDirty) return;
    this.rebuildSidewalkGraph();
    this.sidewalkGraphDirty = false;
  }

  private rebuildSidewalkGraph(): void {
    const grid = this.state.grid;
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

    // Only the cells that changed are recomputed. `buildFromGrid` discards every node and
    // edge of the graph and regenerates it: measured at 80-130ms on a fully paved 60x60 map,
    // triggered by every single road edit.
    const dirty = this.dirtySidewalkCells;
    if (dirty && dirty.size > 0) {
      const cells = [...dirty];
      this.state.sidewalkGraph.updateCells(gridLookup, cells);
      // Only stops near these cells need their walk range remeasured. The call also aligns
      // the generation; otherwise the safety net discards the whole cache and the precise
      // invalidation is wasted.
      this.stopReach.invalidateNear(cells, WALK_RANGE_BY_TYPE.WIDEST);
      this.state.pedestrianManager.invalidateCells(cells);
    } else {
      const roadCellKeys: string[] = [];
      const buildingCellKeys: string[] = [];
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
      //
      // Only on this branch: the graph instance never changes, so the real effect
      // of the call is clearing the path cache — which is right after a full
      // rebuild and wrong after an incremental one, where invalidateCells has
      // already dropped exactly the routes that died.
      this.state.pedestrianManager.setSidewalkGraph(this.state.sidewalkGraph);
    }
    this.dirtySidewalkCells = null;

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
   *
   * Building transit facilities also goes through here. The sidewalk graph's dirty flag is
   * set only by `markLaneGraphDirty`, which placing a stop deliberately does not call: a
   * facility does not change the road network, and dragging the lane graph and commute cache
   * into a rebuild with it is too expensive. Without this path a stop is locked out — it has
   * no door node in the graph, pedestrians cannot enter it and its catchment measures as
   * nothing until the player happens to edit a road.
   */
  applyBuildingChange(affectedCells: string[]): void {
    if (affectedCells.length === 0) return;
    const grid = this.state.grid;
    this.state.sidewalkGraph.updateCells({
      getCell: (gx: number, gy: number) => {
        const c = grid.getCell(gx, gy);
        if (!c) return null;
        return { roadType: c.roadType, roadFlags: c.roadFlags, railType: c.railType, buildingId: c.buildingId };
      },
    }, affectedCells);
    // A changed building changes nearby stops' walk ranges: the door node is a pedestrian's
    // only way into a stop.
    this.stopReach.invalidateNear(affectedCells, WALK_RANGE_BY_TYPE.WIDEST);
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
    // At the cap no more vehicles spawn, but **the pedestrian trip pool still has to be
    // maintained**. It is collected by the sampling loop below, and a large city sits at the
    // cap permanently, so the pool would never update again and pedestrians would keep
    // walking to stations the player demolished.
    const atCap = commuteVehicles >= vehicleCap;
    if (atCap && !this.tripPoolDirty) return;

    this.rebuildBuildingIndex();

    const grid = this.state.grid;

    // Vehicles are cosmetic — spawn uniformly every tick regardless of time-of-day.
    // Random citizen sampling ensures route distribution matches real commute patterns.
    this.spawnCommuteVehicles(grid, vehicleCap);

    // At the cap only the section above runs: this pass exists to rebuild the trip pool and
    // must not become a side door around the vehicle cap. Highway traffic guards itself (it
    // compares against 90% of the total, already exceeded at the cap); freight does **not**,
    // because freight trucks have their own quota that may still have room when the total is
    // capped.
    //
    // No test covers this branch. Reproducing it needs a city that is simultaneously at the
    // cap and actually shipping goods, and factories in small fixtures are abandoned to
    // pollution and missing service coverage before they ever ship. The commute side is
    // covered; see `if (atCap) continue` in spawnCommuteVehicles.
    if (!atCap) {
      // Spawn external highway traffic
      this.spawnExternalHighwayTraffic(grid, vehicleCap);

      // Spawn freight trucks (industrial↔commercial, factory↔trade, trade↔commercial)
      this.spawnFreightTraffic(grid, vehicleCap);
    }

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

    // A sweep's length is fixed when it starts. A population change mid-sweep does not move
    // its target, otherwise the target drifts with the progress and the sweep never ends.
    if (this.tripPoolDirty && this.tripSamplesTaken === 0) {
      this.tripSweepTarget = eligible.length;
    }

    // The daily transfer-usage rollover and the transfer-graph rebuild used to
    // live here, behind this and two earlier early returns — see
    // rebuildTransferGraphIfDirty(). Both now run from tick().

    // How many citizens this tick intends to ask, and how many it actually asks.
    //
    // The intended number scales with population, while this loop is also estimating how many
    // citizens ride transit today — and an estimate's accuracy depends on the sample size,
    // not on the population it is drawn from (a thousand-person poll has the same margin in a
    // country of 20 million as in one of 300 million). Measured on the same save scaled to
    // 100,000 citizens: 13,149 intended asks per tick at 191ms, against 250ms available per
    // tick at speed 1 (BUG-328).
    //
    // Asking fewer means scaling back up: each sampled rider counts as `sampleScale`
    // citizens. In a small city `sampleScale` is 1 and behaviour is unchanged.
    const attempts = Math.max(SIMULATION.MIN_SPAWN_PER_TICK, Math.ceil(eligible.length / SIMULATION.SPAWN_SPREAD_TICKS));
    const samples = commuteSampleSize(attempts);
    const sampleScale = attempts / samples;
    this.lastCommuteSample = { attempts, samples, scale: sampleScale };
    let spawned = 0;

    for (let i = 0; i < samples; i++) {
      // Asking continues past the vehicle cap in order to rebuild the pedestrian trip pool.
      // With no rebuild pending, stop here.
      const atCap = this.state.traffic.getVehicleCount() >= vehicleCap;
      if (atCap && !this.tripPoolDirty) break;

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
      const multiModalRoutes = findMultiModalRoutes(
        this.flatRoutes, fromPos, toPos, SIMULATION.WALK_SPEED,
        SIMULATION.AVERAGE_WAIT_FACTOR, this.transferGraph, SIMULATION.MAX_TRIP_LEGS,
        this.stopIndex,
      );
      const { mode, multiLeg, boardStop, alightStop } = chooseModeMultiModal(
        fromPos, toPos, availableTransport, multiModalRoutes,
        this.modeChoiceFor(
          citizen.education, this.driveDeterrenceFor(fromPos, toPos),
          this.congestionFor(fromPos, toPos),
        ),
      );

      // The number of citizens asked is the evidence that a rebuild sweep ran. Drivers count
      // too: in a city where everyone drives, zero walking trips is the answer, not a sign
      // that the sweep did not happen.
      if (this.tripPoolDirty) this.tripSamplesTaken++;

      if (mode !== TransportMode.DRIVE) {
        // Collect walking trips for pedestrian spawning (trip pool)
        if (this.tripPoolDirty) {
          if (mode === TransportMode.WALK) {
            this.pendingTrips.push({
              fromX: fromPos.x, fromY: fromPos.y,
              toX: toPos.x, toY: toPos.y,
              tripType: PedestrianTripType.FULL_WALK, count: sampleScale,
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
                count: sampleScale,
              });
            }
          } else {
            // Walk to the stop actually boarded: these are the two stops the time estimate
            // was computed for.
            if (boardStop) {
              this.pendingTrips.push({
                fromX: fromPos.x, fromY: fromPos.y,
                toX: boardStop.x, toY: boardStop.y,
                tripType: PedestrianTripType.FIRST_MILE, count: sampleScale,
              });
            }
            if (alightStop) {
              this.pendingTrips.push({
                fromX: alightStop.x, fromY: alightStop.y,
                toX: toPos.x, toY: toPos.y,
                tripType: PedestrianTripType.LAST_MILE, count: sampleScale,
              });
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
                if (stop) stop.dailyRiders += sampleScale;
              }
            }
          }
          // Track transfer usage per route label
          if (rideLegs.length >= 2) {
            const label = rideLegs.map(l => {
              const icons = TRANSIT_ICONS;
              return icons[l.transitType ?? ''] ?? '?';
            }).join('\u2192');
            this.transferTracker.recordTransfer(label, sampleScale);
            this.transferTracker.recordBuilding(label, citizen.homeId!, citizen.workplaceId!);
          }
        } else if (boardStop) {
          // Credited to the stop actually boarded. Re-picking "the nearest stop in the
          // system" credits riders to a route they did not take once one transport type has
          // several routes (BUG-283).
          boardStop.dailyRiders += sampleScale;
        }
        continue;
      }

      // This pass is only asking to rebuild the trip pool and has no room for a vehicle.
      // Drivers stop here: everything below is pathfinding and writing the commute cache,
      // which is preparation for spawning.
      if (atCap) continue;

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
          this.state.traffic.spawnVehicleOnEdges(edgePath, citizen.id);
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
        this.state.traffic.spawnVehicleOnEdges(edgePath, citizen.id);

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
    const results: number[] = [];

    // Same collector the synchronous findLanePath uses, so the worker and the
    // main thread agree on which cells a building opens onto — ground only.
    for (const pt of findBuildingAccessPoints(this.laneGraph, pos.x, pos.y, this._roadLookup, pointType)) {
      const idx = mapping.pointIdToIndex.get(pt.id);
      if (idx !== undefined) results.push(idx);
    }
    return results;
  }


  private getTransitSystemInfos() {
    return getTransitSystems(this.state).map(({ type, system }) => ({
      type,
      speed: system.getSpeed(),
      speedOn: (routeId: number) => system.getSpeedOn(routeId),
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
    return findAvailableTransit(
      this.flatRoutes, this.stopIndex, origin, destination,
      SIMULATION.WALK_SPEED, SIMULATION.AVERAGE_WAIT_FACTOR,
    );
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
          if (edgePath && edgePath.length > 0) this.state.traffic.spawnVehicleOnEdges(edgePath);
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
          if (edgePath && edgePath.length > 0) this.state.traffic.spawnVehicleOnEdges(edgePath);
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
        this.state.traffic.spawnFreightVehicle(edgePath, sourceKey);
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
    this.flowSweep.begin(this.commuteCache);
    this.advanceCongestionFlow(Number.POSITIVE_INFINITY);
  }

  /**
   * Advances this sweep of the flow recomputation, publishing only once it completes.
   *
   * Computing it in one go costs 60ms in a single tick, against 250ms available per tick at
   * speed 1, with rendering competing for the same thread (BUG-327). The result is only
   * published every 60 ticks anyway, so spreading the work does not make it any staler.
   */
  private advanceCongestionFlow(keysPerTick?: number): void {
    const grid = this.state.grid;
    const batch = keysPerTick ?? Math.max(
      1, Math.ceil(this.flowSweep.size / SIMULATION.CONGESTION_FLOW_SPREAD_TICKS),
    );
    const done = this.flowSweep.step(
      this.commuteCache, this.flowCellCache, batch,
      (cellKey) => {
        const { x, y } = parsePosKeyUnsafe(cellKey);
        const cell = grid.getCell(x, y);
        return cell ? getLaneCount(cell.roadType) : 1;
      },
    );
    if (done === null) return;
    const { flowMap, totalRefCount } = done;

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
    // A new flow field invalidates every per-route cache entry, and the city-wide average is
    // recomputed with it.
    this.routeCongestionCache.clear();
    this.cityCongestionLevel = cityCongestion(flowMap, this.countRoadTiles());
    this.refreshBusRouteCongestion(flowMap);
  }

  /**
   * How congested each bus route's corridor is.
   *
   * Buses follow arterials, and arterials are more congested than the city average: measured
   * on a 12,600-citizen save, the city average was 0.211 against **0.380** along one route
   * (1.8x), with the worst cell on the line at 1.0. The city average tells the player their
   * bus is not stuck in traffic while it visibly is.
   *
   * Only buses need this: metro, rail and ferry do not use surface roads
   * (`affectedByCongestion`).
   */
  private refreshBusRouteCongestion(flowMap: ReadonlyMap<string, number>): void {
    const bus = this.state.bus;
    for (const route of bus.getRoutes()) {
      const cells = bus.getRouteCells(route.id);
      if (!cells) continue;
      const along = routeCongestion(cells, (cell) => flowMap.get(cell) ?? 0);
      if (along !== null) bus.setRouteCongestion(route.id, along);
    }
  }

  /**
   * How congested this trip's route is.
   *
   * Reads the per-cell flow field computed from **demand**, not the number of vehicles
   * currently on screen (BUG-326). With no cached value for this route it falls back to the
   * city average, which means "not computed yet", not "clear".
   *
   * Cached per route: thousands of citizens commute along the same one, while the flow field
   * is replaced only every 60 ticks.
   */
  private congestionFor(from: { x: number; y: number }, to: { x: number; y: number }): number {
    const flow = this.state.traffic.getPredictedFlow();
    if (!flow) return this.cityCongestionLevel;
    const key = `${toPosKey(from.x, from.y)}->${toPosKey(to.x, to.y)}`;
    const cached = this.routeCongestionCache.get(key);
    if (cached !== undefined) return cached;

    let result = this.cityCongestionLevel;
    const variants = this.commuteCache.getRouteVariants(key);
    const path = variants && variants.length > 0 ? variants[0]! : null;
    if (path && path.length > 0) {
      this.congestionCellScratch.clear();
      collectEdgeCells(path, this.congestionCellScratch);
      const along = routeCongestion(this.congestionCellScratch, (cell) => flow.get(cell) ?? 0);
      if (along !== null) result = along;
    }
    this.routeCongestionCache.set(key, result);
    return result;
  }

  /**
   * Build the walking trip pool from pending trips (aggregated),
   * then spawn pedestrians by weighted random sampling.
   */
  private spawnPedestriansFromPool(population: number): void {
    // Finalize trip pool if it was being rebuilt this rush period
    if (this.tripPoolDirty && this.tripSamplesTaken >= this.tripSweepTarget) {
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
      this.tripSamplesTaken = 0;
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

}


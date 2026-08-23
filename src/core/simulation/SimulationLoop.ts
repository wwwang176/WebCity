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
 * 一個住址的環境。快樂度與健康都要這幾樣，而它們只跟樓有關 —— 同一棟樓的住戶
 * 查出來完全一樣。見 `SimulationLoop.homeFactsFor`。
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
   * 整個路網的平均負載 0..1。跟著逐格流量圖一起更新（每 60 tick）。
   * 問不到某一趟的路線時用它當退路。
   */
  private cityCongestionLevel = 0;
  /** 逐路線的擁擠程度。流量圖一換就整個清掉。 */
  private readonly routeCongestionCache = new Map<string, number>();
  /** `collectEdgeCells` 的收件容器 —— 每次呼叫重用。 */
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
   * 這一輪重建問過幾位市民的通勤方式。
   *
   * 「收集到零條步行路線」跟「還沒收集」是兩件事，而 `pendingTrips.length` 分不出來。
   * 全城的大眾運輸都被拆光時正確答案就是零條 —— 拿長度當條件的話，池子會永遠停在
   * 拆除前的那一份，行人繼續從已經不存在的車站走出來。
   */
  private tripSamplesTaken = 0;
  /**
   * 這一輪要問過幾位才算數 —— 一輪就是全城的通勤人口。
   *
   * 一個 tick 只問得到一小撮人（12 500 人的存檔:8 808 位通勤者裡問 375 位），而
   * 步行路線在時間上是**成串**出現的:壅塞高峰時一批人翻去搭車，其餘時間一個都
   * 沒有。實測連續 45 338 次詢問收集到 260 條，全部集中在五次爆發裡 —— 隨便挑一個
   * tick 定案，九成的機率收集到零條，路上一個行人都不會有。
   *
   * 起始值是 1 而不是 0:0 的話「一位都還沒問」也算達標，空城會每個 tick 定案一次。
   */
  private tripSweepTarget = 1;
  private tripAggMap = new Map<string, AggregatedTrip>();
  private pendingTrips: AggregatedTrip[] = [];

  // Multi-modal transfer graph (rebuilt when transit network changes)
  private transferGraph: TransferGraph = { byStop: new Map(), stopRouteCache: new Map() };
  private transferGraphDirty = true;
  /**
   * 站牌沿人行道走得到哪些格子。算過的留著 —— 重算的觸發條件對「玩家調整班次」
   * 也成立，而那跟人行道一點關係都沒有。
   */
  private stopReach!: SidewalkStopReach;
  /** 每一格走得到哪些路線。與 transferGraph 同時重建。 */
  private transitAccess!: TransitAccessField;

  /**
   * 這一趟通勤要花多久（tick）—— 住房評分、就業評分與換工作判斷共用同一把尺。
   *
   * 開車時間隨距離與壅塞上升，搭車時間由路網決定，兩者是同一個尺度。所以
   * 「住得遠但住在站旁邊」與「住得近但天天塞車」比得出高下，而玩家蓋的運輸
   * 建設會直接反映在市民的居住與就業選擇上。
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
   * 這位市民怎麼權衡各種走法。
   *
   * 沒有指定市民時用預設的不情願權重 —— 住房評分是拿「一間房子對這一位市民好不好」
   * 在問，那裡確實有市民；而通勤統計是整城的分布，用哪一位的脾氣都不對，用平均。
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
   * 這一趟要多付幾倍的開車不情願（壅塞費）。
   *
   * 起點或終點任一端在收費區內就算 —— 收費是過關卡收的，開進去跟開出來是同一趟。
   * 兩端都在收費區時取比較高的那一個，不是相乘:一趟只會過一次關卡。
   */
  private driveDeterrenceFor(from: { x: number; y: number }, to: { x: number; y: number }): number {
    return this.chargedCordonFor(from, to).deterrence;
  }

  /**
   * 這一趟付幾倍的不情願，以及付給哪一個收費區。
   *
   * 兩端都在收費區時付比較高的那一個 —— 錢也記給那一區。一趟車只過一次關卡，
   * 兩區各記一次的話同一筆過路費會被收兩次。
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
  /** Reusable Set for congestion flow cell collection. */
  /** 「這條路徑經過哪些格子」跨次重算共用 —— 路徑不可變，答案就不會變（BUG-327）。 */
  private readonly flowCellCache = new PathCellCache();
  /** 流量重算攤在好幾個 tick 上 —— 一次算完會掉五六幀（BUG-327）。 */
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
   * 對稱於 `setRoadLookup`。BUG-109 的驗收測試要用同一份 lookup 自己建圖來
   * 比對快取的答案 —— 沒有 getter 的話它只能另外組一份，兩份不一致時測試
   * 會說謊。
   */
  getRoadLookup(): import('../road/UnifiedRoadLookup').UnifiedRoadLookup | null {
    return this._roadLookup;
  }

  /**
   * 路網圖，**每個道路世代重建一次**。
   *
   * 同步查詢每個市民呼叫一次 `roadDistanceToTargets`，而建圖是
   * O(路格數 × 4) —— 每次重建會比它省下的還多。圖只在路網改變時才變，
   * 所以在這裡持有：正向給同步查詢，轉置後序列化給 worker。
   *
   * 世代來自 `commuteCache.roadGeneration`，而 `markLaneGraphDirty` 會 bump
   * 它。**高架道路的建與拆也必須經過那條路**（`Game.ts` 會呼叫），否則圖會
   * 陳舊 —— `ElevationManager` 自己沒有事件機制。見
   * `__tests__/ElevatedRoadInvalidatesGraph.test.ts`。
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
   * 路網圖給外面讀。快取與通勤共用同一份 —— 重建一次是 O(路格數)，
   * agent API 每問一次連通性就重建一次的話會很痛。
   */
  roadCellGraph(): import('../road/RoadCellGraph').RoadCellGraph | null {
    return this.getCellGraph();
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
    // 欄位初始設定跑在建構式主體之前，那時 this.state 還沒指定 —— 所以這兩個
    // 要在這裡建，不能寫成欄位初始值。
    this.stopReach = new SidewalkStopReach(state.sidewalkGraph);
    this.transitAccess = TransitAccessField.build([], SIMULATION.WALK_SPEED, this.stopReach);
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
      // 換房子:每個慢速槽跑一批，10 批輪完 = 每位市民每 60 個 tick 輪到一次。
      // 排在這裡是因為位置索引剛剛建好，入住數直接拿得到（BUG-331）。
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

      // 禁菸令對誰都有效，免費診所只保護醫院蓋得到的人 —— 醫院蓋不到的地方，
      // 人根本沒去看病，補助也就沒發出去。兩個乘數在這裡各自進對應的分支。
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

    // 換工作：每 JOB_RELOCATION_INTERVAL 個 tick 一輪，**整輪在這一個 tick
    // 之內跑完**。曾經切成每 tick 兩次（BUG-109 的止痛藥），治本做完之後整輪
    // 只要 7.7 毫秒，切片器反而讓功能在大城市失效（BUG-333）。
    if (tick >= 4 && (tick - 4) % SIMULATION.JOB_RELOCATION_INTERVAL === 0) {
      this.runJobRelocation();
    }


    // 快樂度分片:每個 tick 算一片，`slices` 個 tick 輪完一圈（BUG-330）。
    // 情境仍然每 6 個 tick 才換一次，所以新鮮度與改動前相同。
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

    // 班距與載重率要是**當下**的數字。它們原本只在上面那個重建裡算一次，而重建只在
    // 玩家動到路網拓樸時發生 —— 搭乘人數之後怎麼漲都回不到這裡，於是路線永遠不會
    // 拒載、等車也永遠不會因為擠而變久（BUG-343）。路線數是個位數，每個 tick 重算
    // 的成本是幾次乘除。
    refreshRouteService(this.flatRoutes);

    // 補完還沒算的通勤路線。放在生成車輛之前，這一 tick 補到的路線立刻可用。
    this.advanceCommuteFill();

    // Traffic - spawn commute vehicles (every tick)
    this.spawnVehicles();

    // Transport systems (every tick) — pass utility checkers for operational status
    // 公車跑在路上，路網愈滿它愈慢。用整個路網的平均負載 —— 逐條路線的版本要等
    // 公車路線也接上逐格流量，記在 TODO。
    this.state.bus.congestionLevel = this.cityCongestionLevel;
    {
      const isPow = (x: number, y: number) => this.state.power.isPowered(x, y);
      const isWat = (x: number, y: number) => this.state.water.isSupplied(x, y);
      tickAllTransportSystems(this.state, isPow, isWat);
    }

    // Congestion flow prediction (first tick + every 60 ticks, offset to slot 2)
    //
    // 第一個 tick 一次算完 —— 讀檔之後運具選擇馬上就要有數字可讀。之後每 60 tick
    // 開一輪，攤在接下來幾十個 tick 上慢慢掃（BUG-327）。
    if (tick === 1) {
      this.computeCongestionFlow();
    } else if (tick >= 2 && (tick - 2) % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.flowSweep.begin(this.commuteCache);
    }
    this.advanceCongestionFlow();

    // 通勤估算輪流做:每個 tick 一片，`commuteSliceCount()` 個 tick 輪完一圈。
    // 每位市民被重算的頻率與改動前相同（12.6 萬人以下都是每 60 個 tick 一次）。
    this.advanceCommuteSlice();

    // 加總（圖層與總覽面板共用）仍然每 60 個 tick 一次，與車流預測錯開一格。
    // 第一個 tick 要全量算 —— 只有 1/60 的人有記錄的話，壅塞費收入會被少算。
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
   * 每位市民最近一次算出來的通勤。**這是快取，不是名冊** —— 加總永遠走還活著的
   * 市民名單，這裡只回答「這個人的值是多少」。死掉、遷出的人留下的條目投不了票。
   *
   * 不進存檔:它完全可以從現有狀態重算。
   */
  private commuteRecords = new Map<number, CommuteRecord>();
  private readonly commuteCycle = new SliceCycle();
  /**
   * 這一輪每一片要處理誰。**一輪開頭分好，之後每個 tick 只走自己那一桶。**
   *
   * 沒有這一層的話，每個 tick 都要掃過全部市民才挑得出自己那一片 —— 一輪就是
   * 「人口 × 片數」次過濾。10 萬人實測:分桶前一輪 551 毫秒，其中估算只佔 115，
   * 其餘全是過濾。分桶之後一輪多一次 O(人口) 的走訪，換掉 60 次。
   *
   * 桶裡放的是**參照**，一輪之內不重建，所以名單會在一輪之內過期:
   *
   * - 中途遷出、死亡的人還留在桶裡，會被多算一次。那筆記錄沒有人讀得到（加總走
   *   的是活人名單），而開輪時會被清掉 —— **保證是「一輪之內」，不是「立刻」**。
   * - 中途搬進來的人這一輪還沒有桶可以待，下一輪才輪得到。
   *
   * 兩邊的落後都是一輪，與改動前「每 60 個 tick 把全城重算一次」完全相同。
   */
  private commuteBuckets: Citizen[][] = [];

  /** 這一趟通勤要花多久、怎麼去、付不付過路費。算不出來時回傳 null。 */
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
    // 付了過路費 = 還在開車，而且這一趟碰得到收費區。錢記給那一區。
    return {
      ...picked,
      chargedDistrictId: picked.mode === TransportMode.DRIVE ? cordon.districtId : null,
    };
  }

  /**
   * 這一個 tick 該算的那一片。
   *
   * 改動前是每 60 個 tick 把**全城**算一次 —— 10 萬人時 128 毫秒全擠在那一個 tick，
   * 而速度 10 的一個 tick 只有 25 毫秒。片數的下限就是 60，所以每位市民被重算的
   * 頻率一格都沒退，變的只是那筆工作攤開了。
   *
   * 這是**輪流**不是抽樣。抽樣被否決的理由有二:`chargedDriversByDistrict` 直接
   * 決定壅塞費收入，抽樣估收入會讓玩家的錢跟著抽到誰而抖;而固定抽 k 個人是
   * **系統性偏差**，抽到的人不具代表性的話那棟樓永遠顯示錯的數字，不會自己修正。
   *
   * ### 落後多久（改動前的兩倍，這是分片的代價）
   *
   * 任何改動 —— 搬家、換工作、開關條例 —— 要走兩段才會出現在統計上:
   *
   * 1. 記錄要等這個人那一片輪到（最多一輪）
   * 2. 加總是另一個節奏（`(tick - 3) % 60`，最多再一輪）
   *
   * 所以最壞約 **120 個 tick（5 個遊戲日）**，改動前是 60 個。這是「分片 + 定期發布」
   * 本身的性質，要回到一輪只能改成邊寫邊維護總和 —— 那是 BUG-331 那一整類的溫床
   * （總和悄悄跟真實脫節，而且不會當場壞掉），不值得為一個玩家看不見的落後去換。
   *
   * 對錢的影響只有一個方向:**開啟**壅塞費之後收入要多花一輪才收滿。**關閉**是立刻
   * 生效的 —— 計費迭代的是分區當下啟用的條例（`calculateDistrictPolicyCost`），
   * 條例不在清單裡就不會計費，統計裡還留著多少付費駕駛都不影響。
   */
  private advanceCommuteSlice(): void {
    // 空城不特別處理:片數的下限是 60，迴圈掃過零個人，然後 prune 會把上一座
    // 城市留下的記錄清乾淨。提早 return 反而會讓那些記錄一直留著。
    const citizens = this.state.citizens.getCitizens();

    const { slices, index } = this.commuteCycle.next(() => commuteSliceCount(citizens.length));
    // 開輪:重新分桶，順便把離開的人的記錄清掉。`index === 0` 就是一輪的開頭。
    //
    // 清理排在這裡而不是每個 tick，理由有二:桶剛重建，接下來一整輪都不會再把
    // 離開的人加回去;而活人名單本來就要為了分桶走一遍，清理是順便，不多花錢。
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
   * 全城一次算完。載入與第一個 tick 用 —— 那兩個時機不能只有 1/60 的人有記錄:
   * `chargedDriversByDistrict` 是壅塞費的計費基礎，少算就是少收錢。
   */
  private rebuildAllCommuteRecords(): void {
    this.commuteRecords.clear();
    for (const c of this.state.citizens.getCitizens()) {
      const rec = this.commuteRecordFor(c);
      if (rec) this.commuteRecords.set(c.id, rec);
    }
  }

  /**
   * 把存下來的值加總成圖層與面板要的數字。
   *
   * 不進存檔 —— 它完全可以從現有狀態重算，存起來只會讓存檔格式多一塊要遷移的東西。
   * 代價是讀檔後第一次慢速 tick 之前面板是空的。
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
   * 統計換過幾次。渲染端拿它判斷該不該重建通勤圖層。
   *
   * 圖層是**快照**：`setOverlay` 只在切換圖層或某個子系統重建時跑。沒有這個版本號
   * 的話，載入後開圖層拿到的是空快照，而蓋了捷運之後顏色也不會跟著變 —— 要等到
   * 城裡剛好有別的東西變動才會刷新。
   */
  getCommuteStatsVersion(): number {
    return this.commuteStatsVersion;
  }

  /** 全城通勤統計。圖層與總覽面板讀的是同一份。 */
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
   * 重算全城情境，給接下來每個 tick 的分片共用。
   *
   * 呼叫節奏與改動前的 `updateCitizenHappiness` 相同（慢速槽 4，每 6 個 tick）——
   * 所以每位市民看到的情境新鮮度沒有變。
   */
  private refreshHappinessContext(): void {
    const taxRate = this.state.taxRates.residential ?? DEFAULT_TAX_RATE;
    const pop = this.state.citizens.getPopulation();
    // 空城不必建情境。作廢舊情境的是 `updateCitizenHappinessSlice` —— 它每個 tick
    // 都跑，人一走光就會把 `happinessContext` 設回 null，這裡再設一次沒有任何
    // 情況守得到。
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

  /** 重複使用的待處理佇列計數。每個 tick 清空重建，不留跨 tick 的殘值。 */
  private readonly pendingDeathCounts = new Map<string, number>();
  private readonly pendingGarbageCounts = new Map<string, number>();

  /**
   * 這個住址的環境。同一個 tick 之內只算一次。
   *
   * 回傳 null 表示這個鍵解不出座標（不該發生，但 `parsePosKey` 允許失敗）。
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
   * 把屍體與垃圾的待處理佇列數成「每一格幾筆」。
   *
   * 每個 tick 都重建 —— 佇列長度是「還沒收走的幾筆」，與人口無關。放進慢速槽的
   * 快照裡的話，一輪之內只有頭幾片看得到當時的事件。
   */
  private refreshPendingCounts(): void {
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
   * 這個 tick 輪到的那一片市民，重算他們的快樂度。
   *
   * 每位市民身上都存著自己的快樂度，沒輪到的人沿用上次的值 —— 全城平均照樣是
   * 「所有人身上的值加總 ÷ 人數」，不受哪一片剛被重算影響。這是**輪流**不是抽樣:
   * 沒有人被跳過，`slices` 個 tick 之內每個人一定輪到一次。
   *
   * 70 891 人實測，改動前這一整包是 68.5ms 落在單一個 tick 上（BUG-330）。
   */
  private updateCitizenHappinessSlice(): void {
    const citizens = this.state.citizens.getCitizens();
    if (citizens.length === 0) {
      // 空城:情境跟著作廢，重新遷入的人才不會拿到上一座城市的稅率與服務。
      this.happinessContext = null;
      this.happinessCycle.reset();
      this.lastHappinessSlice = { slices: 0, index: -1, updated: 0 };
      return;
    }
    // 情境是慢速槽 4 建立的，而分片每個 tick 都跑 —— 開局或讀檔後的頭幾個 tick 還沒有
    // 情境可用。不補這一手的話那幾片會被白白跳過，第一輪只蓋得到一部分市民。
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

    for (const citizen of citizens) {
      if (citizenSliceOf(citizen.id, slices) !== mySlice) continue;
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
   * 「哪一棟樓住了幾個人、哪一棟樓有幾個人上班」。慢速槽 4 建一次，醫院、學校、
   * 警消共用。
   *
   * 這三個服務算的是每一格的需求，而同一棟樓的住戶算出來完全一樣 —— 原本各自逐
   * 市民掃一遍，每位付兩次 `parsePosKey`、兩次 `getCoverage`、一次 `getCell`。
   * 12 萬人實測 `updatePoliceFireLoads` 102ms、`updateHospitalLoads` 33ms、
   * `updateSchoolLoads` 21ms。
   */
  private citizenLocations: CitizenLocationIndex = buildCitizenLocationIndex([]);
  private citizenLocationsTick = -1;

  /**
   * 確保這個 tick 的位置索引是新的。
   *
   * **誰用誰負責**，不是在慢速槽 4 建好給大家用:每日的死亡結算也會呼叫
   * `updateHospitalLoads`，而那是在槽 5（移民、配房、換房子）之後 —— 拿槽 4 的
   * 索引會漏掉剛遷入的人、算進剛遷出的人。讀檔更糟:在槽 4 之後、日界之前建立
   * 的 SimulationLoop 索引還是空的，醫院需求會被算成 0，死亡率拿到錯的低倍率。
   *
   * 同一個 tick 之內重複呼叫是免費的，所以槽 4 那三個服務仍然只建一次。
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
    // 先數成「哪一棟樓、哪一種學制、幾個人」。分隔用 `|` 不是逗號 —— 高架格子的
    // 鍵是三段的（`27,55,1`），用逗號切會把它切錯。
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
   * 這個 tick 輪到的那一片市民，重算他們的健康。
   *
   * 與快樂度同一套分片（`SliceCycle` + `citizenSliceOf`），所以同一位市民的兩件事
   * 落在同一個 tick —— 他的住址只查一次。健康值存在每個人身上，沒輪到的人沿用
   * 上次的值。12 萬人實測改動前這一發 28ms。
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
    const f = this.healthFactors;
    let updated = 0;

    for (const c of citizens) {
      if (citizenSliceOf(c.id, slices) !== mySlice) continue;
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
   * 全城的有效犯罪率 —— 基礎值加上全城條例。
   *
   * 幸福度、移民吸引力、棄置壓力看的都是這個數字。少了條例那一項的話，面板上
   * 寫著 Crime −13，居民卻一點感覺也沒有。
   *
   * 公開的:`SummaryStats` 從 `GameState` 算同一個數字（走 `effectiveCityCrime`），
   * 而「兩邊算出來一樣」這件事需要有人能問得到這一邊。
   *
   * 夾在 0 以上:負的犯罪率在下游會變成加分（地價那條線最明顯，`calculateLandValue`
   * 是 `value -= crimeRate * CRIME_PENALTY`），疊越多層賺越多。
   */
  getCityCrime(): number {
    return Math.max(0, this.getRawCityCrime());
  }

  /**
   * 全城犯罪率，還沒夾值。
   *
   * 逐格的消費端要用這個 —— 夾值只能做一次，而且要在全城與分區都加完之後。先夾
   * 全城那一半的話，基礎 1 加上監視器網路的 −100 會先變成 0，賭場的 +120 再加
   * 上去就是 120;全部加完再夾是 21。同一格在地價那條線看到 21、在棄置那條線
   * 看到 120，兩套系統對同一件事有兩個答案。
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

    // 壅塞費的過路費。目前唯一一條會賺錢的條例 —— 加在專精加成**之後**，因為
    // 那個加成是對產業稅收的，不是對規費的。
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
        // 條例可以往兩個方向動這一格:加地價（有機食品）也加犯罪（觀光）。
        // 分區只查一次 —— 這是逐格跑的。
        //
        // 分區與全城的效果相加 —— 兩個範圍是獨立的決策，不是二選一。
        //
        // 犯罪率夾在 0 以上:`calculateLandValue` 是 `value -= crimeRate *
        // CRIME_PENALTY`，負的犯罪率會直接變成地價加成。宵禁疊上監視器網路就能
        // 把犯罪壓成負數，那時候「治安好」會變成「憑空多出地價」，而且疊越多層
        // 賺越多。
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
   * 本期計費要用的全城規模。
   *
   * 補貼型條例按實際受益人頭收費，所以帳單要知道人口結構與醫院覆蓋，不只是人口
   * 總數。
   */
  cityScales(): CityScales {
    return computeCityScales(
      this.state.citizens.getCitizens(),
      (x, y) => this.state.health.getCoverage(x, y),
    );
  }

  /** 分區的計費資料:道路格數與付費人數。帳本、面板與結帳共用同一份。 */
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
    // 這裡以前有一道閘門：只要有任何一格高架道路就完全不用快取（BUG-109）。
    // 那是因為 worker 拿到的是平面格子緩衝，看不到高架，答案會錯。現在它拿
    // 到的是 RoadCellGraph —— 樓層與匝道在建圖時就消化掉了，兩條路共用同一
    // 個 flood 核心，閘門沒有存在的理由了。
    if (this.wpDistCache && this.wpDistCache.isStale && workplaceCandidates.length > 0) {
      const wpPositions = workplaceCandidates.map(c => {
        const p = parsePosKeyUnsafe(c.pos);
        return { pos: c.pos, x: p.x, y: p.y };
      });
      // Copy grid buffer for worker (ArrayBuffer → new copy for transfer)
      const srcBuf = this.state.grid.getBuffer();
      const copy = new ArrayBuffer(srcBuf.byteLength);
      new Uint8Array(copy).set(new Uint8Array(srcBuf));
      // 圖是 worker 的走訪規則來源 —— 樓層與匝道在建圖時就消化掉了。
      // 傳的是**轉置**圖：成本加在目的地那一格，用正向圖跑反向 flood 會付成
      // 來源那格的價格（BUG-237）。
      const graph = this.getCellGraph();
      if (graph) {
        const graphBuffer = serializeRoadCellGraph(transposeRoadCellGraph(graph));
        this.wpDistCache.requestUpdate(
          this.state.grid.width, this.state.grid.height,
          copy, graphBuffer, wpPositions, DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget,
        );
      }
      // 沒有 lookup 就建不出圖，這一輪不請求更新，照常走同步指派。
    }

    // Build reachability map: use cache if ready, otherwise sync Dijkstra fallback
    // `hasTable` 而不是 `isReady` —— 一份差一輪的表遠好過同步 Dijkstra。
    // 4 萬人存檔實測:走快取 161ms，掉回同步 2,684ms，而快取「當前」的窗只有
    // 6~8 秒、重新配置每 13 秒跑一次，落在哪裡純粹是運氣。
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
   * 上一次跑的是哪一個 tick、第幾批、配額多少、評估了幾位、搬了幾位。
   *
   * `tick` 讓讀的人分得出「這是這個 tick 剛跑的」還是「上一次留下來的」—— 它每
   * 6 個 tick 才跑一次，不看 tick 的話會把同一次結果數六遍。
   */
  lastHousingRelocation =
    { tick: -1, slice: -1, quota: 0, considered: 0, relocated: 0, cityUnhappy: 0 };

  /**
   * Run relocation tick: unhappy citizens may move to better housing.
   *
   * 每個慢速槽跑**一批**，`HOUSING_RELOCATION_SLICES` 批輪完一圈 —— 每位市民每
   * 60 個 tick 輪到一次，與改動前完全相同。
   *
   * 整件事在**同一個 tick 內**做完:候選住宅、入住數、市民名單當場拍、當場用完、
   * 當場丟掉。把一次的名單攤到幾十個 tick 上跑過，那會讓這三份快照全部過期
   * （BUG-331）。
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
    // 用 id 的雜湊分批，不是用名單位置:同時建成的市民往往住同一區，照位置切的話
    // 每一批是一個街區，出事時反應會一區一區掃過去（同 CitizenSlicing）。
    const inSlice = (c: Citizen) => citizenSliceOf(c.id, slices) === mySlice;

    // 一趟掃完:這一批有幾位、以及**全城**有幾位不開心。
    const cfg = DEFAULT_RELOCATION_CONFIG;
    let considered = 0;
    let cityUnhappy = 0;
    for (const c of citizens) {
      if (inSlice(c)) considered++;
      if (c.homeId !== null && c.happiness < cfg.happinessThreshold) cityUnhappy++;
    }

    // 配額照**全城**算，再用階梯法分給十批 —— 加起來剛好等於一次跑完的 5%。
    // 讓每批各自取 5% 的話，`Math.max(1, Math.floor(...))` 會讓小批全部進位到 1，
    // 一圈可以搬掉好幾倍的人。
    const cycleQuota = Math.max(1, Math.floor(cityUnhappy * cfg.maxRelocateRatio));
    const quota = Math.floor((mySlice + 1) * cycleQuota / slices)
      - Math.floor(mySlice * cycleQuota / slices);

    // 入住數要數**全部人**，不是這一批 —— 房子有沒有空位跟誰輪到無關。
    const homeOccupancy = countOccupancy(citizens, (c) => c.homeId);
    const { relocatedIds } = relocationTick(
      citizens, housingCandidates, homeOccupancy, undefined, inSlice, quota);
    // 搬家的市民要清掉通勤快取，路線才會重算。
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

    // 圖一定要傳。不傳的話 `roadDistanceToTargets` 會**每個家各建一張**，而建圖是
    // O(路格數 × 4) —— 這個迴圈跑的是全城不重複的住址。
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
    // 高架閘門已移除（BUG-109 治本）—— 快取現在也是樓層感知的，兩條路共用
    // 同一個 flood 核心，不可能給出不同的答案。
    //
    // fallback 一定要傳圖：這個 closure **每個市民呼叫一次**，而建圖是
    // O(路格數 × 4)。圖以道路世代為鍵快取，整輪只建一次。
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
      // 通勤要花多久 —— 開車、走路與大眾運輸都換算成同一個尺度的時間。
      (c: Citizen) => {
        if (!c.homeId || !c.workplaceId) return NaN;
        return this.commuteTimeBetween(c.homeId, c.workplaceId) ?? NaN;
      },
    );
    // 換了工作的市民要清掉通勤快取，路線才會重算。
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
   * **只算現在真的要用的那幾條。** 這裡原本替每一位有工作的市民都算了雙向路徑，
   * 而只有 `spawnRatio` 那一小部分會生成車輛 —— 2 146 人的存檔實測，1 805 位 ×
   * 2 個方向 = 3 610 次 A*、每次約 8 ms，載入畫面卡 20 秒，其中八成是替現在
   * 不上路的人算的。
   *
   * 沒算到的那些人不會出事：`spawnCommuteVehicles` 找不到路線時本來就會丟給
   * pathfinding worker，下一 tick 再用 —— 那條路是非同步的，而且在別的執行緒上。
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
      // 放在迴圈**開頭**：底下的 `continue` 已經是多數情形（只有 spawnRatio
      // 那一小部分會往下走），擺在結尾的話進度條大部分時間不會動。
      if (i % 100 === 0 && onProgress) {
        onProgress(i / citizens.length);
        await new Promise(r => requestAnimationFrame(r));
      }

      const c = citizens[i]!;
      if (!c.homeId || !c.workplaceId) continue;

      // 先決定這一位現在上不上路，再決定要不要算路徑。反過來的話，八成的
      // 搜尋是替不上路的人做的。
      if (Math.random() >= spawnRatio) {
        this.markCommutePending(c);
        continue;
      }

      const home = parsePosKey(c.homeId);
      const work = parsePosKey(c.workplaceId);
      if (!home || !work) { this.markCommutePending(c); continue; }

      // 一台車只往一個方向開，所以只需要那一個方向的路徑。
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

      // 只填走到的那個方向。另一個方向留 null —— 平常那條路
      // （`spawnCommuteVehicles`）寫進來的也是這個形狀。
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

    // 統計在這裡先算一次。它不進存檔，所以載入完成的瞬間本來就是空的 —— 差別在
    // 玩家什麼時候看得到：這裡還在載入畫面底下，而第一個 tick 已經是進了遊戲之後，
    // 一進去就開通勤圖層會看到一張空白的地圖。
    //
    // 先建可及性圖，否則這一次算出來的通勤完全不含大眾運輸，第一個 tick 才會被
    // 修正 —— 玩家會看到顏色在進遊戲後跳一次。
    //
    // 人行道圖又要更早：站牌的涵蓋範圍是沿著人行道量出來的，圖還是空的時候每個
    // 站牌都服務不到任何人。載入時只有 ensureLaneGraph 被呼叫過，人行道圖要等到
    // 第一個 tick 才建。
    this.ensureSidewalkGraph();
    this.rebuildTransferGraphIfDirty();
    this.rebuildAllCommuteRecords();
    this.refreshCommuteStats();

    onProgress?.(1);
    return { pathsComputed, vehiclesSpawned };
  }

  /**
   * 記下「這個人要通勤，但路徑還沒算」。
   *
   * 不留記號的話，下游分不出「還沒算」和「算過了，沒有通勤」。`JobRelocation`
   * 查不到條目就改用曼哈頓直線距離猜通勤有多遠，於是載入之後的第一輪換工作是
   * 拿猜的數字決定誰要換工作 —— 舊版 warmup 替所有人算好路徑時不會發生。
   *
   * 有條目的人不動：這裡只補空白，不覆蓋算過的結果。
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
   * 背景補完已經替每條路線丟給 worker 幾次。
   *
   * 這是「worker 交不出答案就自己算」的計數器。worker 可以活著、可以回應，而每一組
   * 起迄都回傳空的；生產環境沒有 COOP/COEP 就連 SharedArrayBuffer 都沒有，而
   * `Game.ts` 建不起 worker 時是靜靜吞掉的。沒有這個上限，補完會永遠停在排隊。
   *
   * 路網一改就整個清掉：新蓋的那條路可能正好把它們接起來。
   */
  private commuteFillAttempts = new Map<string, number>();
  private commuteFillAttemptsGeneration = -1;
  /** 上次補到名單的哪一位。見 advanceCommuteFill（BUG-329）。 */
  /** 上一個 tick 想問幾位、實際問幾位、放大倍率。測試與面板靠它（BUG-328）。 */
  lastCommuteSample: { attempts: number; samples: number; scale: number } =
    { attempts: 0, samples: 0, scale: 1 };
  /**
   * 全城情境。每 SLOW_TICK_INTERVAL 個 tick 重算一次（跟改動前同一個節奏），分片
   * 共用 —— 那一段有一個 O(人口) 的成年人計數，每個 tick 重跑會把分片省下的
   * 吃掉（BUG-330）。
   *
   * 屍體與垃圾的待處理佇列**不在**這裡:它們是短命事件，而快照要活滿一整輪。
   * 大城市一輪 72 個 tick，只有 6 個 tick 的片看得到那份快照，其餘 66 片永遠不
   * 知道門口有屍體。佇列只有「還沒收走的幾筆」那麼長，每個 tick 重建不花錢。
   */
  private happinessContext: {
    ctx: ReturnType<typeof calculateCityHappinessContext>;
    hasParkCoverage: boolean;
    taxRate: number;
    enableShopping: boolean;
  } | null = null;
  /** 快樂度這一輪的游標。片數在開輪時定死，理由見 `SliceCycle`。 */
  private readonly happinessCycle = new SliceCycle();
  /** 健康這一輪的游標。與快樂度共用同一個雜湊，所以同一位市民同一個 tick 更新。 */
  private readonly healthCycle = new SliceCycle();
  /** 上一個 tick 分成幾片、輪到第幾片。測試與量測靠它。 */
  lastHappinessSlice = { slices: 0, index: -1, updated: 0 };
  /** 健康的同一組數字。 */
  lastHealthSlice = { slices: 0, index: -1, updated: 0 };

  /**
   * 這一個 tick 已經查過的住址。快樂度與健康共用。
   *
   * 兩邊都要「這個住址通不通電、有沒有水、污染多少、醫療費率、公園覆蓋」——
   * 而那些只跟樓有關。12 434 人住在 103 棟樓裡，逐市民查等於同一棟樓查 120 次。
   * 實測那一整段逐市民做要 18.4ms（61 436 人），照住址記憶化之後 6.0ms。
   *
   * **每個 tick 清空**，不是每 6 個 tick。斷電、缺水、污染都是玩家看得見而且會突然
   * 改變的東西，快取跨 tick 就會慢半拍。而重建只花「這一片碰到幾個住址」那麼多。
   */
  private readonly homeFacts = new Map<string, HomeFacts | null>();
  private homeFactsTick = -1;
  private commuteFillCursor = 0;
  /** 這一個 tick 看過幾位市民。省下來的時間就是這個數字，測試靠它。 */
  private commuteFillScanned = 0;

  /** 目前這一格的通勤路線在快取裡是不是已經齊了（兩個方向、且是這一代路網）。 */
  private commuteRouteSettled(entry: CachedRoute | undefined, generation: number): boolean {
    if (!entry || entry.generation !== generation) return false;
    // 算過而且確定走不通的，不要每個 tick 重算一次。
    if (entry.status === 'failed') return true;
    return entry.morningPath !== null && entry.eveningPath !== null;
  }

  /**
   * 逐 tick 把還沒算路徑的通勤市民補完。
   *
   * `warmup` 只替真的要上路的那一小部分人算路徑，其餘的人留下 `pending` 記號
   * 交給這裡。**靠生成車輛是補不完的**：車輛一到上限 `spawnCommuteVehicles`
   * 立刻 break，不再寫任何快取條目 —— 2 146 人的存檔實測（pathfinding worker
   * 正常運作）跑到 643／1 750 就停住不動，而預測車流少算了 5.4 倍，噪音汙染
   * 跟著整片掉下來。補完接手之後 30 個 tick 回到 3 501，對上改前的 3 504。
   *
   * 兩個方向都要：預測車流算的是一整天的通勤量，早上一趟晚上一趟。只補一個
   * 方向的話讀數會少一半。
   *
   * 大部分市民是**免費**補完的 —— 住同一棟、在同一處上班的人共用一條路線，
   * 池子裡已經有就直接指過去。真的要算的那些才吃預算。
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
    // 兩份預算分開記。丟給 worker 只是排隊，主執行緒沒有在算，所以放得多；
    // 自己算一次就是十幾毫秒，兩者共用一份預算的話，worker 交不出答案而退回
    // 主執行緒的那些會一口氣在同一個 tick 裡算 32 次。
    let enqueueBudget = SIMULATION.COMMUTE_FILL_ENQUEUE_PER_TICK;
    let searchBudget = SIMULATION.COMMUTE_FILL_SEARCH_PER_TICK;
    let enqueued = false;

    // 從上次停下的地方接著看，而不是每個 tick 重掃整份名單。
    //
    // 預算用完之後的 `continue` 只跳過這一個人，迴圈照樣走完剩下的一萬多位 ——
    // 每人兩次 parsePosKey、兩次字串串接、兩次 getRouteVariants，全部白做。玩家
    // 存檔實測，進遊戲後前 11 秒這裡吃掉 update() 的 46–66%（BUG-329）。
    //
    // 游標還順便解決一件事:原本每個 tick 都從開頭掃，排在名單後面的市民要等前面
    // 的人全部 settled 才輪得到。
    const total = citizens.length;
    const scanLimit = Math.min(total, SIMULATION.COMMUTE_FILL_SCAN_PER_TICK);
    if (this.commuteFillCursor >= total) this.commuteFillCursor = 0;
    this.commuteFillScanned = 0;

    for (let scanned = 0; scanned < scanLimit; scanned++) {
      const c = citizens[this.commuteFillCursor]!;
      // 游標先走，再看這個人 —— 底下每一條 `continue` 才不會把他黏在原地。
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
      let searched = false;

      for (const [key, from, to, isMorning] of [
        [morningKey, home, work, true],
        [eveningKey, work, home, false],
      ] as const) {
        if (isMorning ? morning !== null : evening !== null) continue;

        const variants = this.commuteCache.getRouteVariants(key);
        if (variants && variants.length > 0) {
          // 池子裡已經有了 —— 別人算過同一條路，指過去不用錢。
          const path = variants[Math.floor(Math.random() * variants.length)]!;
          if (isMorning) morning = path; else evening = path;
          continue;
        }
        // worker 是加速，不是依賴。排過幾次還是拿不到路徑就自己算 —— 一直排下去
        // 的話，遇到交白卷的 worker 補完永遠不會結束。
        const tries = this.commuteFillAttempts.get(key) ?? 0;
        if (useWorker && tries < SIMULATION.COMMUTE_FILL_MAX_ATTEMPTS) {
          if (enqueueBudget <= 0) continue;
          // 已經在 worker 手上的不算工作 —— 扣它的預算等於讓同一批人每個
          // tick 重新排一次隊，把名額佔滿。
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
        searched = true;
        this.commuteFillAttempts.set(key, tries + 1);
        const computed = findLanePathVariants(this.laneGraph, this._roadLookup, from, to);
        if (computed.length > 0) {
          this.commuteCache.setRouteVariants(key, computed);
          const path = computed[Math.floor(Math.random() * computed.length)]!;
          if (isMorning) morning = path; else evening = path;
        }
      }

      if (morning === null && evening === null) {
        // 真的算過而且兩個方向都走不通，才標 failed —— 讓 JobRelocation 去處理，
        // 而不是每個 tick 重算一次同一條算不出來的路。預算用完而沒算的不算數。
        // worker 那條路不標：答案還在別的執行緒上。
        if (searched) {
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
    // 可及性圖跟著路線一起重建 —— 評分與換工作判斷靠它把通勤時間壓成 O(1)。
    this.transitAccess = TransitAccessField.build(this.flatRoutes, SIMULATION.WALK_SPEED, this.stopReach);
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
      // 行人是照「走去哪一站」的路線池生出來的，池子存的是座標。站牌拆掉之後那些
      // 座標還在池子裡 —— 玩家 12 500 人的存檔實測，把捷運全部拆掉再跑 12 秒，
      // 40 條路線一條沒少，328 位行人繼續走向已經不存在的三個車站。
      //
      // 只掛在**拓樸**版本上:班次加減不會動到走去哪一站，而重建要重問一輪市民。
      //
      // 舊的池子**當場丟掉**，不等重新收集完。收集要問過全城一輪（12 500 人的存檔
      // 約 24 個 tick），這段期間繼續照舊池子生人的話，玩家拆掉的車站還會再吐幾秒
      // 的行人 —— 那正是這個 bug 被回報的樣子。
      //
      // 改**道路**不丟:那些座標還是有效的，變的只是走法，而玩家畫路的頻率高得多，
      // 丟掉會讓行人每畫一次路就消失一輪。
      this.walkingTripPool = buildTripPool([]);
      this.tripPoolDirty = true;
    }
  }

  /**
   * 重算電、水、汙水的涵蓋範圍與需求。
   *
   * `isPowered` / `isSupplied` 只是查這裡填好的快取，自己不算任何東西。平常六個
   * tick 輪到一次就夠了，但剛蓋好的那一格在上一次重算時還不存在 —— 面板會照實
   * 回報缺水缺電，要等下一輪才消失，暫停時則永遠不會消失（BUG-284）。所以放置與
   * 拆除的路徑要自己叫一次。
   *
   * 三者共用同一份基礎設施座標，所以綁在一起 —— 分開叫的話呼叫端得記得三個都要
   * 叫，而漏掉的那一個不會有任何徵兆。
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
    // 路網變了 —— 距離表現在是錯的，不能像建築變動那樣續用（見
    // `WorkplaceDistanceCache` 的說明）。
    this.wpDistCache?.invalidateTopology();
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
    // 同上:不傳圖的話每個受影響的通勤各建一張。
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

    // 只重算動過的那幾格 —— 這裡原本一律走 buildFromGrid，而它會丟掉全圖的節點
    // 與邊再從頭生成一次：60×60 全鋪滿實測 80~130 ms，且觸發條件是每一次道路
    // 編輯。SidewalkGraph.updateCells 早就寫好也有測試，只是從來沒有人呼叫它。
    const dirty = this.dirtySidewalkCells;
    if (dirty && dirty.size > 0) {
      const cells = [...dirty];
      this.state.sidewalkGraph.updateCells(gridLookup, cells);
      // 只有這些格子附近的站牌需要重新量步行範圍。呼叫它同時把世代對齊，
      // 否則安全網會把整份快取一起丟掉，精準失效就白做了。
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
   * 蓋交通設施也走這裡。人行道圖的重建旗標只由 `markLaneGraphDirty` 設定，而蓋
   * 站牌刻意不呼叫它 —— 設施不改變路網，拖著 lane graph 與通勤快取一起重算太貴。
   * 於是站牌被關在門外：它在圖裡沒有門節點，行人走不進去，涵蓋範圍也量不出來，
   * 要等玩家隨手動一次道路才補得上。名字從 Removal 改成 Change，是因為它一直
   * 都是「照 grid 重算這幾格」，蓋跟拆走的是同一條路。
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
    // 建築動了，附近站牌的步行範圍也就變了 —— 門節點是行人走進站牌的唯一入口。
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
    // 車位滿了就不再生車 —— 但**行人的路線池還是要維護**。它是搭著底下那個取樣
    // 迴圈收集的，而大城市會永遠停在上限，於是路線池永遠不再更新:玩家拆掉的車站
    // 會一直有行人走過去。換乘圖以前也是掛在這條路徑上，已經搬出去了。
    const atCap = commuteVehicles >= vehicleCap;
    if (atCap && !this.tripPoolDirty) return;

    this.rebuildBuildingIndex();

    const grid = this.state.grid;

    // Vehicles are cosmetic — spawn uniformly every tick regardless of time-of-day.
    // Random citizen sampling ensures route distribution matches real commute patterns.
    this.spawnCommuteVehicles(grid, vehicleCap);

    // 滿載時只走上面那一段 —— 這一輪是為了重建路線池才跑的，不能順手變成一道
    // 繞過車輛上限的側門。高速公路車流自己會擋（它比對的是總量的九成，滿載時
    // 早就超過了），貨運**不會**:貨運車有自己的一份配額，總量滿載時那份配額還
    // 可能沒填滿。
    //
    // 沒有測試守得住這一段。要照出來得有一座「同時滿載、而且真的在出貨」的城市 ——
    // 小 fixture 裡的工廠撐不到出貨就先被廢棄（汙染、沒有服務涵蓋）。
    // 通勤車那一側守得住，見 spawnCommuteVehicles 裡的 `if (atCap) continue`。
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

    // 一輪的長度在開輪時定下來。中途人口變動不改這一輪的目標 —— 目標會跟著
    // 進度一起漂走，那一輪就永遠不會結束。
    if (this.tripPoolDirty && this.tripSamplesTaken === 0) {
      this.tripSweepTarget = eligible.length;
    }

    // The daily transfer-usage rollover and the transfer-graph rebuild used to
    // live here, behind this and two earlier early returns — see
    // rebuildTransferGraphIfDirty(). Both now run from tick().

    // 想問幾位，以及實際問幾位。
    //
    // 想問的量跟人口成正比，而這個迴圈同時在估「今天多少人搭捷運」—— 估計的準確度
    // 只跟問了幾個人有關，跟城市多大無關（民調問一千人的誤差，兩千萬人的國家和三億
    // 人的國家一樣）。同一份存檔複製成 10 萬人實測:每 tick 想問 13 149 位、191ms，
    // 而速度 1 的一個 tick 只有 250ms（BUG-328）。
    //
    // 問得少就要放大回去:每問到一位搭車的，記成 `sampleScale` 位。小城市
    // `sampleScale` 就是 1，行為一個字都沒改。
    const attempts = Math.max(SIMULATION.MIN_SPAWN_PER_TICK, Math.ceil(eligible.length / SIMULATION.SPAWN_SPREAD_TICKS));
    const samples = commuteSampleSize(attempts);
    const sampleScale = attempts / samples;
    this.lastCommuteSample = { attempts, samples, scale: sampleScale };
    let spawned = 0;

    for (let i = 0; i < samples; i++) {
      // 沒車位的時候還繼續問，是為了重建行人的路線池。不用重建就直接收工。
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
        this.stopReach,
      );
      const { mode, multiLeg, boardStop, alightStop } = chooseModeMultiModal(
        fromPos, toPos, availableTransport, multiModalRoutes,
        this.modeChoiceFor(
          citizen.education, this.driveDeterrenceFor(fromPos, toPos),
          this.congestionFor(fromPos, toPos),
        ),
      );

      // 問過的人數才是「這一輪重建跑過了」的證據。開車的也算 —— 全城都開車時
      // 收集到的步行路線就是零條，那是答案，不是「沒跑到」。
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
            // 走去他真正要上車的那一站 —— 這兩站就是估計時間所依據的那兩站。
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
          // 記在他上車的那一站。這裡曾經改用「整個系統裡最近的站」重挑一次，於是
          // 同運具多條路線時，人被記到他沒搭的那條路線頭上（BUG-283）。
          boardStop.dailyRiders += sampleScale;
        }
        continue;
      }

      // 這一輪是為了路線池才問的，沒有車位可以放車。開車的人到這裡就結束 ——
      // 底下整段是找路與寫入通勤快取，那是生車的準備工作。
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
      this.getTransitSystemInfos(), origin, destination, this.stopReach,
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
   * 推進這一輪的流量重算，掃完才換上去。
   *
   * 一次算完要 60ms 落在單一個 tick 上，而速度 1 的一個 tick 只有 250ms，算繪還跟
   * 它搶同一個執行緒（BUG-327）。結果本來就每 60 tick 才換一次，攤開來算不會更舊。
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
    // 流量換了，逐路線的快取全部作廢，全城平均也要跟著重算。
    this.routeCongestionCache.clear();
    this.cityCongestionLevel = cityCongestion(flowMap, this.countRoadTiles());
    this.refreshBusRouteCongestion(flowMap);
  }

  /**
   * 這一趟沿途有多擠。
   *
   * 問的是**需求**算出來的逐格流量，不是畫面上有幾台車（BUG-326）。問不到這條路線
   * 的快取時退回全城平均 —— 那是「還沒算過」，不是「暢通」。
   *
   * 逐路線快取:同一條路上班的人成千上萬，而流量圖每 60 tick 才換一次。
   */
  /**
   * 每條公車路線沿線有多擠。
   *
   * 公車跟著幹道跑，而幹道本來就比全城平均塞:玩家 12 600 人的存檔實測，全城平均
   * 0.211，那條路線沿線 **0.380**（1.8 倍），線上最塞的一格已經是 1.0。吃全城平均
   * 等於告訴玩家「你的公車沒有塞在車陣裡」，而畫面上它明明卡在那裡。
   *
   * 只有公車要算 —— 捷運、鐵路、渡輪都不走地面道路（`affectedByCongestion`）。
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


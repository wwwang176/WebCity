import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand, applyBusinessTaxPenalty, BUSINESS_TAX } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';
import { birthTick } from '../citizen/Birth';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue, checkParkProximity } from '../economy/LandValue';
import { ZoneType, TerrainType, isResidentialZone, isCommercialZone, zoneToRCI } from '../grid/types';
import { RoadType } from '../road/types';
import { getLaneCount } from '../road/types';
import { LaneGraph } from '../traffic/LaneGraph';
import { findLanePath, findLanePathVariants } from '../traffic/LaneGraphPathfinder';
import { CommuteCache, type CachedRoute } from '../traffic/CommuteCache';
import { computeCongestionFlow, computeCongestionFlowMonteCarlo, type CongestionFlowDeps } from '../traffic/CongestionFlowPredictor';
import { getBuildingType } from '../building/types';
import { avgEducationScore } from '../building/BuildingUpgrade';
import { ECONOMY } from '../economy/TaxMultipliers';
import { DEFAULT_TAX_RATE } from '../economy/Tax';
import { getInfraBuildingId, getInfraConfigById, isZoneBuilding } from '../building/InfraConfig';
import { countZoneBuildings, countResidentialCapacity, countWorkplaceJobs } from '../building/BuildingQueries';
import { forEachGridPollutionSource } from '../environment/GridPollutionSources';
import { forEachServicePollutionSource } from '../environment/PollutionSourceRegistry';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../building/InfraPlacement';
import { calculateAbandonmentStress, ABANDONMENT, type AbandonmentConditions } from '../building/BuildingAbandonment';
import { isWorkingAge, EducationLevel, type Citizen } from '../citizen/types';
import { countOccupancy, assignWithPreference, assignWorkWithPreference } from '../citizen/OccupancyAssignment';
import { buildHousingCandidates, buildWorkplaceCandidates } from '../citizen/BuildingCandidateBuilder';
import { calculateCityHappinessContext } from '../citizen/CityHappinessContext';
import { computeOccupancyRatios } from '../citizen/OccupancyRatio';
import type { WorkplaceCandidate } from '../citizen/WorkplaceScore';
import { relocationTick } from '../citizen/Relocation';
import { jobRelocationTick, DEFAULT_JOB_RELOCATION_CONFIG } from '../citizen/JobRelocation';
import { roadDistanceToTargets } from '../service/RoadCoverageFlood';
import type { SchoolType, EnrolledCitizen } from '../service/EducationService';
import { EDUCATION_PROGRESSION, MIN_SCHOOL_AGE, type EducationRule, type DeathContext } from '../citizen/CitizenManager';
import { chooseMode, chooseModeMultiModal, type AvailableTransport } from '../transport/ModeChoice';
import { buildTransferGraph, findMultiModalRoutes, flattenSystems, type TransferGraph, type FlatRoute } from '../transport/MultiModalRouter';
import { calculateCitizenHealth, type HealthFactors } from '../citizen/CitizenHealth';
import { citizenHospitalDemand, loadRatioToDeathMultiplier, uncoveredPollutionMultiplier } from '../service/HealthService';
import { TransportMode } from '../transport/types';
import { getSystemForMode, getTransitSystems, getTotalTransportOperatingCost, tickAllTransportSystems } from '../transport/TransportRegistry';
import { getTotalServiceMaintenanceCost, tickAllCivicServices, collectFacilityOperationalStatus, type FacilityOpEntry } from '../service/ServiceRegistry';
import { parsePosKey, parsePosKeyUnsafe, toPosKey, FOUR_NEIGHBORS, manhattanDistance, countRoadTiles, findAdjacentRoad } from '../grid/GridHelpers';
import type { ResidentialShoppingStatus } from '../economy/ShoppingAccess';
import { applyFireDamage } from '../service/FireDamageProcessor';
import { getCellServiceScore, getResidentialServiceRatios } from '../service/ServiceCoverageQuery';
import { getAvgResidentialPollution, getAvgResidentialNoise, calculateCrimeRate } from '../environment/CityMetrics';
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
import { TRADE, FreightRouteType } from '../traffic/FreightSystem';
import { HIGHWAY_EXTERNAL } from '../traffic/HighwayConnection';

import { SIMULATION } from './SimulationConstants';


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
  private lastDeathDay = -1;
  private lastBirthMonth = -1;
  private lastRiderDay = -1;

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
  private transferGraph: TransferGraph = { byStop: new Map() };
  private transferGraphDirty = true;
  private flatRoutes: FlatRoute[] = [];

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

  constructor(state: GameState) {
    this.state = state;
    // Auto-clear commute cache when citizens are evicted from any building
    this.state.citizens.onEvicted = (ids) => {
      for (const id of ids) this.commuteCache.remove(id);
    };
  }

  tick(): void {
    if (!this.state.clock.advance()) return;

    const tick = this.state.clock.tick;
    // Slow-update operations are staggered across 6 tick offsets to spread CPU load.
    // Each subsystem still runs every 6 ticks, but on different frames.
    const slowSlot = tick % SIMULATION.SLOW_TICK_INTERVAL;

    // Mark building index dirty each tick so the first caller gets a fresh scan.
    // Subsequent rebuildBuildingIndex() calls within the same tick are no-ops.
    this.buildingIndexDirty = true;

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

    // ── Slot 1: Power / Water coverage ──
    if (slowSlot === 1) {
      this.infraPositions.clear();
      for (const p of this.state.power.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
      for (const p of this.state.water.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
      this.state.power.calculateDemand(this.state.grid);
      this.state.power.calculateCoverage(this.state.grid, this.infraPositions);
      this.state.water.calculateDemand(this.state.grid);
      this.state.water.calculateCoverage(this.state.grid, this.infraPositions);
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

    // ── Per-tick operations ──

    // Sync residential capacity gate (before births + migration)
    this.state.citizens.updateResidentialCapacity(countResidentialCapacity(this.state.grid));

    // Monthly: natural births
    const currentMonth = this.state.clock.getMonth();
    if (currentMonth !== this.lastBirthMonth) {
      this.lastBirthMonth = currentMonth;
      birthTick(this.state.citizens, {
        getResidents: (homeId) => {
          const [x, y] = homeId.split(',').map(Number);
          const cell = this.state.grid.getCell(x, y);
          if (!cell || !cell.buildingId) return SIMULATION.FALLBACK_RESIDENTS;
          return getBuildingType(cell.buildingId)?.residents ?? SIMULATION.FALLBACK_RESIDENTS;
        },
      }, this.state.clock.tick);
    }

    // Job relocation (every 120 ticks, offset to slot 4)
    if (tick >= 4 && (tick - 4) % SIMULATION.JOB_RELOCATION_INTERVAL === 0) {
      this.runJobRelocation();
    }

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


  private countJobOpenings(): number {
    const totalJobs = this.countTotalJobs();
    return Math.max(0, totalJobs - this.state.citizens.getPopulation());
  }

  private tryBuildingGrowth(): void {
    const grid = this.state.grid;
    const growth = this.state.buildingGrowth;
    const conditions = {
      hasPower: true, // simplified - check per cell later
      hasWater: true,
      rciDemand: this.state.rciDemand,
    };

    let changed = false;

    // Try growing on a sample of cells each tick (not all 60x60)
    const attempts = SIMULATION.GROWTH_ATTEMPTS;
    for (let i = 0; i < attempts; i++) {
      const x = randomInt(grid.width);
      const y = randomInt(grid.height);
      const cell = grid.getCell(x, y);
      if (!cell || cell.zoneType === ZoneType.NONE) continue;

      // Burned buildings: developer must demolish ruins first (extra cost/time)
      if (cell.reserved === BURNED && isZoneBuilding(cell.buildingId)) {
        if (Math.random() < SIMULATION.BURNED_CLEARANCE_CHANCE) {
          grid.setCell(x, y, { buildingId: 0, reserved: 0 });
          changed = true;
          this.onBuildingRemoved?.(x, y);
        }
        continue;
      }

      // Abandoned: only demolish if growth conditions are met, then build
      if (cell.reserved === ABANDONED && isZoneBuilding(cell.buildingId)) {
        conditions.hasPower = this.state.power.isPowered(x, y);
        conditions.hasWater = this.state.water.isSupplied(x, y);
        const rciType = zoneToRCI(cell.zoneType);
        if (!conditions.hasPower || !conditions.hasWater || !rciType || conditions.rciDemand[rciType] <= 0) continue;
        const district = this.state.districts.getDistrictAt(x, y);
        if (district && !this.state.policies.canBuildInDistrict(district.id, cell.zoneType)) continue;
        // Conditions met: demolish abandoned building, then grow
        grid.setCell(x, y, { buildingId: 0, reserved: 0 });
        this.abandonmentStress.delete(`${x},${y}`);
        this.onBuildingRemoved?.(x, y);
        if (growth.tryGrow(x, y, conditions)) {
          const grown = grid.getCell(x, y);
          if (grown) {
            const level = getBuildingType(grown.buildingId)?.level ?? 1;
            this.onBuildingAdded?.(x, y, cell.zoneType, level);
          }
        }
        changed = true;
        continue;
      }

      if (cell.buildingId === 0) {
        // Check district policy restrictions
        const district = this.state.districts.getDistrictAt(x, y);
        if (district && !this.state.policies.canBuildInDistrict(district.id, cell.zoneType)) {
          continue;
        }
        // Check power/water for this specific cell
        conditions.hasPower = this.state.power.isPowered(x, y);
        conditions.hasWater = this.state.water.isSupplied(x, y);
        if (growth.tryGrow(x, y, conditions)) {
          changed = true;
          const grown = grid.getCell(x, y);
          if (grown) {
            const level = getBuildingType(grown.buildingId)?.level ?? 1;
            this.onBuildingAdded?.(x, y, cell.zoneType, level);
          }
        }
      }
    }
    if (changed) { this.onBuildingsChanged?.(); this.wpDistCache?.invalidate(); }
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

    // Calculate workplace zone ratios for education-weighted immigration
    const totalWorkplaces = countWorkplaceJobs(this.state.grid) || 1;
    const officeJobs = countZoneBuildings(this.state.grid, t => t === ZoneType.OFFICE);
    const industrialJobs = countZoneBuildings(this.state.grid, t => t === ZoneType.INDUSTRIAL);

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
      avgPollution: this.getAvgPollution(),
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

    // Reusable factors object — mutated per citizen, no allocation per iteration
    const factors: HappinessFactors = {
      commuteDistance: 0, hasPark: hasParkCoverage,
      pollution: ctx.avgPollution, noiseLevel: ctx.avgNoise,
      crimeRate: ctx.avgCrime, isEmployed: true,
      taxRate, serviceCoverage: ctx.serviceCoverage,
      currentTick, homePowered: true, homeWatered: true,
      workplaceZoneType: undefined,
      shoppingAccess: undefined,
    };

    for (const citizen of citizens) {
      // Vary commute per citizen (+/- 3 random jitter)
      factors.commuteDistance = Math.max(1, ctx.avgCommute + (Math.random() * SIMULATION.COMMUTE_JITTER - SIMULATION.COMMUTE_JITTER / 2));

      // Check if citizen's home has power and water
      factors.homePowered = true;
      factors.homeWatered = true;
      factors.shoppingAccess = undefined;
      if (citizen.homeId) {
        const pos = parsePosKey(citizen.homeId);
        if (pos) {
          factors.homePowered = this.state.power.isPowered(pos.x, pos.y);
          factors.homeWatered = this.state.water.isSupplied(pos.x, pos.y);
          if (enableShopping) {
            factors.shoppingAccess = this.state.shopping.getResidentialAccess(pos.x, pos.y).ratio;
          }
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

      factors.isEmployed = !isWorkingAge(citizen.age) || Math.random() < ctx.employmentRate;
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

  /** Police demand weight by education level (avg = 1.0). */
  private static readonly POLICE_EDUCATION_MULT: Record<string, number> = {
    [EducationLevel.NONE]: 2.0,
    [EducationLevel.ELEMENTARY]: 1.1,
    [EducationLevel.HIGH_SCHOOL]: 0.6,
    [EducationLevel.UNIVERSITY]: 0.3,
  };
  /** Police demand weight by workplace zone type. */
  private static readonly POLICE_ZONE_MULT: Partial<Record<ZoneType, number>> = {
    [ZoneType.INDUSTRIAL]: 1.5,
    [ZoneType.COMMERCIAL_LOW]: 1.0, [ZoneType.COMMERCIAL_HIGH]: 1.0,
    [ZoneType.OFFICE]: 0.5,
  };
  /** Fire demand weight by workplace zone type. */
  private static readonly FIRE_ZONE_MULT: Partial<Record<ZoneType, number>> = {
    [ZoneType.INDUSTRIAL]: 2.0,
    [ZoneType.COMMERCIAL_LOW]: 1.2, [ZoneType.COMMERCIAL_HIGH]: 1.2,
    [ZoneType.OFFICE]: 0.8,
  };
  private static readonly BASE_DEMAND = 0.3;

  private updatePoliceFireLoads(): void {
    const policeDemands: Array<{ x: number; y: number; weight: number }> = [];
    const fireDemands: Array<{ x: number; y: number; weight: number }> = [];
    const BD = SimulationLoop.BASE_DEMAND;

    // Pre-compute occupancy count per home for fire demand
    const homePop = new Map<string, number>();
    for (const c of this.state.citizens.getCitizens()) {
      if (c.homeId) homePop.set(c.homeId, (homePop.get(c.homeId) ?? 0) + 1);
    }

    for (const c of this.state.citizens.getCitizens()) {
      // Residential demand (by home)
      if (c.homeId) {
        const pos = parsePosKey(c.homeId);
        if (pos) {
          if (this.state.police.getCoverage(pos.x, pos.y)) {
            const eMult = SimulationLoop.POLICE_EDUCATION_MULT[c.education] ?? 1.0;
            policeDemands.push({ x: pos.x, y: pos.y, weight: BD * eMult });
          }
          if (this.state.fire.getCoverage(pos.x, pos.y)) {
            const cell = this.state.grid.getCell(pos.x, pos.y);
            const cap = Math.max(1, getBuildingType(cell?.buildingId ?? 0)?.residents ?? 1);
            const occ = (homePop.get(c.homeId) ?? 0) / cap;
            fireDemands.push({ x: pos.x, y: pos.y, weight: BD * (1 + occ) });
          }
        }
      }
      // Workplace demand (by job location)
      if (c.workplaceId) {
        const wpos = parsePosKey(c.workplaceId);
        if (wpos) {
          const wcell = this.state.grid.getCell(wpos.x, wpos.y);
          const zt = wcell?.zoneType ?? ZoneType.NONE;
          if (this.state.police.getCoverage(wpos.x, wpos.y)) {
            const zMult = SimulationLoop.POLICE_ZONE_MULT[zt] ?? 1.0;
            policeDemands.push({ x: wpos.x, y: wpos.y, weight: BD * zMult });
          }
          if (this.state.fire.getCoverage(wpos.x, wpos.y)) {
            const zMult = SimulationLoop.FIRE_ZONE_MULT[zt] ?? 1.0;
            fireDemands.push({ x: wpos.x, y: wpos.y, weight: BD * zMult });
          }
        }
      }
    }

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
    return getAvgResidentialNoise(this.state.grid);
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
      this.onBuildingUpdated?.(u.x, u.y, u.zoneType, u.level, u.burned);
    }
    if (changed) { this.onBuildingsChanged?.(); this.wpDistCache?.invalidate(); }
  }

  private updatePollution(): void {
    const grid = this.state.grid;
    const pm = this.state.pollution;

    // Sync predicted traffic flow → grid trafficDensity for noise pollution
    this.syncTrafficDensity();

    pm.clearSources();

    // Add pollution sources directly (no intermediate arrays)
    forEachGridPollutionSource(grid, (src) => pm.addPollutionSource(src));
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
          this.onBuildingUpdated?.(x, y, updated.zoneType, newLevel, updated.reserved === BURNED);
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
    const grid = this.state.grid;
    const businessTax = this.state.taxRates.business ?? DEFAULT_TAX_RATE;
    const resTax = this.state.taxRates.residential ?? DEFAULT_TAX_RATE;
    const baseCrime = this.getAvgCrime();
    let changed = false;

    grid.forEachCell((cell, x, y) => {
      if (!isZoneBuilding(cell.buildingId)) return;
      if (cell.reserved === ABANDONED || cell.reserved === BURNED) return;

      const pollution = this.state.pollution.getPollutionAt(x, y);
      const building = getBuildingType(cell.buildingId);
      if (!building) return;

      const posKey = toPosKey(x, y);

      // Per-cell crime: base crime adjusted by local police coverage
      const localCrime = Math.max(0, baseCrime + this.state.police.getCrimeReduction(x, y));

      // Continuous service score: each service contributes (1 - costRatio), power/water weight 2
      // Non-residential zones only count infrastructure & safety (power/water/police/fire),
      // normalized to 0–10 scale so full coverage gives equal offset regardless of zone type.
      const svc = (ratio: number) => ratio < 0 ? 0 : 1 - ratio; // -1=uncovered→0, 0=nearest→1, 1=farthest→0
      const isRes = isResidentialZone(cell.zoneType);
      const rawScore =
        (this.state.power.isPowered(x, y) ? 2 : 0) +
        (this.state.water.isSupplied(x, y) ? 2 : 0) +
        svc(this.state.police.getCostRatio(x, y)) +
        svc(this.state.fire.getCostRatio(x, y)) +
        (isRes ? svc(this.state.garbage.getCostRatio(x, y)) : 0) +
        (isRes ? svc(this.state.health.getCostRatio(x, y)) : 0) +
        (isRes ? svc(this.state.education.getCostRatio(x, y)) : 0) +
        (isRes ? svc(this.state.deathCare.getCostRatio(x, y)) : 0);
      // Residential max=SERVICE_MAX_RES, non-residential max=SERVICE_MAX_NON_RES → normalize
      const serviceScore = isRes ? rawScore : rawScore * (SIMULATION.SERVICE_MAX_RES / SIMULATION.SERVICE_MAX_NON_RES);

      const conditions: AbandonmentConditions = {
        businessTaxRate: businessTax,
        residentialTaxRate: resTax,
        isPowered: this.state.power.isPowered(x, y),
        isWatered: this.state.water.isSupplied(x, y),
        crimeRate: localCrime,
        pollution: pollution.ground + pollution.water,
        buildingLevel: building.level,
        serviceScore,
        freightRatio: isCommercialZone(cell.zoneType) ? this.state.freight.getSupplyStatus(x, y).ratio : undefined,
        freightSurplusRatio: cell.zoneType === ZoneType.INDUSTRIAL ? this.state.freight.getSurplusRatio() : undefined,
      };

      const { totalDelta } = calculateAbandonmentStress(cell.zoneType, conditions);

      // Per-building resilience: deterministic hash → 0.5~1.5 multiplier
      // Low resilience buildings break first, high resilience ones hold longer
      const resilience = 0.5 + ((x * 7919 + y * 104729) % 1000) / 1000;
      const adjustedDelta = totalDelta > 0 ? totalDelta / resilience : totalDelta;

      const current = this.abandonmentStress.get(posKey) ?? 0;
      const next = Math.max(0, Math.min(100, current + adjustedDelta));

      if (next === 0) {
        this.abandonmentStress.delete(posKey);
      } else {
        this.abandonmentStress.set(posKey, next);
      }

      // Stress ≥ 100: abandon
      if (next >= ABANDONMENT.STRESS_ABANDON) {
        grid.setCell(x, y, { reserved: ABANDONED });
        this.state.citizens.evictBuilding(posKey, this.state.clock.tick);
        changed = true;
        this.onBuildingUpdated?.(x, y, cell.zoneType, building.level, false, true);
      }
    });

    if (changed) { this.onBuildingsChanged?.(); this.wpDistCache?.invalidate(); }
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

    // Trigger async cache update if stale
    if (this.wpDistCache && this.wpDistCache.isStale && workplaceCandidates.length > 0) {
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
    const reachable = (this.wpDistCache?.isReady)
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

    // Use cache-based distance lookup when ready (O(1) per lookup, no Dijkstra)
    const distanceLookup = (this.wpDistCache?.isReady)
      ? (_grid: any, homePos: { x: number; y: number }, targets: Set<string>, _budget: number) => {
          const homeKey = toPosKey(homePos.x, homePos.y);
          return this.wpDistCache!.getDistancesFromHome(homeKey, targets);
        }
      : undefined;

    const { relocatedIds } = jobRelocationTick(
      citizens,
      workplaceCandidates,
      workOccupancy,
      this.commuteCache,
      this.state.grid,
      this.state.clock.tick,
      undefined,
      distanceLookup,
    );

    // Clear commute cache for relocated citizens so routes are recalculated
    for (const id of relocatedIds) {
      this.commuteCache.remove(id);
    }
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

  markLaneGraphDirty(affectedCells?: string[], skipUnreachableCheck = false): void {
    this.laneGraphDirty = true;
    this.sidewalkGraphDirty = true;
    this.tripPoolDirty = true;
    this.transferGraphDirty = true;
    this.commuteCache.bumpGeneration();
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
  }

  private rebuildSidewalkGraph(): void {
    const grid = this.state.grid;
    const cellKeys: string[] = [];
    const gridLookup = {
      getCell: (x: number, y: number) => {
        const cell = grid.getCell(x, y);
        if (!cell) return null;
        return {
          roadType: cell.roadType,
          roadFlags: cell.roadFlags,
          railType: cell.railType,
        };
      },
    };

    grid.forEachCell((cell, x, y) => {
      if (cell.roadType !== RoadType.NONE) {
        cellKeys.push(toPosKey(x, y));
      }
    });

    this.state.sidewalkGraph.buildFromGrid(gridLookup, cellKeys);
    // Re-link pedestrianManager to the updated graph
    this.state.pedestrianManager = new PedestrianManager(
      this.state.sidewalkGraph,
      this.state.trafficLights,
      null, // levelCrossings — connected via Game.ts
    );
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

    // Rebuild transfer graph when transit network has changed
    if (this.transferGraphDirty) {
      const systems = this.getTransitSystemInfos();
      this.flatRoutes = flattenSystems(systems);
      this.transferGraph = buildTransferGraph(this.flatRoutes, SIMULATION.TRANSFER_WALK_RANGE);
      this.transferGraphDirty = false;
    }

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
            // Use stop roadX/roadY (road-adjacent cell) when available
            // so sidewalk pathfinding can connect the dots.
            const legs = multiLeg.legs;
            for (let li = 0; li < legs.length; li++) {
              const leg = legs[li]!;
              if (leg.type !== 'walk') continue;
              let wFromX = leg.fromX, wFromY = leg.fromY;
              let wToX = leg.toX, wToY = leg.toY;
              // Transfer & last-mile walks start at an alight stop — use its roadX/roadY
              // or find the nearest road cell as fallback (metro/rail stops lack roadX/roadY).
              if (li > 0) {
                const prevRide = legs[li - 1]!;
                if (prevRide.routeIdx !== undefined && prevRide.alightStopIdx !== undefined) {
                  const s = this.flatRoutes[prevRide.routeIdx]?.stops[prevRide.alightStopIdx];
                  if (s?.roadX !== undefined && s?.roadY !== undefined) {
                    wFromX = s.roadX; wFromY = s.roadY;
                  } else if (s) {
                    const r = findAdjacentRoad(grid, s.x, s.y);
                    if (r) { wFromX = r.x; wFromY = r.y; }
                  }
                }
              }
              // Transfer & first-mile walks end at a boarding stop — use its roadX/roadY
              if (li < legs.length - 1) {
                const nextRide = legs[li + 1]!;
                if (nextRide.routeIdx !== undefined && nextRide.boardStopIdx !== undefined) {
                  const s = this.flatRoutes[nextRide.routeIdx]?.stops[nextRide.boardStopIdx];
                  if (s?.roadX !== undefined && s?.roadY !== undefined) {
                    wToX = s.roadX; wToY = s.roadY;
                  } else if (s) {
                    const r = findAdjacentRoad(grid, s.x, s.y);
                    if (r) { wToX = r.x; wToY = r.y; }
                  }
                }
              }
              this.pendingTrips.push({
                fromX: wFromX, fromY: wFromY,
                toX: wToX, toY: wToY,
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
          for (const leg of multiLeg.legs) {
            if (leg.type === 'ride' && leg.routeIdx !== undefined && leg.boardStopIdx !== undefined) {
              const route = this.flatRoutes[leg.routeIdx];
              if (route) {
                const stop = route.stops[leg.boardStopIdx] as { dailyRiders: number } | undefined;
                if (stop) stop.dailyRiders++;
              }
            }
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

      if (cached && cached.status === 'ready'
          && !this.commuteCache.isDirty(citizen.id)
          && !this.commuteCache.isExpired(cached, currentTick)) {
        const cachedPath = toWork ? cached.morningPath : cached.eveningPath;
        if (cachedPath && cachedPath.length > 0) {
          this.state.traffic.addVehicleOnEdges(cachedPath, citizen.id);
          spawned++;
          continue;
        }
      }

      // --- Compute path and populate cache ---
      const routeKey = `${fromStr}->${toStr}`;
      let variants = this.commuteCache.getRouteVariants(routeKey) ?? null;

      if (!variants && this._roadLookup) {
        variants = findLanePathVariants(this.laneGraph, this._roadLookup, fromPos, toPos);
        if (variants.length > 0) {
          this.commuteCache.setRouteVariants(routeKey, variants);
        }
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
        const endRoad = findAdjacentRoad(grid, bp.x, bp.y);
        if (!endRoad || (endRoad.x === edge.x && endRoad.y === edge.y)) continue;
        const edgePath = findLanePath(this.laneGraph, this._roadLookup, edge, endRoad);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addVehicleOnEdges(edgePath);
        }
      } else {
        const startRoad = findAdjacentRoad(grid, bp.x, bp.y);
        if (!startRoad || (startRoad.x === edge.x && startRoad.y === edge.y)) continue;
        const edgePath = findLanePath(this.laneGraph, this._roadLookup, startRoad, edge);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addVehicleOnEdges(edgePath);
        }
      }
    }
  }

  /**
   * Spawn freight trucks for three trade routes:
   * 1. Local supply: industrial → commercial
   * 2. Export: industrial → trade node (station/airport/highway edge)
   * 3. Import: trade node → commercial
   *
   * A-limit: each industrial building has at most 1 truck; each trade node has at most N trucks.
   * B-limit: total freight trucks on road ≤ freightCap.
   * Routes are cached in shared CommuteCache.routeIndex.
   */
  private spawnFreightTraffic(
    grid: { getCell(x: number, y: number): { roadType: number; zoneType: number } | null; width: number; height: number },
    vehicleCap: number,
  ): void {
    const freight = this.state.freight;
    const lastTrade = freight.getLastTrade();
    const lastDemand = freight.getLastDemand();

    const production = lastDemand.production;
    const imported = lastTrade.imported;
    const exported = lastTrade.exported;

    if (production === 0 && imported === 0) return;

    // B-limit: total freight trucks on road
    const freightCap = Math.floor(vehicleCap * SIMULATION.FREIGHT_CAP_RATIO);

    // Rebuild activeFreight from live vehicles
    const af = this.activeFreight;
    af.clear();
    let freightOnRoad = 0;
    for (const v of this.state.traffic.vehicles) {
      if (v.sourceBuildingKey && !v.arrived) {
        af.set(v.sourceBuildingKey, (af.get(v.sourceBuildingKey) ?? 0) + 1);
        freightOnRoad++;
      }
    }
    if (freightOnRoad >= freightCap) return;

    if (this.buildingPositions.length === 0) return;

    // A-limit: collect available sources (industrial buildings with < 1 truck)
    const availableIndustrials: { x: number; y: number; key: string }[] = [];
    const commercials: { x: number; y: number }[] = [];
    for (const bp of this.buildingPositions) {
      const cell = grid.getCell(bp.x, bp.y);
      if (!cell) continue;
      if (cell.zoneType === ZoneType.INDUSTRIAL) {
        const key = toPosKey(bp.x, bp.y);
        if ((af.get(key) ?? 0) < 1) availableIndustrials.push({ x: bp.x, y: bp.y, key });
      } else if (isCommercialZone(cell.zoneType)) {
        commercials.push(bp);
      }
    }

    // A-limit: collect available trade road cells (< N trucks per trade node, keyed by tradeKey)
    const availableTrade: { x: number; y: number; key: string }[] = [];
    for (const tp of this.cachedTradePositions) {
      const maxTrucks = Math.ceil(tp.throughput / SIMULATION.FREIGHT_TRUCKS_PER_THROUGHPUT);
      if ((af.get(tp.tradeKey) ?? 0) < maxTrucks) availableTrade.push({ x: tp.x, y: tp.y, key: tp.tradeKey });
    }

    // Route weights from economic data
    const localVolume = Math.max(0, production - exported);
    const hasLocal = availableIndustrials.length > 0 && commercials.length > 0 && localVolume > 0;
    const hasExport = availableIndustrials.length > 0 && availableTrade.length > 0 && exported > 0;
    const hasImport = availableTrade.length > 0 && commercials.length > 0 && imported > 0;

    if (!hasLocal && !hasExport && !hasImport) return;

    const options: Array<{ type: FreightRouteType; weight: number }> = [];
    if (hasLocal) options.push({ type: FreightRouteType.LOCAL, weight: localVolume });
    if (hasExport) options.push({ type: FreightRouteType.EXPORT, weight: exported });
    if (hasImport) options.push({ type: FreightRouteType.IMPORT, weight: imported });
    const totalWeight = options.reduce((s, o) => s + o.weight, 0);
    if (totalWeight === 0) return;

    // Spawn up to (freightCap - freightOnRoad) trucks, max 5 per tick
    const maxPerTick = Math.min(5, freightCap - freightOnRoad);

    for (let i = 0; i < maxPerTick; i++) {
      if (freightOnRoad >= freightCap) break;

      // Weighted random route selection
      let roll = Math.random() * totalWeight;
      let routeType: FreightRouteType = FreightRouteType.LOCAL;
      for (const o of options) {
        roll -= o.weight;
        if (roll <= 0) { routeType = o.type; break; }
      }

      let from: { x: number; y: number; key: string };
      let to: { x: number; y: number };

      switch (routeType) {
        case FreightRouteType.LOCAL:
          if (availableIndustrials.length === 0 || commercials.length === 0) continue;
          from = availableIndustrials[randomInt(availableIndustrials.length)]!;
          to = commercials[randomInt(commercials.length)]!;
          break;
        case FreightRouteType.EXPORT:
          if (availableIndustrials.length === 0 || availableTrade.length === 0) continue;
          from = availableIndustrials[randomInt(availableIndustrials.length)]!;
          to = availableTrade[randomInt(availableTrade.length)]!;
          break;
        case FreightRouteType.IMPORT:
          if (availableTrade.length === 0 || commercials.length === 0) continue;
          from = availableTrade[randomInt(availableTrade.length)]!;
          to = commercials[randomInt(commercials.length)]!;
          break;
      }

      // Use shared CommuteCache.routeIndex for path caching
      const fromRoad = findAdjacentRoad(grid, from.x, from.y);
      const toRoad = findAdjacentRoad(grid, to.x, to.y);
      if (!fromRoad || !toRoad || (fromRoad.x === toRoad.x && fromRoad.y === toRoad.y)) continue;
      if (!this._roadLookup) continue;

      const routeKey = `${toPosKey(from.x, from.y)}->${toPosKey(to.x, to.y)}`;
      let variants = this.commuteCache.getRouteVariants(routeKey) ?? null;

      if (!variants) {
        variants = findLanePathVariants(this.laneGraph, this._roadLookup, fromRoad, toRoad);
        if (variants.length > 0) {
          this.commuteCache.setRouteVariants(routeKey, variants);
        }
      }

      const edgePath = variants && variants.length > 0
        ? variants[Math.floor(Math.random() * variants.length)]!
        : null;

      if (edgePath && edgePath.length > 0) {
        this.state.traffic.addFreightVehicle(edgePath, from.key);
        freightOnRoad++;
        // Update activeFreight count for A-limit within this tick
        const newCount = (af.get(from.key) ?? 0) + 1;
        af.set(from.key, newCount);
        if (routeType === FreightRouteType.IMPORT) {
          // Remove all road cells of this trade node if it reached its limit
          const tp = this.cachedTradePositions.find(t => t.tradeKey === from.key);
          const maxTrucks = tp ? Math.ceil(tp.throughput / SIMULATION.FREIGHT_TRUCKS_PER_THROUGHPUT) : 1;
          if (newCount >= maxTrucks) {
            for (let j = availableTrade.length - 1; j >= 0; j--) {
              if (availableTrade[j]!.key === from.key) availableTrade.splice(j, 1);
            }
          }
        } else {
          // Industrial: max 1, remove from available list
          const idx = availableIndustrials.indexOf(from as any);
          if (idx >= 0) availableIndustrials.splice(idx, 1);
        }
      }
    }
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

  private findNearestStop(
    stops: readonly { x: number; y: number; passengers: number }[],
    pos: { x: number; y: number },
  ): { x: number; y: number; passengers: number } | null {
    let best: { x: number; y: number; passengers: number } | null = null;
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


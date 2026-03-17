import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand, applyBusinessTaxPenalty, BUSINESS_TAX } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';
import { birthTick } from '../citizen/Birth';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue, checkParkProximity } from '../economy/LandValue';
import { ZoneType, TerrainType, isResidentialZone, isCommercialZone } from '../grid/types';
import { RoadType } from '../road/types';
import { getLaneCount } from '../traffic/TrafficSimulation';
import { LaneGraph } from '../traffic/LaneGraph';
import { refineLanePath, refineLanePathVariants, gridAStarPath } from '../traffic/Pathfinding';
import { CommuteCache, type CachedRoute } from '../traffic/CommuteCache';
import { collectEdgeCells } from '../traffic/CommuteCacheHelpers';
import { getBuildingType } from '../building/types';
import { clampBuildingLevel } from '../building/BuildingLevel';
import { ECONOMY } from '../economy/TaxMultipliers';
import { getInfraBuildingId, isZoneBuilding } from '../building/InfraConfig';
import { countZoneBuildings, countResidentialCapacity, countWorkplaceJobs } from '../building/BuildingQueries';
import { getGridPollutionSources } from '../environment/GridPollutionSources';
import { MULTI_CELL_OCCUPIED, BURNED, ABANDONED } from '../building/InfraPlacement';
import { calculateAbandonmentStress, ABANDONMENT, type AbandonmentConditions } from '../building/BuildingAbandonment';
import { isWorkingAge, type Citizen } from '../citizen/types';
import { countOccupancy, assignWithPreference, assignWorkWithPreference } from '../citizen/OccupancyAssignment';
import { buildHousingCandidates, buildWorkplaceCandidates } from '../citizen/BuildingCandidateBuilder';
import { calculateCityHappinessContext } from '../citizen/CityHappinessContext';
import { computeOccupancyRatios } from '../citizen/OccupancyRatio';
import type { WorkplaceCandidate } from '../citizen/WorkplaceScore';
import { relocationTick } from '../citizen/Relocation';
import { jobRelocationTick, DEFAULT_JOB_RELOCATION_CONFIG } from '../citizen/JobRelocation';
import { roadDistanceToTargets } from '../service/RoadCoverageFlood';
import type { TimeOfDay } from './GameClock';
import { chooseMode, type AvailableTransport } from '../transport/ModeChoice';
import { TransportMode } from '../transport/types';
import { getSystemForMode, getTransitSystems, getTotalTransportOperatingCost, tickAllTransportSystems } from '../transport/TransportRegistry';
import { getTotalServiceMaintenanceCost } from '../service/ServiceRegistry';
import { parsePosKey, parsePosKeyUnsafe, toPosKey, FOUR_NEIGHBORS, manhattanDistance, countRoadTiles } from '../grid/GridHelpers';
import { applyFireDamage } from '../service/FireDamageProcessor';
import { getCellServiceScore, getResidentialServiceRatios } from '../service/ServiceCoverageQuery';
import { getAvgResidentialPollution, getAvgResidentialNoise, calculateCrimeRate } from '../environment/CityMetrics';
import { collectAllPollutionSources } from '../environment/PollutionSourceRegistry';
import { calculateZoneIncomes } from '../economy/IncomeCalculator';
import { buildIncomeCalcDeps } from '../economy/IncomeCalcAdapter';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../economy/ExpenseCalculator';
import { randomInt, randomElement, pickWeighted } from '../utils/random';
import { buildODPools } from '../traffic/ODPoolBuilder';
import { findAvailableTransit } from '../transport/TransitAvailability';
import { findRoadPath } from '../traffic/RoadPathfinding';
import { ServiceVehicleManager, type ServiceFacilityProvider, type ServiceVehicleType } from '../traffic/ServiceVehicleManager';
import { SidewalkGraph } from '../traffic/SidewalkGraph';
import { PedestrianManager, getMaxPedestrians, buildTripPool, sampleTrip, type AggregatedTrip, type WalkingTripPool } from '../traffic/PedestrianManager';
import { PedestrianTripType } from '../traffic/PedestrianAgent';

/** Simulation tuning constants */
export const SIMULATION = {
  /** Ticks between service/RCI/growth updates */
  SLOW_TICK_INTERVAL: 6,
  /** Ticks between heavier computations: pollution, land value, vehicle spawning */
  MEDIUM_TICK_INTERVAL: 60,
  /** Ticks between job relocation checks */
  JOB_RELOCATION_INTERVAL: 60,
  /** Number of random cells sampled per growth tick */
  GROWTH_ATTEMPTS: 20,
  /** Chance per attempt for burned building auto-clearance */
  BURNED_CLEARANCE_CHANCE: 0.02,
  /** Chance per attempt for abandoned building auto-clearance */
  ABANDONED_CLEARANCE_CHANCE: 0.03,
  /** Default happiness used when city has no citizens */
  DEFAULT_HAPPINESS: 70,
  /** Business tax baseline — penalty applies above this rate */
  BUSINESS_TAX_BASELINE: 9,
  /** Demand penalty per percentage point above baseline */
  BUSINESS_TAX_PENALTY_PER_POINT: 2,
  /** Crime: max base crime rate */
  CRIME_BASE_MAX: 50,
  /** Crime: population factor for base crime */
  CRIME_POP_FACTOR: 0.02,
  /** Crime: coverage factor per police station */
  CRIME_COVERAGE_PER_STATION: 0.15,
  /** Crime: max reduction from police coverage */
  CRIME_MAX_REDUCTION: 0.6,
  /** Commute: max estimated average commute */
  COMMUTE_MAX: 25,
  /** Commute: base commute distance */
  COMMUTE_BASE: 1,
  /** Commute: multiplier for sqrt(resCount) */
  COMMUTE_SPREAD_FACTOR: 0.7,
  /** Commute: random jitter range */
  COMMUTE_JITTER: 6,
  /** Service coverage: power weight */
  SERVICE_POWER_WEIGHT: 2,
  /** Service coverage: water weight */
  SERVICE_WATER_WEIGHT: 2,
  /** Pollution threshold for service coverage bonus */
  LOW_POLLUTION_THRESHOLD: 10,
  /** Cell value maximum (uint8 range) */
  CELL_VALUE_MAX: 255,
  /** Vehicle cap: maximum vehicles on road */
  VEHICLE_CAP_MAX: 2000,
  /** Vehicle cap: base count */
  VEHICLE_CAP_BASE: 20,
  /** Vehicle cap: fraction of population */
  VEHICLE_CAP_POP_RATIO: 0.3,
  /** Rush period ticks for commute spawning */
  RUSH_TICKS: 4,
  /** Minimum commute spawns per tick */
  MIN_SPAWN_PER_TICK: 5,
  /** Commute sampling: minimum sample count */
  SAMPLE_COUNT_MIN: 50,
  /** Commute sampling: maximum sample count */
  SAMPLE_COUNT_MAX: 300,
  /** Commute sampling: eligible commuters per sample */
  SAMPLE_DIVISOR: 5,
  /** Walking distance to transit stop (cells) */
  WALK_TO_STOP_RANGE: 5,
  /** Industrial zone pollution reduction factor */
  INDUSTRIAL_POLLUTION_FACTOR: 0.2,
  /** Rail/metro transit time discount factor */
  RAIL_TRANSIT_TIME_FACTOR: 0.8,
} as const;

// clampBuildingLevel re-exported from shared module for backward compatibility
export { clampBuildingLevel } from '../building/BuildingLevel';

export class SimulationLoop {
  private state: GameState;
  private lastAgeYear = -1;
  private lastDeathDay = -1;

  // Lane-level connection graph for edge-based vehicle movement
  laneGraph: LaneGraph = new LaneGraph();
  private laneGraphDirty = true;

  // Building index: active zone buildings (excludes ABANDONED/BURNED). Rebuilt every slow tick.
  private buildingPositions: { pos: string; x: number; y: number; buildingId: number }[] = [];

  // Track which citizens have already commuted this rush period
  private morningCommuters = new Set<number>(); // citizen ids that have spawned morning commute
  private eveningCommuters = new Set<number>(); // citizen ids that have spawned evening commute
  private lastTimeOfDay: TimeOfDay = 'night'; // to detect period transitions

  // Commute path cache: stores computed LaneEdge paths for citizen commutes
  commuteCache: CommuteCache = new CommuteCache();

  // Service vehicle manager: spawns patrol vehicles within service coverage
  private serviceVehicleManager = new ServiceVehicleManager();

  // Sidewalk graph: built alongside laneGraph
  private sidewalkGraphDirty = true;

  // Walking trip pool: rebuilt each rush period from commute mode distribution
  private walkingTripPool: WalkingTripPool = { trips: [], totalWeight: 0, prefixSums: [] };
  private tripPoolDirty = true;
  private pendingTrips: AggregatedTrip[] = [];

  /** Per-building occupancy ratio (0.0–1.0) for rendering (updated after housing assignment). */
  occupancyRatios: Map<string, number> = new Map();

  /** Per-building abandonment stress (0–100). Key is "x,y". */
  abandonmentStress: Map<string, number> = new Map();

  /** Called when building state changes (growth/demolish/burn/upgrade) */
  onBuildingsChanged?: () => void;
  /** Called when terrain-related state changes (pollution/land value) */
  onTerrainChanged?: () => void;

  /** Fine-grained building callbacks for incremental rendering */
  onBuildingAdded?: (x: number, y: number, zoneType: number, level: number) => void;
  onBuildingRemoved?: (x: number, y: number) => void;
  onBuildingUpdated?: (x: number, y: number, zoneType: number, level: number, burned: boolean, abandoned?: boolean) => void;

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
    // Many operations were tuned for ticksPerDay=4. With ticksPerDay=24 (6x more),
    // we gate slow-update operations to run every 6 ticks to preserve balance.
    const isSlowTick = tick % SIMULATION.SLOW_TICK_INTERVAL === 0;

    // 1. Economy: RCI demand (every 6 ticks)
    if (isSlowTick) {
      const rci = calculateRCIDemand({
        residentialSupply: countZoneBuildings(this.state.grid, isResidentialZone),
        commercialSupply: countZoneBuildings(this.state.grid, isCommercialZone),
        industrialSupply: countZoneBuildings(this.state.grid, t => t === ZoneType.INDUSTRIAL),
        population: this.state.citizens.getPopulation(),
        jobOpenings: this.countJobOpenings(),
        exportDemand: 10,
      });
      this.state.rciDemand = applyBusinessTaxPenalty(
        rci, this.state.taxRates.business ?? BUSINESS_TAX.BASELINE,
      );
    }

    // 2. Budget tick (every 6 ticks to maintain same daily income/expense rate)
    if (isSlowTick) {
      this.state.budget = tickBudget(this.state.budget);
    }

    // 3. Services (power/water coverage) — every 6 ticks
    if (isSlowTick) {
      const infraPositions = new Set<string>();
      for (const p of this.state.power.getPlants()) infraPositions.add(toPosKey(p.x, p.y));
      for (const p of this.state.water.getPlants()) infraPositions.add(toPosKey(p.x, p.y));
      // Calculate demand before coverage so supplyRatio is available for budget-drain
      this.state.power.calculateDemand(this.state.grid);
      this.state.power.calculateCoverage(this.state.grid, infraPositions);
      this.state.water.calculateDemand(this.state.grid);
      this.state.water.calculateCoverage(this.state.grid, infraPositions);
    }

    // 3.5 Civic services tick (every 6 ticks)
    if (isSlowTick) {
      this.state.police.tick();
      this.state.fire.tick();
      this.state.health.tick();
      this.state.education.tick();
      this.state.parks.tick();
      this.state.garbage.tick(this.state.citizens.getPopulation());
      this.state.sewage.tick(this.state.citizens.getPopulation());
      this.state.deathCare.tick();

      // Fire events: try random fire and resolve completed fires
      this.processFireEvents();
    }

    // 3.6. Pollution & land value: update every 60 ticks (was 10 with ticksPerDay=4)
    if (tick % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.updatePollution();
      this.updateLandValue();
      this.onTerrainChanged?.();
    }

    // 4. Building growth (every 6 ticks)
    if (isSlowTick) {
      this.tryBuildingGrowth();
    }

    // 4.5. Building upgrades/downgrades (every 6 ticks)
    if (isSlowTick) {
      this.tryBuildingUpgrades();
    }

    // 4.6. Abandonment stress (every 6 ticks)
    if (isSlowTick) {
      this.processAbandonmentStress();
    }

    // 4.7 Education: upgrade citizen education based on school availability
    if (isSlowTick) {
      const schools = this.state.education.getSchools();
      const hasElementary = schools.some(s => s.type === 'elementary');
      const hasHighSchool = schools.some(s => s.type === 'highschool');
      const hasUniversity = schools.some(s => s.type === 'university');
      this.state.citizens.educateTick(hasElementary, hasHighSchool, hasUniversity);
    }

    // 5a. Citizens aging (once per game year) — only age, no death
    const currentYear = this.state.clock.getYear();
    if (currentYear !== this.lastAgeYear) {
      this.lastAgeYear = currentYear;
      this.state.citizens.ageTick();
      birthTick(this.state.citizens);
    }

    // 5b. Daily death check (once per game day) — bathtub curve + health coverage
    const currentDay = this.state.clock.getDay();
    if (currentDay !== this.lastDeathDay) {
      this.lastDeathDay = currentDay;
      this.state.deathCare.advanceDay();
      this.state.fire.advanceDay();
      const deadIds = this.state.citizens.deathTick(
        (citizen) => {
          if (!citizen.homeId) return false;
          const pos = parsePosKey(citizen.homeId);
          if (!pos) return false;
          return this.state.health.getCoverage(pos.x, pos.y);
        }
      );
      for (const id of deadIds) {
        this.commuteCache.remove(id);
        this.state.deathCare.reportDeath();
      }
    }

    // 5.5. Update citizen happiness (every 6 ticks)
    if (isSlowTick) {
      this.updateCitizenHappiness();
    }

    // 6. Migration (every 6 ticks)
    if (isSlowTick) {
      this.runMigration();
    }

    // 6.5 Assign home/workplace to citizens who don't have them yet
    if (isSlowTick) {
      this.assignCitizenHousing();
    }

    // 6.6 Relocation: unhappy citizens may move to better housing (every 60 ticks)
    if (tick % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.runRelocation();
    }

    // 6.7 Job relocation: citizens with long/failed commutes switch workplace (every 120 ticks)
    if (tick % SIMULATION.JOB_RELOCATION_INTERVAL === 0) {
      this.runJobRelocation();
    }

    // 7. Rebuild lane graph if roads changed
    if (this.laneGraphDirty) {
      this.rebuildLaneGraph();
      this.laneGraphDirty = false;
    }
    // 7a. Rebuild sidewalk graph if roads changed
    if (this.sidewalkGraphDirty) {
      this.rebuildSidewalkGraph();
      this.sidewalkGraphDirty = false;
    }

    // 7b. Traffic - spawn commute vehicles and advance (every tick for smooth traffic)
    this.spawnVehicles();
    this.state.trafficLights.tick();

    // 7b2. Pedestrian spawning/despawn happens per tick (movement is per-frame in Game.ts)

    // 7c. Service vehicles — patrol within coverage areas (every 6 ticks)
    if (isSlowTick) {
      this.tickServiceVehicles();
    }

    // 8. Transport systems (every tick — OCP: adding systems only requires TransportRegistry update)
    this.state.bus.congestionLevel = this.state.traffic.getCongestionLevel();
    tickAllTransportSystems(this.state);

    // 8b. Freight: industrial→commercial cargo flow (every tick)
    this.state.freight.tick(this.state.grid);

    // 8c. Rail freight bonus: each active freight train adds cargo throughput
    const freightTrainCount = this.state.rail.getFreightTrainCount();
    if (freightTrainCount > 0) {
      this.state.freight.addExternalCargo(freightTrainCount * 10);
    }

    // 8d. Airport cargo contribution
    const airportCargo = this.state.airport.consumeCargo();
    if (airportCargo > 0) {
      this.state.freight.addExternalCargo(airportCargo);
    }

    // 8e. Rail external connection (every 60 ticks)
    if (tick % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.state.rail.updateExternalConnection(this.state.grid.width, this.state.grid.height);
      if (this.state.rail.hasExternalConnection) {
        this.state.freight.addExternalCargo(this.state.rail.externalConnection.goodsIn);
      }
    }

    // 9. Calculate income from buildings (every 6 ticks)
    if (isSlowTick) {
      this.calculateIncome();
      this.state.globalMarket.tick();
    }

    // 10. Congestion flow prediction (first tick + every 60 ticks = ~15 sec)
    if (tick === 1 || tick % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
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
        // ~2% chance per attempt to clear the ruins (developer demolition takes time)
        if (Math.random() < SIMULATION.BURNED_CLEARANCE_CHANCE) {
          grid.setCell(x, y, { buildingId: 0, reserved: 0 });
          changed = true;
          this.onBuildingRemoved?.(x, y);
        }
        continue;
      }

      // Abandoned buildings: slightly faster auto-clearance (~3%)
      if (cell.reserved === ABANDONED && isZoneBuilding(cell.buildingId)) {
        if (Math.random() < SIMULATION.ABANDONED_CLEARANCE_CHANCE) {
          grid.setCell(x, y, { buildingId: 0, reserved: 0 });
          this.abandonmentStress.delete(`${x},${y}`);
          changed = true;
          this.onBuildingRemoved?.(x, y);
        }
        continue;
      }

      if (cell.buildingId === 0) {
        // Check district policy restrictions
        const district = this.state.districts.getDistrictAt(x, y);
        if (district && !this.state.policies.canBuildInDistrict(district.id, cell.zoneType)) {
          continue; // Policy blocks this zone type in this district
        }
        // Check power/water for this specific cell
        conditions.hasPower = this.state.power.isPowered(x, y);
        conditions.hasWater = this.state.water.isSupplied(x, y);
        if (growth.tryGrow(x, y, conditions)) {
          changed = true;
          // Read back the grown cell to get level info
          const grown = grid.getCell(x, y);
          if (grown) {
            const level = getBuildingType(grown.buildingId)?.level ?? 1;
            this.onBuildingAdded?.(x, y, cell.zoneType, level);
          }
        }
      }
    }
    if (changed) this.onBuildingsChanged?.();
  }

  private runMigration(): void {
    const pop = this.state.citizens.getPopulation();
    // Use actual average citizen happiness; empty city gets default 70
    const avgHappiness = pop > 0
      ? this.state.citizens.getAverageHappiness()
      : SIMULATION.DEFAULT_HAPPINESS;
    // Calculate unemployment rate: fraction of working-age citizens without a job
    const citizens = this.state.citizens.getCitizens();
    const workingAge = citizens.filter(c => isWorkingAge(c.age));
    const unemploymentRate = workingAge.length > 0
      ? workingAge.filter(c => c.workplaceId === null).length / workingAge.length
      : 0;

    const city = {
      jobOpenings: this.countJobOpenings(),
      vacantHomes: this.countVacantHomes(),
      avgHappiness,
      taxRate: this.state.taxRates.residential ?? 9,
      pollution: this.getAvgPollution(),
      crimeRate: this.getAvgCrime(),
      unemploymentRate,
    };
    const { emigratedIds } = migrationTick(this.state.citizens, city, pop);
    for (const id of emigratedIds) {
      this.commuteCache.remove(id);
    }
  }

  private updateCitizenHappiness(): void {
    const taxRate = this.state.taxRates.residential ?? 9;
    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Calculate city-wide happiness context (SRP: pure calculation in CityHappinessContext)
    const citizens = this.state.citizens.getCitizens();
    const ctx = calculateCityHappinessContext({
      totalJobs: this.countTotalJobs(),
      adultCount: citizens.filter(c => isWorkingAge(c.age)).length,
      avgPollution: this.getAvgPollution(),
      avgNoise: this.getAvgNoise(),
      avgCrime: this.getAvgCrime(),
      residentialBuildingCount: countZoneBuildings(this.state.grid, isResidentialZone),
      serviceRatios: this.getServiceRatios(),
    });

    // Check if any parks exist for happiness bonus
    const hasParkCoverage = this.state.parks.getParks().length > 0;

    for (const citizen of citizens) {
      // Vary commute per citizen (+/- 3 random jitter)
      const commute = Math.max(1, ctx.avgCommute + (Math.random() * SIMULATION.COMMUTE_JITTER - SIMULATION.COMMUTE_JITTER / 2));

      // Check if citizen's home has power and water
      let homePowered = true;
      let homeWatered = true;
      if (citizen.homeId) {
        const pos = parsePosKey(citizen.homeId);
        if (pos) {
          homePowered = this.state.power.isPowered(pos.x, pos.y);
          homeWatered = this.state.water.isSupplied(pos.x, pos.y);
        }
      }

      // Get workplace zone type for job mismatch penalty
      let workplaceZoneType: ZoneType | undefined;
      if (citizen.workplaceId) {
        const wpos = parsePosKey(citizen.workplaceId);
        if (wpos) {
          const wcell = this.state.grid.getCell(wpos.x, wpos.y);
          if (wcell) workplaceZoneType = wcell.zoneType;
        }
      }

      const factors: HappinessFactors = {
        commuteDistance: commute,
        hasPark: hasParkCoverage,
        pollution: ctx.avgPollution,
        noiseLevel: ctx.avgNoise,
        crimeRate: ctx.avgCrime,
        isEmployed: !isWorkingAge(citizen.age) || Math.random() < ctx.employmentRate,
        taxRate,
        serviceCoverage: ctx.serviceCoverage,
        currentTick: this.state.clock.tick,
        homePowered,
        homeWatered,
        workplaceZoneType,
      };
      citizen.happiness = calculateHappiness(citizen, factors);
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
    });
  }

  private countRoadTiles(): number {
    return countRoadTiles(this.state.grid);
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
    if (changed) this.onBuildingsChanged?.();
  }

  private updatePollution(): void {
    const grid = this.state.grid;
    const pm = this.state.pollution;

    pm.clearSources();

    // Collect pollution sources from all providers via DIP registry
    const gridProvider = { getPollutionSources: () => getGridPollutionSources(grid) };
    const overflowProvider = { getPollutionSources: () => this.state.garbage.getOverflowPollutionSources() };
    const allSources = collectAllPollutionSources([
      gridProvider,
      this.state.garbage,
      this.state.sewage,
      this.state.airport,
      overflowProvider,
    ]);
    for (const src of allSources) {
      pm.addSource(src.x, src.y, src.amount, src.type);
    }

    pm.calculateSpread();

    // Write pollution back to grid cells
    grid.forEachCell((cell, x, y) => {
      const p = pm.getPollutionAt(x, y);
      const total = Math.min(SIMULATION.CELL_VALUE_MAX, p.ground + p.noise);
      if (cell.pollution !== total) {
        grid.setCell(x, y, { pollution: total });
      }
    });
  }

  private updateLandValue(): void {
    const grid = this.state.grid;

    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId === 0) return;

      const pollution = this.state.pollution.getPollutionAt(x, y);
      const serviceCoverage = getCellServiceScore(this.state, x, y);

      // Check if near water, forest (natural park), or placed park within 2 cells
      let waterfront = false;
      for (const [dx, dy] of FOUR_NEIGHBORS) {
        const nc = grid.getCell(x + dx!, y + dy!);
        if (nc && nc.terrainType === TerrainType.WATER) waterfront = true;
      }
      const parkProximity = checkParkProximity(
        (px, py) => grid.getCell(px, py),
        x, y,
        this.state.parks.getCoverage(x, y),
        getInfraBuildingId('park'),
      );

      // Industrial zones are less affected by their own pollution
      const pollutionFactor = cell.zoneType === ZoneType.INDUSTRIAL ? SIMULATION.INDUSTRIAL_POLLUTION_FACTOR : 1;
      const value = calculateLandValue({
        serviceCoverage,
        parkProximity,
        waterfront,
        pollution: pollution.ground * pollutionFactor,
        noise: pollution.noise * pollutionFactor,
        crimeRate: this.getAvgCrime(),
      });

      // Write land value, service coverage, and noise to grid
      const updates: Record<string, number> = {};
      if (cell.landValue !== value) updates.landValue = value;
      if (cell.serviceCoverage !== serviceCoverage) updates.serviceCoverage = serviceCoverage;
      const noiseVal = Math.min(SIMULATION.CELL_VALUE_MAX, Math.round(pollution.noise));
      if (cell.noiseLevel !== noiseVal) updates.noiseLevel = noiseVal;
      if (Object.keys(updates).length > 0) {
        grid.setCell(x, y, updates);
      }
    });
  }

  private tryBuildingUpgrades(): void {
    const grid = this.state.grid;
    const upgrade = this.state.buildingUpgrade;
    let changed = false;

    // Sample cells each tick rather than scanning all (performance)
    const attempts = 30;
    for (let i = 0; i < attempts; i++) {
      const x = randomInt(grid.width);
      const y = randomInt(grid.height);
      const cell = grid.getCell(x, y);
      if (!cell || cell.buildingId === 0) continue;

      const pollution = this.state.pollution.getPollutionAt(x, y);
      // Count service types: power, water, road-based services, + bonus for low pollution/crime
      let serviceCoverageCount = getCellServiceScore(this.state, x, y);
      if (pollution.ground < 10) serviceCoverageCount += 1; // clean air bonus
      if (this.getAvgCrime() < 15) serviceCoverageCount += 1; // low crime bonus

      const conditions = {
        serviceCoverageCount,
        landValue: cell.landValue,
        crimeRate: this.getAvgCrime(),
        pollution: pollution.ground,
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
    if (changed) this.onBuildingsChanged?.();
  }

  /**
   * Process abandonment stress for all active buildings.
   * Scans grid directly (decoupled from buildingPositions used by housing assignment).
   * Each building has a deterministic resilience factor (0.5–1.5) based on
   * position hash, so buildings abandon at different rates under same conditions.
   */
  private processAbandonmentStress(): void {
    const grid = this.state.grid;
    const businessTax = this.state.taxRates.business ?? 9;
    const resTax = this.state.taxRates.residential ?? 9;
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
      const svc = (ratio: number) => ratio < 0 ? 0 : 1 - ratio; // -1=uncovered→0, 0=nearest→1, 1=farthest→0
      const serviceScore =
        (this.state.power.isPowered(x, y) ? 2 : 0) +
        (this.state.water.isSupplied(x, y) ? 2 : 0) +
        svc(this.state.police.getCostRatio(x, y)) +
        svc(this.state.fire.getCostRatio(x, y)) +
        svc(this.state.garbage.getCostRatio(x, y)) +
        svc(this.state.health.getCostRatio(x, y)) +
        svc(this.state.education.getCostRatio(x, y)) +
        svc(this.state.deathCare.getCostRatio(x, y));

      const conditions: AbandonmentConditions = {
        businessTaxRate: businessTax,
        residentialTaxRate: resTax,
        isPowered: this.state.power.isPowered(x, y),
        isWatered: this.state.water.isSupplied(x, y),
        crimeRate: localCrime,
        pollution: pollution.ground,
        buildingLevel: building.level,
        serviceScore,
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

    if (changed) this.onBuildingsChanged?.();
  }

  /** Get the abandonment stress for a building at (x, y). */
  getAbandonmentStress(x: number, y: number): number {
    return this.abandonmentStress.get(`${x},${y}`) ?? 0;
  }

  /** Clear abandonment stress for a building (e.g., after demolish). */
  clearBuildingState(x: number, y: number): void {
    this.abandonmentStress.delete(`${x},${y}`);
  }

  /**
   * Rebuild the building position list.
   * Scans all active zone buildings (excludes ABANDONED/BURNED).
   * Called every slow tick — 3600 cells is negligible, no caching needed.
   */
  private rebuildBuildingIndex(): void {
    this.buildingPositions = [];
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
    const workingAgeCitizens = citizens.filter((c) => isWorkingAge(c.age));

    // Build reachability map: homeId → Set of reachable workplace positions
    // Group unassigned citizens by homeId to avoid duplicate Dijkstra calls
    const reachable = this.buildWorkplaceReachability(workingAgeCitizens, workplaceCandidates);
    assignWorkWithPreference(workingAgeCitizens, workplaceCandidates, workOccupancy, reachable);

    // Then assign housing with preference scoring
    const homeOccupancy = countOccupancy(citizens, (c) => c.homeId);
    assignWithPreference(citizens, housingCandidates, homeOccupancy);

    // Update occupancy ratios for rendering
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

    const { relocatedIds } = jobRelocationTick(
      citizens,
      workplaceCandidates,
      workOccupancy,
      this.commuteCache,
      this.state.grid,
      this.state.clock.tick,
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


  markLaneGraphDirty(affectedCells?: string[]): void {
    this.laneGraphDirty = true;
    this.sidewalkGraphDirty = true;
    this.tripPoolDirty = true;
    this.commuteCache.bumpGeneration();
    if (affectedCells) {
      if (!this.dirtyRoadCells) this.dirtyRoadCells = new Set();
      for (const cellKey of affectedCells) {
        this.commuteCache.invalidateCell(cellKey);
        this.dirtyRoadCells.add(cellKey);
      }
      // Invalidate pedestrian path cache for affected cells
      this.state.pedestrianManager.invalidateCells(affectedCells);
      // Immediately check if affected citizens can still reach their workplace
      this.immediateUnreachableJobCheck(affectedCells);
    }
  }

  /**
   * When roads are cut, immediately unemploy citizens whose workplace
   * is no longer reachable from home (don't wait for jobRelocationTick).
   * Checks ALL employed citizens, using a cache to avoid redundant Dijkstra calls
   * for citizens sharing the same home→workplace pair.
   */
  private immediateUnreachableJobCheck(_affectedCells: string[]): void {
    const citizens = this.state.citizens.getCitizens();
    const grid = this.state.grid;
    const tick = this.state.clock.tick;

    // Cache: "homeId->workplaceId" → reachable?
    const reachCache = new Map<string, boolean>();

    for (const citizen of citizens) {
      if (!citizen.workplaceId || !citizen.homeId || !isWorkingAge(citizen.age)) continue;

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
    const cellKeys: string[] = [];
    const gridLookup = {
      getCell: (x: number, y: number) => {
        const cell = grid.getCell(x, y);
        if (!cell) return null;
        return { roadType: cell.roadType as RoadType, roadFlags: cell.roadFlags };
      },
    };

    grid.forEachCell((cell, x, y) => {
      if (cell.roadType !== RoadType.NONE) {
        cellKeys.push(toPosKey(x, y));
      }
    });

    this.laneGraph.buildFromGrid(gridLookup, cellKeys);

    const lg = this.laneGraph;
    const g = { getCell: (x: number, y: number) => grid.getCell(x, y), width: grid.width, height: grid.height };
    const findPath = (fx: number, fy: number, tx: number, ty: number) => gridAStarPath({ x: fx, y: fy }, { x: tx, y: ty }, g);
    const refine = (cellPath: string[]) => refineLanePath(lg, cellPath);

    // Rebuild segments for routes loaded from save (no segments yet)
    this.state.bus.rebuildAllSegments(findPath, refine, this.state.traffic, grid);

    // Revalidate bus routes affected by road changes
    if (this.dirtyRoadCells && this.dirtyRoadCells.size > 0) {
      this.state.bus.onRoadChanged(
        this.dirtyRoadCells,
        findPath,
        refine,
        this.state.traffic,
        grid,
      );
      this.dirtyRoadCells = null;
    }
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

    const timeOfDay = this.state.clock.getTimeOfDay();

    // Clear commuter tracking on period transitions
    if (timeOfDay !== this.lastTimeOfDay) {
      if (timeOfDay === 'morning_rush') this.morningCommuters.clear();
      if (timeOfDay === 'evening_rush') this.eveningCommuters.clear();
      this.tripPoolDirty = true; // Rebuild trip pool each rush period
      this.lastTimeOfDay = timeOfDay;
    }

    const grid = this.state.grid;

    if (timeOfDay === 'morning_rush') {
      // Morning rush: citizens commute home → work
      this.spawnCommuteVehicles('home_to_work', grid, vehicleCap);
    } else if (timeOfDay === 'evening_rush') {
      // Evening rush: citizens commute work → home
      this.spawnCommuteVehicles('work_to_home', grid, vehicleCap);
    } else if (timeOfDay === 'midday') {
      // Midday: spawn small amount of random commercial traffic
      this.spawnRandomTraffic(grid, vehicleCap);
    }

    // Build/update trip pool during rush hours
    if (timeOfDay === 'morning_rush' || timeOfDay === 'evening_rush') {
      this.spawnPedestriansFromPool(pop);
      this.state.pedestrianManager.setDensityMultiplier(1.0);
    } else if (timeOfDay === 'midday') {
      this.state.pedestrianManager.setDensityMultiplier(0.3);
    } else {
      // night
      this.state.pedestrianManager.setDensityMultiplier(0.05);
    }
    // Per-frame refill (in Game.ts) uses the last trip pool continuously
  }


  /**
   * Spawn commute vehicles for citizens based on direction.
   * homeId/workplaceId are "x,y" position strings.
   */
  private spawnCommuteVehicles(
    direction: 'home_to_work' | 'work_to_home',
    grid: { getCell(x: number, y: number): { roadType: number } | null; width: number; height: number },
    vehicleCap: number,
  ): void {
    const commuterSet = direction === 'home_to_work' ? this.morningCommuters : this.eveningCommuters;

    // Get eligible citizens: adults (19-65) with both homeId and workplaceId
    const eligible = this.state.citizens.getCitizens().filter(
      c => isWorkingAge(c.age) &&
           c.homeId !== null && c.workplaceId !== null &&
           !commuterSet.has(c.id)
    );

    if (eligible.length === 0) return;

    // Spawn enough vehicles per tick so all eligible commuters depart within the rush period (~4 ticks).
    // BFS is bounded to 500 steps so each call is cheap.
    const maxPerTick = Math.max(SIMULATION.MIN_SPAWN_PER_TICK, Math.ceil(eligible.length / SIMULATION.RUSH_TICKS));
    let spawned = 0;

    for (const citizen of eligible) {
      if (spawned >= maxPerTick) break;
      if (this.state.traffic.getVehicleCount() >= vehicleCap) break;

      const fromStr = direction === 'home_to_work' ? citizen.homeId! : citizen.workplaceId!;
      const toStr = direction === 'home_to_work' ? citizen.workplaceId! : citizen.homeId!;

      const fromPos = parsePosKey(fromStr);
      const toPos = parsePosKey(toStr);
      if (!fromPos || !toPos) {
        commuterSet.add(citizen.id);
        continue;
      }
      if (fromPos.x === toPos.x && fromPos.y === toPos.y) {
        commuterSet.add(citizen.id);
        continue;
      }

      // --- Transport mode choice ---
      const availableTransport = this.getAvailableTransit(fromPos, toPos);
      const congestion = this.state.traffic.getCongestionLevel();
      const mode = chooseMode(fromPos, toPos, availableTransport, congestion);

      if (mode !== TransportMode.DRIVE) {
        // Walk or transit — no car vehicle needed
        commuterSet.add(citizen.id);

        // Collect walking trips for pedestrian spawning (trip pool)
        if (this.tripPoolDirty) {
          if (mode === TransportMode.WALK) {
            this.pendingTrips.push({
              fromX: fromPos.x, fromY: fromPos.y,
              toX: toPos.x, toY: toPos.y,
              tripType: PedestrianTripType.FULL_WALK, count: 1,
            });
          } else {
            // BUS/RAIL/METRO/FERRY: first-mile + last-mile walking trips
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

        // Add waiting passenger at the nearest transit stop
        const transitSystem = getSystemForMode(this.state, mode);
        if (transitSystem) {
          const nearest = this.findNearestStop(transitSystem.getStops(), fromPos);
          if (nearest) nearest.passengers++;
        }

        continue;
      }

      // --- Check commute cache first ---
      const isMorning = direction === 'home_to_work';
      const cached = this.commuteCache.get(citizen.id);
      const currentTick = this.state.clock.tick;

      if (cached && cached.status === 'ready'
          && !this.commuteCache.isDirty(citizen.id)
          && !this.commuteCache.isExpired(cached, currentTick)) {
        const cachedPath = isMorning ? cached.morningPath : cached.eveningPath;
        if (cachedPath && cachedPath.length > 0) {
          this.state.traffic.addVehicleOnEdges(cachedPath);
          commuterSet.add(citizen.id);
          spawned++;
          continue;
        }
      }

      // --- Compute path and populate cache ---
      const routeKey = `${fromStr}->${toStr}`;
      let variants = this.commuteCache.getRouteVariants(routeKey) ?? null;

      if (!variants) {
        const path = findRoadPath(fromPos, toPos, grid);
        if (path && path.length >= 2) {
          variants = refineLanePathVariants(this.laneGraph, path);
          if (variants.length > 0) {
            this.commuteCache.setRouteVariants(routeKey, variants);
          }
        }
      }

      // Pick a random variant to distribute vehicles across lanes
      const edgePath = variants && variants.length > 0
        ? variants[Math.floor(Math.random() * variants.length)]!
        : null;

      if (edgePath && edgePath.length > 0) {
        this.state.traffic.addVehicleOnEdges(edgePath);

        // Build or update the citizen's cached route
        const existingRoute = this.commuteCache.get(citizen.id);
        // If roads changed since the last cache, clear the other direction too
        // so it gets recalculated on its next use (prevents permanently stale paths)
        const isRoadChange = existingRoute != null && existingRoute.generation !== this.commuteCache.roadGeneration;
        const cachedRoute: CachedRoute = {
          citizenId: citizen.id,
          homeId: citizen.homeId!,
          workplaceId: citizen.workplaceId!,
          morningPath: isMorning ? edgePath : (isRoadChange ? null : (existingRoute?.morningPath ?? null)),
          eveningPath: isMorning ? (isRoadChange ? null : (existingRoute?.eveningPath ?? null)) : edgePath,
          status: 'ready',
          generation: this.commuteCache.roadGeneration,
        };
        this.commuteCache.set(citizen.id, cachedRoute);

        commuterSet.add(citizen.id);
        spawned++;
      } else {
        // No path found — cache as failed to avoid re-searching
        this.commuteCache.set(citizen.id, {
          citizenId: citizen.id,
          homeId: citizen.homeId!,
          workplaceId: citizen.workplaceId!,
          morningPath: null,
          eveningPath: null,
          status: 'failed',
          generation: this.commuteCache.roadGeneration,
        });
        commuterSet.add(citizen.id);
      }
    }
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
    const systems = getTransitSystems(this.state).map(({ type, system }) => ({
      type,
      routes: system.getRoutes(),
    }));
    return findAvailableTransit(systems, origin, destination, SIMULATION.WALK_TO_STOP_RANGE, SIMULATION.RAIL_TRANSIT_TIME_FACTOR);
  }

  /**
   * Spawn a small amount of random traffic during midday hours.
   */
  private spawnRandomTraffic(
    grid: { getCell(x: number, y: number): { roadType: number; buildingId: number; zoneType: number } | null; width: number; height: number },
    vehicleCap: number,
  ): void {
    const pop = this.state.citizens.getPopulation();
    // Very small amount: 1 per tick if pop > 50
    const spawnCount = pop >= 50 ? 1 : 0;
    if (spawnCount === 0) return;

    const roads: { x: number; y: number }[] = [];
    const commercialCells: { x: number; y: number }[] = [];

    grid.forEachCell((cell, x, y) => {
      if (cell.roadType !== RoadType.NONE) roads.push({ x, y });
      if (cell.buildingId > 0 && isCommercialZone(cell.zoneType as ZoneType)) {
        commercialCells.push({ x, y });
      }
    });

    if (roads.length < 2) return;
    const startPool = commercialCells.length > 0 ? commercialCells : roads;

    for (let i = 0; i < spawnCount; i++) {
      if (this.state.traffic.getVehicleCount() >= vehicleCap) break;
      const start = randomElement(startPool);
      const end = randomElement(roads);
      if (start.x === end.x && start.y === end.y) continue;

      const path = findRoadPath(start, end, grid);
      if (path && path.length >= 2) {
        const edgePath = refineLanePath(this.laneGraph, path);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addVehicleOnEdges(edgePath);
        }
      }
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
    );
  }

  /**
   * Compute predicted congestion flow using cached route reference counts.
   * Falls back to Monte Carlo sampling when cache coverage is too low.
   */
  private computeCongestionFlow(): void {
    const grid = this.state.grid;
    const flowMap = new Map<string, number>();

    // Primary: use cached routes with refCounts — O(routes × avg path length), zero A*
    let totalRoutedCitizens = 0;
    this.commuteCache.forEachRouteWithRefCount((path, refCount) => {
      totalRoutedCitizens += refCount;
      for (const cellKey of collectEdgeCells(path)) {
        flowMap.set(cellKey, (flowMap.get(cellKey) ?? 0) + refCount);
      }
    });

    // Fallback: if cache coverage is too low, use Monte Carlo sampling
    if (totalRoutedCitizens < SIMULATION.SAMPLE_COUNT_MIN) {
      this.computeCongestionFlowMonteCarlo(flowMap);
    }

    // Normalize by lane count
    for (const [cellKey, rawFlow] of flowMap) {
      const { x, y } = parsePosKeyUnsafe(cellKey);
      const cell = grid.getCell(x, y);
      const lanes = cell ? getLaneCount(cell.roadType) : 1;
      flowMap.set(cellKey, rawFlow / lanes);
    }

    this.state.traffic.updatePredictedFlow(flowMap);
  }

  /** Monte Carlo fallback for congestion prediction when cache coverage is too low. */
  private computeCongestionFlowMonteCarlo(flowMap: Map<string, number>): void {
    const grid = this.state.grid;
    const pools = buildODPools(this.state.citizens.getCitizens(), parsePosKeyUnsafe);
    if (!pools) return;

    const { residential, destinations, totalResWeight, totalDestWeight } = pools;
    const sampleCount = Math.max(SIMULATION.SAMPLE_COUNT_MIN, Math.min(SIMULATION.SAMPLE_COUNT_MAX, Math.ceil(totalResWeight / SIMULATION.SAMPLE_DIVISOR)));

    for (let i = 0; i < sampleCount; i++) {
      const from = pickWeighted(residential, totalResWeight, e => e.weight);
      const to = pickWeighted(destinations, totalDestWeight, e => e.weight);
      if (from.x === to.x && from.y === to.y) continue;

      const manhattan = manhattanDistance(from.x, from.y, to.x, to.y);
      if (manhattan <= 3) continue;

      const availableTransport = this.getAvailableTransit(from, to);
      const mode = chooseMode(from, to, availableTransport, 0);
      if (mode !== TransportMode.DRIVE) continue;

      const path = findRoadPath(from, to, grid);
      if (!path) continue;

      for (const cellKey of path) {
        flowMap.set(cellKey, (flowMap.get(cellKey) ?? 0) + 1);
      }
    }

    // Scale up sampled flow to match actual commuter volume
    const scaleFactor = totalResWeight / sampleCount;
    for (const [cellKey, rawFlow] of flowMap) {
      flowMap.set(cellKey, rawFlow * scaleFactor);
    }
  }

  /**
   * Build the walking trip pool from pending trips (aggregated),
   * then spawn pedestrians by weighted random sampling.
   */
  private spawnPedestriansFromPool(population: number): void {
    // Finalize trip pool if it was being rebuilt this rush period
    if (this.tripPoolDirty && this.pendingTrips.length > 0) {
      // Aggregate identical routes
      const tripMap = new Map<string, AggregatedTrip>();
      for (const t of this.pendingTrips) {
        const key = `${t.fromX},${t.fromY}→${t.toX},${t.toY}`;
        const existing = tripMap.get(key);
        if (existing) {
          existing.count += t.count;
        } else {
          tripMap.set(key, { ...t });
        }
      }
      this.walkingTripPool = buildTripPool([...tripMap.values()]);
      this.pendingTrips = [];
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

// countResidentialCapacity and countWorkplaceJobs moved to BuildingQueries.ts
// Re-export for backward compatibility with existing consumers
export { countResidentialCapacity, countWorkplaceJobs } from '../building/BuildingQueries';

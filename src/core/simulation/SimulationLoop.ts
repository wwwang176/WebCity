import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand, applyBusinessTaxPenalty, BUSINESS_TAX } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';
import { birthTick } from '../citizen/Birth';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue, checkParkProximity } from '../economy/LandValue';
import { ZoneType, TerrainType, isResidentialZone, isCommercialZone, zoneToRCI } from '../grid/types';
import { RoadType } from '../road/types';
import { getLaneCount } from '../traffic/TrafficSimulation';
import { LaneGraph } from '../traffic/LaneGraph';
import { refineLanePath, refineLanePathVariants, gridAStarPath } from '../traffic/Pathfinding';
import { buildSimpleEdgePath, hasElevatedKeys } from '../traffic/ElevatedLanePath';
import { CommuteCache, type CachedRoute } from '../traffic/CommuteCache';
import { collectEdgeCells } from '../traffic/CommuteCacheHelpers';
import { getBuildingType } from '../building/types';
import { avgEducationScore } from '../building/BuildingUpgrade';
import { clampBuildingLevel } from '../building/BuildingLevel';
import { ECONOMY } from '../economy/TaxMultipliers';
import { DEFAULT_TAX_RATE } from '../economy/Tax';
import { getInfraBuildingId, isZoneBuilding } from '../building/InfraConfig';
import { countZoneBuildings, countResidentialCapacity, countWorkplaceJobs } from '../building/BuildingQueries';
import { forEachGridPollutionSource } from '../environment/GridPollutionSources';
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
import { jobRelocationTick, DEFAULT_JOB_RELOCATION_CONFIG } from '../citizen/JobRelocation';
import { roadDistanceToTargets } from '../service/RoadCoverageFlood';
import type { SchoolType } from '../service/EducationService';
import type { EducationRule } from '../citizen/CitizenManager';
import { TimeOfDay } from './GameClock';
import { chooseMode, type AvailableTransport } from '../transport/ModeChoice';
import { calculateCitizenHealth, type HealthFactors } from '../citizen/CitizenHealth';
import { TransportMode } from '../transport/types';
import { getSystemForMode, getTransitSystems, getTotalTransportOperatingCost, tickAllTransportSystems } from '../transport/TransportRegistry';
import { getTotalServiceMaintenanceCost, tickAllCivicServices } from '../service/ServiceRegistry';
import { parsePosKey, parsePosKeyUnsafe, toPosKey, FOUR_NEIGHBORS, manhattanDistance, countRoadTiles, findAdjacentRoad } from '../grid/GridHelpers';
import type { ResidentialShoppingStatus } from '../economy/ShoppingAccess';
import { applyFireDamage } from '../service/FireDamageProcessor';
import { getCellServiceScore, getResidentialServiceRatios } from '../service/ServiceCoverageQuery';
import { getAvgResidentialPollution, getAvgResidentialNoise, calculateCrimeRate } from '../environment/CityMetrics';
import { calculateZoneIncomes } from '../economy/IncomeCalculator';
import { buildIncomeCalcDeps } from '../economy/IncomeCalcAdapter';
import { calculateDistrictPolicyCost, calculateTotalExpenses } from '../economy/ExpenseCalculator';
import { calculateElevatedMaintenance } from '../elevation/ElevationMaintenance';
import { randomInt, randomElement, pickWeighted } from '../utils/random';
import { buildODPools } from '../traffic/ODPoolBuilder';
import { findAvailableTransit } from '../transport/TransitAvailability';
import { findRoadPath } from '../traffic/RoadPathfinding';
import { ServiceVehicleManager, type ServiceFacilityProvider, type ServiceVehicleType } from '../traffic/ServiceVehicleManager';
import { SidewalkGraph } from '../traffic/SidewalkGraph';
import { PedestrianManager, getMaxPedestrians, buildTripPool, sampleTrip, type AggregatedTrip, type WalkingTripPool } from '../traffic/PedestrianManager';
import { PedestrianTripType } from '../traffic/PedestrianAgent';
import { TRADE, FreightRouteType } from '../traffic/FreightSystem';
import { HIGHWAY_EXTERNAL } from '../traffic/HighwayConnection';

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
  /** Default happiness used when city has no citizens */
  DEFAULT_HAPPINESS: 70,
  /** Business tax baseline — penalty applies above this rate */
  BUSINESS_TAX_BASELINE: DEFAULT_TAX_RATE,
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
  /** Export demand base value for RCI calculation */
  EXPORT_DEMAND: 10,
  /** Fallback resident count when building type lookup fails */
  FALLBACK_RESIDENTS: 8,
  /** Population threshold before shopping access affects happiness */
  SHOPPING_POP_THRESHOLD: 50,
  /** Number of random cells sampled per upgrade tick */
  UPGRADE_ATTEMPTS: 30,
  /** Pedestrian density multiplier during midday */
  PEDESTRIAN_DENSITY_MIDDAY: 0.3,
  /** Pedestrian density multiplier during night */
  PEDESTRIAN_DENSITY_NIGHT: 0.05,
  /** Fraction of vehicle cap reserved for freight */
  FREIGHT_CAP_RATIO: 0.15,
  /** Divisor for freight activity to spawn count */
  FREIGHT_ACTIVITY_DIVISOR: 20,
  /** Population divisor for max freight trucks */
  FREIGHT_POP_DIVISOR: 2000,
  /** Freight max trucks from population component */
  FREIGHT_MAX_FROM_POP: 10,
  /** Freight base trucks from population */
  FREIGHT_BASE_TRUCKS: 3,
  /** Minimum Manhattan distance for commute trip */
  MANHATTAN_DISTANCE_THRESHOLD: 3,
  /** Highway external: incoming ratio during morning rush */
  HIGHWAY_MORNING_INCOMING: 0.6,
  /** Highway external: incoming ratio during evening rush */
  HIGHWAY_EVENING_INCOMING: 0.4,
  /** Abandonment: service normalization max (residential) */
  SERVICE_MAX_RES: 10,
  /** Abandonment: service normalization max (non-residential) */
  SERVICE_MAX_NON_RES: 6,
} as const;

// clampBuildingLevel re-exported from shared module for backward compatibility
export { clampBuildingLevel } from '../building/BuildingLevel';

/** Map CitizenManager schoolKey to EducationService SchoolType */
const SCHOOL_KEY_TO_TYPE: Record<EducationRule['schoolKey'], SchoolType> = {
  elementary: 'elementary',
  highSchool: 'highschool',
  university: 'university',
};

export class SimulationLoop {
  private state: GameState;
  private _elevationManager: import('../elevation/ElevationManager').ElevationManager | null = null;
  private lastDeathDay = -1;
  private lastBirthMonth = -1;
  private lastRiderDay = -1;

  // Lane-level connection graph for edge-based vehicle movement
  laneGraph: LaneGraph = new LaneGraph();
  private laneGraphDirty = true;

  // Building index: active zone buildings (excludes ABANDONED/BURNED). Rebuilt every slow tick.
  private buildingPositions: { pos: string; x: number; y: number; buildingId: number }[] = [];

  // Cached trade positions (rail stations + airports + highway edges) for freight vehicle spawning.
  private cachedTradePositions: { x: number; y: number }[] = [];

  // Track which citizens have already commuted this rush period
  private morningCommuters = new Set<number>(); // citizen ids that have spawned morning commute
  private eveningCommuters = new Set<number>(); // citizen ids that have spawned evening commute
  private lastTimeOfDay: TimeOfDay = TimeOfDay.NIGHT;

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

  /** Reusable Set for infrastructure positions (power/water plants). */
  private infraPositions = new Set<string>();
  /** Reusable scratch array for working-age citizens. */
  private workingAgeScratch: Citizen[] = [];
  /** Reusable Set for congestion flow cell collection. */
  private flowCellSet = new Set<string>();

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

  setElevationManager(em: import('../elevation/ElevationManager').ElevationManager): void {
    this._elevationManager = em;
    this.state.highwayConnection.setElevationManager(em);
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
    // Many operations were tuned for ticksPerDay=4. With ticksPerDay=24 (6x more),
    // we gate slow-update operations to run every 6 ticks to preserve balance.
    const isSlowTick = tick % SIMULATION.SLOW_TICK_INTERVAL === 0;

    // Mark building index dirty each tick so the first caller gets a fresh scan.
    // Subsequent rebuildBuildingIndex() calls within the same tick are no-ops.
    this.buildingIndexDirty = true;

    // 1. Economy: RCI demand (every 6 ticks)
    if (isSlowTick) {
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
    }

    // 2. Budget tick (every 6 ticks to maintain same daily income/expense rate)
    if (isSlowTick) {
      this.state.budget = tickBudget(this.state.budget);
    }

    // 3. Services (power/water coverage) — every 6 ticks
    if (isSlowTick) {
      this.infraPositions.clear();
      for (const p of this.state.power.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
      for (const p of this.state.water.getPlants()) this.infraPositions.add(toPosKey(p.x, p.y));
      // Calculate demand before coverage so supplyRatio is available for budget-drain
      this.state.power.calculateDemand(this.state.grid);
      this.state.power.calculateCoverage(this.state.grid, this.infraPositions);
      this.state.water.calculateDemand(this.state.grid);
      this.state.water.calculateCoverage(this.state.grid, this.infraPositions);
    }

    // 3.5 Civic services tick (every 6 ticks) — OCP: adding services only requires ServiceRegistry update
    if (isSlowTick) {
      tickAllCivicServices(this.state);

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

    // 4.7 Education: upgrade citizen education based on school road-coverage
    if (isSlowTick) {
      const capacity = {
        elementary: this.state.education.getTotalCapacity('elementary'),
        highSchool: this.state.education.getTotalCapacity('highschool'),
        university: this.state.education.getTotalCapacity('university'),
      };
      this.state.citizens.educateTick((x, y, schoolKey) => {
        const type = SCHOOL_KEY_TO_TYPE[schoolKey];
        return this.state.education.getCoverage(x, y, type);
      }, capacity);
    }

    // 5a. Daily: update citizen ages from birthTick + death check
    const currentDay = this.state.clock.getDay();
    if (currentDay !== this.lastDeathDay) {
      this.lastDeathDay = currentDay;
      this.state.citizens.updateAges(this.state.clock.tick);
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

    // 5a2. Daily: roll over transit stop rider counts (aligned with commute cycle)
    if (currentDay !== this.lastRiderDay) {
      this.lastRiderDay = currentDay;
      this.rolloverTransitRiders();
    }

    // 5b. Sync residential capacity gate (before births + migration)
    this.state.citizens.updateResidentialCapacity(countResidentialCapacity(this.state.grid));

    // 5c. Monthly: natural births
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

    // 5.5. Update citizen happiness + health (every 6 ticks)
    if (isSlowTick) {
      this.updateCitizenHappiness();
      this.updateCitizenHealth();
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

    // 7b. Traffic - spawn commute vehicles (every tick)
    this.spawnVehicles();
    // NOTE: trafficLights.tick(dt) is now frame-based, called in Game.ts updateVehiclesAndTransport

    // 7b2. Pedestrian spawning/despawn happens per tick (movement is per-frame in Game.ts)

    // 7c. Service vehicles — patrol within coverage areas (every 6 ticks)
    if (isSlowTick) {
      this.tickServiceVehicles();
    }

    // 8. Transport systems (every tick — OCP: adding systems only requires TransportRegistry update)
    this.state.bus.congestionLevel = this.state.traffic.getCongestionLevel();
    tickAllTransportSystems(this.state);

    // 8b. Rail + highway external connection update (every 60 ticks)
    if (tick % SIMULATION.MEDIUM_TICK_INTERVAL === 0) {
      this.state.rail.updateExternalConnection(this.state.grid.width, this.state.grid.height, this.state.grid);
      this.state.highwayConnection.updateExternalConnection(this.state.grid.width, this.state.grid.height, this.state.grid);
    }

    // 8c. Freight: BFS-based supply + trade calculation (every 6 ticks)
    if (isSlowTick) {
      // Calculate trade throughput from rail stations + airports
      const railThroughput = this.state.rail.hasExternalConnection
        ? this.state.rail.getExternalStationCount() * TRADE.RAIL_THROUGHPUT_PER_STATION
        : 0;
      let airportThroughput = 0;
      const tradePositions: { x: number; y: number }[] = [];
      // Collect external rail station positions
      if (this.state.rail.hasExternalConnection) {
        for (const s of this.state.rail.getStations()) {
          if (this.state.rail.isStationExternal(s.x, s.y)) {
            tradePositions.push({ x: s.x, y: s.y });
          }
        }
      }
      // Collect airport positions
      for (const ap of this.state.airport.getAirports()) {
        airportThroughput += ap.cargoPerTick;
        tradePositions.push({ x: ap.x, y: ap.y });
      }
      // Collect edge highway positions
      let highwayThroughput = 0;
      if (this.state.highwayConnection.hasExternalConnection) {
        highwayThroughput = this.state.highwayConnection.getThroughput();
        for (const cell of this.state.highwayConnection.getEdgeHighwayCells()) {
          tradePositions.push({ x: cell.x, y: cell.y });
        }
      }
      const totalThroughput = railThroughput + airportThroughput + highwayThroughput;

      this.state.freight.calculateSupply(this.state.grid, {
        importCapacity: totalThroughput,
        exportCapacity: totalThroughput,
        tradePositions,
      });
      this.cachedTradePositions = tradePositions;

      // 8d. Shopping access: BFS from commercial to residential (every 6 ticks)
      this.state.shopping.calculate(this.state.grid);
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

    pm.clearSources();

    // Add pollution sources directly (no intermediate arrays)
    forEachGridPollutionSource(grid, (x, y, amount, type) => pm.addSource(x, y, amount, type));
    // OCP: service-based pollution sources via registry — adding new sources only needs registry update
    forEachServicePollutionSource(this.state, (x, y, amount, type) => pm.addSource(x, y, amount, type));

    pm.calculateSpread();

    // Write pollution back to grid cells (single-field write, no object allocation)
    grid.forEachCell((cell, x, y) => {
      const p = pm.getPollutionAt(x, y);
      const total = Math.min(SIMULATION.CELL_VALUE_MAX, p.ground + p.noise);
      if (cell.pollution !== total) {
        grid.setField(x, y, 'pollution', total);
      }
    });
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
        pollution: pollution.ground * pollutionFactor,
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
        pollution: pollution.ground,
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


  /** Immediately remove service vehicles of a given type (e.g. when facility demolished). */
  removeServiceVehicles(serviceType: ServiceVehicleType): void {
    this.serviceVehicleManager.removeAllOfType(this.state.traffic, serviceType);
  }

  markLaneGraphDirty(affectedCells?: string[]): void {
    this.laneGraphDirty = true;
    this.sidewalkGraphDirty = true;
    this.tripPoolDirty = true;
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

    grid.forEachCell((cell, x, y) => {
      if (cell.roadType !== RoadType.NONE) {
        cellKeys.push(toPosKey(x, y));
      }
    });

    const cellKeySet = new Set(cellKeys);
    const gridLookup = {
      getCellByKey(key: string) {
        const { x, y } = parsePosKeyUnsafe(key);
        const cell = grid.getCell(x, y);
        if (!cell || cell.roadType === RoadType.NONE) return null;
        return { roadType: cell.roadType as RoadType, roadFlags: cell.roadFlags };
      },
      getCompatibleNeighborKeys(_sourceKey: string, nx: number, ny: number) {
        const groundKey = toPosKey(nx, ny);
        return cellKeySet.has(groundKey) ? [groundKey] : [];
      },
    };

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

    const timeOfDay = this.state.clock.getTimeOfDay();

    // Clear commuter tracking on period transitions
    if (timeOfDay !== this.lastTimeOfDay) {
      if (timeOfDay === TimeOfDay.MORNING_RUSH) this.morningCommuters.clear();
      if (timeOfDay === TimeOfDay.EVENING_RUSH) this.eveningCommuters.clear();
      this.tripPoolDirty = true; // Rebuild trip pool each rush period
      this.lastTimeOfDay = timeOfDay;
    }

    const grid = this.state.grid;

    if (timeOfDay === TimeOfDay.MORNING_RUSH) {
      // Morning rush: citizens commute home → work
      this.spawnCommuteVehicles('home_to_work', grid, vehicleCap);
    } else if (timeOfDay === TimeOfDay.EVENING_RUSH) {
      // Evening rush: citizens commute work → home
      this.spawnCommuteVehicles('work_to_home', grid, vehicleCap);
    } else if (timeOfDay === TimeOfDay.MIDDAY) {
      // Midday: spawn small amount of random commercial traffic
      this.spawnRandomTraffic(grid, vehicleCap);
    }

    // Spawn external highway traffic (all time periods)
    this.spawnExternalHighwayTraffic(grid, vehicleCap);

    // Spawn freight trucks (industrial↔commercial, factory↔trade, trade↔commercial)
    this.spawnFreightTraffic(grid, vehicleCap);

    // Build/update trip pool during rush hours
    if (timeOfDay === TimeOfDay.MORNING_RUSH || timeOfDay === TimeOfDay.EVENING_RUSH) {
      this.spawnPedestriansFromPool(pop);
      this.state.pedestrianManager.setDensityMultiplier(1.0);
    } else if (timeOfDay === TimeOfDay.MIDDAY) {
      this.state.pedestrianManager.setDensityMultiplier(SIMULATION.PEDESTRIAN_DENSITY_MIDDAY);
    } else {
      // night
      this.state.pedestrianManager.setDensityMultiplier(SIMULATION.PEDESTRIAN_DENSITY_NIGHT);
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

    // Count eligible citizens inline (avoid .filter() array allocation)
    const citizens = this.state.citizens.getCitizens();
    let eligibleCount = 0;
    for (const c of citizens) {
      if (isWorkingAge(c.age) && c.homeId !== null && c.workplaceId !== null && !commuterSet.has(c.id)) {
        eligibleCount++;
      }
    }
    if (eligibleCount === 0) return;

    // Spawn enough vehicles per tick so all eligible commuters depart within the rush period (~4 ticks).
    // BFS is bounded to 500 steps so each call is cheap.
    const maxPerTick = Math.max(SIMULATION.MIN_SPAWN_PER_TICK, Math.ceil(eligibleCount / SIMULATION.RUSH_TICKS));
    let spawned = 0;

    for (const citizen of citizens) {
      if (spawned >= maxPerTick) break;
      if (!isWorkingAge(citizen.age) || citizen.homeId === null || citizen.workplaceId === null || commuterSet.has(citizen.id)) continue;
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
          if (nearest) { nearest.dailyRiders++; }
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
        const path = findRoadPath(fromPos, toPos, grid, this._elevationManager ?? undefined);
        if (path && path.length >= 2) {
          if (hasElevatedKeys(path)) {
            // Elevated path: use simple cell-to-cell edges (no lane graph)
            const simple = buildSimpleEdgePath(path);
            if (simple.length > 0) variants = [simple];
          } else {
            variants = refineLanePathVariants(this.laneGraph, path);
          }
          if (variants && variants.length > 0) {
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
      speed: system.getSpeed(),
      vehicleCapacity: system.getCapacity(),
      routes: system.getRoutes(),
      getSegmentDistances: (routeId: number) => system.getSegmentDistances(routeId),
    }));
    return findAvailableTransit(systems, origin, destination, SIMULATION.WALK_TO_STOP_RANGE);
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

    // Random-probe for road cells instead of full grid scan (spawns only 1 vehicle)
    const maxProbes = 40;
    const w = grid.width;
    const h = grid.height;

    for (let i = 0; i < spawnCount; i++) {
      if (this.state.traffic.getVehicleCount() >= vehicleCap) break;

      // Find a random road cell for start
      let startX = 0, startY = 0, endX = 0, endY = 0;
      let foundStart = false, foundEnd = false;
      for (let p = 0; p < maxProbes; p++) {
        const rx = randomInt(w), ry = randomInt(h);
        const c = grid.getCell(rx, ry);
        if (c && c.roadType !== RoadType.NONE) {
          startX = rx; startY = ry; foundStart = true; break;
        }
      }
      if (!foundStart) return;

      for (let p = 0; p < maxProbes; p++) {
        const rx = randomInt(w), ry = randomInt(h);
        const c = grid.getCell(rx, ry);
        if (c && c.roadType !== RoadType.NONE && (rx !== startX || ry !== startY)) {
          endX = rx; endY = ry; foundEnd = true; break;
        }
      }
      if (!foundEnd) return;

      const path = findRoadPath({ x: startX, y: startY }, { x: endX, y: endY }, grid, this._elevationManager ?? undefined);
      if (path && path.length >= 2) {
        const edgePath = hasElevatedKeys(path)
          ? buildSimpleEdgePath(path)
          : refineLanePath(this.laneGraph, path);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addVehicleOnEdges(edgePath);
        }
      }
    }
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

    // Time-of-day multiplier and direction bias
    const timeOfDay = this.state.clock.getTimeOfDay();
    let multiplier = 1.0;
    let incomingRatio = 0.5;
    switch (timeOfDay) {
      case TimeOfDay.MORNING_RUSH: incomingRatio = SIMULATION.HIGHWAY_MORNING_INCOMING; break;
      case TimeOfDay.EVENING_RUSH: incomingRatio = SIMULATION.HIGHWAY_EVENING_INCOMING; break;
      case TimeOfDay.MIDDAY: multiplier = HIGHWAY_EXTERNAL.MIDDAY_MULTIPLIER; break;
      case TimeOfDay.NIGHT: multiplier = HIGHWAY_EXTERNAL.NIGHT_MULTIPLIER; break;
    }

    const count = Math.min(
      HIGHWAY_EXTERNAL.MAX_PER_TICK,
      Math.floor(pop / 100 * HIGHWAY_EXTERNAL.SPAWN_PER_100_POP * multiplier),
    );
    if (count <= 0) return;

    const edgeCells = this.state.highwayConnection.getEdgeHighwayCells();
    if (edgeCells.length === 0) return;

    for (let i = 0; i < count; i++) {
      if (this.state.traffic.getVehicleCount() - this.state.traffic.getServiceVehicleCount() >= vehicleCap * HIGHWAY_EXTERNAL.CAP_RATIO) break;
      if (this.buildingPositions.length === 0) return;

      const isIncoming = Math.random() < incomingRatio;
      const edge = edgeCells[Math.floor(Math.random() * edgeCells.length)]!;
      const bp = this.buildingPositions[Math.floor(Math.random() * this.buildingPositions.length)]!;

      let path: string[] | null = null;
      if (isIncoming) {
        const endRoad = findAdjacentRoad(grid, bp.x, bp.y);
        if (!endRoad || (endRoad.x === edge.x && endRoad.y === edge.y)) continue;
        path = gridAStarPath(edge, endRoad, grid);
      } else {
        const startRoad = findAdjacentRoad(grid, bp.x, bp.y);
        if (!startRoad || (startRoad.x === edge.x && startRoad.y === edge.y)) continue;
        path = gridAStarPath(startRoad, edge, grid);
      }

      if (path && path.length >= 2) {
        const edgePath = refineLanePath(this.laneGraph, path);
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
   * Spawn count scales with actual freight activity (production + trade volume).
   * Route weights are proportional to real data so truck distribution matches economy.
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

    // Skip if no freight activity
    if (production === 0 && imported === 0) return;

    // Cap check: freight uses up to FREIGHT_CAP_RATIO of vehicle cap
    const freightCap = Math.floor(vehicleCap * SIMULATION.FREIGHT_CAP_RATIO);
    const currentCount = this.state.traffic.getVehicleCount() - this.state.traffic.getServiceVehicleCount();
    if (currentCount >= vehicleCap) return;

    // Collect industrial and commercial building positions from cached index
    if (this.buildingPositions.length === 0) return;

    const industrials: { x: number; y: number }[] = [];
    const commercials: { x: number; y: number }[] = [];
    for (const bp of this.buildingPositions) {
      const cell = grid.getCell(bp.x, bp.y);
      if (!cell) continue;
      if (cell.zoneType === ZoneType.INDUSTRIAL) industrials.push(bp);
      else if (isCommercialZone(cell.zoneType)) commercials.push(bp);
    }

    // Spawn count scales with freight activity + population
    const pop = this.state.citizens.getPopulation();
    const activityBase = Math.floor((production + imported + exported) / SIMULATION.FREIGHT_ACTIVITY_DIVISOR);
    const maxForPop = Math.min(SIMULATION.FREIGHT_MAX_FROM_POP, SIMULATION.FREIGHT_BASE_TRUCKS + Math.floor(pop / SIMULATION.FREIGHT_POP_DIVISOR));
    const maxPerTick = Math.min(activityBase, maxForPop);
    if (maxPerTick <= 0) return;

    // Route weights proportional to actual data
    const localVolume = Math.max(0, production - exported);
    const hasLocal = industrials.length > 0 && commercials.length > 0 && localVolume > 0;
    const hasExport = industrials.length > 0 && this.cachedTradePositions.length > 0 && exported > 0;
    const hasImport = commercials.length > 0 && this.cachedTradePositions.length > 0 && imported > 0;

    if (!hasLocal && !hasExport && !hasImport) return;

    const options: Array<{ type: FreightRouteType; weight: number }> = [];
    if (hasLocal) options.push({ type: FreightRouteType.LOCAL, weight: localVolume });
    if (hasExport) options.push({ type: FreightRouteType.EXPORT, weight: exported });
    if (hasImport) options.push({ type: FreightRouteType.IMPORT, weight: imported });
    const totalWeight = options.reduce((s, o) => s + o.weight, 0);
    if (totalWeight === 0) return;

    let spawned = 0;
    for (let i = 0; i < maxPerTick; i++) {
      if (currentCount + spawned >= vehicleCap) break;
      if (spawned >= freightCap) break;

      // Weighted random route selection
      let roll = Math.random() * totalWeight;
      let routeType: FreightRouteType = FreightRouteType.LOCAL;
      for (const o of options) {
        roll -= o.weight;
        if (roll <= 0) { routeType = o.type; break; }
      }

      let from: { x: number; y: number };
      let to: { x: number; y: number };

      switch (routeType) {
        case FreightRouteType.LOCAL:
          from = industrials[Math.floor(Math.random() * industrials.length)]!;
          to = commercials[Math.floor(Math.random() * commercials.length)]!;
          break;
        case FreightRouteType.EXPORT:
          from = industrials[Math.floor(Math.random() * industrials.length)]!;
          to = this.cachedTradePositions[Math.floor(Math.random() * this.cachedTradePositions.length)]!;
          break;
        case FreightRouteType.IMPORT:
          from = this.cachedTradePositions[Math.floor(Math.random() * this.cachedTradePositions.length)]!;
          to = commercials[Math.floor(Math.random() * commercials.length)]!;
          break;
      }

      const startRoad = findAdjacentRoad(grid, from.x, from.y);
      const endRoad = findAdjacentRoad(grid, to.x, to.y);
      if (!startRoad || !endRoad || (startRoad.x === endRoad.x && startRoad.y === endRoad.y)) continue;

      const path = gridAStarPath(startRoad, endRoad, grid);
      if (path && path.length >= 2) {
        const edgePath = refineLanePath(this.laneGraph, path);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addFreightVehicle(edgePath);
          spawned++;
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
    const cellSet = this.flowCellSet;
    this.commuteCache.forEachRouteWithRefCount((path, refCount) => {
      totalRoutedCitizens += refCount;
      cellSet.clear();
      collectEdgeCells(path, cellSet);
      for (const cellKey of cellSet) {
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
      if (manhattan <= SIMULATION.MANHATTAN_DISTANCE_THRESHOLD) continue;

      const availableTransport = this.getAvailableTransit(from, to);
      const mode = chooseMode(from, to, availableTransport, 0);
      if (mode !== TransportMode.DRIVE) continue;

      const path = findRoadPath(from, to, grid, this._elevationManager ?? undefined);
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

// countResidentialCapacity and countWorkplaceJobs moved to BuildingQueries.ts
// Re-export for backward compatibility with existing consumers
export { countResidentialCapacity, countWorkplaceJobs } from '../building/BuildingQueries';

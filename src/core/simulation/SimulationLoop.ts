import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';
import { birthTick } from '../citizen/Birth';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue, checkParkProximity } from '../economy/LandValue';
import { ZoneType, TerrainType, isResidentialZone, isCommercialZone, isWorkplaceZone } from '../grid/types';
import { RoadType, ROAD_CONFIGS } from '../road/types';
import { getLaneCount } from '../traffic/TrafficSimulation';
import { LaneGraph } from '../traffic/LaneGraph';
import { refineLanePath, gridAStarPath } from '../traffic/Pathfinding';
import { CommuteCache, type CachedRoute } from '../traffic/CommuteCache';
import { getBuildingType } from '../building/types';
import { clampBuildingLevel } from '../building/BuildingLevel';
import { getIncomeLevelMultiplier, getBuildingLevelMultiplier, ECONOMY } from '../economy/TaxMultipliers';
import { getInfraConfigById, getInfraBuildingId, isZoneBuilding } from '../building/InfraConfig';
import { countZoneBuildings, countResidentialCapacity, countWorkplaceJobs } from '../building/BuildingQueries';
import { getGridPollutionSources } from '../environment/GridPollutionSources';
import { MULTI_CELL_OCCUPIED, BURNED } from '../building/InfraPlacement';
import { getSpecializationBonus } from '../district/Specialization';
import { IncomeLevel, isWorkingAge } from '../citizen/types';
import { countOccupancy, assignToBuildings, type BuildingSlot } from '../citizen/OccupancyAssignment';
import type { TimeOfDay } from './GameClock';
import { chooseMode, type AvailableTransport } from '../transport/ModeChoice';
import { TransportMode } from '../transport/types';
import { getSystemForMode, getTransitSystems, getTotalTransportOperatingCost } from '../transport/TransportRegistry';
import { getTotalServiceMaintenanceCost } from '../service/ServiceRegistry';
import { parsePosKey, parsePosKeyUnsafe, findAdjacentRoad, toPosKey, FOUR_NEIGHBORS, manhattanDistance } from '../grid/GridHelpers';
import { applyFireDamage } from '../service/FireDamageProcessor';
import { randomInt, randomElement, pickWeighted } from '../utils/random';
import { buildODPools } from '../traffic/ODPoolBuilder';
import { findAvailableTransit } from '../transport/TransitAvailability';

/** Simulation tuning constants */
export const SIMULATION = {
  /** Ticks between service/RCI/growth updates */
  SLOW_TICK_INTERVAL: 6,
  /** Ticks between heavier computations: pollution, land value, vehicle spawning */
  MEDIUM_TICK_INTERVAL: 60,
  /** Number of random cells sampled per growth tick */
  GROWTH_ATTEMPTS: 20,
  /** Chance per attempt for burned building auto-clearance */
  BURNED_CLEARANCE_CHANCE: 0.02,
  /** Service coverage divisor for building level calculation */
  BUILDING_LEVEL_DIVISOR: 3,
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
  /** Building level: minimum level */
  BUILDING_LEVEL_MIN: 1,
  /** Building level: maximum level */
  BUILDING_LEVEL_MAX: 3,
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

  // Lane-level connection graph for edge-based vehicle movement
  laneGraph: LaneGraph = new LaneGraph();
  private laneGraphDirty = true;

  // Building index: "x,y" position → buildingId (type). Rebuilt once per day.
  private buildingPositions: { pos: string; x: number; y: number; buildingId: number }[] = [];
  private buildingIndexDay = -1; // last day the index was rebuilt

  // Track which citizens have already commuted this rush period
  private morningCommuters = new Set<number>(); // citizen ids that have spawned morning commute
  private eveningCommuters = new Set<number>(); // citizen ids that have spawned evening commute
  private lastTimeOfDay: TimeOfDay = 'night'; // to detect period transitions

  // Commute path cache: stores computed LaneEdge paths for citizen commutes
  commuteCache: CommuteCache = new CommuteCache();

  /** Called when building state changes (growth/demolish/burn/upgrade) */
  onBuildingsChanged?: () => void;
  /** Called when terrain-related state changes (pollution/land value) */
  onTerrainChanged?: () => void;

  /** Fine-grained building callbacks for incremental rendering */
  onBuildingAdded?: (x: number, y: number, zoneType: number, level: number) => void;
  onBuildingRemoved?: (x: number, y: number) => void;
  onBuildingUpdated?: (x: number, y: number, zoneType: number, level: number, burned: boolean) => void;

  constructor(state: GameState) {
    this.state = state;
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
      // Higher business tax reduces commercial/industrial demand
      const businessTax = this.state.taxRates.business ?? SIMULATION.BUSINESS_TAX_BASELINE;
      if (businessTax > SIMULATION.BUSINESS_TAX_BASELINE) {
        const penalty = (businessTax - SIMULATION.BUSINESS_TAX_BASELINE) * SIMULATION.BUSINESS_TAX_PENALTY_PER_POINT;
        rci.commercial = Math.max(-100, rci.commercial - penalty);
        rci.industrial = Math.max(-100, rci.industrial - penalty);
      }
      this.state.rciDemand = rci;
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
      this.state.power.calculateCoverage(this.state.grid, infraPositions);
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

    // 4.7 Education: upgrade citizen education based on school availability
    if (isSlowTick) {
      const schools = this.state.education.getSchools();
      const hasElementary = schools.some(s => s.type === 'elementary');
      const hasHighSchool = schools.some(s => s.type === 'highschool');
      const hasUniversity = schools.some(s => s.type === 'university');
      this.state.citizens.educateTick(hasElementary, hasHighSchool, hasUniversity);
    }

    // 5. Citizens aging (once per game year)
    const currentYear = this.state.clock.getYear();
    if (currentYear !== this.lastAgeYear) {
      this.lastAgeYear = currentYear;
      const deaths = this.state.citizens.ageTick();
      // Report deaths to DeathCare for cemetery/crematorium processing
      for (let i = 0; i < deaths; i++) {
        this.state.deathCare.reportDeath();
      }
      // 自然出生：每年結算一次
      birthTick(this.state.citizens);
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

    // 7. Rebuild lane graph if roads changed
    if (this.laneGraphDirty) {
      this.rebuildLaneGraph();
      this.laneGraphDirty = false;
    }

    // 7b. Traffic - spawn commute vehicles and advance (every tick for smooth traffic)
    this.spawnVehicles();
    this.state.trafficLights.tick();

    // 8. Transport systems (every tick)
    // Set congestion level for surface transit
    const currentCongestion = this.state.traffic.getCongestionLevel();
    this.state.bus.congestionLevel = currentCongestion;

    this.state.bus.tick();
    this.state.metro.tick();
    this.state.rail.tick();
    this.state.ferry.tick();
    this.state.airport.tick();

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
            const level = clampBuildingLevel(grown.serviceCoverage);
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
    const city = {
      jobOpenings: this.countJobOpenings(),
      vacantHomes: this.countVacantHomes(),
      avgHappiness,
      taxRate: this.state.taxRates.residential ?? 9,
      pollution: this.getAvgPollution(),
      crimeRate: this.getAvgCrime(),
    };
    migrationTick(this.state.citizens, city, pop);
  }

  private updateCitizenHappiness(): void {
    const taxRate = this.state.taxRates.residential ?? 9;
    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Calculate employment ratio for the city
    const totalJobs = this.countTotalJobs();
    const adultCount = this.state.citizens.getCitizens().filter(
      c => isWorkingAge(c.age)
    ).length;
    const employmentRate = adultCount > 0 ? Math.min(1, totalJobs / adultCount) : 1;
    const avgPollution = this.getAvgPollution();
    const avgCrime = this.getAvgCrime();

    // Estimate average commute from residential spread (compact city = short commutes)
    const resCount = countZoneBuildings(this.state.grid, isResidentialZone);
    const avgCommute = resCount > 0
      ? Math.min(SIMULATION.COMMUTE_MAX, SIMULATION.COMMUTE_BASE + Math.sqrt(resCount) * SIMULATION.COMMUTE_SPREAD_FACTOR)
      : 3;

    // Count service coverage: power + water + low pollution bonus
    const { poweredRatio, wateredRatio } = this.getServiceRatios();
    const serviceCoverage = Math.round(
      poweredRatio * SIMULATION.SERVICE_POWER_WEIGHT +
      wateredRatio * SIMULATION.SERVICE_WATER_WEIGHT +
      (avgPollution < SIMULATION.LOW_POLLUTION_THRESHOLD ? 1 : 0)
    );

    // Check if any parks exist for happiness bonus
    const hasParkCoverage = this.state.parks.getParks().length > 0;

    for (const citizen of this.state.citizens.getCitizens()) {
      // Vary commute per citizen (+/- 3 random jitter)
      const commute = Math.max(1, avgCommute + (Math.random() * SIMULATION.COMMUTE_JITTER - SIMULATION.COMMUTE_JITTER / 2));
      const factors: HappinessFactors = {
        commuteDistance: commute,
        hasPark: hasParkCoverage,
        pollution: avgPollution,
        noiseLevel: 0,
        crimeRate: avgCrime,
        isEmployed: !isWorkingAge(citizen.age) || Math.random() < employmentRate,
        taxRate,
        serviceCoverage,
      };
      citizen.happiness = calculateHappiness(citizen, factors);
    }
  }

  // Only check service coverage for residential buildings — residents care about
  // their own power/water, not whether distant factories have coverage.
  private getServiceRatios(): { poweredRatio: number; wateredRatio: number } {
    let powered = 0;
    let watered = 0;
    let total = 0;
    this.state.grid.forEachCell((cell, x, y) => {
      if (cell.buildingId > 0 && isResidentialZone(cell.zoneType)) {
        total++;
        if (this.state.power.isPowered(x, y)) powered++;
        if (this.state.water.isSupplied(x, y)) watered++;
      }
    });
    return {
      poweredRatio: total > 0 ? powered / total : 0,
      wateredRatio: total > 0 ? watered / total : 0,
    };
  }

  private countTotalJobs(): number {
    return countWorkplaceJobs(this.state.grid);
  }

  // Only average pollution over residential cells (zoneType 1=RES_LOW, 2=RES_HIGH)
  // so industrial pollution far away doesn't drag down citizen happiness unfairly.
  private getAvgPollution(): number {
    let total = 0;
    let count = 0;
    this.state.grid.forEachCell((cell) => {
      if (isResidentialZone(cell.zoneType)) {
        total += cell.pollution;
        count++;
      }
    });
    return count > 0 ? total / count : 0;
  }

  private getAvgCrime(): number {
    // Crime scales with population, reduced by police coverage
    const pop = this.state.citizens.getPopulation();
    const baseCrime = Math.min(SIMULATION.CRIME_BASE_MAX, pop * SIMULATION.CRIME_POP_FACTOR);
    const stations = this.state.police.getStations();
    if (stations.length === 0) return baseCrime;
    const coverageRatio = Math.min(1, stations.length * SIMULATION.CRIME_COVERAGE_PER_STATION);
    return baseCrime * (1 - coverageRatio * SIMULATION.CRIME_MAX_REDUCTION);
  }

  private countVacantHomes(): number {
    const capacity = countResidentialCapacity(this.state.grid);
    return Math.max(0, capacity - this.state.citizens.getPopulation());
  }

  private calculateIncome(): void {
    const incomeTaxRate = this.state.taxRates.residential ?? 9;
    const businessTaxRate = this.state.taxRates.business ?? 9;

    let totalIncome = 0;

    this.state.grid.forEachCell((cell, x, y) => {
      // Skip infrastructure, empty cells, burned, and multi-cell secondary
      if (!isZoneBuilding(cell.buildingId) || cell.reserved === BURNED || cell.reserved === MULTI_CELL_OCCUPIED) return;
      const btype = getBuildingType(cell.buildingId);
      if (!btype) return;

      let buildingIncome = 0;

      if (isResidentialZone(btype.zoneType)) {
        // Income tax: scan citizens living in this building
        const posKey = toPosKey(x, y);
        const residents = this.state.citizens.getCitizensByHome(posKey);
        for (const citizen of residents) {
          buildingIncome += ECONOMY.CITIZEN_BASE_INCOME * getIncomeLevelMultiplier(citizen.incomeLevel) * (incomeTaxRate / 100);
        }
      } else {
        // Business tax: companyIncome x levelMultiplier x businessTaxRate
        const ci = btype.companyIncome ?? 0;
        buildingIncome = ci * getBuildingLevelMultiplier(btype.level) * (businessTaxRate / 100);
      }

      // Apply district specialization revenue multiplier
      const district = this.state.districts.getDistrictAt(x, y);
      if (district) {
        const bonus = getSpecializationBonus(district.specialization);
        buildingIncome *= bonus.revenueMultiplier;
      }
      totalIncome += buildingIncome;
    });
    // Apply city-wide specialization revenue multiplier
    const citySpecBonus = this.state.citySpec.getBonus();
    totalIncome *= citySpecBonus.revenueMultiplier;

    this.state.budget.income = totalIncome;
    // Expenses: road maintenance + service maintenance costs
    const roadMaint = this.countRoadTiles() * ECONOMY.ROAD_MAINTENANCE_PER_TILE;
    const serviceCost = getTotalServiceMaintenanceCost(this.state);
    // District policy costs: sum all active policy costs across all districts
    let policyCost = 0;
    for (const district of this.state.districts.getAllDistricts()) {
      for (const policy of district.policies) {
        if (policy.active) policyCost += policy.cost;
      }
    }
    // Transport operating costs
    const transportCost = getTotalTransportOperatingCost(this.state);
    this.state.budget.expenses = roadMaint + serviceCost + policyCost + transportCost;
  }

  private countRoadTiles(): number {
    let count = 0;
    this.state.grid.forEachCell((cell) => {
      if (cell.roadType !== RoadType.NONE) count++;
    });
    return count;
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

    // Collect pollution sources from all providers (DIP: each source manages its own emissions)
    const allSources = [
      ...getGridPollutionSources(grid),
      ...this.state.garbage.getPollutionSources(),
      ...this.state.sewage.getPollutionSources(),
      ...this.state.airport.getPollutionSources(),
    ];
    for (const src of allSources) {
      pm.addSource(src.x, src.y, src.amount, src.type);
    }

    // Garbage overflow produces distributed pollution at city center
    const garbagePenalty = this.state.garbage.getPollutionPenalty();
    if (garbagePenalty > 0) {
      const cx = Math.floor(grid.width / 2);
      const cy = Math.floor(grid.height / 2);
      pm.addSource(cx, cy, garbagePenalty, 'ground');
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
      const isPowered = this.state.power.isPowered(x, y);
      const isWatered = this.state.water.isSupplied(x, y);
      const serviceCoverage = (isPowered ? 2 : 0) + (isWatered ? 2 : 0);

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

      const isPowered = this.state.power.isPowered(x, y);
      const isWatered = this.state.water.isSupplied(x, y);
      const pollution = this.state.pollution.getPollutionAt(x, y);
      // Count service types: power, water, + bonus for low pollution/crime
      let serviceCoverageCount = (isPowered ? 2 : 0) + (isWatered ? 2 : 0);
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
          const newLevel = clampBuildingLevel(updated.serviceCoverage);
          this.onBuildingUpdated?.(x, y, updated.zoneType, newLevel, updated.reserved === BURNED);
        }
      }
    }
    if (changed) this.onBuildingsChanged?.();
  }

  /**
   * Rebuild the building position list. Called once per game day.
   * Stores every building's grid position so each is uniquely addressable.
   */
  private rebuildBuildingIndex(): void {
    const currentDay = this.state.clock.getDay();
    if (this.buildingIndexDay === currentDay && this.buildingPositions.length > 0) return;

    this.buildingPositions = [];
    this.state.grid.forEachCell((cell, x, y) => {
      if (isZoneBuilding(cell.buildingId)) {
        this.buildingPositions.push({ pos: toPosKey(x, y), x, y, buildingId: cell.buildingId });
      }
    });
    this.buildingIndexDay = currentDay;
  }

  /**
   * Assign homeId and workplaceId to citizens who don't have them.
   * homeId/workplaceId store "x,y" position strings (unique per building).
   * Called after migration so newly created citizens get housing.
   */
  private assignCitizenHousing(): void {
    this.rebuildBuildingIndex();

    // Collect residential and workplace buildings with capacity info
    const residentialBuildings: BuildingSlot[] = [];
    const workplaceBuildings: BuildingSlot[] = [];

    for (const b of this.buildingPositions) {
      const bt = getBuildingType(b.buildingId);
      if (!bt) continue;
      if (bt.residents > 0) {
        residentialBuildings.push({ pos: b.pos, capacity: bt.residents });
      }
      if (bt.workers > 0) {
        workplaceBuildings.push({ pos: b.pos, capacity: bt.workers });
      }
    }

    if (residentialBuildings.length === 0 && workplaceBuildings.length === 0) return;

    const citizens = this.state.citizens.getCitizens();

    // Count current occupancy and assign — delegated to generic functions (SRP+DRY)
    const homeOccupancy = countOccupancy(citizens, (c) => c.homeId);
    assignToBuildings(citizens, residentialBuildings, homeOccupancy,
      (c) => c.homeId, (c, pos) => { c.homeId = pos; });

    const workOccupancy = countOccupancy(citizens, (c) => c.workplaceId);
    const workingAgeCitizens = citizens.filter((c) => isWorkingAge(c.age));
    assignToBuildings(workingAgeCitizens, workplaceBuildings, workOccupancy,
      (c) => c.workplaceId, (c, pos) => { c.workplaceId = pos; });
  }

  /** Mark the lane graph as needing rebuild (call after road build/demolish).
   *  If affectedCells is provided, only invalidate cached routes through those cells.
   *  If omitted, no cache invalidation (e.g. road building adds new cells but doesn't break existing routes).
   */
  markLaneGraphDirty(affectedCells?: string[]): void {
    this.laneGraphDirty = true;
    if (affectedCells) {
      for (const cellKey of affectedCells) {
        this.commuteCache.invalidateCell(cellKey);
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
  }

  private spawnVehicles(): void {
    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Vehicle cap: ~30% of population can be on the road simultaneously
    const vehicleCap = Math.min(SIMULATION.VEHICLE_CAP_MAX, SIMULATION.VEHICLE_CAP_BASE + Math.floor(pop * SIMULATION.VEHICLE_CAP_POP_RATIO));
    if (this.state.traffic.getVehicleCount() >= vehicleCap) return;

    this.rebuildBuildingIndex();

    const timeOfDay = this.state.clock.getTimeOfDay();

    // Clear commuter tracking on period transitions
    if (timeOfDay !== this.lastTimeOfDay) {
      if (timeOfDay === 'morning_rush') this.morningCommuters.clear();
      if (timeOfDay === 'evening_rush') this.eveningCommuters.clear();
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
    // Night: no spawning
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

      if (cached && cached.status === 'ready' && !this.commuteCache.isDirty(citizen.id)) {
        const cachedPath = isMorning ? cached.morningPath : cached.eveningPath;
        if (cachedPath && cachedPath.length > 0) {
          this.state.traffic.addVehicleOnEdges(cachedPath);
          commuterSet.add(citizen.id);
          spawned++;
          continue;
        }
      }

      // --- Compute path and populate cache ---
      const startRoad = findAdjacentRoad(grid, fromPos.x, fromPos.y);
      const endRoad = findAdjacentRoad(grid, toPos.x, toPos.y);
      if (!startRoad || !endRoad) {
        commuterSet.add(citizen.id);
        continue;
      }
      if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) {
        commuterSet.add(citizen.id);
        continue;
      }

      // Check routeIndex for shared path reuse
      const routeKey = `${fromStr}->${toStr}`;
      let edgePath = this.commuteCache.getByRoute(routeKey) ?? null;

      if (!edgePath) {
        const path = gridAStarPath(startRoad, endRoad, grid);
        if (path && path.length >= 2) {
          const startCell = this.state.grid.getCell(startRoad.x, startRoad.y);
          const dirLanes = startCell ? getLaneCount(startCell.roadType) : 1;
          const preferredLane = dirLanes > 1 ? randomInt(dirLanes) : 0;
          edgePath = refineLanePath(this.laneGraph, path, preferredLane);
          if (edgePath && edgePath.length > 0) {
            // Store in shared routeIndex
            this.commuteCache.setRoute(routeKey, edgePath);
          }
        }
      }

      if (edgePath && edgePath.length > 0) {
        this.state.traffic.addVehicleOnEdges(edgePath);

        // Build or update the citizen's cached route
        const existingRoute = this.commuteCache.get(citizen.id);
        const cachedRoute: CachedRoute = {
          citizenId: citizen.id,
          homeId: citizen.homeId!,
          workplaceId: citizen.workplaceId!,
          morningPath: isMorning ? edgePath : (existingRoute?.morningPath ?? null),
          eveningPath: isMorning ? (existingRoute?.eveningPath ?? null) : edgePath,
          status: 'ready',
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

      const startRoad = findAdjacentRoad(grid, start.x, start.y);
      const endRoad = findAdjacentRoad(grid, end.x, end.y);
      if (!startRoad || !endRoad) continue;
      if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) continue;

      const path = gridAStarPath(startRoad, endRoad, grid);
      if (path && path.length >= 2) {
        const sCell = this.state.grid.getCell(startRoad.x, startRoad.y);
        const dLanes = sCell ? getLaneCount(sCell.roadType) : 1;
        const prefLane = dLanes > 1 ? randomInt(dLanes) : 0;
        const edgePath = refineLanePath(this.laneGraph, path, prefLane);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addVehicleOnEdges(edgePath);
        }
      }
    }
  }



  /**
   * Compute predicted congestion flow by sampling OD pairs (residential → commercial/industrial)
   * and running the same BFS pathfinding. Updates the traffic overlay without needing actual vehicles.
   */
  private computeCongestionFlow(): void {
    const grid = this.state.grid;

    const pools = buildODPools(this.state.citizens.getCitizens(), parsePosKeyUnsafe);
    if (!pools) {
      this.state.traffic.updatePredictedFlow(new Map());
      return;
    }

    const { residential, destinations, totalResWeight, totalDestWeight } = pools;

    // Scale sample count with population (1 sample per 5 eligible commuters, clamped 50-300)
    const sampleCount = Math.max(SIMULATION.SAMPLE_COUNT_MIN, Math.min(SIMULATION.SAMPLE_COUNT_MAX, Math.ceil(totalResWeight / SIMULATION.SAMPLE_DIVISOR)));
    const flowMap = new Map<string, number>();

    for (let i = 0; i < sampleCount; i++) {
      const from = pickWeighted(residential, totalResWeight, e => e.weight);
      const to = pickWeighted(destinations, totalDestWeight, e => e.weight);
      if (from.x === to.x && from.y === to.y) continue;

      // Walk filter: Manhattan distance ≤ 3 → citizen walks, no car
      const manhattan = manhattanDistance(from.x, from.y, to.x, to.y);
      if (manhattan <= 3) continue;

      // Transport mode choice: skip if transit is better than driving
      const availableTransport = this.getAvailableTransit(from, to);
      const mode = chooseMode(from, to, availableTransport, 0);
      if (mode !== TransportMode.DRIVE) continue;

      const startRoad = findAdjacentRoad(grid, from.x, from.y);
      const endRoad = findAdjacentRoad(grid, to.x, to.y);
      if (!startRoad || !endRoad) continue;
      if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) continue;

      const path = gridAStarPath(startRoad, endRoad, grid);
      if (!path) continue;

      for (const cellKey of path) {
        flowMap.set(cellKey, (flowMap.get(cellKey) ?? 0) + 1);
      }
    }

    // Scale up sampled flow to match actual commuter volume, then normalize by lane count
    const scaleFactor = totalResWeight / sampleCount;
    for (const [cellKey, rawFlow] of flowMap) {
      const { x, y } = parsePosKeyUnsafe(cellKey);
      const cell = grid.getCell(x, y);
      const lanes = cell ? getLaneCount(cell.roadType) : 1;
      flowMap.set(cellKey, (rawFlow * scaleFactor) / lanes);
    }

    this.state.traffic.updatePredictedFlow(flowMap);
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

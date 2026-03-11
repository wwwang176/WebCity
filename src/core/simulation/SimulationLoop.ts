import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';
import { birthTick } from '../citizen/Birth';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue } from '../economy/LandValue';
import { ZoneType, isResidentialZone, isCommercialZone, isWorkplaceZone } from '../grid/types';
import { RoadType, ROAD_CONFIGS } from '../road/types';
import { getLaneCount } from '../traffic/TrafficSimulation';
import { LaneGraph } from '../traffic/LaneGraph';
import { refineLanePath, gridAStarPath } from '../traffic/Pathfinding';
import { CommuteCache, type CachedRoute } from '../traffic/CommuteCache';
import { getBuildingType } from '../building/types';
import { getIncomeLevelMultiplier, getBuildingLevelMultiplier } from '../economy/TaxMultipliers';
import { getInfraConfigById, isZoneBuilding } from '../building/InfraConfig';
import { findPrimaryCell, MULTI_CELL_OCCUPIED, BURNED } from '../building/InfraPlacement';
import { getSpecializationBonus } from '../district/Specialization';
import { IncomeLevel } from '../citizen/types';
import type { TimeOfDay } from './GameClock';
import { chooseMode, type AvailableTransport } from '../transport/ModeChoice';
import { TransportMode, TransportType } from '../transport/types';
import { getSystemForMode, getTransitSystems, getTotalTransportOperatingCost } from '../transport/TransportRegistry';
import { getTotalServiceMaintenanceCost } from '../service/ServiceRegistry';

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
    const isSlowTick = tick % 6 === 0;

    // 1. Economy: RCI demand (every 6 ticks)
    if (isSlowTick) {
      const rci = calculateRCIDemand({
        residentialSupply: this.countZoneBuildings('residential'),
        commercialSupply: this.countZoneBuildings('commercial'),
        industrialSupply: this.countZoneBuildings('industrial'),
        population: this.state.citizens.getPopulation(),
        jobOpenings: this.countJobOpenings(),
        exportDemand: 10,
      });
      // Higher business tax reduces commercial/industrial demand
      const businessTax = this.state.taxRates.business ?? 9;
      if (businessTax > 9) {
        const penalty = (businessTax - 9) * 2; // 2 demand points per % over 9
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
      for (const p of this.state.power.getPlants()) infraPositions.add(`${p.x},${p.y}`);
      for (const p of this.state.water.getPlants()) infraPositions.add(`${p.x},${p.y}`);
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
    if (tick % 60 === 0) {
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
    const trafficSys = this.state.traffic as unknown as { getCongestionLevel?: () => number };
    const currentCongestion = trafficSys.getCongestionLevel ? trafficSys.getCongestionLevel() : 0;
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
    if (tick % 60 === 0) {
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
    if (tick === 1 || tick % 60 === 0) {
      this.computeCongestionFlow();
    }
  }

  getState(): GameState {
    return this.state;
  }

  private countZoneBuildings(type: string): number {
    let count = 0;
    this.state.grid.forEachCell((cell) => {
      if (cell.buildingId > 0) {
        if (type === 'residential' && isResidentialZone(cell.zoneType)) count++;
        if (type === 'commercial' && isCommercialZone(cell.zoneType)) count++;
        if (type === 'industrial' && cell.zoneType === ZoneType.INDUSTRIAL) count++;
      }
    });
    return count;
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
    const attempts = 20;
    for (let i = 0; i < attempts; i++) {
      const x = Math.floor(Math.random() * grid.width);
      const y = Math.floor(Math.random() * grid.height);
      const cell = grid.getCell(x, y);
      if (!cell || cell.zoneType === ZoneType.NONE) continue;

      // Burned buildings: developer must demolish ruins first (extra cost/time)
      if (cell.reserved === BURNED && isZoneBuilding(cell.buildingId)) {
        // ~2% chance per attempt to clear the ruins (developer demolition takes time)
        if (Math.random() < 0.02) {
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
            const level = Math.max(1, Math.min(3, Math.ceil(grown.serviceCoverage / 3) || 1));
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
    let avgHappiness = 70;
    if (pop > 0) {
      let totalHappiness = 0;
      for (const c of this.state.citizens.citizens) {
        totalHappiness += c.happiness;
      }
      avgHappiness = totalHappiness / pop;
    }
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
    const adultCount = this.state.citizens.citizens.filter(
      c => c.age > 18 && c.age <= 65
    ).length;
    const employmentRate = adultCount > 0 ? Math.min(1, totalJobs / adultCount) : 1;
    const avgPollution = this.getAvgPollution();
    const avgCrime = this.getAvgCrime();

    // Estimate average commute from residential spread (compact city = short commutes)
    const resCount = this.countZoneBuildings('residential');
    const avgCommute = resCount > 0 ? Math.min(25, 1 + Math.sqrt(resCount) * 0.7) : 3;

    // Count service coverage: power + water + low pollution bonus
    const { poweredRatio, wateredRatio } = this.getServiceRatios();
    const serviceCoverage = Math.round(poweredRatio * 2 + wateredRatio * 2 + (avgPollution < 10 ? 1 : 0));

    // Check if any parks exist for happiness bonus
    const hasParkCoverage = this.state.parks.getParks().length > 0;

    for (const citizen of this.state.citizens.citizens) {
      // Vary commute per citizen (+/- 3 random jitter)
      const commute = Math.max(1, avgCommute + (Math.random() * 6 - 3));
      const factors: HappinessFactors = {
        commuteDistance: commute,
        hasPark: hasParkCoverage,
        pollution: avgPollution,
        noiseLevel: 0,
        crimeRate: avgCrime,
        isEmployed: citizen.age <= 18 || citizen.age > 65 || Math.random() < employmentRate,
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
    const baseCrime = Math.min(50, pop * 0.02);
    const stations = this.state.police.getStations();
    if (stations.length === 0) return baseCrime;
    // Each station covers ~15 radius; rough coverage ratio
    const coverageRatio = Math.min(1, stations.length * 0.15);
    return baseCrime * (1 - coverageRatio * 0.6); // up to 60% crime reduction
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
      if (!isZoneBuilding(cell.buildingId) || cell.reserved === BURNED || cell.reserved === 4) return;
      const btype = getBuildingType(cell.buildingId);
      if (!btype) return;

      let buildingIncome = 0;

      if (isResidentialZone(btype.zoneType)) {
        // Income tax: scan citizens living in this building
        const posKey = `${x},${y}`;
        const residents = this.state.citizens.getCitizensByHome(posKey);
        for (const citizen of residents) {
          buildingIncome += 0.5 * getIncomeLevelMultiplier(citizen.incomeLevel) * (incomeTaxRate / 100);
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
    const roadMaint = this.countRoadTiles() * 0.1;
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
      if (cell.roadType > 0) count++;
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

    // Resolve completed fires and apply damage
    let changed = false;
    const resolved = fire.resolveCompletedFires();
    for (const f of resolved) {
      if (f.damage >= 0.5) {
        // High damage: mark building as BURNED (charred ruins)
        const cell = this.state.grid.getCell(f.x, f.y);
        if (cell && isZoneBuilding(cell.buildingId)) {
          changed = true;
          // Check if this is a multi-cell building
          const cfg = getInfraConfigById(cell.buildingId);
          if (cfg && (cfg.width > 1 || cfg.height > 1)) {
            // Multi-cell: mark ALL cells as BURNED
            const primary = findPrimaryCell(this.state.grid, f.x, f.y);
            if (primary) {
              const maxDim = Math.max(cfg.width, cfg.height);
              for (let dy = 0; dy < maxDim; dy++) {
                for (let dx = 0; dx < maxDim; dx++) {
                  const c = this.state.grid.getCell(primary.x + dx, primary.y + dy);
                  if (c && c.buildingId === cell.buildingId) {
                    this.state.grid.setCell(primary.x + dx, primary.y + dy, { reserved: BURNED });
                    this.onBuildingUpdated?.(primary.x + dx, primary.y + dy, c.zoneType, 1, true);
                  }
                }
              }
            }
          } else {
            this.state.grid.setCell(f.x, f.y, { reserved: BURNED }); // BuildingStatus.BURNED
            const level = Math.max(1, Math.min(3, Math.ceil(cell.serviceCoverage / 3) || 1));
            this.onBuildingUpdated?.(f.x, f.y, cell.zoneType, level, true);
          }
        }
      }
    }
    if (changed) this.onBuildingsChanged?.();
  }

  private updatePollution(): void {
    const grid = this.state.grid;
    const pm = this.state.pollution;

    pm.clearSources();

    // Industrial buildings produce ground pollution; roads produce noise
    grid.forEachCell((cell, x, y) => {
      if (cell.buildingId > 0 && cell.zoneType === ZoneType.INDUSTRIAL) {
        pm.addSource(x, y, 60, 'ground');
        pm.addSource(x, y, 40, 'noise');
      }
      if (cell.roadType > 0 && cell.trafficDensity > 0) {
        pm.addSource(x, y, cell.trafficDensity * 10, 'noise');
      }
    });

    // Garbage and sewage facility pollution (delegated to services)
    for (const src of this.state.garbage.getPollutionSources()) {
      pm.addSource(src.x, src.y, src.amount, src.type);
    }
    // Garbage overflow produces distributed pollution at city center
    const garbagePenalty = this.state.garbage.getPollutionPenalty();
    if (garbagePenalty > 0) {
      const cx = Math.floor(grid.width / 2);
      const cy = Math.floor(grid.height / 2);
      pm.addSource(cx, cy, garbagePenalty, 'ground');
    }

    for (const src of this.state.sewage.getPollutionSources()) {
      pm.addSource(src.x, src.y, src.amount, src.type);
    }

    // Airport noise pollution
    for (const airport of this.state.airport.getAirports()) {
      pm.addSource(airport.x, airport.y, airport.noisePollution * 5, 'noise');
    }

    pm.calculateSpread();

    // Write pollution back to grid cells
    grid.forEachCell((cell, x, y) => {
      const p = pm.getPollutionAt(x, y);
      const total = Math.min(255, p.ground + p.noise);
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
      let parkProximity = this.state.parks.getCoverage(x, y);
      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dx, dy] of dirs) {
        const nc = grid.getCell(x + dx!, y + dy!);
        if (nc && nc.terrainType === 1) waterfront = true;
        if (nc && (nc.terrainType === 3 || nc.buildingId === 248)) parkProximity = true;
      }
      // Also check 2-cell radius for natural parks
      if (!parkProximity) {
        outer:
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            if (Math.abs(dx) + Math.abs(dy) > 2) continue;
            const nc = grid.getCell(x + dx, y + dy);
            if (nc && (nc.terrainType === 3 || nc.buildingId === 248)) { parkProximity = true; break outer; }
          }
        }
      }

      // Industrial zones are less affected by their own pollution
      const pollutionFactor = cell.zoneType === ZoneType.INDUSTRIAL ? 0.2 : 1;
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
      const noiseVal = Math.min(255, Math.round(pollution.noise));
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
      const x = Math.floor(Math.random() * grid.width);
      const y = Math.floor(Math.random() * grid.height);
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
          const newLevel = Math.max(1, Math.min(3, Math.ceil(updated.serviceCoverage / 3) || 1));
          this.onBuildingUpdated?.(x, y, updated.zoneType, newLevel, updated.reserved === 3);
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
        this.buildingPositions.push({ pos: `${x},${y}`, x, y, buildingId: cell.buildingId });
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
    const residentialBuildings: { pos: string; capacity: number }[] = [];
    const workplaceBuildings: { pos: string; capacity: number }[] = [];

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

    // Count current occupancy by position string
    const homeOccupancy = new Map<string, number>();
    const workOccupancy = new Map<string, number>();
    for (const c of this.state.citizens.citizens) {
      if (c.homeId !== null) {
        homeOccupancy.set(c.homeId, (homeOccupancy.get(c.homeId) ?? 0) + 1);
      }
      if (c.workplaceId !== null) {
        workOccupancy.set(c.workplaceId, (workOccupancy.get(c.workplaceId) ?? 0) + 1);
      }
    }

    for (const citizen of this.state.citizens.citizens) {
      // Assign home if needed
      if (citizen.homeId === null && residentialBuildings.length > 0) {
        for (const rb of residentialBuildings) {
          const occ = homeOccupancy.get(rb.pos) ?? 0;
          if (occ < rb.capacity) {
            citizen.homeId = rb.pos;
            homeOccupancy.set(rb.pos, occ + 1);
            break;
          }
        }
      }

      // Assign workplace if needed (only for working-age adults)
      if (citizen.workplaceId === null && citizen.age > 18 && citizen.age <= 65 && workplaceBuildings.length > 0) {
        for (const wb of workplaceBuildings) {
          const occ = workOccupancy.get(wb.pos) ?? 0;
          if (occ < wb.capacity) {
            citizen.workplaceId = wb.pos;
            workOccupancy.set(wb.pos, occ + 1);
            break;
          }
        }
      }
    }
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

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.roadType !== RoadType.NONE) {
          cellKeys.push(`${x},${y}`);
        }
      }
    }

    this.laneGraph.buildFromGrid(gridLookup, cellKeys);
  }

  private spawnVehicles(): void {
    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Vehicle cap: ~30% of population can be on the road simultaneously
    const vehicleCap = Math.min(2000, 20 + Math.floor(pop * 0.3));
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
   * Parse "x,y" position string into coordinates.
   */
  private parsePos(pos: string): { x: number; y: number } | null {
    const parts = pos.split(',');
    if (parts.length !== 2) return null;
    return { x: Number(parts[0]), y: Number(parts[1]) };
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
    const eligible = this.state.citizens.citizens.filter(
      c => c.age > 18 && c.age <= 65 &&
           c.homeId !== null && c.workplaceId !== null &&
           !commuterSet.has(c.id)
    );

    if (eligible.length === 0) return;

    // Spawn enough vehicles per tick so all eligible commuters depart within the rush period (~4 ticks).
    // BFS is bounded to 500 steps so each call is cheap.
    const rushTicks = 4;
    const maxPerTick = Math.max(5, Math.ceil(eligible.length / rushTicks));
    let spawned = 0;

    for (const citizen of eligible) {
      if (spawned >= maxPerTick) break;
      if (this.state.traffic.getVehicleCount() >= vehicleCap) break;

      const fromStr = direction === 'home_to_work' ? citizen.homeId! : citizen.workplaceId!;
      const toStr = direction === 'home_to_work' ? citizen.workplaceId! : citizen.homeId!;

      const fromPos = this.parsePos(fromStr);
      const toPos = this.parsePos(toStr);
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
      const congestion = (this.state.traffic as unknown as { getCongestionLevel?: () => number }).getCongestionLevel
        ? (this.state.traffic as unknown as { getCongestionLevel: () => number }).getCongestionLevel()
        : 0;
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
      const startRoad = this.findAdjacentRoad(fromPos.x, fromPos.y, grid);
      const endRoad = this.findAdjacentRoad(toPos.x, toPos.y, grid);
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
          const preferredLane = dirLanes > 1 ? Math.floor(Math.random() * dirLanes) : 0;
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
    const WALK_TO_STOP_RANGE = 5;
    const result: AvailableTransport[] = [];

    const systems = getTransitSystems(this.state).map(({ type, system }) => ({
      type,
      routes: system.getRoutes(),
    }));

    for (const sys of systems) {
      for (const route of sys.routes) {
        let nearOrigin = false;
        let nearDest = false;
        for (const stop of route.stops) {
          const dOrig = Math.abs(stop.x - origin.x) + Math.abs(stop.y - origin.y);
          const dDest = Math.abs(stop.x - destination.x) + Math.abs(stop.y - destination.y);
          if (dOrig <= WALK_TO_STOP_RANGE) nearOrigin = true;
          if (dDest <= WALK_TO_STOP_RANGE) nearDest = true;
        }
        if (nearOrigin && nearDest) {
          // Estimate transit time: Manhattan distance * factor (faster than driving for metro/rail)
          const dist = Math.abs(destination.x - origin.x) + Math.abs(destination.y - origin.y);
          const timeFactor = sys.type === TransportType.METRO || sys.type === TransportType.RAIL ? 0.8 : 1.0;
          result.push({ type: sys.type, estimatedTime: dist * timeFactor });
        }
      }
    }

    return result;
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

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.roadType > 0) roads.push({ x, y });
        if (cell.buildingId > 0 &&
            (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH)) {
          commercialCells.push({ x, y });
        }
      }
    }

    if (roads.length < 2) return;
    const startPool = commercialCells.length > 0 ? commercialCells : roads;

    for (let i = 0; i < spawnCount; i++) {
      if (this.state.traffic.getVehicleCount() >= vehicleCap) break;
      const start = startPool[Math.floor(Math.random() * startPool.length)]!;
      const end = roads[Math.floor(Math.random() * roads.length)]!;
      if (start.x === end.x && start.y === end.y) continue;

      const startRoad = this.findAdjacentRoad(start.x, start.y, grid);
      const endRoad = this.findAdjacentRoad(end.x, end.y, grid);
      if (!startRoad || !endRoad) continue;
      if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) continue;

      const path = gridAStarPath(startRoad, endRoad, grid);
      if (path && path.length >= 2) {
        const sCell = this.state.grid.getCell(startRoad.x, startRoad.y);
        const dLanes = sCell ? getLaneCount(sCell.roadType) : 1;
        const prefLane = dLanes > 1 ? Math.floor(Math.random() * dLanes) : 0;
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
    const citizens = this.state.citizens;

    // Build weighted OD pools directly from citizen data (not zoneType).
    // This avoids mismatch between cell.zoneType and actual buildingId usage.
    type WeightedEntry = { x: number; y: number; weight: number };
    const resMap = new Map<string, number>();
    const destMap = new Map<string, number>();

    for (const c of citizens.citizens) {
      if (c.age <= 18 || c.age > 65) continue;
      if (!c.homeId || !c.workplaceId) continue;
      resMap.set(c.homeId, (resMap.get(c.homeId) ?? 0) + 1);
      destMap.set(c.workplaceId, (destMap.get(c.workplaceId) ?? 0) + 1);
    }

    const residential: WeightedEntry[] = [];
    const destinations: WeightedEntry[] = [];
    let totalResWeight = 0;
    let totalDestWeight = 0;

    const parsePos = (key: string) => {
      const [x, y] = key.split(',').map(Number);
      return { x: x!, y: y! };
    };

    for (const [posKey, weight] of resMap) {
      const { x, y } = parsePos(posKey);
      residential.push({ x, y, weight });
      totalResWeight += weight;
    }
    for (const [posKey, weight] of destMap) {
      const { x, y } = parsePos(posKey);
      destinations.push({ x, y, weight });
      totalDestWeight += weight;
    }

    if (residential.length === 0 || destinations.length === 0) {
      this.state.traffic.updatePredictedFlow(new Map());
      return;
    }

    // Weighted random pick helper
    const pickWeighted = (pool: WeightedEntry[], totalWeight: number) => {
      let r = Math.random() * totalWeight;
      for (const entry of pool) {
        r -= entry.weight;
        if (r <= 0) return entry;
      }
      return pool[pool.length - 1]!;
    };

    // Scale sample count with population (1 sample per 5 eligible commuters, clamped 50-300)
    const sampleCount = Math.max(50, Math.min(300, Math.ceil(totalResWeight / 5)));
    const flowMap = new Map<string, number>();

    for (let i = 0; i < sampleCount; i++) {
      const from = pickWeighted(residential, totalResWeight);
      const to = pickWeighted(destinations, totalDestWeight);
      if (from.x === to.x && from.y === to.y) continue;

      // Walk filter: Manhattan distance ≤ 3 → citizen walks, no car
      const manhattan = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
      if (manhattan <= 3) continue;

      // Transport mode choice: skip if transit is better than driving
      const availableTransport = this.getAvailableTransit(from, to);
      const mode = chooseMode(from, to, availableTransport, 0);
      if (mode !== TransportMode.DRIVE) continue;

      const startRoad = this.findAdjacentRoad(from.x, from.y, grid);
      const endRoad = this.findAdjacentRoad(to.x, to.y, grid);
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
      const [x, y] = cellKey.split(',').map(Number);
      const cell = grid.getCell(x!, y!);
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
      const dist = Math.abs(s.x - pos.x) + Math.abs(s.y - pos.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    return best;
  }

  private findAdjacentRoad(
    x: number,
    y: number,
    grid: { getCell(x: number, y: number): { roadType: number } | null },
  ): { x: number; y: number } | null {
    // If the cell itself is a road, use it directly
    const self = grid.getCell(x, y);
    if (self && self.roadType > 0) return { x, y };
    // Otherwise find an adjacent road cell
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx!;
      const ny = y + dy!;
      const cell = grid.getCell(nx, ny);
      if (cell && cell.roadType > 0) return { x: nx, y: ny };
    }
    return null;
  }
}

export function countResidentialCapacity(grid: { width: number; height: number; getCell(x: number, y: number): { buildingId: number; zoneType: number; reserved?: number } | null }): number {
  let capacity = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.getCell(x, y);
      // Exclude burned (reserved=3) and multi-cell secondary (reserved=4) cells
      if (cell && cell.buildingId > 0 && isResidentialZone(cell.zoneType as ZoneType) && cell.reserved !== BURNED && cell.reserved !== MULTI_CELL_OCCUPIED) {
        const bt = getBuildingType(cell.buildingId);
        capacity += bt ? bt.residents : 0;
      }
    }
  }
  return capacity;
}

export function countWorkplaceJobs(grid: { width: number; height: number; getCell(x: number, y: number): { buildingId: number; zoneType: number; reserved?: number } | null }): number {
  let jobs = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.getCell(x, y);
      // Exclude burned (reserved=3) and multi-cell secondary (reserved=4) cells
      if (cell && cell.buildingId > 0 && isWorkplaceZone(cell.zoneType as ZoneType) && cell.reserved !== BURNED && cell.reserved !== MULTI_CELL_OCCUPIED) {
        const bt = getBuildingType(cell.buildingId);
        jobs += bt ? bt.workers : 0;
      }
    }
  }
  return jobs;
}

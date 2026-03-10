import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue } from '../economy/LandValue';
import { ZoneType } from '../grid/types';
import { RoadType, ROAD_CONFIGS } from '../road/types';
import { getLaneCount } from '../traffic/TrafficSimulation';
import { LaneGraph } from '../traffic/LaneGraph';
import { refineLanePath } from '../traffic/Pathfinding';
import { getBuildingType } from '../building/types';
import { getInfraConfigById } from '../building/InfraConfig';
import { findPrimaryCell, MULTI_CELL_OCCUPIED } from '../building/InfraPlacement';
import { getSpecializationBonus } from '../district/Specialization';
import { IncomeLevel } from '../citizen/types';
import type { TimeOfDay } from './GameClock';
import { chooseMode, type AvailableTransport } from '../transport/ModeChoice';
import { TransportMode, TransportType } from '../transport/types';

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
    this.state.traffic.tick(
      (current, next) => {
        const [cx, cy] = current.split(',').map(Number);
        const [nx, ny] = next.split(',').map(Number);
        return this.state.trafficLights.canPass(cx!, cy!, nx!, ny!);
      },
      (cellKey) => {
        const [x, y] = cellKey.split(',').map(Number);
        const cell = this.state.grid.getCell(x!, y!);
        if (!cell || cell.roadType === RoadType.NONE) return 50; // default
        return ROAD_CONFIGS[cell.roadType as RoadType]?.speedLimit ?? 50;
      },
      (cellKey) => {
        const [x, y] = cellKey.split(',').map(Number);
        const cell = this.state.grid.getCell(x!, y!);
        if (!cell || cell.roadType === RoadType.NONE) return 1;
        return getLaneCount(cell.roadType);
      },
    );

    // 8. Transport systems (every tick)
    this.state.bus.tick();
    this.state.metro.tick();
    this.state.tram.tick();
    this.state.rail.tick();
    this.state.ferry.tick();
    this.state.airport.tick();
    this.state.taxi.tick();

    // 8b. Freight: industrial→commercial cargo flow (every tick)
    this.state.freight.tick(this.state.grid);

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
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && cell.buildingId > 0) {
          // Check zone type matches
          if (type === 'residential' && (cell.zoneType === 1 || cell.zoneType === 2)) count++;
          if (type === 'commercial' && (cell.zoneType === 3 || cell.zoneType === 4)) count++;
          if (type === 'industrial' && cell.zoneType === 5) count++;
        }
      }
    }
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

    // Try growing on a sample of cells each tick (not all 60x60)
    const attempts = 20;
    for (let i = 0; i < attempts; i++) {
      const x = Math.floor(Math.random() * grid.width);
      const y = Math.floor(Math.random() * grid.height);
      const cell = grid.getCell(x, y);
      if (!cell || cell.zoneType === 0) continue;

      // Burned buildings: developer must demolish ruins first (extra cost/time)
      if (cell.reserved === 3 && cell.buildingId > 0 && cell.buildingId < 245) {
        // ~2% chance per attempt to clear the ruins (developer demolition takes time)
        if (Math.random() < 0.02) {
          grid.setCell(x, y, { buildingId: 0, reserved: 0 });
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
        growth.tryGrow(x, y, conditions);
      }
    }
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
    migrationTick(this.state.citizens, city);
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
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && cell.buildingId > 0 &&
            (cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH)) {
          total++;
          if (this.state.power.isPowered(x, y)) powered++;
          if (this.state.water.isSupplied(x, y)) watered++;
        }
      }
    }
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
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && (cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH)) {
          total += cell.pollution;
          count++;
        }
      }
    }
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

    // Income level multipliers for income tax
    const incomeMultiplier = (level: IncomeLevel): number => {
      switch (level) {
        case IncomeLevel.LOW: return 1.0;
        case IncomeLevel.MEDIUM: return 1.5;
        case IncomeLevel.HIGH: return 2.0;
        default: return 1.0;
      }
    };

    // Level multipliers for business tax
    const levelMultiplier = (level: 1 | 2 | 3): number => {
      switch (level) {
        case 1: return 1.0;
        case 2: return 1.5;
        case 3: return 2.0;
        default: return 1.0;
      }
    };

    let totalIncome = 0;

    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        // Skip infrastructure, empty cells, burned (3), and multi-cell secondary (4)
        if (cell && cell.buildingId > 0 && cell.buildingId < 245 && cell.reserved !== 3 && cell.reserved !== 4) {
          const btype = getBuildingType(cell.buildingId);
          if (!btype) continue;

          let buildingIncome = 0;
          const isResidential = btype.zoneType === ZoneType.RESIDENTIAL_LOW || btype.zoneType === ZoneType.RESIDENTIAL_HIGH;

          if (isResidential) {
            // Income tax: scan citizens living in this building
            const posKey = `${x},${y}`;
            const residents = this.state.citizens.getCitizensByHome(posKey);
            for (const citizen of residents) {
              // Per-citizen tax = baseFactor(0.5) x incomeLevel multiplier x incomeTaxRate
              buildingIncome += 0.5 * incomeMultiplier(citizen.incomeLevel) * (incomeTaxRate / 100);
            }
          } else {
            // Business tax: companyIncome x levelMultiplier x businessTaxRate
            const ci = btype.companyIncome ?? 0;
            buildingIncome = ci * levelMultiplier(btype.level) * (businessTaxRate / 100);
          }

          // Apply district specialization revenue multiplier
          const district = this.state.districts.getDistrictAt(x, y);
          if (district) {
            const bonus = getSpecializationBonus(district.specialization);
            buildingIncome *= bonus.revenueMultiplier;
          }
          totalIncome += buildingIncome;
        }
      }
    }
    // Apply city-wide specialization revenue multiplier
    const citySpecBonus = this.state.citySpec.getBonus();
    totalIncome *= citySpecBonus.revenueMultiplier;

    this.state.budget.income = totalIncome;
    // Expenses: road maintenance + infrastructure + civic service operating costs
    const roadMaint = this.countRoadTiles() * 0.1;
    const powerCost = this.state.power.getPlants().length * 5;
    const waterCost = this.state.water.getPlants().length * 3;
    const policeCost = this.state.police.getStations().length * 4;
    const fireCost = this.state.fire.getStations().length * 4;
    const healthCost = this.state.health.getHospitals().length * 8;
    const educationCost = this.state.education.getSchools().length * 5;
    const parkCost = this.state.parks.getParks().length * 2;
    const garbageCost = this.state.garbage.getFacilities().length * 3;
    const sewageCost = this.state.sewage.getTreatmentPlants().length * 4;
    const deathCareCost = (this.state.deathCare.getCemeteries().length + this.state.deathCare.getCrematoria().length) * 2;
    // District policy costs: sum all active policy costs across all districts
    let policyCost = 0;
    for (const district of this.state.districts.getAllDistricts()) {
      for (const policy of district.policies) {
        if (policy.active) policyCost += policy.cost;
      }
    }
    // Transport operating costs
    const transportCost = this.state.bus.getOperatingCost()
      + this.state.metro.getOperatingCost()
      + this.state.tram.getOperatingCost()
      + this.state.rail.getOperatingCost()
      + this.state.ferry.getOperatingCost()
      + this.state.airport.getOperatingCost()
      + this.state.taxi.getOperatingCost();
    this.state.budget.expenses = roadMaint + powerCost + waterCost + policeCost + fireCost + healthCost + educationCost + parkCost + garbageCost + sewageCost + deathCareCost + policyCost + transportCost;
  }

  private countRoadTiles(): number {
    let count = 0;
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && cell.roadType > 0) count++;
      }
    }
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
    const resolved = fire.resolveCompletedFires();
    for (const f of resolved) {
      if (f.damage >= 0.5) {
        // High damage: mark building as BURNED (charred ruins)
        const cell = this.state.grid.getCell(f.x, f.y);
        if (cell && cell.buildingId > 0 && cell.buildingId < 245) {
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
                    this.state.grid.setCell(primary.x + dx, primary.y + dy, { reserved: 3 });
                  }
                }
              }
            }
          } else {
            this.state.grid.setCell(f.x, f.y, { reserved: 3 }); // BuildingStatus.BURNED
          }
        }
      }
    }
  }

  private updatePollution(): void {
    const grid = this.state.grid;
    const pm = this.state.pollution;

    pm.clearSources();

    // Industrial buildings produce ground pollution; roads produce noise
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.buildingId > 0 && cell.zoneType === ZoneType.INDUSTRIAL) {
          pm.addSource(x, y, 60, 'ground');
          pm.addSource(x, y, 40, 'noise');
        }
        if (cell.roadType > 0 && cell.trafficDensity > 0) {
          pm.addSource(x, y, cell.trafficDensity * 10, 'noise');
        }
      }
    }

    // Garbage facilities produce ground pollution based on load
    for (const facility of this.state.garbage.getFacilities()) {
      const loadRatio = facility.currentLoad / facility.capacity;
      if (loadRatio > 0.5) {
        pm.addSource(facility.x, facility.y, Math.round(loadRatio * 40), 'ground');
      }
    }
    // Garbage overflow produces distributed pollution
    const garbagePenalty = this.state.garbage.getPollutionPenalty();
    if (garbagePenalty > 0) {
      const cx = Math.floor(grid.width / 2);
      const cy = Math.floor(grid.height / 2);
      pm.addSource(cx, cy, garbagePenalty, 'ground');
    }

    // Untreated sewage produces water pollution at sewage outlet locations
    const sewagePollution = this.state.sewage.getWaterPollution();
    if (sewagePollution > 0) {
      for (const outlet of this.state.sewage.getOutlets()) {
        pm.addSource(outlet.x, outlet.y, Math.min(80, sewagePollution), 'ground');
      }
    }

    pm.calculateSpread();

    // Write pollution back to grid cells
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const p = pm.getPollutionAt(x, y);
        const total = Math.min(255, p.ground + p.noise);
        const cell = grid.getCell(x, y);
        if (cell && cell.pollution !== total) {
          grid.setCell(x, y, { pollution: total });
        }
      }
    }
  }

  private updateLandValue(): void {
    const grid = this.state.grid;

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell || cell.buildingId === 0) continue;

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
          for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
              if (Math.abs(dx) + Math.abs(dy) > 2) continue;
              const nc = grid.getCell(x + dx, y + dy);
              if (nc && (nc.terrainType === 3 || nc.buildingId === 248)) { parkProximity = true; break; }
            }
            if (parkProximity) break;
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
      }
    }
  }

  private tryBuildingUpgrades(): void {
    const grid = this.state.grid;
    const upgrade = this.state.buildingUpgrade;

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
      if (!upgrade.tryUpgrade(x, y, conditions)) {
        upgrade.tryDowngrade(x, y, conditions);
      }
    }
  }

  /**
   * Rebuild the building position list. Called once per game day.
   * Stores every building's grid position so each is uniquely addressable.
   */
  private rebuildBuildingIndex(): void {
    const currentDay = this.state.clock.getDay();
    if (this.buildingIndexDay === currentDay && this.buildingPositions.length > 0) return;

    this.buildingPositions = [];
    const grid = this.state.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.buildingId > 0 && cell.buildingId < 245) {
          this.buildingPositions.push({ pos: `${x},${y}`, x, y, buildingId: cell.buildingId });
        }
      }
    }
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

  /** Mark the lane graph as needing rebuild (call after road build/demolish). */
  markLaneGraphDirty(): void {
    this.laneGraphDirty = true;
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
        continue;
      }

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

      const path = this.bfsRoadPath(startRoad, endRoad, grid);
      if (path && path.length >= 2) {
        // Try edge-based path first (new lane graph system)
        const startCell = this.state.grid.getCell(startRoad.x, startRoad.y);
        const dirLanes = startCell ? getLaneCount(startCell.roadType) : 1;
        const preferredLane = dirLanes > 1 ? Math.floor(Math.random() * dirLanes) : 0;
        const edgePath = refineLanePath(this.laneGraph, path, preferredLane);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addVehicleOnEdges(edgePath);
        } else {
          // Fallback to cell-based path
          this.state.traffic.addVehicle(path, dirLanes);
        }
        commuterSet.add(citizen.id);
        spawned++;
      } else {
        commuterSet.add(citizen.id); // no path, don't retry
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

    const systems: { type: TransportType; routes: readonly { stops: readonly { x: number; y: number }[] }[] }[] = [
      { type: TransportType.BUS, routes: this.state.bus.getRoutes() },
      { type: TransportType.METRO, routes: this.state.metro.getLines() },
      { type: TransportType.TRAM, routes: this.state.tram.getRoutes() },
      { type: TransportType.RAIL, routes: this.state.rail.getLines() },
      { type: TransportType.FERRY, routes: this.state.ferry.getRoutes() },
    ];

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

      const path = this.bfsRoadPath(startRoad, endRoad, grid);
      if (path && path.length >= 2) {
        const sCell = this.state.grid.getCell(startRoad.x, startRoad.y);
        const dLanes = sCell ? getLaneCount(sCell.roadType) : 1;
        const prefLane = dLanes > 1 ? Math.floor(Math.random() * dLanes) : 0;
        const edgePath = refineLanePath(this.laneGraph, path, prefLane);
        if (edgePath && edgePath.length > 0) {
          this.state.traffic.addVehicleOnEdges(edgePath);
        } else {
          this.state.traffic.addVehicle(path, dLanes);
        }
      }
    }
  }

  private bfsRoadPath(
    start: { x: number; y: number },
    end: { x: number; y: number },
    grid: { getCell(x: number, y: number): { roadType: number } | null; width: number; height: number },
  ): string[] | null {
    const key = (x: number, y: number) => `${x},${y}`;
    const target = key(end.x, end.y);
    const visited = new Set<string>();
    const queue: { x: number; y: number; path: string[] }[] = [
      { x: start.x, y: start.y, path: [key(start.x, start.y)] },
    ];
    visited.add(key(start.x, start.y));

    // Limit BFS depth to avoid long searches
    let steps = 0;
    const maxSteps = 500;

    while (queue.length > 0 && steps < maxSteps) {
      steps++;
      const current = queue.shift()!;
      if (key(current.x, current.y) === target) {
        return current.path;
      }

      const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dx, dy] of dirs) {
        const nx = current.x + dx!;
        const ny = current.y + dy!;
        const nk = key(nx, ny);
        if (visited.has(nk)) continue;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const cell = grid.getCell(nx, ny);
        if (!cell || cell.roadType === 0) continue;
        visited.add(nk);
        queue.push({ x: nx, y: ny, path: [...current.path, nk] });
      }
    }

    return null; // No path found
  }

  /**
   * Compute predicted congestion flow by sampling OD pairs (residential → commercial/industrial)
   * and running the same BFS pathfinding. Updates the traffic overlay without needing actual vehicles.
   */
  private computeCongestionFlow(): void {
    const grid = this.state.grid;
    const residential: { x: number; y: number }[] = [];
    const destinations: { x: number; y: number }[] = [];

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell || cell.buildingId === 0) continue;
        if (cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH) {
          residential.push({ x, y });
        } else if (
          cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH ||
          cell.zoneType === ZoneType.INDUSTRIAL || cell.zoneType === ZoneType.OFFICE
        ) {
          destinations.push({ x, y });
        }
      }
    }

    if (residential.length === 0 || destinations.length === 0) {
      this.state.traffic.updatePredictedFlow(new Map());
      return;
    }

    // Sample up to 200 OD pairs, applying the same filters as actual vehicle spawning
    const sampleCount = Math.min(200, residential.length * destinations.length);
    const flowMap = new Map<string, number>();

    for (let i = 0; i < sampleCount; i++) {
      const from = residential[Math.floor(Math.random() * residential.length)]!;
      const to = destinations[Math.floor(Math.random() * destinations.length)]!;
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

      const path = this.bfsRoadPath(startRoad, endRoad, grid);
      if (!path) continue;

      for (const cellKey of path) {
        flowMap.set(cellKey, (flowMap.get(cellKey) ?? 0) + 1);
      }
    }

    // Normalize by road capacity (lane count) so wide roads show lower congestion
    for (const [cellKey, rawFlow] of flowMap) {
      const [x, y] = cellKey.split(',').map(Number);
      const cell = grid.getCell(x!, y!);
      const lanes = cell ? getLaneCount(cell.roadType) : 1;
      flowMap.set(cellKey, rawFlow / lanes);
    }

    this.state.traffic.updatePredictedFlow(flowMap);
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
      if (cell && cell.buildingId > 0 && (cell.zoneType === 1 || cell.zoneType === 2) && cell.reserved !== 3 && cell.reserved !== 4) {
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
      if (cell && cell.buildingId > 0 && cell.zoneType >= 3 && cell.reserved !== 3 && cell.reserved !== 4) {
        const bt = getBuildingType(cell.buildingId);
        jobs += bt ? bt.workers : 0;
      }
    }
  }
  return jobs;
}

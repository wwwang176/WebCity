import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';
import { calculateHappiness, type HappinessFactors } from '../citizen/Happiness';
import { calculateLandValue } from '../economy/LandValue';
import { ZoneType } from '../grid/types';
import { RoadType, ROAD_CONFIGS } from '../road/types';
import { getLaneCount } from '../traffic/TrafficSimulation';
import { getBuildingType } from '../building/types';
import type { TimeOfDay } from './GameClock';

export class SimulationLoop {
  private state: GameState;
  private lastAgeYear = -1;

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

    // 5. Citizens aging (once per game year)
    const currentYear = this.state.clock.getYear();
    if (currentYear !== this.lastAgeYear) {
      this.lastAgeYear = currentYear;
      this.state.citizens.ageTick();
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

    // 7. Traffic - spawn commute vehicles and advance (every tick for smooth traffic)
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
    );

    // 8. Calculate income from buildings (every 6 ticks)
    if (isSlowTick) {
      this.calculateIncome();
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
      if (cell && cell.zoneType > 0 && cell.buildingId === 0) {
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
    let income = 0;
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        // Skip infrastructure (buildingId 245-254) and empty cells
        if (cell && cell.buildingId > 0 && cell.buildingId < 245) {
          const level = cell.buildingId; // building level stored in buildingId
          income += level * 2; // base income per building per tick
        }
      }
    }
    const taxRate = this.state.taxRates.residential ?? 9;
    this.state.budget.income = income * (taxRate / 100);
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
    this.state.budget.expenses = roadMaint + powerCost + waterCost + policeCost + fireCost + healthCost + educationCost + parkCost + garbageCost + sewageCost + deathCareCost;
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

        // Check if near water or forest (natural park) within 2 cells
        let waterfront = false;
        let parkProximity = false;
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const [dx, dy] of dirs) {
          const nc = grid.getCell(x + dx!, y + dy!);
          if (nc && nc.terrainType === 1) waterfront = true;
          if (nc && nc.terrainType === 3) parkProximity = true; // FOREST = natural park
        }
        // Also check 2-cell radius for parks
        if (!parkProximity) {
          for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
              if (Math.abs(dx) + Math.abs(dy) > 2) continue;
              const nc = grid.getCell(x + dx, y + dy);
              if (nc && nc.terrainType === 3) { parkProximity = true; break; }
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
        const startCell = this.state.grid.getCell(startRoad.x, startRoad.y);
        const directionalLanes = startCell ? getLaneCount(startCell.roadType) : 1;
        this.state.traffic.addVehicle(path, directionalLanes);
        commuterSet.add(citizen.id);
        spawned++;
      } else {
        commuterSet.add(citizen.id); // no path, don't retry
      }
    }
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
        const startCell = this.state.grid.getCell(startRoad.x, startRoad.y);
        const directionalLanes = startCell ? getLaneCount(startCell.roadType) : 1;
        this.state.traffic.addVehicle(path, directionalLanes);
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

export function countResidentialCapacity(grid: { width: number; height: number; getCell(x: number, y: number): { buildingId: number; zoneType: number } | null }): number {
  let capacity = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.getCell(x, y);
      if (cell && cell.buildingId > 0 && (cell.zoneType === 1 || cell.zoneType === 2)) {
        const bt = getBuildingType(cell.buildingId);
        capacity += bt ? bt.residents : 0;
      }
    }
  }
  return capacity;
}

export function countWorkplaceJobs(grid: { width: number; height: number; getCell(x: number, y: number): { buildingId: number; zoneType: number } | null }): number {
  let jobs = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.getCell(x, y);
      if (cell && cell.buildingId > 0 && cell.zoneType >= 3) {
        const bt = getBuildingType(cell.buildingId);
        jobs += bt ? bt.workers : 0;
      }
    }
  }
  return jobs;
}

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

export class SimulationLoop {
  private state: GameState;
  private lastAgeYear = -1;

  constructor(state: GameState) {
    this.state = state;
  }

  tick(): void {
    if (!this.state.clock.advance()) return;

    // 1. Economy: RCI demand
    const rci = calculateRCIDemand({
      residentialSupply: this.countZoneBuildings('residential'),
      commercialSupply: this.countZoneBuildings('commercial'),
      industrialSupply: this.countZoneBuildings('industrial'),
      population: this.state.citizens.getPopulation(),
      jobOpenings: this.countJobOpenings(),
      exportDemand: 10,
    });
    this.state.rciDemand = rci;

    // 2. Budget tick
    this.state.budget = tickBudget(this.state.budget);

    // 3. Services (power/water coverage)
    // Collect all infrastructure positions so BFS can traverse through plants
    const infraPositions = new Set<string>();
    for (const p of this.state.power.getPlants()) infraPositions.add(`${p.x},${p.y}`);
    for (const p of this.state.water.getPlants()) infraPositions.add(`${p.x},${p.y}`);
    this.state.power.calculateCoverage(this.state.grid, infraPositions);
    this.state.water.calculateCoverage(this.state.grid, infraPositions);

    // 3.5 Civic services tick
    this.state.police.tick();
    this.state.fire.tick();
    this.state.health.tick();
    this.state.education.tick();
    this.state.parks.tick();
    this.state.garbage.tick(this.state.citizens.getPopulation());
    this.state.sewage.tick(this.state.citizens.getPopulation());
    this.state.deathCare.tick();

    // 3.6. Pollution & land value: update every 10 ticks (performance)
    if (this.state.clock.tick % 10 === 0) {
      this.updatePollution();
      this.updateLandValue();
    }

    // 4. Building growth - try to grow on random empty zoned cells
    this.tryBuildingGrowth();

    // 4.5. Building upgrades/downgrades based on conditions
    this.tryBuildingUpgrades();

    // 5. Citizens aging (once per game year)
    const currentYear = this.state.clock.getYear();
    if (currentYear !== this.lastAgeYear) {
      this.lastAgeYear = currentYear;
      this.state.citizens.ageTick();
    }

    // 5.5. Update citizen happiness based on actual city conditions
    this.updateCitizenHappiness();

    // 6. Migration - citizens move in/out
    this.runMigration();

    // 7. Traffic - spawn commute vehicles and advance
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

    // 8. Calculate income from buildings
    this.calculateIncome();
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

  private spawnVehicles(): void {
    // Limit active vehicles
    if (this.state.traffic.getVehicleCount() >= 50) return;

    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Spawn 1-3 vehicles per tick based on population
    const spawnCount = Math.min(3, Math.max(1, Math.floor(pop / 100)));
    const grid = this.state.grid;
    const roads: { x: number; y: number }[] = [];
    const residentialCells: { x: number; y: number }[] = [];
    const workCells: { x: number; y: number }[] = [];

    // Collect road locations and building locations by type
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.roadType > 0) roads.push({ x, y });
        if (cell.buildingId > 0) {
          if (cell.zoneType === ZoneType.RESIDENTIAL_LOW || cell.zoneType === ZoneType.RESIDENTIAL_HIGH) {
            residentialCells.push({ x, y });
          } else if (cell.zoneType === ZoneType.COMMERCIAL_LOW || cell.zoneType === ZoneType.COMMERCIAL_HIGH ||
                     cell.zoneType === ZoneType.INDUSTRIAL || cell.zoneType === ZoneType.OFFICE) {
            workCells.push({ x, y });
          }
        }
      }
    }

    if (roads.length < 2) return;

    // Use building cells for start/end if available, fallback to random roads
    const startPool = residentialCells.length > 0 ? residentialCells : roads;
    const endPool = workCells.length > 0 ? workCells : roads;

    for (let i = 0; i < spawnCount; i++) {
      const start = startPool[Math.floor(Math.random() * startPool.length)]!;
      const end = endPool[Math.floor(Math.random() * endPool.length)]!;
      if (start.x === end.x && start.y === end.y) continue;

      // Find adjacent road cells for start/end (buildings aren't roads)
      const startRoad = this.findAdjacentRoad(start.x, start.y, grid);
      const endRoad = this.findAdjacentRoad(end.x, end.y, grid);
      if (!startRoad || !endRoad) continue;
      if (startRoad.x === endRoad.x && startRoad.y === endRoad.y) continue;

      // BFS along road cells to find path
      const path = this.bfsRoadPath(startRoad, endRoad, grid);
      if (path && path.length >= 2) {
        // Determine lane count from the road type at the start of the path
        const startCell = grid.getCell(startRoad.x, startRoad.y);
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

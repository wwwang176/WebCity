import { type GameState } from './GameState';
import { tickBudget } from '../economy/Budget';
import { calculateRCIDemand } from '../economy/RCIDemand';
import { migrationTick } from '../citizen/Migration';

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
    this.state.power.calculateCoverage(this.state.grid);
    this.state.water.calculateCoverage(this.state.grid);

    // 4. Building growth - try to grow on random empty zoned cells
    this.tryBuildingGrowth();

    // 5. Citizens aging (once per game year)
    const currentYear = this.state.clock.getYear();
    if (currentYear !== this.lastAgeYear) {
      this.lastAgeYear = currentYear;
      this.state.citizens.ageTick();
    }

    // 6. Migration - citizens move in/out
    this.runMigration();

    // 7. Traffic - spawn commute vehicles and advance
    this.spawnVehicles();
    this.state.traffic.tick();

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
    // Simple: count commercial + industrial buildings * 5 - employed citizens
    let jobs = 0;
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && cell.buildingId > 0 && (cell.zoneType >= 3)) {
          jobs += 5; // each commercial/industrial/office building offers ~5 jobs
        }
      }
    }
    return Math.max(0, jobs - this.state.citizens.getPopulation());
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
    // Empty city is attractive to first settlers; as pop grows, use actual happiness
    const avgHappiness = pop === 0 ? 70 : Math.max(40, 70 - pop * 0.01);
    const city = {
      jobOpenings: this.countJobOpenings(),
      vacantHomes: this.countVacantHomes(),
      avgHappiness,
      taxRate: this.state.taxRates.residential ?? 9,
      pollution: 5,
      crimeRate: 5,
    };
    migrationTick(this.state.citizens, city);
  }

  private countVacantHomes(): number {
    let homes = 0;
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && cell.buildingId > 0 && (cell.zoneType === 1 || cell.zoneType === 2)) {
          homes += 5; // each residential building has ~5 capacity
        }
      }
    }
    return Math.max(0, homes - this.state.citizens.getPopulation());
  }

  private calculateIncome(): void {
    let income = 0;
    for (let y = 0; y < this.state.grid.height; y++) {
      for (let x = 0; x < this.state.grid.width; x++) {
        const cell = this.state.grid.getCell(x, y);
        if (cell && cell.buildingId > 0) {
          const level = cell.buildingId; // building level stored in buildingId
          income += level * 2; // base income per building per tick
        }
      }
    }
    const taxRate = this.state.taxRates.residential ?? 9;
    this.state.budget.income = income * (taxRate / 100);
    this.state.budget.expenses = this.countRoadTiles() * 0.1; // road maintenance
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

  private spawnVehicles(): void {
    // Limit active vehicles
    if (this.state.traffic.getVehicleCount() >= 50) return;

    const pop = this.state.citizens.getPopulation();
    if (pop === 0) return;

    // Spawn 1-3 vehicles per tick based on population
    const spawnCount = Math.min(3, Math.max(1, Math.floor(pop / 100)));
    const grid = this.state.grid;
    const roads: { x: number; y: number }[] = [];

    // Collect all road locations
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (cell && cell.roadType > 0) roads.push({ x, y });
      }
    }

    if (roads.length < 2) return;

    for (let i = 0; i < spawnCount; i++) {
      const start = roads[Math.floor(Math.random() * roads.length)]!;
      const end = roads[Math.floor(Math.random() * roads.length)]!;
      if (start.x === end.x && start.y === end.y) continue;

      // BFS along road cells to find path
      const path = this.bfsRoadPath(start, end, grid);
      if (path && path.length >= 2) {
        this.state.traffic.addVehicle(path);
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
}

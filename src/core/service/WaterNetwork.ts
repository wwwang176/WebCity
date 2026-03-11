import { Grid } from '../grid/Grid';
import { toPosKey } from '../grid/GridHelpers';
import { calculateNetworkCoverage } from './NetworkCoverage';

export interface WaterPlant {
  x: number;
  y: number;
  output: number;
}

export const WATER_NETWORK = {
  PLANT_RANGE: 10,
  RELAY_RANGE: 2,
  MAINTENANCE_PER_PLANT: 3,
} as const;

export class WaterNetwork {
  private plants: WaterPlant[] = [];
  private supplied = new Set<string>();

  addPlant(plant: WaterPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    this.supplied.clear();
    for (const plant of this.plants) {
      this.coverPlant(grid, plant.x, plant.y, infrastructurePositions);
    }
    return this.supplied;
  }

  isSupplied(x: number, y: number): boolean {
    return this.supplied.has(toPosKey(x, y));
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  getMaintenanceCost(): number {
    return this.plants.length * WATER_NETWORK.MAINTENANCE_PER_PLANT;
  }

  getPlants(): readonly WaterPlant[] {
    return this.plants;
  }

  private coverPlant(grid: Grid, px: number, py: number, infra?: Set<string>): void {
    calculateNetworkCoverage(grid, px, py, WATER_NETWORK.PLANT_RANGE, WATER_NETWORK.RELAY_RANGE, this.supplied, infra);
  }
}

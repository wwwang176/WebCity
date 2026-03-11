import { Grid } from '../grid/Grid';
import { toPosKey } from '../grid/GridHelpers';
import { calculateNetworkCoverage } from './NetworkCoverage';

export interface PowerPlant {
  x: number;
  y: number;
  output: number;
  pollution: number;
  type: 'wind' | 'solar' | 'coal' | 'gas' | 'nuclear';
}

export const POWER = {
  PLANT_RANGE: 10,
  RELAY_RANGE: 2,
  MAINTENANCE_PER_PLANT: 5,
} as const;

export class PowerGrid {
  private plants: PowerPlant[] = [];
  private powered = new Set<string>();

  addPlant(plant: PowerPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    this.powered.clear();
    for (const plant of this.plants) {
      this.coverPlant(grid, plant.x, plant.y, infrastructurePositions);
    }
    return this.powered;
  }

  isPowered(x: number, y: number): boolean {
    return this.powered.has(toPosKey(x, y));
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  getMaintenanceCost(): number {
    return this.plants.length * POWER.MAINTENANCE_PER_PLANT;
  }

  getPlants(): readonly PowerPlant[] {
    return this.plants;
  }

  private coverPlant(grid: Grid, px: number, py: number, infra?: Set<string>): void {
    calculateNetworkCoverage(grid, px, py, POWER.PLANT_RANGE, POWER.RELAY_RANGE, this.powered, infra);
  }
}

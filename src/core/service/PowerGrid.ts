import { Grid } from '../grid/Grid';
import { toPosKey } from '../grid/GridHelpers';
import { calculateNetworkCoverage } from './NetworkCoverage';
import { ZoneType, isResidentialZone, isCommercialZone } from '../grid/types';
import { getBuildingType } from '../building/types';
import { getInfraConfigById, getInfraBuildingId } from '../building/InfraConfig';

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

export const POWER_CONSUMPTION = {
  RESIDENTIAL: { base: 0.5, perCapita: 0.05 },
  COMMERCIAL:  { base: 1,   perCapita: 0.08 },
  INDUSTRIAL:  { base: 2,   perCapita: 0.12 },
  OFFICE:      { base: 1,   perCapita: 0.05 },
} as const;

export const INFRA_POWER_CONSUMPTION: Record<string, number> = {
  police: 10,
  fire: 10,
  health: 18,
  elementary: 8,
  highschool: 12,
  university: 16,
  garbage: 15,
  water: 20,
  sewage: 15,
  park: 3,
  cemetery: 3,
};

const INFRA_TYPE_TO_CONSUMPTION_KEY: Record<string, string> = {
  police: 'police',
  fire: 'fire',
  hospital: 'health',
  school: 'elementary',
  school_high: 'highschool',
  school_univ: 'university',
  garbage: 'garbage',
  water: 'water',
  sewage: 'sewage',
  park: 'park',
  cemetery: 'cemetery',
};

// Power plant buildingId — excluded from demand
const POWER_PLANT_ID = getInfraBuildingId('power');

export class PowerGrid {
  private plants: PowerPlant[] = [];
  private powered = new Set<string>();
  private fullCoverage = new Set<string>();
  private totalDemand = 0;

  addPlant(plant: PowerPlant): void {
    this.plants.push(plant);
  }

  removePlant(x: number, y: number): boolean {
    const idx = this.plants.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) { this.plants.splice(idx, 1); return true; }
    return false;
  }

  calculateCoverage(grid: Grid, infrastructurePositions?: Set<string>): Set<string> {
    this.fullCoverage = new Set<string>();
    for (const plant of this.plants) {
      calculateNetworkCoverage(grid, plant.x, plant.y, POWER.PLANT_RANGE, POWER.RELAY_RANGE, this.fullCoverage, infrastructurePositions);
    }

    // Apply supply ratio: if supply < demand, trim coverage from farthest cells
    const ratio = this.getSupplyRatio();
    if (ratio >= 1.0 || this.fullCoverage.size === 0) {
      this.powered = new Set(this.fullCoverage);
    } else {
      this.powered = this.trimCoverageByDistance(this.fullCoverage, ratio);
    }
    return this.powered;
  }

  calculateDemand(grid: Grid): void {
    let demand = 0;
    grid.forEachCell((cell) => {
      if (cell.buildingId <= 0) return;

      // Check if it's a zone building
      const bt = getBuildingType(cell.buildingId);
      if (bt) {
        demand += this.getZoneDemand(cell.zoneType, bt.residents, bt.workers);
        return;
      }

      // Check if it's an infrastructure building (not power plant)
      if (cell.buildingId === POWER_PLANT_ID) return;
      const infraCfg = getInfraConfigById(cell.buildingId);
      if (infraCfg) {
        const key = INFRA_TYPE_TO_CONSUMPTION_KEY[infraCfg.type];
        if (key && INFRA_POWER_CONSUMPTION[key] !== undefined) {
          demand += INFRA_POWER_CONSUMPTION[key];
        }
      }
    });
    this.totalDemand = demand;
  }

  isPowered(x: number, y: number): boolean {
    return this.powered.has(toPosKey(x, y));
  }

  isInCoverage(x: number, y: number): boolean {
    return this.fullCoverage.has(toPosKey(x, y));
  }

  getTotalOutput(): number {
    return this.plants.reduce((sum, p) => sum + p.output, 0);
  }

  getSupply(): number {
    return this.getTotalOutput();
  }

  getDemand(): number {
    return this.totalDemand;
  }

  getSupplyRatio(): number {
    if (this.totalDemand === 0) return 1.0;
    const supply = this.getTotalOutput();
    if (supply === 0) return 0;
    return Math.min(1.0, supply / this.totalDemand);
  }

  getMaintenanceCost(): number {
    return this.plants.length * POWER.MAINTENANCE_PER_PLANT;
  }

  getPlants(): readonly PowerPlant[] {
    return this.plants;
  }

  private getZoneDemand(zoneType: ZoneType, residents: number, workers: number): number {
    if (isResidentialZone(zoneType)) {
      return POWER_CONSUMPTION.RESIDENTIAL.base + POWER_CONSUMPTION.RESIDENTIAL.perCapita * residents;
    }
    if (isCommercialZone(zoneType)) {
      return POWER_CONSUMPTION.COMMERCIAL.base + POWER_CONSUMPTION.COMMERCIAL.perCapita * workers;
    }
    if (zoneType === ZoneType.INDUSTRIAL) {
      return POWER_CONSUMPTION.INDUSTRIAL.base + POWER_CONSUMPTION.INDUSTRIAL.perCapita * workers;
    }
    if (zoneType === ZoneType.OFFICE) {
      return POWER_CONSUMPTION.OFFICE.base + POWER_CONSUMPTION.OFFICE.perCapita * workers;
    }
    return 0;
  }

  private trimCoverageByDistance(fullCoverage: Set<string>, ratio: number): Set<string> {
    // Calculate distance from nearest plant for each covered cell
    const entries: { key: string; dist: number }[] = [];
    for (const key of fullCoverage) {
      const i = key.indexOf(',');
      const cx = Number(key.slice(0, i));
      const cy = Number(key.slice(i + 1));
      let minDist = Infinity;
      for (const p of this.plants) {
        const d = Math.sqrt((cx - p.x) ** 2 + (cy - p.y) ** 2);
        if (d < minDist) minDist = d;
      }
      entries.push({ key, dist: minDist });
    }
    // Sort by distance (nearest first)
    entries.sort((a, b) => a.dist - b.dist);
    // Keep only ratio fraction of cells (nearest first)
    const keep = Math.max(1, Math.floor(entries.length * ratio));
    const trimmed = new Set<string>();
    for (let i = 0; i < keep; i++) {
      trimmed.add(entries[i]!.key);
    }
    return trimmed;
  }
}

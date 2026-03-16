import type { SizedGrid } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';
import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';

export interface PoliceStation {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export const POLICE = {
  CRIME_REDUCTION_PER_STATION: -30,
  CRIME_REDUCTION_CAP: -60,
  MAINTENANCE_PER_STATION: 4,
} as const;

export class PoliceService extends RoadCoverageService<PoliceStation> {
  protected readonly coverageBudget = ROAD_COVERAGE.POLICE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'police_';

  addStation(x: number, y: number, radius = 15): string {
    const id = this.generateId();
    this.facilities.push({ id, x, y, radius });
    return id;
  }

  removeStation(id: string): void {
    removeById(this.facilities, id);
  }

  getCrimeReduction(x: number, y: number): number {
    const count = this.coverage.getCoverageCount(x, y);
    if (count === 0) return 0;
    return Math.max(POLICE.CRIME_REDUCTION_CAP, count * POLICE.CRIME_REDUCTION_PER_STATION);
  }

  getStations(): readonly PoliceStation[] {
    return this.facilities;
  }

  tick(grid?: SizedGrid): void {
    if (grid) {
      this.recalculateCoverage(grid);
    }
  }

  getMaintenanceCost(): number {
    return this.facilities.length * POLICE.MAINTENANCE_PER_STATION;
  }

  toJSON(): { stations: PoliceStation[] } {
    return {
      stations: this.facilities.map(s => ({ ...s })),
    };
  }

  static fromJSON(data: { stations: PoliceStation[] }): PoliceService {
    const service = new PoliceService();
    for (const s of data.stations) {
      service.facilities.push({ ...s });
    }
    service.nextId = recoverNextId(service.facilities, 'police_');
    return service;
  }
}

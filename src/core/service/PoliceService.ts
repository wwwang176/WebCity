import type { SizedGrid } from '../grid/GridHelpers';
import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import { distributeLoadToNearest } from './StationLoadDistributor';

export interface PoliceStation {
  id: string;
  x: number;
  y: number;
  radius: number;
  capacity: number;
}

export const POLICE = {
  CRIME_REDUCTION_PER_STATION: -30,
  CRIME_REDUCTION_CAP: -60,
  MAINTENANCE_PER_STATION: 4,
  DEFAULT_CAPACITY: 1000,
  DEFAULT_RADIUS: 15,
} as const;

export class PoliceService extends RoadCoverageService<PoliceStation> {
  protected readonly coverageBudget = ROAD_COVERAGE.POLICE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'police_';
  protected readonly maintenanceCostPerFacility = POLICE.MAINTENANCE_PER_STATION;

  private readonly stationLoad = new Map<string, number>();
  private loadRatio = 0;

  addStation(x: number, y: number, radius = POLICE.DEFAULT_RADIUS, capacity = POLICE.DEFAULT_CAPACITY): string {
    const id = this.generateId();
    this.pushFacility({ id, x, y, radius, capacity });
    return id;
  }

  /** Assign weighted demand to nearest station (Euclidean). Delegated to StationLoadDistributor (DRY). */
  updateStationLoads(demands: ReadonlyArray<{ x: number; y: number; weight: number }>): void {
    const result = distributeLoadToNearest(this.facilities, demands, this.stationLoad);
    this.loadRatio = result.loadRatio;
  }

  getStationLoad(stationId: string): number {
    return Math.round(this.stationLoad.get(stationId) ?? 0);
  }

  getLoadRatio(): number {
    return this.loadRatio;
  }

  removeStation(id: string): void {
    this.removeFacilityById(id);
  }

  getCrimeReduction(x: number, y: number): number {
    const count = this.coverage.getCoverageCount(x, y);
    if (count === 0) return 0;
    const base = Math.max(POLICE.CRIME_REDUCTION_CAP, count * POLICE.CRIME_REDUCTION_PER_STATION);
    // Scale by load: overloaded stations are less effective
    if (this.loadRatio <= 1) return base;
    const effectiveness = Math.max(0, 1 / this.loadRatio);
    return Math.round(base * effectiveness);
  }

  getStations(): readonly PoliceStation[] {
    return this.facilities;
  }

  tick(grid?: SizedGrid): void {
    if (grid) {
      this.recalculateCoverage(grid);
    }
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
    service.restoreNextId(); // also marks facilities connected
    return service;
  }
}

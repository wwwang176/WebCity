import type { SizedGrid } from '../grid/GridHelpers';
import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';
import { distributeWithSpillover } from './SpilloverLoadDistributor';

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
  DEFAULT_CAPACITY: 2000,
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

  addStation(x: number, y: number, radius: number = POLICE.DEFAULT_RADIUS, capacity: number = POLICE.DEFAULT_CAPACITY): string {
    const id = this.generateId();
    this.pushFacility({ id, x, y, radius, capacity });
    return id;
  }

  /**
   * Attributes demand to **the station serving that cell**.
   *
   * "Serving that cell" is a coverage question — the station cheapest to reach by road, the same
   * answer the dots and the overlay give. Straight-line distance let a station across a river
   * draw demand it could not serve (BUG-363).
   */
  updateStationLoads(demands: ReadonlyArray<{ x: number; y: number; weight: number }>): void {
    const result = distributeWithSpillover(
      this.getOperationalFacilities(), demands, this.stationLoad,
      (x, y) => this.getCoveringFacilityIds(x, y),
    );
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

  /** How much this station has been allocated and how much it can take. */
  protected override facilityLoadOf(id: string): { load: number; capacity: number } | null {
    const s = this.facilities.find(f => f.id === id);
    return s ? { load: this.getStationLoad(id), capacity: s.capacity } : null;
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

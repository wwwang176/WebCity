import type { SizedGrid } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';
import { RoadCoverageMap, ROAD_COVERAGE } from './RoadCoverageFlood';

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

export class PoliceService {
  private stations: PoliceStation[] = [];
  private coverage = new RoadCoverageMap();
  private nextId = 1;

  addStation(x: number, y: number, radius = 15): string {
    const id = `police_${this.nextId++}`;
    this.stations.push({ id, x, y, radius });
    return id;
  }

  removeStation(id: string): void {
    removeById(this.stations, id);
  }

  getCoverage(x: number, y: number): boolean {
    return this.coverage.hasCoverage(x, y);
  }

  /** Cost ratio: 0.0 (nearest) to 1.0 (farthest). -1 if uncovered. */
  getCostRatio(x: number, y: number): number {
    return this.coverage.getCostRatio(x, y);
  }

  getCrimeReduction(x: number, y: number): number {
    const count = this.coverage.getCoverageCount(x, y);
    if (count === 0) return 0;
    return Math.max(POLICE.CRIME_REDUCTION_CAP, count * POLICE.CRIME_REDUCTION_PER_STATION);
  }

  getStations(): readonly PoliceStation[] {
    return this.stations;
  }

  /** Recompute road-distance coverage. Call after station or road changes. */
  recalculateCoverage(grid: SizedGrid, facilityWidth = 2, facilityHeight = 2): void {
    this.coverage.recalculate(this.stations, grid, ROAD_COVERAGE.POLICE_BUDGET, facilityWidth, facilityHeight);
  }

  /** Preview coverage for a potential station placement, merged with existing stations. */
  previewCoverage(position: { x: number; y: number }, grid: SizedGrid, facilityWidth = 2, facilityHeight = 2): Map<string, number> {
    return this.coverage.previewMerged(position, grid, ROAD_COVERAGE.POLICE_BUDGET, facilityWidth, facilityHeight);
  }

  /** Get all covered cells with their road-distance costs (for overlay gradient). */
  getCoveredCellsWithCost(): ReadonlyMap<string, number> {
    return this.coverage.getCoveredCells();
  }

  tick(grid?: SizedGrid): void {
    if (grid) {
      this.recalculateCoverage(grid);
    }
  }

  getMaintenanceCost(): number {
    return this.stations.length * POLICE.MAINTENANCE_PER_STATION;
  }

  toJSON(): { stations: PoliceStation[] } {
    return {
      stations: this.stations.map(s => ({ ...s })),
    };
  }

  static fromJSON(data: { stations: PoliceStation[] }): PoliceService {
    const service = new PoliceService();
    for (const s of data.stations) {
      service.stations.push({ ...s });
    }
    service.nextId = recoverNextId(service.stations, 'police_');
    return service;
  }
}

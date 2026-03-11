import { removeById } from '../utils/removeById';
import { RadiusCoverageMap } from './RadiusCoverageMap';

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

let nextStationId = 1;

export class PoliceService {
  private stations: PoliceStation[] = [];
  private coverage = new RadiusCoverageMap();

  addStation(x: number, y: number, radius = 15): string {
    const id = `police_${nextStationId++}`;
    this.stations.push({ id, x, y, radius });
    return id;
  }

  removeStation(id: string): void {
    removeById(this.stations, id);
  }

  getCoverage(x: number, y: number): boolean {
    return this.coverage.hasCoverage(x, y);
  }

  getCrimeReduction(x: number, y: number): number {
    const count = this.coverage.getCoverageCount(x, y);
    if (count === 0) return 0;
    return Math.max(POLICE.CRIME_REDUCTION_CAP, count * POLICE.CRIME_REDUCTION_PER_STATION);
  }

  getStations(): readonly PoliceStation[] {
    return this.stations;
  }

  tick(): void {
    this.coverage.recalculate(this.stations);
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
    return service;
  }
}

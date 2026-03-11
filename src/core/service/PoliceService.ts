import { toPosKey, forEachCellInRadius } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';

export interface PoliceStation {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export const POLICE = {
  CRIME_REDUCTION_PER_STATION: -30,
  CRIME_REDUCTION_CAP: -60,
} as const;

let nextStationId = 1;

export class PoliceService {
  private stations: PoliceStation[] = [];
  /** Map from "x,y" station key to count of covering stations */
  private coverageMap = new Map<string, number>();

  addStation(x: number, y: number, radius = 15): string {
    const id = `police_${nextStationId++}`;
    this.stations.push({ id, x, y, radius });
    return id;
  }

  removeStation(id: string): void {
    removeById(this.stations, id);
  }

  getCoverage(x: number, y: number): boolean {
    return this.coverageMap.has(toPosKey(x, y));
  }

  getCrimeReduction(x: number, y: number): number {
    const count = this.coverageMap.get(toPosKey(x, y)) ?? 0;
    if (count === 0) return 0;
    return Math.max(POLICE.CRIME_REDUCTION_CAP, count * POLICE.CRIME_REDUCTION_PER_STATION);
  }

  getStations(): readonly PoliceStation[] {
    return this.stations;
  }

  tick(): void {
    this.coverageMap.clear();
    for (const station of this.stations) {
      this.addCoverage(station);
    }
  }

  private addCoverage(station: PoliceStation): void {
    forEachCellInRadius(station.x, station.y, station.radius, (x, y) => {
      const key = toPosKey(x, y);
      this.coverageMap.set(key, (this.coverageMap.get(key) ?? 0) + 1);
    });
  }

  getMaintenanceCost(): number {
    return this.stations.length * 4;
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

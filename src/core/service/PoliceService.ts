export interface PoliceStation {
  id: string;
  x: number;
  y: number;
  radius: number;
}

const CRIME_REDUCTION_PER_STATION = -30;
const CRIME_REDUCTION_CAP = -60;

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
    const idx = this.stations.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.stations.splice(idx, 1);
    }
  }

  getCoverage(x: number, y: number): boolean {
    return this.coverageMap.has(`${x},${y}`);
  }

  getCrimeReduction(x: number, y: number): number {
    const count = this.coverageMap.get(`${x},${y}`) ?? 0;
    if (count === 0) return 0;
    return Math.max(CRIME_REDUCTION_CAP, count * CRIME_REDUCTION_PER_STATION);
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
    const { x: sx, y: sy, radius } = station;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          const key = `${sx + dx},${sy + dy}`;
          this.coverageMap.set(key, (this.coverageMap.get(key) ?? 0) + 1);
        }
      }
    }
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

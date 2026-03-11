import { removeById } from '../utils/removeById';

export interface Cemetery {
  id: string;
  x: number;
  y: number;
  capacity: number;
  used: number;
}

export interface Crematorium {
  id: string;
  x: number;
  y: number;
  capacity: number;
  processRate: number;
}

export interface DeathCareJSON {
  cemeteries: Cemetery[];
  crematoriums: Crematorium[];
  pendingDeaths: number;
}

let nextId = 1;

export class DeathCareService {
  private cemeteries: Cemetery[] = [];
  private crematoriums: Crematorium[] = [];
  private pendingDeaths = 0;

  addCemetery(x: number, y: number, capacity = 500): string {
    const id = `cem-${nextId++}`;
    this.cemeteries.push({ id, x, y, capacity, used: 0 });
    return id;
  }

  addCrematorium(x: number, y: number, capacity = 100, processRate = 5): string {
    const id = `cre-${nextId++}`;
    this.crematoriums.push({ id, x, y, capacity, processRate });
    return id;
  }

  removeCemetery(id: string): boolean {
    return removeById(this.cemeteries, id);
  }

  removeCrematorium(id: string): boolean {
    return removeById(this.crematoriums, id);
  }

  reportDeath(): void {
    this.pendingDeaths++;
  }

  tick(): void {
    if (this.pendingDeaths <= 0) return;

    // Phase 1: Crematoriums process deaths (up to their processRate per tick)
    for (const crem of this.crematoriums) {
      if (this.pendingDeaths <= 0) break;
      const processed = Math.min(this.pendingDeaths, crem.processRate);
      this.pendingDeaths -= processed;
    }

    // Phase 2: Remaining deaths go to cemeteries (permanent burial)
    for (const cem of this.cemeteries) {
      if (this.pendingDeaths <= 0) break;
      const available = cem.capacity - cem.used;
      if (available <= 0) continue;
      const buried = Math.min(this.pendingDeaths, available);
      cem.used += buried;
      this.pendingDeaths -= buried;
    }
  }

  getUnprocessed(): number {
    return this.pendingDeaths;
  }

  getHappinessPenalty(): number {
    return this.pendingDeaths > 0 ? -20 : 0;
  }

  getCemeteries(): readonly Cemetery[] {
    return this.cemeteries;
  }

  getCrematoria(): readonly Crematorium[] {
    return this.crematoriums;
  }

  getMaintenanceCost(): number {
    return (this.cemeteries.length + this.crematoriums.length) * 2;
  }

  toJSON(): DeathCareJSON {
    return {
      cemeteries: this.cemeteries.map(c => ({ ...c })),
      crematoriums: this.crematoriums.map(c => ({ ...c })),
      pendingDeaths: this.pendingDeaths,
    };
  }

  static fromJSON(json: DeathCareJSON): DeathCareService {
    const service = new DeathCareService();
    service.cemeteries = json.cemeteries.map(c => ({ ...c }));
    service.crematoriums = json.crematoriums.map(c => ({ ...c }));
    service.pendingDeaths = json.pendingDeaths;
    return service;
  }
}

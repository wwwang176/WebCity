import { removeById } from '../utils/removeById';
import { recoverNextId } from '../utils/recoverNextId';

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

export const DEATH_CARE = {
  MAINTENANCE_PER_FACILITY: 2,
} as const;

export class DeathCareService {
  private cemeteries: Cemetery[] = [];
  private crematoriums: Crematorium[] = [];
  private pendingDeaths = 0;
  private nextId = 1;

  addCemetery(x: number, y: number, capacity = 500): string {
    const id = `cem-${this.nextId++}`;
    this.cemeteries.push({ id, x, y, capacity, used: 0 });
    return id;
  }

  addCrematorium(x: number, y: number, capacity = 100, processRate = 5): string {
    const id = `cre-${this.nextId++}`;
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
    return (this.cemeteries.length + this.crematoriums.length) * DEATH_CARE.MAINTENANCE_PER_FACILITY;
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
    // Recover counter from max existing ID across both collections
    const cemMax = recoverNextId(service.cemeteries, 'cem-');
    const creMax = recoverNextId(service.crematoriums, 'cre-');
    service.nextId = Math.max(cemMax, creMax);
    return service;
  }
}

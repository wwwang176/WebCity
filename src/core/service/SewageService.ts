export interface SewageOutlet {
  id: string;
  x: number;
  y: number;
}

export interface TreatmentPlant {
  id: string;
  x: number;
  y: number;
  capacity: number;
}

interface SewageJSON {
  outlets: SewageOutlet[];
  treatmentPlants: TreatmentPlant[];
  untreatedSewage: number;
  nextId: number;
}

import type { PollutionSource } from '../environment/Pollution';
import { removeById } from '../utils/removeById';

/** Sewage system configuration constants */
export const SEWAGE = {
  /** Population per unit of sewage produced */
  POP_PER_SEWAGE: 100,
  /** Water pollution multiplier per untreated sewage unit */
  WATER_POLLUTION_MULTIPLIER: 5,
  /** Maximum pollution emitted per outlet */
  MAX_POLLUTION_PER_OUTLET: 80,
  /** Monthly maintenance cost per treatment plant */
  MAINTENANCE_PER_PLANT: 4,
} as const;

export class SewageService {
  private outlets: SewageOutlet[] = [];
  private treatmentPlants: TreatmentPlant[] = [];
  private untreatedSewage = 0;
  private nextId = 1;

  addOutlet(x: number, y: number): string {
    const id = `outlet-${this.nextId++}`;
    this.outlets.push({ id, x, y });
    return id;
  }

  addTreatmentPlant(x: number, y: number, capacity = 200): string {
    const id = `plant-${this.nextId++}`;
    this.treatmentPlants.push({ id, x, y, capacity });
    return id;
  }

  removeOutlet(id: string): boolean {
    return removeById(this.outlets, id);
  }

  removeTreatmentPlant(id: string): boolean {
    return removeById(this.treatmentPlants, id);
  }

  /** Produce sewage from population without treatment (manual step). */
  produceSewage(population: number): void {
    const produced = Math.floor(population / SEWAGE.POP_PER_SEWAGE);
    this.untreatedSewage += produced;
  }

  /**
   * Full tick: produce sewage from population, then treat as much as capacity allows.
   * Resets untreated count each tick before producing new sewage.
   */
  tick(population: number): void {
    this.untreatedSewage = 0;
    const produced = Math.floor(population / SEWAGE.POP_PER_SEWAGE);
    const totalCapacity = this.getTreatmentCapacity();
    this.untreatedSewage = Math.max(0, produced - totalCapacity);
  }

  getUntreated(): number {
    return this.untreatedSewage;
  }

  /** Water pollution is proportional to untreated sewage. */
  getWaterPollution(): number {
    return this.untreatedSewage * SEWAGE.WATER_POLLUTION_MULTIPLIER;
  }

  getTreatmentCapacity(): number {
    return this.treatmentPlants.reduce((sum, p) => sum + p.capacity, 0);
  }

  getOutlets(): readonly SewageOutlet[] {
    return this.outlets;
  }

  getTreatmentPlants(): readonly TreatmentPlant[] {
    return this.treatmentPlants;
  }

  getMaintenanceCost(): number {
    return this.treatmentPlants.length * SEWAGE.MAINTENANCE_PER_PLANT;
  }

  getPollutionSources(): PollutionSource[] {
    const pollution = this.getWaterPollution();
    if (pollution <= 0) return [];
    return this.outlets.map(outlet => ({
      x: outlet.x,
      y: outlet.y,
      amount: Math.min(SEWAGE.MAX_POLLUTION_PER_OUTLET, pollution),
      type: 'ground' as const,
    }));
  }

  toJSON(): SewageJSON {
    return {
      outlets: this.outlets.map(o => ({ ...o })),
      treatmentPlants: this.treatmentPlants.map(p => ({ ...p })),
      untreatedSewage: this.untreatedSewage,
      nextId: this.nextId,
    };
  }

  static fromJSON(json: SewageJSON): SewageService {
    const svc = new SewageService();
    svc.outlets = json.outlets.map(o => ({ ...o }));
    svc.treatmentPlants = json.treatmentPlants.map(p => ({ ...p }));
    svc.untreatedSewage = json.untreatedSewage;
    svc.nextId = json.nextId;
    return svc;
  }
}

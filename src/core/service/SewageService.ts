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
import { isFootprintAdjacentToRoad, type ReadableGrid } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';
import { isFacilityOperational, type UtilityChecker } from './FacilityOperational';

/** Sewage system configuration constants */
export const SEWAGE = {
  /** Default treatment plant capacity (1.5x water plant output of 1500) */
  DEFAULT_CAPACITY: 2250,
  /** Water pollution multiplier per untreated sewage unit */
  WATER_POLLUTION_MULTIPLIER: 5,
  /** Maximum pollution emitted per outlet */
  MAX_POLLUTION_PER_OUTLET: 80,
  /** Monthly maintenance cost per treatment plant */
  MAINTENANCE_PER_PLANT: 4,
  /** Sewage rate: fraction of water consumption that becomes sewage, per zone */
  SEWAGE_RATE: {
    RESIDENTIAL: 0.85,
    COMMERCIAL: 0.90,
    INDUSTRIAL: 0.90,
    OFFICE: 0.92,
  },
} as const;

export class SewageService {
  private outlets: SewageOutlet[] = [];
  private treatmentPlants: TreatmentPlant[] = [];
  private connectedPlantIds = new Set<string>();
  private operationalPlantIds: Set<string> | null = null;
  private untreatedSewage = 0;
  private nextId = 1;

  addOutlet(x: number, y: number): string {
    const id = `outlet-${this.nextId++}`;
    this.outlets.push({ id, x, y });
    return id;
  }

  addTreatmentPlant(x: number, y: number, capacity = SEWAGE.DEFAULT_CAPACITY): string {
    const id = `plant-${this.nextId++}`;
    this.treatmentPlants.push({ id, x, y, capacity });
    this.connectedPlantIds.add(id);
    return id;
  }

  removeOutlet(id: string): boolean {
    return removeById(this.outlets, id);
  }

  removeTreatmentPlant(id: string): boolean {
    this.connectedPlantIds.delete(id);
    return removeById(this.treatmentPlants, id);
  }

  /** Produce sewage from water demand (manual step). */
  produceSewage(sewageAmount: number): void {
    this.untreatedSewage += sewageAmount;
  }

  /** Recompute which treatment plants are adjacent to at least one road cell. */
  updateConnectedPlants(grid: ReadableGrid): void {
    this.connectedPlantIds.clear();
    for (const p of this.treatmentPlants) {
      if (isFootprintAdjacentToRoad(grid, p.x, p.y, 2, 2)) {
        this.connectedPlantIds.add(p.id);
      }
    }
  }

  /** Update which treatment plants are operational (have power; sewage is water-exempt). */
  updateOperationalStatus(isPowered: UtilityChecker, isWaterSupplied: UtilityChecker): void {
    this.operationalPlantIds = new Set<string>();
    for (const p of this.treatmentPlants) {
      if (isFacilityOperational(p.x, p.y, 'sewage', isPowered, isWaterSupplied)) {
        this.operationalPlantIds.add(p.id);
      }
    }
  }

  private isPlantOperational(id: string): boolean {
    return this.operationalPlantIds === null || this.operationalPlantIds.has(id);
  }

  /**
   * Full tick: produce sewage from water demand, then treat as much as connected capacity allows.
   * @param sewageProduced Total sewage produced this tick (water demand × sewage rates).
   */
  tick(sewageProduced: number): void {
    this.untreatedSewage = 0;
    const connectedCapacity = this.getConnectedTreatmentCapacity();
    this.untreatedSewage = Math.max(0, sewageProduced - connectedCapacity);
  }

  /** Treatment capacity from connected AND operational plants only. */
  private getConnectedTreatmentCapacity(): number {
    let cap = 0;
    for (const p of this.treatmentPlants) {
      if (this.connectedPlantIds.has(p.id) && this.isPlantOperational(p.id)) cap += p.capacity;
    }
    return cap;
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
      type: 'water' as const,
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
    for (const p of svc.treatmentPlants) svc.connectedPlantIds.add(p.id);
    svc.untreatedSewage = json.untreatedSewage;
    svc.nextId = json.nextId;
    return svc;
  }
}

import { toPosKey } from '../grid/GridHelpers';
import { District, Specialization } from './types';

export class DistrictManager {
  private districts: Map<string, District> = new Map();
  /** Reverse index: cellKey → districtId for O(1) lookup. */
  private cellToDistrict: Map<string, string> = new Map();
  private nextId = 1;

  createDistrict(name: string): District {
    const district: District = {
      id: `district_${this.nextId++}`,
      name,
      cells: new Set<string>(),
      policies: [],
      specialization: Specialization.NONE,
    };
    this.districts.set(district.id, district);
    return district;
  }

  getDistrict(id: string): District | undefined {
    return this.districts.get(id);
  }

  getAllDistricts(): District[] {
    return Array.from(this.districts.values());
  }

  addCellToDistrict(districtId: string, x: number, y: number): void {
    const district = this.districts.get(districtId);
    if (!district) return;
    const key = toPosKey(x, y);
    // Remove from previous district via reverse index (O(1) instead of O(D))
    const prevId = this.cellToDistrict.get(key);
    if (prevId && prevId !== districtId) {
      this.districts.get(prevId)?.cells.delete(key);
    }
    district.cells.add(key);
    this.cellToDistrict.set(key, districtId);
  }

  removeCellFromDistrict(districtId: string, x: number, y: number): void {
    const district = this.districts.get(districtId);
    if (!district) return;
    const key = toPosKey(x, y);
    district.cells.delete(key);
    if (this.cellToDistrict.get(key) === districtId) {
      this.cellToDistrict.delete(key);
    }
  }

  getDistrictAt(x: number, y: number): District | null {
    const key = toPosKey(x, y);
    const id = this.cellToDistrict.get(key);
    if (!id) return null;
    return this.districts.get(id) ?? null;
  }

  renameDistrict(id: string, name: string): void {
    const district = this.districts.get(id);
    if (!district) return;
    district.name = name;
  }

  mergeDistricts(id1: string, id2: string): District {
    const d1 = this.districts.get(id1);
    const d2 = this.districts.get(id2);
    if (!d1 || !d2) {
      throw new Error('District not found');
    }
    for (const cell of d2.cells) {
      d1.cells.add(cell);
      this.cellToDistrict.set(cell, id1);
    }
    this.districts.delete(id2);
    return d1;
  }

  splitDistrict(id: string, cells: Set<string>): District {
    const original = this.districts.get(id);
    if (!original) {
      throw new Error('District not found');
    }
    const newDistrict: District = {
      id: `district_${this.nextId++}`,
      name: `${original.name} (Split)`,
      cells: new Set<string>(),
      policies: [],
      specialization: Specialization.NONE,
    };

    for (const cell of cells) {
      if (original.cells.has(cell)) {
        original.cells.delete(cell);
        newDistrict.cells.add(cell);
        this.cellToDistrict.set(cell, newDistrict.id);
      }
    }

    this.districts.set(newDistrict.id, newDistrict);
    return newDistrict;
  }
}

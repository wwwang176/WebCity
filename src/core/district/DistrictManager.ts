import { District, Specialization } from './types';

let nextId = 1;

function generateId(): string {
  return `district_${nextId++}`;
}

export class DistrictManager {
  private districts: Map<string, District> = new Map();

  createDistrict(name: string): District {
    const district: District = {
      id: generateId(),
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

  addCellToDistrict(districtId: string, x: number, y: number): void {
    const district = this.districts.get(districtId);
    if (!district) return;
    const key = `${x},${y}`;
    // Remove from any other district first
    for (const [, d] of this.districts) {
      if (d.id !== districtId) {
        d.cells.delete(key);
      }
    }
    district.cells.add(key);
  }

  removeCellFromDistrict(districtId: string, x: number, y: number): void {
    const district = this.districts.get(districtId);
    if (!district) return;
    district.cells.delete(`${x},${y}`);
  }

  getDistrictAt(x: number, y: number): District | null {
    const key = `${x},${y}`;
    for (const [, district] of this.districts) {
      if (district.cells.has(key)) {
        return district;
      }
    }
    return null;
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
      id: generateId(),
      name: `${original.name} (Split)`,
      cells: new Set<string>(),
      policies: [],
      specialization: Specialization.NONE,
    };

    for (const cell of cells) {
      if (original.cells.has(cell)) {
        original.cells.delete(cell);
        newDistrict.cells.add(cell);
      }
    }

    this.districts.set(newDistrict.id, newDistrict);
    return newDistrict;
  }
}

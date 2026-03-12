export const PARKING = {
  WORKER_RATIO: 2,
} as const;

interface ParkingLot {
  capacity: number;
  occupied: number;
}

export class ParkingSystem {
  private lots = new Map<string, ParkingLot>();
  private overflowCount = 0;

  registerBuilding(buildingKey: string, workerCount: number): void {
    const capacity = Math.max(1, Math.floor(workerCount / PARKING.WORKER_RATIO));
    this.lots.set(buildingKey, { capacity, occupied: 0 });
  }

  unregisterBuilding(buildingKey: string): void {
    this.lots.delete(buildingKey);
  }

  getCapacity(buildingKey: string): number {
    return this.lots.get(buildingKey)?.capacity ?? 0;
  }

  getOccupied(buildingKey: string): number {
    return this.lots.get(buildingKey)?.occupied ?? 0;
  }

  isFull(buildingKey: string): boolean {
    const lot = this.lots.get(buildingKey);
    if (!lot) return true;
    return lot.occupied >= lot.capacity;
  }

  tryPark(buildingKey: string): boolean {
    const lot = this.lots.get(buildingKey);
    if (!lot || lot.occupied >= lot.capacity) {
      this.overflowCount++;
      return false;
    }
    lot.occupied++;
    return true;
  }

  release(buildingKey: string): void {
    const lot = this.lots.get(buildingKey);
    if (lot && lot.occupied > 0) {
      lot.occupied--;
    }
  }

  findNearbyParking(
    originalKey: string,
    neighbors: { key: string; distance: number }[],
  ): string | null {
    // Sort by distance, return first with available spots
    const sorted = [...neighbors].sort((a, b) => a.distance - b.distance);
    for (const n of sorted) {
      if (!this.isFull(n.key)) return n.key;
    }
    return null;
  }

  getOverflowCount(): number {
    return this.overflowCount;
  }

  resetOverflowCount(): void {
    this.overflowCount = 0;
  }
}

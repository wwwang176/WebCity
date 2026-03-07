export interface Vehicle {
  id: number;
  path: string[];
  currentIndex: number;
  speed: number;
  arrived: boolean;
}

export class TrafficSimulation {
  vehicles: Vehicle[] = [];
  private nextId = 1;
  private segmentVehicles = new Map<string, number>();

  addVehicle(path: string[]): Vehicle {
    const vehicle: Vehicle = {
      id: this.nextId++,
      path,
      currentIndex: 0,
      speed: 1,
      arrived: false,
    };
    this.vehicles.push(vehicle);
    if (path[0]) {
      this.incrementSegment(path[0]);
    }
    return vehicle;
  }

  tick(): void {
    for (const v of this.vehicles) {
      if (v.arrived) continue;

      const currentNode = v.path[v.currentIndex];
      if (currentNode) {
        this.decrementSegment(currentNode);
      }

      if (v.currentIndex < v.path.length - 1) {
        v.currentIndex++;
        const nextNode = v.path[v.currentIndex];
        if (nextNode) {
          this.incrementSegment(nextNode);
        }
      }

      if (v.currentIndex >= v.path.length - 1) {
        v.arrived = true;
      }
    }

    this.vehicles = this.vehicles.filter((v) => !v.arrived);
  }

  getSegmentDensity(segment: string): number {
    return this.segmentVehicles.get(segment) ?? 0;
  }

  getVehicleCount(): number {
    return this.vehicles.length;
  }

  private incrementSegment(segment: string): void {
    this.segmentVehicles.set(segment, (this.segmentVehicles.get(segment) ?? 0) + 1);
  }

  private decrementSegment(segment: string): void {
    const count = (this.segmentVehicles.get(segment) ?? 0) - 1;
    if (count <= 0) {
      this.segmentVehicles.delete(segment);
    } else {
      this.segmentVehicles.set(segment, count);
    }
  }
}

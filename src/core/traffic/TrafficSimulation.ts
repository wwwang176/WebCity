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

  /**
   * @param canAdvance Optional callback to check if a vehicle can move from current to next cell.
   *                   Used by traffic lights to block vehicles at red lights.
   */
  tick(canAdvance?: (current: string, next: string) => boolean): void {
    // Phase 1: Identify cells with vehicles directly blocked by red lights
    const waitingAt = new Set<string>();
    for (const v of this.vehicles) {
      if (v.arrived || v.currentIndex >= v.path.length - 1) continue;
      const currentNode = v.path[v.currentIndex]!;
      const nextNode = v.path[v.currentIndex + 1]!;
      if (canAdvance && !canAdvance(currentNode, nextNode)) {
        waitingAt.add(currentNode);
      }
    }

    // Phase 2: Cascade — vehicles whose next cell is blocked also wait
    let changed = true;
    while (changed) {
      changed = false;
      for (const v of this.vehicles) {
        if (v.arrived || v.currentIndex >= v.path.length - 1) continue;
        const currentNode = v.path[v.currentIndex]!;
        if (waitingAt.has(currentNode)) continue; // already waiting
        const nextNode = v.path[v.currentIndex + 1]!;
        if (waitingAt.has(nextNode)) {
          waitingAt.add(currentNode);
          changed = true;
        }
      }
    }

    // Phase 3: Move non-waiting vehicles
    for (const v of this.vehicles) {
      if (v.arrived) continue;

      if (v.currentIndex < v.path.length - 1) {
        const currentNode = v.path[v.currentIndex]!;
        if (waitingAt.has(currentNode)) continue; // queued behind red light

        this.decrementSegment(currentNode);
        v.currentIndex++;
        this.incrementSegment(v.path[v.currentIndex]!);
      }

      if (v.currentIndex >= v.path.length - 1) {
        const lastNode = v.path[v.currentIndex];
        if (lastNode) this.decrementSegment(lastNode);
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

  getTopCongested(n: number): { segment: string; density: number }[] {
    const entries = [...this.segmentVehicles.entries()]
      .map(([segment, density]) => ({ segment, density }))
      .sort((a, b) => b.density - a.density);
    return entries.slice(0, n);
  }

  getAveragePathLength(): number {
    if (this.vehicles.length === 0) return 0;
    const total = this.vehicles.reduce((sum, v) => sum + v.path.length, 0);
    return total / this.vehicles.length;
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

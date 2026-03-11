export interface FireStation {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface ActiveFire {
  x: number;
  y: number;
  ticksRemaining: number;
  damage: number;
}

export interface FireServiceJSON {
  stations: FireStation[];
  activeFires: ActiveFire[];
  nextId: number;
}

import { isZoneBuilding } from '../building/InfraConfig';

/** Speed at which fire trucks travel (cells per tick for response time calculation). */
const RESPONSE_SPEED = 2;

/** Ticks to resolve a fire once reported. */
const FIRE_DURATION = 3;

/** Damage when fire is within coverage (10%). */
const COVERED_DAMAGE = 0.10;

/** Damage when fire is outside coverage (80%). */
const UNCOVERED_DAMAGE = 0.80;

export class FireService {
  private stations: FireStation[] = [];
  private activeFires: ActiveFire[] = [];
  private nextId = 1;

  addStation(x: number, y: number, radius = 15): string {
    const id = `fire_${this.nextId++}`;
    this.stations.push({ id, x, y, radius });
    return id;
  }

  removeStation(id: string): void {
    const idx = this.stations.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.stations.splice(idx, 1);
    }
  }

  getStations(): readonly FireStation[] {
    return this.stations;
  }

  getActiveFires(): readonly ActiveFire[] {
    return this.activeFires;
  }

  /**
   * Returns true if the position (x, y) is within the coverage radius
   * of at least one fire station (Euclidean distance).
   */
  getCoverage(x: number, y: number): boolean {
    return this.stations.some(s => this.distance(s.x, s.y, x, y) <= s.radius);
  }

  /**
   * Returns the estimated response time in ticks for a fire at (x, y).
   * Based on distance to the nearest station divided by response speed.
   * Returns Infinity if not covered by any station.
   */
  getResponseTime(x: number, y: number): number {
    let minDist = Infinity;
    for (const s of this.stations) {
      const d = this.distance(s.x, s.y, x, y);
      if (d <= s.radius && d < minDist) {
        minDist = d;
      }
    }
    if (minDist === Infinity) return Infinity;
    return minDist / RESPONSE_SPEED;
  }

  /**
   * Report a fire at (x, y). Returns whether the area is covered and
   * the estimated damage percentage.
   */
  reportFire(x: number, y: number): { covered: boolean; estimatedDamage: number } {
    const covered = this.getCoverage(x, y);
    const damage = covered ? COVERED_DAMAGE : UNCOVERED_DAMAGE;

    this.activeFires.push({
      x,
      y,
      ticksRemaining: FIRE_DURATION,
      damage,
    });

    return { covered, estimatedDamage: damage };
  }

  /**
   * Returns a fire risk value from 0 (no risk) to 1 (maximum risk).
   * Risk is high for uncovered areas and lower near station centers.
   */
  getFireRisk(x: number, y: number): number {
    if (this.stations.length === 0) return 1;

    let minRatio = Infinity;
    for (const s of this.stations) {
      const d = this.distance(s.x, s.y, x, y);
      const ratio = d / s.radius;
      if (ratio < minRatio) minRatio = ratio;
    }

    if (minRatio > 1) {
      // Outside all coverage — high risk
      return Math.min(1, 0.8 + minRatio * 0.05);
    }

    // Inside coverage — risk scales with distance ratio (0 at center, approaches max at edge)
    return Math.min(1, minRatio * 0.5);
  }

  /**
   * Advance active fires by one tick. Fires with ticksRemaining <= 0 are
   * kept in place so they can be collected via resolveCompletedFires().
   */
  tick(): void {
    for (const fire of this.activeFires) {
      if (fire.ticksRemaining > 0) {
        fire.ticksRemaining--;
      }
    }
  }

  /**
   * Remove and return all fires whose ticksRemaining has reached 0.
   * The caller can use the returned list to apply damage to buildings.
   */
  resolveCompletedFires(): ActiveFire[] {
    const resolved: ActiveFire[] = [];
    for (let i = this.activeFires.length - 1; i >= 0; i--) {
      if (this.activeFires[i]!.ticksRemaining <= 0) {
        resolved.push(this.activeFires[i]!);
        this.activeFires.splice(i, 1);
      }
    }
    return resolved;
  }

  /**
   * Attempt to start a random fire in the city.
   * Probability scales with population and inversely with fire station coverage.
   * Returns true if a fire was started.
   */
  tryRandomFire(
    grid: { width: number; height: number; getCell(x: number, y: number): { buildingId: number; zoneType: number } | null },
    population: number,
    probabilityOverride?: number,
  ): boolean {
    // Base probability per tick: very low, scales slightly with population
    const baseProbability = probabilityOverride ?? Math.min(0.02, 0.001 + population * 0.000005);
    if (Math.random() >= baseProbability) return false;

    // Find a random building cell to start a fire
    const attempts = 10;
    for (let i = 0; i < attempts; i++) {
      const x = Math.floor(Math.random() * grid.width);
      const y = Math.floor(Math.random() * grid.height);
      const cell = grid.getCell(x, y);
      if (cell && isZoneBuilding(cell.buildingId)) {
        this.reportFire(x, y);
        return true;
      }
    }
    return false;
  }

  getMaintenanceCost(): number {
    return this.stations.length * 4;
  }

  toJSON(): FireServiceJSON {
    return {
      stations: this.stations.map(s => ({ ...s })),
      activeFires: this.activeFires.map(f => ({ ...f })),
      nextId: this.nextId,
    };
  }

  static fromJSON(json: FireServiceJSON): FireService {
    const service = new FireService();
    service.stations = json.stations.map(s => ({ ...s }));
    service.activeFires = json.activeFires.map(f => ({ ...f }));
    service.nextId = json.nextId;
    return service;
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

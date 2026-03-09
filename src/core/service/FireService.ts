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
   * Advance active fires by one tick. Fires with no remaining ticks are removed.
   */
  tick(): void {
    for (let i = this.activeFires.length - 1; i >= 0; i--) {
      this.activeFires[i]!.ticksRemaining--;
      if (this.activeFires[i]!.ticksRemaining <= 0) {
        this.activeFires.splice(i, 1);
      }
    }
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

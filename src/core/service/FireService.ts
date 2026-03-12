import { randomInt } from '../utils/random';

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

interface FireServiceJSON {
  stations: FireStation[];
  activeFires: ActiveFire[];
  nextId: number;
  recentDaily?: number[];
  recentIndex?: number;
  todayExtinguished?: number;
}

import { isZoneBuilding } from '../building/InfraConfig';
import type { ReadableGrid } from '../grid/GridHelpers';
import { removeById } from '../utils/removeById';
import { RoadCoverageMap, ROAD_COVERAGE } from './RoadCoverageFlood';

/** Fire risk and ignition probability constants */
export const FIRE = {
  /** Speed at which fire trucks travel (cells per tick for response time calculation) */
  RESPONSE_SPEED: 2,
  /** Ticks to resolve a fire once reported */
  FIRE_DURATION: 3,
  /** Damage when fire is within coverage (10%) */
  COVERED_DAMAGE: 0.10,
  /** Damage when fire is outside coverage (80%) */
  UNCOVERED_DAMAGE: 0.80,
  /** Base risk outside all station coverage */
  RISK_OUTSIDE_BASE: 0.8,
  /** Risk increase per distance ratio beyond coverage */
  RISK_OUTSIDE_FACTOR: 0.05,
  /** Risk multiplier inside coverage (0 at center, RISK_INSIDE_FACTOR at edge) */
  RISK_INSIDE_FACTOR: 0.5,
  /** Maximum random fire probability per tick */
  MAX_IGNITION_PROB: 0.02,
  /** Baseline random fire probability */
  BASE_IGNITION_PROB: 0.001,
  /** Fire probability per citizen */
  IGNITION_POP_FACTOR: 0.000005,
  /** Number of random cell attempts to find a building for fire */
  IGNITION_ATTEMPTS: 10,
  MAINTENANCE_PER_STATION: 4,
  /** Damage threshold above which a building becomes BURNED ruins */
  BURN_DAMAGE_THRESHOLD: 0.5,
} as const;

export class FireService {
  private stations: FireStation[] = [];
  private activeFires: ActiveFire[] = [];
  private nextId = 1;
  private recentDaily: number[] = new Array(30).fill(0);
  private recentIndex = 0;
  private todayExtinguished = 0;
  private roadCoverage = new RoadCoverageMap();

  addStation(x: number, y: number, radius = 15): string {
    const id = `fire_${this.nextId++}`;
    this.stations.push({ id, x, y, radius });
    return id;
  }

  removeStation(id: string): void {
    removeById(this.stations, id);
  }

  getStations(): readonly FireStation[] {
    return this.stations;
  }

  getActiveFires(): readonly ActiveFire[] {
    return this.activeFires;
  }

  /** Recompute road-distance coverage. Call after station or road changes. */
  recalculateCoverage(grid: ReadableGrid, facilityWidth = 2, facilityHeight = 2): void {
    this.roadCoverage.recalculate(this.stations, grid, ROAD_COVERAGE.FIRE_BUDGET, facilityWidth, facilityHeight);
  }

  /** Preview coverage for a potential station placement (drag preview). */
  previewCoverage(position: { x: number; y: number }, grid: ReadableGrid, facilityWidth = 2, facilityHeight = 2): Map<string, number> {
    return this.roadCoverage.preview(position, grid, ROAD_COVERAGE.FIRE_BUDGET, facilityWidth, facilityHeight);
  }

  /**
   * Returns true if the position (x, y) is within road-distance coverage
   * of at least one fire station.
   */
  getCoverage(x: number, y: number): boolean {
    return this.roadCoverage.hasCoverage(x, y);
  }

  /**
   * Returns the estimated response time based on road-distance cost.
   * Lower cost = faster response. Returns Infinity if not covered.
   */
  getResponseTime(x: number, y: number): number {
    const cost = this.roadCoverage.getCost(x, y);
    if (cost === Infinity) return Infinity;
    return cost / FIRE.RESPONSE_SPEED;
  }

  /**
   * Report a fire at (x, y). Returns whether the area is covered and
   * the estimated damage percentage.
   */
  reportFire(x: number, y: number): { covered: boolean; estimatedDamage: number } {
    const covered = this.getCoverage(x, y);
    const damage = covered ? FIRE.COVERED_DAMAGE : FIRE.UNCOVERED_DAMAGE;

    this.activeFires.push({
      x,
      y,
      ticksRemaining: FIRE.FIRE_DURATION,
      damage,
    });

    return { covered, estimatedDamage: damage };
  }

  /**
   * Returns a fire risk value from 0 (no risk) to 1 (maximum risk).
   * Risk is high for uncovered areas and lower near station centers.
   * Uses road-distance cost ratio relative to budget.
   */
  getFireRisk(x: number, y: number): number {
    if (this.stations.length === 0) return 1;

    const cost = this.roadCoverage.getCost(x, y);
    const budget = ROAD_COVERAGE.FIRE_BUDGET;

    if (cost === Infinity) {
      // Outside all coverage — high risk
      return Math.min(1, FIRE.RISK_OUTSIDE_BASE + FIRE.RISK_OUTSIDE_FACTOR);
    }

    // Inside coverage — risk scales with cost/budget ratio
    const ratio = cost / budget;
    return Math.min(1, ratio * FIRE.RISK_INSIDE_FACTOR);
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
    this.todayExtinguished += resolved.length;
    return resolved;
  }

  /** Flush today's extinguished count into the 30-day ring buffer. Call once per game day. */
  advanceDay(): void {
    this.recentDaily[this.recentIndex] = this.todayExtinguished;
    this.recentIndex = (this.recentIndex + 1) % 30;
    this.todayExtinguished = 0;
  }

  getRecentExtinguished(): number {
    return this.recentDaily.reduce((a, b) => a + b, 0);
  }

  getTodayExtinguished(): number {
    return this.todayExtinguished;
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
    const baseProbability = probabilityOverride ?? Math.min(FIRE.MAX_IGNITION_PROB, FIRE.BASE_IGNITION_PROB + population * FIRE.IGNITION_POP_FACTOR);
    if (Math.random() >= baseProbability) return false;

    // Find a random building cell to start a fire
    for (let i = 0; i < FIRE.IGNITION_ATTEMPTS; i++) {
      const x = randomInt(grid.width);
      const y = randomInt(grid.height);
      const cell = grid.getCell(x, y);
      if (cell && isZoneBuilding(cell.buildingId)) {
        this.reportFire(x, y);
        return true;
      }
    }
    return false;
  }

  getMaintenanceCost(): number {
    return this.stations.length * FIRE.MAINTENANCE_PER_STATION;
  }

  toJSON(): FireServiceJSON {
    return {
      stations: this.stations.map(s => ({ ...s })),
      activeFires: this.activeFires.map(f => ({ ...f })),
      nextId: this.nextId,
      recentDaily: [...this.recentDaily],
      recentIndex: this.recentIndex,
      todayExtinguished: this.todayExtinguished,
    };
  }

  static fromJSON(json: FireServiceJSON): FireService {
    const service = new FireService();
    service.stations = json.stations.map(s => ({ ...s }));
    service.activeFires = json.activeFires.map(f => ({ ...f }));
    service.nextId = json.nextId;
    service.recentDaily = json.recentDaily ?? new Array(30).fill(0);
    service.recentIndex = json.recentIndex ?? 0;
    service.todayExtinguished = json.todayExtinguished ?? 0;
    return service;
  }

}

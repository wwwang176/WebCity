import { randomInt } from '../utils/random';
import { isZoneBuilding } from '../building/InfraConfig';
import type { SizedGrid } from '../grid/GridHelpers';
import { ROAD_COVERAGE } from './RoadCoverageFlood';
import { RoadCoverageService } from './RoadCoverageService';

export interface FireStation {
  id: string;
  x: number;
  y: number;
  radius: number;
  capacity: number;
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

/** Fire risk and ignition probability constants */
export const FIRE = {
  RESPONSE_SPEED: 2,
  FIRE_DURATION: 3,
  COVERED_DAMAGE: 0.10,
  UNCOVERED_DAMAGE: 0.80,
  DEFAULT_CAPACITY: 2500,
  DEFAULT_RADIUS: 15,
  RISK_OUTSIDE_BASE: 0.8,
  RISK_OUTSIDE_FACTOR: 0.05,
  RISK_INSIDE_FACTOR: 0.5,
  MAX_IGNITION_PROB: 0.02,
  BASE_IGNITION_PROB: 0.001,
  IGNITION_POP_FACTOR: 0.000005,
  IGNITION_ATTEMPTS: 10,
  MAINTENANCE_PER_STATION: 4,
  BURN_DAMAGE_THRESHOLD: 0.5,
} as const;

export class FireService extends RoadCoverageService<FireStation> {
  protected readonly coverageBudget = ROAD_COVERAGE.FIRE_BUDGET;
  protected readonly defaultFacilityWidth = 2;
  protected readonly defaultFacilityHeight = 2;
  protected readonly idPrefix = 'fire_';
  protected readonly maintenanceCostPerFacility = FIRE.MAINTENANCE_PER_STATION;

  private activeFires: ActiveFire[] = [];
  private recentDaily: number[] = new Array(30).fill(0);
  private recentIndex = 0;
  private todayExtinguished = 0;
  private readonly stationLoad = new Map<string, number>();
  private loadRatio = 0;

  addStation(x: number, y: number, radius = FIRE.DEFAULT_RADIUS, capacity = FIRE.DEFAULT_CAPACITY): string {
    const id = this.generateId();
    this.pushFacility({ id, x, y, radius, capacity });
    return id;
  }

  /** Assign weighted demand to nearest station (Euclidean). */
  updateStationLoads(demands: ReadonlyArray<{ x: number; y: number; weight: number }>): void {
    this.stationLoad.clear();
    for (const s of this.facilities) this.stationLoad.set(s.id, 0);

    let total = 0;
    for (const d of demands) {
      total += d.weight;
      let nearestId = '';
      let nearestDist = Infinity;
      for (const s of this.facilities) {
        const dx = d.x - s.x;
        const dy = d.y - s.y;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) { nearestDist = dist; nearestId = s.id; }
      }
      if (nearestId) {
        this.stationLoad.set(nearestId, (this.stationLoad.get(nearestId) ?? 0) + d.weight);
      }
    }

    const cap = this.facilities.reduce((s, f) => s + f.capacity, 0);
    this.loadRatio = cap > 0 ? total / cap : (total > 0 ? Infinity : 0);
  }

  getStationLoad(stationId: string): number {
    return Math.round(this.stationLoad.get(stationId) ?? 0);
  }

  getLoadRatio(): number {
    return this.loadRatio;
  }

  removeStation(id: string): void {
    this.removeFacilityById(id);
  }

  getStations(): readonly FireStation[] {
    return this.facilities;
  }

  getActiveFires(): readonly ActiveFire[] {
    return this.activeFires;
  }

  getResponseTime(x: number, y: number): number {
    const cost = this.coverage.getCost(x, y);
    if (cost === Infinity) return Infinity;
    return cost / FIRE.RESPONSE_SPEED;
  }

  reportFire(x: number, y: number): { covered: boolean; estimatedDamage: number } {
    const covered = this.getCoverage(x, y);
    let damage = covered ? FIRE.COVERED_DAMAGE : FIRE.UNCOVERED_DAMAGE;
    // Overloaded stations are less effective at fighting fires
    if (covered && this.loadRatio > 1) {
      const t = Math.min(1, (this.loadRatio - 1) / 2); // 1x→3x maps to 0→1
      damage = FIRE.COVERED_DAMAGE + t * (FIRE.UNCOVERED_DAMAGE - FIRE.COVERED_DAMAGE);
    }

    this.activeFires.push({
      x,
      y,
      ticksRemaining: FIRE.FIRE_DURATION,
      damage,
    });

    return { covered, estimatedDamage: damage };
  }

  getFireRisk(x: number, y: number): number {
    if (this.facilities.length === 0) return 1;

    const cost = this.coverage.getCost(x, y);
    const budget = ROAD_COVERAGE.FIRE_BUDGET;

    if (cost === Infinity) {
      return Math.min(1, FIRE.RISK_OUTSIDE_BASE + FIRE.RISK_OUTSIDE_FACTOR);
    }

    const ratio = cost / budget;
    return Math.min(1, ratio * FIRE.RISK_INSIDE_FACTOR);
  }

  tick(): void {
    for (const fire of this.activeFires) {
      if (fire.ticksRemaining > 0) {
        fire.ticksRemaining--;
      }
    }
  }

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

  tryRandomFire(
    grid: { width: number; height: number; getCell(x: number, y: number): { buildingId: number; zoneType: number } | null },
    population: number,
    probabilityOverride?: number,
  ): boolean {
    const baseProbability = probabilityOverride ?? Math.min(FIRE.MAX_IGNITION_PROB, FIRE.BASE_IGNITION_PROB + population * FIRE.IGNITION_POP_FACTOR);
    if (Math.random() >= baseProbability) return false;

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

  toJSON(): FireServiceJSON {
    return {
      stations: this.facilities.map(s => ({ ...s })),
      activeFires: this.activeFires.map(f => ({ ...f })),
      nextId: this.nextId,
      recentDaily: [...this.recentDaily],
      recentIndex: this.recentIndex,
      todayExtinguished: this.todayExtinguished,
    };
  }

  static fromJSON(json: FireServiceJSON): FireService {
    const service = new FireService();
    service.facilities = json.stations.map(s => ({ ...s, radius: FIRE.DEFAULT_RADIUS, capacity: FIRE.DEFAULT_CAPACITY }));
    for (const f of service.facilities) service.connectedFacilityIds.add(f.id);
    service.activeFires = json.activeFires.map(f => ({ ...f }));
    service.nextId = json.nextId;
    service.recentDaily = json.recentDaily ?? new Array(30).fill(0);
    service.recentIndex = json.recentIndex ?? 0;
    service.todayExtinguished = json.todayExtinguished ?? 0;
    return service;
  }
}

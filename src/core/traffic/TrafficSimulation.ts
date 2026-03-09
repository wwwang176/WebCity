import { RoadType, ROAD_CONFIGS } from '../road/types';

export interface Vehicle {
  id: number;
  path: string[];
  pathPos: number; // continuous position along path (integer = cell center, +0.5 = cell boundary)
  speed: number;
  length: number;  // vehicle body length in world units
  arrived: boolean;
  lane: number;    // assigned lane (0-based), used for lateral offset on multi-lane roads
  totalLanes: number; // total directional lanes available
  laneChangeCooldown: number; // ticks remaining before next lane change allowed
}

/** Vehicle lengths matching renderer model sizes */
const VEHICLE_LENGTHS = [
  { weight: 0.70, length: 0.22 },  // car
  { weight: 0.15, length: 0.45 },  // bus
  { weight: 0.10, length: 0.32 },  // truck
  { weight: 0.05, length: 0.34 },  // firetruck
];

/** Get the number of directional lanes for a road type (lanes going one way). */
export function getLaneCount(roadType: number): number {
  const config = ROAD_CONFIGS[roadType as RoadType];
  if (!config || config.lanes === 0) return 1;
  // ROAD_CONFIGS.lanes is total lanes (both directions).
  // For bidirectional roads, directional lanes = total / 2.
  // ONE_WAY roads use all lanes in one direction.
  if (roadType === RoadType.ONE_WAY) return config.lanes;
  return Math.max(1, Math.floor(config.lanes / 2));
}

/**
 * Continuous traffic simulation — grid-free movement.
 * Path planning uses the grid, but movement and collision are purely distance-based.
 * Each vehicle independently checks:
 *  1. Is there a vehicle ahead within MIN_GAP? → stop behind it
 *  2. Is there a red light ahead? → stop at the stop line (cell boundary)
 */
export class TrafficSimulation {
  vehicles: Vehicle[] = [];
  private nextId = 1;

  private static readonly BASE_SPEED = 3.5;   // path-units per tick at reference speed limit (50)
  private static readonly REFERENCE_LIMIT = 50; // speed limit that maps to BASE_SPEED
  private static readonly MIN_GAP = 0.15;    // min distance between vehicles
  private static readonly STOP_OFFSET = 0.25; // align vehicle front with stop line (0.25 from cell center)
  private static readonly LANE_CHANGE_GAP = 0.4;  // blocked gap threshold to trigger lane change
  private static readonly LANE_CHANGE_SAFE = 0.5; // min clearance needed in target lane
  private static readonly LANE_CHANGE_COOLDOWN = 5; // ticks after lane change before next allowed

  /**
   * Add a vehicle to the simulation.
   * @param path cell keys along the route
   * @param totalDirectionalLanes number of lanes going in the vehicle's direction (default 1)
   */
  addVehicle(path: string[], totalDirectionalLanes = 1): Vehicle {
    // Pick random vehicle length based on weighted distribution
    let len = 0.22;
    const roll = Math.random();
    let cumulative = 0;
    for (const entry of VEHICLE_LENGTHS) {
      cumulative += entry.weight;
      if (roll < cumulative) { len = entry.length; break; }
    }

    // Assign lane: pick the lane with fewest vehicles for load-balancing
    const lanes = Math.max(1, totalDirectionalLanes);
    let lane = 0;
    if (lanes > 1) {
      // Count vehicles per lane on the same starting cell
      const startCell = path[0];
      const laneCounts = new Array(lanes).fill(0) as number[];
      for (const v of this.vehicles) {
        if (v.arrived) continue;
        const vCell = v.path[Math.floor(v.pathPos)];
        if (vCell === startCell && v.lane < lanes) {
          laneCounts[v.lane]!++;
        }
      }
      // Pick lane with minimum count (random tiebreak)
      let minCount = laneCounts[0]!;
      for (let i = 1; i < lanes; i++) {
        if (laneCounts[i]! < minCount) {
          minCount = laneCounts[i]!;
          lane = i;
        }
      }
    }

    const vehicle: Vehicle = {
      id: this.nextId++,
      path,
      pathPos: 0,
      speed: TrafficSimulation.BASE_SPEED,
      length: len,
      arrived: false,
      lane,
      totalLanes: lanes,
      laneChangeCooldown: 0,
    };
    this.vehicles.push(vehicle);
    return vehicle;
  }

  tick(
    canAdvance?: (current: string, next: string) => boolean,
    getSpeedLimit?: (cellKey: string) => number,
  ): void {
    const { MIN_GAP, STOP_OFFSET, BASE_SPEED, REFERENCE_LIMIT,
      LANE_CHANGE_GAP, LANE_CHANGE_SAFE, LANE_CHANGE_COOLDOWN } = TrafficSimulation;

    // Pre-compute world positions, heading vectors, lengths, and lane for all vehicles
    const info = new Map<number, { x: number; y: number; hx: number; hy: number; len: number; lane: number }>();
    for (const v of this.vehicles) {
      if (v.arrived) continue;
      const pos = this.getVehiclePosition(v);
      if (!pos) continue;
      const h = this.headingVec(v);
      info.set(v.id, { x: pos.x, y: pos.y, hx: h.hx, hy: h.hy, len: v.length, lane: v.lane });
    }

    for (const v of this.vehicles) {
      if (v.arrived) continue;
      const me = info.get(v.id);
      if (!me) continue;

      // ── 1. Clearance to nearest vehicle ahead (world-space, same direction, same lane) ──
      let gap = Infinity; // actual gap between vehicle bodies
      for (const [otherId, other] of info) {
        if (otherId === v.id) continue;

        // Only check vehicles in the same lane — different lanes can pass freely
        if (other.lane !== me.lane) continue;

        const dx = other.x - me.x;
        const dy = other.y - me.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2.5) continue; // skip distant vehicles

        // Is it ahead of me? (positive projection on my heading)
        const ahead = dx * me.hx + dy * me.hy;
        if (ahead <= 0) continue;

        // Same direction? (heading dot product > 0.5 ≈ within 60°)
        if (me.hx * other.hx + me.hy * other.hy < 0.5) continue;

        // Body gap = center-to-center distance minus half-lengths of both vehicles
        const bodyGap = ahead - me.len / 2 - other.len / 2;
        if (bodyGap < gap) gap = bodyGap;
      }

      // ── 1b. Lane change — when blocked and adjacent lane is free ──
      if (v.laneChangeCooldown > 0) {
        v.laneChangeCooldown--;
      } else if (v.totalLanes > 1 && gap < LANE_CHANGE_GAP) {
        // Try adjacent lanes (current ± 1)
        const candidates = [];
        if (v.lane > 0) candidates.push(v.lane - 1);
        if (v.lane < v.totalLanes - 1) candidates.push(v.lane + 1);

        for (const targetLane of candidates) {
          // Check clearance in target lane
          let targetGap = Infinity;
          for (const [otherId, other] of info) {
            if (otherId === v.id) continue;
            if (other.lane !== targetLane) continue;

            const dx = other.x - me.x;
            const dy = other.y - me.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 2.5) continue;

            const bodyDist = dist - me.len / 2 - other.len / 2;
            if (bodyDist < targetGap) targetGap = bodyDist;
          }

          if (targetGap >= LANE_CHANGE_SAFE) {
            v.lane = targetLane;
            me.lane = targetLane; // update info map for other vehicles' checks
            v.laneChangeCooldown = LANE_CHANGE_COOLDOWN;
            break;
          }
        }
      }

      // ── 2. Distance to nearest red light on path ──
      let redLightDist = Infinity;
      if (canAdvance) {
        const idx = Math.floor(v.pathPos);
        const frac = v.pathPos - idx;
        // Look ahead up to 3 cells
        for (let i = idx; i < Math.min(v.path.length - 1, idx + 3); i++) {
          // Distance from current position to the boundary between cell i and i+1
          const distToBoundary = (i - idx) + (0.5 - frac);
          if (distToBoundary < 0) continue; // already past this boundary
          if (!canAdvance(v.path[i]!, v.path[i + 1]!)) {
            redLightDist = Math.max(0, distToBoundary - STOP_OFFSET - v.length / 2);
            break;
          }
        }
      }

      // ── 3. Advance ──
      // Adjust speed based on current cell's speed limit
      const currentCell = v.path[Math.floor(v.pathPos)];
      const limit = getSpeedLimit && currentCell ? getSpeedLimit(currentCell) : REFERENCE_LIMIT;
      const effectiveSpeed = v.speed * (limit / REFERENCE_LIMIT);

      const room = Math.max(0, Math.min(gap - MIN_GAP, redLightDist));
      v.pathPos += Math.min(effectiveSpeed, room);

      if (v.pathPos >= v.path.length - 1) {
        v.pathPos = v.path.length - 1;
        v.arrived = true;
      }
    }

    this.vehicles = this.vehicles.filter((v) => !v.arrived);
  }

  /** World position from pathPos */
  getVehiclePosition(v: Vehicle): { x: number; y: number } | null {
    const idx = Math.floor(v.pathPos);
    const frac = v.pathPos - idx;
    const p1 = v.path[idx];
    if (!p1) return null;
    const [x1s, y1s] = p1.split(',');
    const x1 = Number(x1s), y1 = Number(y1s);
    if (idx < v.path.length - 1) {
      const [x2s, y2s] = v.path[idx + 1]!.split(',');
      return { x: x1 + (Number(x2s) - x1) * frac, y: y1 + (Number(y2s) - y1) * frac };
    }
    return { x: x1, y: y1 };
  }

  /** Unit heading vector for a vehicle */
  private headingVec(v: Vehicle): { hx: number; hy: number } {
    const idx = Math.floor(v.pathPos);
    if (idx < v.path.length - 1) {
      const [x1, y1] = v.path[idx]!.split(',').map(Number);
      const [x2, y2] = v.path[idx + 1]!.split(',').map(Number);
      const dx = x2! - x1!, dy = y2! - y1!;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) return { hx: dx / len, hy: dy / len };
    }
    return { hx: 1, hy: 0 };
  }

  // ── Stats (for overlays / UI) ──

  getSegmentDensity(segment: string): number {
    let count = 0;
    for (const v of this.vehicles) {
      if (v.arrived) continue;
      const cell = v.path[Math.floor(v.pathPos)];
      if (cell === segment) count++;
    }
    return count;
  }

  getVehicleCount(): number {
    return this.vehicles.length;
  }

  getTopCongested(n: number): { segment: string; density: number }[] {
    const counts = new Map<string, number>();
    for (const v of this.vehicles) {
      if (v.arrived) continue;
      const cell = v.path[Math.floor(v.pathPos)];
      if (cell) counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([segment, density]) => ({ segment, density }))
      .sort((a, b) => b.density - a.density)
      .slice(0, n);
  }

  getAveragePathLength(): number {
    if (this.vehicles.length === 0) return 0;
    return this.vehicles.reduce((sum, v) => sum + v.path.length, 0) / this.vehicles.length;
  }
}

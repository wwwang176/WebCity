import { RoadType, ROAD_CONFIGS } from '../road/types';
import type { LaneEdge } from './LaneGraph';
import { cubicBezierPoint, cubicBezierTangent } from './BezierPath';

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
  // Edge-based path (new system)
  edgePath?: LaneEdge[];
  edgeIndex: number;     // current edge in edgePath
  edgeProgress: number;  // distance traveled along current edge
  edgeMoveRate: number;  // distance moved last tick (for render extrapolation)
  speedMultiplier: number; // random 0.8–1.0, prevents vehicles from bunching at same speed
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
  /** Per-cell vehicle count, rebuilt every advanceEdgeVehicles call. */
  private cellDensity = new Map<string, number>();

  private static readonly BASE_SPEED = 3.5;   // path-units per tick at reference speed limit (50)
  private static readonly EDGE_SPEED = 14;    // edge vehicle speed in world-units per second (3.5 / 0.25)
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
      edgeIndex: 0,
      edgeProgress: 0,
      edgeMoveRate: 0,
      speedMultiplier: 0.8 + Math.random() * 0.2,
    };
    this.vehicles.push(vehicle);
    // Update density map for immediate queries
    if (path[0]) {
      this.cellDensity.set(path[0], (this.cellDensity.get(path[0]) ?? 0) + 1);
    }
    return vehicle;
  }

  /** Add a vehicle that follows a LaneEdge path (new lane-graph system). */
  addVehicleOnEdges(edgePath: LaneEdge[]): Vehicle {
    let len = 0.22;
    const roll = Math.random();
    let cumulative = 0;
    for (const entry of VEHICLE_LENGTHS) {
      cumulative += entry.weight;
      if (roll < cumulative) { len = entry.length; break; }
    }

    const vehicle: Vehicle = {
      id: this.nextId++,
      path: [],        // empty — not using cell-based path
      pathPos: 0,
      speed: TrafficSimulation.BASE_SPEED,
      length: len,
      arrived: false,
      lane: edgePath[0]?.from.lane ?? 0,
      totalLanes: 1,
      laneChangeCooldown: 0,
      edgePath,
      edgeIndex: 0,
      edgeProgress: 0,
      edgeMoveRate: 0,
      speedMultiplier: 0.8 + Math.random() * 0.2,
    };
    this.vehicles.push(vehicle);
    // Update density map for immediate queries
    const startCell = edgePath[0]?.from.cellKey;
    if (startCell) {
      this.cellDensity.set(startCell, (this.cellDensity.get(startCell) ?? 0) + 1);
    }
    return vehicle;
  }

  /**
   * Advance edge-based vehicles every render frame.
   * Handles movement, collision detection, red lights, and arrival — fully independent of sim tick.
   * @param dtSeconds — frame delta time in seconds (already scaled by game speed)
   */
  advanceEdgeVehicles(
    dtSeconds: number,
    canAdvance?: (current: string, next: string) => boolean,
    getSpeedLimit?: (cellKey: string) => number,
  ): void {
    const { MIN_GAP, EDGE_SPEED, REFERENCE_LIMIT } = TrafficSimulation;

    // Collect edge-based vehicles
    const edgeVehicles = this.vehicles.filter(v => v.edgePath && v.edgePath.length > 0 && !v.arrived);
    if (edgeVehicles.length === 0) return;

    // Sort front-to-back: higher total progress = further ahead.
    // Tiebreaker: lower ID first (older vehicle has priority when overlapping).
    edgeVehicles.sort((a, b) => {
      const aTotal = this.edgeTotalProgress(a);
      const bTotal = this.edgeTotalProgress(b);
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.id - b.id; // lower ID = ahead = processed first
    });

    // Build edge index: edgeId → list of { vehicleId, progress, halfLen }
    // This allows O(1) lookup of vehicles on any given edge.
    type EdgeEntry = { vid: number; progress: number; halfLen: number };
    const edgeIndex = new Map<string, EdgeEntry[]>();
    for (const v of edgeVehicles) {
      if (v.arrived) continue;
      const ep = v.edgePath!;
      const edge = ep[v.edgeIndex];
      if (!edge) continue;
      let arr = edgeIndex.get(edge.id);
      if (!arr) { arr = []; edgeIndex.set(edge.id, arr); }
      arr.push({ vid: v.id, progress: v.edgeProgress, halfLen: v.length / 2 });
    }

    for (const v of edgeVehicles) {
      if (v.arrived) continue;
      const ep = v.edgePath!;

      // 1. Gap to nearest vehicle ahead on the SAME edge path
      let gap = Infinity;
      const myHalfLen = v.length / 2;
      {
        let distAhead = 0;
        for (let ei = v.edgeIndex; ei < ep.length; ei++) {
          const edge = ep[ei]!;
          const myProgress = ei === v.edgeIndex ? v.edgeProgress : 0;
          const edgeRemain = edge.length - myProgress;

          // Check vehicles on this edge
          const entries = edgeIndex.get(edge.id);
          if (entries) {
            for (const e of entries) {
              if (e.vid === v.id) continue;
              if (ei === v.edgeIndex) {
                // Same edge: only look at vehicles ahead (greater progress).
                // When at exact same progress, lower ID is "ahead" — higher ID yields.
                if (e.progress < v.edgeProgress) continue;
                if (e.progress === v.edgeProgress && e.vid > v.id) continue;
                const dist = (e.progress - v.edgeProgress) - myHalfLen - e.halfLen;
                if (dist < gap) gap = dist;
              } else {
                // Future edge: distance = remaining on current edges + progress on that edge
                const dist = distAhead + e.progress - myHalfLen - e.halfLen;
                if (dist < gap) gap = dist;
              }
            }
          }

          distAhead += edgeRemain;
          if (distAhead > 5) break; // don't look too far ahead
        }
      }

      // 2. Distance to nearest red light on path
      let redLightDist = Infinity;
      if (canAdvance) {
        let distAhead = 0;
        for (let ei = v.edgeIndex; ei < ep.length; ei++) {
          const edge = ep[ei]!;
          const startDist = ei === v.edgeIndex ? v.edgeProgress : 0;
          const edgeRemain = edge.length - startDist;

          if (edge.from.cellKey !== edge.to.cellKey) {
            if (!canAdvance(edge.from.cellKey, edge.to.cellKey)) {
              const stopDist = distAhead - (ei === v.edgeIndex ? 0 : startDist);
              redLightDist = Math.max(0, stopDist - v.length / 2);
              break;
            }
          }

          distAhead += edgeRemain;
          if (distAhead > 5) break;
        }
      }

      // 3. Speed limit from current edge's cell
      const currentEdge = ep[v.edgeIndex];
      const cellKey = currentEdge?.from.cellKey;
      const limit = getSpeedLimit && cellKey ? getSpeedLimit(cellKey) : REFERENCE_LIMIT;
      const effectiveSpeed = EDGE_SPEED * (limit / REFERENCE_LIMIT) * v.speedMultiplier * dtSeconds;

      // 4. Advance
      const gapRoom = Math.max(0, gap - MIN_GAP);
      const room = Math.max(0, Math.min(gapRoom, redLightDist));
      let moveDistance = Math.min(effectiveSpeed, room);

      while (moveDistance > 0 && v.edgeIndex < ep.length) {
        const edge = ep[v.edgeIndex]!;
        const remaining = edge.length - v.edgeProgress;
        if (moveDistance < remaining) {
          v.edgeProgress += moveDistance;
          moveDistance = 0;
        } else {
          moveDistance -= remaining;
          v.edgeIndex++;
          v.edgeProgress = 0;
        }
      }

      if (v.edgeIndex >= ep.length) {
        v.edgeIndex = ep.length - 1;
        v.edgeProgress = ep[v.edgeIndex]!.length;
        v.arrived = true;
      }

      // Update edge index for trailing vehicles to see our new position
      const oldEdge = currentEdge;
      const newEdge = ep[v.edgeIndex];
      if (oldEdge && newEdge && oldEdge.id !== newEdge.id) {
        // Remove from old edge
        const oldArr = edgeIndex.get(oldEdge.id);
        if (oldArr) {
          const idx = oldArr.findIndex(e => e.vid === v.id);
          if (idx >= 0) oldArr.splice(idx, 1);
        }
        // Add to new edge
        let newArr = edgeIndex.get(newEdge.id);
        if (!newArr) { newArr = []; edgeIndex.set(newEdge.id, newArr); }
        newArr.push({ vid: v.id, progress: v.edgeProgress, halfLen: myHalfLen });
      } else if (oldEdge) {
        // Same edge, just update progress
        const arr = edgeIndex.get(oldEdge.id);
        if (arr) {
          const entry = arr.find(e => e.vid === v.id);
          if (entry) entry.progress = v.edgeProgress;
        }
      }
    }

    // Rebuild cell density map from all active vehicles (edge + legacy)
    this.cellDensity.clear();
    for (const v of this.vehicles) {
      if (v.arrived) continue;
      let cell: string | undefined;
      if (v.edgePath && v.edgePath.length > 0) {
        const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
        cell = v.edgePath[idx]!.from.cellKey;
      } else if (v.path.length > 0) {
        cell = v.path[Math.floor(v.pathPos)];
      }
      if (cell) {
        this.cellDensity.set(cell, (this.cellDensity.get(cell) ?? 0) + 1);
      }
    }
  }

  /** Total distance traveled along edge path (for sorting). */
  private edgeTotalProgress(v: Vehicle): number {
    if (!v.edgePath) return 0;
    let total = 0;
    for (let i = 0; i < v.edgeIndex && i < v.edgePath.length; i++) {
      total += v.edgePath[i]!.length;
    }
    return total + v.edgeProgress;
  }

  /** World position for an edge-based vehicle. */
  getVehiclePositionOnEdges(v: Vehicle): { x: number; y: number } | null {
    if (!v.edgePath || v.edgePath.length === 0) return null;
    const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
    const edge = v.edgePath[idx]!;
    const t = edge.length > 0 ? Math.min(v.edgeProgress / edge.length, 1) : 0;

    if (edge.bezierControl && edge.bezierControl.length >= 2) {
      return cubicBezierPoint(
        edge.from.position,
        edge.bezierControl[0]!,
        edge.bezierControl[1]!,
        edge.to.position,
        t,
      );
    }

    // Linear interpolation for straight edges
    return {
      x: edge.from.position.x + (edge.to.position.x - edge.from.position.x) * t,
      y: edge.from.position.y + (edge.to.position.y - edge.from.position.y) * t,
    };
  }

  /** Heading angle (radians) for an edge-based vehicle. 0 = east. */
  getVehicleHeadingOnEdges(v: Vehicle): number {
    const h = this.edgeHeadingVec(v);
    // Negate Y to match Three.js convention: game +Y = south, Three.js +Z = south
    // Legacy vehicles use atan2(-(y2-y1), x2-x1), so edge vehicles must do the same.
    return Math.atan2(-h.hy, h.hx);
  }

  /**
   * Peek ahead by `extraDist` along the edge path from current position
   * without mutating vehicle state. Returns extrapolated position and heading.
   */
  peekEdgePosition(v: Vehicle, extraDist: number): { x: number; y: number; heading: number } | null {
    if (!v.edgePath || v.edgePath.length === 0) return null;
    // Walk forward from current state
    let ei = v.edgeIndex;
    let ep = v.edgeProgress;
    let d = extraDist;
    while (d > 0 && ei < v.edgePath.length) {
      const edge = v.edgePath[ei]!;
      const remaining = edge.length - ep;
      if (d < remaining) {
        ep += d;
        d = 0;
      } else {
        d -= remaining;
        ei++;
        ep = 0;
      }
    }
    if (ei >= v.edgePath.length) {
      ei = v.edgePath.length - 1;
      ep = v.edgePath[ei]!.length;
    }
    // Compute position and heading at peeked state
    const edge = v.edgePath[ei]!;
    const t = edge.length > 0 ? Math.min(ep / edge.length, 1) : 0;
    let x: number, y: number;
    if (edge.bezierControl && edge.bezierControl.length >= 2) {
      const p = cubicBezierPoint(edge.from.position, edge.bezierControl[0]!, edge.bezierControl[1]!, edge.to.position, t);
      x = p.x; y = p.y;
    } else {
      x = edge.from.position.x + (edge.to.position.x - edge.from.position.x) * t;
      y = edge.from.position.y + (edge.to.position.y - edge.from.position.y) * t;
    }
    let tx: number, ty: number;
    if (edge.bezierControl && edge.bezierControl.length >= 2) {
      const tan = cubicBezierTangent(edge.from.position, edge.bezierControl[0]!, edge.bezierControl[1]!, edge.to.position, t);
      tx = tan.x; ty = tan.y;
    } else {
      tx = edge.to.position.x - edge.from.position.x;
      ty = edge.to.position.y - edge.from.position.y;
    }
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    const heading = Math.atan2(-ty / len, tx / len);
    return { x, y, heading };
  }

  /** Unit heading vector for edge-based vehicle. */
  private edgeHeadingVec(v: Vehicle): { hx: number; hy: number } {
    if (!v.edgePath || v.edgePath.length === 0) return { hx: 1, hy: 0 };
    const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
    const edge = v.edgePath[idx]!;
    const t = edge.length > 0 ? Math.min(v.edgeProgress / edge.length, 1) : 0;

    let tx: number, ty: number;
    if (edge.bezierControl && edge.bezierControl.length >= 2) {
      const tan = cubicBezierTangent(
        edge.from.position,
        edge.bezierControl[0]!,
        edge.bezierControl[1]!,
        edge.to.position,
        t,
      );
      tx = tan.x;
      ty = tan.y;
    } else {
      tx = edge.to.position.x - edge.from.position.x;
      ty = edge.to.position.y - edge.from.position.y;
    }

    const len = Math.sqrt(tx * tx + ty * ty);
    if (len > 0) return { hx: tx / len, hy: ty / len };
    return { hx: 1, hy: 0 };
  }

  tick(
    canAdvance?: (current: string, next: string) => boolean,
    getSpeedLimit?: (cellKey: string) => number,
    getCellLaneCount?: (cellKey: string) => number,
  ): void {
    // Edge vehicles are now advanced per render frame via advanceEdgeVehicles()
    // Tick only handles legacy cell-based vehicles below
    const { MIN_GAP, STOP_OFFSET, BASE_SPEED, REFERENCE_LIMIT,
      LANE_CHANGE_GAP, LANE_CHANGE_SAFE, LANE_CHANGE_COOLDOWN } = TrafficSimulation;

    // Pre-compute world positions, heading vectors, lengths, and lane for all vehicles
    type VInfo = { x: number; y: number; hx: number; hy: number; len: number; lane: number };
    const info = new Map<number, VInfo>();
    for (const v of this.vehicles) {
      if (v.arrived) continue;
      const pos = this.getVehiclePosition(v);
      if (!pos) continue;
      const h = this.headingVec(v);
      info.set(v.id, { x: pos.x, y: pos.y, hx: h.hx, hy: h.hy, len: v.length, lane: v.lane });
    }

    // Sort front-to-back so leading vehicles move first and trailing ones
    // see their updated positions within the same tick (eliminates 1-tick lag).
    const active = this.vehicles.filter((v) => !v.arrived && info.has(v.id));
    active.sort((a, b) => b.pathPos - a.pathPos);

    // Build segment index: (cell→nextCell, lane) → vehicle IDs.
    // Each directed edge + lane is a unique "curved lane segment".
    const segIdx = new Map<string, number[]>();
    for (const v of active) {
      const idx = Math.floor(v.pathPos);
      const cell = v.path[idx];
      const next = v.path[idx + 1];
      if (!cell || !next) continue;
      const key = `${cell}>${next},${v.lane}`;
      let arr = segIdx.get(key);
      if (!arr) { arr = []; segIdx.set(key, arr); }
      arr.push(v.id);
    }

    for (const v of active) {
      if (v.arrived) continue;
      const me = info.get(v.id);
      if (!me) continue;

      // ── 1. Clearance to nearest vehicle ahead on the same route ──
      // Only check vehicles on my upcoming path segments (same directed edge + lane).
      // No heading check needed — segment direction is implicit.
      let gap = Infinity;
      const myIdx = Math.floor(v.pathPos);
      for (let i = myIdx; i < Math.min(myIdx + 4, v.path.length - 1); i++) {
        const key = `${v.path[i]}>${v.path[i + 1]},${v.lane}`;
        const candidates = segIdx.get(key);
        if (!candidates) continue;
        for (const otherId of candidates) {
          if (otherId === v.id) continue;
          const other = info.get(otherId);
          if (!other || other.lane !== v.lane) continue; // filter stale lane-change entries

          const dx = other.x - me.x;
          const dy = other.y - me.y;

          // Is it ahead of me? (positive projection on my heading)
          const ahead = dx * me.hx + dy * me.hy;
          if (ahead <= 0) continue;

          // Body gap = center-to-center distance minus half-lengths of both vehicles
          const bodyGap = ahead - me.len / 2 - other.len / 2;
          if (bodyGap < gap) gap = bodyGap;
        }
      }

      // ── 1b. Lane change — when blocked and adjacent lane is free ──
      if (v.laneChangeCooldown > 0) {
        v.laneChangeCooldown--;
      } else if (v.totalLanes > 1 && gap < LANE_CHANGE_GAP) {
        const candidates = [];
        if (v.lane > 0) candidates.push(v.lane - 1);
        if (v.lane < v.totalLanes - 1) candidates.push(v.lane + 1);

        for (const targetLane of candidates) {
          // Check clearance in target lane using segment index
          let targetGap = Infinity;
          for (let i = myIdx; i < Math.min(myIdx + 3, v.path.length - 1); i++) {
            const key = `${v.path[i]}>${v.path[i + 1]},${targetLane}`;
            const others = segIdx.get(key);
            if (!others) continue;
            for (const otherId of others) {
              if (otherId === v.id) continue;
              const other = info.get(otherId);
              if (!other) continue;
              const dx = other.x - me.x;
              const dy = other.y - me.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const bodyDist = dist - me.len / 2 - other.len / 2;
              if (bodyDist < targetGap) targetGap = bodyDist;
            }
          }

          if (targetGap >= LANE_CHANGE_SAFE) {
            v.lane = targetLane;
            me.lane = targetLane;
            v.laneChangeCooldown = LANE_CHANGE_COOLDOWN;
            // Add to new lane's segment index (stale old-lane entry is harmless)
            const cell = v.path[myIdx];
            const next = v.path[myIdx + 1];
            if (cell && next) {
              const newKey = `${cell}>${next},${targetLane}`;
              let arr = segIdx.get(newKey);
              if (!arr) { arr = []; segIdx.set(newKey, arr); }
              arr.push(v.id);
            }
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

      // Update lane info when entering a new road segment
      if (getCellLaneCount) {
        const cell = v.path[Math.floor(v.pathPos)];
        if (cell) {
          const newLanes = getCellLaneCount(cell);
          if (newLanes !== v.totalLanes) {
            v.totalLanes = newLanes;
            if (v.lane >= newLanes) v.lane = newLanes - 1;
          }
        }
      }

      // Eagerly update info + segment index so trailing vehicles see new position this tick
      const newPos = this.getVehiclePosition(v);
      if (newPos) {
        const newH = this.headingVec(v);
        const entry = info.get(v.id)!;
        entry.x = newPos.x;
        entry.y = newPos.y;
        entry.hx = newH.hx;
        entry.hy = newH.hy;
        entry.lane = v.lane;

        // Update segment index if vehicle moved to a new cell
        const newIdx = Math.floor(v.pathPos);
        const newCell = v.path[newIdx];
        const newNext = v.path[newIdx + 1];
        if (newCell && newNext && newIdx !== myIdx) {
          const newKey = `${newCell}>${newNext},${v.lane}`;
          let arr = segIdx.get(newKey);
          if (!arr) { arr = []; segIdx.set(newKey, arr); }
          arr.push(v.id);
        }
      }
    }

    this.vehicles = this.vehicles.filter((v) => !v.arrived);

    // Rebuild cell density map (covers both legacy and edge vehicles)
    this.cellDensity.clear();
    for (const v of this.vehicles) {
      if (v.arrived) continue;
      let cell: string | undefined;
      if (v.edgePath && v.edgePath.length > 0) {
        const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
        cell = v.edgePath[idx]!.from.cellKey;
      } else if (v.path.length > 0) {
        cell = v.path[Math.floor(v.pathPos)];
      }
      if (cell) {
        this.cellDensity.set(cell, (this.cellDensity.get(cell) ?? 0) + 1);
      }
    }
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
    return this.cellDensity.get(segment) ?? 0;
  }

  getVehicleCount(): number {
    return this.vehicles.length;
  }

  getTopCongested(n: number): { segment: string; density: number }[] {
    return [...this.cellDensity.entries()]
      .map(([segment, density]) => ({ segment, density }))
      .sort((a, b) => b.density - a.density)
      .slice(0, n);
  }

  getAveragePathLength(): number {
    if (this.vehicles.length === 0) return 0;
    return this.vehicles.reduce((sum, v) => sum + v.path.length, 0) / this.vehicles.length;
  }
}

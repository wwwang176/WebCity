import { RoadType, ROAD_CONFIGS } from '../road/types';
import type { LaneEdge } from './LaneGraph';
import { cubicBezierPoint, cubicBezierTangent } from './BezierPath';

export interface Vehicle {
  id: number;
  length: number;  // vehicle body length in world units
  arrived: boolean;
  lane: number;    // assigned lane (0-based), used for lateral offset on multi-lane roads
  edgePath: LaneEdge[];
  edgeIndex: number;     // current edge in edgePath
  edgeProgress: number;  // distance traveled along current edge
  edgeMoveRate: number;  // distance moved last tick (for render extrapolation)
  speedMultiplier: number; // random 0.8–1.0, prevents vehicles from bunching at same speed
  stallTime: number;  // accumulated seconds at zero movement; despawned when exceeding threshold
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
 * Edge-based traffic simulation.
 * Vehicles follow LaneEdge paths with Bezier curves.
 * Each vehicle independently checks:
 *  1. Is there a vehicle ahead within MIN_GAP? → stop behind it
 *  2. Is there a red light ahead? → stop at the stop line (cell boundary)
 */
export class TrafficSimulation {
  vehicles: Vehicle[] = [];
  private nextId = 1;
  /** Per-cell vehicle count, rebuilt every advanceEdgeVehicles call. */
  private cellDensity = new Map<string, number>();
  /** Predicted congestion flow (path count per cell), set by SimulationLoop periodically. */
  private predictedFlow: Map<string, number> | null = null;

  private static readonly EDGE_SPEED = 14;    // edge vehicle speed in world-units per second
  private static readonly REFERENCE_LIMIT = 50; // speed limit that maps to base speed
  private static readonly MIN_GAP = 0.15;    // min distance between vehicles
  private static readonly DESPAWN_STALL_TIME = 30; // seconds of zero movement before vehicle is despawned

  /** Add a vehicle that follows a LaneEdge path. */
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
      length: len,
      arrived: false,
      lane: edgePath[0]?.from.lane ?? 0,
      edgePath,
      edgeIndex: 0,
      edgeProgress: 0,
      edgeMoveRate: 0,
      speedMultiplier: 0.8 + Math.random() * 0.2,
      stallTime: 0,
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
   * Handles movement, collision detection, red lights, arrival, and cleanup.
   * @param dtSeconds — frame delta time in seconds (already scaled by game speed)
   */
  advanceEdgeVehicles(
    dtSeconds: number,
    canAdvance?: (current: string, next: string) => boolean,
    getSpeedLimit?: (cellKey: string) => number,
  ): void {
    const { MIN_GAP, EDGE_SPEED, REFERENCE_LIMIT } = TrafficSimulation;

    // Collect active vehicles
    const edgeVehicles = this.vehicles.filter(v => v.edgePath.length > 0 && !v.arrived);
    if (edgeVehicles.length === 0) {
      // Still clean up arrived vehicles
      this.vehicles = this.vehicles.filter(v => !v.arrived);
      return;
    }

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
      const ep = v.edgePath;
      const edge = ep[v.edgeIndex];
      if (!edge) continue;
      let arr = edgeIndex.get(edge.id);
      if (!arr) { arr = []; edgeIndex.set(edge.id, arr); }
      arr.push({ vid: v.id, progress: v.edgeProgress, halfLen: v.length / 2 });
    }

    for (const v of edgeVehicles) {
      if (v.arrived) continue;
      const ep = v.edgePath;

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

      // Track stall time for stuck vehicle despawn
      if (moveDistance < 0.001 && room < 0.001) {
        v.stallTime += dtSeconds;
        if (v.stallTime >= TrafficSimulation.DESPAWN_STALL_TIME) {
          v.arrived = true;
        }
      } else {
        v.stallTime = 0;
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

    // Remove arrived vehicles
    this.vehicles = this.vehicles.filter(v => !v.arrived);

    // Rebuild cell density map from all active vehicles
    this.cellDensity.clear();
    for (const v of this.vehicles) {
      const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
      const cell = v.edgePath[idx]?.from.cellKey;
      if (cell) {
        this.cellDensity.set(cell, (this.cellDensity.get(cell) ?? 0) + 1);
      }
    }
  }

  /** Total distance traveled along edge path (for sorting). */
  private edgeTotalProgress(v: Vehicle): number {
    let total = 0;
    for (let i = 0; i < v.edgeIndex && i < v.edgePath.length; i++) {
      total += v.edgePath[i]!.length;
    }
    return total + v.edgeProgress;
  }

  /** World position for a vehicle. */
  getVehiclePositionOnEdges(v: Vehicle): { x: number; y: number } | null {
    if (v.edgePath.length === 0) return null;
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

  /** Heading angle (radians) for a vehicle. 0 = east. */
  getVehicleHeadingOnEdges(v: Vehicle): number {
    const h = this.edgeHeadingVec(v);
    // Negate Y to match Three.js convention: game +Y = south, Three.js +Z = south
    return Math.atan2(-h.hy, h.hx);
  }

  /**
   * Peek ahead by `extraDist` along the edge path from current position
   * without mutating vehicle state. Returns extrapolated position and heading.
   */
  peekEdgePosition(v: Vehicle, extraDist: number): { x: number; y: number; heading: number } | null {
    if (v.edgePath.length === 0) return null;
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

  /** Unit heading vector for a vehicle. */
  private edgeHeadingVec(v: Vehicle): { hx: number; hy: number } {
    if (v.edgePath.length === 0) return { hx: 1, hy: 0 };
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

  // ── Stats (for overlays / UI) ──

  /** Set predicted congestion flow map (computed by SimulationLoop periodically). */
  updatePredictedFlow(flowMap: Map<string, number>): void {
    this.predictedFlow = flowMap;
  }

  getSegmentDensity(segment: string): number {
    if (this.predictedFlow) return this.predictedFlow.get(segment) ?? 0;
    return this.cellDensity.get(segment) ?? 0;
  }

  getVehicleCount(): number {
    return this.vehicles.length;
  }

  getAveragePathLength(): number {
    if (this.vehicles.length === 0) return 0;
    let totalLen = 0;
    for (const v of this.vehicles) {
      for (const e of v.edgePath) totalLen += e.length;
    }
    return totalLen / this.vehicles.length;
  }

  getTopCongested(n: number): { segment: string; density: number }[] {
    const source = this.predictedFlow ?? this.cellDensity;
    return [...source.entries()]
      .map(([segment, density]) => ({ segment, density }))
      .sort((a, b) => b.density - a.density)
      .slice(0, n);
  }
}

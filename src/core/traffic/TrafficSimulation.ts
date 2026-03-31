import { RoadType, ROAD_CONFIGS } from '../road/types';
import type { LaneEdge } from './LaneGraph';
import { interpolateEdgePosition, interpolateEdgeTangent, interpolateEdgePositionInto, interpolateEdgeTangentInto } from './EdgeInterpolation';
import { findGapAhead, findRedLightDistance, type EdgeEntry } from './VehicleLookahead';
import { SpatialHash, type SpatialEntry } from './SpatialHash';
import { findCrossEdgeGap, CROSS_EDGE } from './CrossEdgeCollision';
import { pickWeighted } from '../utils/random';

export interface BusVehicleState {
  routeId: number;           // owning bus route ID
  segmentIndex: number;      // current segment (stop[i] → stop[i+1])
  dwelling: boolean;         // true while stopped at a bus stop
  dwellTimer: number;        // remaining dwell time (seconds)
  segments: LaneEdge[][];    // precomputed edge paths for all route segments
}

export type ServiceVehicleType = 'police' | 'fire' | 'health' | 'garbage';

export interface Vehicle {
  id: number;
  length: number;  // vehicle body length in world units
  width: number;   // vehicle body width in world units
  arrived: boolean;
  lane: number;    // assigned lane (0-based), used for lateral offset on multi-lane roads
  edgePath: LaneEdge[];
  edgeIndex: number;     // current edge in edgePath
  edgeProgress: number;  // distance traveled along current edge
  edgeMoveRate: number;  // distance moved last tick (for render extrapolation)
  speedMultiplier: number; // random 0.8–1.0, prevents vehicles from bunching at same speed
  currentSpeed: number;  // current speed in world-units/sec (used for gradual accel/decel)
  stallTime: number;  // accumulated seconds at zero movement; despawned when exceeding threshold
  citizenId?: number;  // present only for commute vehicles (prevents duplicate spawning)
  sourceBuildingKey?: string;  // present only for freight vehicles (origin building "x,y")
  busState?: BusVehicleState;  // present only for bus vehicles
  serviceType?: ServiceVehicleType;  // present only for service vehicles
}

/** Bus dwell time at each stop (seconds). */
export const BUS_DWELL_SECONDS = 2.0;

/** Fixed vehicle dimensions for service vehicles (matching renderer model sizes). */
export const SERVICE_VEHICLE_DIMS: Record<ServiceVehicleType, { length: number; width: number }> = {
  police: { length: 0.22, width: 0.09 },
  fire: { length: 0.55, width: 0.125 },
  health: { length: 0.30, width: 0.10 },
  garbage: { length: 0.45, width: 0.125 },
};

/** Vehicle dimensions for commute/random traffic (car + van only; trucks use addFreightVehicle) */
const VEHICLE_DIMS = [
  { weight: 0.80, length: 0.22, width: 0.09 },   // car
  { weight: 0.20, length: 0.26, width: 0.10 },   // van
];

/** Fixed truck dimensions for freight vehicles. */
const TRUCK_DIMS = { length: 0.45, width: 0.125 };

/** Traffic simulation tuning constants */
export const TRAFFIC = {
  /** Base speed multiplier range: min value (vehicles randomly vary speed) */
  SPEED_MULTIPLIER_MIN: 0.8,
  /** Base speed multiplier range: variation range added to min */
  SPEED_MULTIPLIER_RANGE: 0.2,
  /** Random initial stall jitter range (negative = headstart) */
  STALL_JITTER: 5,
  /** Maximum lookahead distance for gap/red-light checks */
  LOOKAHEAD_DISTANCE: 5,
  /** Density divisor per occupied cell for congestion calculation */
  DENSITY_CAPACITY_PER_CELL: 3,
  /** Edge vehicle speed in world-units per second */
  EDGE_SPEED: 7,
  /** Speed limit that maps to base speed */
  REFERENCE_LIMIT: 50,
  /** Minimum distance between vehicles */
  MIN_GAP: 0.15,
  /** Seconds of zero movement before vehicle is despawned */
  DESPAWN_STALL_TIME: 30,
  /** Distance at which vehicles begin braking (world units) */
  BRAKE_DISTANCE: 1.5,
  /** Acceleration rate (world-units/sec² ) */
  ACCEL: 8.0,
} as const;

/** Get the number of directional lanes for a road type (lanes going one way). */
/** Get speed limit for a grid cell identified by "x,y" key. Returns default 50 for non-road cells. */
export function getSpeedLimitForCell(
  grid: { getCell(x: number, y: number): { roadType: number } | null; getCellByKey?: (key: string) => { roadType: number } | null },
  cellKey: string,
): number {
  // Use key-based lookup (supports "x,y,level" for elevated roads)
  const cell = grid.getCellByKey
    ? grid.getCellByKey(cellKey)
    : (() => { const [gx, gy] = cellKey.split(',').map(Number); return grid.getCell(gx!, gy!); })();
  if (!cell || cell.roadType <= 0) return 50;
  const cfg = ROAD_CONFIGS[cell.roadType as RoadType];
  return cfg?.speedLimit ?? 50;
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
  /** Reusable scratch array for active vehicles (avoids per-frame allocation). */
  private activeVehicleScratch: Vehicle[] = [];
  /** Reusable edge index map (cleared each frame instead of re-allocated). */
  private edgeIndexMap = new Map<string, EdgeEntry[]>();
  /** Reusable spatial hash for cross-edge collision detection. */
  private spatialHash = new SpatialHash(CROSS_EDGE.CELL_SIZE);
  /** Reusable array for spatial entries (object pool — grows to high-water mark). */
  private spatialEntries: SpatialEntry[] = [];
  /** Reusable vid → SpatialEntry map (cleared each frame). */
  private vidToSpatialMap = new Map<number, SpatialEntry>();
  /** Reusable scratch array for queryNearbyInto (avoids per-call allocation). */
  private nearbyScratch: SpatialEntry[] = [];
  /** Reusable output objects for per-vehicle position/heading (avoid per-call allocation). */
  private readonly _posOut = { x: 0, y: 0 };
  private readonly _tanOut = { x: 0, y: 0 };
  private readonly _headingOut = { hx: 0, hy: 0 };


  /**
   * Create a base vehicle with common fields and register it.
   * Centralizes ID generation, array push, and cellDensity update (DRY).
   * @param length - vehicle body length
   * @param width - vehicle body width
   * @param edgePath - lane edge path to follow
   * @param stallJitter - whether to apply random stall jitter (false for buses)
   */
  private createBaseVehicle(length: number, width: number, edgePath: LaneEdge[], stallJitter = true): Vehicle {
    const vehicle: Vehicle = {
      id: this.nextId++,
      length,
      width,
      arrived: false,
      lane: edgePath[0]?.from.lane ?? 0,
      edgePath,
      edgeIndex: 0,
      edgeProgress: 0,
      edgeMoveRate: 0,
      speedMultiplier: TRAFFIC.SPEED_MULTIPLIER_MIN + Math.random() * TRAFFIC.SPEED_MULTIPLIER_RANGE,
      currentSpeed: 0,
      stallTime: stallJitter ? -(Math.random() * TRAFFIC.STALL_JITTER) : 0,
    };
    this.vehicles.push(vehicle);
    const startCell = edgePath[0]?.from.cellKey;
    if (startCell) {
      this.cellDensity.set(startCell, (this.cellDensity.get(startCell) ?? 0) + 1);
    }
    return vehicle;
  }

  /** Add a bus vehicle that follows multi-segment LaneEdge paths (one per route leg).
   *  startSegment places the bus at the beginning of that segment (a stop). */
  addBusVehicle(segments: LaneEdge[][], routeId: number, startSegment = 0): Vehicle {
    const segIdx = startSegment % segments.length;
    const seg = segments[segIdx]!;
    const vehicle = this.createBaseVehicle(0.60, 0.125, seg, false);
    vehicle.busState = {
      routeId,
      segmentIndex: segIdx,
      dwelling: false,
      dwellTimer: 0,
      segments,
    };
    return vehicle;
  }

  /** Remove one bus vehicle belonging to a specific route. Returns the removed vehicle ID or -1. */
  removeOneBusVehicle(routeId: number): number {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i]!;
      if (v.busState && v.busState.routeId === routeId) {
        this.vehicles.splice(i, 1);
        return v.id;
      }
    }
    return -1;
  }

  /** Remove all bus vehicles belonging to a specific route (in-place compaction). */
  removeBusVehicles(routeId: number): void {
    let write = 0;
    for (let read = 0; read < this.vehicles.length; read++) {
      const v = this.vehicles[read]!;
      if (!(v.busState && v.busState.routeId === routeId)) {
        this.vehicles[write++] = v;
      }
    }
    this.vehicles.length = write;
  }

  /** Add a service vehicle (police car, fire truck, ambulance, garbage truck) on a LaneEdge path. */
  addServiceVehicle(edgePath: LaneEdge[], serviceType: ServiceVehicleType): Vehicle {
    const dims = SERVICE_VEHICLE_DIMS[serviceType];
    const vehicle = this.createBaseVehicle(dims.length, dims.width, edgePath);
    vehicle.serviceType = serviceType;
    return vehicle;
  }

  /** Remove all service vehicles of a given type (in-place compaction). */
  removeServiceVehicles(serviceType: ServiceVehicleType): void {
    let write = 0;
    for (let read = 0; read < this.vehicles.length; read++) {
      if (this.vehicles[read]!.serviceType !== serviceType) {
        this.vehicles[write++] = this.vehicles[read]!;
      }
    }
    this.vehicles.length = write;
  }

  /** Remove vehicles by their IDs (in-place compaction). */
  removeVehiclesByIds(ids: Set<number>): void {
    let write = 0;
    for (let read = 0; read < this.vehicles.length; read++) {
      if (!ids.has(this.vehicles[read]!.id)) {
        this.vehicles[write++] = this.vehicles[read]!;
      }
    }
    this.vehicles.length = write;
  }

  /** Get IDs of all currently active vehicles. */
  /** Reusable Set for getActiveVehicleIds — caller must not hold reference across frames. */
  private _activeIdSet = new Set<number>();

  getActiveVehicleIds(): Set<number> {
    const set = this._activeIdSet;
    set.clear();
    for (const v of this.vehicles) set.add(v.id);
    return set;
  }

  /** Count service vehicles, optionally filtered by type. */
  getServiceVehicleCount(serviceType?: ServiceVehicleType): number {
    let count = 0;
    for (const v of this.vehicles) {
      if (serviceType ? v.serviceType === serviceType : v.serviceType !== undefined) count++;
    }
    return count;
  }

  /** Add a vehicle that follows a LaneEdge path. */
  addVehicleOnEdges(edgePath: LaneEdge[], citizenId?: number): Vehicle {
    const dims = pickWeighted(VEHICLE_DIMS, 1.0, e => e.weight);
    const vehicle = this.createBaseVehicle(dims.length, dims.width, edgePath);
    vehicle.citizenId = citizenId;
    return vehicle;
  }

  /** Add a freight truck that follows a LaneEdge path. Always uses truck dimensions. */
  addFreightVehicle(edgePath: LaneEdge[], sourceBuildingKey?: string): Vehicle {
    const vehicle = this.createBaseVehicle(TRUCK_DIMS.length, TRUCK_DIMS.width, edgePath);
    vehicle.sourceBuildingKey = sourceBuildingKey;
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
    const { MIN_GAP, EDGE_SPEED, REFERENCE_LIMIT, BRAKE_DISTANCE, ACCEL } = TRAFFIC;

    // Collect active vehicles into reusable scratch array (no per-frame allocation)
    const edgeVehicles = this.activeVehicleScratch;
    edgeVehicles.length = 0;
    for (const v of this.vehicles) {
      if (v.edgePath.length > 0 && !v.arrived) edgeVehicles.push(v);
    }
    if (edgeVehicles.length === 0) {
      // Still clean up arrived vehicles (in-place compaction)
      this.compactVehicles();
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
    // Reuse persistent Map (clear instead of re-allocate each frame).
    const edgeIndex = this.edgeIndexMap;
    edgeIndex.clear();
    for (const v of edgeVehicles) {
      if (v.arrived) continue;
      const ep = v.edgePath;
      const edge = ep[v.edgeIndex];
      if (!edge) continue;
      let arr = edgeIndex.get(edge.id);
      if (!arr) { arr = []; edgeIndex.set(edge.id, arr); }
      arr.push({ vid: v.id, progress: v.edgeProgress, halfLen: v.length / 2 });
    }

    // Build spatial hash for cross-edge collision detection.
    // Positions are computed once at frame start (read-only during processing).
    // SpatialEntry objects are pooled: reuse existing slots, grow only when needed.
    const spatialHash = this.spatialHash;
    spatialHash.clear();
    const spatialEntries = this.spatialEntries;
    const _posTemp = { x: 0, y: 0 };
    const _tanTemp = { x: 0, y: 0 };
    let seCount = 0;
    for (const v of edgeVehicles) {
      if (v.arrived) continue;
      const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
      const edge = v.edgePath[idx];
      if (!edge) continue;
      const t = edge.length > 0 ? Math.min(v.edgeProgress / edge.length, 1) : 0;
      interpolateEdgePositionInto(edge, t, _posTemp);
      interpolateEdgeTangentInto(edge, t, _tanTemp);
      const tanLen = Math.sqrt(_tanTemp.x * _tanTemp.x + _tanTemp.y * _tanTemp.y) || 1;
      let se = spatialEntries[seCount];
      if (se) {
        se.vid = v.id;
        se.x = _posTemp.x;
        se.y = _posTemp.y;
        se.hx = _tanTemp.x / tanLen;
        se.hy = _tanTemp.y / tanLen;
        se.halfLen = v.length / 2;
        se.halfWidth = v.width / 2;
        se.edgeId = edge.id;
        se.toId = edge.to.id;
        se.progressRatio = t;
      } else {
        se = {
          vid: v.id,
          x: _posTemp.x, y: _posTemp.y,
          hx: _tanTemp.x / tanLen, hy: _tanTemp.y / tanLen,
          halfLen: v.length / 2, halfWidth: v.width / 2,
          edgeId: edge.id, toId: edge.to.id, progressRatio: t,
        };
        spatialEntries.push(se);
      }
      spatialHash.insert(se);
      seCount++;
    }
    // Trim pool to active count (no dealloc — array capacity retained)
    spatialEntries.length = seCount;
    // Build vid → spatialEntry index (reuse persistent Map)
    const vidToSpatial = this.vidToSpatialMap;
    vidToSpatial.clear();
    for (let i = 0; i < seCount; i++) vidToSpatial.set(spatialEntries[i]!.vid, spatialEntries[i]!);

    for (const v of edgeVehicles) {
      if (v.arrived) continue;

      // Bus dwelling: count down timer, skip movement
      if (v.busState?.dwelling) {
        v.busState.dwellTimer -= dtSeconds;
        if (v.busState.dwellTimer <= 0) {
          const bs = v.busState;
          bs.segmentIndex = (bs.segmentIndex + 1) % bs.segments.length;
          v.edgePath = bs.segments[bs.segmentIndex]!;
          v.edgeIndex = 0;
          v.edgeProgress = 0;
          bs.dwelling = false;
        }
        continue;
      }

      const ep = v.edgePath;

      // 1. Gap to nearest vehicle ahead on the SAME edge path
      const gap = findGapAhead(v, ep, edgeIndex);
      const myHalfLen = v.length / 2;

      // 1b. Gap to nearest vehicle on a DIFFERENT edge (cross-edge spatial check)
      const mySpatial = vidToSpatial.get(v.id);
      const crossGap = mySpatial ? findCrossEdgeGap(mySpatial, spatialHash, this.nearbyScratch) : Infinity;

      // 2. Distance to nearest red light on path
      const redLightDist = canAdvance
        ? findRedLightDistance(v, ep, canAdvance)
        : Infinity;

      // 3. Speed limit from current edge's cell
      const currentEdge = ep[v.edgeIndex];
      const cellKey = currentEdge?.from.cellKey;
      const limit = getSpeedLimit && cellKey ? getSpeedLimit(cellKey) : REFERENCE_LIMIT;
      const turnFactor = currentEdge?.type === 'turn' ? 0.5 : 1.0;
      const maxSpeed = EDGE_SPEED * (limit / REFERENCE_LIMIT) * v.speedMultiplier * turnFactor;

      // 4. Target speed from distance-based braking
      // If a vehicle ahead is closer than the red light, just follow it
      // (the front car is already stopped for the light — no need to double-stop).
      const gapRoom = Math.max(0, Math.min(gap, crossGap) - MIN_GAP);
      const effectiveRedLight = gap < redLightDist ? Infinity : redLightDist;
      const obstacle = Math.min(gapRoom, effectiveRedLight);

      let targetSpeed: number;
      if (obstacle <= 0) {
        targetSpeed = 0;
      } else if (obstacle >= BRAKE_DISTANCE) {
        targetSpeed = maxSpeed;
      } else {
        targetSpeed = maxSpeed * (obstacle / BRAKE_DISTANCE);
      }

      // 5. Apply acceleration / deceleration
      if (targetSpeed > v.currentSpeed) {
        // Accelerate: limited by ACCEL per second
        v.currentSpeed = Math.min(targetSpeed, v.currentSpeed + ACCEL * dtSeconds);
      } else {
        // Decelerate: snap to distance-proportional speed
        v.currentSpeed = targetSpeed;
      }

      // Safety cap: never move further than available space
      let moveDistance = Math.min(v.currentSpeed * dtSeconds, obstacle);

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

      // Track stall time for stuck vehicle despawn (buses and service vehicles exempt)
      if (moveDistance < 0.001 && obstacle < 0.001) {
        v.stallTime += dtSeconds;
        if (v.stallTime >= TRAFFIC.DESPAWN_STALL_TIME && !v.busState && !v.serviceType) {
          v.arrived = true;
        }
      } else {
        v.stallTime = 0;
      }

      if (v.edgeIndex >= ep.length) {
        v.edgeIndex = ep.length - 1;
        v.edgeProgress = ep[v.edgeIndex]!.length;
        if (v.busState) {
          // Bus: enter dwell state instead of despawning
          v.busState.dwelling = true;
          v.busState.dwellTimer = BUS_DWELL_SECONDS;
        } else if (v.serviceType) {
          // Service vehicle: stop at path end, ServiceVehicleManager will repath
          // Keep it alive — don't mark arrived
        } else {
          v.arrived = true;
        }
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

    // Remove arrived vehicles (in-place compaction)
    this.compactVehicles();

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

  /** Remove arrived vehicles from the vehicles array in-place. */
  private compactVehicles(): void {
    let write = 0;
    for (let read = 0; read < this.vehicles.length; read++) {
      if (!this.vehicles[read]!.arrived) {
        this.vehicles[write++] = this.vehicles[read]!;
      }
    }
    this.vehicles.length = write;
  }

  /** Total distance traveled along edge path (for sorting). */
  private edgeTotalProgress(v: Vehicle): number {
    let total = 0;
    for (let i = 0; i < v.edgeIndex && i < v.edgePath.length; i++) {
      total += v.edgePath[i]!.length;
    }
    return total + v.edgeProgress;
  }

  /** World position for a vehicle (writes to reusable object — caller must read immediately). */
  getVehiclePositionOnEdges(v: Vehicle): { x: number; y: number } | null {
    if (v.edgePath.length === 0) return null;
    const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
    const edge = v.edgePath[idx]!;
    const t = edge.length > 0 ? Math.min(v.edgeProgress / edge.length, 1) : 0;
    interpolateEdgePositionInto(edge, t, this._posOut);
    return this._posOut;
  }

  /** Heading angle (radians) for a vehicle. 0 = east. */
  getVehicleHeadingOnEdges(v: Vehicle): number {
    const h = this.edgeHeadingVecInto(v);
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
    const { x, y } = interpolateEdgePosition(edge, t);
    const tan = interpolateEdgeTangent(edge, t);
    const len = Math.sqrt(tan.x * tan.x + tan.y * tan.y) || 1;
    const heading = Math.atan2(-tan.y / len, tan.x / len);
    return { x, y, heading };
  }

  /** Unit heading vector for a vehicle (writes to reusable object). */
  private edgeHeadingVecInto(v: Vehicle): { hx: number; hy: number } {
    const out = this._headingOut;
    if (v.edgePath.length === 0) { out.hx = 1; out.hy = 0; return out; }
    const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
    const edge = v.edgePath[idx]!;
    const t = edge.length > 0 ? Math.min(v.edgeProgress / edge.length, 1) : 0;
    interpolateEdgeTangentInto(edge, t, this._tanOut);
    const len = Math.sqrt(this._tanOut.x * this._tanOut.x + this._tanOut.y * this._tanOut.y);
    if (len > 0) { out.hx = this._tanOut.x / len; out.hy = this._tanOut.y / len; }
    else { out.hx = 1; out.hy = 0; }
    return out;
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

  /** City-wide congestion level (0 = free-flow, 1 = gridlock). */
  getCongestionLevel(): number {
    const vehicleCount = this.vehicles.length;
    if (vehicleCount === 0) return 0;
    // Use unique occupied cells vs total cells as density metric
    const occupiedCells = this.cellDensity.size;
    if (occupiedCells === 0) return 0;
    // Average vehicles per occupied cell, capped at 1.0
    const avgDensity = vehicleCount / Math.max(1, occupiedCells * TRAFFIC.DENSITY_CAPACITY_PER_CELL);
    return Math.min(1, avgDensity);
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

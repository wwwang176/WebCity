import { RoadType, ROAD_CONFIGS } from '../road/types';
import type { LaneEdge } from './LaneGraph';
import { interpolateEdgePosition, interpolateEdgeTangent, interpolateEdgePositionInto, interpolateEdgeTangentInto } from './EdgeInterpolation';
import { findGapAhead, findRedLightDistance, findBlockedJunctionDistance, type EdgeEntry } from './VehicleLookahead';
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
  /**
   * 上一幀有沒有被前方的東西煞住（跟車、紅燈、路口）。
   *
   * 「路口出不出得去」問的是前面那台車**會不會在我穿越路口的期間停下來**。用
   * 「它現在停了沒」判斷太晚 —— 車隊是往後長的，等它真的停住，我已經進去了。
   * 用速度門檻又會被路型綁架:轉彎與低速限道路的巡航速度本來就低。
   *
   * 「它正在為前方的東西減速」與這兩者都無關，而且正是車隊在形成的訊號。
   */
  braking: boolean;
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
  /** Density divisor per occupied cell for congestion calculation */
  DENSITY_CAPACITY_PER_CELL: 3,
  /**
   * Edge vehicle speed in world-units per second
   *
   * 車輛是裝飾性的，移動與模擬時鐘脫鉤 —— 一格 12 公尺，所以 3.5 格／秒 換算
   * 約 150 km/h，而路上標的是 50。那個倍率是刻意的：照時鐘算的話 1x 之下一個
   * 遊戲日只有 6 秒（24 tick × 250 ms），車會慢到看不出在動。
   *
   * 整體快慢調這裡，不要動 `ROAD_CONFIGS` 的 `speedLimit` —— 速限同時是路徑
   * 規劃的成本權重，動了它會連帶改變車流的選路。
   */
  EDGE_SPEED: 3.5,
  /** Speed limit that maps to base speed */
  REFERENCE_LIMIT: 50,
  /** Minimum distance between vehicles */
  MIN_GAP: 0.15,
  /** Seconds of zero movement before vehicle is despawned */
  DESPAWN_STALL_TIME: 10,
  /** Distance at which vehicles begin braking (world units) */
  BRAKE_DISTANCE: 1.5,
  /** Acceleration rate (world-units/sec² ) */
  ACCEL: 8.0,
  /** Deceleration rate for speed-limit transitions (world-units/sec²) */
  DECEL: 12.0,
} as const;

/** Get the number of directional lanes for a road type (lanes going one way). */
/** Get speed limit for a grid cell identified by "x,y" key. Returns default 50 for non-road cells. */
type RoadTypeCell = { roadType: number } | null;

/**
 * Either lookup will do, but one of them must be there.
 *
 * Declaring `getCell` mandatory made `UnifiedRoadLookup` — which is key-based
 * precisely because an elevated cell key carries a level — fail to typecheck at
 * the one call site that matters, even though the `getCell` branch is
 * unreachable for it.
 */
export type SpeedLimitLookup =
  | { getCellByKey(key: string): RoadTypeCell; getCell?: (x: number, y: number) => RoadTypeCell }
  | { getCell(x: number, y: number): RoadTypeCell; getCellByKey?: undefined };

export function getSpeedLimitForCell(
  grid: SpeedLimitLookup,
  cellKey: string,
): number {
  // Use key-based lookup (supports "x,y,level" for elevated roads)
  let cell: RoadTypeCell;
  if (grid.getCellByKey) {
    cell = grid.getCellByKey(cellKey);
  } else if (grid.getCell) {
    const [gx, gy] = cellKey.split(',').map(Number);
    cell = grid.getCell(gx!, gy!);
  } else {
    // The union below says one of the two is present, but a value can satisfy
    // it statically and still arrive with the method undefined — a class field
    // declared and not assigned, for one. Falling through to the default speed
    // would make every road in the city 50 km/h with nothing to show for it, so
    // fail where the wiring is wrong instead.
    throw new TypeError('getSpeedLimitForCell: lookup has neither getCellByKey nor getCell');
  }
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
  /** Reusable per-frame sort key store (see advanceEdgeVehicles). */
  private sortProgress = new Map<number, number>();
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
      braking: false,
    };
    this.vehicles.push(vehicle);
    const startCell = edgePath[0]?.from.cellKey;
    if (startCell) {
      this.cellDensity.set(startCell, (this.cellDensity.get(startCell) ?? 0) + 1);
    }
    return vehicle;
  }

  /**
   * Add a bus vehicle that follows multi-segment LaneEdge paths (one per route
   * leg). startSegment places the bus at the beginning of that segment (a stop).
   *
   * There is deliberately no `spawnBusVehicle`: a bus that is not created is
   * unrecoverable, because busVehicleIds and route.vehicles would still count it
   * and nothing reconciles them against traffic.vehicles, leaving the route
   * permanently short (BUG-115). A bus takes the spot whatever is standing there.
   */
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

  /** Reusable scratch for the spawn-overlap test (no per-spawn allocation). */
  private readonly _spawnPos = { x: 0, y: 0 };
  private readonly _spawnTan = { x: 0, y: 0 };
  private readonly _otherPos = { x: 0, y: 0 };

  /**
   * Is a vehicle already standing where this one would appear?
   *
   * Every new vehicle is placed at `edgePath[0]`, progress 0. Commute routes are
   * SHARED — CommuteCache hands the same LaneEdge[] to every citizen making that
   * trip — so everyone setting off on the same tick landed on the same point,
   * and the pile was on screen before car-following ever pushed them apart.
   *
   * Oriented, not a radius: a body is 0.22-0.26 long and 0.09 wide, so a circle
   * of half the LENGTH reaches well into the next lane and would refuse a spawn
   * over a car nowhere near it. Forward and lateral are measured separately
   * against the spawn edge's tangent, the way `findCrossEdgeGap` separates them.
   *
   * Position, not edge identity: the car in the way need not share an edge with
   * the newcomer — it may simply be driving past the driveway.
   */
  private isSpawnBlocked(edgePath: LaneEdge[], length: number, width: number): boolean {
    const first = edgePath[0];
    if (!first) return false;
    interpolateEdgePositionInto(first, 0, this._spawnPos);
    interpolateEdgeTangentInto(first, 0, this._spawnTan);
    const tl = Math.sqrt(this._spawnTan.x * this._spawnTan.x + this._spawnTan.y * this._spawnTan.y) || 1;
    const hx = this._spawnTan.x / tl, hy = this._spawnTan.y / tl;
    const halfLen = length / 2, halfWidth = width / 2;

    for (const v of this.vehicles) {
      const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
      const edge = v.edgePath[idx];
      if (!edge) continue;
      const t = edge.length > 0 ? Math.min(v.edgeProgress / edge.length, 1) : 0;
      interpolateEdgePositionInto(edge, t, this._otherPos);
      const dx = this._otherPos.x - this._spawnPos.x;
      const dy = this._otherPos.y - this._spawnPos.y;
      if (Math.abs(dx * hx + dy * hy) >= halfLen + v.length / 2) continue;
      if (Math.abs(-hy * dx + hx * dy) < halfWidth + v.width / 2) return true;
    }
    return false;
  }

  /**
   * Add a service vehicle (police car, fire truck, ambulance, garbage truck) on
   * a LaneEdge path. Null when the spot is taken — see `isSpawnBlocked`.
   */
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

  /**
   * Retire vehicles whose remaining route touches any of the given cells.
   *
   * Called after an incremental lane-graph rebuild: edges belonging to changed
   * cells are replaced, so a vehicle still holding one is driving on a road that
   * no longer exists. Nothing else catches this — stallTime only accrues when a
   * vehicle is blocked, and a ghost road blocks nothing (BUG-108).
   *
   * Only the remaining path matters; edges already behind the vehicle cannot
   * affect where it goes next.
   *
   * @returns how many vehicles were retired
   */
  /**
   * Retire any commute/freight vehicle whose remaining path contains an edge
   * the graph no longer owns.
   *
   * This is the exact question. The cell-key heuristics it replaces were each
   * an approximation of it, and each got a case wrong:
   *
   *  - "retire on any dirty cell" deleted the traffic already driving on a road
   *    that was merely extended or upgraded (BUG-116);
   *  - "retire where the road is gone" missed a DOWNGRADE. RoadBuilder writes
   *    the new tier unconditionally and clamps the cost at 0, so drawing
   *    TWO_LANE over SIX_LANE is free and deletes the lane-1 and lane-2 points
   *    with every edge on them, leaving those vehicles driving off the road
   *    surface and sharing no edge id with the lookahead index, so they pass
   *    through oncoming traffic. It also missed demolish-then-relay-in-another
   *    -direction inside one tick, where the cell still has a road but none of
   *    its old edges survive;
   *  - and the wholesale full-rebuild sweep contradicted the first rule
   *    outright, deleting all traffic whenever the affected set was unknown —
   *    or merely EMPTY, which is a statement that nothing changed.
   *
   * Edge ids are deterministic, so a rebuild that changes nothing produces the
   * same ids and retires nobody. That removes the need to distinguish a full
   * rebuild from an incremental one at all.
   *
   * Buses and service vehicles are owned by their managers, which handle road
   * changes themselves. Killing a bus here is unrecoverable: busVehicleIds and
   * route.vehicles still count it and nothing reconciles them against
   * traffic.vehicles, so the route is left permanently without a vehicle
   * (BUG-115).
   *
   * @returns how many vehicles were retired
   */
  retireVehiclesOnDeadEdges(liveEdgeIds: ReadonlySet<string>): number {
    let count = 0;
    for (const v of this.vehicles) {
      if (v.arrived || v.edgePath.length === 0) continue;
      if (v.busState !== undefined || v.serviceType !== undefined) continue;
      for (let i = v.edgeIndex; i < v.edgePath.length; i++) {
        if (!liveEdgeIds.has(v.edgePath[i]!.id)) { v.arrived = true; count++; break; }
      }
    }
    return count;
  }

  // markVehiclesArrivedOnCells and markCommuteVehiclesArrived were removed —
  // both were cell-key approximations of retireVehiclesOnDeadEdges above.

  /** Get IDs of all currently active vehicles. */
  /** Reusable Set for getActiveVehicleIds — caller must not hold reference across frames. */
  private _activeIdSet = new Set<number>();

  getActiveVehicleIds(): Set<number> {
    const set = this._activeIdSet;
    set.clear();
    for (const v of this.vehicles) set.add(v.id);
    return set;
  }

  /**
   * 路上有幾台是居民在開車通勤。
   *
   * 路上的車有四種來源，只有這一種是居民選出來的:過境車流的量是 `人口 ÷ 100`，
   * 貨運看工業產能，服務車輛是派工，三種都不看運具選擇。面板要回答「政策有沒有
   * 把人趕上大眾運輸」就只能問這一種 —— 加總的話居民真的改搭公車了，數字還是會
   * 被另外三種撐住。
   *
   * 車流上限走的是 `getVehicleCount()`（全部），跟這支無關 —— 上限管的是畫面上
   * 能跑幾台，不是統計。
   */
  getCommuteVehicleCount(): number {
    let count = 0;
    for (const v of this.vehicles) {
      if (v.citizenId !== undefined) count++;
    }
    return count;
  }

  /** Count service vehicles, optionally filtered by type. */
  getServiceVehicleCount(serviceType?: ServiceVehicleType): number {
    let count = 0;
    for (const v of this.vehicles) {
      if (serviceType ? v.serviceType === serviceType : v.serviceType !== undefined) count++;
    }
    return count;
  }

  /**
   * Place a vehicle on a LaneEdge path, unconditionally.
   *
   * This is the primitive: it puts a vehicle exactly where it is told, which is
   * what a test constructing a situation wants — and overlapping vehicles are a
   * state the simulation has to survive anyway, since a rebuilt lane graph can
   * re-seat two of them on the same ground.
   *
   * Anything in the RUNNING GAME that sets a car off from a building wants
   * `spawnVehicleOnEdges` instead: it refuses a spot that is already taken.
   */
  addVehicleOnEdges(edgePath: LaneEdge[], citizenId?: number): Vehicle {
    const dims = pickWeighted(VEHICLE_DIMS, 1.0, e => e.weight);
    const vehicle = this.createBaseVehicle(dims.length, dims.width, edgePath);
    vehicle.citizenId = citizenId;
    return vehicle;
  }

  /** Place a freight truck on a LaneEdge path, unconditionally. Always uses truck dimensions. */
  addFreightVehicle(edgePath: LaneEdge[], sourceBuildingKey?: string): Vehicle {
    const vehicle = this.createBaseVehicle(TRUCK_DIMS.length, TRUCK_DIMS.width, edgePath);
    vehicle.sourceBuildingKey = sourceBuildingKey;
    return vehicle;
  }

  // ── 從建築出發 ──
  //
  // 生成點被佔著就這一趟不出門。`addXxx` 是「放一台車在這裡」，這三支是「有人
  // 開車出門了」—— 遊戲裡所有自動生成的車都走這裡。

  /** A citizen sets off. Null when a vehicle is already standing on the spot. */
  spawnVehicleOnEdges(edgePath: LaneEdge[], citizenId?: number): Vehicle | null {
    // 車型是隨機的，但長度差 0.04，用最長的判斷才不會偶爾漏掉。
    const longest = VEHICLE_DIMS.reduce((a, b) => (b.length > a.length ? b : a));
    if (this.isSpawnBlocked(edgePath, longest.length, longest.width)) return null;
    return this.addVehicleOnEdges(edgePath, citizenId);
  }

  /** A factory sends a truck out. Null when the spot is taken. */
  spawnFreightVehicle(edgePath: LaneEdge[], sourceBuildingKey?: string): Vehicle | null {
    if (this.isSpawnBlocked(edgePath, TRUCK_DIMS.length, TRUCK_DIMS.width)) return null;
    return this.addFreightVehicle(edgePath, sourceBuildingKey);
  }

  /** A depot sends a service vehicle out. Null when the spot is taken. */
  spawnServiceVehicle(edgePath: LaneEdge[], serviceType: ServiceVehicleType): Vehicle | null {
    const dims = SERVICE_VEHICLE_DIMS[serviceType];
    if (this.isSpawnBlocked(edgePath, dims.length, dims.width)) return null;
    return this.addServiceVehicle(edgePath, serviceType);
  }

  /**
   * Advance edge-based vehicles every render frame.
   * Handles movement, collision detection, red lights, arrival, and cleanup.
   * @param dtSeconds — frame delta time in seconds (already scaled by game speed)
   */
  advanceEdgeVehicles(
    dtSeconds: number,
    canAdvance?: (current: string, next: string, via?: string) => boolean,
    getSpeedLimit?: (cellKey: string) => number,
  ): void {
    const { MIN_GAP, EDGE_SPEED, REFERENCE_LIMIT, BRAKE_DISTANCE, ACCEL, DECEL } = TRAFFIC;

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
    //
    // Progress is computed ONCE per vehicle, not inside the comparator.
    // edgeTotalProgress is an O(edgeIndex) prefix sum, and calling it from the
    // comparator made the sort O(N log N x L): at the 2000-vehicle cap with
    // paths tens of edges long that is millions of iterations — every render
    // frame, since advanceEdgeVehicles is driven by the frame loop rather than
    // the simulation tick (BUG-106).
    const progressById = this.sortProgress;
    progressById.clear();
    for (const v of edgeVehicles) progressById.set(v.id, this.edgeTotalProgress(v));
    edgeVehicles.sort((a, b) => {
      const aTotal = progressById.get(a.id)!;
      const bTotal = progressById.get(b.id)!;
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
      arr.push({ vid: v.id, progress: v.edgeProgress, halfLen: v.length / 2, queueing: v.braking });
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
        // 停靠中的公車就是擋在那裡，別讓後車以為它馬上會走。
        v.braking = true;
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
      // Not subject to the follow-the-leader override above: the whole point is
      // that the leader is close and we must stop at the line anyway, so that
      // the box stays clear for the cross direction.
      //
      // Fed `gap` rather than `gapRoom` for clarity and for the shortcut's sake,
      // not for the answer: `gapRoom` folds in `crossGap`, which measures
      // proximity to vehicles merging into the same connection point — a merge
      // conflict, not a full exit lane. Passing the smaller number cannot change
      // the verdict (see the parameter's doc), only cost a scan, so NOTHING
      // GUARDS THIS CHOICE. It mattered when the rule judged on distance alone.
      const junctionStop = findBlockedJunctionDistance(v, ep, edgeIndex, gap, MIN_GAP);
      const obstacle = Math.min(gapRoom, effectiveRedLight, junctionStop);

      // 前後車是由前往後處理的，所以後車這一幀讀到的是剛算好的值。
      v.braking = obstacle < BRAKE_DISTANCE;

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
      } else if (obstacle < BRAKE_DISTANCE) {
        // Safety braking for obstacles: snap to distance-proportional speed
        v.currentSpeed = targetSpeed;
      } else {
        // Speed-limit / lookahead deceleration: gradual
        v.currentSpeed = Math.max(targetSpeed, v.currentSpeed - DECEL * dtSeconds);
      }

      // 6. Lookahead: snap for lower speed limit ahead (+1 and +2 edges)
      const next1 = ep[v.edgeIndex + 1];
      const next2 = ep[v.edgeIndex + 2];
      if (getSpeedLimit && (next1 || next2)) {
        const limit1 = next1 ? getSpeedLimit(next1.from.cellKey) ?? REFERENCE_LIMIT : REFERENCE_LIMIT;
        const limit2 = next2 ? getSpeedLimit(next2.from.cellKey) ?? REFERENCE_LIMIT : REFERENCE_LIMIT;
        const nextLimit = Math.min(limit1, limit2);
        const nextMaxSpeed = EDGE_SPEED * (nextLimit / REFERENCE_LIMIT) * v.speedMultiplier;
        if (nextMaxSpeed < maxSpeed) {
          let distToEntry = ep[v.edgeIndex]!.length - v.edgeProgress;
          if (limit1 >= limit && next1) distToEntry += next1.length;
          if (distToEntry < BRAKE_DISTANCE) {
            const t = distToEntry / BRAKE_DISTANCE;
            const limitedSpeed = nextMaxSpeed + (maxSpeed - nextMaxSpeed) * t;
            if (limitedSpeed < v.currentSpeed) v.currentSpeed = limitedSpeed;
          }
        }
      }

      // Safety cap: never move further than available space
      const intendedMove = Math.min(v.currentSpeed * dtSeconds, obstacle);
      let moveDistance = intendedMove;

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
      if (intendedMove < 0.001) {
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
        newArr.push({ vid: v.id, progress: v.edgeProgress, halfLen: myHalfLen, queueing: v.braking });
      } else if (oldEdge) {
        // Same edge, just update progress
        const arr = edgeIndex.get(oldEdge.id);
        if (arr) {
          const entry = arr.find(e => e.vid === v.id);
          if (entry) {
            entry.progress = v.edgeProgress;
            entry.queueing = v.braking;
          }
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

  /**
   * 居民開車通勤平均跑多遠。
   *
   * 跟 `getCommuteVehicleCount()` 是同一組數字的兩面 —— 一個說有多少人在開車，一個
   * 說他們開多遠，兩張卡片要講同一個城市。混進過境車流的話會各自說不同的故事:
   * 過境車是從地圖邊緣穿到某棟建築，路程本來就比一般通勤長，少少幾台就能把平均
   * 拉走。
   */
  getCommuteAveragePathLength(): number {
    let totalLen = 0;
    let count = 0;
    for (const v of this.vehicles) {
      if (v.citizenId === undefined) continue;
      for (const e of v.edgePath) totalLen += e.length;
      count++;
    }
    return count === 0 ? 0 : totalLen / count;
  }

  getTopCongested(n: number): { segment: string; density: number }[] {
    const source = this.predictedFlow ?? this.cellDensity;
    return [...source.entries()]
      .map(([segment, density]) => ({ segment, density }))
      .sort((a, b) => b.density - a.density)
      .slice(0, n);
  }
}

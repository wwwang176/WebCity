import { RoadType, ROAD_CONFIGS } from '../road/types';
import type { LaneEdge } from './LaneGraph';
import { interpolateEdgePosition, interpolateEdgeTangent, interpolateEdgePositionInto, interpolateEdgeTangentInto } from './EdgeInterpolation';
import { findGapAhead, findRedLightDistance, findBlockedJunctionDistance } from './VehicleLookahead';
import { EdgeVehicleIndex, NO_ENTRY } from './EdgeVehicleIndex';
import { SpatialHash, type SpatialEntry } from './SpatialHash';
import { findCrossEdgeGap } from './CrossEdgeCollision';
import { pickWeighted } from '../utils/random';
import { PathLengthCache } from './PathLengthCache';

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
   * Whether something ahead (a vehicle, a red light, a junction) braked this vehicle last
   * frame.
   *
   * "Can I clear the junction" asks whether the vehicle ahead **will stop while I am crossing
   * it**. Checking whether it has already stopped is too late: queues grow backwards, and by
   * the time it really stops I am already inside. A speed threshold is captured by road
   * geometry instead, since turns and low-limit roads have low cruising speeds anyway.
   *
   * "It is decelerating for something ahead" is independent of both, and is exactly the
   * signal that a queue is forming.
   */
  braking: boolean;
  /**
   * This frame's sort key: how far along its own path the vehicle has travelled.
   *
   * Meaningful only during the sort inside `advanceEdgeVehicles` and rewritten every frame;
   * not to be read as vehicle state. Stored on the vehicle because the comparator reads two
   * values per comparison, and a Map would mean tens of thousands of lookups per frame (871
   * vehicles is about 8,500 comparisons).
   */
  sortKey: number;
  /**
   * This vehicle's entry number in `EdgeVehicleIndex` for this frame.
   *
   * Like `sortKey`, **per-frame scratch** rather than vehicle state, meaningful only inside
   * `advanceEdgeVehicles`. Stored on the vehicle rather than looked up because the index is
   * mutated within the frame (vehicles change edge, positions update) and a lookup table would
   * mean tens of thousands of queries per frame.
   */
  edgeEntry?: number;
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
export const VEHICLE_DIMS = [
  { weight: 0.80, length: 0.22, width: 0.09 },   // car
  { weight: 0.20, length: 0.26, width: 0.10 },   // van
];

/** Fixed truck dimensions for freight vehicles. */
export const TRUCK_DIMS = { length: 0.45, width: 0.125 };

/** Bus body dimensions. The longest vehicle on the road. */
export const BUS_DIMS = { length: 0.60, width: 0.125 };

/** Cell size of the spawn-point index, in world units. One road cell is 1, which aligns with
 *  the map and makes lookups cheapest. */
const SPAWN_INDEX_CELL_SIZE = 1.0;

/**
 * How close counts as a spawn point being occupied, in world units where one cell is 1.
 *
 * The two axes are measured separately, and the occupying vehicle's actual dimensions are
 * ignored: the difference is invisible on screen, and dropping the per-vehicle size lookup
 * makes this a plain distance comparison.
 *
 * Both numbers are bounded and cannot be retuned freely (see the assertions in
 * NoStackedSpawns):
 * - `ALONG` must exceed the longest body, otherwise two vehicles half a body apart each spawn
 *   and clip through each other.
 * - `ACROSS` must be below the narrowest lane spacing, which is a two-lane one-way road at
 *   0.55 / 2 / 2 = 0.1375. Above that, the neighbouring lane always blocks and the road
 *   carries far fewer vehicles.
 *
 * No single radius fits between those bounds: a 0.26 body is already wider than the 0.1375
 * lane spacing. Hence two numbers rather than one.
 */
export const SPAWN_CLEARANCE = {
  ALONG: 0.3,
  ACROSS: 0.10,
} as const;

/**
 * The grid entry used for spawn checks: a position and a heading.
 *
 * It carries no body dimensions, because the clearance is a constant (`SPAWN_CLEARANCE`) and
 * does not depend on the other vehicle's size.
 */
interface SpawnSlot { x: number; y: number; hx: number; hy: number }

/** Traffic simulation tuning constants */
export const TRAFFIC = {
  /** Base speed multiplier range: min value (vehicles randomly vary speed) */
  SPEED_MULTIPLIER_MIN: 0.8,
  /** Base speed multiplier range: variation range added to min */
  SPEED_MULTIPLIER_RANGE: 0.2,
  /** Random initial stall jitter range (negative = headstart) */
  STALL_JITTER: 5,
  /**
   * Edge vehicle speed in world-units per second
   *
   * Vehicles are cosmetic and their movement is decoupled from the simulation clock. A cell
   * is 12 metres, so 3.5 cells/second is about 150 km/h against a posted limit of 50. That
   * multiplier is deliberate: on the clock, a game day at 1x lasts 6 seconds (24 ticks x
   * 250ms) and vehicles would be too slow to see moving.
   *
   * Tune overall speed here rather than `ROAD_CONFIGS`'s `speedLimit`: the limit is also the
   * cost weight for path planning, and changing it changes which routes traffic takes.
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
  /**
   * Which vehicles are near each spawn point. Same lifecycle as `cellDensity`: rebuilt in
   * every `advanceEdgeVehicles` call **after arrived vehicles are removed**, with a new entry
   * added on the spot when a vehicle spawns.
   *
   * It exists for performance. Scanning **all** vehicles for each placement measured, on a
   * 12,334-citizen save, about 394 spawn attempts per tick x 890 vehicles = 350,000 distance
   * computations at 49ms, against 250ms available per tick at speed 1 (BUG-323).
   *
   * It does not share the car-following `spatialHash`, which is built at the **start** of each
   * frame's processing and still contains arrived vehicles after the removal pass. A spawn
   * point is precisely somebody else's destination, so that hash would treat a vehicle that
   * just arrived and no longer exists as occupying it.
   */
  private spawnHash = new SpatialHash<SpawnSlot>(SPAWN_INDEX_CELL_SIZE);
  /** Object pool for `spawnHash`, rebuilt each frame rather than reallocated. */
  private spawnSlots: SpawnSlot[] = [];
  private spawnSlotCount = 0;
  /** Predicted congestion flow (path count per cell), set by SimulationLoop periodically. */
  private predictedFlow: Map<string, number> | null = null;
  /** Reusable scratch array for active vehicles (avoids per-frame allocation). */
  private activeVehicleScratch: Vehicle[] = [];
  /**
   * Which vehicles are on each edge this frame.
   *
   * Parallel typed arrays rather than one object per vehicle: 1,829 vehicles at 60 frames per
   * second is a hundred thousand short-lived objects per second, and some frames measured
   * 16.4% of their self time in garbage collection. See `EdgeVehicleIndex` for details.
   */
  private edgeIndexMap = new EdgeVehicleIndex();
  /**
   * Which vehicles converge on each merge point, keyed by the id of the edge's end connection
   * point.
   *
   * The only relationship `findCrossEdgeGap` cares about is whether two vehicles merge into
   * the same point. A per-cell spatial hash pulls every vehicle within radius 2.0 and discards
   * them one by one, with over nine tenths failing the first condition (measured at 68.6ms per
   * tick on a 12,365-citizen save). Grouping by end point asks the right question directly.
   *
   * The arrays are cleared and reused each frame rather than reallocated.
   */
  private mergeGroups = new Map<string, SpatialEntry[]>();
  /** The empty array returned when there are no siblings, so no allocation per call. */
  private static readonly NO_SIBLINGS: readonly SpatialEntry[] = [];
  /** Reusable array for spatial entries (object pool — grows to high-water mark). */
  private spatialEntries: SpatialEntry[] = [];
  /** Reusable vid → SpatialEntry map (cleared each frame). */
  private vidToSpatialMap = new Map<number, SpatialEntry>();
  /** Reusable output objects for per-vehicle position/heading (avoid per-call allocation). */
  private readonly _posOut = { x: 0, y: 0 };
  private readonly _tanOut = { x: 0, y: 0 };
  private readonly _headingOut = { hx: 0, hy: 0 };
  private readonly _spawnTan2 = { x: 0, y: 0 };
  /** Prefix sums along a path: the sort key's "distance travelled" is asked once per vehicle
   *  per frame. */
  private readonly pathLengths = new PathLengthCache();
  /** Collection array for `queryNearbyInto`, reused per call rather than allocated. */
  private readonly spawnNearbyScratch: SpawnSlot[] = [];


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
      sortKey: 0,
    };
    this.vehicles.push(vehicle);
    const startCell = edgePath[0]?.from.cellKey;
    if (startCell) {
      this.cellDensity.set(startCell, (this.cellDensity.get(startCell) ?? 0) + 1);
    }
    // Citizens leaving later in the same tick can see the vehicle just placed. The index is
    // only rebuilt next frame, and without this entry the same spawn point emits several
    // vehicles stacked on top of each other.
    this.indexSpawnSlot(vehicle);
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
    const vehicle = this.createBaseVehicle(BUS_DIMS.length, BUS_DIMS.width, seg, false);
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
  private isSpawnBlocked(edgePath: LaneEdge[]): boolean {
    const first = edgePath[0];
    if (!first) return false;
    interpolateEdgePositionInto(first, 0, this._spawnPos);
    interpolateEdgeTangentInto(first, 0, this._spawnTan);
    const tl = Math.sqrt(this._spawnTan.x * this._spawnTan.x + this._spawnTan.y * this._spawnTan.y) || 1;
    const hx = this._spawnTan.x / tl, hy = this._spawnTan.y / tl;

    // Query only the nearby cells, using the larger of the two clearances as the radius: the
    // circle is a coarse filter and the oriented test is below.
    const near = this.spawnNearbyScratch;
    this.spawnHash.queryNearbyInto(
      this._spawnPos.x, this._spawnPos.y, SPAWN_CLEARANCE.ALONG, near,
    );
    for (const slot of near) {
      const dx = slot.x - this._spawnPos.x;
      const dy = slot.y - this._spawnPos.y;
      if (Math.abs(dx * hx + dy * hy) >= SPAWN_CLEARANCE.ALONG) continue;
      if (Math.abs(-hy * dx + hx * dy) < SPAWN_CLEARANCE.ACROSS) return true;
    }
    return false;
  }

  /** Records a vehicle's current position and heading in the spawn-point index. */
  private indexSpawnSlot(v: Vehicle): void {
    const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
    const edge = v.edgePath[idx];
    if (!edge) return;
    const t = edge.length > 0 ? Math.min(v.edgeProgress / edge.length, 1) : 0;
    interpolateEdgePositionInto(edge, t, this._otherPos);
    interpolateEdgeTangentInto(edge, t, this._spawnTan2);
    const tl = Math.sqrt(
      this._spawnTan2.x * this._spawnTan2.x + this._spawnTan2.y * this._spawnTan2.y,
    ) || 1;
    let slot = this.spawnSlots[this.spawnSlotCount];
    if (slot) {
      slot.x = this._otherPos.x; slot.y = this._otherPos.y;
      slot.hx = this._spawnTan2.x / tl; slot.hy = this._spawnTan2.y / tl;
    } else {
      slot = {
        x: this._otherPos.x, y: this._otherPos.y,
        hx: this._spawnTan2.x / tl, hy: this._spawnTan2.y / tl,
      };
      this.spawnSlots.push(slot);
    }
    this.spawnHash.insert(slot);
    this.spawnSlotCount++;
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
   * How many vehicles on the road are residents driving to work.
   *
   * Road traffic has four sources and only this one reflects a resident's choice: through
   * traffic is `population / 100`, freight follows industrial output, and service vehicles are
   * dispatched — none of the three consults mode choice. A panel answering "did the policy
   * move people onto transit" can only ask this one; a total would stay propped up by the
   * other three even after residents really did switch to the bus.
   *
   * The vehicle cap uses `getVehicleCount()` (all of them) and is unrelated: the cap limits
   * how many can run on screen, not what is reported.
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

  // ── Setting off from a building ──
  //
  // An occupied spawn point means the trip does not happen. `addXxx` places a vehicle at a
  // given spot; these three mean somebody drove off, and every automatically generated vehicle
  // in the game goes through them.

  /** A citizen sets off. Null when a vehicle is already standing on the spot. */
  spawnVehicleOnEdges(edgePath: LaneEdge[], citizenId?: number): Vehicle | null {
    if (this.isSpawnBlocked(edgePath)) return null;
    return this.addVehicleOnEdges(edgePath, citizenId);
  }

  /** A factory sends a truck out. Null when the spot is taken. */
  spawnFreightVehicle(edgePath: LaneEdge[], sourceBuildingKey?: string): Vehicle | null {
    if (this.isSpawnBlocked(edgePath)) return null;
    return this.addFreightVehicle(edgePath, sourceBuildingKey);
  }

  /** A depot sends a service vehicle out. Null when the spot is taken. */
  spawnServiceVehicle(edgePath: LaneEdge[], serviceType: ServiceVehicleType): Vehicle | null {
    if (this.isSpawnBlocked(edgePath)) return null;
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
    for (const v of edgeVehicles) v.sortKey = this.edgeTotalProgress(v);
    edgeVehicles.sort((a, b) => {
      if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
      return a.id - b.id; // lower ID = ahead = processed first
    });

    // Build edge index: edgeId → list of { vehicleId, progress, halfLen }
    // Reuse persistent Map (clear instead of re-allocate each frame).
    const edgeIndex = this.edgeIndexMap;
    edgeIndex.begin();
    // The car-following query's early exit needs the longest vehicle on the road as its
    // threshold (see `findGapAhead`).
    //
    // This is the **actual maximum on the road this frame**, not a constant from the body
    // dimensions table. A constant would be an assumption nothing enforces: `Vehicle.length`
    // and `traffic.vehicles` are both publicly mutable, and a vehicle longer than the table
    // says would be silently skipped by the query. Computing it per frame carries no such
    // assumption, at the cost of one comparison in a loop that runs anyway.
    let maxHalfLen = 0;
    for (const v of edgeVehicles) {
      // Invalidate last frame's entry number first: a skipped vehicle keeping its old number
      // lets the update pass use it to modify another vehicle's entry this frame. **No test
      // covers this line**: it is unreachable today (all three sites that replace `edgePath`
      // also zero `edgeIndex`), and even if reached it would self-heal, because the victim
      // writes its own entry back when processed and the overwriter always sorts ahead of it.
      // It is kept so the invariant is **visible here** rather than being a convention spread
      // across four files.
      v.edgeEntry = NO_ENTRY;
      if (v.arrived) continue;
      const ep = v.edgePath;
      const edge = ep[v.edgeIndex];
      if (!edge) continue;
      const halfLen = v.length / 2;
      if (halfLen > maxHalfLen) maxHalfLen = halfLen;
      // The entry number lives on the vehicle: later this frame its position is updated in
      // place or it moves to the next edge, and a lookup table would mean tens of thousands of
      // queries per frame (the same reason `sortKey` lives there).
      v.edgeEntry = edgeIndex.add(edge.id, v.id, v.edgeProgress, halfLen, v.braking);
    }

    // Build spatial hash for cross-edge collision detection.
    // Positions are computed once at frame start (read-only during processing).
    // SpatialEntry objects are pooled: reuse existing slots, grow only when needed.
    const mergeGroups = this.mergeGroups;
    for (const arr of mergeGroups.values()) arr.length = 0;
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
      let group = mergeGroups.get(se.toId);
      if (!group) { group = []; mergeGroups.set(se.toId, group); }
      group.push(se);
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
        // A dwelling bus is simply in the way; vehicles behind must not assume it is about to
        // move.
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
      const gap = findGapAhead(v, ep, edgeIndex, maxHalfLen);

      // 1b. Gap to nearest vehicle on a DIFFERENT edge (cross-edge spatial check)
      const mySpatial = vidToSpatial.get(v.id);
      const crossGap = mySpatial
        ? findCrossEdgeGap(mySpatial, mergeGroups.get(mySpatial.toId) ?? TrafficSimulation.NO_SIBLINGS)
        : Infinity;

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

      // Vehicles are processed front to back, so a follower reads the value computed for the
      // leader this same frame.
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
      const entry = v.edgeEntry;
      if (entry !== undefined && entry >= 0) {
        // Changing edge only unlinks this entry from one list and links it into another; the
        // half-length is unchanged and already counted in `maxHalfLen`, since the index-build
        // loop above visited every vehicle.
        if (oldEdge && newEdge && oldEdge.id !== newEdge.id) edgeIndex.moveTo(entry, newEdge.id);
        edgeIndex.setProgress(entry, v.edgeProgress, v.braking);
      }
    }

    // Remove arrived vehicles (in-place compaction)
    this.compactVehicles();

    // Rebuild cell density map from all active vehicles
    this.cellDensity.clear();
    this.spawnHash.clear();
    this.spawnSlotCount = 0;
    for (const v of this.vehicles) {
      const idx = Math.min(v.edgeIndex, v.edgePath.length - 1);
      const cell = v.edgePath[idx]?.from.cellKey;
      if (cell) {
        this.cellDensity.set(cell, (this.cellDensity.get(cell) ?? 0) + 1);
      }
      this.indexSpawnSlot(v);
    }
    this.spawnSlots.length = this.spawnSlotCount;
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
    return this.pathLengths.totalProgress(v.edgePath, v.edgeIndex, v.edgeProgress);
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

  /**
   * The per-cell predicted flow; null means it has not been computed yet.
   *
   * Derived from **demand**: how many citizens' commute routes pass through each cell, divided
   * by the lane count. Congestion is unrelated to how many vehicles are on screen, since
   * vehicle instances are capped and refused by the spawn check — they are a dramatisation
   * (BUG-326).
   */
  getPredictedFlow(): ReadonlyMap<string, number> | null {
    return this.predictedFlow;
  }

  /**
   * How far residents drive to work on average.
   *
   * Two sides of the same figure as `getCommuteVehicleCount()`: one says how many are
   * driving, the other how far they drive, and the two panel cards must describe the same
   * city. Mixing in through traffic makes them tell different stories: a through vehicle runs
   * from the map edge to a building and is inherently longer than a commute, so a handful of
   * them moves the average.
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

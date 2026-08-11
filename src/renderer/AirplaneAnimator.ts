/**
 * AirplaneAnimator — 飛機起降渲染端動畫。
 *
 * 每個機場獨立生成飛機，執行完整降落→滑行→停泊→推出→起飛循環。
 * 使用距離插值沿 Bézier 曲線路徑，轉彎 heading 逐幀平滑。
 * 支援 pitch（俯仰）和 roll（傾斜）。
 */
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';
import type { Airport, AirportSize } from '../core/transport/AirportSystem';
import { getAirportDimensions } from '../core/transport/AirportSystem';
import { getRotatedSize } from '../core/building/InfraConfig';
import type { VehicleAnimator } from './VehicleAnimator';
import { getFlightPaths, type Vec2 } from './airportPaths';

// ── Constants ────────────────────────────────────────────────────

const AIRPLANE_ID_OFFSET = 800_000;

/** Climb altitude (world Y units above ground). */
const CLIMB_ALTITUDE = 3.0;
/** Approach start altitude — ~15° glide slope with the approach distances below. */
const APPROACH_ALTITUDE = 2.5;
/** Ground-level Y position for airplane model (belly 0.02 above footprint top at Y=0.07). */
const GROUND_Y = 0.09;
/** Flare begins at this fraction of approach progress (0–1). */
const FLARE_START = 0.75;

/** Phase speeds (world units / second). */
const SPEED = {
  approach: 3.0,
  roll: 3.0,
  taxi: 1.5,
  pushback: 0.8,
  takeoff: 5.0,
  climb: 5.0,
} as const;

/** Dwell time at gate (seconds). */
const DWELL_TIME = 5.0;

/** Spawn intervals per airport size (seconds). */
const SPAWN_INTERVAL: Record<AirportSize, number> = {
  SMALL: 35,
  MEDIUM: 25,
  LARGE: 18,
};

/** Max simultaneous active planes per airport. */
const MAX_ACTIVE: Record<AirportSize, number> = {
  SMALL: 1,
  MEDIUM: 1,
  LARGE: 2,
};

/** Pitch angle during approach descent (nose down, radians). ~3° glide slope. */
const APPROACH_PITCH = -0.055;
/** Pitch angle during climb (nose up, radians). = 2× approach angle. */
const CLIMB_PITCH = 0.11;
/** Max roll angle during taxi turns (radians). */
const TAXI_ROLL = 0.08;

// ── Phase types ──────────────────────────────────────────────────

type AirplanePhase =
  | 'approach'
  | 'roll'
  | 'roll_wait'
  | 'taxi_in'
  | 'dwell'
  | 'pushback'
  | 'taxi_out'
  | 'lineup_wait'
  | 'takeoff_roll'
  | 'climb';

const PHASE_ORDER: AirplanePhase[] = [
  'approach', 'roll', 'roll_wait', 'taxi_in', 'dwell', 'pushback', 'taxi_out', 'lineup_wait', 'takeoff_roll', 'climb',
];

/** Brief pause at runway end before turning into taxiway (seconds). */
const ROLL_WAIT_TIME = 1.0;
/** Pause on runway before takeoff — waiting for ATC clearance (seconds). */
const LINEUP_WAIT_TIME = 1.0;

// 航路表已搬到 `airportPaths.ts` —— 它現在是整個專案唯一的一份機場配置。
// 裝飾幾何（`civic/models/airport.ts`）從同一份表推導跑道帶、滑行道標線與
// 停機位，所以兩邊不可能再各自畫一座機場（BUG-239）。

// ── Coordinate transform ─────────────────────────────────────────

function localToWorld(
  localX: number, localZ: number,
  centerX: number, centerZ: number,
  rotRad: number,
): { wx: number; wz: number } {
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  // Match Three.js Y-axis rotation convention
  return {
    wx: centerX + localX * cos + localZ * sin,
    wz: centerZ - localX * sin + localZ * cos,
  };
}

function transformPath(
  points: Vec2[],
  centerX: number, centerZ: number, rotRad: number,
): Array<{ x: number; y: number }> {
  return points.map(p => {
    const { wx, wz } = localToWorld(p.x, p.z, centerX, centerZ, rotRad);
    return { x: wx, y: wz };
  });
}

/** Convert world coord pair to FerryPath-compatible {x,y} format. */
function toXY(wc: { wx: number; wz: number }): { x: number; y: number } {
  return { x: wc.wx, y: wc.wz };
}

// ── Animation state ──────────────────────────────────────────────

interface AirplaneAnimState {
  airportId: number;
  phase: AirplanePhase;
  pathIndex: number;       // 0 or 1 (for L airport dual runways)

  // Ground phases (path-based)
  pathInfo: BezierPath | null;
  distance: number;

  // Air phases (parametric 0→1)
  progress: number;

  // Dwell timer
  timer: number;

  // Current transform
  worldX: number;
  worldZ: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;

  // Pre-computed world coordinates (set once at spawn)
  approachStart: { x: number; y: number };
  threshold: { x: number; y: number };
  takeoffEnd: { x: number; y: number };
  climbEnd: { x: number; y: number };
  runwayHeading: number;

  // Selected gate (fixed for the whole cycle)
  gate: Vec2;
  // Airport info cache
  size: AirportSize;
  centerX: number;
  centerZ: number;
  rotRad: number;
  /** Unique ID per spawn for color randomization. */
  vehicleId: number;
}

// ── Main animator ────────────────────────────────────────────────

/** Minimal interface to avoid tight coupling with AirportSystem. */
export interface AirportSystemLike {
  getAirports(): readonly Airport[];
  isAirportOperational?(id: number): boolean;
}

export class AirplaneAnimator implements VehicleAnimator {
  private anims = new Map<string, AirplaneAnimState>();
  private spawnTimers = new Map<string, number>();
  private knownAirportIds = new Set<number>();
  private spawnCounter = 0;

  update(
    dt: number,
    speed: number,
    airportSystem: AirportSystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    if (dt <= 0) return;

    const paused = speed <= 0;
    const airports = airportSystem.getAirports();
    const effectiveDt = paused ? 0 : dt * speed;

    // Track known airports for cleanup
    this.knownAirportIds.clear();
    for (const airport of airports) {
      this.knownAirportIds.add(airport.id);
    }

    // Clean up animations and spawn timers for demolished airports
    for (const key of this.anims.keys()) {
      const airportId = parseInt(key.split('-')[0]!);
      if (!this.knownAirportIds.has(airportId)) {
        this.anims.delete(key);
      }
    }
    for (const key of this.spawnTimers.keys()) {
      const airportId = parseInt(key.split('-')[0]!);
      if (!this.knownAirportIds.has(airportId)) {
        this.spawnTimers.delete(key);
      }
    }

    // Process each airport slot (skip non-operational airports)
    for (const airport of airports) {
      if (airportSystem.isAirportOperational && !airportSystem.isAirportOperational(airport.id)) {
        // Remove existing animations for non-operational airports
        const maxActive = MAX_ACTIVE[airport.size];
        for (let pathIdx = 0; pathIdx < maxActive; pathIdx++) {
          const key = pathIdx === 0 ? `${airport.id}` : `${airport.id}-${pathIdx}`;
          this.anims.delete(key);
          this.spawnTimers.delete(key);
        }
        continue;
      }
      const maxActive = MAX_ACTIVE[airport.size];
      for (let pathIdx = 0; pathIdx < maxActive; pathIdx++) {
        const key = pathIdx === 0 ? `${airport.id}` : `${airport.id}-${pathIdx}`;
        this.processSlot(key, airport, pathIdx, effectiveDt, transportVehicles);
      }
    }
  }

  private processSlot(
    key: string,
    airport: Airport,
    pathIndex: number,
    effectiveDt: number,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    let anim = this.anims.get(key);

    // Spawn logic
    if (!anim) {
      let timer = this.spawnTimers.get(key);
      if (timer === undefined) {
        timer = SPAWN_INTERVAL[airport.size] * (0.125 + Math.random() * 0.25); // first spawn: half of normal
        this.spawnTimers.set(key, timer);
      }
      timer -= effectiveDt;
      this.spawnTimers.set(key, timer);
      if (timer > 0) return;

      anim = this.createAnim(airport, pathIndex);
      this.anims.set(key, anim);
      this.spawnTimers.delete(key);
    }

    // Advance animation
    this.advancePhase(anim, effectiveDt);

    // Check if completed (climb finished)
    if (anim.phase === 'climb' && anim.progress >= 1) {
      this.anims.delete(key);
      this.spawnTimers.set(key, SPAWN_INTERVAL[airport.size] * (0.25 + Math.random() * 0.5));
      return;
    }

    // Output to transportVehicles
    transportVehicles.push({
      id: anim.vehicleId,
      x: anim.worldX,
      y: anim.worldZ,
      heading: anim.heading,
      type: 'airplane',
      laneOffset: 0,
      altitude: anim.altitude,
      pitch: anim.pitch,
      roll: anim.roll,
      scale: undefined,
    });
  }

  private createAnim(airport: Airport, pathIndex: number): AirplaneAnimState {
    const paths = getFlightPaths(airport.size, pathIndex);
    const dim = getAirportDimensions(airport.size);
    const { w, h } = getRotatedSize(dim.w, dim.h, airport.rotation);
    const centerX = airport.x + (w - 1) / 2;
    const centerZ = airport.y + (h - 1) / 2;
    const rotRad = (airport.rotation * Math.PI) / 180;

    // Pick a random gate, avoiding gates occupied by other planes at same airport
    const occupiedGates = new Set<string>();
    for (const [, other] of this.anims) {
      if (other.airportId === airport.id) {
        occupiedGates.add(`${other.gate.x},${other.gate.z}`);
      }
    }
    const freeGates = paths.gates.filter(g => !occupiedGates.has(`${g.x},${g.z}`));
    const gatePool = freeGates.length > 0 ? freeGates : paths.gates;
    const gate = gatePool[Math.floor(Math.random() * gatePool.length)]!;

    // Transform key waypoints to world coords
    const approachStart = toXY(localToWorld(paths.approachStart.x, paths.approachStart.z, centerX, centerZ, rotRad));
    const threshold = toXY(localToWorld(paths.threshold.x, paths.threshold.z, centerX, centerZ, rotRad));
    const takeoffEnd = toXY(localToWorld(paths.takeoffEnd.x, paths.takeoffEnd.z, centerX, centerZ, rotRad));
    const climbEnd = toXY(localToWorld(paths.climbEnd.x, paths.climbEnd.z, centerX, centerZ, rotRad));

    // Runway heading (from threshold toward takeoff end)
    const rdx = takeoffEnd.x - threshold.x;
    const rdy = takeoffEnd.y - threshold.y;
    const runwayHeading = Math.atan2(-rdy, rdx);

    return {
      airportId: airport.id,
      phase: 'approach',
      pathIndex,
      pathInfo: null,
      distance: 0,
      progress: 0,
      timer: 0,
      worldX: approachStart.x,
      worldZ: approachStart.y,
      altitude: GROUND_Y + APPROACH_ALTITUDE,
      heading: runwayHeading,
      pitch: APPROACH_PITCH,
      roll: 0,
      approachStart,
      threshold,
      takeoffEnd,
      climbEnd,
      runwayHeading,
      gate,
      size: airport.size,
      centerX,
      centerZ,
      rotRad,
      vehicleId: AIRPLANE_ID_OFFSET + Math.floor(Math.random() * 10000),
    };
  }

  // ── Phase dispatch ──

  private advancePhase(anim: AirplaneAnimState, dt: number): void {
    switch (anim.phase) {
      case 'approach':
        this.advanceApproach(anim, dt);
        break;
      case 'roll':
      case 'taxi_in':
      case 'taxi_out':
      case 'takeoff_roll':
        this.advanceGroundPath(anim, dt);
        break;
      case 'pushback':
        this.advancePushback(anim, dt);
        break;
      case 'roll_wait':
      case 'dwell':
      case 'lineup_wait':
        this.advanceWait(anim, dt);
        break;
      case 'climb':
        this.advanceClimb(anim, dt);
        break;
    }
  }

  // ── Approach (constant forward speed, constant descent + Hermite flare) ──

  private advanceApproach(anim: AirplaneAnimState, dt: number): void {
    const dist = distance2D(anim.approachStart, anim.threshold);
    anim.progress += (SPEED.approach * dt) / dist;

    if (anim.progress >= 1) {
      anim.progress = 1;
      anim.worldX = anim.threshold.x;
      anim.worldZ = anim.threshold.y;
      anim.altitude = GROUND_Y;
      anim.pitch = 0;
      this.transitionToNextPhase(anim);
      return;
    }

    const t = anim.progress;
    anim.worldX = lerp(anim.approachStart.x, anim.threshold.x, t);
    anim.worldZ = lerp(anim.approachStart.y, anim.threshold.y, t);

    if (t <= FLARE_START) {
      // Constant-rate descent (linear)
      anim.altitude = GROUND_Y + APPROACH_ALTITUDE * (1 - t);
    } else {
      // Flare: cubic Hermite from (altAtFlare, descentRate) → (0, 0)
      const altAtFlare = APPROACH_ALTITUDE * (1 - FLARE_START);
      const slopeAtFlare = -APPROACH_ALTITUDE * (1 - FLARE_START);
      const s = (t - FLARE_START) / (1 - FLARE_START);
      const h00 = 2 * s * s * s - 3 * s * s + 1;
      const h10 = s * s * s - 2 * s * s + s;
      anim.altitude = GROUND_Y + h00 * altAtFlare + h10 * slopeAtFlare;
    }
    anim.pitch = 0; // approach: level flight, no nose down

    anim.heading = anim.runwayHeading;
    anim.roll = 0;
  }

  // ── Climb (cubic Bézier arc + constant rate) ──
  // Bézier control points (altitude vs progress):
  //   P0=0 (ground), P1=0 (horizontal tangent),
  //   P2=2h/3, P3=h where h=CLIMB_ALT×ARC_END
  // B(s) = h·s²(2-s),  B'(s) = h·s(4-3s)
  // Pitch = atan2(B'(s)/ARC_END, dist) = actual flight path angle from tangent.
  // After arc: constant-rate straight line extending the Bézier exit tangent.

  private advanceClimb(anim: AirplaneAnimState, dt: number): void {
    const dist = distance2D(anim.takeoffEnd, anim.climbEnd);
    anim.progress += (SPEED.climb * dt) / dist;

    if (anim.progress >= 1) {
      anim.progress = 1;
      return;
    }

    const t = anim.progress;
    anim.worldX = lerp(anim.takeoffEnd.x, anim.climbEnd.x, t);
    anim.worldZ = lerp(anim.takeoffEnd.y, anim.climbEnd.y, t);

    const ARC_END = 0.40;
    if (t <= ARC_END) {
      const h = CLIMB_ALTITUDE * ARC_END;
      const s = t / ARC_END;
      // Bézier altitude: B(s) = h × s²(2-s)
      anim.altitude = GROUND_Y + h * s * s * (2 - s);
      // Pitch from Bézier tangent: B'(s) = h × s(4-3s)
      // d(alt)/dt = B'(s)/ARC_END = CLIMB_ALT × s(4-3s)
      anim.pitch = Math.atan2(CLIMB_ALTITUDE * s * (4 - 3 * s), dist);
    } else {
      anim.altitude = GROUND_Y + CLIMB_ALTITUDE * t;
      anim.pitch = Math.atan2(CLIMB_ALTITUDE, dist);
    }
    anim.heading = anim.runwayHeading;
    anim.roll = 0;
  }

  // ── Ground path phases ──

  private advanceGroundPath(anim: AirplaneAnimState, dt: number): void {
    if (!anim.pathInfo) {
      anim.pathInfo = this.buildPhasePath(anim);
      anim.distance = 0;
    }

    let speed = this.getPhaseSpeed(anim.phase);
    // Landing roll: linear deceleration to zero at rollStop
    if (anim.phase === 'roll') {
      const t = anim.pathInfo.total > 0 ? anim.distance / anim.pathInfo.total : 0;
      speed *= Math.max(0.05, 1 - t);  // linear: full speed → ~0 at end
    }
    // Takeoff roll: ease-in acceleration (slow→fast)
    if (anim.phase === 'takeoff_roll') {
      const t = anim.pathInfo.total > 0 ? anim.distance / anim.pathInfo.total : 0;
      speed *= 0.3 + 0.7 * t;
    }
    anim.distance += speed * dt;

    if (anim.distance >= anim.pathInfo.total) {
      anim.distance = anim.pathInfo.total;
      // Snap to final position and heading before transitioning
      const finalPos = interpolateBezierPath(anim.pathInfo, anim.pathInfo.total);
      if (finalPos) {
        anim.worldX = finalPos.x;
        anim.worldZ = finalPos.y;
        anim.heading = finalPos.heading;
      }
      this.transitionToNextPhase(anim);
      return;
    }

    const pos = interpolateBezierPath(anim.pathInfo, anim.distance);
    if (pos) {
      anim.worldX = pos.x;
      anim.worldZ = pos.y;
      // Direct heading from path (smoothTrackPath arcs are already smooth)
      anim.heading = pos.heading;
      anim.altitude = GROUND_Y;
      // Takeoff roll: gradual nose-up in the last 30% (rotation before liftoff)
      if (anim.phase === 'takeoff_roll') {
        const t = anim.pathInfo.total > 0 ? anim.distance / anim.pathInfo.total : 0;
        anim.pitch = t > 0.7 ? CLIMB_PITCH * ((t - 0.7) / 0.3) : 0;
      } else {
        anim.pitch = 0;
      }
      anim.roll = this.computeTaxiRoll(anim.pathInfo, anim.distance);
    }
  }

  // ── Pushback (heading reversed) ──

  private advancePushback(anim: AirplaneAnimState, dt: number): void {
    if (!anim.pathInfo) {
      anim.pathInfo = this.buildPhasePath(anim);
      anim.distance = 0;
    }

    anim.distance += SPEED.pushback * dt;

    if (anim.distance >= anim.pathInfo.total) {
      anim.distance = anim.pathInfo.total;
      const finalPos = interpolateBezierPath(anim.pathInfo, anim.pathInfo.total);
      if (finalPos) {
        anim.worldX = finalPos.x;
        anim.worldZ = finalPos.y;
        anim.heading = finalPos.heading + Math.PI;
      }
      this.transitionToNextPhase(anim);
      return;
    }

    const pos = interpolateBezierPath(anim.pathInfo, anim.distance);
    if (pos) {
      anim.worldX = pos.x;
      anim.worldZ = pos.y;
      anim.heading = pos.heading + Math.PI;
      anim.altitude = GROUND_Y;
      anim.pitch = 0;
      anim.roll = 0;
    }
  }

  // ── Wait (dwell at gate / brief pause after roll) ──

  private advanceWait(anim: AirplaneAnimState, dt: number): void {
    anim.timer -= dt;
    if (anim.timer <= 0) {
      this.transitionToNextPhase(anim);
    }
  }

  // ── Phase transition ──

  private transitionToNextPhase(anim: AirplaneAnimState): void {
    const idx = PHASE_ORDER.indexOf(anim.phase);
    if (idx < 0 || idx >= PHASE_ORDER.length - 1) return;

    anim.phase = PHASE_ORDER[idx + 1]!;
    anim.pathInfo = null;
    anim.distance = 0;
    anim.progress = 0;

    if (anim.phase === 'dwell') {
      anim.timer = DWELL_TIME;
    } else if (anim.phase === 'roll_wait') {
      anim.timer = ROLL_WAIT_TIME;
    } else if (anim.phase === 'lineup_wait') {
      anim.timer = LINEUP_WAIT_TIME;
    }
  }

  // ── Build path for ground phases ──

  private buildPhasePath(anim: AirplaneAnimState): BezierPath {
    const paths = getFlightPaths(anim.size, anim.pathIndex);
    const az = paths.apronZ;

    let localWaypoints: Vec2[];
    const R = paths.arcRadius;
    const gR = paths.gateRadius;
    let radii: number | number[] = R;

    switch (anim.phase) {
      case 'roll':
        localWaypoints = [paths.threshold, paths.rollStop];
        break;

      case 'taxi_in':
        // 5 points, 3 interior turns: rightJunction(R), rightTaxiTop(R), gateApproach(gR)
        localWaypoints = [
          paths.rollStop,
          paths.rightJunction,
          paths.rightTaxiTop,
          { x: anim.gate.x, z: az },
          anim.gate,
        ];
        radii = [R, R, gR];
        break;

      case 'pushback':
        // 3 points, 1 interior turn: gate departure(gR)
        localWaypoints = [
          anim.gate,
          { x: anim.gate.x, z: az },
          { x: anim.gate.x + 0.60, z: az },
        ];
        radii = [gR];
        break;

      case 'taxi_out':
        localWaypoints = [
          { x: anim.gate.x + 0.60, z: az },
          paths.leftTaxiTop,
          paths.leftJunction,
          paths.runwayEntry,
        ];
        break;

      case 'takeoff_roll':
        localWaypoints = [paths.runwayEntry, paths.takeoffEnd];
        break;

      default:
        localWaypoints = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    }

    const worldPoints = transformPath(localWaypoints, anim.centerX, anim.centerZ, anim.rotRad);
    return buildBezierPath(worldPoints, radii);
  }

  // ── Helpers ──

  private getPhaseSpeed(phase: AirplanePhase): number {
    switch (phase) {
      case 'roll': return SPEED.roll;
      case 'taxi_in': case 'taxi_out': return SPEED.taxi;
      case 'pushback': return SPEED.pushback;
      case 'takeoff_roll': return SPEED.takeoff;
      default: return SPEED.taxi;
    }
  }

  /** Compute roll angle based on path curvature at current position. */
  private computeTaxiRoll(pathInfo: BezierPath, distance: number): number {
    const ahead = interpolateBezierPath(pathInfo, Math.min(distance + 0.15, pathInfo.total));
    const behind = interpolateBezierPath(pathInfo, Math.max(distance - 0.15, 0));
    if (!ahead || !behind) return 0;

    let diff = ahead.heading - behind.heading;
    if (diff > Math.PI) diff -= 2 * Math.PI;
    if (diff < -Math.PI) diff += 2 * Math.PI;

    return Math.max(-TAXI_ROLL, Math.min(TAXI_ROLL, diff * 0.5));
  }

  dispose(): void {
    this.anims.clear();
    this.spawnTimers.clear();
  }
}

// ── Utility functions ────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Bézier path system ───────────────────────────────────────────

type PathSeg =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; len: number }
  | { kind: 'bezier'; x0: number; y0: number; cx: number; cy: number; x2: number; y2: number; len: number };

interface BezierPath {
  segs: PathSeg[];
  cumLen: number[];
  total: number;
}

/** Approximate arc length of a quadratic Bézier by sampling. */
function bezierArcLength(
  x0: number, y0: number, cx: number, cy: number, x2: number, y2: number, samples = 20,
): number {
  let len = 0, px = x0, py = y0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y2;
    len += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
    px = x; py = y;
  }
  return len;
}

/** Build a path of straight + Bézier segments from waypoints. */
function buildBezierPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  radius: number | number[],
): BezierPath {
  if (points.length < 2) return { segs: [], cumLen: [0], total: 0 };

  const segs: PathSeg[] = [];
  let curX = points[0]!.x, curY = points[0]!.y;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, curr = points[i]!, next = points[i + 1]!;
    const eDx = Math.sign(curr.x - prev.x);
    const eDy = Math.sign(curr.y - prev.y);
    const xDx = Math.sign(next.x - curr.x);
    const xDy = Math.sign(next.y - curr.y);

    // Straight through — no turn
    if (eDx === xDx && eDy === xDy) continue;

    const R = typeof radius === 'number' ? radius : radius[i - 1]!;

    // Corner — entry/exit points
    const entryX = curr.x - eDx * R, entryY = curr.y - eDy * R;
    const exitX = curr.x + xDx * R, exitY = curr.y + xDy * R;

    // Straight from cursor to entry
    const dx = entryX - curX, dy = entryY - curY;
    const sLen = Math.sqrt(dx * dx + dy * dy);
    if (sLen > 1e-6) {
      segs.push({ kind: 'line', x0: curX, y0: curY, x1: entryX, y1: entryY, len: sLen });
    }

    // Bézier from entry through corner(CP) to exit
    const bLen = bezierArcLength(entryX, entryY, curr.x, curr.y, exitX, exitY);
    segs.push({ kind: 'bezier', x0: entryX, y0: entryY, cx: curr.x, cy: curr.y, x2: exitX, y2: exitY, len: bLen });

    curX = exitX; curY = exitY;
  }

  // Final straight to last point
  const last = points[points.length - 1]!;
  const fdx = last.x - curX, fdy = last.y - curY;
  const fLen = Math.sqrt(fdx * fdx + fdy * fdy);
  if (fLen > 1e-6) {
    segs.push({ kind: 'line', x0: curX, y0: curY, x1: last.x, y1: last.y, len: fLen });
  }

  const cumLen = [0];
  for (const seg of segs) cumLen.push(cumLen[cumLen.length - 1]! + seg.len);
  return { segs, cumLen, total: cumLen[cumLen.length - 1]! };
}

/** Interpolate position + heading along a BezierPath at a given distance. */
function interpolateBezierPath(
  path: BezierPath, distance: number,
): { x: number; y: number; heading: number } | null {
  if (path.segs.length === 0) return null;
  const d = Math.max(0, Math.min(distance, path.total));

  for (let i = 0; i < path.segs.length; i++) {
    const segEnd = path.cumLen[i + 1]!;
    if (d <= segEnd || i === path.segs.length - 1) {
      const seg = path.segs[i]!;
      const local = d - path.cumLen[i]!;
      const t = seg.len > 0 ? Math.min(local / seg.len, 1) : 0;

      if (seg.kind === 'line') {
        return {
          x: seg.x0 + (seg.x1 - seg.x0) * t,
          y: seg.y0 + (seg.y1 - seg.y0) * t,
          heading: Math.atan2(-(seg.y1 - seg.y0), seg.x1 - seg.x0),
        };
      }

      // Quadratic Bézier
      const u = 1 - t;
      const tx = 2 * u * (seg.cx - seg.x0) + 2 * t * (seg.x2 - seg.cx);
      const ty = 2 * u * (seg.cy - seg.y0) + 2 * t * (seg.y2 - seg.cy);
      return {
        x: u * u * seg.x0 + 2 * u * t * seg.cx + t * t * seg.x2,
        y: u * u * seg.y0 + 2 * u * t * seg.cy + t * t * seg.y2,
        heading: Math.atan2(-ty, tx),
      };
    }
  }
  return null;
}


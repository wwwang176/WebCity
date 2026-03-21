/**
 * AirplaneAnimator — 飛機起降渲染端動畫。
 *
 * 每個機場獨立生成飛機，執行完整降落→滑行→停泊→推出→起飛循環。
 * 使用距離 LERP 沿預定義路徑插值，與 TrainAnimator 相同模式。
 * 支援 pitch（俯仰）和 roll（傾斜）。
 */
import {
  buildFerryPathInfo,
  interpolateFerryPath,
  type FerryPathInfo,
} from '../core/transport/FerryLinePath';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';
import type { Airport, AirportSize } from '../core/transport/AirportSystem';
import { getAirportDimensions } from '../core/transport/AirportSystem';
import { getRotatedSize } from '../core/building/InfraConfig';
import { smoothTrackPath } from './TrainAnimator';
import type { VehicleAnimator } from './VehicleAnimator';

// ── Constants ────────────────────────────────────────────────────

const AIRPLANE_ID_OFFSET = 800_000;

/** Climb altitude (world Y units above ground). */
const CLIMB_ALTITUDE = 3.0;
/** Approach start altitude — ~15° glide slope with the approach distances below. */
const APPROACH_ALTITUDE = 2.5;
/** Ground-level Y position for airplane model. */
const GROUND_Y = 0.15;
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
/** Pitch angle during climb (nose up, radians). */
const CLIMB_PITCH = 0.15;
/** Max roll angle during taxi turns (radians). */
const TAXI_ROLL = 0.08;
/** Heading smoothing rate (higher = snappier turns). */
const HEADING_SMOOTHING = 4.0;

// ── Phase types ──────────────────────────────────────────────────

type AirplanePhase =
  | 'approach'
  | 'roll'
  | 'roll_wait'
  | 'taxi_in'
  | 'dwell'
  | 'pushback'
  | 'taxi_out'
  | 'takeoff_roll'
  | 'climb';

const PHASE_ORDER: AirplanePhase[] = [
  'approach', 'roll', 'roll_wait', 'taxi_in', 'dwell', 'pushback', 'taxi_out', 'takeoff_roll', 'climb',
];

/** Brief pause at runway end before turning into taxiway (seconds). */
const ROLL_WAIT_TIME = 1.0;

// ── Per-size waypoint definitions (local coords, rotation=0) ────

interface Vec2 { x: number; z: number }

interface SizeFlightPaths {
  approachStart: Vec2;
  threshold: Vec2;
  /** Roll stop: before right junction, leaving arc space. */
  rollStop: Vec2;
  /** Right taxiway junction on runway. */
  rightJunction: Vec2;
  /** Top of right taxiway at apron level. */
  rightTaxiTop: Vec2;
  /** Z level for horizontal apron taxi. */
  apronZ: number;
  /** Left taxiway top at apron level. */
  leftTaxiTop: Vec2;
  /** Left taxiway junction on runway. */
  leftJunction: Vec2;
  /** Short distance onto runway from leftJunction (for arc detection). */
  runwayEntry: Vec2;
  gates: Vec2[];
  takeoffEnd: Vec2;
  climbEnd: Vec2;
}

// SMALL (3×2): left taxi x=-1.05, right taxi x=+1.05
const SMALL_PATHS: SizeFlightPaths = {
  approachStart:   { x: -10.3, z: 0.60 },
  threshold:       { x: -1.00, z: 0.60 },
  rollStop:        { x: 0.55, z: 0.60 },
  rightJunction:   { x: 1.05, z: 0.60 },
  rightTaxiTop:    { x: 1.05, z: -0.10 },
  apronZ:          -0.10,
  leftTaxiTop:     { x: -1.05, z: -0.10 },
  leftJunction:    { x: -1.05, z: 0.60 },
  runwayEntry:     { x: -0.55, z: 0.60 },
  gates:           [{ x: 0, z: -0.45 }],
  takeoffEnd:      { x: 1.40, z: 0.60 },
  climbEnd:        { x: 6.0, z: 0.60 },
};

// MEDIUM (5×4): left taxi x=-1.80, right taxi x=+1.80
const MEDIUM_PATHS: SizeFlightPaths = {
  approachStart:   { x: -11.3, z: 1.20 },
  threshold:       { x: -2.00, z: 1.20 },
  rollStop:        { x: 1.30, z: 1.20 },
  rightJunction:   { x: 1.80, z: 1.20 },
  rightTaxiTop:    { x: 1.80, z: -0.10 },
  apronZ:          -0.10,
  leftTaxiTop:     { x: -1.80, z: -0.10 },
  leftJunction:    { x: -1.80, z: 1.20 },
  runwayEntry:     { x: -1.30, z: 1.20 },
  gates:           [{ x: -0.60, z: -0.65 }, { x: 0, z: -0.65 }, { x: 0.60, z: -0.65 }],
  takeoffEnd:      { x: 2.25, z: 1.20 },
  climbEnd:        { x: 7.0, z: 1.20 },
};

// LARGE (7×6): left taxi x=-2.80, right taxi x=+2.80
const LARGE_PATH_A: SizeFlightPaths = {
  approachStart:   { x: -12.3, z: 0.80 },
  threshold:       { x: -3.00, z: 0.80 },
  rollStop:        { x: 2.30, z: 0.80 },
  rightJunction:   { x: 2.80, z: 0.80 },
  rightTaxiTop:    { x: 2.80, z: -0.80 },
  apronZ:          -0.80,
  leftTaxiTop:     { x: -2.80, z: -0.80 },
  leftJunction:    { x: -2.80, z: 0.80 },
  runwayEntry:     { x: -2.30, z: 0.80 },
  gates:           [{ x: -0.50, z: -1.30 }, { x: 0.20, z: -1.30 }],
  takeoffEnd:      { x: 3.25, z: 0.80 },
  climbEnd:        { x: 8.0, z: 0.80 },
};

const LARGE_PATH_B: SizeFlightPaths = {
  approachStart:   { x: -12.3, z: 2.20 },
  threshold:       { x: -3.00, z: 2.20 },
  rollStop:        { x: 2.30, z: 2.20 },
  rightJunction:   { x: 2.80, z: 2.20 },
  rightTaxiTop:    { x: 2.80, z: -0.80 },
  apronZ:          -0.80,
  leftTaxiTop:     { x: -2.80, z: -0.80 },
  leftJunction:    { x: -2.80, z: 2.20 },
  runwayEntry:     { x: -2.30, z: 2.20 },
  gates:           [{ x: 0.20, z: -1.30 }, { x: 0.90, z: -1.30 }],
  takeoffEnd:      { x: 3.25, z: 2.20 },
  climbEnd:        { x: 8.0, z: 2.20 },
};

function getFlightPaths(size: AirportSize, pathIndex: number): SizeFlightPaths {
  if (size === 'SMALL') return SMALL_PATHS;
  if (size === 'MEDIUM') return MEDIUM_PATHS;
  return pathIndex === 0 ? LARGE_PATH_A : LARGE_PATH_B;
}

// ── Coordinate transform ─────────────────────────────────────────

function localToWorld(
  localX: number, localZ: number,
  centerX: number, centerZ: number,
  rotRad: number,
): { wx: number; wz: number } {
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  return {
    wx: centerX + localX * cos - localZ * sin,
    wz: centerZ + localX * sin + localZ * cos,
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
  pathInfo: FerryPathInfo | null;
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
}

// ── Main animator ────────────────────────────────────────────────

/** Minimal interface to avoid tight coupling with AirportSystem. */
export interface AirportSystemLike {
  getAirports(): readonly Airport[];
}

export class AirplaneAnimator implements VehicleAnimator {
  private anims = new Map<string, AirplaneAnimState>();
  private spawnTimers = new Map<string, number>();
  private knownAirportIds = new Set<number>();

  update(
    dt: number,
    speed: number,
    airportSystem: AirportSystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    if (dt <= 0 || speed <= 0) return;

    const airports = airportSystem.getAirports();
    const effectiveDt = dt * speed;

    // Track known airports for cleanup
    this.knownAirportIds.clear();
    for (const airport of airports) {
      this.knownAirportIds.add(airport.id);
    }

    // Clean up animations for demolished airports
    for (const key of this.anims.keys()) {
      const airportId = parseInt(key.split('-')[0]!);
      if (!this.knownAirportIds.has(airportId)) {
        this.anims.delete(key);
      }
    }

    // Process each airport slot
    for (const airport of airports) {
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
        timer = SPAWN_INTERVAL[airport.size] * 0.5; // first spawn sooner
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
      this.spawnTimers.set(key, SPAWN_INTERVAL[airport.size]);
      return;
    }

    // Output to transportVehicles
    transportVehicles.push({
      id: AIRPLANE_ID_OFFSET + airport.id * 100 + pathIndex,
      x: anim.worldX,
      y: anim.worldZ,
      heading: anim.heading,
      type: 'airplane',
      laneOffset: 0,
      altitude: anim.altitude,
      pitch: anim.pitch,
      roll: anim.roll,
    });
  }

  private createAnim(airport: Airport, pathIndex: number): AirplaneAnimState {
    const paths = getFlightPaths(airport.size, pathIndex);
    const dim = getAirportDimensions(airport.size);
    const { w, h } = getRotatedSize(dim.w, dim.h, airport.rotation);
    const centerX = airport.x + (w - 1) / 2;
    const centerZ = airport.y + (h - 1) / 2;
    const rotRad = (airport.rotation * Math.PI) / 180;

    // Pick a random gate (fixed for entire cycle)
    const gate = paths.gates[Math.floor(Math.random() * paths.gates.length)]!;

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
      anim.pitch = APPROACH_PITCH;
    } else {
      // Flare: cubic Hermite from (altAtFlare, descentRate) → (0, 0)
      // Ensures C1 continuity (position + derivative match at junction)
      const altAtFlare = APPROACH_ALTITUDE * (1 - FLARE_START);
      const slopeAtFlare = -APPROACH_ALTITUDE * (1 - FLARE_START); // incoming rate scaled to s domain
      const s = (t - FLARE_START) / (1 - FLARE_START); // 0→1 within flare
      const h00 = 2 * s * s * s - 3 * s * s + 1;  // value: 1→0
      const h10 = s * s * s - 2 * s * s + s;        // tangent: 1→0
      anim.altitude = GROUND_Y + h00 * altAtFlare + h10 * slopeAtFlare;
      // Pitch eases to zero during flare
      anim.pitch = APPROACH_PITCH * (1 - s);
    }

    anim.heading = anim.runwayHeading;
    anim.roll = 0;
  }

  // ── Climb (constant forward speed, ease-in altitude) ──

  private advanceClimb(anim: AirplaneAnimState, dt: number): void {
    const dist = distance2D(anim.takeoffEnd, anim.climbEnd);
    anim.progress += (SPEED.climb * dt) / dist;

    if (anim.progress >= 1) {
      anim.progress = 1;
      return; // cleaned up by processSlot
    }

    const t = anim.progress;
    anim.worldX = lerp(anim.takeoffEnd.x, anim.climbEnd.x, t);
    anim.worldZ = lerp(anim.takeoffEnd.y, anim.climbEnd.y, t);
    // Ease-in ascent: slow climb at start, steeper later t^2
    anim.altitude = GROUND_Y + CLIMB_ALTITUDE * t * t;
    anim.pitch = CLIMB_PITCH * Math.min(1, t * 2);
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
    // Landing roll: gentle ease-out deceleration (fast→moderate)
    if (anim.phase === 'roll') {
      const t = anim.pathInfo.totalLength > 0 ? anim.distance / anim.pathInfo.totalLength : 0;
      speed *= 0.5 + 0.5 * (1 - t);
    }
    // Takeoff roll: ease-in acceleration (slow→fast)
    if (anim.phase === 'takeoff_roll') {
      const t = anim.pathInfo.totalLength > 0 ? anim.distance / anim.pathInfo.totalLength : 0;
      speed *= 0.3 + 0.7 * t;
    }
    anim.distance += speed * dt;

    if (anim.distance >= anim.pathInfo.totalLength) {
      anim.distance = anim.pathInfo.totalLength;
      this.transitionToNextPhase(anim);
      return;
    }

    const pos = interpolateFerryPath(anim.pathInfo, anim.distance);
    if (pos) {
      anim.worldX = pos.x;
      anim.worldZ = pos.y;
      // Smooth heading LERP
      anim.heading = lerpAngle(anim.heading, pos.heading, 1 - Math.exp(-HEADING_SMOOTHING * dt));
      anim.altitude = GROUND_Y;
      anim.pitch = 0;
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

    if (anim.distance >= anim.pathInfo.totalLength) {
      anim.distance = anim.pathInfo.totalLength;
      this.transitionToNextPhase(anim);
      return;
    }

    const pos = interpolateFerryPath(anim.pathInfo, anim.distance);
    if (pos) {
      anim.worldX = pos.x;
      anim.worldZ = pos.y;
      const targetHeading = pos.heading + Math.PI;
      anim.heading = lerpAngle(anim.heading, targetHeading, 1 - Math.exp(-HEADING_SMOOTHING * dt));
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
    }
  }

  // ── Build path for ground phases ──

  private buildPhasePath(anim: AirplaneAnimState): FerryPathInfo {
    const paths = getFlightPaths(anim.size, anim.pathIndex);
    const az = paths.apronZ;

    let localWaypoints: Vec2[];
    let smooth = false;

    switch (anim.phase) {
      case 'roll':
        // Threshold → rollStop (before right junction, leave arc space)
        localWaypoints = [paths.threshold, paths.rollStop];
        break;

      case 'taxi_in':
        // rollStop → arc into right taxiway → straight up → arc to apron → horiz → arc to gate
        // All turns are interior points → smoothTrackPath generates arcs.
        localWaypoints = [
          paths.rollStop,                              // start on runway (= roll end)
          paths.rightJunction,                         // ARC: → to ↑
          paths.rightTaxiTop,                          // ARC: ↑ to ←
          { x: anim.gate.x, z: az },                  // ARC: ← to ↑ (toward gate)
          anim.gate,                                   // end
        ];
        smooth = true;
        break;

      case 'pushback':
        // Short arc backward to the right: gate → arcMid → pushbackEnd
        // Heading reversed: nose stays ↑ initially, swings to ← by end.
        localWaypoints = [
          anim.gate,                                   // start facing terminal
          { x: anim.gate.x, z: az },                  // ARC: ↓ to → (tail goes right)
          { x: anim.gate.x + 0.40, z: az },           // end (nose now faces ←)
        ];
        smooth = true;
        break;

      case 'taxi_out':
        // Forward from pushback end → across apron → arc into left taxiway → down → arc onto runway
        localWaypoints = [
          { x: anim.gate.x + 0.40, z: az },           // start (= pushback end)
          paths.leftTaxiTop,                           // ARC: ← to ↓
          paths.leftJunction,                          // ARC: ↓ to →
          paths.runwayEntry,                           // end (on runway)
        ];
        smooth = true;
        break;

      case 'takeoff_roll':
        // runwayEntry → takeoff end (full runway)
        localWaypoints = [paths.runwayEntry, paths.takeoffEnd];
        break;

      default:
        localWaypoints = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    }

    const worldPoints = transformPath(localWaypoints, anim.centerX, anim.centerZ, anim.rotRad);
    const finalPoints = smooth ? smoothTrackPath(worldPoints) : worldPoints;
    return buildFerryPathInfo(finalPoints);
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
  private computeTaxiRoll(pathInfo: FerryPathInfo, distance: number): number {
    const ahead = interpolateFerryPath(pathInfo, Math.min(distance + 0.15, pathInfo.totalLength));
    const behind = interpolateFerryPath(pathInfo, Math.max(distance - 0.15, 0));
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

/** Interpolate between two angles, handling wrap-around at ±PI. */
function lerpAngle(from: number, to: number, alpha: number): number {
  let diff = to - from;
  // Normalize to [-PI, PI]
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return from + diff * alpha;
}

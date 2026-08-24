/**
 * TrainAnimator — train animation on the render side, advanced per frame rather than per tick.
 *
 * The same pattern as the metro (MetroTunnelRenderer plus advanceTrain):
 * - builds a full round-trip path from routePaths (A to B to A, or A to B to C to A)
 * - interpolates by distance along it, pausing a fixed number of seconds at each station
 * - takes heading straight from the path's tangent, with no LERP
 * - renders 3 cars per train: a locomotive plus 2 carriages
 */
import {
  buildFerryPathInfo,
  interpolateFerryPath,
  type FerryPathInfo,
} from '../core/transport/FerryLinePath';
import type { VehicleAnimator } from './VehicleAnimator';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';

/** A train's visual speed, in world units per second. */
const TRAIN_VISUAL_SPEED = 4.5;
/** The train id offset, matching collectTransportVehicles. */
const RAIL_ID_OFFSET = 400_000;
/** Centre-to-centre spacing between cars, in world units. */
const CARRIAGE_SPACING = 0.33;
/** Cars per train: a locomotive plus its trailers. */
const CARRIAGES_PER_TRAIN = 3;
/** Seconds a train visibly waits at a station, the same pattern as the metro. */
const STATION_WAIT_TIME = 1.2;
/** How many points a corner's arc is interpolated with. */
const ARC_POINTS = 6;
/** The interval between external train spawns, in seconds. */
const EXTERNAL_TRAIN_INTERVAL = 12.0;
/** The starting id offset for external trains. */
const EXTERNAL_TRAIN_ID = 900_000;

interface TrainAnimState {
  /** The full round-trip path, A to B to A concatenated. */
  pathInfo: FerryPathInfo;
  /** Each station's distance along the path. */
  stationDistances: number[];
  /** The current distance along the path. */
  distance: number;
  /** Currently stopped at a station. */
  atStation: boolean;
  /** The remaining station wait, in seconds. */
  waitTimer: number;
  /** The next station's index. */
  nextStationIdx: number;
  /** The route id this belongs to, used to detect a route change. */
  routeId: number;
  /** The segment count when the animation was created, used to detect stations being added or removed. */
  segmentCount: number;
}

/** Minimal RailSystem interface to avoid tight coupling. */
export interface RailSystemLike {
  getTrains(): Iterable<{ id: number; traveling: boolean; routeId: number }>;
  /** Get parsed route path segments for building full round-trip animation. */
  getRoutePathPoints(routeId: number): ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> | null;
  /** Whether any station has external connection. */
  hasExternalConnection: boolean;
  /** Get a random path from map edge to an external station. */
  getExternalTrainPath(): ReadonlyArray<{ x: number; y: number }> | null;
}

/** External train animation state (edge → station → edge, then despawn). */
interface ExternalTrainAnim {
  pathInfo: FerryPathInfo;
  distance: number;
  stationDist: number;
  phase: 'incoming' | 'dwell' | 'outgoing';
  waitTimer: number;
}

/**
 * Replaces right-angle turns with arc points so a train follows a curve. Straight sections are
 * unchanged, and a quarter arc is inserted only where the direction changes between segments.
 */
export function smoothTrackPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  radius = 0.5,
): Array<{ x: number; y: number }> {
  if (points.length < 3) return [...points];

  const R = radius;
  const result: Array<{ x: number; y: number }> = [];
  result.push(points[0]!);

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, curr = points[i]!, next = points[i + 1]!;
    const eDx = Math.sign(curr.x - prev.x);
    const eDy = Math.sign(curr.y - prev.y);
    const xDx = Math.sign(next.x - curr.x);
    const xDy = Math.sign(next.y - curr.y);

    // Straight — keep the point
    if (eDx === xDx && eDy === xDy) { result.push(curr); continue; }

    // Corner — generate quarter-circle arc
    const arcCx = curr.x + xDx * R - eDx * R;
    const arcCy = curr.y + xDy * R - eDy * R;
    const entryX = curr.x - eDx * R;
    const entryY = curr.y - eDy * R;
    const exitX = curr.x + xDx * R;
    const exitY = curr.y + xDy * R;

    const startA = Math.atan2(entryY - arcCy, entryX - arcCx);
    const endA = Math.atan2(exitY - arcCy, exitX - arcCx);
    let sweep = endA - startA;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;

    for (let j = 0; j <= ARC_POINTS; j++) {
      const a = startA + (j / ARC_POINTS) * sweep;
      result.push({ x: arcCx + R * Math.cos(a), y: arcCy + R * Math.sin(a) });
    }
  }

  result.push(points[points.length - 1]!);
  return result;
}

/**
 * Builds one full round-trip path from a route's segments.
 * With 2 stations, segments = [A to B, B to A] concatenates into A ... B ... A.
 */
function buildFullPath(segments: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): {
  pathInfo: FerryPathInfo;
  stationDistances: number[];
} | null {
  if (segments.length === 0) return null;

  const fullPoints: Array<{ x: number; y: number }> = [];
  const stationDistances: number[] = [0];
  let cumDist = 0;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    if (seg.length < 2) return null;

    // Smooth this segment, turning corners into arcs.
    const smoothed = smoothTrackPath(seg);

    // The first segment is added whole; later ones skip their first point, which repeats the
    // previous segment's end.
    const startIdx = s === 0 ? 0 : 1;
    for (let i = startIdx; i < smoothed.length; i++) {
      fullPoints.push(smoothed[i]!);
    }

    // Compute the smoothed segment's length.
    let segLen = 0;
    for (let i = 1; i < smoothed.length; i++) {
      const dx = smoothed[i]!.x - smoothed[i - 1]!.x;
      const dy = smoothed[i]!.y - smoothed[i - 1]!.y;
      segLen += Math.sqrt(dx * dx + dy * dy);
    }
    cumDist += segLen;

    // This segment's end is the next station. The last segment's end is the starting station, handled
    // by the wrap and not added here.
    if (s < segments.length - 1) {
      stationDistances.push(cumDist);
    }
  }

  if (fullPoints.length < 2) return null;

  const pathInfo = buildFerryPathInfo(fullPoints);
  return { pathInfo, stationDistances };
}

/**
 * Build a round-trip path for an external train: edge → station → edge.
 * Returns path info and the distance at the station (midpoint).
 */
function buildExternalPath(points: ReadonlyArray<{ x: number; y: number }>): {
  pathInfo: FerryPathInfo;
  stationDist: number;
} | null {
  if (points.length < 2) return null;

  const forward = smoothTrackPath(points);
  const reversed = [...points].reverse();
  const backward = smoothTrackPath(reversed);

  // Concatenate forward + backward, skip duplicate midpoint
  const fullPoints: Array<{ x: number; y: number }> = [...forward];
  for (let i = 1; i < backward.length; i++) {
    fullPoints.push(backward[i]!);
  }

  // Station distance = length of forward path
  let stationDist = 0;
  for (let i = 1; i < forward.length; i++) {
    const dx = forward[i]!.x - forward[i - 1]!.x;
    const dy = forward[i]!.y - forward[i - 1]!.y;
    stationDist += Math.sqrt(dx * dx + dy * dy);
  }

  if (fullPoints.length < 2) return null;
  const pathInfo = buildFerryPathInfo(fullPoints);
  return { pathInfo, stationDist };
}

export class TrainAnimator implements VehicleAnimator {
  private anims = new Map<number, TrainAnimState>();
  /** Reusable Set for active train IDs (avoids per-frame allocation). */
  private activeIds = new Set<number>();
  /** External train animation (at most one at a time). */
  private externalTrain: ExternalTrainAnim | null = null;
  /** Countdown to next external train spawn (seconds). */
  private externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL * 0.5; // first one sooner

  /**
   * Advances the train animations for one frame and overwrites the position and heading of every
   * rail_train in transportVehicles, appending each train's trailing carriages (rail_carriage).
   */
  update(
    dt: number,
    speed: number,
    railSystem: RailSystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    // ── Create and clean up animations ──
    const activeTrainIds = this.activeIds;
    activeTrainIds.clear();
    for (const train of railSystem.getTrains()) {
      activeTrainIds.add(train.id);

      // Invalidate stale animation when route paths change (e.g. station removed)
      const existing = this.anims.get(train.id);
      if (existing) {
        const currentSegments = railSystem.getRoutePathPoints(train.routeId);
        if (!currentSegments || currentSegments.length !== existing.segmentCount) {
          this.anims.delete(train.id);
        }
      }

      if (!this.anims.has(train.id)) {
        const segments = railSystem.getRoutePathPoints(train.routeId);
        if (segments && segments.length > 0) {
          const result = buildFullPath(segments);
          if (result) {
            this.anims.set(train.id, {
              pathInfo: result.pathInfo,
              stationDistances: result.stationDistances,
              distance: 0,
              atStation: true,
              waitTimer: STATION_WAIT_TIME,
              nextStationIdx: 1 % result.stationDistances.length,
              routeId: train.routeId,
              segmentCount: segments.length,
            });
          }
        }
      }
    }

    // Remove animations for trains that no longer exist.
    for (const trainId of this.anims.keys()) {
      if (!activeTrainIds.has(trainId)) {
        this.anims.delete(trainId);
      }
    }

    // ── Advance the animations, the same logic as the metro's advanceTrain ──
    for (const [, anim] of this.anims) {
      if (dt <= 0) continue;

      if (anim.atStation) {
        anim.waitTimer -= dt * speed;
        if (anim.waitTimer <= 0) {
          anim.atStation = false;
        }
        continue;
      }

      const prevDist = anim.distance;
      anim.distance += TRAIN_VISUAL_SPEED * dt * speed;

      // Target distance: the next station.
      const targetDist = anim.nextStationIdx === 0
        ? anim.pathInfo.totalLength
        : anim.stationDistances[anim.nextStationIdx]!;

      // Whether it passed the next station.
      if (prevDist < targetDist && anim.distance >= targetDist) {
        anim.distance = anim.nextStationIdx === 0 ? 0 : targetDist;
        anim.atStation = true;
        anim.waitTimer = STATION_WAIT_TIME;
        anim.nextStationIdx = (anim.nextStationIdx + 1) % anim.stationDistances.length;
      }

      // Safe wrap.
      if (anim.distance >= anim.pathInfo.totalLength) {
        anim.distance -= anim.pathInfo.totalLength;
      }
    }

    // ── Overwrite rail_train positions and append trailing carriages ──
    // Push carriages directly to transportVehicles (no intermediate array).
    // Iterate only the original range to avoid processing just-added carriages.
    const originalLen = transportVehicles.length;

    for (let vi = 0; vi < originalLen; vi++) {
      const vd = transportVehicles[vi]!;
      if (vd.type !== 'rail_train') continue;

      const trainId = vd.id - RAIL_ID_OFFSET;
      const anim = this.anims.get(trainId);

      if (anim) {
        // The locomotive's position.
        const pos = interpolateFerryPath(anim.pathInfo, anim.distance);
        if (pos) {
          vd.x = pos.x;
          vd.y = pos.y;
          vd.heading = pos.heading;
        }

        // The trailing carriages are laid out back along the path.
        for (let c = 1; c < CARRIAGES_PER_TRAIN; c++) {
          const cDist = anim.distance - c * CARRIAGE_SPACING;
          const wrappedDist = cDist >= 0
            ? cDist
            : cDist + anim.pathInfo.totalLength;
          const cPos = interpolateFerryPath(anim.pathInfo, wrappedDist);
          if (cPos) {
            transportVehicles.push({
              id: vd.id + c * 10000,
              x: cPos.x,
              y: cPos.y,
              heading: cPos.heading,
              type: 'rail_carriage',
              laneOffset: 0,
            });
          }
        }
      } else {
        // With no animation, the carriages line up opposite the heading.
        for (let c = 1; c < CARRIAGES_PER_TRAIN; c++) {
          transportVehicles.push({
            id: vd.id + c * 10000,
            x: vd.x - Math.cos(vd.heading) * c * CARRIAGE_SPACING,
            y: vd.y + Math.sin(vd.heading) * c * CARRIAGE_SPACING,
            heading: vd.heading,
            type: 'rail_carriage',
            laneOffset: 0,
          });
        }
      }
    }

    // ── External train (edge → station → edge) ──
    this.updateExternalTrain(dt, speed, railSystem, transportVehicles);
  }

  // ── External train implementation ──

  private updateExternalTrain(
    dt: number,
    speed: number,
    railSystem: RailSystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    if (dt <= 0 || speed <= 0) return;

    // Spawn logic
    if (!this.externalTrain) {
      if (!railSystem.hasExternalConnection) return;
      this.externalSpawnTimer -= dt * speed;
      if (this.externalSpawnTimer > 0) return;

      const pathPoints = railSystem.getExternalTrainPath();
      if (!pathPoints) { this.externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL; return; }

      const result = buildExternalPath(pathPoints);
      if (!result) { this.externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL; return; }

      this.externalTrain = {
        pathInfo: result.pathInfo,
        distance: 0,
        stationDist: result.stationDist,
        phase: 'incoming',
        waitTimer: 0,
      };
    }

    const ext = this.externalTrain;

    // Animate
    if (ext.phase === 'incoming') {
      ext.distance += TRAIN_VISUAL_SPEED * dt * speed;
      if (ext.distance >= ext.stationDist) {
        ext.distance = ext.stationDist;
        ext.phase = 'dwell';
        ext.waitTimer = STATION_WAIT_TIME;
      }
    } else if (ext.phase === 'dwell') {
      ext.waitTimer -= dt * speed;
      if (ext.waitTimer <= 0) {
        ext.phase = 'outgoing';
      }
    } else {
      ext.distance += TRAIN_VISUAL_SPEED * dt * speed;
      if (ext.distance >= ext.pathInfo.totalLength) {
        this.externalTrain = null;
        this.externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL;
        return;
      }
    }

    // Render: add locomotive + carriages to transportVehicles
    const pos = interpolateFerryPath(ext.pathInfo, ext.distance);
    if (!pos) return;

    transportVehicles.push({
      id: EXTERNAL_TRAIN_ID,
      x: pos.x, y: pos.y, heading: pos.heading,
      type: 'rail_train', laneOffset: 0,
    });

    for (let c = 1; c < CARRIAGES_PER_TRAIN; c++) {
      const cDist = Math.max(0, ext.distance - c * CARRIAGE_SPACING);
      const cPos = interpolateFerryPath(ext.pathInfo, cDist);
      if (cPos) {
        transportVehicles.push({
          id: EXTERNAL_TRAIN_ID + c * 10000,
          x: cPos.x, y: cPos.y, heading: cPos.heading,
          type: 'rail_carriage', laneOffset: 0,
        });
      }
    }
  }

  dispose(): void {
    this.anims.clear();
    this.externalTrain = null;
  }
}

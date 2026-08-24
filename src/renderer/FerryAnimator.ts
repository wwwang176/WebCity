/**
 * FerryAnimator — ferry animation on the render side.
 *
 * It implements the VehicleAnimator interface and handles:
 * - distance interpolation along the A* water path, a pure LERP
 * - smoothing the heading through turns
 * - animation state, creating and clearing
 */
import {
  buildFerryPathInfo,
  interpolateFerryPath,
  type FerryPathInfo,
} from '../core/transport/FerryLinePath';
import type { VehicleAnimator } from './VehicleAnimator';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';

/** A ferry's visual speed in world units per second, independent of ticks. */
const FERRY_VISUAL_SPEED = 1.5;
/** A ferry's turn rate in radians per second; larger turns faster. */
const FERRY_TURN_RATE = 3.0;
/** The ferry id offset, matching collectTransportVehicles. */
const FERRY_ID_OFFSET = 500_000;

interface FerryAnimState {
  pathInfo: FerryPathInfo;
  distance: number;
  heading: number;
}

/** The minimum ferry system interface, avoiding a direct dependency on the FerrySystem class. */
export interface FerrySystemLike {
  getVessels(): Iterable<{ id: number; traveling: boolean }>;
  getVesselPath(id: number): ReadonlyArray<{ x: number; y: number }> | null;
}

export class FerryAnimator implements VehicleAnimator {
  private anims = new Map<number, FerryAnimState>();

  /**
   * Advances the ferry animations for one frame and overwrites every ferry's position and heading in
   * transportVehicles.
   */
  update(
    dt: number,
    speed: number,
    ferrySystem: FerrySystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    // Synchronise the animation state: create one on departure and clear it only once it has played
    // out.
    for (const v of ferrySystem.getVessels()) {
      if (v.traveling) {
        const waterPath = ferrySystem.getVesselPath(v.id);
        const existing = this.anims.get(v.id);
        // A new departure or a new leg, seen as a different path reference, creates a new
        // animation.
        if (waterPath && waterPath.length > 1 &&
            (!existing || existing.pathInfo.path !== waterPath)) {
          const info = buildFerryPathInfo(waterPath);
          const initPos = interpolateFerryPath(info, 0);
          this.anims.set(v.id, {
            pathInfo: info,
            distance: 0,
            heading: existing?.heading ?? initPos?.heading ?? 0,
          });
        }
      }
      // Not deleted while !traveling, so the animation plays to its end.
    }

    // Advance each ferry's distance, LERP its heading, and clear animations that have finished.
    for (const [vesselId, anim] of this.anims) {
      anim.distance += FERRY_VISUAL_SPEED * dt * speed;
      // Heading LERP: take the path's target heading and turn toward it smoothly.
      const target = interpolateFerryPath(anim.pathInfo, anim.distance);
      if (target) {
        let diff = target.heading - anim.heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const t = Math.min(1, FERRY_TURN_RATE * dt * Math.max(speed, 0.001));
        anim.heading += diff * t;
      }
      if (anim.distance >= anim.pathInfo.totalLength) {
        const vessel = [...ferrySystem.getVessels()].find(v => v.id === vesselId);
        if (!vessel || !vessel.traveling) {
          this.anims.delete(vesselId);
        }
      }
    }

    // Overwrite each ferry's visual position and heading, using the LERPed heading.
    for (const vd of transportVehicles) {
      if (vd.type === 'ferry') {
        const vesselId = vd.id - FERRY_ID_OFFSET;
        const anim = this.anims.get(vesselId);
        if (anim) {
          const pos = interpolateFerryPath(anim.pathInfo, anim.distance);
          if (pos) {
            vd.x = pos.x;
            vd.y = pos.y;
            vd.heading = anim.heading;
          }
        }
      }
    }
  }

  dispose(): void {
    this.anims.clear();
  }
}

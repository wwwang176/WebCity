import { toPosKey } from '../grid/GridHelpers';
import { RoadType, RoadDirection } from '../road/types';

/**
 * Traffic light system for intersections.
 * Phase 0: N-S green, E-W red
 * Phase 1: N-S red, E-W green
 */

export interface TrafficLight {
  x: number;
  y: number;
  phase: number; // 0 = NS green / EW red, 1 = NS red / EW green
  timer: number; // ticks remaining in current phase
}

/** Traffic light configuration */
export const TRAFFIC_LIGHT = {
  /** Seconds per phase */
  PHASE_DURATION: 2,
} as const;

export class TrafficLightSystem {
  private lights = new Map<string, TrafficLight>();

  addLight(x: number, y: number): void {
    const key = toPosKey(x, y);
    if (this.lights.has(key)) return;
    // Stagger phase start by position hash to avoid all lights syncing
    const stagger = ((x * 7 + y * 13) % 10) / 10 * TRAFFIC_LIGHT.PHASE_DURATION;
    this.lights.set(key, { x, y, phase: 0, timer: stagger + 0.1 });
  }

  removeLight(x: number, y: number): void {
    this.lights.delete(toPosKey(x, y));
  }

  /** Advance all lights by dt seconds (frame-based, not tick-based). */
  tick(dt: number): void {
    for (const light of this.lights.values()) {
      light.timer -= dt;
      if (light.timer <= 0) {
        light.phase = (light.phase + 1) % 2;
        light.timer += TRAFFIC_LIGHT.PHASE_DURATION;
      }
    }
  }

  /**
   * Check if a vehicle traveling from (fromX,fromY) to (toX,toY) can enter.
   * Only blocks if (toX,toY) is a traffic-light intersection and the light is red
   * for the vehicle's direction.
   */
  canPass(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const light = this.lights.get(toPosKey(toX, toY));
    if (!light) return true;

    const dx = toX - fromX;
    const dy = toY - fromY;
    // N-S movement: dy != 0
    const isNS = dy !== 0;
    if (isNS) return light.phase === 0; // phase 0 = NS green
    return light.phase === 1; // phase 1 = EW green
  }

  getLight(x: number, y: number): TrafficLight | undefined {
    return this.lights.get(toPosKey(x, y));
  }

  getLights(): TrafficLight[] {
    return [...this.lights.values()];
  }

  clear(): void {
    this.lights.clear();
  }
}

/**
 * Sync traffic lights with current grid state: add lights at 3+ way intersections,
 * remove stale lights where intersections no longer exist.
 */
export function syncTrafficLightsWithGrid(
  grid: { forEachCell(fn: (cell: { roadType: number; roadFlags: number }, x: number, y: number) => void): void },
  tls: TrafficLightSystem,
): void {
  const seen = new Set<string>();

  grid.forEachCell((cell, x, y) => {
    if (cell.roadType === RoadType.NONE) return;
    let dirs = 0;
    if (cell.roadFlags & RoadDirection.NORTH) dirs++;
    if (cell.roadFlags & RoadDirection.SOUTH) dirs++;
    if (cell.roadFlags & RoadDirection.EAST) dirs++;
    if (cell.roadFlags & RoadDirection.WEST) dirs++;
    if (dirs >= 3) {
      const key = `${x},${y}`;
      seen.add(key);
      if (!tls.getLight(x, y)) {
        tls.addLight(x, y);
      }
    }
  });

  // Remove lights for intersections that no longer exist
  for (const light of tls.getLights()) {
    if (!seen.has(`${light.x},${light.y}`)) {
      tls.removeLight(light.x, light.y);
    }
  }
}

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
  timer: number; // seconds remaining in current phase (or clearance)
  phaseDuration: number; // seconds per phase (varies by intersection size)
  clearing: boolean; // true during all-red clearance period
}

/** Traffic light configuration */
export const TRAFFIC_LIGHT = {
  /** Default seconds per phase (standard intersection) */
  PHASE_DURATION: 4,
  /** Seconds per phase for large intersections (4-way + FOUR_LANE or above) */
  PHASE_DURATION_LARGE: 8,
  /** All-red clearance duration between phase switches */
  CLEARANCE_DURATION: 1,
} as const;

export class TrafficLightSystem {
  private lights = new Map<string, TrafficLight>();

  addLight(x: number, y: number, phaseDuration = TRAFFIC_LIGHT.PHASE_DURATION): void {
    const key = toPosKey(x, y);
    if (this.lights.has(key)) return;
    // Stagger phase start by position hash to avoid all lights syncing
    const stagger = ((x * 7 + y * 13) % 10) / 10 * phaseDuration;
    this.lights.set(key, { x, y, phase: 0, timer: stagger + 0.1, phaseDuration, clearing: false });
  }

  removeLight(x: number, y: number): void {
    this.lights.delete(toPosKey(x, y));
  }

  /** Advance all lights by dt seconds (frame-based, not tick-based). */
  tick(dt: number): void {
    for (const light of this.lights.values()) {
      light.timer -= dt;
      if (light.timer <= 0) {
        if (light.clearing) {
          // Clearance ended → switch to next phase
          light.phase = (light.phase + 1) % 2;
          light.timer += light.phaseDuration;
          light.clearing = false;
        } else {
          // Green phase ended → enter all-red clearance
          light.timer += TRAFFIC_LIGHT.CLEARANCE_DURATION;
          light.clearing = true;
        }
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

    // All-red clearance: nobody passes
    if (light.clearing) return false;

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

  /** Iterate lights without array allocation (for per-frame rendering). */
  values(): IterableIterator<TrafficLight> {
    return this.lights.values();
  }

  clear(): void {
    this.lights.clear();
  }
}

/** Whether this road type is a major road (FOUR_LANE or above, excluding HIGHWAY). */
function isMajorRoad(roadType: number): boolean {
  return roadType === RoadType.FOUR_LANE || roadType === RoadType.SIX_LANE;
}

interface TrafficLightGrid {
  forEachCell(fn: (cell: { roadType: number; roadFlags: number }, x: number, y: number) => void): void;
  getCell(x: number, y: number): { roadType: number } | null;
}

const DIR_OFFSETS: [number, number, number][] = [
  [RoadDirection.NORTH, 0, -1],
  [RoadDirection.SOUTH, 0,  1],
  [RoadDirection.EAST,  1,  0],
  [RoadDirection.WEST, -1,  0],
];

/** Check whether major arms exist on both axes (N-S and E-W).
 *  A single major road passing through (e.g. FOUR_LANE N-S) only occupies one axis.
 *  Traffic lights are only needed when two major roads cross (both axes major). */
function hasMajorOnBothAxes(grid: TrafficLightGrid, x: number, y: number, roadFlags: number): boolean {
  let nsMajor = false;
  let ewMajor = false;
  for (const [flag, dx, dy] of DIR_OFFSETS) {
    if (!(roadFlags & flag)) continue;
    const neighbor = grid.getCell(x + dx, y + dy);
    if (!neighbor || !isMajorRoad(neighbor.roadType)) continue;
    if (dx === 0) nsMajor = true; // N or S
    else ewMajor = true;          // E or W
  }
  return nsMajor && ewMajor;
}

/**
 * Sync traffic lights with current grid state.
 * Only intersections where two major roads cross (both axes) get a light.
 * - 3-way with both axes major: standard phase (2s)
 * - 4-way with both axes major: long phase (4s)
 */
export function syncTrafficLightsWithGrid(
  grid: TrafficLightGrid,
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
    if (dirs < 3) return;

    if (!hasMajorOnBothAxes(grid, x, y, cell.roadFlags)) return;

    const key = `${x},${y}`;
    seen.add(key);

    const duration = (dirs >= 4)
      ? TRAFFIC_LIGHT.PHASE_DURATION_LARGE
      : TRAFFIC_LIGHT.PHASE_DURATION;

    const existing = tls.getLight(x, y);
    if (!existing) {
      tls.addLight(x, y, duration);
    } else if (existing.phaseDuration !== duration) {
      existing.phaseDuration = duration;
    }
  });

  // Remove lights for intersections that no longer qualify
  for (const light of tls.getLights()) {
    if (!seen.has(`${light.x},${light.y}`)) {
      tls.removeLight(light.x, light.y);
    }
  }
}

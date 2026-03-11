import type { Grid } from '../grid/Grid';
import { toPosKey, hasVerticalFlag } from '../grid/GridHelpers';
import { RoadType } from '../road/types';
import { RailType, TrackDirection } from './types';

export enum CrossingState {
  CLEAR = 0,
  ACTIVE = 1,
}

export interface LevelCrossing {
  x: number;
  y: number;
  state: CrossingState;
  /** Rail direction through this crossing: NS (vertical) or EW (horizontal). */
  railOrientation: 'NS' | 'EW';
  /** Remaining seconds to keep crossing active after last train detection. */
  cooldownTime: number;
}

/** Activation radius (Manhattan distance in cells). Crossing activates when a train is within this distance. */
const ACTIVATION_RADIUS = 2.5;
/** Seconds the crossing stays active after the train moves away. */
const COOLDOWN_DURATION = 1.5;

const cellKey = toPosKey;

/**
 * Manages level crossing (railroad crossing) state.
 * Detects cells where rail and road coexist, and activates crossings
 * when trains are near them (proximity-based, not whole-path).
 */
export class LevelCrossingSystem {
  private crossings = new Map<string, LevelCrossing>();

  /** Scan grid for cells with both railType !== RailType.NONE and roadType !== RoadType.NONE. */
  rebuildFromGrid(grid: Grid): void {
    this.crossings.clear();

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.railType !== RailType.NONE && cell.roadType !== RoadType.NONE) {
          const hasVert = hasVerticalFlag(cell.railFlags);
          const railOrientation: 'NS' | 'EW' = hasVert ? 'NS' : 'EW';

          this.crossings.set(cellKey(x, y), {
            x,
            y,
            state: CrossingState.CLEAR,
            railOrientation,
            cooldownTime: 0,
          });
        }
      }
    }
  }

  /**
   * Update crossing states based on actual train visual positions (proximity-based).
   * Call this per-frame after TrainAnimator has updated train positions.
   */
  update(
    dt: number,
    speed: number,
    trainPositions: ReadonlyArray<{ x: number; y: number }>,
  ): void {
    if (this.crossings.size === 0) return;

    // Find which crossings have a train nearby
    const activeCrossings = new Set<string>();

    for (const pos of trainPositions) {
      for (const [key, crossing] of this.crossings) {
        const dx = Math.abs(pos.x - crossing.x);
        const dy = Math.abs(pos.y - crossing.y);
        if (dx + dy <= ACTIVATION_RADIUS) {
          activeCrossings.add(key);
        }
      }
    }

    // Update states
    for (const [key, crossing] of this.crossings) {
      if (activeCrossings.has(key)) {
        crossing.state = CrossingState.ACTIVE;
        crossing.cooldownTime = COOLDOWN_DURATION;
      } else if (crossing.cooldownTime > 0) {
        crossing.cooldownTime -= dt * Math.max(speed, 0.001);
        if (crossing.cooldownTime <= 0) {
          crossing.state = CrossingState.CLEAR;
          crossing.cooldownTime = 0;
        }
      }
    }
  }

  /** Check if a specific cell has a blocked crossing. */
  isCrossingBlocked(x: number, y: number): boolean {
    const crossing = this.crossings.get(cellKey(x, y));
    return crossing !== undefined && crossing.state === CrossingState.ACTIVE;
  }

  /** Get all crossings (for rendering). */
  getCrossings(): readonly LevelCrossing[] {
    return Array.from(this.crossings.values());
  }

  /** Get crossing at specific cell (for rendering / query). */
  getCrossing(x: number, y: number): LevelCrossing | undefined {
    return this.crossings.get(cellKey(x, y));
  }
}

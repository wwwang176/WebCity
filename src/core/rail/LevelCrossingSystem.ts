import type { Grid } from '../grid/Grid';
import { RailType, TrackDirection } from './types';
import type { RailSystem } from '../transport/RailSystem';

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
  /** Remaining ticks to keep crossing active after last train detection. */
  cooldownTicks: number;
}

/** How many ticks the crossing stays active after the train is no longer detected. */
const COOLDOWN_DURATION = 3;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Manages level crossing (railroad crossing) state.
 * Detects cells where rail and road coexist, and activates crossings
 * when trains are traveling through them.
 */
export class LevelCrossingSystem {
  private crossings = new Map<string, LevelCrossing>();

  /** Scan grid for cells with both railType > 0 and roadType > 0. */
  rebuildFromGrid(grid: Grid): void {
    this.crossings.clear();

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;
        if (cell.railType !== RailType.NONE && cell.roadType > 0) {
          const hasVert = (cell.railFlags & (TrackDirection.NORTH | TrackDirection.SOUTH)) !== 0;
          const railOrientation: 'NS' | 'EW' = hasVert ? 'NS' : 'EW';

          this.crossings.set(cellKey(x, y), {
            x,
            y,
            state: CrossingState.CLEAR,
            railOrientation,
            cooldownTicks: 0,
          });
        }
      }
    }
  }

  /** Update crossing states based on current rail vehicle positions and paths. */
  tick(railSystem: RailSystem): void {
    if (this.crossings.size === 0) return;

    // Collect all crossing cell keys that have a train currently on their path segment
    const activeCrossings = new Set<string>();

    const trains = railSystem.getTrains();
    const lines = railSystem.getLines();

    for (const train of trains) {
      if (!train.traveling) continue;

      const route = lines.find(l => l.id === train.routeId);
      if (!route) continue;

      const paths = railSystem.getRoutePaths(route.id);
      if (!paths || paths.length === 0) continue;

      // Determine which segment the train is on
      const segIdx = (train.currentStopIndex - 1 + paths.length) % paths.length;
      const path = paths[segIdx];
      if (!path) continue;

      // Check if any crossing cell is on this path segment
      for (const nodeId of path) {
        if (this.crossings.has(nodeId)) {
          activeCrossings.add(nodeId);
        }
      }
    }

    // Update states
    for (const [key, crossing] of this.crossings) {
      if (activeCrossings.has(key)) {
        crossing.state = CrossingState.ACTIVE;
        crossing.cooldownTicks = COOLDOWN_DURATION;
      } else if (crossing.cooldownTicks > 0) {
        crossing.cooldownTicks--;
        if (crossing.cooldownTicks <= 0) {
          crossing.state = CrossingState.CLEAR;
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

import type { WorkplaceDistanceBuffers } from './WorkplaceDistanceTable';

/** Position of a workplace building. */
export interface WorkplacePosition {
  pos: string;   // "x,y" key
  x: number;
  y: number;
}


/** Main → Worker messages */
export interface WDWorkerRequest {
  type: 'COMPUTE';
  requestId: number;
  gridWidth: number;
  gridHeight: number;
  /**
   * The grid buffer. The worker uses it only to decide whether a cell is a building, which
   * decides what attachment collects; the traversal rules are not here but in `graphBuffer`.
   */
  gridBuffer: SharedArrayBuffer | ArrayBuffer;
  /**
   * The serialised **transposed** RoadCellGraph.
   *
   * Level and ramp rules are consumed at build time and the worker never interprets a level,
   * which is the underlying fix for BUG-109. The transpose is explained by BUG-237: cost is
   * charged at the destination cell, and a reverse flood on the forward graph charges the source
   * cell's price instead.
   */
  graphBuffer: ArrayBuffer;
  workplaces: WorkplacePosition[];
  maxBudget: number;
}

/**
 * Worker to main messages.
 *
 * `table`'s three views arrive **through a transfer list** rather than being copied. The old
 * format was a `Record<string, number>` per workplace, where reading `e.data` alone measured 1.1
 * seconds on a 40k save: 375 workplaces across 408,712 string keys.
 */
export type WDWorkerResponse =
  | { type: 'RESULT'; requestId: number; table: WorkplaceDistanceBuffers }
  | { type: 'ERROR'; requestId: number; message: string };

/** Position of a workplace building. */
export interface WorkplacePosition {
  pos: string;   // "x,y" key
  x: number;
  y: number;
}

/** Worker → Main: computed distance table for one workplace. */
export interface WorkplaceDistanceEntry {
  workplacePos: string;
  /** posKey → road cost */
  distances: Record<string, number>;
}

/** Main → Worker messages */
export interface WDWorkerRequest {
  type: 'COMPUTE';
  requestId: number;
  gridWidth: number;
  gridHeight: number;
  gridBuffer: SharedArrayBuffer | ArrayBuffer;
  workplaces: WorkplacePosition[];
  maxBudget: number;
}

/** Worker → Main messages */
export type WDWorkerResponse =
  | { type: 'RESULT'; requestId: number; entries: WorkplaceDistanceEntry[] }
  | { type: 'ERROR'; requestId: number; message: string };

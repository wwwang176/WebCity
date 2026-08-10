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
  /**
   * 格子緩衝。worker 只用它判斷「這一格是不是建築」（附掛時要收哪些格子）——
   * 走訪規則不在這裡，在 `graphBuffer` 裡。
   */
  gridBuffer: SharedArrayBuffer | ArrayBuffer;
  /**
   * 序列化的**轉置** RoadCellGraph。
   *
   * 樓層與匝道規則在建圖時就消化掉了，worker 不解讀樓層 —— 那是 BUG-109 的
   * 治本。轉置的理由見 BUG-237：成本加在目的地那一格，用正向圖跑反向 flood
   * 會付成來源那格的價格。
   */
  graphBuffer: ArrayBuffer;
  workplaces: WorkplacePosition[];
  maxBudget: number;
}

/** Worker → Main messages */
export type WDWorkerResponse =
  | { type: 'RESULT'; requestId: number; entries: WorkplaceDistanceEntry[] }
  | { type: 'ERROR'; requestId: number; message: string };

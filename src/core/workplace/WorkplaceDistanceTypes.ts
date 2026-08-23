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

/**
 * Worker → Main messages
 *
 * `table` 的三個檢視是**用 transfer list 搬過來的**，不是複製。舊格式是逐工作地
 * 一份 `Record<string, number>`，4 萬人存檔實測光是讀一次 `e.data` 就要 1.1 秒
 * （375 個工作地、合計 408,712 個字串鍵）。
 */
export type WDWorkerResponse =
  | { type: 'RESULT'; requestId: number; table: WorkplaceDistanceBuffers }
  | { type: 'ERROR'; requestId: number; message: string };

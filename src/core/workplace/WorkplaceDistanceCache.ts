import type { WorkplaceDistanceClient } from './WorkplaceDistanceClient';
import type { WorkplacePosition } from './WorkplaceDistanceTypes';
import { WorkplaceDistanceTable, type WorkplaceDistanceBuffers } from './WorkplaceDistanceTable';
import { graphBufferNodeCount } from '../road/RoadCellGraphBuffer';
import { parsePosKey } from '../grid/GridHelpers';

export enum CacheStatus {
  EMPTY = 'empty',
  COMPUTING = 'computing',
  READY = 'ready',
}

/**
 * Caches precomputed road distances from workplaces to all reachable cells.
 * Invalidated via observer pattern — call invalidate() when roads or buildings change.
 * Computation is done in a web worker; main thread only does O(1) lookups.
 *
 * ## 失效不等於丟掉，但要看是什麼變了
 *
 * `status` 講的是「這份表是不是**當前**的」，`table` 是「有沒有一份可以用的」。
 * 兩件不同的事。
 *
 * **建築變了**（長出來、升級、燒毀、廢棄）不會改變任何一條道路的距離 —— 它只改變
 * 哪些格子算是工作地，而那件事由呼叫端當下的候選集合過濾。續用舊表只是稍舊。
 *
 * **路網變了**就不同了:拆一條路、改單行方向、升級路型之後，舊表會把已經到不了的
 * 工作地說成到得了（市民被指派到一個開不過去的班），或反過來把新通的排除掉。
 * 那不是稍舊，那是錯的 —— 所以 `invalidateTopology()` 會把表丟掉，也不收算到一半
 * 那份（它是照舊路網算的）。
 *
 * 理由是量出來的。4 萬人的存檔:`runJobRelocation` 大約每 13 秒跑一次，而
 * `invalidate()` 的觸發者（房子長出來、升級、燒毀、廢棄、道路改變）在活城市裡
 * 一直在發生，快取 READY 的窗只有 6~8 秒。落在空檔就掉回同步 Dijkstra ——
 * **實測 2,684ms**，而走快取是 161ms。落在哪裡純粹是運氣。
 *
 * 一棟房子升級不會改變路網距離。上一份表隔一輪的誤差，遠小於凍住主執行緒 2.7 秒。
 */
export class WorkplaceDistanceCache {
  private status: CacheStatus = CacheStatus.EMPTY;
  /** Set to true if invalidate() is called while status === CacheStatus.COMPUTING. */
  private invalidatedDuringBuild = false;
  /** 路網在重算期間變了 —— 那份結果照的是舊路網，不能收。 */
  private topologyChangedDuringBuild = false;
  /** 逐格的 CSR 表。`null` = 從來沒算成功過。 */
  private table: WorkplaceDistanceTable | null = null;
  private client: WorkplaceDistanceClient | null = null;

  constructor(client?: WorkplaceDistanceClient) {
    this.client = client ?? null;
  }

  /**
   * 建築變了 —— 表不再是當前的，但仍然可以用（道路距離沒變）。
   */
  invalidate(): void {
    if (this.status === CacheStatus.COMPUTING) {
      this.invalidatedDuringBuild = true;
    } else {
      this.status = CacheStatus.EMPTY;
    }
  }

  /**
   * **路網**變了 —— 表現在是錯的，丟掉。
   *
   * 也標記算到一半那份要作廢:它是照舊路網跑出來的，收下它等於把錯的可達性
   * 當成新的。
   */
  invalidateTopology(): void {
    this.table = null;
    this.topologyChangedDuringBuild = this.status === CacheStatus.COMPUTING;
    if (this.status !== CacheStatus.COMPUTING) this.status = CacheStatus.EMPTY;
  }

  /** Force full reset (e.g. on game load). */
  reset(): void {
    this.status = CacheStatus.EMPTY;
    this.table = null;
    this.invalidatedDuringBuild = false;
    this.topologyChangedDuringBuild = false;
  }

  /**
   * Trigger async recomputation if not already computing. Returns false if skipped.
   *
   * @param graphBuffer 序列化的**轉置** RoadCellGraph（見 `WDWorkerRequest`）。
   */
  requestUpdate(
    gridWidth: number,
    gridHeight: number,
    gridBuffer: SharedArrayBuffer | ArrayBuffer,
    graphBuffer: ArrayBuffer,
    workplaces: WorkplacePosition[],
    maxBudget: number,
  ): boolean {
    if (!this.client) return false;
    // 空圖代表城市還沒有路。送出去只會拿回一張空表，而空表會被 applyResult
    // 標成 READY —— 全城變成互相到不了。寧可維持 EMPTY 走同步 fallback。
    //
    // 看 header 的 nodeCount，不是 byteLength：空圖的 buffer 有 16 bytes 的
    // header 加一個 offsets[0]，長度是 20。
    if (graphBufferNodeCount(graphBuffer) === 0) return false;
    if (this.status === CacheStatus.COMPUTING) return false;
    this.status = CacheStatus.COMPUTING;
    this.invalidatedDuringBuild = false;

    this.client.compute(gridWidth, gridHeight, gridBuffer, graphBuffer, workplaces, maxBudget)
      .then(entries => this.applyResult(entries))
      .catch(() => {
        // Worker error — reset to empty so next tick retries
        this.status = CacheStatus.EMPTY;
        this.invalidatedDuringBuild = false;
      });
    return true;
  }

  /** Apply worker result — called internally from the promise callback. */
  private applyResult(buffers: WorkplaceDistanceBuffers): void {
    if (this.topologyChangedDuringBuild) {
      // 這份是照**舊路網**算的。收下它等於把錯的可達性當成新的。
      this.topologyChangedDuringBuild = false;
      this.invalidatedDuringBuild = false;
      this.status = CacheStatus.EMPTY;
      return;
    }
    // 建築變了那一種**一定收下**:這份結果不算當前，但它仍然比手上那份新
    // —— 丟掉它等於抱著更舊的一份繼續回答。
    this.table = new WorkplaceDistanceTable(buffers);
    if (this.invalidatedDuringBuild) {
      this.invalidatedDuringBuild = false;
      this.status = CacheStatus.EMPTY;   // 下一輪會再請一次
      return;
    }
    this.status = CacheStatus.READY;
  }

  /** For testing: synchronously populate the cache from a pre-built table. */
  populateSync(buffers: WorkplaceDistanceBuffers): void {
    this.table = new WorkplaceDistanceTable(buffers);
    this.status = CacheStatus.READY;
    this.invalidatedDuringBuild = false;
    this.topologyChangedDuringBuild = false;
  }

  /** O(1) lookup: road cost from home cell to workplace cell. */
  getDistance(homePos: string, workplacePos: string): number | undefined {
    const p = parsePosKey(homePos);
    if (!p || !this.table) return undefined;
    return this.table.costAt(p.x, p.y, workplacePos);
  }

  /** Get all reachable workplaces from a home position. */
  getReachableWorkplaces(homePos: string): Set<string> {
    const p = parsePosKey(homePos);
    if (!p || !this.table) return new Set();
    return this.table.reachableWorkplacesAt(p.x, p.y);
  }

  /** Build distance map from home to specified workplaces (replaces roadDistanceToTargets). */
  getDistancesFromHome(homePos: string, workplacePositions: Iterable<string>): Map<string, number> {
    const p = parsePosKey(homePos);
    if (!p || !this.table) return new Map();
    const targets = workplacePositions instanceof Set
      ? workplacePositions as ReadonlySet<string>
      : new Set(workplacePositions);
    return this.table.distancesAt(p.x, p.y, targets);
  }

  /** 這份表是不是**當前**的。 */
  get isReady(): boolean { return this.status === CacheStatus.READY; }
  /**
   * 有沒有一份可以用的表 —— 可能已經過期。
   *
   * 呼叫端要的幾乎都是這個而不是 `isReady`:同步 fallback 貴到會凍住畫面，
   * 用一份差一輪的表比凍 2.7 秒好得多。
   */
  get hasTable(): boolean { return this.table !== null; }
  get isStale(): boolean { return this.status === CacheStatus.EMPTY; }
  getStatus(): CacheStatus { return this.status; }
}

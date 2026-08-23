import { describe, it, expect, vi } from 'vitest';
import { useSeededRandom } from '../../__tests__/helpers/seededRandom';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { WorkplaceDistanceCache } from '../WorkplaceDistanceCache';
import { WorkplaceDistanceTableBuilder } from '../WorkplaceDistanceTable';
import { WorkplaceDistanceClient } from '../WorkplaceDistanceClient';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';
import { ZoneType } from '../../grid/types';
import { computeWorkplaceDistances } from '../../../workers/workplace-distance.worker';
import { roadDistanceToTargets } from '../../service/RoadCoverageFlood';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';
import { DEFAULT_JOB_RELOCATION_CONFIG } from '../../citizen/JobRelocation';
import type { WDWorkerRequest } from '../WorkplaceDistanceTypes';

/**
 * BUG-109 的驗收測試。
 *
 * 以前 worker 只拿到格子緩衝，看不到高架，而同步 fallback 是樓層感知的 ——
 * 在高架是唯一通路的城市裡兩者答案相反，市民的工作隨著快取 READY／stale
 * 來回得失。當時的對策是一道閘門：有任何一格高架道路就完全不用快取。
 *
 * **這個檔案原本測的是那道閘門，不是行為。** 它灌一份謊報的 ground-only
 * 快取（`distances: {}`），然後斷言市民仍然有工作 —— 通過的原因是閘門讓
 * fallback 獲勝。閘門移除後那份謊報會被採信，測試就紅了。
 *
 * 現在改成用**真正的管線**暖機：建圖 → 轉置 → 序列化 → 在 FakeWorker 裡
 * 同步跑 `reverseFloodFromGraph` 回填。要斷言的變成「快取自己就是樓層感知
 * 的」—— 那才是治本的驗收條件。
 *
 * 刪掉的三條：
 *   - leave the ready cache untouched     閘門「拒用但不清除」的語意，已消失
 *   - not disable the cache for elevated RAIL
 *   - disable the cache for an elevated road
 * 後兩條其實只在測 `ElevationManager` 的 predicate，已搬到
 * `elevation/__tests__/ElevationManager.test.ts`。
 */
/** 不回覆的 stub —— 給不需要真實計算的負向控制用。 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

/**
 * 真的跑一次 worker 的計算，同步回呼。
 *
 * 回覆不會遺失（`WorkplaceDistanceClient` 先登記 pending 再 postMessage），
 * 但 `.then(applyResult)` 仍排在 **microtask** —— 所以測試必須 await 一次，
 * 見 `flush()`。
 */
class ComputingFakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  /** 最後一次收到的圖 —— 用來驗證主執行緒傳的是**轉置**圖。 */
  lastGraphBuffer: ArrayBuffer | null = null;
  postMessage(req: WDWorkerRequest): void {
    if (req.type !== 'COMPUTE') return;
    this.lastGraphBuffer = req.graphBuffer;
    const view = new DataView(req.gridBuffer as ArrayBuffer);
    const isBuilding = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= req.gridWidth || y >= req.gridHeight) return false;
      return view.getUint8((y * req.gridWidth + x) * 12 + 5) === 0;
    };
    const table = computeWorkplaceDistances(
      req.graphBuffer, req.workplaces, req.maxBudget, req.gridWidth, req.gridHeight, isBuilding);
    this.onmessage?.({ data: { type: 'RESULT', requestId: req.requestId, table } });
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

/** 讓已排入的 microtask 跑完。 */
const flush = (): Promise<void> => new Promise(r => { setTimeout(r, 0); });

const HOME = '2,2';
const WORK = '12,2';

/**
 * Power, water and a park on both sides.
 *
 * Not decoration: without them a jobless citizen's happiness collapses inside
 * one slow cycle and runMigration — which runs at the same slot, BEFORE
 * assignCitizenHousing — emigrates them before the assignment pass ever sees
 * them. The fixture emptied itself and the assertion had nobody to observe.
 */
function serviceBothSides(state: ReturnType<typeof createGameState>): void {
  state.power.addPlant({ x: 1, y: 5, output: 2000, pollution: 0, type: 'solar' });
  state.water.addPlant({ x: 2, y: 5, output: 2000 });
  state.parks.addPark(2, 4);
  state.parks.addPark(12, 4);
}

/**
 * Two districts with no ground road between them, bridged only by a viaduct.
 *
 *   (1,3)…(3,3)    west street, houses above it at y=2
 *   (11,3)…(13,3)  east street, a shop above it at y=2
 *   x=4..10 @ y=3  NOTHING on the ground — the gap
 *   the viaduct at level 1 spans the gap, with a ramp at each end
 */
function bridgedCity() {
  const state = createGameState(20, 20);
  const rb = new RoadBuilder(state.grid);
  rb.buildRoad({ x: 1, y: 3 }, { x: 3, y: 3 }, RoadType.TWO_LANE, 1e6);
  rb.buildRoad({ x: 11, y: 3 }, { x: 13, y: 3 }, RoadType.TWO_LANE, 1e6);

  state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(12, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  serviceBothSides(state);

  const em = new ElevationManager();
  // 高架用 HIGHWAY（每格 9），地面是 TWO_LANE（每格 36）。
  // **路型必須混合** —— 全部同路型時正向圖與轉置圖的邊集完全相同，
  // 「傳錯圖」那類錯誤就測不出來（BUG-237 當初就是這樣漏掉的）。
  const seg = (isRamp: boolean, ascend: number) => ({
    roadType: RoadType.HIGHWAY, roadFlags: 12, railType: RailType.NONE, railFlags: 0,
    isRamp, rampAscendDirection: ascend,
  });
  const EAST = 0b1000, WEST = 0b0100;
  em.set(3, 3, 1, seg(true, EAST));
  for (let x = 4; x <= 10; x++) em.set(x, 3, 1, seg(false, 0));
  em.set(11, 3, 1, seg(true, WEST));

  const loop = new SimulationLoop(state);
  loop.setElevationManager(em);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, em));

  // 真的算 —— 不灌謊報的快取。快取要自己走完整條管線才會 READY。
  const worker = new ComputingFakeWorker();
  const cache = new WorkplaceDistanceCache(
    new WorkplaceDistanceClient(worker as unknown as Worker),
  );
  loop.setWorkplaceDistanceCache(cache);

  const citizen = state.citizens.createCitizen({ age: 100 })!;
  citizen.homeId = HOME;

  return { state, loop, em, cache, citizen, worker };
}

/**
 * Whether ANYONE ended up working at the shop.
 *
 * Not "did this particular citizen get the job": a jobless citizen in a city
 * with no services is unhappy, and runMigration — which runs at the same slow
 * slot, BEFORE assignCitizenHousing — emigrates them before the assignment pass
 * ever sees them. Migration keeps supplying replacements, so the question that
 * survives the churn is whether the job across the viaduct is reachable at all.
 */
function anyoneEmployedAtShop(state: ReturnType<typeof bridgedCity>['state']): boolean {
  return state.citizens.getCitizens().some(c => c.workplaceId === WORK);
}

describe('workplace reachability is elevation-aware', () => {
  // These cases run real ticks and lean on migration to keep supplying
  // candidates for the job across the bridge — see anyoneEmployedAtShop. That
  // makes them a draw on Math.random, and they failed roughly one full-suite
  // run in five once the attractiveness weighting stopped rewarding jobs
  // nobody can reach (BUG-166): this fixture starts at 100% unemployment by
  // construction, which is exactly the state that change damps.
  useSeededRandom();

  it('should employ someone whose only route to work is a viaduct, from the cache', async () => {
    // BUG-109 的驗收條件。以前這裡靠「有高架就別用快取」的閘門；現在快取
    // 本身就是樓層感知的，所以要斷言的是**快取真的 READY、真的被讀、
    // 而且答案讓高架另一端的工作有人做**。
    const { state, loop, cache } = bridgedCity();

    // requestUpdate 在慢速槽才跑，所以要 tick 到它發生為止。
    // 每個 tick 後 flush 一次：ComputingFakeWorker 是同步回覆的，但
    // `.then(applyResult)` 排在 microtask。
    for (let i = 0; i < 24 && !cache.isReady; i++) { loop.tick(); await flush(); }
    expect(cache.isReady, '快取沒有變成 READY —— 高架城市仍然沒在用快取').toBe(true);

    // READY 之後才開始觀察，否則看到的是同步 fallback 的結果。
    //
    // spy 的是 getReachableWorkplaces：那是**指派**路徑
    // （buildWorkplaceReachabilityFromCache）實際呼叫的方法。換工作路徑用的
    // 是 getDistancesFromHome，但它每 120 tick 才跑一次，這裡等不到。
    const spy = vi.spyOn(cache, 'getReachableWorkplaces');
    for (let i = 0; i < 24; i++) { loop.tick(); await flush(); }

    expect(spy, '快取 READY 了卻沒有被讀 —— 這條測的其實是 fallback')
      .toHaveBeenCalled();
    expect(state.citizens.getPopulation()).toBeGreaterThan(0);
    expect(anyoneEmployedAtShop(state), '高架另一端的工作沒有人做').toBe(true);
  });

  it('should give the cache the same answer as the synchronous query', async () => {
    // 兩條路一致才是治本。挑高架兩端的一對家與工作直接比。
    const { loop, cache, state } = bridgedCity();
    for (let i = 0; i < 24 && !cache.isReady; i++) { loop.tick(); await flush(); }
    expect(cache.isReady, '快取沒有變成 READY').toBe(true);

    const lookup = loop.getRoadLookup()!;
    const [hx, hy] = HOME.split(',').map(Number);
    const sync = roadDistanceToTargets(
      state.grid, { x: hx!, y: hy! }, new Set([WORK]),
      DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget, lookup, buildRoadCellGraph(lookup),
    );
    expect(sync.get(WORK), '同步查詢自己就到不了，這條測不出東西').toBeDefined();
    expect(cache.getDistance(HOME, WORK), '快取與同步查詢不一致').toBe(sync.get(WORK));
  });

  it('should hand the worker the transposed graph, not the forward one', async () => {
    // 接線測試。轉置本身的正確性由 WorkerGraphParity 全域守著（它比對每一對
    // 家與工作）；這裡守的是**主執行緒有沒有傳對那一張**。
    //
    // 為什麼不靠就業結果來測：bridgedCity 的 HOME 與 WORK 兩端都直接附掛到
    // 高架格，路徑沒有用到會產生正反差異的「上下橋」邊，所以傳錯圖時那一對
    // 的成本剛好相同 —— 用行為去測會是空轉的。直接比 buffer 才有辨識力。
    const { loop, cache, worker } = bridgedCity();
    for (let i = 0; i < 24 && !cache.isReady; i++) { loop.tick(); await flush(); }
    expect(worker.lastGraphBuffer, 'worker 根本沒收到圖').not.toBeNull();

    const g = buildRoadCellGraph(loop.getRoadLookup()!);
    const expected = serializeRoadCellGraph(transposeRoadCellGraph(g));
    const forward = serializeRoadCellGraph(g);
    // fixture 健全性：兩者必須不同，否則這條分辨不出東西
    expect([...new Uint8Array(expected)], 'fixture 的圖是對稱的，這條測不出東西')
      .not.toEqual([...new Uint8Array(forward)]);

    expect([...new Uint8Array(worker.lastGraphBuffer!)], '傳給 worker 的不是轉置圖')
      .toEqual([...new Uint8Array(expected)]);
  });

  it('fixture sanity: bridgedCity really mixes road tiers', () => {
    // 全部同路型時正向圖與轉置圖相同，「傳錯圖」測不出來。
    const { loop } = bridgedCity();
    const g = buildRoadCellGraph(loop.getRoadLookup()!);
    expect(new Set(g.weights).size, 'bridgedCity 只有一種路型 —— 正反向圖無法區分')
      .toBeGreaterThan(1);
  });

  it('should still use the cache in a city with no elevated road', () => {
    // Negative control. Without it, "ignore the cache" would be satisfiable by
    // never using the cache at all, which is the whole optimisation gone.
    const state = createGameState(20, 20);
    new RoadBuilder(state.grid).buildRoad({ x: 1, y: 3 }, { x: 13, y: 3 }, RoadType.TWO_LANE, 1e6);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(12, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    serviceBothSides(state);

    const em = new ElevationManager();
    const loop = new SimulationLoop(state);
    loop.setElevationManager(em);
    loop.setRoadLookup(new UnifiedRoadLookup(state.grid, em));

    const cache = new WorkplaceDistanceCache(
      new WorkplaceDistanceClient(new FakeWorker() as unknown as Worker),
    );
    // A cache that LIES: it claims the shop is unreachable although the ground
    // road plainly connects it. If the loop consults the cache, the citizen
    // stays jobless; if it ignores the cache, they get the job.
    const liar = new WorkplaceDistanceTableBuilder(state.grid.width, state.grid.height);
    liar.addWorkplace(WORK, new Int32Array(state.grid.width * state.grid.height).fill(-1));
    cache.populateSync(liar.build());
    loop.setWorkplaceDistanceCache(cache);

    state.citizens.createCitizen({ age: 100 })!.homeId = HOME;

    // The jobless citizen is emigrated and replaced repeatedly — that is the
    // point of the case — so the FINAL population is not a useful witness.
    // Record whether anyone was ever there to be assigned, and whether anyone
    // ever got the job.
    let everHadCitizens = false;
    let everEmployed = false;
    for (let i = 0; i < 24; i++) {
      loop.tick();
      if (state.citizens.getPopulation() > 0) everHadCitizens = true;
      if (state.citizens.getCitizens().some(c => c.workplaceId === WORK)) everEmployed = true;
    }

    expect(everHadCitizens).toBe(true);
    expect(everEmployed).toBe(false);
  });

});

import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';

/**
 * 「這條通勤沒有路」要被記住，而且只記一次。
 *
 * `advanceCommuteFill` 有兩條路:先請 worker 算，排過
 * `COMMUTE_FILL_MAX_ATTEMPTS` 次還拿不到就自己算。那個次數原本是為了防「worker
 * 交白卷」—— 但 worker 回傳空陣列（真的沒有路）走的是同一條計數，`onResult`
 * 又把空結果丟掉，所以「已經知道沒有路」跟「還不知道」對這段程式長得一模一樣。
 *
 * 後果是游標每繞回來一圈，那條路線就在主執行緒重算一次同一個答案。41k 人的
 * 存檔實測:3 362 條這樣的路線、9 838 次同步 A*，用完額度之後**成功 0 次**，
 * 而 `advanceCommuteFill` 佔掉主執行緒的 9.9%（BUG-369）。
 *
 * 測資是兩條**互不相連**的路廊 —— 兩端都有連接點（所以請求送得出去），中間
 * 沒有路（所以 A* 一定交白卷）。
 */

const CORRIDOR_A_Y = 2;
const CORRIDOR_B_Y = 20;

/** 走得通的那位的家、走不通的那位的家、與兩邊的工作地。 */
const HOME_OK = '4,4';
const WORK_OK = '9,4';
const HOME_STRANDED = '6,4';
const WORK_STRANDED = '5,18';

const OK_ROUTE = `${HOME_OK}->${WORK_OK}`;
const MORNING = `${HOME_STRANDED}->${WORK_STRANDED}`;
const EVENING = `${WORK_STRANDED}->${HOME_STRANDED}`;

function twoIslands(): GameState {
  const state = createGameState(24, 24);
  for (const y of [CORRIDOR_A_Y, CORRIDOR_B_Y]) {
    for (let x = 2; x <= 10; x++) {
      let flags = RoadDirection.EAST | RoadDirection.WEST;
      if (x === 2) flags = RoadDirection.EAST;
      if (x === 10) flags = RoadDirection.WEST;
      state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  for (const key of [HOME_OK, HOME_STRANDED]) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    state.grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  for (const key of [WORK_OK, WORK_STRANDED]) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    state.grid.setCell(x, y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  }
  return state;
}

/**
 * `commuteFillAttempts` 只有兩個地方會加一:向 worker 排一次隊、主執行緒自己算
 * 一次。所以它就是「這條路線總共花了幾次力氣」，而重試的浪費看的正是這個數字。
 */
type Inner = {
  commuteFillAttempts: Map<string, number>;
  advanceCommuteFill(): void;
};

interface Fixture {
  loop: SimulationLoop;
  inner: Inner;
  stranded: number;
}

/**
 * @param worker 掛不掛 worker。不掛的話 `advanceCommuteFill` 走同步那條路。
 *
 * 先 `tick()` 一次把 lane graph 與 worker 的 mapping 建起來，之後**只呼叫
 * `advanceCommuteFill`** —— 跑整個 tick 的話遷入與 `runJobRelocation` 會動到
 * 市民的住處與工作，而那正是這裡要觀察的東西。
 */
function makeCity(opts: { worker: boolean }): Fixture {
  const state = twoIslands();
  const pair = (home: string, work: string): number => {
    // 52 歲以下不是勞動年齡，`advanceCommuteFill` 會直接跳過。
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) throw new Error('測資沒建出市民 —— 住宅容量不夠');
    c.homeId = home;
    c.workplaceId = work;
    return c.id;
  };
  pair(HOME_OK, WORK_OK);
  const stranded = pair(HOME_STRANDED, WORK_STRANDED);

  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  if (opts.worker) loop.setPathfindingWorker(createSyncFakeWorker());
  loop.tick();

  // 那一個 tick 可能把人搬了家或換了工作。重新釘回測資要問的那一對。
  const c = state.citizens.getCitizens().find(x => x.id === stranded);
  if (!c) throw new Error('測資的市民在第一個 tick 就不見了');
  c.homeId = HOME_STRANDED;
  c.workplaceId = WORK_STRANDED;
  return { loop, inner: loop as unknown as Inner, stranded };
}

describe('走不通的通勤只算一次', () => {
  it('should route the commute that does have a road', () => {
    // 前置條件。這一條走不通的話，底下每個測試都會因為錯的理由而通過。
    const { loop, inner } = makeCity({ worker: true });
    inner.advanceCommuteFill();

    expect(loop.commuteCache.getRouteVariants(OK_ROUTE), '同一條路廊上的通勤也算不出來 —— 測資壞了')
      .toBeTruthy();
    expect(loop.commuteCache.isUnroutable(OK_ROUTE)).toBe(false);
  });

  it('should remember the worker saying there is no path', () => {
    const { loop, inner } = makeCity({ worker: true });
    inner.advanceCommuteFill();

    expect(loop.commuteCache.isUnroutable(MORNING), 'worker 交回「沒有路」，沒有人記下來').toBe(true);
    expect(loop.commuteCache.isUnroutable(EVENING)).toBe(true);
  });

  it('should stop spending effort once it knows there is no path', () => {
    // 整件事的重點。次數會繼續長，就代表游標每繞回來一圈都在重問同一個答案 ——
    // 而超過 worker 的額度之後，那些力氣全部花在主執行緒的同步 A* 上。
    const { inner } = makeCity({ worker: true });
    for (let t = 0; t < 40; t++) inner.advanceCommuteFill();

    expect(inner.commuteFillAttempts.get(MORNING) ?? 0, '知道沒有路之後還在重問').toBeLessThanOrEqual(1);
    expect(inner.commuteFillAttempts.get(EVENING) ?? 0, '知道沒有路之後還在重問').toBeLessThanOrEqual(1);
  });

  it('should mark the citizen failed so job relocation can pick them up', () => {
    // 標成 failed 才算 settled，游標下一圈才不用再看他一次;而且那是
    // `runJobRelocation` 用來找出「該換工作了」的訊號。
    const { loop, inner, stranded } = makeCity({ worker: true });
    inner.advanceCommuteFill();

    expect(loop.commuteCache.get(stranded)?.status, '兩個方向都確定沒有路，卻沒有結案')
      .toBe('failed');
  });

  it('should still work with no pathfinding worker at all', () => {
    // worker 是加速，不是依賴。沒有它的時候自己算的那條路要照樣得出同樣的結論，
    // 而且同樣只算一次。
    const { loop, inner, stranded } = makeCity({ worker: false });
    for (let t = 0; t < 40; t++) inner.advanceCommuteFill();

    expect(loop.commuteCache.getRouteVariants(OK_ROUTE), '沒有 worker 就連走得通的都算不出來')
      .toBeTruthy();
    expect(loop.commuteCache.isUnroutable(MORNING)).toBe(true);
    expect(loop.commuteCache.get(stranded)?.status).toBe('failed');
    expect(inner.commuteFillAttempts.get(MORNING) ?? 0, '沒有 worker 的時候自己算了不只一次')
      .toBeLessThanOrEqual(1);
  });

  it('should not call it failed just because the search budget ran out', () => {
    // 「還沒問到答案」不是「沒有路」。標成 failed 就等於結案 —— 這一代路網裡
    // 那位市民再也不會被算一次，而他晚上那條路其實根本還沒有人去找過。
    //
    // 造法:把路線池倒掉（等於剛剛動過路網），排在前面那位就會把這一輪兩個
    // 同步搜尋的額度用光,於是走不通的那位兩個方向都是 null，但只有早上那條
    // 是**確定**沒有路的。
    const { loop, inner, stranded } = makeCity({ worker: false });
    loop.commuteCache.bumpGeneration();
    loop.commuteCache.markUnroutable(MORNING);

    inner.advanceCommuteFill();

    expect(loop.commuteCache.isUnroutable(EVENING), '前置條件:晚上那條要還沒問過').toBe(false);
    expect(loop.commuteCache.get(stranded)?.status, '只有一個方向確定沒有路就結案了')
      .not.toBe('failed');
  });

  it('should ask again after the road network changes', () => {
    // 蓋一條新路就可能接通。忘不掉的話，那位市民永遠不會再有通勤。
    const { loop, inner } = makeCity({ worker: true });
    inner.advanceCommuteFill();
    expect(loop.commuteCache.isUnroutable(MORNING), '前置條件:要先記起來').toBe(true);

    loop.markLaneGraphDirty([`5,${CORRIDOR_A_Y}`]);

    expect(loop.commuteCache.isUnroutable(MORNING), '路網變了還記著舊答案').toBe(false);
  });
});

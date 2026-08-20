import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { collectJobRelocationTriggers } from '../../citizen/JobRelocation';
import { CommuteCache } from '../../traffic/CommuteCache';
import { ZoneType } from '../../grid/types';
import type { LaneEdge } from '../../traffic/LaneGraph';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { useSeededRandom } from '../../__tests__/helpers/seededRandom';

/**
 * 載入之後，模擬讀到的城市要跟載入之前一樣大。
 *
 * `warmup` 有兩份工作：讓一部分人立刻上路，以及**替全體通勤人口建立路線快取**。
 * 第二份工作沒有名字，所以在把第一份工作最佳化掉的時候被一起丟了 —— 2 146 人的
 * 存檔實測，1 752 位有工作的市民有 1 377 位完全沒有快取條目，預測車流從 3 504
 * 掉到 353，道路平均噪音密度 4.70 → 2.74，最高那一級的 49 格全部歸零。
 *
 * 而且補不回來：車輛一到上限，`spawnCommuteVehicles` 立刻 break，不再寫任何
 * 快取條目 —— pathfinding worker 正常運作下實測跑 40 個 tick，停在 643／1 750
 * 就不動了。
 *
 * 所以這裡釘三件事：warmup 之後沒有人是「查無此人」、背景會把路線補完、
 * 以及沒算到的人不會被下游當成「算過了，結果是這樣」。
 */

/**
 * 一座住得下人的小城：棋盤路網，北半部住宅、南半部商業。
 *
 * 房子是必要的 —— 沒有住宅容量，`updateResidentialCapacity(0)` 會在跑 tick 的
 * 過程中把市民一路趕走（實測 60 tick 從 120 人掉到 62 人），量到的覆蓋率就不是
 * 覆蓋率而是人口曲線。
 */
function makeCity(citizenCount: number): GameState {
  const state = createGameState(24, 24);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      const onRoad = i % 3 === 0 || j % 3 === 0;
      if (!onRoad) continue;
      let flags = 0;
      if (j > 0 && (i % 3 === 0)) flags |= RoadDirection.NORTH;
      if (j < 23 && (i % 3 === 0)) flags |= RoadDirection.SOUTH;
      if (i > 0 && (j % 3 === 0)) flags |= RoadDirection.WEST;
      if (i < 23 && (j % 3 === 0)) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  // 路網的縫隙裡插房子：北半部小住宅（每棟 4 人），南半部小商店（每棟 4 個工作）。
  const homes: string[] = [];
  const works: string[] = [];
  for (let i = 1; i < 24; i += 3) {
    for (let j = 1; j < 24; j += 3) {
      if (j <= 10) {
        state.grid.setCell(i, j, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
        homes.push(`${i},${j}`);
      } else {
        state.grid.setCell(i, j, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
        works.push(`${i},${j}`);
      }
    }
  }
  // 全城只有 8 組起迄。真實城市是 2 146 人對 842 組，補完要跑好幾分鐘；這裡
  // 要的是「補得完」，而這座沒有任何公共服務的小城撐不了那麼久（實測 75 個
  // tick 之後沒有人還有工作），所以把配對數收到補完能在衰退之前結束。
  const PAIRS = 8;
  for (let n = 0; n < citizenCount; n++) {
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) break;
    c.homeId = homes[n % PAIRS]!;
    c.workplaceId = works[n % PAIRS]!;
  }
  return state;
}

/** 一個活著、會回應、但每一組起迄都交白卷的 pathfinding worker。 */
function createEmptyAnswerWorker(): Worker {
  const listeners: ((e: MessageEvent) => void)[] = [];
  const fake = {
    addEventListener(type: string, h: (e: MessageEvent) => void) {
      if (type === 'message') listeners.push(h);
    },
    removeEventListener() {},
    terminate() {},
    postMessage(msg: { type: string; batchId?: number; requests?: { id: number }[] }) {
      const reply = msg.type === 'INIT_GRAPH'
        ? { type: 'READY' }
        : {
            type: 'BATCH_RESULT', batchId: msg.batchId,
            results: (msg.requests ?? []).map(r => ({ id: r.id, variants: [] as number[][] })),
          };
      for (const l of listeners) l({ data: reply } as MessageEvent);
    },
  };
  return fake as unknown as Worker;
}

function makeLoop(state: GameState): SimulationLoop {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return loop;
}

function jobHolders(state: GameState) {
  return state.citizens.getCitizens().filter(c => c.homeId && c.workplaceId);
}

/** 有幾位有工作的市民，快取裡查不到任何條目。 */
function unknownCitizens(state: GameState, loop: SimulationLoop): number {
  return jobHolders(state).filter(c => !loop.commuteCache.get(c.id)).length;
}

/** 有幾位有工作的市民，快取裡有真正的路徑。 */
function readyCitizens(state: GameState, loop: SimulationLoop): number {
  return jobHolders(state).filter(c => loop.commuteCache.get(c.id)?.status === 'ready').length;
}

function totalRefCount(loop: SimulationLoop): number {
  let total = 0;
  loop.commuteCache.forEachRouteWithRefCount((_p, ref) => { total += ref; });
  return total;
}

describe('warmup 之後的快取覆蓋率', () => {
  // 覆蓋率是在固定的 tick 預算下量的，而那個預算會被建築成長、解僱、車輛抖動的
  // 骰子推來推去 —— 24 個種子跑下來有 2 個會讓「接得上路網的人」少算到一個。
  // 預算收緊是這幾條測試的訊號來源，不能放寬;能拿掉的是抽樣的干擾。
  useSeededRandom();

  it('should leave no commuting citizen unknown to the cache', async () => {
    const state = makeCity(120);
    const loop = makeLoop(state);
    await loop.warmup(0.2);

    expect(jobHolders(state).length, '城市裡沒有通勤人口，這條測試會是空的')
      .toBeGreaterThan(50);
    expect(unknownCitizens(state, loop), '有市民在快取裡查無此人')
      .toBe(0);
  });

  it('should not let a not-computed-yet citizen inflate predicted flow', async () => {
    // 「還不知道」不可以被當成車流算進去 —— 那會反過來高估。
    const state = makeCity(120);
    const loop = makeLoop(state);
    await loop.warmup(0);

    expect(unknownCitizens(state, loop), '沒有人被標記，這條測試會是空的').toBe(0);
    expect(totalRefCount(loop), '沒算過路徑的人被算進預測車流').toBe(0);
  });

  /**
   * 跑 tick 直到全體通勤人口都有路徑為止，回報是否等到。
   *
   * 比對的是**同一個時間點**的兩個數字：換工作與死亡會讓通勤人口一直變，拿
   * warmup 當下的人數去比對後來的覆蓋數，量到的會是人口變化不是覆蓋率。
   */
  function tickUntilCovered(state: GameState, loop: SimulationLoop, maxTicks: number) {
    let covered = false;
    let lastHolders = jobHolders(state).length;
    for (let t = 0; t < maxTicks && !covered; t++) {
      loop.tick();
      lastHolders = jobHolders(state).length;
      if (readyCitizens(state, loop) >= lastHolders) covered = true;
    }
    return { covered, holders: lastHolders, ready: readyCitizens(state, loop) };
  }

  it('should finish computing every commuter route in the background', async () => {
    // 車輛一到上限 `spawnCommuteVehicles` 就 break，所以靠生成車輛是補不完的
    // —— 實測 2 146 人的存檔跑到 643／1 750 就停住。補完這件事要有自己的來源。
    const state = makeCity(120);
    const loop = makeLoop(state);
    loop.setPathfindingWorker(createSyncFakeWorker());
    await loop.warmup(0.2);

    expect(readyCitizens(state, loop), '載入時就把所有人都算完了，這條測試會是空的')
      .toBeLessThan(jobHolders(state).length);

    const r = tickUntilCovered(state, loop, 40);
    expect(r.holders, '通勤人口跑光了，覆蓋率就沒有意義').toBeGreaterThan(50);
    expect(r.covered, `背景沒有把剩下的路線補完（${r.ready}／${r.holders}）`).toBe(true);
  });

  it('should not let unroutable citizens starve everyone else', async () => {
    // 接不上路網的人（房子離馬路太遠）每個 tick 都會被重新試一次。如果這種
    // 試法也算進預算，排在他們後面的人就永遠輪不到 —— 2 146 人的存檔實測，
    // 補完的速度從每個 tick 32 條掉到 2 條。
    const state = createGameState(24, 24);
    for (let x = 0; x < 24; x++) {
      let flags = RoadDirection.EAST | RoadDirection.WEST;
      if (x === 0) flags = RoadDirection.EAST;
      if (x === 23) flags = RoadDirection.WEST;
      state.grid.setCell(x, 12, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
    const homes: string[] = [];
    const works: string[] = [];
    for (let x = 1; x <= 8; x++) {
      state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      state.grid.setCell(x, 13, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      homes.push(`${x},11`);
      works.push(`${x},13`);
      // 離馬路 11 格的孤島住宅 —— 路網上根本沒有它的出入口
      state.grid.setCell(x, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    }

    // 接不上的人排在前面，正常人排在後面。數量要夠多 —— 每個 tick 的名額是
    // 32，人少的話輪轉自己就繞過去了，量不出「白試也要扣名額」的代價。
    for (let n = 0; n < 400; n++) {
      const c = state.citizens.createCitizen({ age: 100 })!;
      c.homeId = `${1 + (n % 8)},0`;
      c.workplaceId = works[n % works.length]!;
    }
    const normal: number[] = [];
    for (let n = 0; n < 24; n++) {
      const c = state.citizens.createCitizen({ age: 100 })!;
      c.homeId = homes[n % homes.length]!;
      c.workplaceId = works[n % works.length]!;
      normal.push(c.id);
    }

    const loop = makeLoop(state);
    loop.setPathfindingWorker(createSyncFakeWorker());
    await loop.warmup(0);   // 一台車都不生成，覆蓋率只能靠背景補完
    // 4 個 tick：8 組起迄、16 條路線，健康的話兩個 tick 就排完了（實測每一顆種子
    // 都是 2）。留一倍餘裕，而白試也扣名額的話速度會掉到每個 tick 兩條，16 條要
    // 八個 tick —— 那個差距正是這條測試要抓的。
    //
    // 原本量的是第 12 個 tick，那超過了。這座沒有服務的小城從第 5 個 tick 左右
    // 開始解僱市民，被解僱的人快取條目就沒了 —— 量到的是解僱不是覆蓋率，而且
    // 24 顆種子裡有 2 顆會剛好少一個人（23／24），長期都被當成偶發在忍。
    for (let t = 0; t < 4; t++) loop.tick();

    const covered = normal.filter(id => loop.commuteCache.get(id)?.status === 'ready').length;
    expect(covered, `接得上路網的人被前面接不上的人卡住（${covered}／${normal.length}）`)
      .toBe(normal.length);
  });

  it('should fill routes when the worker answers but never finds a path', async () => {
    // worker 不是「有」或「沒有」兩種狀態。它可以活著、可以回應，而每一組起迄
    // 都回傳空的。把它當依賴的話，補完永遠停在排隊。
    const state = makeCity(120);
    const loop = makeLoop(state);
    loop.setPathfindingWorker(createEmptyAnswerWorker());
    await loop.warmup(0);   // 一條路線都不預先算，補完是唯一的來源

    const r = tickUntilCovered(state, loop, 40);
    expect(r.holders, '通勤人口跑光了，覆蓋率就沒有意義').toBeGreaterThan(50);
    expect(r.covered, `worker 交白卷就補不完（${r.ready}／${r.holders}）`).toBe(true);
  });

  it('should fill routes without a pathfinding worker', async () => {
    // 生產環境沒有 COOP/COEP 就沒有 SharedArrayBuffer，也就沒有 worker
    // （`Game.ts` 建不起來時是靜靜吞掉的）。這個 loop 從頭到尾沒裝過 worker，
    // 補完必須照樣完成。
    const state = makeCity(120);
    const loop = makeLoop(state);
    await loop.warmup(0.2);

    const r = tickUntilCovered(state, loop, 40);
    expect(r.holders, '通勤人口跑光了，覆蓋率就沒有意義').toBeGreaterThan(50);
    expect(r.covered, `沒有 worker 就補不完（${r.ready}／${r.holders}）`).toBe(true);
  });
});

describe('下游怎麼看待「還沒算」的市民', () => {
  const CONFIG = { manhattanFallback: 15, happinessThreshold: 35 };

  function relocationPool(route: { status: 'pending' | 'ready'; morningPath: LaneEdge[] | null } | null) {
    const state = createGameState(24, 24);
    const c = state.citizens.createCitizen({ age: 100 })!;
    c.homeId = '1,1';
    c.workplaceId = '20,20';   // 曼哈頓距離 38，遠超過 15 的門檻
    c.happiness = 80;          // 不快樂不是這裡要測的觸發原因

    const cache = new CommuteCache();
    if (route) {
      cache.set(c.id, {
        citizenId: c.id, homeId: c.homeId, workplaceId: c.workplaceId,
        morningPath: route.morningPath, eveningPath: null,
        status: route.status, generation: cache.roadGeneration,
      });
    }
    const candidates = [
      { pos: '20,20', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
      { pos: '2,2', capacity: 10, zoneType: ZoneType.COMMERCIAL_LOW },
    ];
    const { urgent, nonUrgent } = collectJobRelocationTriggers(
      [c], candidates, cache, CONFIG);
    return urgent.length + nonUrgent.length;
  }

  it('should judge a citizen the same way whether or not the route is computed', () => {
    // 換工作看的是通勤要花多久，與「系統算好那條路線了沒」無關。
    //
    // 這兩個以前會走到不同的規則：沒有快取條目走曼哈頓距離、有條目走路徑長度。
    // 於是把載入時的快取覆蓋率補滿之後，所有人都換了一套規則 —— 而那一套的
    // 門檻永遠不成立，整個機制就靜靜地停擺了（見 JobRelocationTrigger.test.ts）。
    expect(relocationPool(null), '查無此人卻沒有進換工作名單').toBe(1);
    expect(relocationPool({ status: 'pending', morningPath: null }), '還沒算好就被放過')
      .toBe(1);
  });
});

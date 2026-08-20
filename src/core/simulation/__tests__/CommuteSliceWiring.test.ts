import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { PolicyType } from '../../district/types';
import type { CommuteStats } from '../../citizen/CommuteStats';

/**
 * 通勤統計改成**輪流**算:每個 tick 算一片，`N` 個 tick 輪完一圈，每個人的值存著。
 * 統計從存下來的**全體**值加總 —— 不是抽樣。
 *
 * ### 為什麼不能抽樣
 *
 * 1. `chargedDriversByDistrict` 直接決定壅塞費**收入**。抽樣等於用抽樣估市府收入，
 *    玩家的錢會因為抽到誰而抖。
 * 2. 固定抽 k 個人是**系統性偏差**，不是隨機誤差 —— 抽到的人剛好都在附近上班的話，
 *    那棟樓永遠顯示錯的數字，而且不會自己修正。
 *
 * 輪流兩個問題都沒有:每個人遲早都會被算到，統計蓋的是全體。
 */

interface Internals {
  advanceCommuteSlice(): void;
  getCommuteStatsVersion(): number;
  refreshCommuteStats(): void;
  rebuildAllCommuteRecords(): void;
  commuteRecords: Map<number, unknown>;
  getCommuteStats(): CommuteStats;
}

const N = SIMULATION.MEDIUM_TICK_INTERVAL;

/**
 * 住商分散在路線兩端，通勤時間才會有分布，不會全部一樣。
 *
 * **一定要有一個收費區。** 沒有的話 `chargedDriversByDistrict` 兩邊都是空 Map，
 * 「全量與分片相同」那條比的就是空比空 —— 而那一項正是決定壅塞費收入的數字。
 */
function city(citizens: number): GameState {
  const state = createGameState(40, 40);
  for (let x = 0; x < 40; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  const homes = ['2,2', '10,2', '20,2', '30,2'];
  const works = ['5,2', '15,2', '25,2', '35,2'];
  for (const h of homes) state.grid.setCell(+h.split(',')[0]!, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
  for (const w of works) state.grid.setCell(+w.split(',')[0]!, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100, homeId: homes[i % homes.length]!, workplaceId: works[(i * 3) % works.length]!,
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 2);

  // 收費區蓋住右半邊的公司，所以只有一部分通勤者會付過路費 —— 全付或全不付
  // 的話，把 districtId 寫死成常數也能讓測試通過。
  const d = state.districts.createDistrict('Downtown');
  for (let x = 22; x < 40; x++) {
    for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(d.id, x, y);
  }
  state.policies.setPolicyLevel(d.id, PolicyType.CONGESTION_CHARGE, 1);
  return state;
}

/** 先跑幾個 tick 讓路網圖、可及性圖建起來，再直接驅動要測的部分。 */
function primed(citizens: number) {
  const state = city(citizens);
  const loop = new SimulationLoop(state);
  for (let i = 0; i < 3; i++) loop.tick();
  return { state, loop, inner: loop as unknown as Internals };
}

/** 只比得出來的欄位 —— `worst` 是物件陣列，逐欄比較訊息才看得懂。 */
function comparable(s: CommuteStats) {
  return {
    sampled: s.sampled, average: s.average, median: s.median,
    overThreshold: s.overThreshold, buckets: s.buckets, byMode: s.byMode,
    byHome: [...s.byHome].sort(), charged: [...s.chargedDriversByDistrict].sort(),
  };
}

describe('通勤統計的輪流計算', () => {
  it('should produce the same stats as computing everyone at once', () => {
    // 這是整個設計的判準。輪完一圈之後，統計必須與「一次算完全城」逐欄相同 ——
    // 不是接近，是相同。抽樣做不到這件事，輪流做得到。
    const { loop, inner } = primed(400);

    inner.rebuildAllCommuteRecords();
    inner.refreshCommuteStats();
    const atOnce = comparable(loop.getCommuteStats());

    inner.commuteRecords.clear();
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();
    inner.refreshCommuteStats();
    const sliced = comparable(loop.getCommuteStats());

    expect(atOnce.sampled, '這座城市沒有人算得出通勤 —— 測試什麼都沒比')
      .toBeGreaterThan(0);
    // 空 Map 等於空 Map 是空比空。收入那一項要真的有數字才算比到。
    const chargedTotal = atOnce.charged.reduce((a, [, n]) => a + n, 0);
    expect(chargedTotal, 'fixture 沒有人付過路費 —— 收入那一項等於沒測')
      .toBeGreaterThan(0);
    expect(chargedTotal, '全部人都付過路費 —— 把 districtId 寫死成常數也會過')
      .toBeLessThan(atOnce.sampled);
    expect(sliced).toEqual(atOnce);
  });

  it('should recompute every citizen exactly once per cycle', () => {
    // 哨兵:每個 tick 之前把所有記錄換成同一個標記物件，跑完之後**不再是標記**的
    // 就是這個 tick 被重算的人。
    //
    // 第一版是數「新增的鍵」，那擋不住片數錯 —— 一輪 6 個 tick 的話每個人在 60 個
    // tick 裡被重算 10 次，但鍵只新增一次，測試照樣綠。突變驗證照出來的。
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();

    const SENTINEL = { time: -1, mode: 'SENTINEL', chargedDistrictId: null };
    const recomputed = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      for (const id of [...inner.commuteRecords.keys()]) {
        inner.commuteRecords.set(id, SENTINEL);
      }
      inner.advanceCommuteSlice();
      for (const [id, rec] of inner.commuteRecords) {
        if (rec !== SENTINEL) recomputed.set(id, (recomputed.get(id) ?? 0) + 1);
      }
    }

    const ids = state.citizens.getCitizens().map(c => c.id);
    expect(recomputed.size, `${ids.length} 位市民裡只有 ${recomputed.size} 位被重算過`)
      .toBe(ids.length);
    for (const [id, times] of recomputed) {
      expect(times, `市民 ${id} 一輪（${N} 個 tick）之內被重算了 ${times} 次`).toBe(1);
    }
  });

  it('should advance a slice every tick, not once per cycle', () => {
    // 每 60 個 tick 才推一片的話，輪完一圈要 3600 個 tick（150 個遊戲日）。
    const { loop, inner } = primed(400);
    inner.commuteRecords.clear();

    loop.tick();
    const afterOne = inner.commuteRecords.size;

    expect(afterOne, '一個 tick 之後一位市民都沒被算到 —— 沒有接到迴圈上')
      .toBeGreaterThan(0);
    expect(afterOne, '一個 tick 就把全城算完了 —— 沒有分片')
      .toBeLessThan(400);
  });

  it('should have a record for everyone right after a full rebuild', () => {
    // 冷啟動:載入之後如果只有 1/60 的人有記錄，壅塞費收入會被少算五十幾倍。
    const { state, inner } = primed(400);
    inner.commuteRecords.clear();
    inner.rebuildAllCommuteRecords();

    const withCommute = state.citizens.getCitizens().filter(c => c.homeId && c.workplaceId);
    expect(withCommute.length).toBeGreaterThan(0);
    for (const c of withCommute) {
      expect(inner.commuteRecords.has(c.id), `市民 ${c.id} 在全量重建之後還是沒有記錄`)
        .toBe(true);
    }
  });

  it('should give everyone a record on the very first tick', () => {
    // 冷啟動走的是真的 tick 路徑，不是測試直接呼叫全量重建。這一條擋的是
    // 「第一個 tick 只算了 1/60」—— 壅塞費收入會被少算五十幾倍。
    const state = city(400);
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as Internals;

    loop.tick();

    const withCommute = state.citizens.getCitizens().filter(c => c.homeId && c.workplaceId);
    expect(withCommute.length).toBeGreaterThan(0);
    expect(inner.commuteRecords.size, '第一個 tick 之後不是每個人都有記錄')
      .toBe(withCommute.length);
  });

  it('should drop the record of anyone who stopped commuting', () => {
    // 丟了工作的人如果留著舊記錄，他會一直被算成還在通勤 —— 圖層、面板、
    // 壅塞費收入全部跟著錯，而且沒有東西會把它修回來。
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();

    const victim = state.citizens.getCitizens()[0]!;
    expect(inner.commuteRecords.has(victim.id)).toBe(true);
    victim.workplaceId = null;

    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    expect(inner.commuteRecords.has(victim.id), '沒工作的人還留著通勤記錄')
      .toBe(false);
  });

  it('should clear out records of the departed without touching the living', () => {
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();

    const all = state.citizens.getCitizens();
    const gone = new Set(all.slice(0, 350).map(c => c.id));
    const staying = all.slice(350).map(c => c.id);
    state.citizens.removeCitizens(gone);

    // 整理排在開輪那一刻，所以保證是「一輪之內」不是「立刻」。
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    for (const id of gone) {
      expect(inner.commuteRecords.has(id), `遷出的市民 ${id} 的記錄沒清掉`).toBe(false);
    }
    for (const id of staying) {
      expect(inner.commuteRecords.has(id), `還在城裡的市民 ${id} 記錄被清掉了`).toBe(true);
    }
  });

  it('should get the charged drivers all the way into the published stats', () => {
    // **記錄有了不等於統計看得見** —— 加總跑的是另一個節奏。其他測試都直接呼叫
    // `refreshCommuteStats()`，跳過了排程;這一條走真的 tick，一路驗到發布出去
    // 的那份:估算 → 記錄 → 加總 → `getCommuteStats()`。
    //
    // 盯著付過路費的人數而不是通勤人數:那是決定壅塞費**收入**的數字，斷在哪一段
    // 都是收不到錢。
    const state = city(400);
    const loop = new SimulationLoop(state);

    loop.tick();

    const published = loop.getCommuteStats();
    const charged = [...published.chargedDriversByDistrict.values()]
      .reduce((a, b) => a + b, 0);
    expect(charged, '付過路費的人數沒有進到發布出去的統計 —— 壅塞費收不到錢')
      .toBeGreaterThan(0);
    expect(charged, '全城都在付 —— 收費區沒有真的在篩人').toBeLessThan(published.sampled);
  });

  it('should publish on its own schedule, not every tick', () => {
    // 加總每 60 個 tick 才發布一次。每個 tick 都發布的話 10 萬人要多付 24 毫秒 ×60;
    // 而如果**永遠不再**發布，市民的值一直在更新、玩家看到的卻是開局那一份。
    //
    // 用版本號而不是統計內容 —— 這個 fixture 沒有電、水、服務，建築撐不過 60 個
    // tick 就被廢棄了，內容會歸零而版本號不受影響。
    const state = city(400);
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as Internals;

    // 排程是第 1 個 tick（開局全量）與之後的 `(tick - 3) % 60 === 0`，
    // 也就是第 3、63、123…… 從第 3 個之後開始數。
    while (state.clock.tick < 3) loop.tick();
    const afterFirst = inner.getCommuteStatsVersion();

    while (state.clock.tick < N + 2) loop.tick();
    expect(inner.getCommuteStatsVersion(),
      `第 4 到第 ${N + 2} 個 tick 之間又發布了 —— 加總不該每個 tick 跑`)
      .toBe(afterFirst);

    while (state.clock.tick < N + 3) loop.tick();
    expect(inner.getCommuteStatsVersion(),
      `第 ${N + 3} 個 tick 該發布卻沒有 —— 統計會永遠停在開局那一份`)
      .toBe(afterFirst + 1);
  });

  it('should pick up citizens who moved in, within two cycles', () => {
    // 每一輪開頭要重新分桶。只分一次的話新搬進來的人**永遠**不會被算到 ——
    // 圖層上那棟樓的顏色會停在舊住戶的數字，而且不會有東西把它修回來。
    //
    // 為什麼是兩輪不是一輪:中途搬進來的人要等下一輪開頭才進得了桶，進去之後還要
    // 等自己那一片輪到。改動前是一輪（每 60 個 tick 整城重算）。
    //
    // **同樣的兩輪落後適用於所有改動**，不只新住戶 —— 搬家、換工作、開關條例都一樣:
    // 記錄要等自己那片輪到（最多一輪），加總又是另一個節奏（最多再一輪）。見
    // `advanceCommuteSlice()` 的說明。
    const { state, inner } = primed(400);
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    const before = new Set(state.citizens.getCitizens().map(c => c.id));
    for (let i = 0; i < 50; i++) {
      state.citizens.restoreCitizen({ age: 100, homeId: '10,2', workplaceId: '25,2' });
    }
    const arrivals = state.citizens.getCitizens().filter(c => !before.has(c.id));
    expect(arrivals.length).toBe(50);

    for (let i = 0; i < N * 2; i++) inner.advanceCommuteSlice();

    for (const c of arrivals) {
      expect(inner.commuteRecords.has(c.id), `新搬進來的市民 ${c.id} 過了兩輪還是沒被算到`)
        .toBe(true);
    }
  });

  it('should clear every record within one cycle of the city emptying', () => {
    // 城市被清空（砍光、讀另一份存檔）之後，上一座城市的記錄不該一直佔著記憶體。
    //
    // 保證是「**一輪之內**」不是「立刻」:桶在開輪時才重建，一輪之內它還握著已經
    // 離開的人。讀存檔那條路不受影響 —— `rebuildAllCommuteRecords()` 當場清空。
    const { state, inner } = primed(400);
    inner.rebuildAllCommuteRecords();
    expect(inner.commuteRecords.size).toBeGreaterThan(0);

    state.citizens.removeCitizens(new Set(state.citizens.getCitizens().map(c => c.id)));
    for (let i = 0; i < N; i++) inner.advanceCommuteSlice();

    expect(inner.commuteRecords.size, '空了一整輪還留著上一座城市的通勤記錄').toBe(0);
  });

  it('should not let citizens who left the city keep counting', () => {
    // 記錄是快取，加總走的是**還活著的名單** —— 死掉、遷出的人拿不到票。
    const { state, loop, inner } = primed(400);
    inner.rebuildAllCommuteRecords();
    inner.refreshCommuteStats();
    const before = loop.getCommuteStats().sampled;

    const gone = state.citizens.getCitizens().slice(0, 100).map(c => c.id);
    state.citizens.removeCitizens(new Set(gone));
    inner.refreshCommuteStats();

    expect(loop.getCommuteStats().sampled, '遷出的人還在統計裡')
      .toBe(before - gone.length);
  });
});

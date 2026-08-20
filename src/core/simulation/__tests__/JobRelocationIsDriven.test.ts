import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * 換工作那一輪**在一個 tick 之內跑完**，每 `JOB_RELOCATION_INTERVAL` 個 tick 一次。
 *
 * 這一條擋的是「呼叫被刪掉」——換工作會完全靜默地停擺，而不會有任何東西壞掉。
 *
 * 它曾經是切片跑的（每個 tick 推 2 次），那是 BUG-109 的止痛藥。治本（工作距離
 * 快取）做完之後整輪只要 7.7 毫秒，而切片器要 503 個 tick 才跑得完一輪 ——
 * 10 萬人時 9 478 個 tick，換工作等於是關掉的。止痛藥已經拿掉。
 */

type Internals = { runJobRelocation(): void };

function spiedLoop() {
  const state = createGameState(8, 8);
  const loop = new SimulationLoop(state);
  const inner = loop as unknown as Internals;
  const ticksRun: number[] = [];
  const orig = inner.runJobRelocation.bind(inner);
  inner.runJobRelocation = () => { ticksRun.push(state.clock.tick); orig(); };
  return { state, loop, ticksRun };
}

describe('the loop drives job relocation', () => {
  it('should run it once per JOB_RELOCATION_INTERVAL', () => {
    const { loop, ticksRun } = spiedLoop();
    const span = SIMULATION.JOB_RELOCATION_INTERVAL * 2;
    for (let i = 0; i < span; i++) loop.tick();

    expect(ticksRun.length, `${span} 個 tick 裡跑了 ${ticksRun.length} 次`).toBe(2);
    expect(ticksRun[1]! - ticksRun[0]!, '兩輪之間的間隔不對')
      .toBe(SIMULATION.JOB_RELOCATION_INTERVAL);
  });

  it('should not leave any cross-tick state behind', () => {
    // 切片器留著跨 tick 的名單，而那份名單會過期 —— 候選工作地被拆、市民死亡遷出
    // （BUG-331 那一整類）。一個 tick 內做完就沒有那個視窗。
    const { loop } = spiedLoop();
    for (let i = 0; i < SIMULATION.JOB_RELOCATION_INTERVAL + 5; i++) loop.tick();

    const inner = loop as unknown as Record<string, unknown>;
    expect(inner['jobRelocationSlicer'], 'jobRelocationSlicer 還在 —— 切片又回來了')
      .toBeUndefined();
  });

  it('should have no slice budget constant left', () => {
    // 常數留著的話，下一個人會以為還要切片。
    expect((SIMULATION as Record<string, unknown>)['JOB_RELOCATION_SLICE'],
      'JOB_RELOCATION_SLICE 還在').toBeUndefined();
  });
});

describe('換工作之後的通勤快取', () => {
  it('should drop the cached route of anyone who changed job', () => {
    // 不清的話那個人會一直照著**舊公司**的路線通勤 —— 圖層、統計、車輛生成全部
    // 跟著錯，而且要等到快取自然失效才會修正。
    const state = createGameState(40, 40);
    for (let x = 0; x < 40; x++) {
      state.grid.setCell(x, 1, {
        roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
      });
    }
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 6 });
    // 遠得會觸發「通勤太久」的公司，以及家旁邊的一個空缺。
    state.grid.setCell(30, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    state.grid.setCell(4, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    for (let i = 0; i < 20; i++) {
      // 快樂度壓在門檻（35）以下，觸發條件才明確 —— 不必依賴通勤時間估得出來。
      state.citizens.restoreCitizen({
        age: 100, homeId: '2,2', workplaceId: '30,2', happiness: 10,
      });
    }
    state.citizens.updateResidentialCapacity(200);

    const loop = new SimulationLoop(state);
    const inner = loop as unknown as {
      runJobRelocation(): void;
      commuteCache: { remove(id: number): void };
    };
    const removed: number[] = [];
    const origRemove = inner.commuteCache.remove.bind(inner.commuteCache);
    inner.commuteCache.remove = (id: number) => { removed.push(id); origRemove(id); };

    const before = new Map(state.citizens.getCitizens().map(c => [c.id, c.workplaceId]));
    inner.runJobRelocation();
    const switched = state.citizens.getCitizens()
      .filter(c => before.get(c.id) !== c.workplaceId).map(c => c.id);

    expect(switched.length, '這個場景沒有人換工作 —— 測試什麼都沒測到')
      .toBeGreaterThan(0);
    for (const id of switched) {
      expect(removed, `市民 ${id} 換了工作，通勤快取卻沒清`).toContain(id);
    }
  });
});

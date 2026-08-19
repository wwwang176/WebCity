import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';
import { ZoneType } from '../../grid/types';

/**
 * 通勤路線不進存檔，讀檔後要重算。每個 tick 的預算是 32 個排隊、2 次自己算 ——
 * 但預算用完之後用的是 `continue` 而不是 `break`，**整份名單還是會掃完**。
 *
 * 玩家存檔實測（人口 12 351）:進遊戲後前 11 秒，`advanceCommuteFill` 吃掉
 * `update()` 的 46–66%，第 12 秒掉到 2%（BUG-329）。真正花時間的不是那 2 條路，
 * 是那一萬多次「看過、沒事做」。
 *
 * 而且迴圈每個 tick 都從名單開頭重跑，排在後面的市民要等前面的人全部 settled
 * 才輪得到 —— 游標式續掃兩件事一起解決。
 */

function makeCity(citizenCount: number): GameState {
  const state = createGameState(24, 24);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      if (i % 3 !== 0 && j % 3 !== 0) continue;
      let flags = 0;
      if (j > 0 && i % 3 === 0) flags |= RoadDirection.NORTH;
      if (j < 23 && i % 3 === 0) flags |= RoadDirection.SOUTH;
      if (i > 0 && j % 3 === 0) flags |= RoadDirection.WEST;
      if (i < 23 && j % 3 === 0) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
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
  for (let n = 0; n < citizenCount; n++) {
    const c = state.citizens.createCitizen({ age: 100 });
    if (!c) break;
    c.homeId = homes[n % homes.length]!;
    c.workplaceId = works[n % works.length]!;
  }
  return state;
}

type Inner = {
  advanceCommuteFill(): void;
  commuteFillCursor: number;
  commuteFillScanned: number;
};

function makeLoop(state: GameState): { loop: SimulationLoop; inner: Inner } {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  return { loop, inner: loop as unknown as Inner };
}

const N = SIMULATION.COMMUTE_FILL_SCAN_PER_TICK;

describe('補通勤路線的游標', () => {
  it('should look at no more citizens than its scan budget', () => {
    // 這是整件事的重點。全部看過一遍的話，答案完全一樣 —— 只是每個 tick 多燒掉
    // 一萬多次「看過、沒事做」，而那正是玩家進遊戲頭十秒感覺到的。
    const state = makeCity(N * 3);
    const { inner } = makeLoop(state);
    expect(state.citizens.getPopulation(), '前置條件:人數要多於掃描預算')
      .toBeGreaterThan(N);

    inner.advanceCommuteFill();
    expect(inner.commuteFillScanned, '一個 tick 就把整份名單掃完了').toBe(N);
  });

  it('should carry on from where it stopped', () => {
    // 每個 tick 都從頭掃的話，排在後面的市民要等前面的人全部 settled 才輪得到。
    const { inner } = makeLoop(makeCity(N * 3));
    inner.advanceCommuteFill();
    const after1 = inner.commuteFillCursor;
    inner.advanceCommuteFill();
    expect(after1, '第一個 tick 之後游標沒有前進').toBe(N);
    expect(inner.commuteFillCursor, '第二個 tick 又從頭開始掃').toBe(N * 2);
  });

  it('should wrap around to the start', () => {
    // 繞回去才叫輪流。掃到底就停住的話，後面新來的市民永遠補不到。
    const { inner } = makeLoop(makeCity(N + 5));
    inner.advanceCommuteFill();
    inner.advanceCommuteFill();
    expect(inner.commuteFillCursor, '掃到名單尾端沒有繞回開頭').toBeLessThan(N);
  });

  it('should still reach everyone, including the ones at the far end', () => {
    // 省時間不能省掉正確性:轉夠多圈之後，每個人都要被看過。
    const count = N * 2 + 7;
    const { inner } = makeLoop(makeCity(count));
    const seen = new Set<number>();
    const start = inner.commuteFillCursor;
    for (let t = 0; t < 6; t++) {
      const from = inner.commuteFillCursor;
      inner.advanceCommuteFill();
      for (let k = 0; k < inner.commuteFillScanned; k++) seen.add((from + k) % count);
    }
    expect(seen.size, '轉了六圈還有人沒被看過').toBe(count);
    expect(start).toBe(0);
  });

  it('should step past a citizen it has nothing to do for', () => {
    // 沒有工作的人也要往前走。游標卡在他身上的話，後面的人永遠輪不到 ——
    // 而每個人都有家有工作的測資看不出這件事。
    const state = makeCity(N + 20);
    const { inner } = makeLoop(state);
    const first = state.citizens.getCitizens()[0]!;
    first.workplaceId = null;

    inner.advanceCommuteFill();
    expect(inner.commuteFillCursor, '沒事可做的那一位把游標黏住了').toBe(N);
  });

  it('should not read past the end when citizens died since last tick', () => {
    // 游標記的是名單位置，而名單會縮短。上次停在第 1024 位、這次只剩 30 人的話，
    // 讀到的是 undefined —— 崩在 `c.homeId` 上。
    const state = makeCity(N * 2);
    const { inner } = makeLoop(state);
    inner.advanceCommuteFill();
    expect(inner.commuteFillCursor, '前置條件:游標要停在後面').toBe(N);

    const ids = state.citizens.getCitizens().map(c => c.id).slice(30);
    state.citizens.removeCitizens(new Set(ids));
    expect(state.citizens.getPopulation(), '前置條件:人數要少於游標').toBeLessThan(N);

    expect(() => inner.advanceCommuteFill(), '名單縮短之後讀到名單外').not.toThrow();
    expect(inner.commuteFillCursor).toBeLessThan(state.citizens.getPopulation());
  });

  it('should cope with a list shorter than the budget', () => {
    const { inner } = makeLoop(makeCity(3));
    inner.advanceCommuteFill();
    expect(inner.commuteFillScanned, '看的人比名單還多').toBeLessThanOrEqual(3);
    inner.advanceCommuteFill();   // 不該爆掉，也不該卡在名單外
    expect(inner.commuteFillCursor).toBeLessThan(3);
  });
});

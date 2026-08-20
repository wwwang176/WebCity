import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * 換房子那一輪原本擠在中速塊的那一個 tick 裡跑完 —— 12 萬人實測 195ms，而速度 1
 * 的一個 tick 只有 250ms。
 *
 * 這裡釘的是**接線**:一輪真的被攤開了，而且上一輪沒跑完之前不會開新的一輪
 * （兩輪交錯的話 `occupancy` 是共用的，後面那一輪會看到半套的狀態）。
 */

/** 高稅率讓大家不開心（快樂度門檻是 35），再給兩種等級的住宅讓他們有得搬。 */
function unhappyCity(citizens: number): GameState {
  const state = createGameState(40, 40);
  for (let x = 0; x < 40; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  state.taxRates.residential = 0.29;
  // 一排住宅，等級交錯 —— 分數差得夠開才有人想搬。等級是從 buildingId 來的:
  // 1 = Small House（level 1）、3 = Large House（level 3）。
  for (let x = 2; x < 20; x++) {
    state.grid.setCell(x, 2, {
      zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: x % 2 === 0 ? 1 : 3,
    });
  }
  state.grid.setCell(25, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100, homeId: `${2 + (i % 18)},2`, workplaceId: '25,2', happiness: 10,
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

/** 中速塊在 (tick - 2) % 60 === 0 那些 tick 開輪。 */
function isRoundStart(tick: number): boolean {
  return tick >= 2 && (tick - 2) % SIMULATION.MEDIUM_TICK_INTERVAL === 0;
}

describe('換房子的接線', () => {
  it('should spread one round over many ticks instead of one', () => {
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);

    let ticksInFlight = 0;
    let maxPending = 0;
    let maxBudget = 0;
    for (let t = 0; t < SIMULATION.MEDIUM_TICK_INTERVAL; t++) {
      loop.tick();
      const { budget, pending } = loop.lastHousingRelocation;
      if (pending > 0) {
        ticksInFlight++;
        maxPending = Math.max(maxPending, pending);
        maxBudget = Math.max(maxBudget, budget);
      }
    }
    expect(maxPending, '一輪只有幾個人，攤不攤開看不出差別').toBeGreaterThan(50);
    // 這就是「不再擠在一個 tick」本身。改回一次跑完的話這個數字是 0。
    expect(ticksInFlight, `一輪只花了 ${ticksInFlight} 個 tick`)
      .toBeGreaterThan(SIMULATION.HOUSING_RELOCATION_SPREAD_TICKS / 3);
    // 一片的額度要遠小於整輪。
    expect(maxBudget, `一片就要做 ${maxBudget} 次，而一輪至少 ${maxPending} 次`)
      .toBeLessThan(maxPending / 10);
  });

  it('should not start a new round while one is still running', () => {
    // 開了的話兩輪的決定會交錯，而 occupancy 是共用的。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);

    let prev = 0;
    let jumpsOutsideRoundStart = 0;
    for (let t = 0; t < SIMULATION.MEDIUM_TICK_INTERVAL * 2; t++) {
      loop.tick();
      const { pending } = loop.lastHousingRelocation;
      if (pending > prev && !isRoundStart(state.clock.tick)) jumpsOutsideRoundStart++;
      prev = pending;
    }
    expect(jumpsOutsideRoundStart,
      `有 ${jumpsOutsideRoundStart} 個 tick 在上一輪跑完之前又開了新的一輪`).toBe(0);
  });

  it('should ignore a round-start that lands mid-round', () => {
    // 目前的常數（攤 50 個 tick、每 60 個 tick 開一輪）讓這件事不會自然發生，
    // 所以這裡直接叫它再開一輪。守衛拿掉的話名單會被換成全新的一份，pending
    // 跳回滿載 —— 而兩輪共用同一個 occupancy，後面那一輪看到的是半套的狀態。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    for (let t = 0; t < 6; t++) loop.tick();
    const midRound = loop.lastHousingRelocation.pending;
    expect(midRound, '這時候應該正在一輪的中間').toBeGreaterThan(0);

    (loop as unknown as { runRelocation(): void }).runRelocation();
    loop.tick();

    expect(loop.lastHousingRelocation.pending, '上一輪跑到一半又被開了一輪')
      .toBeLessThan(midRound);
  });

  it('should hand the running round a fresh occupancy count', () => {
    // 開輪時拍的入住數會過期 —— 這一輪橫跨幾十個 tick，中間移民與配房都在填房子。
    // 不換新的話會把人搬進其實已經住滿的樓。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const inner = loop as unknown as {
      housingRelocationSlicer: { refreshOccupancy(c: ReadonlyMap<string, number>): void } | null;
    };

    for (let t = 0; t < 3; t++) loop.tick();
    const slicer = inner.housingRelocationSlicer;
    expect(slicer, '這時候應該正在一輪的中間').not.toBeNull();

    let calls = 0;
    const orig = slicer!.refreshOccupancy.bind(slicer!);
    slicer!.refreshOccupancy = (c) => { calls++; orig(c); };
    for (let t = 0; t < SIMULATION.SLOW_TICK_INTERVAL * 2; t++) loop.tick();

    expect(calls, '一輪跑了兩個慢速週期，入住數一次都沒換新').toBeGreaterThan(0);
  });

  it('should still move somebody', () => {
    // 攤開之後一個人都搬不動的話，這一整套等於把功能關掉了。
    const state = unhappyCity(900);
    const loop = new SimulationLoop(state);
    const homesBefore = state.citizens.getCitizens().map(c => c.homeId);
    const ids = state.citizens.getCitizens().map(c => c.id);

    for (let t = 0; t < SIMULATION.MEDIUM_TICK_INTERVAL; t++) loop.tick();

    const now = new Map(state.citizens.getCitizens().map(c => [c.id, c.homeId]));
    let moved = 0;
    for (let i = 0; i < ids.length; i++) {
      const after = now.get(ids[i]!);
      if (after !== undefined && after !== homesBefore[i]) moved++;
    }
    expect(moved, '一輪跑完一個人都沒搬').toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { EducationLevel } from '../../citizen/types';

/**
 * 服務負載改成「先數成每一格幾個人，再去查」之後，**人數**必須真的一路傳到服務裡。
 *
 * `count` 是選填的（既有呼叫端不帶它），所以漏傳不會有型別錯誤 —— 整座城市的需求
 * 會靜靜地掉成「每棟樓一個人」。12 434 人住在 103 棟樓裡，那是一百二十分之一。
 *
 * 這裡攔截 SimulationLoop 送給服務的東西，而不是看服務算出來的負載率:負載率要
 * 設施通電又連得到路才不是 0，那些跟這條接縫無關。
 */

const HOME = '2,2';
const WORK = '6,2';

function city(citizens: number, education = EducationLevel.HIGH_SCHOOL): GameState {
  const state = createGameState(30, 30);
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(6, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({ age: 100, homeId: HOME, workplaceId: WORK, education });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

/** 跑滿兩輪慢速槽，確定第 4 槽跑過。 */
function runSlowCycles(loop: SimulationLoop): void {
  for (let i = 0; i < SIMULATION.SLOW_TICK_INTERVAL * 2; i++) loop.tick();
}

type Entry = { x: number; y: number; count?: number; weight?: number };

/** 蓋掉覆蓋判斷，攔下這座城市送進某個服務的條目。 */
function capture(
  state: GameState,
  service: { getCoverage: unknown },
  method: string,
): Entry[][] {
  const calls: Entry[][] = [];
  const s = service as unknown as Record<string, unknown>;
  s['getCoverage'] = () => true;
  s[method] = (...args: unknown[]) => {
    calls.push(...args.map(a => [...(a as Entry[])]));
  };
  return calls;
}

describe('服務負載的人數有傳下去', () => {
  it('should tell the hospital how many people live at each address', () => {
    const state = city(800);
    const calls = capture(state, state.health, 'updateLoads');
    runSlowCycles(new SimulationLoop(state));

    const last = calls[calls.length - 1]!;
    const home = last.find(e => e.x === 2 && e.y === 2);
    expect(home, '住宅那一格根本沒送進醫院').toBeDefined();
    expect(last.length, `一棟樓生出 ${last.length} 筆條目`).toBe(1);
    // 精確相等釘不住:索引是慢速槽 4 建的，到這裡又過了幾個 tick，中間有人生老病死。
    // 漏傳 count 的話這個數字會是 1，這個門檻擋得住。
    const pop = state.citizens.getPopulation();
    expect(home!.count! / pop, `醫院收到的人數是 ${home!.count}，城裡有 ${pop} 人`)
      .toBeGreaterThan(0.9);
    expect(home!.count! / pop).toBeLessThan(1.1);
  });

  it('should have a fresh index on the daily death tick, not slot 4 leftovers', () => {
    // 每日的死亡結算會呼叫 updateHospitalLoads，而它在慢速槽 5（移民、配房、換房子）
    // 之後 —— 拿槽 4 的索引會漏掉剛遷入的人、算進剛遷出的人。
    //
    // 讀檔更糟:在槽 4 之後、日界之前建立的 SimulationLoop，索引還是空的，醫院需求
    // 會被算成 0，死亡率拿到錯的低倍率。這裡就重現那個情況。
    const state = city(800);
    state.clock.tick = 23;          // 下一個 tick 就是日界（ticksPerDay = 24）
    const calls = capture(state, state.health, 'updateLoads');
    const loop = new SimulationLoop(state);
    loop.tick();
    expect(state.clock.tick, '沒有踩到日界').toBe(24);

    expect(calls.length, '日界那一個 tick 沒有更新醫院負載').toBeGreaterThan(0);
    const last = calls[calls.length - 1]!;
    const home = last.find(e => e.x === 2 && e.y === 2);
    expect(home, '住宅那一格根本沒送進醫院 —— 索引是空的').toBeDefined();
    const pop = state.citizens.getPopulation();
    expect(home!.count! / pop, `醫院收到 ${home!.count} 人，城裡有 ${pop} 人`)
      .toBeGreaterThan(0.9);
  });

  it('should scale the police demand weight with the headcount', () => {
    const small = city(100);
    const smallCalls = capture(small, small.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(small));
    const smallHome = smallCalls[smallCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    const big = city(800);
    const bigCalls = capture(big, big.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(big));
    const bigHome = bigCalls[bigCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    expect(smallHome.weight).toBeGreaterThan(0);
    // 漏乘人數的話兩邊都是「一棟樓一份需求」，比值會是 1。
    expect(bigHome.weight! / smallHome.weight!, `100 人 ${smallHome.weight} vs 800 人 ${bigHome.weight}`)
      .toBeGreaterThan(4);
  });

  it('should scale the fire demand weight with the headcount', () => {
    const small = city(100);
    const smallCalls = capture(small, small.fire, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(small));
    const smallHome = smallCalls[smallCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    const big = city(800);
    const bigCalls = capture(big, big.fire, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(big));
    const bigHome = bigCalls[bigCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    expect(smallHome.weight).toBeGreaterThan(0);
    expect(bigHome.weight! / smallHome.weight!).toBeGreaterThan(4);
  });

  it('should keep education apart inside one building for police', () => {
    // 合成一筆的時候只記人數、不管學歷的話，無學歷（權重 2.0）與大學（0.3）
    // 會被當成同一種。
    const none = city(400, EducationLevel.NONE);
    const noneCalls = capture(none, none.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(none));
    const noneHome = noneCalls[noneCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    const uni = city(400, EducationLevel.UNIVERSITY);
    const uniCalls = capture(uni, uni.police, 'updateStationLoads');
    runSlowCycles(new SimulationLoop(uni));
    const uniHome = uniCalls[uniCalls.length - 1]!.find(e => e.x === 2 && e.y === 2)!;

    expect(noneHome.weight!, '學歷完全沒有影響警力需求')
      .toBeGreaterThan(uniHome.weight! * 2);
  });

  it('should tell the schools how many students share an address', () => {
    const state = city(600, EducationLevel.NONE);
    // 全部設成在學中，才會走 enrolled 那一條（eligible 還要學校覆蓋得到）。
    for (const c of state.citizens.getCitizens()) c.educationProgress = 1;
    const calls = capture(state, state.education, 'updateSchoolLoads');
    runSlowCycles(new SimulationLoop(state));

    // 一次呼叫送兩個陣列（enrolled、eligible），`capture` 各收一筆。
    const enrolled = calls[calls.length - 2]!;
    const home = enrolled.find(e => e.x === 2 && e.y === 2);
    expect(home, '住宅那一格根本沒送進學校').toBeDefined();
    expect(home!.count, `學校收到 ${home!.count} 個學生`).toBeGreaterThan(500);
  });
});

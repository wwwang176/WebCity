import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { policyCost } from '../PolicyBilling';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { CitizenManager } from '../../citizen/CitizenManager';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * 買健康的兩種付法。
 *
 * 免費診所掏市府的錢，而且只保護醫院蓋得到的人 —— 醫院蓋不到的地方，人根本沒去
 * 看病，補助也就沒發出去。禁菸令幾乎不花錢，改成讓商家買單，而它對誰都有效:
 * 少抽一根菸不需要有人開診所。
 */

/** Small House（RESIDENTIAL_LOW）。 */
const HOUSE = 1;

/**
 * 暫時把某條條例的效果換掉。
 *
 * 真實的乘數（0.88 / 0.75）在一天之內量不出來 —— 死亡是逐人擲骰子的稀有事件。
 * 換成 0 之後「覆蓋範圍內不會有人死」是**確定的**，接線就驗得乾淨。
 *
 * 還原寫在 finally:tick 途中拋錯的話，被改過的表會留給同一個檔案後面的測試。
 */
function withEffect(type: PolicyType, tiers: PolicyEffect[], body: () => void): void {
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  try { body(); } finally { (POLICY_EFFECTS as Record<string, unknown>)[type] = saved; }
}

/**
 * 一座半邊有醫院、半邊沒有的城市，住的全是高齡者。
 *
 * 高齡是為了讓死亡在一天之內真的發生:成人每天 0.0005，250 歲的老人是
 * 0.006 × 3.5 ≈ 0.021，五百個人一天死十個上下。
 */
function agedCity(): { state: GameState; loop: SimulationLoop } {
  reseedRandom();
  const state = createGameState(60, 60);
  for (let x = 1; x < 59; x++) state.grid.setCell(x, 30, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 1; x < 59; x++) {
    state.grid.setCell(x, 31, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  const put = (x: number, y: number, w: number, h: number, id: number) => {
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) {
      state.grid.setCell(x + dx, y + dy, { buildingId: id });
    }
  };
  put(2, 28, 2, 2, 254);
  state.power.addPlant({ x: 2, y: 28, output: 1_000_000, pollution: 0, type: 'solar' });
  put(6, 28, 2, 2, 253);
  state.water.addPlant({ x: 6, y: 28, output: 1_000_000 });
  // 醫院擺在西半邊，覆蓋半徑只夠蓋到 x < 30 —— 東半邊刻意留白。
  //
  // 高度 3 的建築要從 y=27 起算，不然它的最後一列會蓋掉 y=30 的道路 —— 覆蓋是
  // 沿道路算的，路斷了就一格都蓋不到。
  put(14, 27, 2, 3, 250);
  state.health.addHospital(14, 27, 15, 100_000);

  const loop = new SimulationLoop(state);
  for (let x = 1; x < 59; x++) {
    for (let k = 0; k < 12; k++) {
      state.citizens.restoreCitizen({ age: 250, homeId: `${x},31` });
    }
  }
  // 服務的營運狀態與覆蓋是在各自的 slow slot 上算出來的，跑滿一輪（六個 tick）
  // 才會成立。把時鐘直接撥到月底／日底會跳過那幾個 slot，醫院就永遠沒有覆蓋。
  for (let i = 0; i < 6; i++) loop.tick();
  return { state, loop };
}

/** 跑到隔天的死亡判定，回報覆蓋內外各活下來幾個。 */
function survivorsAfterADay(state: GameState, loop: SimulationLoop): { covered: number; uncovered: number } {
  state.clock.tick = 23;
  loop.tick();
  let covered = 0, uncovered = 0;
  for (const c of state.citizens.getCitizens()) {
    const x = Number(c.homeId!.split(',')[0]);
    if (state.health.getCoverage(x, 31)) covered++; else uncovered++;
  }
  return { covered, uncovered };
}

useSeededRandom();

describe('免費診所', () => {
  it('should not change anything at all when it is off', () => {
    const o = new CityOrdinances();
    expect(o.getCoveredDeathRateMultiplier(), '沒開條例卻不是原值 1').toBe(1);
  });

  it('should cut deaths harder at the higher tier', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.FREE_CLINIC, 1);
    const light = o.getCoveredDeathRateMultiplier();
    o.setLevel(PolicyType.FREE_CLINIC, 2);
    expect(light, '第一級沒有降低死亡率').toBeLessThan(1);
    expect(o.getCoveredDeathRateMultiplier(), '第二級沒有比第一級更強').toBeLessThan(light);
  });

  it('should protect only the people a hospital can reach', () => {
    // 這是使用者的觀察:醫院蓋不到的人本來就沒在看病，診所也救不到他。
    //
    // 覆蓋內外的正向控制跟斷言寫在同一條裡。分成兩條的話，覆蓋恆為 0 的場景會讓
    // 「覆蓋內沒有人死」變成 0 === 0 而假通過。
    const { state, loop } = agedCity();
    const isCovered = (c: { homeId: string | null }) =>
      state.health.getCoverage(Number(c.homeId!.split(',')[0]), 31);
    const coveredBefore = state.citizens.getCitizens().filter(isCovered).length;
    const uncoveredBefore = state.citizens.getPopulation() - coveredBefore;
    expect(coveredBefore, '沒有人在醫院覆蓋範圍內，這條測試等於空轉').toBeGreaterThan(0);
    expect(uncoveredBefore, '沒有人在覆蓋範圍外，比不出差別').toBeGreaterThan(0);

    withEffect(PolicyType.FREE_CLINIC, [{ coveredDeathRate: 0, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.98 } }], () => {
      state.ordinances.setLevel(PolicyType.FREE_CLINIC, 1);
      const after = survivorsAfterADay(state, loop);
      expect(after.covered, '診所開到零死亡率，覆蓋範圍內卻還是有人死')
        .toBe(coveredBefore);
      expect(after.uncovered, '覆蓋範圍外一個都沒死，量不出差別')
        .toBeLessThan(uncoveredBefore);
    });
  });

  it('should be billed by the weighted patients it treats', () => {
    // 一座高齡城市的診所帳單要比一座年輕城市貴 —— 那正是這條條例最該讓玩家
    // 感覺到的差別。
    const young = scaleOf({ population: 1000, clinicPatients: 900 });
    const aged = scaleOf({ population: 1000, clinicPatients: 2400 });
    const cost = (s: typeof young) => policyCost(PolicyType.FREE_CLINIC, 2, s);
    expect(cost(young), '診所不收錢').toBeGreaterThan(0);
    expect(cost(aged), '高齡城市的診所帳單沒有比較貴').toBeGreaterThan(cost(young));
    expect(policyCost(PolicyType.FREE_CLINIC, 2, scaleOf({ population: 100_000 })),
      '一個病人都看不到卻還在收錢').toBe(0);
  });
});

describe('禁菸令', () => {
  it('should cut deaths for everyone, hospital or not', () => {
    // 少抽一根菸不需要有人開診所 —— 這是它跟免費診所的分界。
    const o = new CityOrdinances();
    o.setLevel(PolicyType.SMOKING_BAN, 1);
    expect(o.getDeathRateMultiplier(), '禁菸令沒有降低死亡率').toBeLessThan(1);
    expect(o.getCoveredDeathRateMultiplier(), '禁菸令跑到只保護覆蓋範圍那條線上了')
      .toBe(1);
  });

  it('should reach the death roll through the simulation loop', () => {
    const { state, loop } = agedCity();
    const before = state.citizens.getPopulation();
    withEffect(PolicyType.SMOKING_BAN, [{ deathRate: 0, revenueByZone: { [ZoneType.COMMERCIAL_LOW]: 0.88 } }], () => {
      state.ordinances.setLevel(PolicyType.SMOKING_BAN, 1);
      const after = survivorsAfterADay(state, loop);
      expect(after.covered + after.uncovered, '禁菸令開到零死亡率，卻還是有人死')
        .toBe(before);
    });
  });

  it('should make businesses pay instead of the treasury', () => {
    const o = new CityOrdinances();
    o.setLevel(PolicyType.SMOKING_BAN, 1);
    const banCost = o.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW);
    o.setLevel(PolicyType.SMOKING_BAN, 0);
    o.setLevel(PolicyType.FREE_CLINIC, 2);
    expect(banCost, '禁菸令沒有扣商業收入').toBeLessThan(1);
    expect(banCost, '禁菸令的商業代價沒有比免費診所重 —— 兩條就沒有分別了')
      .toBeLessThan(o.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW));
  });

  it('should cost the city almost nothing to enforce', () => {
    // 兩條都在買健康，差別是誰付錢。禁菸令只有稽查成本。
    const s = scaleOf({ population: 10_000, clinicPatients: 12_000 });
    expect(policyCost(PolicyType.SMOKING_BAN, 1, s), '禁菸令完全不用稽查?')
      .toBeGreaterThan(0);
    expect(policyCost(PolicyType.SMOKING_BAN, 1, s), '禁菸令花的錢沒有遠少於免費診所')
      .toBeLessThan(policyCost(PolicyType.FREE_CLINIC, 1, s) / 5);
  });
});

describe('死亡率的條例乘數', () => {
  it('should multiply the death roll', () => {
    // 直接對 deathTick 驗:乘數 0 是確定不死，乘數大到 1 是確定死 —— 不必靠機率。
    const mgr = new CitizenManager();
    for (let i = 0; i < 50; i++) mgr.restoreCitizen({ age: 250, homeId: `${i},0` });
    const dead = mgr.deathTick(() => ({ hospitalMult: 1, pollutionMult: 1, policyMult: 0 }));
    expect(dead.length, '乘數 0 卻還是有人死').toBe(0);
    expect(mgr.deathTick(() => ({ hospitalMult: 1, pollutionMult: 1, policyMult: 1e9 })).length,
      '乘數大到必死卻沒有人死').toBe(50);
  });
});

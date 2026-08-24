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
 * Two ways of paying for health.
 *
 * Free clinics come out of the treasury and protect only the people a hospital reaches: where no
 * hospital reaches, nobody attends and no subsidy is paid. The smoking ban costs almost nothing
 * and is paid for by businesses, and it works for everyone: smoking one cigarette fewer needs no
 * clinic.
 */

/** Small House (RESIDENTIAL_LOW). */
const HOUSE = 1;

/**
 * Temporarily replaces one ordinance's effects.
 *
 * The real multipliers, 0.88 and 0.75, are unmeasurable across one day: death is a rare event
 * rolled per citizen. At 0, "nobody inside coverage dies" is **certain** and the wiring can be
 * checked cleanly.
 *
 * The restore is in a `finally`: a throw during a tick would otherwise leave the modified table
 * to the rest of the file.
 */
function withEffect(type: PolicyType, tiers: PolicyEffect[], body: () => void): void {
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  try { body(); } finally { (POLICY_EFFECTS as Record<string, unknown>)[type] = saved; }
}

/**
 * A city with a hospital on one half and none on the other, populated entirely by the old.
 *
 * The age is there to make deaths happen within one day: an adult's daily probability is 0.0005,
 * while a 250-year-old's is 0.006 x 3.5, about 0.021, so five hundred people lose around ten a
 * day.
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
  // The hospital sits on the west side with a coverage radius reaching only x < 30, leaving the
  // east side deliberately uncovered.
  //
  // A building 3 cells tall starts at y=27, or its last row covers the road at y=30. Coverage
  // follows roads, and a broken road covers nothing at all.
  put(14, 27, 2, 3, 250);
  state.health.addHospital(14, 27, 15, 100_000);

  const loop = new SimulationLoop(state);
  for (let x = 1; x < 59; x++) {
    for (let k = 0; k < 12; k++) {
      state.citizens.restoreCitizen({ age: 250, homeId: `${x},31` });
    }
  }
  // A service's operational status and its coverage are computed on their own slow slots and
  // only hold after a full round of six ticks. Winding the clock straight to a month or day
  // boundary skips those slots and the hospital never gains coverage.
  for (let i = 0; i < 6; i++) loop.tick();
  return { state, loop };
}

/** Runs to the next day's death roll and reports survivors inside and outside coverage. */
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
    // Someone no hospital reaches was not attending anyway, and a clinic cannot save them.
    //
    // The positive control for inside and outside coverage lives in the same test. Split in two,
    // a scenario with zero coverage would make "nobody inside coverage died" a 0 === 0 that
    // passes falsely.
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
    // An ageing city's clinic bill should exceed a young city's, and that difference is the one
    // this ordinance should make the player feel.
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
    // Smoking one cigarette fewer needs no clinic, which is what separates this from free
    // clinics.
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
    // Both buy health and differ in who pays. The smoking ban costs only enforcement.
    const s = scaleOf({ population: 10_000, clinicPatients: 12_000 });
    expect(policyCost(PolicyType.SMOKING_BAN, 1, s), '禁菸令完全不用稽查?')
      .toBeGreaterThan(0);
    expect(policyCost(PolicyType.SMOKING_BAN, 1, s), '禁菸令花的錢沒有遠少於免費診所')
      .toBeLessThan(policyCost(PolicyType.FREE_CLINIC, 1, s) / 5);
  });
});

describe('死亡率的條例乘數', () => {
  it('should multiply the death roll', () => {
    // Checked against deathTick directly: a multiplier of 0 is certain survival and one large
    // enough to reach 1 is certain death, with no probability involved.
    const mgr = new CitizenManager();
    for (let i = 0; i < 50; i++) mgr.restoreCitizen({ age: 250, homeId: `${i},0` });
    const dead = mgr.deathTick(() => ({ hospitalMult: 1, pollutionMult: 1, policyMult: 0 }));
    expect(dead.length, '乘數 0 卻還是有人死').toBe(0);
    expect(mgr.deathTick(() => ({ hospitalMult: 1, pollutionMult: 1, policyMult: 1e9 })).length,
      '乘數大到必死卻沒有人死').toBe(50);
  });
});

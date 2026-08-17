import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { PolicyType } from '../types';
import { POLICY_SCOPE } from '../PolicyScope';
import { ZoneType } from '../../grid/types';

/**
 * 工業排放管制。
 *
 * 範圍是分區而不是全城:汙染源是逐格的工業格，好處與代價也都落在工業格上，
 * 「管哪一片工廠」是有意義的決策。套到全城會在沒有汙染問題的工業區白扣收入 ——
 * 照判準（全城套用永遠不會更糟才該是全城）它就不該是全城的。
 *
 * 乘數只作用在地面汙染。工廠的噪音來自機具，不是排放 —— 把噪音也一起降的話，
 * 這條條例就變成一顆萬用的「工業變乾淨」按鈕。
 */

/** Factory（INDUSTRIAL）。 */
const FACTORY = 13;

function industrialCity(): { state: GameState; loop: SimulationLoop; districtId: string } {
  const state = createGameState(40, 40);
  for (let x = 2; x < 38; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  // 兩座工廠，離得夠遠。擠成一排的話擴散會疊到上限（實測 195 封頂），開不開條例
  // 量到的都是同一個數字。
  state.grid.setCell(8, 11, { zoneType: ZoneType.INDUSTRIAL, buildingId: FACTORY });
  state.grid.setCell(30, 11, { zoneType: ZoneType.INDUSTRIAL, buildingId: FACTORY });
  const d = state.districts.createDistrict('Works');
  state.districts.addCellToDistrict(d.id, 8, 11);
  return { state, loop: new SimulationLoop(state), districtId: d.id };
}

function pollutionAt(level: number) {
  const { state, loop, districtId } = industrialCity();
  if (level > 0) {
    state.policies.setPolicyLevel(districtId, PolicyType.INDUSTRIAL_EMISSION_CONTROL, level);
  }
  for (let i = 0; i < 6; i++) loop.tick();
  // `getPollutionAt` 回傳的是共用的暫存物件（它自己的註解就寫著 callers must not
  // store the reference）—— 直接留住兩次呼叫的結果，兩個變數會指向同一個東西，
  // 量到的都是最後一次讀的那一格。
  const { ground: ig, noise: inoise } = state.pollution.getPollutionAt(8, 11);
  const { ground: og, noise: onoise } = state.pollution.getPollutionAt(30, 11);
  return {
    inside: { ground: ig, noise: inoise },
    outside: { ground: og, noise: onoise },
  };
}

describe('工業排放管制', () => {
  it('should clean up the ground inside the district that asked for it', () => {
    const plain = pollutionAt(0);
    expect(plain.inside.ground, '本來就沒有地面汙染，量不出改善').toBeGreaterThan(0);
    const managed = pollutionAt(3);
    expect(managed.inside.ground, '分區裡的地面汙染沒有下降')
      .toBeLessThan(plain.inside.ground);
  });

  it('should leave the rest of the map alone', () => {
    // 分區外的工廠照樣排放 —— 這是分區條例，不是全城的。
    const plain = pollutionAt(0);
    const managed = pollutionAt(3);
    expect(managed.outside.ground, '分區外的地面汙染也跟著降了')
      .toBe(plain.outside.ground);
  });

  it('should not touch noise', () => {
    // 機具的聲音不會因為裝了洗滌塔就變小。
    const plain = pollutionAt(0);
    const managed = pollutionAt(3);
    expect(plain.inside.noise, '本來就沒有噪音，量不出「沒有被動到」').toBeGreaterThan(0);
    expect(managed.inside.noise, '排放管制把噪音也一起降了').toBe(plain.inside.noise);
  });

  it('should get cleaner each tier', () => {
    const g = (lv: number) => pollutionAt(lv).inside.ground;
    expect(g(2), '第二級沒有比第一級乾淨').toBeLessThan(g(1));
    expect(g(3), '第三級沒有比第二級乾淨').toBeLessThan(g(2));
  });

  it('should be a district decision, paid for by the factories', () => {
    expect(POLICY_SCOPE[PolicyType.INDUSTRIAL_EMISSION_CONTROL], '排放管制被畫成全城條例')
      .toBe('district');
    const { state, districtId } = industrialCity();
    state.policies.setPolicyLevel(districtId, PolicyType.INDUSTRIAL_EMISSION_CONTROL, 3);
    expect(state.policies.getRevenueMultiplier(districtId, ZoneType.INDUSTRIAL), '工業沒有付代價')
      .toBeLessThan(1);
    expect(state.policies.getRevenueMultiplier(districtId, ZoneType.RESIDENTIAL_LOW), '住宅也被扣了')
      .toBe(1);
  });
});

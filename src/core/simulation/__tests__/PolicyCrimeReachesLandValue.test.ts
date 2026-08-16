import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';

/**
 * 效果表改了不等於模擬會讀。這條走完整條路:設政策 → 跑地價 → 讀回格子。
 * 只測 `PolicyManager` 的話，`SimulationLoop` 完全沒接也會全綠。
 *
 * 建築是**直接種進格子**的。`updateLandValue` 開頭就 `if (cell.buildingId === 0)
 * return`，而建築成長要求該格有電有水 —— 只畫道路與 zoning 的測試城市長不出任何
 * 東西，兩組都會拿到初始值，測試變成「相等」而不是「更低」。
 *
 * 只跑六個 tick:`updateLandValue` 在 tick 2 跑，六個 tick 夠了，而且短到不會被
 * 成長與遷居的隨機性汙染。
 */

/** Small Shop（COMMERCIAL_LOW）。 */
const SHOP = 7;

function landValueAt(withPolicy: boolean): number {
  const state = createGameState(30, 30);
  const loop = new SimulationLoop(state);
  for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 14; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
  }
  const d = state.districts.createDistrict('D');
  for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
  if (withPolicy) state.policies.setPolicyLevel(d.id, PolicyType.TOURISM, 1);

  for (let i = 0; i < 6; i++) loop.tick();
  return state.grid.getCell(10, 11)!.landValue;
}

describe('條例的犯罪代價真的進到地價', () => {
  it('should lower land value inside the district that took the policy', () => {
    const plain = landValueAt(false);
    // 正向控制:地價根本沒算的話兩組都是 0，`toBeLessThan` 也會是 false —— 但錯的
    // 理由完全不同，分開講才看得出來是哪一種壞。
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(landValueAt(true), '開了帶犯罪代價的政策，地價卻沒有變差').toBeLessThan(plain);
  });

  it('should leave land value outside the district alone', () => {
    // 犯罪代價是分區的。全城都被扣的話，這個槓桿就沒有空間意義了。
    const outside = (withPolicy: boolean) => {
      const state = createGameState(30, 30);
      const loop = new SimulationLoop(state);
      for (let x = 5; x < 25; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
      for (let x = 6; x < 24; x++) {
        state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
      }
      const d = state.districts.createDistrict('D');
      // 分區只蓋住左半邊。
      for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
      if (withPolicy) state.policies.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
      for (let i = 0; i < 6; i++) loop.tick();
      return state.grid.getCell(20, 11)!.landValue;
    };
    expect(outside(true), '分區外的地價也被扣了').toBe(outside(false));
  });
});

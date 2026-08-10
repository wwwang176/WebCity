import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCivicPlan, civicTypesDone, registerCivicPlan, resetCivicPlans,
} from '../registry';
import { FACADE_CIVIC } from '../../buildings/parts';
import type { CivicPlan } from '../types';

const plan = (): CivicPlan => ({
  footprint: { w: 2, h: 2 },
  facade: FACADE_CIVIC,
  seed: [0.5, 0.5, 0.5],
  massing: [],
  decals: [],
  props: [],
  overhead: [],
});

/**
 * 這張表是逐步填滿的 —— 19 種公共建築分批改造，改好一種註冊一種。
 * 沒註冊的仍然走 `BuildingRenderer` 舊的手寫路徑，所以半途的狀態是可用的。
 */
describe('公共建築 registry', () => {
  // 模組層級的狀態會在各個 it 之間延續 —— 不清的話後面的斷言會被前面污染。
  beforeEach(resetCivicPlans);

  it('should return undefined for a type that has not been converted yet', () => {
    expect(getCivicPlan('police')).toBeUndefined();
  });

  it('should hand back exactly what was registered', () => {
    const p = plan();
    registerCivicPlan('police', p);
    expect(getCivicPlan('police')).toBe(p);
  });

  it('should list only the types that have been registered', () => {
    // showcase 的下拉選單吃這個。手寫第二份清單的話，做完一種卻忘了加進
    // 選單，結果是「做好了但看不到」。
    registerCivicPlan('fire', plan());
    expect(civicTypesDone()).toEqual(['fire']);
    registerCivicPlan('hospital', plan());
    expect(new Set(civicTypesDone())).toEqual(new Set(['fire', 'hospital']));
  });

  it('should refuse a second registration for the same type', () => {
    // 兩個 model 檔案都註冊同一種的話，後寫的會靜靜地蓋掉前一個 —— 而畫面
    // 上只表現為「我改的那棟沒有生效」。
    registerCivicPlan('school', plan());
    expect(() => registerCivicPlan('school', plan())).toThrow(/註冊了兩次/);
  });
});

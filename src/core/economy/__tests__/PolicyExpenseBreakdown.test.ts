import { describe, it, expect } from 'vitest';
import { billableDistricts } from '../../district/DistrictManager';
import { listPolicyExpenses } from '../ExpenseCalculator';
import { CityOrdinances } from '../../district/CityOrdinances';
import { PolicyType } from '../../district/types';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { computeCityScales } from '../../district/PolicyBilling';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { buildEconomyBreakdownContext } from '../EconomyBreakdownContext';

/**
 * 預算面板只給一個總額的話，「政策從 $800 漲到 $4,200」會是一個玩家事後才發現的坑。
 * 看得見才做得了決定 —— 這也是這套設計不設預算上限的前提:上限會替玩家自動砍掉
 * 政策，而且砍得無聲無息。
 */

const districts = () => [{
  name: 'Downtown',
  cells: { size: 50 }, roadCells: 50, chargedDrivers: 0,
  policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }],
}];

describe('政策支出明細', () => {
  it('should list one line per active policy, district and city alike', () => {
    const ord = new CityOrdinances();
    ord.setLevel(PolicyType.ENERGY_REGULATION, 2);
    // 人口不能是 0 —— 節能法規按人口計費，人口 0 的話那一行的 cost 是 0 而被跳過。
    const lines = listPolicyExpenses(districts(), ord, scaleOf({ population: 1000 }));
    expect(lines).toHaveLength(2);
    expect(lines.find(l => l.scope === 'district')!.districtName).toBe('Downtown');
    expect(lines.find(l => l.scope === 'city')!.districtName).toBeNull();
    for (const l of lines) expect(l.cost, `${l.type} 列了一行卻是 0 元`).toBeGreaterThan(0);
  });

  it('should skip policies that are off', () => {
    const off = [{ name: 'D', cells: { size: 50 }, roadCells: 50, chargedDrivers: 0, policies: [{ type: PolicyType.TOURISM, level: 0 }] }];
    expect(listPolicyExpenses(off, new CityOrdinances(), scaleOf({ population: 1000 }))).toHaveLength(0);
  });

  it('should skip a restriction policy, which costs nothing', () => {
    const banned = [{
      name: 'D', cells: { size: 50 }, roadCells: 50, chargedDrivers: 0,
      policies: [{ type: PolicyType.NO_HEAVY_INDUSTRY, level: 1 }],
    }];
    expect(listPolicyExpenses(banned, new CityOrdinances(), scaleOf({ population: 1000 }))).toHaveLength(0);
  });

  it('should sum to exactly what the budget charges', () => {
    // 明細跟帳對不起來的話，玩家看到的解釋是假的。所以比的是**模擬迴圈實際寫進
    // 預算的那個數字**，不是把同一條公式再算一次。
    //
    // 人口必須造出來:節能法規按人口計費，人口 0 的話全城那一段恆為 0，刪掉
    // listPolicyExpenses 的全城迴圈也不會被抓到。
    const build = (on: boolean) => {
      const state = createGameState(30, 30);
      const loop = new SimulationLoop(state);
      for (let i = 0; i < 200; i++) state.citizens.restoreCitizen({}, 0);
      const d = state.districts.createDistrict('Downtown');
      for (let x = 5; x < 15; x++) state.districts.addCellToDistrict(d.id, x, 5);
      if (on) {
        state.policies.setPolicyLevel(d.id, PolicyType.ENCOURAGE_RECYCLING, 2);
        state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 2);
      }
      // calculateIncome 在 slowSlot 5 跑，六個 tick 剛好涵蓋一次。
      for (let i = 0; i < 6; i++) loop.tick();
      return { state, expenses: state.budget.expenses };
    };

    const off = build(false);
    const on = build(true);
    const charged = on.expenses - off.expenses;

    const lines = listPolicyExpenses(
      billableDistricts(on.state.grid, on.state.districts.getAllDistricts()),
      on.state.ordinances,
      computeCityScales(on.state.citizens.getCitizens(),
        (x, y) => on.state.health.getCoverage(x, y)),
    );
    const sum = lines.reduce((a, l) => a + l.cost, 0);

    expect(lines.filter(l => l.scope === 'city'), '沒有全城條例，全城那一段是空測試')
      .toHaveLength(1);
    expect(sum, '明細合計是 0，這條測試等於空轉').toBeGreaterThan(0);
    expect(sum, '明細合計跟預算實際多收的錢對不起來').toBeCloseTo(charged, 6);
  });
});

describe('明細與面板總額', () => {
  // 玩家會做的事是:打開預算面板，看到「Policies −$2,840」，把它展開看逐條。
  // 那幾行必須加得起來 —— 對不起來的話，玩家看到的解釋是假的。
  //
  // 「面板等於國庫上一次實際扣的錢」則**不是**這裡守的東西:面板是即時重算的，
  // 帳本每六個 tick 才算一次，中間人口變了兩邊就會差。那對每一列支出都成立
  // （道路維護、服務費用也都是即時重算），不是政策獨有的。
  it('should add up to the total the panel shows', () => {
    const state = createGameState(20, 20);
    for (let i = 0; i < 100; i++) state.citizens.restoreCitizen({}, 0);
    const d = state.districts.createDistrict('Downtown');
    for (let x = 5; x < 15; x++) state.districts.addCellToDistrict(d.id, x, 5);
    state.policies.setPolicyLevel(d.id, PolicyType.ENCOURAGE_RECYCLING, 2);
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();
    const panelTotal = buildEconomyBreakdownContext(
      state, null, loop.billableDistricts()).policyCost ?? 0;
    const lines = listPolicyExpenses(
      loop.billableDistricts(), state.ordinances,
      computeCityScales(state.citizens.getCitizens(), (x, y) => state.health.getCoverage(x, y)));
    const sum = lines.reduce((a, l) => a + l.cost, 0);

    expect(panelTotal, '面板的政策支出是 0，這條測試等於空轉').toBeGreaterThan(0);
    expect(lines.length, '一行都沒有列出來').toBeGreaterThan(1);
    expect(sum, '逐條加起來跟面板上的總額對不起來').toBeCloseTo(panelTotal, 6);
  });
});

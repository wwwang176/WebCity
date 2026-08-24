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
 * A single total in the budget panel would hide a rise from $800 to $4,200 in policy cost
 * until after the fact. Line-by-line visibility is what lets the player decide, and it is why
 * the design carries no budget cap: a cap would silently cancel policies for them.
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
    // Population must not be 0: the energy code bills per capita, so at 0 that line costs 0
    // and is skipped.
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
    // The comparison is against the number the simulation loop actually wrote into the budget,
    // not the same formula evaluated a second time.
    //
    // Population has to exist: the energy code bills per capita, so at 0 the citywide term is
    // always 0 and deleting the citywide loop in listPolicyExpenses would go unnoticed.
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
      // calculateIncome runs on slowSlot 5; six ticks cover exactly one pass.
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
  // The player opens the budget panel, sees "Policies -$2,840" and expands it; those lines
  // have to add up to that total.
  //
  // What is NOT guarded here is the panel matching the last amount the treasury actually
  // deducted: the panel recomputes live while the ledger runs every six ticks, so a population
  // change in between separates them. That holds for every expense row (road maintenance and
  // service costs also recompute live), not just policies.
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

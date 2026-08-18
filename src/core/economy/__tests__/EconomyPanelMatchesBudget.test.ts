import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { placeInfraOnGrid } from '../../building/InfraPlacement';
import { buildEconomyBreakdownContext } from '../EconomyBreakdownContext';
import { getEconomyBreakdown } from '../EconomyBreakdown';
import { calculateBalance } from '../Budget';
import { ElevationManager } from '../../elevation/ElevationManager';
import { RailType } from '../../rail/types';
import { PolicyType } from '../../district/types';

/**
 * The economy panel and SimulationLoop compute the city's finances from two
 * separate assemblies of the same inputs, and they have drifted apart twice
 * already: service/policy/elevated costs were missing from the panel entirely
 * (BUG-062), and the fix for that then double-charged power and water because
 * they are itemised as their own rows *and* included in the civic total.
 *
 * This asserts the invariant directly instead of checking fields one by one:
 * what the panel shows as expenses must equal what the treasury is actually
 * charged.
 */
/**
 * Every expense row must be non-zero, or the invariant is being checked with
 * that term multiplied by nothing.
 *
 * The first version of this fixture had no transit routes, no districts and
 * passed `null` for the ElevationManager, so transportCost, policyCost and
 * elevatedMaintenance were identically 0 in both the panel and the treasury.
 * Three of the eight rows were free to disagree in any way at all.
 */
function buildCity() {
  const state = createGameState(30, 30);
  new RoadBuilder(state.grid).buildRoad({ x: 2, y: 10 }, { x: 25, y: 10 }, RoadType.TWO_LANE, 1e6);

  // Transit, so transportCost is non-zero.
  const s1 = state.metro.addStation(3, 12);
  const s2 = state.metro.addStation(20, 12);
  state.metro.createLine([s1, s2], 2);

  // A district with a BILLABLE policy, so policyCost is non-zero.
  //
  // 限制型條例（禁重工業、禁高密度）現在刻意不收費 —— 它們的代價是機會成本。
  // 拿它們當夾具的話 policyCost 恆為 0，這支測試的不變量就沒有東西可驗。
  // 費用也跟著分區格數走，所以格子要夠多。
  const district = state.districts.createDistrict('Downtown');
  for (let x = 10; x < 20; x++) state.districts.addCellToDistrict(district.id, x, 9);
  state.policies.setPolicyLevel(district.id, PolicyType.ENCOURAGE_RECYCLING, 2);

  // Utilities, so the power/water maintenance rows are non-zero.
  placeInfraOnGrid(state.grid, 2, 11, 'power', 0);
  placeInfraOnGrid(state.grid, 5, 11, 'water', 0);
  state.power.addPlant({ x: 2, y: 11, output: 200, pollution: 20, type: 'coal' });
  state.water.addPlant({ x: 5, y: 11, output: 200 });

  // A civic service, so serviceCost is non-zero and distinguishable.
  placeInfraOnGrid(state.grid, 8, 11, 'police', 0);
  state.police.addStation(8, 11);

  for (let x = 12; x < 20; x++) {
    state.grid.setCell(x, 9, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  }
  return state;
}

/** An elevation manager holding real segments, so elevatedMaintenance is non-zero. */
function buildElevation(): ElevationManager {
  const em = new ElevationManager();
  for (let x = 4; x <= 8; x++) {
    em.set(x, 14, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: 0,
      railType: RailType.NONE, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });
  }
  return em;
}

/** Sum of every expense row the panel renders. */
function panelExpenses(b: ReturnType<typeof getEconomyBreakdown>): number {
  return b.roadMaintenance + b.loanInterest + b.powerCost + b.waterCost
    + b.transportCost + b.serviceCost + b.policyCost + b.elevatedMaintenance;
}

describe('economy panel agrees with the treasury', () => {
  it('should exercise every expense row with a non-zero value', () => {
    // Guards the guard: an equality over a sum is only as strong as the terms
    // that are actually populated. If a future fixture edit zeroes one of these
    // rows, this fails here instead of quietly weakening all four cases below.
    const state = buildCity();
    const em = buildElevation();
    const loop = new SimulationLoop(state);
    loop.setElevationManager(em);
    state.budget.loans = 1000;
    state.budget.loanInterestRate = 0.05;
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, em, loop.billableDistricts()));
    for (const [row, value] of Object.entries({
      roadMaintenance: b.roadMaintenance, loanInterest: b.loanInterest,
      powerCost: b.powerCost, waterCost: b.waterCost,
      transportCost: b.transportCost, serviceCost: b.serviceCost,
      policyCost: b.policyCost, elevatedMaintenance: b.elevatedMaintenance,
    })) {
      expect(value, `${row} must be non-zero for the invariant to mean anything`)
        .toBeGreaterThan(0);
    }
  });

  it('should report the same expenses the simulation charges', () => {
    const state = buildCity();
    const em = buildElevation();
    const loop = new SimulationLoop(state);
    loop.setElevationManager(em);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, em, loop.billableDistricts()));
    const loanInterest = state.budget.loans * state.budget.loanInterestRate;

    expect(panelExpenses(b)).toBeCloseTo(state.budget.expenses + loanInterest, 1);
  });

  it('should still agree once a loan is outstanding', () => {
    const state = buildCity();
    state.budget.loans = 10000;
    state.budget.loanInterestRate = 0.05;
    const em = buildElevation();
    const loop = new SimulationLoop(state);
    loop.setElevationManager(em);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, em, loop.billableDistricts()));

    expect(b.loanInterest).toBeCloseTo(500, 1);
    expect(panelExpenses(b)).toBeCloseTo(state.budget.expenses + 500, 1);
  });

  it('should not count power and water maintenance twice', () => {
    const state = buildCity();
    const em = buildElevation();
    const loop = new SimulationLoop(state);
    loop.setElevationManager(em);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, em, loop.billableDistricts()));

    expect(b.powerCost).toBeGreaterThan(0);
    expect(b.waterCost).toBeGreaterThan(0);
    // serviceCost covers the remaining civic services only.
    expect(b.powerCost + b.waterCost + b.serviceCost).toBeCloseTo(state.budget.expenses
      - b.roadMaintenance - b.policyCost - b.transportCost - b.elevatedMaintenance, 1);
  });

  it('should net out to the same balance the treasury applies', () => {
    const state = buildCity();
    state.budget.loans = 4000;
    state.budget.loanInterestRate = 0.05;
    const em = buildElevation();
    const loop = new SimulationLoop(state);
    loop.setElevationManager(em);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, em, loop.billableDistricts()));
    const panelBalance = (b.residential + b.commercial + b.industrial + b.office)
      - panelExpenses(b);

    expect(panelBalance).toBeCloseTo(calculateBalance(state.budget), 0);
  });
});

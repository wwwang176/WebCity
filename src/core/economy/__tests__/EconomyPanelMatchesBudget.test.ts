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
function buildCity() {
  const state = createGameState(30, 30);
  new RoadBuilder(state.grid).buildRoad({ x: 2, y: 10 }, { x: 25, y: 10 }, RoadType.TWO_LANE, 1e6);

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

/** Sum of every expense row the panel renders. */
function panelExpenses(b: ReturnType<typeof getEconomyBreakdown>): number {
  return b.roadMaintenance + b.loanInterest + b.powerCost + b.waterCost
    + b.transportCost + b.serviceCost + b.policyCost + b.elevatedMaintenance;
}

describe('economy panel agrees with the treasury', () => {
  it('should report the same expenses the simulation charges', () => {
    const state = buildCity();
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, null));
    const loanInterest = state.budget.loans * state.budget.loanInterestRate;

    expect(panelExpenses(b)).toBeCloseTo(state.budget.expenses + loanInterest, 1);
  });

  it('should still agree once a loan is outstanding', () => {
    const state = buildCity();
    state.budget.loans = 10000;
    state.budget.loanInterestRate = 0.05;
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, null));

    expect(b.loanInterest).toBeCloseTo(500, 1);
    expect(panelExpenses(b)).toBeCloseTo(state.budget.expenses + 500, 1);
  });

  it('should not count power and water maintenance twice', () => {
    const state = buildCity();
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, null));

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
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    const b = getEconomyBreakdown(buildEconomyBreakdownContext(state, null));
    const panelBalance = (b.residential + b.commercial + b.industrial + b.office)
      - panelExpenses(b);

    expect(panelBalance).toBeCloseTo(calculateBalance(state.budget), 0);
  });
});

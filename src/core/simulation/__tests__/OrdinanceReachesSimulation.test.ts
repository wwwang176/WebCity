import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { buildEconomyBreakdownContext } from '../../economy/EconomyBreakdownContext';
import { computeCityScales } from '../../district/PolicyBilling';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';
import { buildSummaryStats } from '../../stats/SummaryStats';

/**
 * Storing an ordinance is not the same as the simulation reading it. These go through the
 * real paths.
 *
 * Buildings are planted directly into the grid and citizens created directly:
 *
 * - `PowerGrid.calculateDemand` counts only cells with `buildingId > 0`, and building growth
 *   requires power and water on the cell, so a test city with no plants grows nothing, demand
 *   is 0, and the positive control fails first.
 * - `getPopulation()` is the length of the citizen array and is 0 in a new game, while energy
 *   regulation bills per capita and therefore costs 0 at population 0.
 */

/** Small House (RESIDENTIAL_LOW). */
const HOUSE = 1;

function city(): { state: GameState; loop: SimulationLoop } {
  const state = createGameState(30, 30);
  for (let x = 5; x < 20; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 19; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
  }
  for (let i = 0; i < 200; i++) state.citizens.restoreCitizen({}, 0);
  return { state, loop: new SimulationLoop(state) };
}

/** `EconomyBreakdownContext.policyCost` is optional, and the panel itself treats it as 0. */
const policyExpense = (state: GameState, loop: SimulationLoop) =>
  buildEconomyBreakdownContext(state, null, loop.billableDistricts()).policyCost ?? 0;

describe('全城條例真的接進模擬', () => {
  it('should lower total power demand', () => {
    const demandOf = (level: number) => {
      const { state, loop } = city();
      state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, level);
      for (let i = 0; i < 6; i++) loop.tick();
      return state.power.getDemand();
    };
    const plain = demandOf(0);
    expect(plain, '沒有電力需求可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(demandOf(3), '節能法規沒有降低電力需求').toBeLessThan(plain);
  });

  it('should show up as an expense in the budget', () => {
    const { state, loop } = city();
    expect(state.citizens.getPopulation(), '沒有人口，按人口計費的條例會恆為 0')
      .toBeGreaterThan(0);
    const plain = policyExpense(state, loop);
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const withOrdinance = policyExpense(state, loop);
    expect(withOrdinance, '全城條例沒有進預算').toBeGreaterThan(plain);
    expect(withOrdinance - plain, '進預算的金額跟條例自己算的對不起來')
      .toBeCloseTo(state.ordinances.totalCost(
        computeCityScales(state.citizens.getCitizens(), () => false)), 6);
  });

  it('should cost commercial and industrial revenue', () => {
    // Energy regulation costs businesses: equipment upgrades and process changes. Housing is
    // unaffected.
    const { state } = city();
    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業沒有被扣')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW), '商業沒有被扣')
      .toBeLessThan(1);
    expect(state.ordinances.getRevenueMultiplier(ZoneType.RESIDENTIAL_LOW), '住宅也被扣了')
      .toBe(1);
    // Industry is charged more than commerce: reworking a process costs far more than
    // replacing air conditioning. Checking only that both are below 1 would also pass if
    // industry were given commerce's multiplier.
    expect(state.ordinances.getRevenueMultiplier(ZoneType.INDUSTRIAL), '工業與商業被扣得一樣多')
      .toBeLessThan(state.ordinances.getRevenueMultiplier(ZoneType.COMMERCIAL_LOW));
  });

  it('should apply outside any district too', () => {
    // A city-wide ordinance applies to every cell, including cells in no district — that is
    // what "city-wide" means.
    const { state, loop } = city();
    const deps = buildEconomyBreakdownContext(state, null, loop.billableDistricts());
    const outsideAnyDistrict = deps.getRevenueMultiplier!(7, 11, ZoneType.COMMERCIAL_LOW);
    expect(state.districts.getDistrictAt(7, 11), '這一格屬於某個分區，測不到要測的東西')
      .toBeNull();
    expect(outsideAnyDistrict, '沒開條例就已經不是 1').toBe(1);

    state.ordinances.setLevel(PolicyType.ENERGY_REGULATION, 3);
    const after = buildEconomyBreakdownContext(state, null, loop.billableDistricts())
      .getRevenueMultiplier!(7, 11, ZoneType.COMMERCIAL_LOW);
    expect(after, '分區外的格子沒有吃到全城條例').toBeLessThan(1);
  });
});


describe('全城犯罪率:模擬與面板算的是同一個數字', () => {
  /** The population is large so the base crime rate exceeds the ordinance's -13; otherwise
   *  the test measures the clamp at 0. */
  function crimeCity(population: number, stations: number) {
    const state = createGameState(30, 30);
    for (let i = 0; i < population; i++) state.citizens.restoreCitizen({ age: 100 });
    for (let i = 0; i < stations; i++) state.police.addStation(3 + i * 2, 3);
    return { state, loop: new SimulationLoop(state) };
  }

  it('should bring the city crime rate down as stations go up', () => {
    expect(crimeCity(800, 2).loop.getCityCrime())
      .toBeLessThan(crimeCity(800, 0).loop.getCityCrime());
  });

  it('should subtract what a city ordinance takes off', () => {
    // Surveillance network level 2 is crime -13. Storing it in CityOrdinances is not the same
    // as the simulation reading it.
    const plain = crimeCity(800, 1);
    const before = plain.loop.getCityCrime();

    const watched = crimeCity(800, 1);
    watched.state.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);

    expect(before, '基礎犯罪率不夠高，這條會測成夾值').toBeGreaterThan(13);
    expect(watched.loop.getCityCrime(), '條例沒有進到模擬').toBeCloseTo(before - 13, 6);
  });

  it('should agree with what the Summary panel reports', () => {
    // The panel goes through `buildSummaryStats` (computed from GameState) while the
    // simulation goes through SimulationLoop. If the two diverge, the attractiveness the
    // player sees is not the one that brings citizens in (BUG-358).
    const { state, loop } = crimeCity(800, 2);
    state.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 1);

    expect(buildSummaryStats(state).crimeRate).toBeCloseTo(loop.getCityCrime(), 6);
  });
});

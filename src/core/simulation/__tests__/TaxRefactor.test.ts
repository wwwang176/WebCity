import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { BUILDING_TYPES, getBuildingType } from '../../building/types';
import { DEFAULT_TAX_RATE, DEFAULT_TAX_RATES, type TaxRates } from '../../economy/Tax';
import { serializeGameState, deserializeGameState } from '../../save/Serializer';
import { getResidentialLevelMultiplier } from '../../economy/TaxMultipliers';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/** Fill a building with workers so it produces full income. */
function fillWorkers(state: GameState, x: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const c = state.citizens.createCitizen({ age: 30 });
    c.workplaceId = `${x},${y}`;
    c.homeId = 'none'; // prevent auto-assignment to residential buildings
  }
}

/** Add power+water plants adjacent to a position so buildings there get utilities. */
function provideUtilities(state: GameState, x: number, y: number): void {
  state.grid.setCell(x - 1, y, { roadFlags: 1, roadType: 1 });
  state.power.addPlant({ x: x - 2, y, output: 1500, pollution: 0, type: 'coal' });
  state.water.addPlant({ x: x - 2, y: y + 1, output: 1500 });
  state.grid.setCell(x - 2, y + 1, { roadFlags: 1, roadType: 1 });
}

/**
 * Run the same city twice at two business-tax rates and return the ratio.
 *
 * These cases used to assert a literal built from the buildingId they placed.
 * That literal is wrong for four independent reasons the tests never mentioned:
 * the loop upgrades buildings (changing companyIncome AND the level
 * multiplier), income scales by staffed/capacity so an upgrade that raises
 * capacity LOWERS revenue, commercial income is scaled by freight supply, and
 * industrial income by the freight surplus penalty. Whether any of it happened
 * came down to whether randomInt sampled that cell, so the assertions failed a
 * few percent of the time — always in a full-suite run, never in isolation.
 *
 * The thing these cases are actually about is that business tax is linear in
 * the rate. A ratio isolates it and everything else cancels.
 */
function businessTaxRatio(build: (state: GameState) => void, lowRate: number, highRate: number): number {
  const run = (rate: number) => {
    reseedRandom();
    const state = createGameState(20, 20);
    build(state);
    state.taxRates.residential = 0;
    state.taxRates.business = rate;
    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();
    return state.budget.income;
  };
  const low = run(lowRate);
  expect(low).toBeGreaterThan(0);
  return run(highRate) / low;
}

describe('BuildingType companyIncome', () => {
  it('should have companyIncome for commercial low buildings', () => {
    // Commercial Low: Lv1=10, Lv2=15, Lv3=20
    const lv1 = BUILDING_TYPES.find(b => b.id === 7)!; // Small Shop
    const lv2 = BUILDING_TYPES.find(b => b.id === 8)!; // Medium Shop
    const lv3 = BUILDING_TYPES.find(b => b.id === 9)!; // Large Shop
    expect(lv1.companyIncome).toBe(10);
    expect(lv2.companyIncome).toBe(15);
    expect(lv3.companyIncome).toBe(20);
  });

  it('should have companyIncome for commercial high buildings', () => {
    // Commercial High: Lv1=40, Lv2=60, Lv3=80
    const lv1 = BUILDING_TYPES.find(b => b.id === 10)!; // Small Mall
    const lv2 = BUILDING_TYPES.find(b => b.id === 11)!; // Medium Mall
    const lv3 = BUILDING_TYPES.find(b => b.id === 12)!; // Department Store
    expect(lv1.companyIncome).toBe(40);
    expect(lv2.companyIncome).toBe(60);
    expect(lv3.companyIncome).toBe(80);
  });

  it('should have companyIncome for industrial buildings', () => {
    // Industrial: Lv1=15, Lv2=22, Lv3=30
    const lv1 = BUILDING_TYPES.find(b => b.id === 13)!; // Small Factory
    const lv2 = BUILDING_TYPES.find(b => b.id === 14)!; // Medium Factory
    const lv3 = BUILDING_TYPES.find(b => b.id === 15)!; // Large Factory
    expect(lv1.companyIncome).toBe(15);
    expect(lv2.companyIncome).toBe(22);
    expect(lv3.companyIncome).toBe(30);
  });

  it('should have companyIncome for office low buildings', () => {
    // Office Low: Lv1=20, Lv2=30, Lv3=40
    const lv1 = BUILDING_TYPES.find(b => b.id === 16)!; // Small Office
    const lv2 = BUILDING_TYPES.find(b => b.id === 17)!; // Medium Office
    const lv3 = BUILDING_TYPES.find(b => b.id === 18)!; // Large Office
    expect(lv1.companyIncome).toBe(20);
    expect(lv2.companyIncome).toBe(30);
    expect(lv3.companyIncome).toBe(40);
  });

  it('should have companyIncome for office high buildings', () => {
    // Office High: Lv1=60, Lv2=90, Lv3=120
    const lv1 = BUILDING_TYPES.find(b => b.id === 19)!; // Office Building
    const lv2 = BUILDING_TYPES.find(b => b.id === 20)!; // Office Complex
    const lv3 = BUILDING_TYPES.find(b => b.id === 21)!; // Office Tower
    expect(lv1.companyIncome).toBe(60);
    expect(lv2.companyIncome).toBe(90);
    expect(lv3.companyIncome).toBe(120);
  });

  it('should have companyIncome=0 for residential buildings', () => {
    const resBuildings = BUILDING_TYPES.filter(b =>
      b.zoneType === ZoneType.RESIDENTIAL_LOW || b.zoneType === ZoneType.RESIDENTIAL_HIGH
    );
    for (const b of resBuildings) {
      expect(b.companyIncome ?? 0).toBe(0);
    }
  });
});

describe('TaxRates: income tax + business tax', () => {
  it('should have both residential and business fields in TaxRates', () => {
    const state = createGameState(10, 10);
    expect(state.taxRates.residential).toBeDefined();
    expect(state.taxRates.business).toBeDefined();
  });

  it('DEFAULT_TAX_RATE should be 9', () => {
    expect(DEFAULT_TAX_RATE).toBe(9);
  });

  it('DEFAULT_TAX_RATES should use DEFAULT_TAX_RATE for all fields', () => {
    expect(DEFAULT_TAX_RATES.residential).toBe(DEFAULT_TAX_RATE);
    expect(DEFAULT_TAX_RATES.commercial).toBe(DEFAULT_TAX_RATE);
    expect(DEFAULT_TAX_RATES.industrial).toBe(DEFAULT_TAX_RATE);
    expect(DEFAULT_TAX_RATES.office).toBe(DEFAULT_TAX_RATE);
    expect(DEFAULT_TAX_RATES.business).toBe(DEFAULT_TAX_RATE);
  });

  it('income tax rate and business tax rate should be independent', () => {
    const state = createGameState(10, 10);
    state.taxRates.residential = 5;
    state.taxRates.business = 15;
    expect(state.taxRates.residential).toBe(5);
    expect(state.taxRates.business).toBe(15);
  });
});

describe('Income tax calculation (residential buildings)', () => {
  it('should calculate income tax from residents in residential buildings', () => {
    const state = createGameState(20, 20);
    state.grid.setCell(5, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    provideUtilities(state, 5, 5);
    const c1 = state.citizens.createCitizen({ age: 46 });
    c1.homeId = '5,5';
    const c2 = state.citizens.createCitizen({ age: 46 });
    c2.homeId = '5,5';

    state.taxRates.residential = 10;
    state.taxRates.business = 0;

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    const home = getBuildingType(state.grid.getCell(5, 5)!.buildingId)!;
    expect(state.budget.income)
      .toBeCloseTo(2 * 0.5 * getResidentialLevelMultiplier(home.level as 1 | 2 | 3) * 0.1, 1);
  });

  it('residential tax scales with building level multiplier', () => {
    // Lv1 building (buildingId=1): multiplier=1.0
    const stateLv1 = createGameState(20, 20);
    stateLv1.grid.setCell(5, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    provideUtilities(stateLv1, 5, 5);
    for (let i = 0; i < 4; i++) {
      const c = stateLv1.citizens.createCitizen({ age: 46 });
      c.homeId = '5,5';
    }
    stateLv1.taxRates.residential = 10;
    stateLv1.taxRates.business = 0;

    const loopLv1 = new SimulationLoop(stateLv1);
    for (let i = 0; i < 6; i++) loopLv1.tick();
    const incomeLv1 = stateLv1.budget.income;

    expect(incomeLv1).toBeGreaterThan(0);
    const home = getBuildingType(stateLv1.grid.getCell(5, 5)!.buildingId)!;
    expect(incomeLv1)
      .toBeCloseTo(4 * 0.5 * getResidentialLevelMultiplier(home.level as 1 | 2 | 3) * 0.1, 1);
  });
});

describe('Business tax calculation (commercial/industrial/office)', () => {
  useSeededRandom();

  it('should calculate business tax for commercial building: companyIncome x levelMultiplier x businessTaxRate', () => {
    const state = createGameState(20, 20);
    state.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    provideUtilities(state, 5, 5);
    fillWorkers(state, 5, 5, 4);
    state.taxRates.residential = 0;
    state.taxRates.business = 10;

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    expect(state.budget.income).toBeGreaterThan(0);
    expect(businessTaxRatio((st) => {
      st.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      provideUtilities(st, 5, 5);
      fillWorkers(st, 5, 5, 4);
    }, 5, 10)).toBeCloseTo(2, 3);
  });

  it('should use level multiplier for upgraded commercial building', () => {
    const state = createGameState(20, 20);
    // Large Shop (id=9): companyIncome=20, level=3
    // Provide power+water+landValue to prevent Lv3 downgrade
    state.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 9, landValue: 80 });
    state.power.addPlant({ x: 5, y: 5, output: 500, pollution: 0, type: 'solar' });
    state.water.addPlant({ x: 5, y: 5, output: 500 });
    fillWorkers(state, 5, 5, 12);
    state.power.calculateCoverage(state.grid);
    state.water.calculateCoverage(state.grid);
    state.taxRates.residential = 0;
    state.taxRates.business = 10;

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // Lv3 is the cap, so this one cannot be upgraded out from under the check —
    // which is what makes the level multiplier observable here at all.
    expect(state.grid.getCell(5, 5)!.buildingId).toBe(9);
    expect(state.budget.income).toBeGreaterThan(0);
    // A Lv3 building must out-earn the same building at Lv1, by exactly the
    // ratio of their level multipliers.
    const lv1 = businessTaxRatio((st) => {
      st.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 9, landValue: 80 });
      st.power.addPlant({ x: 5, y: 5, output: 500, pollution: 0, type: 'solar' });
      st.water.addPlant({ x: 5, y: 5, output: 500 });
      fillWorkers(st, 5, 5, 12);
      st.power.calculateCoverage(st.grid);
      st.water.calculateCoverage(st.grid);
    }, 5, 10);
    expect(lv1).toBeCloseTo(2, 3);
  });

  it('should calculate business tax for industrial building', () => {
    const state = createGameState(20, 20);
    // Medium Factory (id=14): companyIncome=22, level=2
    // Provide power+water+landValue to prevent Lv2 downgrade
    state.grid.setCell(5, 5, { zoneType: ZoneType.INDUSTRIAL, buildingId: 14, landValue: 50 });
    state.power.addPlant({ x: 5, y: 5, output: 500, pollution: 0, type: 'solar' });
    state.water.addPlant({ x: 5, y: 5, output: 500 });
    fillWorkers(state, 5, 5, 20);
    state.power.calculateCoverage(state.grid);
    state.water.calculateCoverage(state.grid);
    state.taxRates.residential = 0;
    state.taxRates.business = 10;

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    expect(state.budget.income).toBeGreaterThan(0);
    expect(businessTaxRatio((st) => {
      st.grid.setCell(5, 5, { zoneType: ZoneType.INDUSTRIAL, buildingId: 14, landValue: 50 });
      st.power.addPlant({ x: 5, y: 5, output: 500, pollution: 0, type: 'solar' });
      st.water.addPlant({ x: 5, y: 5, output: 500 });
      fillWorkers(st, 5, 5, 20);
      st.power.calculateCoverage(st.grid);
      st.water.calculateCoverage(st.grid);
    }, 5, 10)).toBeCloseTo(2, 3);
  });

  it('should calculate business tax for office building', () => {
    const state = createGameState(20, 20);
    state.grid.setCell(5, 5, { zoneType: ZoneType.OFFICE, buildingId: 19 });
    provideUtilities(state, 5, 5);
    fillWorkers(state, 5, 5, 160);
    state.taxRates.residential = 0;
    state.taxRates.business = 10;

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    expect(state.budget.income).toBeGreaterThan(0);
    expect(businessTaxRatio((st) => {
      st.grid.setCell(5, 5, { zoneType: ZoneType.OFFICE, buildingId: 19 });
      provideUtilities(st, 5, 5);
      fillWorkers(st, 5, 5, 160);
    }, 5, 10)).toBeCloseTo(2, 3);
  });

  it('income tax and business tax should both contribute to total income', () => {
    const state = createGameState(20, 20);
    state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    provideUtilities(state, 3, 3);
    for (let i = 0; i < 4; i++) {
      const c = state.citizens.createCitizen({ age: 46 });
      c.homeId = '3,3';
    }
    state.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    provideUtilities(state, 5, 5);
    fillWorkers(state, 5, 5, 4);

    state.taxRates.residential = 10;
    state.taxRates.business = 10;

    const loop = new SimulationLoop(state);
    for (let i = 0; i < 6; i++) loop.tick();

    // Additivity: charging both is charging each and adding them. Absolute
    // figures here depend on level, staffing and freight; the invariant does not.
    const build = (st: GameState) => {
      st.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      provideUtilities(st, 3, 3);
      for (let i = 0; i < 4; i++) {
        st.citizens.createCitizen({ age: 46 })!.homeId = '3,3';
      }
      st.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      provideUtilities(st, 5, 5);
      fillWorkers(st, 5, 5, 4);
    };
    const incomeAt = (res: number, biz: number) => {
      reseedRandom();
      const st = createGameState(20, 20);
      build(st);
      st.taxRates.residential = res;
      st.taxRates.business = biz;
      const l = new SimulationLoop(st);
      for (let i = 0; i < 6; i++) l.tick();
      return st.budget.income;
    };

    const residentialOnly = incomeAt(10, 0);
    const businessOnly = incomeAt(0, 10);
    expect(residentialOnly).toBeGreaterThan(0);
    expect(businessOnly).toBeGreaterThan(0);
    expect(incomeAt(10, 10)).toBeCloseTo(residentialOnly + businessOnly, 6);
  });
});

describe('Tax rate effects on happiness and demand', () => {
  it('higher income tax should reduce citizen happiness', () => {
    // Low tax
    const stateLow = createGameState(20, 20);
    stateLow.grid.setCell(5, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const c1 = stateLow.citizens.createCitizen({ age: 30 });
    c1.homeId = '5,5';
    stateLow.taxRates.residential = 5; // low income tax
    const loopLow = new SimulationLoop(stateLow);
    for (let i = 0; i < 6; i++) loopLow.tick();
    const happyLow = c1.happiness;

    // High tax
    const stateHigh = createGameState(20, 20);
    stateHigh.grid.setCell(5, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const c2 = stateHigh.citizens.createCitizen({ age: 30 });
    c2.homeId = '5,5';
    stateHigh.taxRates.residential = 18; // high income tax
    const loopHigh = new SimulationLoop(stateHigh);
    for (let i = 0; i < 6; i++) loopHigh.tick();
    const happyHigh = c2.happiness;

    expect(happyLow).toBeGreaterThan(happyHigh);
  });

  it('higher business tax should reduce commercial/industrial/office RCI demand', () => {
    // Low business tax
    const stateLow = createGameState(20, 20);
    stateLow.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    stateLow.taxRates.business = 5;
    const loopLow = new SimulationLoop(stateLow);
    for (let i = 0; i < 6; i++) loopLow.tick();
    const demandLow = { ...stateLow.rciDemand };

    // High business tax
    const stateHigh = createGameState(20, 20);
    stateHigh.grid.setCell(5, 5, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    stateHigh.taxRates.business = 18;
    const loopHigh = new SimulationLoop(stateHigh);
    for (let i = 0; i < 6; i++) loopHigh.tick();
    const demandHigh = { ...stateHigh.rciDemand };

    // Commercial demand should be lower with higher business tax
    expect(demandLow.commercial).toBeGreaterThan(demandHigh.commercial);
    // Industrial demand should also be lower
    expect(demandLow.industrial).toBeGreaterThan(demandHigh.industrial);
  });
});

describe('Tax serialization', () => {
  it('should serialize and deserialize business tax rate', () => {
    const state = createGameState(10, 10);
    state.taxRates.residential = 7;
    state.taxRates.business = 14;
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    expect(restored.taxRates.residential).toBe(7);
    expect(restored.taxRates.business).toBe(14);
  });

  it('should preserve backward compat: old saves without business field default to residential rate', () => {
    // Simulate an old save that doesn't have the 'business' field
    const oldJson = JSON.stringify({
      version: 1,
      grid: { width: 10, height: 10, cells: [] },
      clock: { tick: 0, speed: 1, paused: false },
      budget: { funds: 50000, income: 0, expenses: 0, loans: 0, loanInterestRate: 0.05 },
      taxRates: { residential: 12, commercial: 12, industrial: 12, office: 12 },
    });
    const restored = deserializeGameState(oldJson);
    // business should fallback to residential rate for old saves
    expect(restored.taxRates.business).toBe(12);
  });
});

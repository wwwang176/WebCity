import { describe, it, expect, vi } from 'vitest';
import { buildIncomeCalcDeps } from '../IncomeCalcAdapter';
import { calculateZoneIncomes } from '../IncomeCalculator';
import { createGameState } from '../../simulation/GameState';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

describe('buildIncomeCalcDeps', () => {
  it('returns an IncomeCalcDeps with correct forEachCell from GameState', () => {
    const state = createGameState(5, 5);
    state.grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const deps = buildIncomeCalcDeps(state);

    let found = false;
    deps.forEachCell((cell, x, y) => {
      if (x === 1 && y === 1 && cell.buildingId === 1) found = true;
    });
    expect(found).toBe(true);
  });

  it('returns taxRates from GameState', () => {
    const state = createGameState(5, 5);
    state.taxRates.residential = 12;
    const deps = buildIncomeCalcDeps(state);
    expect(deps.taxRates.residential).toBe(12);
  });

  it('provides isPowered query', () => {
    const state = createGameState(5, 5);
    const deps = buildIncomeCalcDeps(state);
    // Without any power plants, nothing should be powered
    expect(deps.isPowered!(1, 1)).toBe(false);
  });
});

/** Grid with N zone buildings on a road spine, plus M citizens spread over them. */
function makeCity(buildings: number, citizens: number) {
  const state = createGameState(60, 60);
  const homes: string[] = [];
  const jobs: string[] = [];

  for (let i = 0; i < buildings; i++) {
    const x = 2 + (i % 50);
    const y = 2 + Math.floor(i / 50) * 3;
    state.grid.setCell(x, y - 1, { roadType: RoadType.TWO_LANE, roadFlags: 0b1100 });
    if (i % 2 === 0) {
      state.grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      homes.push(`${x},${y}`);
    } else {
      state.grid.setCell(x, y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
      jobs.push(`${x},${y}`);
    }
  }

  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100,
      homeId: homes[i % homes.length] ?? null,
      workplaceId: jobs[i % jobs.length] ?? null,
    });
  }
  return state;
}

// BUG-066: getResidentEducations and getWorkerCount were bare Array.filter scans
// over the entire citizen array, allocating a fresh array per call, and
// calculateZoneIncomes calls one of them once per zone building — O(buildings x
// citizens) on the main thread, every income tick and on every throttled UI
// refresh while the Economy page is open.
describe('buildIncomeCalcDeps — per-building citizen lookups', () => {
  it('should not rescan the citizen array once per building', () => {
    const buildings = 40;
    const state = makeCity(buildings, 200);
    // These are the O(N) filters. Building an index means calling them zero
    // times; the old adapter called one of them once per zone building.
    const byHome = vi.spyOn(state.citizens, 'getCitizensByHome');
    const byWork = vi.spyOn(state.citizens, 'getCitizensByWorkplace');

    // calculateZoneIncomes skips unpowered buildings, which would make the
    // per-building lookups unreachable and the assertion vacuous.
    calculateZoneIncomes({ ...buildIncomeCalcDeps(state), isPowered: () => true });

    const scans = byHome.mock.calls.length + byWork.mock.calls.length;
    expect(scans).toBeLessThan(buildings);
    byHome.mockRestore();
    byWork.mockRestore();
  });

  it('should produce identical incomes to a per-call implementation', () => {
    const state = makeCity(30, 150);

    const powered = { isPowered: () => true };
    const indexed = calculateZoneIncomes({ ...buildIncomeCalcDeps(state), ...powered });
    // Reference: the original per-call semantics, computed directly.
    const reference = calculateZoneIncomes({
      ...buildIncomeCalcDeps(state),
      ...powered,
      getResidentEducations: (key) => state.citizens.getCitizensByHome(key).map(c => c.education),
      getWorkerCount: (key) => state.citizens.getCitizensByWorkplace(key).length,
    });

    expect(indexed).toEqual(reference);
  });

  it('should report zero residents and workers for an unoccupied building', () => {
    const state = makeCity(4, 0);
    const deps = buildIncomeCalcDeps(state);
    expect(deps.getResidentEducations!('2,2')).toEqual([]);
    expect(deps.getWorkerCount!('3,2')).toBe(0);
  });

  it('should count multiple occupants of the same building', () => {
    const state = createGameState(20, 20);
    for (let i = 0; i < 5; i++) {
      state.citizens.restoreCitizen({ age: 100, homeId: '5,5', workplaceId: '6,6' });
    }
    const deps = buildIncomeCalcDeps(state);
    expect(deps.getResidentEducations!('5,5')).toHaveLength(5);
    expect(deps.getWorkerCount!('6,6')).toBe(5);
  });
});

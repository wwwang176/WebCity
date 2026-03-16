import { describe, it, expect } from 'vitest';
import { buildIncomeCalcDeps } from '../IncomeCalcAdapter';
import { createGameState } from '../../simulation/GameState';
import { ZoneType } from '../../grid/types';

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

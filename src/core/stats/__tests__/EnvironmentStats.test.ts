import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildEnvironmentStats } from '../EnvironmentStats';
import { BURNED, ABANDONED } from '../../building/InfraPlacement';
import { ZoneType } from '../../grid/types';

describe('環境統計', () => {
  it('should average ground pollution over the built and the zoned', () => {
    const state = createGameState(4, 4);
    state.grid.setCell(0, 0, { buildingId: 1, pollution: 40 });
    state.grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, pollution: 20 });

    // Empty land does not count; an untouched map would dilute the average to 0.
    expect(buildEnvironmentStats(state).avgGroundPollution).toBeCloseTo(30, 6);
  });

  it('should average noise over built cells only', () => {
    // `noiseLevel` is written only by `updateLandValue`, which returns early at
    // `buildingId === 0`. A 0 on empty zoned land means "nothing wrote this cell", not "it is
    // quiet here" (BUG-092).
    const state = createGameState(4, 4);
    state.grid.setCell(0, 0, { buildingId: 1, noiseLevel: 60 });
    state.grid.setCell(1, 0, { zoneType: ZoneType.RESIDENTIAL_LOW, noiseLevel: 0 });

    expect(buildEnvironmentStats(state).avgNoise, '空的分區地把噪音稀釋掉了').toBe(60);
  });

  it('should report zero rather than NaN on an empty map', () => {
    const s = buildEnvironmentStats(createGameState(4, 4));

    expect(s.avgGroundPollution).toBe(0);
    expect(s.avgNoise).toBe(0);
  });

  it('should count burned and abandoned separately', () => {
    // Both render as dark grey ruins, but one burned and one was walked out of, and the fix
    // differs (build a fire station vs raise land value).
    const state = createGameState(4, 4);
    state.grid.setCell(0, 0, { buildingId: 1, reserved: BURNED });
    state.grid.setCell(1, 0, { buildingId: 1, reserved: BURNED });
    state.grid.setCell(2, 0, { buildingId: 1, reserved: ABANDONED });

    const s = buildEnvironmentStats(state);

    expect(s.burnedBuildings).toBe(2);
    expect(s.abandonedBuildings).toBe(1);
  });

  it('should carry the fire figures the panel shows', () => {
    const s = buildEnvironmentStats(createGameState(4, 4));

    expect(s.activeFires).toBe(0);
    expect(s.extinguishedToday).toBe(0);
    expect(s.extinguishedRecent).toBe(0);
  });
});

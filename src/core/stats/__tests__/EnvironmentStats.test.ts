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

    // 空地不算 —— 一整張沒人碰過的地圖會把平均稀釋成 0。
    expect(buildEnvironmentStats(state).avgGroundPollution).toBeCloseTo(30, 6);
  });

  it('should average noise over built cells only', () => {
    // `noiseLevel` 只有 `updateLandValue` 會寫,而它在 `buildingId === 0` 提早回去。
    // 空的分區地讀到的 0 不是「很安靜」,是「沒有人寫過這一格」（BUG-092）。
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
    // 兩者在畫面上都是深灰的廢墟,但一個是火燒的、一個是住戶走光的 ——
    // 要修的東西不一樣（蓋消防隊 vs 提升地價）。
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

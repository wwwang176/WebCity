import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildInfraStats } from '../InfraStats';

describe('基礎設施統計', () => {
  it('should call an empty grid neither supplied nor short', () => {
    // 沒發電廠也沒人用電。比值是 0,不是 NaN。
    const s = buildInfraStats(createGameState(4, 4));

    expect(s.power.ratio).toBe(0);
    expect(s.water.ratio).toBe(0);
  });

  it('should describe the landfills with both halves of the same set', () => {
    // `getActiveLoad` 只算接得到路而且有電的那幾座,容量也必須只數那幾座。
    // 混用的話畫面會印出「1800 / 0」而且標成健康的 0%（BUG-155）。
    const state = createGameState(4, 4);
    const s = buildInfraStats(state);

    expect(s.landfillLoad).toBe(state.garbage.getActiveLoad());
    expect(s.landfillCapacity).toBe(state.garbage.getTotalCapacity());
  });

  it('should say how much landfill capacity is built but unusable', () => {
    // 蓋了掩埋場卻沒接路 —— 玩家要看得到「你有容量，只是用不到」。
    const state = createGameState(4, 4);

    expect(buildInfraStats(state).landfillStrandedCapacity)
      .toBe(state.garbage.getStrandedCapacity());
  });

  it('should add up every cemetery into one pair of numbers', () => {
    const state = createGameState(4, 4);
    const s = buildInfraStats(state);
    let used = 0, cap = 0;
    for (const c of state.deathCare.getCemeteries()) { used += c.currentLoad; cap += c.capacity; }

    expect(s.cemeteryUsed).toBe(used);
    expect(s.cemeteryCapacity).toBe(cap);
  });

  it('should carry the weekly flows, not just the standing totals', () => {
    // 「掩埋場七成滿」跟「每週進來多少」是兩個問題。只給存量看不出還撐幾週。
    const s = buildInfraStats(createGameState(4, 4));

    expect(s.garbageProducedPerWeek).toBe(0);
    expect(s.garbageBurnedPerWeek).toBe(0);
    expect(s.deathsPerWeek).toBe(0);
    expect(s.cremationsPerWeek).toBe(0);
  });
});

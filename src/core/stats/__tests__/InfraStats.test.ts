import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { buildInfraStats } from '../InfraStats';

describe('基礎設施統計', () => {
  it('should call an empty grid neither supplied nor short', () => {
    // No plants and no consumers. The ratio is 0, not NaN.
    const s = buildInfraStats(createGameState(4, 4));

    expect(s.power.ratio).toBe(0);
    expect(s.water.ratio).toBe(0);
  });

  it('should describe the landfills with both halves of the same set', () => {
    // `getActiveLoad` counts only road-connected, powered facilities, so capacity has to count
    // the same ones. Mixing them prints "1800 / 0" flagged as a healthy 0% (BUG-155).
    const state = createGameState(4, 4);
    const s = buildInfraStats(state);

    expect(s.landfillLoad).toBe(state.garbage.getActiveLoad());
    expect(s.landfillCapacity).toBe(state.garbage.getTotalCapacity());
  });

  it('should say how much landfill capacity is built but unusable', () => {
    // A landfill built without a road connection: the player has to see "you have capacity, it
    // just cannot be reached".
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
    // "70% full" and "how much arrives per week" are different questions; the level alone does
    // not say how many weeks are left.
    const s = buildInfraStats(createGameState(4, 4));

    expect(s.garbageProducedPerWeek).toBe(0);
    expect(s.garbageBurnedPerWeek).toBe(0);
    expect(s.deathsPerWeek).toBe(0);
    expect(s.cremationsPerWeek).toBe(0);
  });
});

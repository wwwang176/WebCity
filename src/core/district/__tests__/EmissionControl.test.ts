import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { PolicyType } from '../types';
import { POLICY_SCOPE } from '../PolicyScope';
import { ZoneType } from '../../grid/types';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * Industrial emission control.
 *
 * District-scoped rather than city-wide: the source is per industrial cell and both benefit and
 * cost land on industrial cells, so which stretch of factories is regulated is a real decision.
 * City-wide it would only dock revenue from industrial districts with no pollution problem, and
 * by the test — city-wide only when applying it everywhere is never worse — it does not qualify.
 *
 * The multiplier acts on ground pollution alone. A factory's noise comes from its machinery
 * rather than its discharges, and lowering noise too would make this a universal "industry gets
 * clean" button.
 */

/** Factory (INDUSTRIAL). */
const FACTORY = 13;

function industrialCity(): { state: GameState; loop: SimulationLoop; districtId: string } {
  // The A and B cities have to start from the same random state. Without a reset the second
  // continues the sequence the first left behind, the two cities diverge on their own, and what
  // is measured is that divergence rather than the ordinance.
  reseedRandom();
  const state = createGameState(40, 40);
  for (let x = 2; x < 38; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  // Two factories, far enough apart. Packed together, diffusion stacks to its ceiling — 195 in
  // practice — and the ordinance on or off measures the same number.
  state.grid.setCell(8, 11, { zoneType: ZoneType.INDUSTRIAL, buildingId: FACTORY });
  state.grid.setCell(30, 11, { zoneType: ZoneType.INDUSTRIAL, buildingId: FACTORY });
  const d = state.districts.createDistrict('Works');
  state.districts.addCellToDistrict(d.id, 8, 11);
  return { state, loop: new SimulationLoop(state), districtId: d.id };
}

function pollutionAt(level: number) {
  const { state, loop, districtId } = industrialCity();
  if (level > 0) {
    state.policies.setPolicyLevel(districtId, PolicyType.INDUSTRIAL_EMISSION_CONTROL, level);
  }
  for (let i = 0; i < 6; i++) loop.tick();
  // `getPollutionAt` returns a shared scratch object, as its own comment says (callers must not
  // store the reference). Holding both calls' results leaves two variables pointing at one
  // object, and both read the last cell queried.
  const { ground: ig, noise: inoise } = state.pollution.getPollutionAt(8, 11);
  const { ground: og, noise: onoise } = state.pollution.getPollutionAt(30, 11);
  return {
    inside: { ground: ig, noise: inoise },
    outside: { ground: og, noise: onoise },
  };
}

// The whole file is seeded: every test compares two cities, and building growth, layoffs and
// vehicle jitter all roll dice inside a tick. The sequence is reset again when each city is
// built, so A and B start from the same point.
useSeededRandom();

describe('工業排放管制', () => {
  it('should clean up the ground inside the district that asked for it', () => {
    const plain = pollutionAt(0);
    expect(plain.inside.ground, '本來就沒有地面汙染，量不出改善').toBeGreaterThan(0);
    const managed = pollutionAt(3);
    expect(managed.inside.ground, '分區裡的地面汙染沒有下降')
      .toBeLessThan(plain.inside.ground);
  });

  it('should leave the rest of the map alone', () => {
    // Factories outside the district still emit: this is a district policy, not a city one.
    const plain = pollutionAt(0);
    const managed = pollutionAt(3);
    expect(managed.outside.ground, '分區外的地面汙染也跟著降了')
      .toBe(plain.outside.ground);
  });

  it('should not touch noise', () => {
    // Machinery does not get quieter for having a scrubber fitted.
    const plain = pollutionAt(0);
    const managed = pollutionAt(3);
    expect(plain.inside.noise, '本來就沒有噪音，量不出「沒有被動到」').toBeGreaterThan(0);
    expect(managed.inside.noise, '排放管制把噪音也一起降了').toBe(plain.inside.noise);
  });

  it('should get cleaner each tier', () => {
    const g = (lv: number) => pollutionAt(lv).inside.ground;
    expect(g(2), '第二級沒有比第一級乾淨').toBeLessThan(g(1));
    expect(g(3), '第三級沒有比第二級乾淨').toBeLessThan(g(2));
  });

  it('should be a district decision, paid for by the factories', () => {
    expect(POLICY_SCOPE[PolicyType.INDUSTRIAL_EMISSION_CONTROL], '排放管制被畫成全城條例')
      .toBe('district');
    const { state, districtId } = industrialCity();
    state.policies.setPolicyLevel(districtId, PolicyType.INDUSTRIAL_EMISSION_CONTROL, 3);
    expect(state.policies.getRevenueMultiplier(districtId, ZoneType.INDUSTRIAL), '工業沒有付代價')
      .toBeLessThan(1);
    expect(state.policies.getRevenueMultiplier(districtId, ZoneType.RESIDENTIAL_LOW), '住宅也被扣了')
      .toBe(1);
  });
});

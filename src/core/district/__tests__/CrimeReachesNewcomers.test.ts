import { describe, it, expect, vi } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import {
  calculateAttractiveness, getImmigrationCap, type CityAttractiveness,
} from '../../citizen/Migration';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { toPosKey } from '../../grid/GridHelpers';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * An ordinance's crime effect has to reach whether outsiders move in.
 *
 * What is measured is not how many arrive — that step rolls dice, and at test scale the signal
 * would be lost in the randomness — but the bias of the roll: the crime figure the simulation
 * loop feeds `migrationTick`, the attractiveness it computes, and the migration cap that
 * attractiveness converts to. All three are pure functions and fully determined.
 */

/** Intercepts `migrationTick`'s second argument: the city as the simulation loop sees it. */
const seen: CityAttractiveness[] = [];
vi.mock('../../citizen/Migration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../citizen/Migration')>();
  return {
    ...actual,
    migrationTick: (manager: never, city: CityAttractiveness, ...rest: never[]) => {
      seen.push({ ...city });
      return (actual.migrationTick as (...a: unknown[]) => unknown)(manager, city, ...rest);
    },
  };
});

/** Small House / Small Shop. */
const HOUSE = 1;
const SHOP = 7;

function city(): { state: GameState; loop: SimulationLoop } {
  // The A and B cities have to start from the same random state. Without a reset the second
  // continues the sequence the first left behind, the two cities diverge on their own, and what
  // is measured is that divergence rather than the ordinance.
  reseedRandom();
  const state = createGameState(30, 30);
  for (let x = 5; x < 25; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 24; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
    state.grid.setCell(x, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    // One person per household, leaving housing free so the migration cap is not limited by a
    // lack of homes.
    state.citizens.restoreCitizen({ homeId: toPosKey(x, 11), workplaceId: toPosKey(x, 9) }, 0);
  }
  state.power.addPlant({ x: 12, y: 8, output: 100000, pollution: 0, type: 'wind' });
  state.water.addPlant({ x: 13, y: 8, output: 100000 });
  return { state, loop: new SimulationLoop(state) };
}

/** Runs as far as the migration pass and returns the city the simulation loop saw. */
function cityAsSeenByNewcomers(crime: number): CityAttractiveness {
  seen.length = 0;
  const { state, loop } = city();
  const type = PolicyType.ENERGY_REGULATION;
  const saved = POLICY_EFFECTS[type];
  if (crime !== 0) {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = [{ crime } satisfies PolicyEffect];
    state.ordinances.setLevel(type, 1);
  }
  try {
    for (let i = 0; i < 12; i++) loop.tick();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
  const last = seen[seen.length - 1];
  if (!last) throw new Error('migrationTick 一次都沒有被呼叫，這條測試等於空轉');
  return last;
}

// The whole file is seeded: every test compares two cities, and building growth, layoffs and
// vehicle jitter all roll dice inside a tick. The sequence is reset again when each city is
// built, so A and B start from the same point.
useSeededRandom();

describe('條例的犯罪效果走到外地人眼前', () => {
  it('should show newcomers the crime rate the ordinances actually produce', () => {
    // Not a difference between two runs: baseline crime is population x 0.02 and crime affects
    // population, so the baseline differs between runs. Each is pinned to a band instead: the
    // ordinance's term is fixed at 40, and in this city of twenty-odd people with no police
    // station the baseline cannot drift past 3.
    const plain = cityAsSeenByNewcomers(0);
    const scary = cityAsSeenByNewcomers(40);
    expect(plain.crimeRate, '沒開條例，基礎犯罪卻不小 —— 這條測試的區間站不住').toBeLessThan(3);
    expect(scary.crimeRate, '外地人看到的犯罪率沒有反映條例').toBeGreaterThanOrEqual(40);
    expect(scary.crimeRate, '外地人看到的犯罪率被多加了東西').toBeLessThan(43);
  });

  it('should make the city less attractive, not just less happy', () => {
    // The happiness line is wired separately. What is wanted here is crime's own term, so the
    // comparison is one city object's attractiveness before and after changing its crime rate,
    // with every other field identical.
    const seenCity = cityAsSeenByNewcomers(0);
    const withCrime: CityAttractiveness = { ...seenCity, crimeRate: seenCity.crimeRate + 40 };
    expect(calculateAttractiveness(withCrime), '犯罪飆高，城市卻一樣吸引人')
      .toBeLessThan(calculateAttractiveness(seenCity));
  });

  it('should shrink how many newcomers this round can take', () => {
    // The consequence the player actually sees: the same empty housing, fewer people willing to
    // come.
    const seenCity = cityAsSeenByNewcomers(0);
    const pop = 18, vacant = 18;
    const capOf = (c: CityAttractiveness) =>
      getImmigrationCap(pop, vacant, calculateAttractiveness(c));
    const plainCap = capOf(seenCity);
    expect(plainCap, '本來就沒有人要搬進來，量不出減少').toBeGreaterThan(0);
    expect(capOf({ ...seenCity, crimeRate: seenCity.crimeRate + 40 }), '犯罪飆高，移民上限卻沒有變小')
      .toBeLessThan(plainCap);
  });

  it('should not move the crime rate when no ordinance is in force', () => {
    // The control: an implementation hardcoding a large crime rate would also satisfy the first
    // test. This city has twenty-odd people and no police station, so baseline crime is
    // population x 0.02 and does not reach 1.
    const a = cityAsSeenByNewcomers(0);
    const b = cityAsSeenByNewcomers(0);
    expect(a.crimeRate, '沒開條例，外地人看到的犯罪率卻是個大數字').toBeLessThan(5);
    // Seeded, with the sequence reset on each build, the two runs are identical. Any difference
    // means something leaked state between A and B.
    expect(a.crimeRate, '同樣的城市兩次跑出不一樣的犯罪率').toBe(b.crimeRate);
  });
});

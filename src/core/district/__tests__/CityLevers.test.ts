import { describe, it, expect } from 'vitest';
import { CityOrdinances } from '../CityOrdinances';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ZoneType } from '../../grid/types';
import { toPosKey } from '../../grid/GridHelpers';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';

/**
 * City ordinances could reach only powerDemand and revenue: the consumers of crime, landValue
 * and garbage asked districts alone. With those three lines wired up, the city scope can express
 * ordinances like the surveillance network and pay-as-you-throw.
 */

/** Temporarily gives one city ordinance a set of effects. What is tested is the wiring, not any
 *  ordinance's current numbers. */
function withCityEffect(tiers: PolicyEffect[], body: (o: CityOrdinances) => void) {
  const type = PolicyType.ENERGY_REGULATION;   // currently the only city ordinance
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  try {
    const o = new CityOrdinances();
    o.setLevel(type, 1);
    body(o);
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

// The whole file is seeded: every test compares two cities, and building growth, layoffs and
// vehicle jitter all roll dice inside a tick. The sequence is reset again when each city is
// built, so A and B start from the same point.
useSeededRandom();

describe('全城條例的三個新槓桿', () => {
  it('should expose a city crime bonus', () => {
    withCityEffect([{ crime: 7 }], o => expect(o.getCrimeBonus()).toBe(7));
  });

  it('should expose a city land value bonus', () => {
    withCityEffect([{ landValue: -4 }], o => expect(o.getLandValueBonus()).toBe(-4));
  });

  it('should expose a city garbage multiplier', () => {
    withCityEffect([{ garbage: 0.6 }], o => expect(o.getGarbageMultiplier()).toBeCloseTo(0.6, 6));
  });

  it('should be the identity when nothing is switched on', () => {
    const o = new CityOrdinances();
    expect(o.getCrimeBonus()).toBe(0);
    expect(o.getLandValueBonus()).toBe(0);
    expect(o.getGarbageMultiplier()).toBe(1);
  });
});

/** Small Shop (COMMERCIAL_LOW). */
const SHOP = 7;

const WORKERS_PER_SHOP = 100;

function cityWithShops() {
  // The A and B cities have to start from the same random state. Without a reset the second
  // continues the sequence the first left behind, the two cities diverge on their own, and what
  // is measured is that divergence rather than the ordinance.
  reseedRandom();
  const state = createGameState(30, 30);
  const loop = new SimulationLoop(state);
  for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 14; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    // Refuse follows actual occupancy — `produceGarbageAndSewage` uses getWorkers rather than
    // building capacity — so a city with no citizens produces zero and the positive control
    // fails first.
    //
    // 100 workers on one cell separate the bag counts: bags are whole numbers, and at small
    // volumes a 20% and a 70% reduction both floor to the same figure.
    for (let i = 0; i < WORKERS_PER_SHOP; i++) {
      state.citizens.restoreCitizen({ workplaceId: toPosKey(x, 11) }, 0);
    }
  }
  return { state, loop };
}

/**
 * Runs a stretch of simulation with one city ordinance carrying the given effects.
 *
 * The restore is in a `finally`: a throw during a tick would otherwise leave the modified
 * `POLICY_EFFECTS` to the rest of the file.
 */
function simulateWithCityEffect(
  state: GameState, loop: SimulationLoop, tiers: PolicyEffect[] | null, ticks: number,
): void {
  if (!tiers) {
    for (let i = 0; i < ticks; i++) loop.tick();
    return;
  }
  const type = PolicyType.ENERGY_REGULATION;
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = tiers;
  state.ordinances.setLevel(type, 1);
  try {
    for (let i = 0; i < ticks; i++) loop.tick();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

describe('三個槓桿真的接進模擬', () => {
  // Buildings are planted straight into cells: updateLandValue and refuse production both skip
  // `buildingId === 0`, and growth requires the cell to have power and water.

  const landValueWith = (tiers: PolicyEffect[] | null) => {
    const { state, loop } = cityWithShops();
    simulateWithCityEffect(state, loop, tiers, 6);
    return state.grid.getCell(10, 11)!.landValue;
  };

  it('should let a city ordinance move land value', () => {
    const plain = landValueWith(null);
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(landValueWith([{ landValue: -20 }]), '全城條例的地價效果沒有進到格子')
      .toBeLessThan(plain);
  });

  it('should let a city ordinance move crime', () => {
    // The line from crime to land value. Crime has three other exits — the overlay, happiness
    // and abandonment stress — which `CrimeIsReal.test.ts` guards.
    expect(landValueWith([{ crime: 20 }]), '全城條例的犯罪效果沒有進到地價')
      .toBeLessThan(landValueWith([{ crime: 0 }]));
  });

  it('should not let a crime reduction create land value out of nothing', () => {
    // `calculateLandValue` is `value -= crimeRate * CRIME_PENALTY`, so a negative crime rate
    // becomes a land value bonus directly. The lower it is pushed the more it earns, and
    // ordinances stack.
    //
    // What is checked is that overshooting buys nothing: two different negative depths must land
    // on the same land value, because both should clamp to 0. Unclamped, -100 gives 20 more
    // land value than -50.
    expect(landValueWith([{ crime: -100 }]), '犯罪壓成負數之後還在繼續加地價')
      .toBe(landValueWith([{ crime: -50 }]));
  });

  /**
   * Refuse under four combinations: nothing on, district only, city only, both.
   *
   * Mutation testing forced this group out: deleting the district multiplier from that line in
   * `ServiceRegistry` and keeping only the city one left all 5,916 tests green. Comparing only
   * whether refuse fell is satisfied by either multiplier alone; checking that they combine
   * requires both together to give less than either on its own.
   */
  const garbageWith = (district: boolean, city: boolean) => {
    const { state, loop } = cityWithShops();
    if (district) {
      const d = state.districts.createDistrict('D');
      for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
      state.policies.setPolicyLevel(d.id, PolicyType.ENCOURAGE_RECYCLING, 3);
    }
    simulateWithCityEffect(state, loop, city ? [{ garbage: 0.5 }] : null, 60);
    return state.garbage.getUncollected();
  };

  it('should let a district policy move garbage production', () => {
    const plain = garbageWith(false, false);
    expect(plain, '沒有垃圾可比，這條測試等於空轉').toBeGreaterThan(0);
    expect(garbageWith(true, false), '分區的回收政策沒有減少垃圾').toBeLessThan(plain);
  });

  it('should let a city ordinance move garbage production', () => {
    expect(garbageWith(false, true), '全城條例沒有減少垃圾')
      .toBeLessThan(garbageWith(false, false));
  });

  it('should multiply the two scopes together', () => {
    const both = garbageWith(true, true);
    expect(both, '兩個都開沒有比只開分區更少').toBeLessThan(garbageWith(true, false));
    expect(both, '兩個都開沒有比只開全城更少').toBeLessThan(garbageWith(false, true));
  });
});

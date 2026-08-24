import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { SIMULATION } from '../../simulation/SimulationConstants';
import { buildOverlayValue, type OverlayBuildContext } from '../../overlay/OverlayBuilders';
import { POLICY_EFFECTS, type PolicyEffect } from '../PolicyManager';
import { PolicyType } from '../types';
import { ZoneType } from '../../grid/types';
import { toPosKey } from '../../grid/GridHelpers';
import { useSeededRandom, reseedRandom } from '../../__tests__/helpers/seededRandom';
import { HAPPINESS } from '../../citizen/Happiness';

/**
 * An ordinance saying Crime +12 while the crime overlay, happiness and abandonment stress show
 * nothing is a UI that lies. Crime reached the land value line alone.
 *
 * What is measured here is crime's four real exits rather than land value.
 */

// The whole file is seeded: every test compares two cities, and building growth, layoffs and
// vehicle jitter all roll dice inside a tick. `city()` resets the sequence on each build, so A
// and B start from the same point.
useSeededRandom();

/** Small House (RESIDENTIAL_LOW). */
const HOUSE = 1;
/** Small Shop (COMMERCIAL_LOW). */
const SHOP = 7;

function city(): { state: GameState; loop: SimulationLoop } {
  // The A and B cities have to start from the same random state. Without a reset the second
  // continues the sequence the first left behind, the two cities diverge on their own, and what
  // is measured is that divergence rather than the ordinance.
  reseedRandom();
  const state = createGameState(30, 30);
  for (let x = 5; x < 20; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 19; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: HOUSE });
    state.grid.setCell(x, 9, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
    for (let i = 0; i < 4; i++) {
      // With a home and a job. Unemployment's penalty starts at -15 and pins happiness to the
      // floor, at which point crime's -10 makes no difference and the test measures nothing.
      state.citizens.restoreCitizen(
        { homeId: toPosKey(x, 11), workplaceId: toPosKey(x, 9) }, 0);
    }
  }
  // Power and water are required. Missing either drops happiness to 0 and abandons the housing
  // on its own, and with both exits already at their floor the ordinance's push is unmeasurable.
  state.power.addPlant({ x: 12, y: 8, output: 100000, pollution: 0, type: 'wind' });
  state.water.addPlant({ x: 13, y: 8, output: 100000 });
  return { state, loop: new SimulationLoop(state) };
}

/** The overlay ctx is GameState plus two commute statistics fields (see
 *  `Game.buildOverlayData`). */
function overlayCtx(state: GameState): OverlayBuildContext {
  return Object.assign(Object.create(state) as OverlayBuildContext, {
    commuteByHome: new Map<string, number>(),
    commuteMax: 1,
  });
}

/** Overlay keys are strings: the `OverlayType` enum lives in the renderer, which core cannot
 *  import. */
function crimeOverlayAt(state: GameState, x: number, y: number): number {
  return buildOverlayValue(overlayCtx(state), 'crime', state.grid.getCell(x, y)!, x, y);
}

/** Temporarily gives a city ordinance a set of effects. What is tested is the wiring, not any
 *  ordinance's current numbers. */
function withCityCrime(state: GameState, crime: number, body: () => void) {
  const type = PolicyType.ENERGY_REGULATION;
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = [{ crime } satisfies PolicyEffect];
  state.ordinances.setLevel(type, 1);
  try {
    body();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

/** The district version, carried by gambling. What is tested is the wiring, not gambling's
 *  current numbers. */
function withDistrictCrime(
  state: GameState, districtId: string, crime: number, body: () => void,
) {
  const type = PolicyType.LEGALIZE_GAMBLING;
  const saved = POLICY_EFFECTS[type];
  (POLICY_EFFECTS as Record<string, unknown>)[type] = [{ crime } satisfies PolicyEffect];
  state.policies.setPolicyLevel(districtId, type, 1);
  try {
    body();
  } finally {
    (POLICY_EFFECTS as Record<string, unknown>)[type] = saved;
  }
}

describe('犯罪圖層看得到條例', () => {
  it('should rise where a district legalises gambling', () => {
    const { state } = city();
    const before = crimeOverlayAt(state, 10, 11);
    expect(before, '圖層本來就是 0，這條測試等於空轉').toBeGreaterThan(0);

    const d = state.districts.createDistrict('D');
    for (let x = 6; x < 12; x++) state.districts.addCellToDistrict(d.id, x, 11);
    state.policies.setPolicyLevel(d.id, PolicyType.LEGALIZE_GAMBLING, 1);

    expect(crimeOverlayAt(state, 10, 11), '賭場區的犯罪圖層沒有變高').toBeGreaterThan(before);
    expect(crimeOverlayAt(state, 15, 11), '分區外的格子也跟著變高了').toBe(before);
  });

  it('should fall city-wide under a surveillance network', () => {
    const { state } = city();
    const before = crimeOverlayAt(state, 15, 11);
    state.ordinances.setLevel(PolicyType.SURVEILLANCE_NETWORK, 2);
    expect(crimeOverlayAt(state, 15, 11), '監視器網路沒有降低犯罪圖層').toBeLessThan(before);
  });
});

describe('犯罪走到幸福度', () => {
  it('should make residents unhappier', () => {
    // The happiness pass is called directly rather than running a whole tick: building growth
    // and abandonment both sample randomly, and mixing them in means the difference between two
    // runs need not come from crime. Existing tests reach into private methods the same way (see
    // `BuildingAbandonment.test.ts`).
    const avgHappinessWith = (crime: number) => {
      const { state, loop } = city();
      // With happiness sliced, one tick recomputes one slice, and reaching every citizen takes
      // SLOW_TICK_INTERVAL ticks (BUG-330). Without advancing the clock the same slice is
      // recomputed.
      const inner = loop as unknown as {
        refreshHappinessContext(): void;
        updateCitizenHappinessSlice(): void;
      };
      const update = () => {
        inner.refreshHappinessContext();
        for (let i = 0; i < SIMULATION.SLOW_TICK_INTERVAL; i++) {
          state.clock.tick++;
          inner.updateCitizenHappinessSlice();
        }
      };
      if (crime !== 0) withCityCrime(state, crime, () => { for (let i = 0; i < 8; i++) update(); });
      else for (let i = 0; i < 8; i++) update();
      const cs = state.citizens.getCitizens();
      return cs.reduce((s, c) => s + c.happiness, 0) / cs.length;
    };
    const plain = avgHappinessWith(0);
    const withCrime = avgHappinessWith(60);
    expect(plain, '幸福度已經是 0，再低也看不出來').toBeGreaterThan(0);
    // Pinned to the constant rather than to "smaller": seeded, the two runs differ only by the
    // ordinance, so the gap is the crime penalty itself. Crime 60 is past the top threshold and
    // takes the heaviest step.
    //
    // A bare toBeLessThan would pass half the time with no wiring at all, which is what this test
    // was before it was seeded.
    const worst = HAPPINESS.CRIME_MODIFIERS[0]!.modifier;
    expect(plain - withCrime, '犯罪飆高，居民卻一樣開心').toBeCloseTo(-worst, 6);
  });
});

describe('犯罪走到棄置壓力', () => {
  // Abandonment's crime threshold is 30, far above a small city's baseline, so only an ordinance
  // pushes past it.
  const abandonedAfter = (
    withPolicy: (state: GameState, districtId: string, run: () => void) => void,
  ) => {
    const { state, loop } = city();
    const d = state.districts.createDistrict('D');
    for (let x = 6; x < 19; x++) state.districts.addCellToDistrict(d.id, x, 11);
    withPolicy(state, d.id, () => { for (let i = 0; i < 120; i++) loop.tick(); });
    let n = 0;
    state.grid.forEachCell((cell) => {
      if (cell.buildingId === HOUSE && cell.reserved !== 0) n++;
    });
    return n;
  };

  it('should stay standing when no ordinance is in force', () => {
    expect(abandonedAfter((_state, _id, run) => run()),
      '什麼都沒開就有房子被棄置，量不到條例的影響').toBe(0);
  });

  it('should push buildings towards abandonment city-wide', () => {
    expect(abandonedAfter((state, _id, run) => withCityCrime(state, 200, run)),
      '全城條例把犯罪飆到 200 也沒有房子撐不住').toBeGreaterThan(0);
  });

  it('should add the two scopes up before deciding the crime is gone', () => {
    // The clamp happens once, after both the city and district terms are added.
    //
    // Clamping the city half first: a baseline of 1 plus a city -100 becomes 0, and the
    // district's +120 on top is 120, far past abandonment's threshold of 30. Clamping after
    // everything gives max(0, 1 - 100 + 120) = 21 and the housing survives. Otherwise one cell
    // reads 21 on the land value line and 120 on the abandonment line: two answers to one
    // question.
    const n = abandonedAfter((state, districtId, run) => {
      withCityCrime(state, -100, () => withDistrictCrime(state, districtId, 120, run));
    });
    expect(n, '全城的減量被提早夾成 0，分區的加量才會把房子壓垮').toBe(0);
  });

  it('should push buildings towards abandonment inside the district that asked for it', () => {
    expect(abandonedAfter((state, id, run) => withDistrictCrime(state, id, 200, run)),
      '分區條例把犯罪飆到 200 也沒有房子撐不住').toBeGreaterThan(0);
  });
});

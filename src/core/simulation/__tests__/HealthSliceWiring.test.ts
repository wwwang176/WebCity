import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { citizenSliceCount, CITIZEN_SLICE_PER_TICK } from '../CitizenSlicing';
import { RoadType, RoadDirection } from '../../road/types';
import { ZoneType } from '../../grid/types';

/**
 * Health also recomputes every citizen in slow slot 4, measured at 28ms for 120,000
 * citizens. Same problem as happiness, same remedy.
 *
 * The two share one slicing hash, so a citizen's happiness and health update on the same
 * tick and their address is looked up once (`homeFactsFor`).
 */

const HOME = '2,2';
const OTHER = '4,2';

function city(citizens: number, homes: string[] = [HOME]): GameState {
  const state = createGameState(30, 30);
  for (let x = 0; x < 30; x++) {
    state.grid.setCell(x, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  for (const h of homes) {
    const [x, y] = h.split(',').map(Number) as [number, number];
    state.grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  state.grid.setCell(8, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    // Addresses must **not** be split by the parity of i: the hash multiplier is odd, so a
    // slice index has the same parity as the id (see CitizenSlicing). Splitting by parity puts
    // exactly one building in each slice, the two buildings are never resolved on the same
    // tick, and a memoization bug that crosses addresses cannot show up.
    state.citizens.restoreCitizen({
      age: 100, homeId: homes[i % 3 === 0 ? homes.length - 1 : 0]!, workplaceId: '8,2',
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 4);
  return state;
}

/** Citizens whose health was recomputed this tick, identified by a NaN sentinel. */
function healthUpdated(state: GameState, loop: SimulationLoop): Set<number> {
  const citizens = state.citizens.getCitizens();
  for (const c of citizens) c.health = NaN;
  loop.tick();
  const hit = new Set<number>();
  for (const c of citizens) if (!Number.isNaN(c.health)) hit.add(c.id);
  return hit;
}

describe('健康的分片', () => {
  it('should update each citizen exactly once per cycle', () => {
    // Counting totals alone would pass "recompute the same batch every tick". Identify
    // citizens individually.
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();
    const n = loop.lastHealthSlice.slices;
    expect(n).toBeGreaterThan(0);

    const before = new Set(state.citizens.getCitizens().map(c => c.id));
    const times = new Map<number, number>();
    for (let t = 0; t < n; t++) {
      for (const id of healthUpdated(state, loop)) times.set(id, (times.get(id) ?? 0) + 1);
    }
    const survivors = state.citizens.getCitizens().filter(c => before.has(c.id));
    expect(survivors.length).toBeGreaterThan(100);
    for (const c of survivors) {
      expect(times.get(c.id) ?? 0, `市民 ${c.id} 一輪裡被算了 ${times.get(c.id) ?? 0} 次`).toBe(1);
    }
  });

  it('should use the slice count the pure function decided', () => {
    // The city has to be large enough that the pure function returns more than the floor,
    // otherwise hardcoding 6 would also pass.
    const pop = CITIZEN_SLICE_PER_TICK * SIMULATION.SLOW_TICK_INTERVAL + 1000;
    const state = city(pop);
    expect(citizenSliceCount(state.citizens.getPopulation()))
      .toBeGreaterThan(SIMULATION.SLOW_TICK_INTERVAL);

    const loop = new SimulationLoop(state);
    loop.tick();
    expect(loop.lastHealthSlice.slices)
      .toBe(citizenSliceCount(state.citizens.getPopulation()));
  });

  it('should update happiness and health for the same citizen on the same tick', () => {
    // The precondition for sharing the address memoization. Split apart, a citizen's address
    // would be resolved twice in one tick.
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    const citizens = state.citizens.getCitizens();
    for (const c of citizens) { c.health = NaN; c.happiness = NaN; }
    loop.tick();

    const healthHit = new Set(citizens.filter(c => !Number.isNaN(c.health)).map(c => c.id));
    const happyHit = new Set(citizens.filter(c => !Number.isNaN(c.happiness)).map(c => c.id));
    expect(healthHit.size).toBeGreaterThan(0);
    expect([...healthHit].sort(), '快樂度與健康算的不是同一批人')
      .toEqual([...happyHit].sort());
  });
});

describe('住址記憶', () => {
  it('should not carry stale environment across ticks', () => {
    // The memoization is cleared every tick. Kept across ticks, power cuts, water shortages
    // and pollution — all visible to the player and able to change abruptly — would lag, and a
    // cycle runs up to 72 ticks.
    const state = city(600);
    const loop = new SimulationLoop(state);
    loop.tick();

    const clean = healthUpdated(state, loop);
    const byId = new Map(state.citizens.getCitizens().map(c => [c.id, c]));
    const cleanHealth = [...clean].map(id => byId.get(id)!.health);

    // Dirty the address before the next tick; the next slice of the same cycle must see it.
    state.grid.setCell(2, 2, { pollution: 255 });

    const dirty = healthUpdated(state, loop);
    const dirtyHealth = [...dirty].map(id => byId.get(id)!.health)
      .filter(h => !Number.isNaN(h));

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(dirtyHealth.length).toBeGreaterThan(0);
    expect(mean(dirtyHealth), `乾淨時 ${mean(cleanHealth).toFixed(1)}，污染 255 之後還是 ${mean(dirtyHealth).toFixed(1)}`)
      .toBeLessThan(mean(cleanHealth));
  });

  it('should keep different addresses apart', () => {
    // With the wrong memoization key (one entry shared city-wide, say), residents of the clean
    // building would be scored as if they lived in the dirty one.
    const state = city(600, [HOME, OTHER]);
    const loop = new SimulationLoop(state);
    for (let t = 0; t < SIMULATION.SLOW_TICK_INTERVAL * 2; t++) loop.tick();
    // The pollution must be set after the medium-frequency block (which recomputes city-wide
    // pollution every 60 ticks), otherwise it is overwritten.
    state.grid.setCell(4, 2, { pollution: 255 });
    for (let t = 0; t < SIMULATION.SLOW_TICK_INTERVAL; t++) loop.tick();

    const citizens = state.citizens.getCitizens();
    const atClean = citizens.filter(c => c.homeId === HOME).map(c => c.health);
    const atDirty = citizens.filter(c => c.homeId === OTHER).map(c => c.health);
    expect(atClean.length).toBeGreaterThan(50);
    expect(atDirty.length).toBeGreaterThan(50);

    // Residents of one building share an age and an environment, so their health values must
    // be identical. If the memoization crosses the two buildings, dirty values appear among
    // the clean ones — barely visible in an average, caught by comparing individually.
    expect(new Set(atClean).size, '同一棟樓的人健康值不一致 —— 記憶串到別的住址了').toBe(1);
    expect(new Set(atDirty).size, '同一棟樓的人健康值不一致 —— 記憶串到別的住址了').toBe(1);
    expect(Math.min(...atClean), '兩棟樓的污染差 255，健康卻一樣')
      .toBeGreaterThan(Math.max(...atDirty));
  });
});

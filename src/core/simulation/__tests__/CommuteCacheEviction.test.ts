import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { LIFE_STAGE_AGE, AGE_PER_TICK } from '../../citizen/types';

/**
 * SimulationLoop's constructor wires `citizens.onEvicted` to drop the evicted
 * citizens' cached commutes. Deleting those three lines left the entire suite
 * green: nothing anywhere observed the wiring.
 *
 * A stale entry is not harmless. A CachedRoute holds LaneEdge objects and a
 * generation number, and the cache is keyed by citizen id — so an id reused
 * after the original was evicted inherits a route between two buildings that
 * citizen has nothing to do with, and the edges keep whatever cells they
 * referenced alive in the ref counts the cache uses to answer invalidateCell.
 */
function cityWithCommuters() {
  const state = createGameState(16, 16);
  for (let x = 1; x <= 12; x++) {
    state.grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  }
  state.grid.setCell(3, 6, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(9, 6, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

  const loop = new SimulationLoop(state);
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const c = state.citizens.createCitizen({ age: 100 })!;
    c.homeId = '3,6';
    c.workplaceId = '9,6';
    ids.push(c.id);
  }
  return { state, loop, ids };
}

/** A cached commute for `id`, of the shape the pathfinder stores. */
function cacheRoute(loop: SimulationLoop, id: number): void {
  const cache = (loop as unknown as { commuteCache: {
    set(id: number, r: unknown): void; get(id: number): unknown;
  } }).commuteCache;
  cache.set(id, {
    citizenId: id, homeId: '3,6', workplaceId: '9,6',
    morningPath: null, eveningPath: null, status: 'pending', generation: 0,
  });
}

const cached = (loop: SimulationLoop, id: number): boolean =>
  (loop as unknown as { commuteCache: { get(id: number): unknown } })
    .commuteCache.get(id) !== undefined;

describe('evicting a citizen drops their cached commute', () => {
  it('should be cached to begin with', () => {
    // Without this every assertion below would pass on an empty cache.
    const { loop, ids } = cityWithCommuters();
    for (const id of ids) cacheRoute(loop, id);
    expect(ids.every(id => cached(loop, id))).toBe(true);
  });

  it('should clear the entry when the building is demolished', () => {
    const { state, loop, ids } = cityWithCommuters();
    for (const id of ids) cacheRoute(loop, id);

    const evicted = state.citizens.evictBuilding('3,6', state.clock.tick);

    expect(evicted, 'the fixture evicted nobody').not.toHaveLength(0);
    for (const id of evicted) {
      expect(cached(loop, id), `citizen ${id} kept a route to a building that is gone`).toBe(false);
    }
  });

  it('should leave everyone else alone', () => {
    // The control: without it, "clear on eviction" would be satisfiable by
    // clearing the whole cache, which throws away every commute in the city.
    const { state, loop, ids } = cityWithCommuters();
    const bystander = state.citizens.createCitizen({ age: 100 })!;
    bystander.homeId = '9,6';
    for (const id of [...ids, bystander.id]) cacheRoute(loop, id);

    state.citizens.evictBuilding('3,6', state.clock.tick);

    expect(cached(loop, bystander.id)).toBe(true);
  });

  it('should clear the entry when a citizen retires', () => {
    // The second onEvicted caller. A retiree keeps their home and loses their
    // job, so the cached home-to-work route is stale in a different way.
    const { state, loop } = cityWithCommuters();
    const worker = state.citizens.createCitizen({ age: 100 })!;
    worker.homeId = '3,6';
    worker.workplaceId = '9,6';
    cacheRoute(loop, worker.id);

    // updateAges recomputes age from birthTick rather than reading the field,
    // so retiring someone means backdating their birth, not setting `age`.
    worker.birthTick = -Math.ceil((LIFE_STAGE_AGE.ADULT_MAX + 10) / AGE_PER_TICK);
    state.citizens.updateAges(0);

    expect(worker.workplaceId, 'the citizen was not retired, so this proves nothing').toBeNull();
    expect(cached(loop, worker.id), 'a retiree kept a route to a job they no longer have')
      .toBe(false);
  });
});

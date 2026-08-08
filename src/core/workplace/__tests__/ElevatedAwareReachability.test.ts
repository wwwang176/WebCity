import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { WorkplaceDistanceCache } from '../WorkplaceDistanceCache';
import { WorkplaceDistanceClient } from '../WorkplaceDistanceClient';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';
import { ZoneType } from '../../grid/types';

/**
 * The workplace-distance worker is handed only the grid buffer, whose roadType
 * byte is the GROUND layer. Elevated segments live in ElevationManager and are
 * invisible to it, while the synchronous fallback is given _roadLookup and IS
 * level-aware. In a city where a viaduct is the only link between a district and
 * its jobs the two disagreed outright, and residents lost their jobs whenever
 * the cache happened to be ready and got them back when it went stale
 * (BUG-109).
 *
 * The first version of this file asserted `em.hasAnySegment()` twice — a bare
 * Map.size check that never constructed a reachability decision — and then
 * asserted `cache.isReady === false` after ticking. That third case was vacuous
 * three times over: the fixture zoned no buildings, so workplaceCandidates was
 * empty and assignCitizenHousing returned before reaching the guard; the guard
 * gates requestUpdate, which sets COMPUTING, while isReady is false for both
 * EMPTY and COMPUTING; and the fake worker never fires onmessage, so the cache
 * could never become READY under any implementation. All three passed with the
 * fix reverted.
 *
 * These warm the cache directly with populateSync — ground-only distances, i.e.
 * exactly what the worker would have produced — and then observe whether
 * citizens keep the jobs the viaduct connects them to.
 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

const HOME = '2,2';
const WORK = '12,2';

/**
 * Power, water and a park on both sides.
 *
 * Not decoration: without them a jobless citizen's happiness collapses inside
 * one slow cycle and runMigration — which runs at the same slot, BEFORE
 * assignCitizenHousing — emigrates them before the assignment pass ever sees
 * them. The fixture emptied itself and the assertion had nobody to observe.
 */
function serviceBothSides(state: ReturnType<typeof createGameState>): void {
  state.power.addPlant({ x: 1, y: 5, output: 2000, pollution: 0, type: 'solar' });
  state.water.addPlant({ x: 2, y: 5, output: 2000 });
  state.parks.addPark(2, 4);
  state.parks.addPark(12, 4);
}

/**
 * Two districts with no ground road between them, bridged only by a viaduct.
 *
 *   (1,3)…(3,3)    west street, houses above it at y=2
 *   (11,3)…(13,3)  east street, a shop above it at y=2
 *   x=4..10 @ y=3  NOTHING on the ground — the gap
 *   the viaduct at level 1 spans the gap, with a ramp at each end
 */
function bridgedCity() {
  const state = createGameState(20, 20);
  const rb = new RoadBuilder(state.grid);
  rb.buildRoad({ x: 1, y: 3 }, { x: 3, y: 3 }, RoadType.TWO_LANE, 1e6);
  rb.buildRoad({ x: 11, y: 3 }, { x: 13, y: 3 }, RoadType.TWO_LANE, 1e6);

  state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(12, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  serviceBothSides(state);

  const em = new ElevationManager();
  const seg = (isRamp: boolean, ascend: number) => ({
    roadType: RoadType.TWO_LANE, roadFlags: 12, railType: RailType.NONE, railFlags: 0,
    isRamp, rampAscendDirection: ascend,
  });
  const EAST = 0b1000, WEST = 0b0100;
  em.set(3, 3, 1, seg(true, EAST));
  for (let x = 4; x <= 10; x++) em.set(x, 3, 1, seg(false, 0));
  em.set(11, 3, 1, seg(true, WEST));

  const loop = new SimulationLoop(state);
  loop.setElevationManager(em);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, em));

  const cache = new WorkplaceDistanceCache(
    new WorkplaceDistanceClient(new FakeWorker() as unknown as Worker),
  );
  // What the ground-only worker WOULD return: the shop is reachable from
  // nowhere, because on the ground the two districts are separate components.
  cache.populateSync([{ workplacePos: WORK, distances: {} }]);
  expect(cache.isReady).toBe(true);
  loop.setWorkplaceDistanceCache(cache);

  const citizen = state.citizens.createCitizen({ age: 100 })!;
  citizen.homeId = HOME;

  return { state, loop, em, cache, citizen };
}

/**
 * Whether ANYONE ended up working at the shop.
 *
 * Not "did this particular citizen get the job": a jobless citizen in a city
 * with no services is unhappy, and runMigration — which runs at the same slow
 * slot, BEFORE assignCitizenHousing — emigrates them before the assignment pass
 * ever sees them. Migration keeps supplying replacements, so the question that
 * survives the churn is whether the job across the viaduct is reachable at all.
 */
function anyoneEmployedAtShop(state: ReturnType<typeof bridgedCity>['state']): boolean {
  return state.citizens.getCitizens().some(c => c.workplaceId === WORK);
}

describe('workplace reachability is elevation-aware', () => {
  it('should employ someone whose only route to work is a viaduct', () => {
    // The cache says unreachable; the level-aware fallback says reachable. The
    // guard is what makes the fallback win.
    const { state, loop } = bridgedCity();

    for (let i = 0; i < 24; i++) loop.tick();

    expect(state.citizens.getPopulation()).toBeGreaterThan(0);
    expect(anyoneEmployedAtShop(state)).toBe(true);
  });

  it('should leave the ready cache untouched rather than clearing it', () => {
    // The guard must decline to USE the cache, not invalidate it — throwing the
    // table away would make the next flat-city tick pay for a full rebuild.
    const { loop, cache } = bridgedCity();

    for (let i = 0; i < 24; i++) loop.tick();

    expect(cache.isReady).toBe(true);
  });

  it('should still use the cache in a city with no elevated road', () => {
    // Negative control. Without it, "ignore the cache" would be satisfiable by
    // never using the cache at all, which is the whole optimisation gone.
    const state = createGameState(20, 20);
    new RoadBuilder(state.grid).buildRoad({ x: 1, y: 3 }, { x: 13, y: 3 }, RoadType.TWO_LANE, 1e6);
    state.grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    state.grid.setCell(12, 2, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    serviceBothSides(state);

    const em = new ElevationManager();
    const loop = new SimulationLoop(state);
    loop.setElevationManager(em);
    loop.setRoadLookup(new UnifiedRoadLookup(state.grid, em));

    const cache = new WorkplaceDistanceCache(
      new WorkplaceDistanceClient(new FakeWorker() as unknown as Worker),
    );
    // A cache that LIES: it claims the shop is unreachable although the ground
    // road plainly connects it. If the loop consults the cache, the citizen
    // stays jobless; if it ignores the cache, they get the job.
    cache.populateSync([{ workplacePos: WORK, distances: {} }]);
    loop.setWorkplaceDistanceCache(cache);

    state.citizens.createCitizen({ age: 100 })!.homeId = HOME;

    // The jobless citizen is emigrated and replaced repeatedly — that is the
    // point of the case — so the FINAL population is not a useful witness.
    // Record whether anyone was ever there to be assigned, and whether anyone
    // ever got the job.
    let everHadCitizens = false;
    let everEmployed = false;
    for (let i = 0; i < 24; i++) {
      loop.tick();
      if (state.citizens.getPopulation() > 0) everHadCitizens = true;
      if (state.citizens.getCitizens().some(c => c.workplaceId === WORK)) everEmployed = true;
    }

    expect(everHadCitizens).toBe(true);
    expect(everEmployed).toBe(false);
  });

  it('should not disable the cache for an elevated RAIL line', () => {
    // hasAnySegment() is a bare layers.size check and elevated rail lives in
    // the same map with roadType NONE. One elevated metro tile used to disable
    // the cache for an otherwise entirely flat city — permanently, since
    // nothing ever removes it — costing a budgeted Dijkstra per unemployed
    // home every slow cycle.
    const em = new ElevationManager();
    em.set(5, 6, 1, {
      roadType: RoadType.NONE, roadFlags: 0, railType: RailType.STANDARD, railFlags: 12,
      isRamp: false, rampAscendDirection: 0,
    });

    expect(em.hasAnySegment()).toBe(true);
    expect(em.hasAnyElevatedRoad()).toBe(false);
  });

  it('should disable the cache for an elevated road', () => {
    const em = new ElevationManager();
    em.set(5, 6, 1, {
      roadType: RoadType.TWO_LANE, roadFlags: 12, railType: RailType.NONE, railFlags: 0,
      isRamp: false, rampAscendDirection: 0,
    });

    expect(em.hasAnyElevatedRoad()).toBe(true);
  });
});

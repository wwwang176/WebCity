import { describe, it, expect, vi } from 'vitest';
import { useSeededRandom } from '../../__tests__/helpers/seededRandom';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ElevationManager } from '../../elevation/ElevationManager';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { WorkplaceDistanceCache } from '../WorkplaceDistanceCache';
import { WorkplaceDistanceTableBuilder } from '../WorkplaceDistanceTable';
import { WorkplaceDistanceClient } from '../WorkplaceDistanceClient';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';
import { ZoneType } from '../../grid/types';
import { computeWorkplaceDistances } from '../../../workers/workplace-distance.worker';
import { roadDistanceToTargets } from '../../service/RoadCoverageFlood';
import { buildRoadCellGraph, transposeRoadCellGraph } from '../../road/RoadCellGraph';
import { serializeRoadCellGraph } from '../../road/RoadCellGraphBuffer';
import { DEFAULT_JOB_RELOCATION_CONFIG } from '../../citizen/JobRelocation';
import type { WDWorkerRequest } from '../WorkplaceDistanceTypes';

/**
 * The acceptance test for BUG-109.
 *
 * The worker received only a grid buffer and could not see elevated roads while the synchronous
 * fallback was level-aware, so in a city where an elevated road is the only route the two gave
 * opposite answers and citizens gained and lost jobs as the cache went READY and stale. The
 * response at the time was a gate: any elevated road cell disabled the cache entirely.
 *
 * **This file tested that gate rather than the behaviour.** It installed a lying ground-only
 * cache (`distances: {}`) and asserted citizens still had jobs, which passed because the gate let
 * the fallback win. Remove the gate and the lie is believed, and the test turns red.
 *
 * It now warms up through the **real pipeline**: build the graph, transpose it, serialise it, and
 * run `reverseFloodFromGraph` synchronously inside a FakeWorker to fill it in. What is asserted
 * is that **the cache is itself level-aware**, which is the acceptance condition for the
 * underlying fix.
 *
 * Three tests were removed:
 *   - leave the ready cache untouched — the gate's "refuse but do not clear" semantics, now gone
 *   - not disable the cache for elevated RAIL
 *   - disable the cache for an elevated road
 * The last two tested `ElevationManager`'s predicate and moved to
 * `elevation/__tests__/ElevationManager.test.ts`.
 */
/** A stub that never replies, for negative controls that need no real computation. */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

/**
 * Really runs the worker's computation, replying synchronously.
 *
 * The reply cannot be lost, because `WorkplaceDistanceClient` registers the pending entry before
 * posting, but `.then(applyResult)` is still queued as a **microtask**, so the test has to await
 * once; see `flush()`.
 */
class ComputingFakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  /** The last graph received, used to check the main thread sends the **transposed** one. */
  lastGraphBuffer: ArrayBuffer | null = null;
  postMessage(req: WDWorkerRequest): void {
    if (req.type !== 'COMPUTE') return;
    this.lastGraphBuffer = req.graphBuffer;
    const view = new DataView(req.gridBuffer as ArrayBuffer);
    const isBuilding = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= req.gridWidth || y >= req.gridHeight) return false;
      return view.getUint8((y * req.gridWidth + x) * 12 + 5) === 0;
    };
    const table = computeWorkplaceDistances(
      req.graphBuffer, req.workplaces, req.maxBudget, req.gridWidth, req.gridHeight, isBuilding);
    this.onmessage?.({ data: { type: 'RESULT', requestId: req.requestId, table } });
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}

/** Lets the queued microtasks run. */
const flush = (): Promise<void> => new Promise(r => { setTimeout(r, 0); });

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
  // The elevated road is HIGHWAY at 9 per cell and the ground TWO_LANE at 36.
  // **The road types have to differ**: with one type throughout, the forward and transposed
  // graphs have identical edge sets and sending the wrong one is undetectable (which is how
  // BUG-237 was missed).
  const seg = (isRamp: boolean, ascend: number) => ({
    roadType: RoadType.HIGHWAY, roadFlags: 12, railType: RailType.NONE, railFlags: 0,
    isRamp, rampAscendDirection: ascend,
  });
  const EAST = 0b1000, WEST = 0b0100;
  em.set(3, 3, 1, seg(true, EAST));
  for (let x = 4; x <= 10; x++) em.set(x, 3, 1, seg(false, 0));
  em.set(11, 3, 1, seg(true, WEST));

  const loop = new SimulationLoop(state);
  loop.setElevationManager(em);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, em));

  // Really computed, with no lying cache installed: the cache reaches READY only by walking the
  // whole pipeline itself.
  const worker = new ComputingFakeWorker();
  const cache = new WorkplaceDistanceCache(
    new WorkplaceDistanceClient(worker as unknown as Worker),
  );
  loop.setWorkplaceDistanceCache(cache);

  const citizen = state.citizens.createCitizen({ age: 100 })!;
  citizen.homeId = HOME;

  return { state, loop, em, cache, citizen, worker };
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
  // These cases run real ticks and lean on migration to keep supplying
  // candidates for the job across the bridge — see anyoneEmployedAtShop. That
  // makes them a draw on Math.random, and they failed roughly one full-suite
  // run in five once the attractiveness weighting stopped rewarding jobs
  // nobody can reach (BUG-166): this fixture starts at 100% unemployment by
  // construction, which is exactly the state that change damps.
  useSeededRandom();

  it('should employ someone whose only route to work is a viaduct, from the cache', async () => {
    // BUG-109's acceptance condition. This relied on the "elevated roads disable the cache" gate;
    // the cache is now level-aware itself, so what is asserted is that **the cache really reaches
    // READY, is really read, and gives an answer that fills the job on the far side of the
    // viaduct**.
    const { state, loop, cache } = bridgedCity();

    // requestUpdate runs on a slow slot, so ticks continue until it happens.
    // A flush after each tick: ComputingFakeWorker replies synchronously, but
    // `.then(applyResult)` is queued as a microtask.
    for (let i = 0; i < 24 && !cache.isReady; i++) { loop.tick(); await flush(); }
    expect(cache.isReady, '快取沒有變成 READY —— 高架城市仍然沒在用快取').toBe(true);

    // Observation starts after READY, or what is seen is the synchronous fallback's result.
    //
    // The spy is on getReachableWorkplaces, the method the **assignment** path
    // (buildWorkplaceReachabilityFromCache) actually calls. The job-change path uses
    // getDistancesFromHome, which runs once every 120 ticks and is too far away to wait for.
    const spy = vi.spyOn(cache, 'getReachableWorkplaces');
    for (let i = 0; i < 24; i++) { loop.tick(); await flush(); }

    expect(spy, '快取 READY 了卻沒有被讀 —— 這條測的其實是 fallback')
      .toHaveBeenCalled();
    expect(state.citizens.getPopulation()).toBeGreaterThan(0);
    expect(anyoneEmployedAtShop(state), '高架另一端的工作沒有人做').toBe(true);
  });

  it('should give the cache the same answer as the synchronous query', async () => {
    // The two paths agreeing is what the underlying fix means. One home and workplace on either
    // side of the viaduct are compared directly.
    const { loop, cache, state } = bridgedCity();
    for (let i = 0; i < 24 && !cache.isReady; i++) { loop.tick(); await flush(); }
    expect(cache.isReady, '快取沒有變成 READY').toBe(true);

    const lookup = loop.getRoadLookup()!;
    const [hx, hy] = HOME.split(',').map(Number);
    const sync = roadDistanceToTargets(
      state.grid, { x: hx!, y: hy! }, new Set([WORK]),
      DEFAULT_JOB_RELOCATION_CONFIG.dijkstraMaxBudget, lookup, buildRoadCellGraph(lookup),
    );
    expect(sync.get(WORK), '同步查詢自己就到不了，這條測不出東西').toBeDefined();
    expect(cache.getDistance(HOME, WORK), '快取與同步查詢不一致').toBe(sync.get(WORK));
  });

  it('should hand the worker the transposed graph, not the forward one', async () => {
    // A wiring test. The transpose's own correctness is guarded exhaustively by
    // WorkerGraphParity, which compares every home and workplace pair; what is guarded here is
    // that **the main thread sends the right one**.
    //
    // Why not through employment: bridgedCity's HOME and WORK both attach directly to elevated
    // cells and the route uses no on-and-off-the-bridge edge that would differ by direction, so
    // sending the wrong graph gives that pair the same cost and a behavioural test would be
    // vacuous. Comparing the buffers directly discriminates.
    const { loop, cache, worker } = bridgedCity();
    for (let i = 0; i < 24 && !cache.isReady; i++) { loop.tick(); await flush(); }
    expect(worker.lastGraphBuffer, 'worker 根本沒收到圖').not.toBeNull();

    const g = buildRoadCellGraph(loop.getRoadLookup()!);
    const expected = serializeRoadCellGraph(transposeRoadCellGraph(g));
    const forward = serializeRoadCellGraph(g);
    // Fixture sanity: the two have to differ, or this discriminates nothing.
    expect([...new Uint8Array(expected)], 'fixture 的圖是對稱的，這條測不出東西')
      .not.toEqual([...new Uint8Array(forward)]);

    expect([...new Uint8Array(worker.lastGraphBuffer!)], '傳給 worker 的不是轉置圖')
      .toEqual([...new Uint8Array(expected)]);
  });

  it('fixture sanity: bridgedCity really mixes road tiers', () => {
    // With one road type throughout, the forward and transposed graphs are identical and sending
    // the wrong one is undetectable.
    const { loop } = bridgedCity();
    const g = buildRoadCellGraph(loop.getRoadLookup()!);
    expect(new Set(g.weights).size, 'bridgedCity 只有一種路型 —— 正反向圖無法區分')
      .toBeGreaterThan(1);
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
    const liar = new WorkplaceDistanceTableBuilder(state.grid.width, state.grid.height);
    liar.addWorkplace(WORK, new Int32Array(state.grid.width * state.grid.height).fill(-1));
    cache.populateSync(liar.build());
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

});

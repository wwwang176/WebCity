import { describe, it, expect, vi } from 'vitest';
import { SimulationLoop } from '../../core/simulation/SimulationLoop';
import { createGameState, type GameState } from '../../core/simulation/GameState';
import { ZoneType } from '../../core/grid/types';
import { RoadType } from '../../core/road/types';
import { BURNED } from '../../core/building/InfraPlacement';
import { useSeededRandom } from '../../core/__tests__/helpers/seededRandom';

/**
 * The fine-grained callbacks let the renderer touch one instance instead of
 * rebuilding every building mesh, so a callback that stops firing is a silent
 * frame-rate regression rather than a visible break.
 *
 * Three of these five cases wrapped every assertion in
 * `if (cb.mock.calls.length > 0)`, which is a test that passes hardest exactly
 * when the thing it checks is broken. They could not have fired anyway: the
 * fixtures called `state.power.addPlant(0, 0, 'coal')`, passing `0` where a
 * PowerPlant object is expected, so the city had neither power nor water and
 * nothing could grow or upgrade.
 *
 * The RNG is seeded and every assertion is unconditional. Where the fixture
 * makes it possible, each case also checks the world actually changed at the
 * cell the callback named — but only where that check can fail: an earlier
 * version asserted `buildingId > 0` in the upgrade case on a fixture that
 * pre-sets `buildingId: 1` everywhere, which is a check that cannot fail.
 */
function makeTestState(size = 10) {
  return createGameState(size, size);
}

function provideUtilities(state: GameState, x: number, y: number): void {
  state.power.addPlant({ x, y, output: 5000, pollution: 0, type: 'solar' });
  state.water.addPlant({ x, y, output: 5000 });
  state.power.calculateCoverage(state.grid);
  state.water.calculateCoverage(state.grid);
}

/** Alternating rows of zoned cells and roads, so every zone touches a road. */
function zonedCity(state: GameState, cell: Parameters<GameState['grid']['setCell']>[2]): void {
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
      if (y % 2 === 0) state.grid.setCell(x, y, cell);
      else state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    }
  }
}

describe('SimulationLoop fine-grained building callbacks', () => {
  useSeededRandom();

  it('fires onBuildingAdded when a building grows', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const addedCb = vi.fn();
    loop.onBuildingAdded = addedCb;

    zonedCity(state, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 0 });
    provideUtilities(state, 5, 5);
    state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

    for (let i = 0; i < 600 && addedCb.mock.calls.length === 0; i++) loop.tick();

    expect(addedCb).toHaveBeenCalled();
    const [x, y, zoneType, level] = addedCb.mock.calls[0]!;
    // The reported cell must be one that really holds a building now — a
    // callback with plausible-looking numbers is exactly what the old
    // `typeof x === 'number'` check could not tell apart from a real one.
    expect(state.grid.getCell(x as number, y as number)!.buildingId).toBeGreaterThan(0);
    expect(zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
    expect(level).toBeGreaterThanOrEqual(1);
    expect(level).toBeLessThanOrEqual(3);
  });

  it('fires onBuildingRemoved when a burned ruin is cleared', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const removedCb = vi.fn();
    loop.onBuildingRemoved = removedCb;

    zonedCity(state, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
    state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

    for (let i = 0; i < 600 && removedCb.mock.calls.length === 0; i++) loop.tick();

    expect(removedCb).toHaveBeenCalled();
    const [x, y] = removedCb.mock.calls[0]!;
    const cell = state.grid.getCell(x as number, y as number)!;
    expect(cell.reserved, 'the reported cell must no longer be a ruin').not.toBe(BURNED);
  });

  it('fires onBuildingUpdated when a building upgrades', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const updatedCb = vi.fn();
    loop.onBuildingUpdated = updatedCb;

    zonedCity(state, {
      zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, serviceCoverage: 6, landValue: 90,
    });
    provideUtilities(state, 5, 5);

    for (let i = 0; i < 600 && updatedCb.mock.calls.length === 0; i++) loop.tick();

    expect(updatedCb).toHaveBeenCalled();
    const [x, y, zoneType, level, burned] = updatedCb.mock.calls[0]!;
    expect(zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
    expect(typeof burned).toBe('boolean');
    // The cell must actually have moved off the level-1 building the fixture
    // seeded, and the level reported must be the one it moved to. `buildingId
    // > 0` was the previous check and could not fail — every cell starts at 1.
    const cell = state.grid.getCell(x as number, y as number)!;
    expect(cell.buildingId, 'the reported cell did not change').not.toBe(1);
    expect(level).toBeGreaterThan(1);
  });

  it('callbacks are optional and do not throw when unset', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    expect(() => {
      for (let i = 0; i < 120; i++) loop.tick();
    }).not.toThrow();
  });

  it('raises the coarse callback whenever a fine-grained one fires', () => {
    // The renderer uses the fine-grained callbacks and the coarse one for
    // different work; a change that reached only one of them would leave half
    // the scene stale.
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const coarseCb = vi.fn();
    const fineCb = vi.fn();
    loop.onBuildingsChanged = coarseCb;
    loop.onBuildingRemoved = fineCb;

    zonedCity(state, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED });
    state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

    for (let i = 0; i < 600 && fineCb.mock.calls.length === 0; i++) loop.tick();

    expect(fineCb, 'nothing was removed, so the case proves nothing').toHaveBeenCalled();
    expect(coarseCb).toHaveBeenCalled();
  });
});

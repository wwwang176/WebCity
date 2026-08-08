import { describe, it, expect, vi } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState, type GameState } from '../GameState';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { BURNED, ABANDONED } from '../../building/InfraPlacement';
import { useSeededRandom } from '../../__tests__/helpers/seededRandom';
import { SIMULATION } from '../SimulationConstants';

/**
 * `onBuildingsChanged` is what tells the renderer a building mesh is stale. Four
 * separate paths raise it — growth, fire damage, upgrade, abandonment — and
 * three of the four had no working test.
 *
 * The originals ran 300-600 ticks hoping a random roll would fire the callback,
 * then asserted nothing at all: one assigned `initialCalls` and never read it,
 * one assigned `fires` and never read it, one ended on the comment "May or may
 * not have fired depending on random cell selection". They could not fail. The
 * setup was broken too — `state.power.addPlant(4, 4, 'coal')` passes `4` where a
 * PowerPlant object is expected, so the cities had no power and could not have
 * grown even if the assertions had existed.
 *
 * These seed the RNG and assert the observable consequence as well as the
 * callback, so a callback that fires without the building actually changing
 * fails too.
 */
function makeTestState(size = 10) {
  return createGameState(size, size);
}

/** Power and water reaching (x, y), placed clear of the cell under test. */
function provideUtilities(state: GameState, x: number, y: number): void {
  state.power.addPlant({ x, y, output: 5000, pollution: 0, type: 'solar' });
  state.water.addPlant({ x, y, output: 5000 });
  state.power.calculateCoverage(state.grid);
  state.water.calculateCoverage(state.grid);
}

describe('SimulationLoop render-dirty callbacks', () => {
  useSeededRandom();

  describe('onBuildingsChanged', () => {
    it('fires when a building grows, and only once something has grown', () => {
      const state = makeTestState(12);
      const loop = new SimulationLoop(state);
      const cb = vi.fn();
      loop.onBuildingsChanged = cb;

      // A row of zoned cells along a road, so growth has many chances per tick.
      for (let x = 1; x <= 8; x++) {
        state.grid.setCell(x, 5, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 0 });
        state.grid.setCell(x, 4, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
      }
      provideUtilities(state, 5, 5);
      state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

      const grown = () => {
        let n = 0;
        for (let x = 1; x <= 8; x++) if ((state.grid.getCell(x, 5)?.buildingId ?? 0) > 0) n++;
        return n;
      };

      expect(grown(), 'nothing may have grown before the first tick').toBe(0);
      for (let i = 0; i < 600 && grown() === 0; i++) loop.tick();

      // If the city never grew the callback assertion below would be vacuous.
      expect(grown(), 'the fixture must be able to grow at all').toBeGreaterThan(0);
      expect(cb).toHaveBeenCalled();
    });

    it('fires when a burned building is cleared, and the ruin is gone', () => {
      const state = makeTestState();
      const loop = new SimulationLoop(state);
      const cb = vi.fn();
      loop.onBuildingsChanged = cb;

      for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
          state.grid.setCell(x, y, {
            zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: BURNED,
          });
          state.grid.setCell(x, Math.min(y + 1, 9), { roadType: RoadType.TWO_LANE });
        }
      }
      state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

      const burned = () => {
        let n = 0;
        state.grid.forEachCell(c => { if (c.reserved === BURNED) n++; });
        return n;
      };
      const before = burned();
      expect(before).toBeGreaterThan(0);

      for (let i = 0; i < 600; i++) loop.tick();

      expect(cb.mock.calls.length).toBeGreaterThan(0);
      // The developer clears ruins at 2% per growth tick, so some must be gone.
      expect(burned()).toBeLessThan(before);
    });

    it('fires when fire damage burns a building down', () => {
      const state = makeTestState();
      const loop = new SimulationLoop(state);
      const cb = vi.fn();
      loop.onBuildingsChanged = cb;

      state.grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      // No fire station anywhere, so the fire is uncovered and burns to the
      // maximum damage the resolver assigns.
      const report = state.fire.reportFire(3, 3);
      expect(report.covered, 'an uncovered fire is what this case needs').toBe(false);

      for (let i = 0; i < 600 && state.grid.getCell(3, 3)!.reserved !== BURNED; i++) {
        loop.tick();
      }

      expect(state.grid.getCell(3, 3)!.reserved).toBe(BURNED);
      expect(cb).toHaveBeenCalled();
    });

    it('fires when a building is abandoned', () => {
      const state = makeTestState();
      const loop = new SimulationLoop(state);
      const cb = vi.fn();
      loop.onBuildingsChanged = cb;

      // A building with no road, no power and no water accumulates abandonment
      // stress every cycle until it is given up.
      state.grid.setCell(5, 5, {
        zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, landValue: 0, serviceCoverage: 0,
      });

      for (let i = 0; i < 2000 && state.grid.getCell(5, 5)!.reserved !== ABANDONED; i++) {
        loop.tick();
      }

      expect(state.grid.getCell(5, 5)!.reserved).toBe(ABANDONED);
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('onTerrainChanged', () => {
    it('fires on a fixed period, not on every tick', () => {
      const state = makeTestState();
      const loop = new SimulationLoop(state);
      state.grid.setCell(5, 5, { zoneType: ZoneType.INDUSTRIAL, buildingId: 1 });

      // Record WHICH ticks it fires on. Counting calls alone would pass for an
      // implementation that fired every tick, which is the regression that
      // matters here — the renderer rebuilds terrain colours on this signal.
      const firedAt: number[] = [];
      loop.onTerrainChanged = () => { firedAt.push(state.clock.tick); };

      for (let i = 0; i < 200; i++) loop.tick();

      expect(firedAt.length, 'must fire more than once over 200 ticks').toBeGreaterThan(1);
      const gaps = firedAt.slice(1).map((t, i) => t - firedAt[i]!);
      expect(new Set(gaps).size, `uneven period: ${gaps.join(',')}`).toBe(1);
      expect(gaps[0]).toBe(SIMULATION.MEDIUM_TICK_INTERVAL);
    });
  });

  describe('callbacks are optional', () => {
    it('does not throw when callbacks are not set', () => {
      const state = makeTestState();
      const loop = new SimulationLoop(state);
      expect(() => {
        for (let i = 0; i < 120; i++) loop.tick();
      }).not.toThrow();
    });
  });
});

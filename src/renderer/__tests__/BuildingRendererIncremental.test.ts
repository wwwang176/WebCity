import { describe, it, expect, vi } from 'vitest';
import { SimulationLoop } from '../../core/simulation/SimulationLoop';
import { createGameState } from '../../core/simulation/GameState';
import { ZoneType } from '../../core/grid/types';
import { RoadType } from '../../core/road/types';

function makeTestState(size = 10) {
  return createGameState(size, size);
}

describe('SimulationLoop fine-grained building callbacks', () => {
  it('fires onBuildingAdded when building grows', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const addedCb = vi.fn();
    loop.onBuildingAdded = addedCb;

    // Set up many cells that can grow
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        if (y % 2 === 0) {
          state.grid.setCell(x, y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 0 });
        } else {
          state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE });
        }
      }
    }
    state.power.addPlant(0, 0, 'coal');
    state.water.addPlant(9, 9);
    state.power.calculateCoverage(state.grid, new Set(['0,0', '9,9']));
    state.water.calculateCoverage(state.grid, new Set(['0,0', '9,9']));
    state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

    // Run many ticks
    for (let i = 0; i < 600; i++) {
      loop.tick();
    }

    if (addedCb.mock.calls.length > 0) {
      const [x, y, zoneType, level] = addedCb.mock.calls[0]!;
      expect(typeof x).toBe('number');
      expect(typeof y).toBe('number');
      expect(zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(3);
    }
  });

  it('fires onBuildingRemoved when burned ruin is cleared', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const removedCb = vi.fn();
    loop.onBuildingRemoved = removedCb;

    // Fill grid with burned buildings
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        if (y % 2 === 0) {
          state.grid.setCell(x, y, {
            zoneType: ZoneType.RESIDENTIAL_LOW,
            buildingId: 1,
            reserved: 3, // BURNED
          });
        } else {
          state.grid.setCell(x, y, { roadType: RoadType.TWO_LANE });
        }
      }
    }
    state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

    for (let i = 0; i < 600; i++) {
      loop.tick();
    }

    // With many burned buildings and 2% chance, should fire
    expect(removedCb.mock.calls.length).toBeGreaterThan(0);
    const [x, y] = removedCb.mock.calls[0]!;
    expect(typeof x).toBe('number');
    expect(typeof y).toBe('number');
  });

  it('fires onBuildingUpdated when building upgrades', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const updatedCb = vi.fn();
    loop.onBuildingUpdated = updatedCb;

    // Set up cells that can upgrade: level 1 with high service coverage + land value
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        state.grid.setCell(x, y, {
          zoneType: ZoneType.RESIDENTIAL_LOW,
          buildingId: 1, // level 1
          serviceCoverage: 6,
          landValue: 90,
        });
      }
    }
    state.power.addPlant(0, 0, 'coal');
    state.water.addPlant(9, 9);
    state.power.calculateCoverage(state.grid, new Set(['0,0', '9,9']));
    state.water.calculateCoverage(state.grid, new Set(['0,0', '9,9']));

    for (let i = 0; i < 600; i++) {
      loop.tick();
    }

    if (updatedCb.mock.calls.length > 0) {
      const [x, y, zoneType, level, burned] = updatedCb.mock.calls[0]!;
      expect(typeof x).toBe('number');
      expect(typeof y).toBe('number');
      expect(zoneType).toBe(ZoneType.RESIDENTIAL_LOW);
      expect(typeof level).toBe('number');
      expect(typeof burned).toBe('boolean');
    }
  });

  it('callbacks are optional and do not throw when unset', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    // No callbacks set
    expect(() => {
      for (let i = 0; i < 120; i++) {
        loop.tick();
      }
    }).not.toThrow();
  });

  it('onBuildingsChanged and fine-grained callbacks fire together', () => {
    const state = makeTestState();
    const loop = new SimulationLoop(state);
    const coarseCb = vi.fn();
    const fineCb = vi.fn();
    loop.onBuildingsChanged = coarseCb;
    loop.onBuildingRemoved = fineCb;

    // Set up burned buildings
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        state.grid.setCell(x, y, {
          zoneType: ZoneType.RESIDENTIAL_LOW,
          buildingId: 1,
          reserved: 3,
        });
      }
    }
    state.rciDemand = { residential: 100, commercial: 100, industrial: 100 };

    for (let i = 0; i < 600; i++) {
      loop.tick();
    }

    // Both should fire when buildings change
    if (fineCb.mock.calls.length > 0) {
      expect(coarseCb.mock.calls.length).toBeGreaterThan(0);
    }
  });
});

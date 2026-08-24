import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';

/**
 * A building just placed must have power and water immediately.
 *
 * `isPowered` / `isSupplied` compute nothing and only read a cached Set, which is rebuilt in
 * slot 1, once every six ticks. A cell placed just now did not exist at the last rebuild, so
 * the panel truthfully reports missing power and water until the next pass — and forever
 * while paused, because no tick runs (BUG-284).
 *
 * This is more than a display problem: `isFacilityOperational` reads the same value, so the
 * facility really is out of service for those ticks.
 */

/** One road, one power plant and one water plant, all connected to it. */
function setupCity(state: GameState): void {
  for (let x = 1; x <= 12; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 1) flags = RoadDirection.EAST;
    if (x === 12) flags = RoadDirection.WEST;
    state.grid.setCell(x, 5, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(1, 6, { buildingId: 200 });
  state.grid.setCell(2, 6, { buildingId: 201 });
  state.power.addPlant({ x: 1, y: 6, output: 5000, pollution: 0, type: 'coal' });
  state.water.addPlant({ x: 2, y: 6, output: 5000 });
}

describe('剛蓋好的建築馬上算得到水電', () => {
  let state: GameState;
  let loop: SimulationLoop;

  beforeEach(() => {
    state = createGameState(20, 20);
    setupCity(state);
    loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    // Run a full cycle so coverage is computed once: the state the player is in before
    // pressing build.
    for (let i = 0; i < 6; i++) loop.tick();
  });

  it('should power a building placed after the last recalculation', () => {
    state.grid.setCell(8, 6, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    // The cache is stale: this cell did not exist at the last recompute.
    expect(state.power.isPowered(8, 6), '這一格已經在快取裡了，測試沒有測到過期那一刻')
      .toBe(false);

    loop.recalculateUtilityCoverage();

    expect(state.power.isPowered(8, 6), '剛蓋好的建築還是沒電').toBe(true);
    expect(state.water.isSupplied(8, 6), '剛蓋好的建築還是沒水').toBe(true);
  });

  it('should not need a tick — the player may be paused', () => {
    // While paused no tick runs at all (GameClock.shouldTick returns false), so the recompute
    // cannot be tied to ticks or the warning stays up forever.
    state.clock.pause();
    state.grid.setCell(9, 6, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    loop.recalculateUtilityCoverage();

    expect(state.clock.tick, '測試自己偷跑了 tick').toBe(6);
    expect(state.power.isPowered(9, 6), '暫停時蓋的建築算不到電').toBe(true);
  });
});

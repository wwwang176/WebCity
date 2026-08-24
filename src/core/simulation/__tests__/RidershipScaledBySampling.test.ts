import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';

/**
 * The commute-spawn loop asks only a fraction of citizens (see `CommuteSampling`), so each
 * sampled rider counts as `scale` people. Without the scaling, **ridership shrinks several
 * fold out of nowhere**, and since load factor is computed from it, routes never fill up and
 * adding vehicles produces no feedback.
 *
 * Only a large city shows this: in a small one the factor is exactly 1 and `+= scale` is
 * identical to `++`.
 */

const HOME = { x: 6, y: 2 };
const WORK = { x: 56, y: 2 };

/** One long road with home and workplace beside it. The commute must be long enough for the
 *  bus to beat driving. */
function longRoadCity(citizens: number): GameState {
  const state = createGameState(60, 60);
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(HOME.x, HOME.y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(WORK.x, WORK.y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  for (let i = 0; i < citizens; i++) {
    state.citizens.restoreCitizen({
      age: 100, homeId: `${HOME.x},${HOME.y}`, workplaceId: `${WORK.x},${WORK.y}`,
    });
  }
  state.citizens.updateResidentialCapacity(citizens * 2);
  return state;
}

function ridership(state: GameState): number {
  let total = 0;
  for (const r of state.bus.getRoutes()) for (const s of r.stops) total += s.dailyRiders;
  return total;
}

describe('搭乘數跟著抽樣一起放大', () => {
  it('should count the people it never asked', () => {
    const state = longRoadCity(16_000);
    const stops = [state.bus.addStop(9, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(stops, 40);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();   // builds the sidewalk and transfer graphs and runs the spawn loop once

    const s = loop.lastCommuteSample;
    expect(s.samples, '前置條件:這座城市要大到會被節流').toBeLessThan(s.attempts);
    expect(s.scale, '前置條件:倍率要大到看得出差別').toBeGreaterThan(2);

    const riders = ridership(state);
    expect(riders, '前置條件:要真的有人搭到公車').toBeGreaterThan(0);
    // Without scaling, the recorded count can be at most the number asked.
    expect(riders, '搭乘數沒有放大 —— 只記了問到的那幾位')
      .toBeGreaterThan(s.samples);
  });

  it('should count the people it never asked on a trip that changes buses', () => {
    // Transfers take a different branch (`multiLeg`), and the transfer count is itself a
    // displayed number. A single-route fixture never reaches it, so both scaling lines could
    // be broken without turning red.
    // At 40,000 citizens the factor is about 5.8. A transfer trip has at most three legs, so
    // an unscaled count is at most 3 x samples, which has to stay below attempts for the bound
    // to bite.
    const state = longRoadCity(40_000);
    const west = [state.bus.addStop(9, 1), state.bus.addStop(30, 1)];
    const east = [state.bus.addStop(31, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(west, 40);
    state.bus.createRoute(east, 40);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    const s = loop.lastCommuteSample;
    expect(s.scale, '前置條件:倍率要大到咬得住三段的上界').toBeGreaterThan(3.5);

    const transfers = loop.getTransferHistory().today;
    let transferCount = 0;
    for (const n of transfers.values()) transferCount += n;
    expect(transferCount, '前置條件:要真的有人換車').toBeGreaterThan(0);
    expect(transferCount, '轉乘次數沒有放大').toBeGreaterThan(s.samples);

    // Scaled: each leg records `scale` people, so the total is at least attempts.
    // Unscaled: each leg records one person, so the total is at most 3 x samples < attempts.
    expect(ridership(state), '轉乘路段的搭乘數沒有放大')
      .toBeGreaterThan(s.attempts);
  });

  it('should leave a small city counting one person as one person', () => {
    const state = longRoadCity(40);
    const stops = [state.bus.addStop(9, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(stops, 40);

    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    loop.tick();

    expect(loop.lastCommuteSample.scale, '小城市的倍率不是 1').toBe(1);
    expect(ridership(state) % 1, '小城市記出了不是整數的人次').toBe(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';

/**
 * A rider is credited to the stop they actually boarded at.
 *
 * The time estimate is computed for two specific stops on one route. Re-picking "the nearest
 * stop in the system" after the mode is chosen lands on a different route once one transport
 * type has several, crediting the rider to a route they did not take; `getRouteRiders` then
 * aggregates that into load and distorts the crowding of both lines (BUG-283).
 *
 * The panel's Riders/Week is the same number times seven, so display and simulation are wrong
 * together and cannot be cross-checked.
 */

const HOME = { x: 6, y: 2 };
const WORK = { x: 56, y: 2 };

/**
 * One long road with the home and the workplace both **beside** it.
 *
 * Placing them at the road's end does not work: sidewalks run along the road's two sides and
 * a road endpoint has none, so that building's door connects to nothing and its residents
 * cannot reach any stop.
 *
 * The commute must also be long enough for the bus to beat driving: walking is over three
 * times slower, and on a short trip the walk to the stop consumes the entire difference.
 */
function setupCity(state: GameState): void {
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(HOME.x, HOME.y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(WORK.x, WORK.y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
}

function advanceToHour(state: GameState, targetHour: number): void {
  let ticks = targetHour - state.clock.getHourOfDay();
  if (ticks < 0) ticks += 24;
  state.clock.tick += ticks;
}

describe('搭乘記在上車的那一站', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState(60, 60);
    setupCity(state);
  });

  it('should credit the ridden route, not the nearest stop of another route', () => {
    // The route actually ridden: reachable from both ends, with the boarding stop 2.6 tiles
    // from home.
    const ridden = [state.bus.addStop(9, 1), state.bus.addStop(56, 1)];
    state.bus.createRoute(ridden, 4);

    // A decoy: its stop is at the front door (0.3 tiles, far nearer), but its other end sits
    // nowhere in the graph and cannot reach the workplace, so this route is never offered.
    // "Pick the nearest stop" lands on it.
    const decoyNear = state.bus.addStop(HOME.x, 1);
    state.bus.createRoute([decoyNear, state.bus.addStop(2, 50)], 4);

    for (let i = 0; i < 20; i++) {
      state.citizens.createCitizen({
        age: 100,
        homeId: `${HOME.x},${HOME.y}`,
        workplaceId: `${WORK.x},${WORK.y}`,
      });
    }

    advanceToHour(state, 7);
    const loop = new SimulationLoop(state);
    loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
    for (let i = 0; i < 4; i++) loop.tick();

    const riddenRiders = ridden[0]!.dailyRiders + ridden[1]!.dailyRiders;
    expect(riddenRiders, '沒有人被記到他真正搭的那條路線上').toBeGreaterThan(0);
    expect(decoyNear.dailyRiders, '記到了他沒搭、也到不了公司的那條路線頭上').toBe(0);
  });
});

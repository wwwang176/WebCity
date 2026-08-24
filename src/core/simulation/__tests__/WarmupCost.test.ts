import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';

/**
 * Loading a save must not compute paths for citizens who will not take to the road.
 *
 * `warmup(spawnRatio)` means "put a fraction of citizens on the road immediately", but
 * computing both directions for **every** employed citizen measured, on a 2,146-citizen city,
 * as 1,805 citizens x 2 directions = 3,610 A* runs at roughly 8ms each, holding the loading
 * screen for 20 seconds, while only a fifth of them actually spawn a vehicle.
 *
 * The citizens skipped come to no harm: when the ordinary path
 * (`spawnCommuteVehicles`) finds no route it hands the request to the pathfinding worker and
 * uses the result next tick.
 */

/** A small city with a full grid road network, housing on one side and workplaces on the
 *  other. */
function makeCity(citizenCount: number): GameState {
  const state = createGameState(24, 24);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      const onRoad = i % 3 === 0 || j % 3 === 0;
      if (!onRoad) continue;
      let flags = 0;
      if (j > 0 && (i % 3 === 0)) flags |= RoadDirection.NORTH;
      if (j < 23 && (i % 3 === 0)) flags |= RoadDirection.SOUTH;
      if (i > 0 && (j % 3 === 0)) flags |= RoadDirection.WEST;
      if (i < 23 && (j % 3 === 0)) flags |= RoadDirection.EAST;
      state.grid.setCell(i, j, { roadType: RoadType.TWO_LANE, roadFlags: flags });
    }
  }
  for (let n = 0; n < citizenCount; n++) {
    const c = state.citizens.createCitizen({ age: 30 });
    if (!c) break;
    // Homes and workplaces both beside a road and far apart, so a path really has to be found.
    c.homeId = `${1 + (n % 7) * 3},${1}`;
    c.workplaceId = `${1 + (n % 5) * 3},${22}`;
  }
  return state;
}

/** How many routes this warmup actually computed. */
async function countRoutes(
  state: GameState, spawnRatio: number,
): Promise<{ routes: number; spawned: number; citizens: number }> {
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(new UnifiedRoadLookup(state.grid, new ElevationManager()));
  const cache = loop.commuteCache;
  const original = cache.setRouteVariants.bind(cache);
  let routes = 0;
  cache.setRouteVariants = (key: string, variants: never) => {
    routes++;
    return original(key, variants);
  };
  const result = await loop.warmup(spawnRatio);
  return {
    routes,
    spawned: result.vehiclesSpawned,
    citizens: state.citizens.getCitizens().length,
  };
}

describe('載入時的路徑預算', () => {
  it('should compute no routes at all when nothing is going to spawn', async () => {
    // `spawnRatio = 0` means no vehicles at all, so no route is needed right now.
    const { routes, citizens } = await countRoutes(makeCity(120), 0);
    expect(citizens, '城市裡沒有市民，這條測試會是空的').toBeGreaterThan(50);
    expect(routes, '沒有車要上路，卻還是算了路徑').toBe(0);
  });

  it('should compute about one route per vehicle it spawns', async () => {
    // Each spawned vehicle needs a path in **one direction** only: the one it is driving now.
    const { routes, spawned } = await countRoutes(makeCity(120), 0.5);
    expect(spawned, '一台車都沒生成，這條測試會是空的').toBeGreaterThan(10);
    expect(routes, `生成了 ${spawned} 台車卻算了 ${routes} 條路線`)
      .toBeLessThanOrEqual(spawned);
  });

  it('should still spawn roughly the share it was asked for', async () => {
    // What is saved must be **computation**, not vehicles. Spawning fewer would speed up the
    // loading screen at the cost of empty roads on first sight of the game.
    const { spawned, citizens } = await countRoutes(makeCity(200), 0.5);
    expect(spawned / citizens, '生成的車遠少於要求的比例').toBeGreaterThan(0.25);
  });
});

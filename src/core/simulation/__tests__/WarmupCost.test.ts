import { describe, it, expect } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { ElevationManager } from '../../elevation/ElevationManager';

/**
 * 載入存檔時不要替不上路的人算路徑。
 *
 * `warmup(spawnRatio)` 的意思是「讓其中一部分市民立刻上路」，但它替**每一位**
 * 有工作的市民都算了雙向的通勤路徑。2 146 人的城市實測：1 805 位 × 2 個方向 =
 * 3 610 次 A*，每次約 8 ms，載入畫面卡 20 秒，而其中只有兩成的人真的會生成車輛。
 *
 * 沒算到的那些人不會出事：平常那條路（`spawnCommuteVehicles`）算不出路徑時本來
 * 就會丟給 pathfinding worker，下一 tick 再用。
 */

/** 一張鋪滿棋盤路網、住宅與工作地點各據一方的小城。 */
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
    // 家與工作都貼在路邊，彼此隔開，確保真的要找一條路
    c.homeId = `${1 + (n % 7) * 3},${1}`;
    c.workplaceId = `${1 + (n % 5) * 3},${22}`;
  }
  return state;
}

/** 這一次 warmup 實際算了幾條路線。 */
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
    // `spawnRatio = 0` 是「一台車都不生成」。那就沒有任何一條路是現在需要的。
    const { routes, citizens } = await countRoutes(makeCity(120), 0);
    expect(citizens, '城市裡沒有市民，這條測試會是空的').toBeGreaterThan(50);
    expect(routes, '沒有車要上路，卻還是算了路徑').toBe(0);
  });

  it('should compute about one route per vehicle it spawns', async () => {
    // 每台生成的車只需要**一個方向**的路徑 —— 它現在就往那邊開。
    const { routes, spawned } = await countRoutes(makeCity(120), 0.5);
    expect(spawned, '一台車都沒生成，這條測試會是空的').toBeGreaterThan(10);
    expect(routes, `生成了 ${spawned} 台車卻算了 ${routes} 條路線`)
      .toBeLessThanOrEqual(spawned);
  });

  it('should still spawn roughly the share it was asked for', async () => {
    // 省下來的必須是**計算**，不是車。少生成車的話載入畫面是快了，但進遊戲
    // 的第一眼會是空蕩蕩的馬路。
    const { spawned, citizens } = await countRoutes(makeCity(200), 0.5);
    expect(spawned / citizens, '生成的車遠少於要求的比例').toBeGreaterThan(0.25);
  });
});

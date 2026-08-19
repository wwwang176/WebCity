import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { SIMULATION } from '../SimulationConstants';
import { RoadType, RoadDirection } from '../../road/types';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * 流量重算現在是分好幾個 tick 掃完的（BUG-327）。開輪跟推進是兩件事:開輪每 60 tick
 * 一次，推進**每個 tick**都要做。
 *
 * 只在開輪那一 tick 推進的話，這一輪永遠掃不完 —— 流量圖從讀檔之後就再也不會更新，
 * 而所有現有的測試都是直接呼叫 `computeCongestionFlow()`（一次掃完的那條路），
 * 一個都不會紅。
 */

function setup() {
  const state = createGameState(20, 20);
  for (let x = 0; x < 12; x++) {
    state.grid.setCell(x, 0, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  return { state, loop: new SimulationLoop(state) };
}

/** 一條有人走的路線。refCount 由 CommuteCache 自己維護，不需要真的市民。 */
function seedRoute(loop: SimulationLoop, cells: string[], riders: number, idBase: number): void {
  const path = cells.slice(0, -1).map((from, i) => makeCellEdge(from, cells[i + 1]!, 0, { length: 1 }));
  loop.commuteCache.setRouteVariants(`${cells[0]}->${cells[cells.length - 1]}`, [path]);
  for (let i = 0; i < riders; i++) {
    loop.commuteCache.set(idBase + i, {
      citizenId: idBase + i, homeId: cells[0]!, workplaceId: cells[cells.length - 1]!,
      morningPath: path, eveningPath: null, status: 'ready', generation: 0,
    });
  }
}

describe('流量重算會自己掃完', () => {
  it('should finish a sweep started 60 ticks in, without anyone calling it directly', () => {
    const { state, loop } = setup();

    loop.tick();   // tick 1:一次算完，此時還沒有任何路線
    expect(state.traffic.getPredictedFlow()?.size ?? 0, '前置條件:一開始沒有車流').toBe(0);

    // 這一輪開始之前放進去。下一輪在 tick 62 開，攤在接下來 40 個 tick 上。
    seedRoute(loop, ['3,0', '4,0', '5,0'], 9, 500);

    const deadline = 2 + SIMULATION.MEDIUM_TICK_INTERVAL + SIMULATION.CONGESTION_FLOW_SPREAD_TICKS + 2;
    while (state.clock.tick < deadline) loop.tick();

    const flow = state.traffic.getPredictedFlow();
    expect(flow?.has('4,0'), `跑到 tick ${deadline} 了，這一輪還沒掃完`).toBe(true);
  });

  it('should not publish a half-swept map along the way', () => {
    // 半張表說的是「只有這幾條路上有人」。中途被讀到的話，運具選擇會照著一張
    // 假的圖做決定。
    const { state, loop } = setup();
    loop.tick();
    seedRoute(loop, ['1,0', '2,0'], 4, 600);
    seedRoute(loop, ['8,0', '9,0'], 4, 700);

    const seen: number[] = [];
    while (state.clock.tick < 2 + SIMULATION.MEDIUM_TICK_INTERVAL + SIMULATION.CONGESTION_FLOW_SPREAD_TICKS + 2) {
      loop.tick();
      const f = state.traffic.getPredictedFlow();
      if (f) seen.push(f.size);
    }
    // 只會看到「空的」與「完整的」兩種，不會有中間態。
    expect([...new Set(seen)].sort((a, b) => a - b), '出現了大小介於中間的表')
      .toEqual([0, 4]);
  });
});

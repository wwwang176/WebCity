import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * 車輛每幀由前往後處理，而且每台車走完之後會把自己的新位置與「有沒有在減速」寫回
 * 逐邊索引（`advanceEdgeVehicles` 迴圈最後那一段）。所以後車讀到的是前車**這一幀
 * 剛算好的**狀態，不是上一幀的。
 *
 * 這件事原本沒有測試守得住:把排序整個反過來，全套測試沒有一個紅 —— 而實測同一份
 * 存檔跑一幀，842 台車有 547 台的位置與速度會不一樣。
 *
 * 差別在第一幀最明顯:那時候所有車的 `braking` 都還是 false，前車要到自己被處理的
 * 那一刻才會變成 true。順序對的話，後車看得到那個 true，就不會跟著擠進路口。
 */

const JUNCTION_AT = 3;

/** 一條直線車道，每段長 1，第 `JUNCTION_AT` 段是路口。 */
function path(n: number): LaneEdge[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    from: {
      id: `e${i}_f`, cellKey: `${i},0`, position: { x: i, y: 0 },
      lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `e${i}_t`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
      lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight' as const,
    ...(i === JUNCTION_AT ? { insideJunction: true } : {}),
  }));
}

describe('由前往後處理', () => {
  it('should let a follower see the leader braking in the same frame', () => {
    const sim = new TrafficSimulation();
    const route = path(10);

    // 後車先建立，前車後建立 —— 這樣「沒有排序」時陣列就是由後往前，順序這件事
    // 才不會被建立順序矇混過去。
    const follower = sim.addVehicleOnEdges(route);
    follower.length = 0.22;

    // 前車停在路口出口的正後方，被紅燈擋著 —— 它這一幀會第一次算出「我在減速」。
    const leader = sim.addVehicleOnEdges(route);
    leader.length = 0.22;
    leader.edgeIndex = JUNCTION_AT + 1;
    leader.edgeProgress = 0;      // 還沒進去，紅燈才擋得住它
    leader.speedMultiplier = 1;
    leader.stallTime = -1e6;

    // 後車還在路口前面。它要不要進路口，取決於前車是不是在排隊。
    follower.edgeIndex = JUNCTION_AT - 1;
    follower.edgeProgress = 0.7;  // 停止線就在前面 0.3 格
    follower.currentSpeed = 3;
    follower.speedMultiplier = 1;
    follower.stallTime = -1e6;

    // 兩台的 braking 都還是 false —— 前車要到被處理時才會變 true。
    expect(leader.braking, '前置條件:前車還沒被判定在減速').toBe(false);

    const red = (_from: string, next: string) => next !== `${JUNCTION_AT + 2},0`;
    sim.advanceEdgeVehicles(0.2, red);

    expect(leader.braking, '前車這一幀沒有被判定在減速 —— 這個案例失去意義').toBe(true);
    // 前車在排隊而且出不去，所以後車必須停在停止線前，不能把車身留在路口裡。
    const centre = follower.edgeIndex + follower.edgeProgress;
    expect(centre, '後車讀到的是前車上一幀的狀態，跟著擠進了路口')
      .toBeLessThan(JUNCTION_AT);
  });
});

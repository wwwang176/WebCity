import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * 兩條車道匯進同一個點時，後到的那一台要讓。
 *
 * `findCrossEdgeGap` 有一整組單元測試，但那些都是直接餵它格點物件 —— 沒有一個
 * 走過 `advanceEdgeVehicles`。中間那一段（把每台車的位置與終點整理成可查的形狀）
 * 壞掉的話，匯流偵測會安靜地全部回傳「前面沒車」，兩台車直接穿過彼此，而現有的
 * 測試一個都不會紅。
 */

/** 一條從 (fx,fy) 到 (1,0) 的車道邊。`toId` 相同代表兩條邊匯進同一個點。 */
function edgeInto(id: string, fx: number, fy: number, toId: string): LaneEdge {
  return {
    id,
    from: {
      id: `${id}_f`, cellKey: '0,0', position: { x: fx, y: fy },
      lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: toId, cellKey: '1,0', position: { x: 1, y: 0 },
      lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight',
  };
}

/**
 * 讓一台車從 (0,0) 往東走一幀，回傳它走了多遠。
 * `withSibling` 為真時，前方 0.5 格處有一台走另一條邊、但匯進同一個點的車。
 */
function advanceOnce(withSibling: boolean): number {
  const sim = new TrafficSimulation();
  const mine = sim.addVehicleOnEdges([edgeInto('eA', 0, 0, 'MERGE')]);
  if (withSibling) {
    const other = sim.addVehicleOnEdges([edgeInto('eB', 0, 0, 'MERGE')]);
    other.edgeProgress = 0.5;   // 更靠近匯流點 —— 它先過，我讓
  }
  const before = mine.edgeProgress;
  sim.advanceEdgeVehicles(1);
  return mine.edgeProgress - before;
}

describe('匯進同一個點的兩台車', () => {
  it('should stop short of a merge sibling on another edge', () => {
    const alone = advanceOnce(false);
    const yielding = advanceOnce(true);

    expect(alone, '前面沒車卻也不走').toBeGreaterThan(0);
    expect(yielding, '前面有車要匯進同一個點，卻照原速穿過去').toBeLessThan(alone);
  });

  it('should not brake for a sibling heading somewhere else', () => {
    // 反向對照:位置一樣近，但終點不同 —— 那是兩條互不相干的車道，不該互相讓。
    const sim = new TrafficSimulation();
    const mine = sim.addVehicleOnEdges([edgeInto('eA', 0, 0, 'MERGE')]);
    const other = sim.addVehicleOnEdges([edgeInto('eB', 0, 0, 'SOMEWHERE_ELSE')]);
    other.edgeProgress = 0.5;
    sim.advanceEdgeVehicles(1);

    expect(mine.edgeProgress, '為了一台根本不會匯過來的車煞停')
      .toBeCloseTo(advanceOnce(false), 5);
  });
});

import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * 跟車查詢找到一台之後就不再往前看，但「更遠的車一定留下更大的空隙」只有在所有車
 * 一樣長時才成立 —— 空隙扣的是**兩台車**的半個車身，而公車比小客車長兩倍多。
 *
 * `findGapAhead` 的單元測試守得住那道算式，但那個「最長車身」是呼叫端傳進去的。
 * 傳錯（例如傳 0）的話查詢會提前收工，車就照著小客車那個比較寬鬆的空隙開進公車
 * 尾巴 —— 而單元測試一個都不會紅。
 */

function edge(id: string, fx: number, tx: number): LaneEdge {
  return {
    id,
    from: {
      id: `${id}_f`, cellKey: `${fx},0`, position: { x: fx, y: 0 },
      lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
    },
    to: {
      id: `${id}_t`, cellKey: `${tx},0`, position: { x: tx, y: 0 },
      lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
    },
    length: 1.0, type: 'straight',
  };
}

describe('前面那台是公車的時候', () => {
  it('should come to rest behind the bus, not behind the car in between', () => {
    const sim = new TrafficSimulation();
    const route = [edge('e1', 0, 1), edge('e2', 1, 2)];

    const me = sim.addVehicleOnEdges(route);
    me.length = 0.22;                       // 車型是隨機的，這裡要固定才量得準

    const car = sim.addVehicleOnEdges(route);
    car.length = 0.22;                      // 同一條邊、前方 0.9 → 空隙 0.68

    const bus = sim.addBusVehicle([route], 1);   // 車身 0.60

    // 一幀只走幾公分，跑到停下來才看得出停在哪。前面兩台每幀釘回原位 ——
    // 模擬一列不會前進的車隊，這樣「我停在哪」只取決於查到的是哪一台。
    for (let f = 0; f < 200; f++) {
      car.edgeIndex = 0; car.edgeProgress = 0.9; car.currentSpeed = 0;
      bus.edgeIndex = 1; bus.edgeProgress = 0; bus.currentSpeed = 0;
      sim.advanceEdgeVehicles(1 / 60);
    }

    // 空隙還要再留一個 MIN_GAP(0.15) 的車距:
    //   公車   1.0 - 0.11 - 0.30 - 0.15 = 0.44   ← 該停在這裡
    //   小客車 0.9 - 0.11 - 0.11 - 0.15 = 0.53
    expect(me.edgeIndex, '這一幀就衝過了整條邊 —— 這個案例失去意義').toBe(0);
    expect(me.edgeProgress, '提前收工，照著小客車的空隙開進了公車尾巴')
      .toBeLessThan(0.48);
    expect(me.edgeProgress, '停得比公車留下的空隙還遠 —— 這個案例失去意義')
      .toBeGreaterThan(0.40);
  });
});

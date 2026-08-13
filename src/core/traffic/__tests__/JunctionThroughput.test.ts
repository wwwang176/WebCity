import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import { TRAFFIC_LIGHT } from '../TrafficLights';
import type { LaneEdge } from '../LaneGraph';

/**
 * 一次綠燈放得掉多少車。
 *
 * 號誌的秒數是**實際秒數**，而車速是格／秒 —— 兩者沒有任何連結。車速減半時
 * 綠燈期間車走的距離就減半，能通過的台數跟著砍半（實測 4 秒綠燈從 14 台掉到
 * 7 台），路口的通行量無聲地少了一半。
 *
 * 所以這裡釘的是**通行量**，不是秒數。秒數與車速任何一邊單獨被動，這一組就會紅。
 * 拿「秒數 × 車速」之類的算式比對是沒有用的：那會跟著兩邊一起動。
 */

function path(n: number): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({
      id: `e${i}`,
      from: {
        id: `e${i}_f`, cellKey: `${i},0`, position: { x: i, y: 0 },
        lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `e${i}_t`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
        lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
      },
      length: 1.0, type: 'straight',
    });
  }
  return edges;
}

/** 排滿一列車等紅燈，綠燈 `green` 秒之後有幾台越過停止線。 */
function clearedPerGreen(green: number): number {
  const sim = new TrafficSimulation();
  const cars = [];
  for (let i = 0; i < 40; i++) {
    const v = sim.addVehicleOnEdges(path(60));
    // 排隊本來就不動，別讓它被判定停滯而退場。
    v.stallTime = -1e6;
    v.speedMultiplier = 1;
    cars.push(v);
  }
  const STOP_LINE = 10;
  const red = (_from: string, next: string) => next !== `${STOP_LINE},0`;
  // 先讓車隊完全排定
  for (let t = 0; t < 20 / 0.02; t++) sim.advanceEdgeVehicles(0.02, red);

  const before = cars.filter(v => v.edgeIndex >= STOP_LINE).length;
  for (let t = 0; t < green / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
  return cars.filter(v => v.edgeIndex >= STOP_LINE).length - before;
}

describe('路口的通行量', () => {
  it('should clear a queue worth of cars on a standard green', () => {
    // 下界是寫死的：車速減半而秒數沒跟著改時，這裡量到的是 7。
    expect(clearedPerGreen(TRAFFIC_LIGHT.PHASE_DURATION), '一次綠燈放行的車太少')
      .toBeGreaterThanOrEqual(12);
  });

  it('should clear proportionally more on a large junction', () => {
    expect(clearedPerGreen(TRAFFIC_LIGHT.PHASE_DURATION_LARGE), '大路口的綠燈放行的車太少')
      .toBeGreaterThanOrEqual(25);
  });

  it('should not buy throughput with an unreasonable wait', () => {
    // 通行量也可以靠把綠燈拉到一分鐘換來 —— 那會讓對向在 1x 之下等到以為
    // 號誌壞了。紅燈的長度就是對向的綠燈加上全紅清道時間。
    const worstWait = TRAFFIC_LIGHT.PHASE_DURATION_LARGE + TRAFFIC_LIGHT.CLEARANCE_DURATION;
    expect(worstWait, '紅燈長到會讓人以為號誌壞了').toBeLessThanOrEqual(20);
  });

  it('should give the large junction a longer phase than the standard one', () => {
    expect(TRAFFIC_LIGHT.PHASE_DURATION_LARGE)
      .toBeGreaterThan(TRAFFIC_LIGHT.PHASE_DURATION);
  });
});

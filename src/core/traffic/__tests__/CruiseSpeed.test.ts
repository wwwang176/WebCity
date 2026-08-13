import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC } from '../TrafficSimulation';
import { RoadType, ROAD_CONFIGS } from '../../road/types';
import type { LaneEdge } from '../LaneGraph';

/**
 * 車在路上跑多快。
 *
 * 這一組釘住的是**看得到的速度**，不是「速度等於某個常數」—— 後者拿同一個常數
 * 兩邊比對，改常數兩邊一起動，測試永遠是綠的（BUG-260 的教訓）。所以上界是
 * 寫死的數字，而路型之間的相對關係另外比。
 *
 * 車輛是裝飾性的，移動與模擬時鐘脫鉤：一格 12 公尺、一秒走 3.5 格，換算約
 * 150 km/h，而路上標的是 50。那個倍率是刻意的 —— 照時鐘算的話 1x 之下一個
 * 遊戲日只有 6 秒，車會慢到看不出在動。
 */

/** 一條夠長的直路，全部落在同一種路型的格子上。 */
function straightPath(n: number): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({
      id: `e${i}`,
      from: {
        id: `e${i}_from`, cellKey: `${i},0`, position: { x: i, y: 0 },
        lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `e${i}_to`, cellKey: `${i + 1},0`, position: { x: i + 1, y: 0 },
        lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
      },
      length: 1.0,
      type: 'straight',
    });
  }
  return edges;
}

/** 一台車在這種路上跑到穩定之後的速度（格／秒），已除掉個體係數。 */
function cruiseSpeed(roadType: RoadType): number {
  const sim = new TrafficSimulation();
  const v = sim.addVehicleOnEdges(straightPath(400));
  v.stallTime = 0;
  const limit = ROAD_CONFIGS[roadType]!.speedLimit;
  // 路徑很長，所以前瞻減速不會在這幾步內介入。
  for (let i = 0; i < 200; i++) sim.advanceEdgeVehicles(0.05, undefined, () => limit);
  return v.currentSpeed / v.speedMultiplier;
}

describe('車輛的巡航速度', () => {
  it('should cruise at half the old pace on an ordinary street', () => {
    // 上界是**寫死的**：拿 `TRAFFIC.EDGE_SPEED` 來比的話，把它調回 7 兩邊會
    // 一起動，這條就白寫了。原本是 7 格／秒。
    const speed = cruiseSpeed(RoadType.TWO_LANE);
    expect(speed, '一般道路的車跑得比預期快').toBeLessThanOrEqual(4);
    expect(speed, '一般道路的車幾乎不動了').toBeGreaterThan(2.5);
  });

  it('should keep the fastest road under a sane ceiling', () => {
    // 快速道路是最快的一種，它決定了畫面上車能有多快。
    expect(cruiseSpeed(RoadType.HIGHWAY), '快速道路的車快到看不清').toBeLessThanOrEqual(8);
  });

  it('should leave the relative speed of each road type untouched', () => {
    // 「整體放慢」不可以靠改速限達成 —— 速限同時是路徑規劃的成本權重，動了它
    // 會連帶改變車流的選路。
    const base = cruiseSpeed(RoadType.TWO_LANE);
    for (const roadType of [
      RoadType.RURAL, RoadType.FOUR_LANE, RoadType.SIX_LANE, RoadType.HIGHWAY,
    ]) {
      const want = ROAD_CONFIGS[roadType]!.speedLimit / ROAD_CONFIGS[RoadType.TWO_LANE]!.speedLimit;
      expect(cruiseSpeed(roadType) / base, `${roadType} 與一般道路的速度比不等於速限比`)
        .toBeCloseTo(want, 6);
    }
  });

  it('should still reach cruise speed quickly enough to clear a junction', () => {
    // 放慢速度但沒放慢加速度的話，車會像瞬間跳到全速。反過來說加速度若跟著
    // 砍太多，綠燈時車隊會爬不出路口。
    const top = TRAFFIC.EDGE_SPEED;
    const secondsToCruise = top / TRAFFIC.ACCEL;
    expect(secondsToCruise, '加速太慢，綠燈時車隊爬不出路口').toBeLessThan(1.5);
    expect(secondsToCruise, '加速快到像瞬移').toBeGreaterThan(0.2);
  });
});

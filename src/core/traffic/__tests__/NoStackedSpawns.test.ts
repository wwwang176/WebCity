import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * 同一個 tick 生出來的車疊在一起。
 *
 * 每一台新車都放在 `edgePath[0]` 的起點、`edgeProgress` 0 —— 而通勤路線是共用的
 * （`CommuteCache` 的路線池把同一個陣列交給每個走這條路的市民），所以同一條路上
 * 同時出發的人全部疊在同一個點上，畫面上是一坨。
 *
 * 跟車規則之後會把它們推開（後車的 gap 是負的，不會動），但那是**之後**——生出來
 * 的那一刻就已經穿模了，而且路口回堵時會停在那裡不動。
 *
 * 所以要在生成的當下就檢查:車位被佔著就這一次不要生，讓那個人下次再出門。
 */

/** 一條沿 +x 的直線車道路徑，可以整條往 y 方向平移（模擬隔壁車道）。 */
function path(n: number, offsetY = 0): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({
      id: `e${i}@${offsetY}`,
      from: {
        id: `e${i}@${offsetY}_f`, cellKey: `${i},0`, position: { x: i, y: offsetY },
        lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `e${i}@${offsetY}_t`, cellKey: `${i + 1},0`, position: { x: i + 1, y: offsetY },
        lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
      },
      length: 1.0, type: 'straight',
    });
  }
  return edges;
}

/** 車身最長的那一種（廂型車 0.26）——空位夠不夠要照最壞情況算。 */
const LONGEST = 0.26;

describe('車位被佔著就不要生車', () => {
  it('should refuse the second car on the same spot', () => {
    const sim = new TrafficSimulation();
    const route = path(20);
    expect(sim.spawnVehicleOnEdges(route), '第一台就生不出來').not.toBeNull();
    expect(sim.spawnVehicleOnEdges(route), '第二台疊在第一台身上').toBeNull();
    expect(sim.getVehicleCount()).toBe(1);
  });

  it('should let the next one out once the first has driven clear', () => {
    // 反向對照。上一條可以靠「第一台之後永遠不生車」滿足，那樣路上只會有一台車。
    const sim = new TrafficSimulation();
    const route = path(20);
    sim.spawnVehicleOnEdges(route);
    for (let t = 0; t < 2 / 0.02; t++) sim.advanceEdgeVehicles(0.02);
    expect(sim.spawnVehicleOnEdges(route), '前車早就開走了，後面卻還生不出來').not.toBeNull();
    expect(sim.getVehicleCount()).toBe(2);
  });

  it('should not let a car in the next lane block the spot', () => {
    // 判斷要照車身的方向算，不能只用中心點距離:車長 0.26、車寬 0.09，用車長當
    // 半徑的話隔壁車道（間距約一個車道寬）會被誤判成佔用。
    const sim = new TrafficSimulation();
    expect(sim.spawnVehicleOnEdges(path(20, 0))).not.toBeNull();
    expect(sim.spawnVehicleOnEdges(path(20, 0.18)), '隔壁車道的車擋住了這一格').not.toBeNull();
  });

  it('should still refuse a spot occupied from a different edge', () => {
    // 佔位的車不一定跟新車走同一條邊 —— 它可能只是剛好開到門口。位置才是重點。
    const sim = new TrafficSimulation();
    const other = path(20, 0);
    const v = sim.spawnVehicleOnEdges(other)!;
    v.edgeIndex = 5; v.edgeProgress = 0.5;      // 世界座標 (5.5, 0)
    const arriving = path(20).slice(5).map(e => ({ ...e, id: e.id + '!' }));
    arriving[0] = { ...arriving[0]!, from: { ...arriving[0]!.from, position: { x: 5.5, y: 0 } } };
    expect(sim.spawnVehicleOnEdges(arriving), '有車站在門口卻照樣生了一台').toBeNull();
  });

  it('should never refuse a bus', () => {
    // 公車少一台是修不回來的:busVehicleIds 與 route.vehicles 仍然算著它，
    // 沒有東西會去對帳，那條路線就永遠少一台車（BUG-115）。
    const sim = new TrafficSimulation();
    const seg = [path(20)];
    expect(sim.addBusVehicle(seg, 1)).not.toBeNull();
    expect(sim.addBusVehicle(seg, 1), '公車被擋掉了').not.toBeNull();
    expect(sim.getVehicleCount()).toBe(2);
  });

  it('fixture sanity: a car really is shorter than the gap it needs', () => {
    // 這一組全部建立在「兩台車佔不下同一個點」上。
    expect(LONGEST).toBeLessThan(TRAFFIC.MIN_GAP + LONGEST * 2);
  });
});

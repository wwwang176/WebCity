import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC, SPAWN_CLEARANCE } from '../TrafficSimulation';
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
    // 判斷要照車身的方向算，不能只用中心點距離:最窄的車道間距是 0.1375 格
    // （單行道兩車道），而車身長 0.22 —— 單一半徑要小於車道間距才不會誤判隔壁
    // 車道，但那個半徑塞不下一台車，同車道前後兩台就會疊在一起。
    const sim = new TrafficSimulation();
    expect(sim.spawnVehicleOnEdges(path(20, 0))).not.toBeNull();
    expect(sim.spawnVehicleOnEdges(path(20, 0.18)), '隔壁車道的車擋住了這一格').not.toBeNull();
  });

  it('should keep the across-lane clearance under the tightest lane spacing', () => {
    // 最窄的是單行道兩車道:0.55 / 2 / 2 = 0.1375 格。左右的餘裕比它大的話，
    // 隔壁車道永遠有車擋著，路上的車會少一大截。
    expect(SPAWN_CLEARANCE.ACROSS, '左右餘裕寬過最窄的車道間距').toBeLessThan(0.1375);
  });

  it('should keep the along-lane clearance long enough for a body', () => {
    // 前後的餘裕小於車身的話，兩台車中心差半個車身也會各自生成 —— 就是穿模。
    expect(SPAWN_CLEARANCE.ALONG, '前後餘裕短過車身').toBeGreaterThanOrEqual(LONGEST);
  });

  it('should refuse a spot taken by a car bucketed in the neighbouring cell', () => {
    // 找附近的車是靠逐格的索引找的，而車是記在「目前這條邊的起點那一格」——
    // 一台快開到格子盡頭的車，位置在隔壁格，索引卻還記在原本那一格。只查生成點
    // 那一格的話會漏掉它。
    const sim = new TrafficSimulation();
    const blocker = sim.spawnVehicleOnEdges(path(20))!;
    blocker.edgeIndex = 4;
    blocker.edgeProgress = 0.98;   // 記在 4,0，人在 (4.98, 0)
    sim.advanceEdgeVehicles(0);    // 索引每幀更新一次 —— 手動搬車之後要走一幀才算數
    const arriving = path(20).slice(5).map(e => ({ ...e, id: e.id + '!' }));
    expect(sim.spawnVehicleOnEdges(arriving), '隔壁格的車沒被找到').toBeNull();
  });

  it('should let a far-away car through', () => {
    // 反向對照:索引只查附近幾格，但不能因此擋不到該擋的、也不能擋到不該擋的。
    const sim = new TrafficSimulation();
    const blocker = sim.spawnVehicleOnEdges(path(20))!;
    blocker.edgeIndex = 10;
    blocker.edgeProgress = 0.5;
    sim.advanceEdgeVehicles(0);
    const arriving = path(20).slice(5).map(e => ({ ...e, id: e.id + '!' }));
    expect(sim.spawnVehicleOnEdges(arriving), '五格外的車擋住了生成').not.toBeNull();
  });

  it('should still refuse a spot occupied from a different edge', () => {
    // 佔位的車不一定跟新車走同一條邊 —— 它可能只是剛好開到門口。位置才是重點。
    const sim = new TrafficSimulation();
    const other = path(20, 0);
    const v = sim.spawnVehicleOnEdges(other)!;
    v.edgeIndex = 5; v.edgeProgress = 0.5;      // 世界座標 (5.5, 0)
    sim.advanceEdgeVehicles(0);                 // 索引每幀更新一次
    const arriving = path(20).slice(5).map(e => ({ ...e, id: e.id + '!' }));
    arriving[0] = { ...arriving[0]!, from: { ...arriving[0]!.from, position: { x: 5.5, y: 0 } } };
    expect(sim.spawnVehicleOnEdges(arriving), '有車站在門口卻照樣生了一台').toBeNull();
  });

  it('should refuse a spot with a car just ahead in the same lane', () => {
    // 只查生成點那一格「圓心附近」是不夠的 —— 擋路的車不一定站在圓心上，它可能
    // 只是往前挪了一點點，而那個距離還在車身的餘裕之內。
    const sim = new TrafficSimulation();
    const route = path(20);
    const first = sim.spawnVehicleOnEdges(route)!;
    first.edgeProgress = 0.2;       // 同車道、正前方 0.2 格，比 ALONG(0.3) 近
    sim.advanceEdgeVehicles(0);     // 索引每幀更新一次
    expect(sim.spawnVehicleOnEdges(route), '前面 0.2 格有車卻照樣生了一台').toBeNull();
  });

  it('should keep the index the same size as the traffic', () => {
    // 索引每幀重建。忘了清掉舊的那一份，行為上看不出來 —— 格點物件是重用的，
    // 比距離時讀到的座標永遠是最新的，只有筆數會一直長上去，查詢愈跑愈慢。
    const sim = new TrafficSimulation();
    sim.spawnVehicleOnEdges(path(20));
    for (let f = 0; f < 300; f++) sim.advanceEdgeVehicles(0.02);
    const hash = (sim as unknown as { spawnHash: { size(): number } }).spawnHash;
    expect(hash.size(), '索引裡的筆數跟路上的車對不起來').toBe(sim.getVehicleCount());
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

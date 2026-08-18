import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC } from '../TrafficSimulation';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { LaneGraph, isIntersectionCell, type LaneEdge } from '../LaneGraph';
import { STOP_LINE_OFFSET, findBlockedJunctionDistance, type EdgeEntry } from '../VehicleLookahead';

/**
 * 不要把車停在路口裡。
 *
 * 跟車的規則只問「前面那台的屁股在哪裡」，所以前車停在路口另一頭的時候，後車會
 * 一路貼上去停在路口正中央 —— 綠燈換到對向，對向前面卡著一台不會動的車，整個
 * 十字就鎖死了。
 *
 * 正確的判斷是**進去之前先問出得來嗎**:車身中心要能越過路口的另一邊，否則就停
 * 在停止線前等。
 *
 * 用中心而不是車尾，是刻意留一點餘裕:真人開車本來就會把車頭探出去一點，而且
 * 這樣車流看起來順得多。代價有上限 —— 最多半個車身留在路口裡（0.11 格，約 1.3
 * 公尺，路口寬的一成）。
 */

const J = 10;   // 路口那一段在 edgePath 裡的索引
const RED_AT = 13;

/** 一條直線的車道路徑，每一段長 1，第 `junctionAt` 段標成路口。 */
function path(n: number, junctionAt = -1): LaneEdge[] {
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
      length: 1.0,
      type: 'straight',
      ...(i === junctionAt ? { insideJunction: true } : {}),
    });
  }
  return edges;
}

/** 車身中心走了多遠（每段長 1，所以就是 index + progress）。 */
function centre(v: { edgeIndex: number; edgeProgress: number }): number {
  return v.edgeIndex + v.edgeProgress;
}

/** 車身有沒有壓在 [from, to] 這一段上。 */
function overlaps(v: { edgeIndex: number; edgeProgress: number; length: number }, from: number, to: number): boolean {
  const c = centre(v);
  return c + v.length / 2 > from && c - v.length / 2 < to;
}

/** 排一列車，塞到 `RED_AT` 的紅燈前面回堵，回傳模擬與車隊。 */
function gridlock(junctionAt: number) {
  const sim = new TrafficSimulation();
  const cars = [];
  for (let i = 0; i < 20; i++) {
    const v = sim.addVehicleOnEdges(path(40, junctionAt));
    // 排隊本來就不動，別讓它被判定停滯而退場。
    v.stallTime = -1e6;
    v.speedMultiplier = 1;
    cars.push(v);
  }
  const red = (_from: string, next: string) => next !== `${RED_AT},0`;
  for (let t = 0; t < 60 / 0.02; t++) sim.advanceEdgeVehicles(0.02, red);
  return { sim, cars, red };
}

describe('路口要淨空', () => {
  it('should let at most a nose into the junction when the queue beyond is full', () => {
    // 放行的條件是**車身中心**過得了出口，所以留在路口裡的絕不會超過半個車身。
    // 這是上限不是平均:整台車停在路口裡（中心還沒過出口）就會被抓到。
    const { cars } = gridlock(J);
    for (const v of cars) {
      if (!overlaps(v, J, J + 1)) continue;
      expect(centre(v), `一台車的中心停在路口裡（${centre(v).toFixed(2)}）`)
        .toBeGreaterThanOrEqual(J + 1 - 1e-6);
    }
  });

  it('should still pack the queue tight where there is no junction', () => {
    // 反向對照。上一條可以靠「每台車都提早一格停」滿足 —— 那會讓所有路段的
    // 排隊長度暴增一倍。沒有路口的地方要照舊貼著前車停。
    const { cars } = gridlock(-1);
    const stopped = cars.filter(v => v.edgeIndex < RED_AT).sort((a, b) => centre(b) - centre(a));
    expect(stopped.length, '沒有車在排隊，這條測不出東西').toBeGreaterThan(3);
    for (let i = 1; i < stopped.length; i++) {
      const front = stopped[i - 1]!, back = stopped[i]!;
      const bumperGap = centre(front) - centre(back) - front.length / 2 - back.length / 2;
      expect(bumperGap, `第 ${i} 台跟前車差了 ${bumperGap.toFixed(3)}`)
        .toBeLessThan(TRAFFIC.MIN_GAP + 0.05);
    }
  });

  it('should wait exactly at the stop line, not tailgate up to the box', () => {
    // 排頭那台停在停止線上 —— 跟紅燈用的是同一條線。
    //
    // 只斷言「車頭沒進路口」是不夠的:貼著前車停的時候，排頭離路口也只差
    // 0.19（前車的半個車身加上 MIN_GAP），照樣通過。真正的差別在於它讓開的是
    // **整個路口**，所以要釘的是那條線本身。
    const { cars } = gridlock(J);
    const waiting = cars.filter(v => centre(v) + v.length / 2 <= J).sort((a, b) => centre(b) - centre(a));
    expect(waiting.length, '路口前面沒有車在等，這條測不出東西').toBeGreaterThan(0);
    const nose = centre(waiting[0]!) + waiting[0]!.length / 2;
    expect(J - nose, `排頭的車頭離路口 ${(J - nose).toFixed(3)}`)
      .toBeCloseTo(STOP_LINE_OFFSET, 2);
  });

  it('should drive straight through a junction that is clear', () => {
    // 這是「乾脆都不要進路口」的反向對照。
    const sim = new TrafficSimulation();
    const v = sim.addVehicleOnEdges(path(20, J));
    v.speedMultiplier = 1;
    for (let t = 0; t < 30 / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
    expect(sim.getVehicleCount(), '路口清空的時候車卻卡住沒過去').toBe(0);
  });

  it('should release the queue once the far side clears', () => {
    // 停在停止線前的車必須在對面空出來之後自己開走，不能鎖死。
    const { sim, cars } = gridlock(J);
    const before = cars.filter(v => centre(v) > J).length;
    for (let t = 0; t < 30 / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
    expect(cars.filter(v => centre(v) > J).length, '綠燈之後車隊沒有前進')
      .toBeGreaterThan(before);
  });
});

describe('進去之前的那一問', () => {
  // 車隊測試量得到「有沒有人停在路口裡」，但量不到**差幾公分**:判斷的邊界差
  // 只有一個車身長，剛好被排隊的間距蓋過去。這裡直接餵數字。
  const CAR = { id: 1, length: 0.22, edgeIndex: 0, edgeProgress: 0 };
  const ROUTE = path(6, 1);   // 路口是第 1 段，所以車身中心到路口是 [1, 2]
  const ENTER = 1, EXIT = 2, HALF = CAR.length / 2;
  const MIN_GAP = TRAFFIC.MIN_GAP;

  /**
   * 在車身中心**前方** `d` 處擺一台車，問這台車能不能進路口。
   *
   * 位置要相對於 `car` 算 —— 從路徑起點算的話，測「已經在路口裡」那一條會把
   * 阻擋者擺到車子後面去，於是掃描找不到人，判斷就空轉了。
   */
  function ask(d: number, queueing: boolean, route = ROUTE, car = CAR): number {
    const at = car.edgeIndex + car.edgeProgress + d;   // 每段長 1，索引即距離
    const ei = Math.floor(at);
    const index = new Map<string, EdgeEntry[]>([
      [route[ei]!.id, [{ vid: 2, progress: at - ei, halfLen: HALF, queueing }]],
    ]);
    return findBlockedJunctionDistance(car, route, index, d - HALF * 2, MIN_GAP);
  }

  /** 要讓我的中心能走到 `r`，前面那台車得擺在多遠。 */
  const distFor = (r: number) => r + HALF * 2 + MIN_GAP;

  // 邊界要釘在 `exit` 上，而且要靠得比半個車身近 —— 判斷寫成 `exit ± 半車身`
  // 時，離得遠的距離會給出同樣的答案，測不出東西。
  const NEAR = 0.05;   // < HALF

  it('should let the car in when its midpoint can clear the junction', () => {
    expect(ask(distFor(EXIT + NEAR), true)).toBe(Infinity);
  });

  it('should keep it out when it cannot even get its midpoint across', () => {
    // 中心都過不去就是整台車卡在路口裡。
    expect(ask(distFor(EXIT - NEAR), true)).toBeCloseTo(ENTER - HALF - STOP_LINE_OFFSET, 9);
  });

  it('should ignore a car that is still moving', () => {
    // 這是規則原本最大的毛病:`findGapAhead` 不分排隊還是行進，於是「前方兩格內
    // 有車」就擋人 —— 而兩格是正常車距。
    expect(ask(distFor(EXIT - NEAR), false), '被一台還在開的車擋住了').toBe(Infinity);
  });

  it('should never brake a car that is already inside the box', () => {
    // 已經進去了就只能開出去。在裡面煞停正是這條規則要防的畫面。
    expect(ask(distFor(0.2), true, ROUTE, { ...CAR, edgeIndex: 1, edgeProgress: 0.5 })).toBe(Infinity);
  });

  it('should not look at all when the road ahead is empty', () => {
    // 自由車流是絕大多數的情況，要在第一行就回頭 —— 這是這條規則不花錢的原因。
    const empty = new Map<string, EdgeEntry[]>();
    expect(findBlockedJunctionDistance(CAR, ROUTE, empty, Infinity, MIN_GAP)).toBe(Infinity);
    expect(ask(distFor(0.5), true, path(6, -1))).toBe(Infinity);
  });
});


/** 每 `every` 段一個路口的路線。 */
function pathEvery(n: number, every: number): LaneEdge[] {
  const edges = path(n, -1);
  if (every > 0) for (let i = every; i < n; i += every) edges[i]!.insideJunction = true;
  return edges;
}

/** 一隊等速行進的車，跑 `seconds` 秒之後總共走了多遠。 */
function distanceCovered(every: number, seconds: number): number {
  const sim = new TrafficSimulation();
  const cars = [];
  for (let i = 0; i < 24; i++) {
    const v = sim.addVehicleOnEdges(pathEvery(200, every));
    // addVehicleOnEdges 會隨機挑車型與速度倍率，這裡要的是可重現的一列。
    v.length = 0.22; v.width = 0.09;
    v.speedMultiplier = 1;
    v.stallTime = 0;
    v.edgeIndex = i * 2;
    cars.push(v);
  }
  for (let t = 0; t < seconds / 0.02; t++) sim.advanceEdgeVehicles(0.02, () => true);
  return cars.reduce((sum, v) => sum + v.edgeIndex + v.edgeProgress, 0);
}

describe('路口不該拖慢正常車流', () => {
  it('should not cost a moving stream any distance at all', () => {
    // 兩格的車距是**正常車距**，不是塞車。原本的規則不分停著還是在開，於是
    // 這一列車每經過一個路口就煞一次 —— 使用者看到的「右轉車也在停止線上等」
    // 主要就是這個。
    const withJunctions = distanceCovered(4, 20);
    const plain = distanceCovered(0, 20);
    expect(withJunctions / plain, `有路口跑了 ${withJunctions.toFixed(1)}，沒路口 ${plain.toFixed(1)}`)
      .toBeGreaterThan(0.99);
  });

  it('fixture sanity: the stream really does pass junctions, packed close', () => {
    // 上面那條可以靠「車距大到規則永遠不觸發」或「路上根本沒有路口」空轉。
    const route = pathEvery(200, 4);
    expect(route.filter(e => e.insideJunction).length, '路線上沒有路口').toBeGreaterThan(10);
    // 車距 2 格 —— 小於原本規則要求的淨空（exit + 半車身，約 2.1 格）。
    expect(2 - 0.22, '車距大到原本的規則也不會觸發，這條測不出東西').toBeLessThan(2.11);
  });
});

/**
 * 一張同時有十字、T 字、L 彎、直路與六線道的地圖。
 *
 * 六線道是為了生出 `lane_change` 邊 —— 那也是穿過路口的一種走法，漏標的話車
 * 可以靠換道停在路口裡。
 */
function mixedCity() {
  const grid = new Grid(24, 24);
  const rb = new RoadBuilder(grid);
  rb.buildRoad({ x: 2, y: 5 }, { x: 14, y: 5 }, RoadType.TWO_LANE, 1e6);   // 主街
  rb.buildRoad({ x: 5, y: 2 }, { x: 5, y: 9 }, RoadType.TWO_LANE, 1e6);    // 十字 @ 5,5
  rb.buildRoad({ x: 9, y: 5 }, { x: 9, y: 9 }, RoadType.TWO_LANE, 1e6);    // T 字 @ 9,5
  rb.buildRoad({ x: 14, y: 5 }, { x: 14, y: 9 }, RoadType.TWO_LANE, 1e6);  // L 彎 @ 14,5
  rb.buildRoad({ x: 2, y: 15 }, { x: 12, y: 15 }, RoadType.SIX_LANE, 1e6);
  rb.buildRoad({ x: 7, y: 12 }, { x: 7, y: 18 }, RoadType.SIX_LANE, 1e6);  // 六線道十字 @ 7,15

  const lookup = UnifiedRoadLookup.fromGrid(grid);
  const graph = new LaneGraph();
  graph.buildFromGrid(lookup, lookup.getAllCellKeys());
  return { graph, lookup };
}

/** 這一段是不是「留在同一格裡」—— 是的話回傳那一格。 */
function stayInsideCell(e: LaneEdge): string | null {
  if (e.viaCellKey) return e.viaCellKey;
  return e.from.cellKey === e.to.cellKey ? e.from.cellKey : null;
}

describe('哪一段算在路口裡', () => {
  it('should mark exactly the edges that traverse a 3+ way cell', () => {
    // 完整刻畫，不是抽樣:每一段都比對一次。只驗「哪一格被標到」是不夠的 ——
    // 十字路口同時有 within-cell、cross-intersection turn 與 lane_change 三種邊，
    // 漏掉其中一種時被標到的格子集合完全一樣。
    const { graph, lookup } = mixedCity();
    for (const e of graph.getAllEdges()) {
      const owner = stayInsideCell(e);
      const cell = owner ? lookup.getCellByKey(owner) : null;
      const expected = cell !== null && isIntersectionCell(cell.roadFlags);
      expect(!!e.insideJunction, `${e.type} ${e.id}`).toBe(expected);
    }
  });

  it('fixture sanity: really has all four kinds of edge to classify', () => {
    // 上面那條可以靠「地圖上根本沒有路口」或「沒有換道邊」空轉。
    const { graph } = mixedCity();
    const marked = graph.getAllEdges().filter(e => e.insideJunction);
    const counts = (list: LaneEdge[]) => new Set(list.map(e => e.type));
    expect(counts(marked), '路口裡少了某一種邊').toEqual(new Set(['straight', 'turn', 'lane_change']));
    expect(graph.getAllEdges().some(e => !e.insideJunction), '整張圖都是路口').toBe(true);
  });

  it('should not mark an L bend', () => {
    // 彎道也是「換方向」，但只有兩個方向 —— 沒有橫向車流會被擋住，照舊可以排隊。
    const { graph } = mixedCity();
    const bend = graph.getAllEdges().filter(e => stayInsideCell(e) === '14,5');
    expect(bend.length, '(14,5) 那個彎沒有任何邊，這條測不出東西').toBeGreaterThan(0);
    expect(bend.filter(e => e.insideJunction), '轉角被當成路口了').toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { SidewalkGraph, type GridLookup } from '../SidewalkGraph';
import { RoadType, RoadDirection } from '../../road/types';

/**
 * 圖裡不該有指向已經不存在的節點的邊。
 *
 * 邊是雙向存的：`a→b` 放在 a 的鄰接串列、`b→a` 放在 b 的。刪掉 b 的時候，a 手上
 * 那一條也得刪 —— 否則 A* 照樣走得過去，行人走在已經不存在的人行道上。
 *
 * 這件事一直沒發生：反向邊是拿 `${to.id}→${nodeId}` 去比對的，而真正的邊 id 是
 * `${type}|${roadTypes}:${from}→${to}`（BUG-159 與 BUG-160 先後把種類與路寬折進
 * id 裡），兩者永遠對不上，`findIndex` 一次都沒有命中過。
 *
 * 平常看不出來，是因為 `updateCells` 會把改動格子的四個鄰居整批砍掉重建，順手把
 * 那些殘邊一起帶走。但它重建的範圍是「改動格 + 一圈」，殘邊的持有者卻可能在兩格
 * 之外 —— 那一圈之外的鄰接串列從來沒有被清過。
 */

interface Cell { roadType: number; roadFlags: number; buildingId: number }

function eastWestRoad(): {
  graph: SidewalkGraph;
  /** 在 (x, y) 蓋一條路，然後只重算那一格。 */
  buildRoadAt(x: number, y: number): void;
  /** 整張圖重建一次，可以指定這一次不要納入哪些格子。 */
  rebuildAll(exclude?: string[]): void;
} {
  const cells = new Map<string, Cell>();
  const put = (x: number, y: number) =>
    cells.set(`${x},${y}`, { roadType: RoadType.TWO_LANE, roadFlags: 0, buildingId: 0 });

  for (let x = 3; x <= 9; x++) put(x, 10);

  const relink = () => {
    for (const [key, cell] of cells) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const at = (dx: number, dy: number) => cells.get(`${x + dx},${y + dy}`);
      let f = 0;
      if (at(0, -1)) f |= RoadDirection.NORTH;
      if (at(0, 1)) f |= RoadDirection.SOUTH;
      if (at(1, 0)) f |= RoadDirection.EAST;
      if (at(-1, 0)) f |= RoadDirection.WEST;
      cell.roadFlags = f;
    }
  };
  relink();

  const lookup: GridLookup = { getCell: (x, y) => cells.get(`${x},${y}`) ?? null };
  const graph = new SidewalkGraph();
  graph.buildFromGrid(lookup, [...cells.keys()], []);

  return {
    graph,
    buildRoadAt(x, y) {
      put(x, y);
      relink();
      graph.updateCells(lookup, [`${x},${y}`]);
    },
    rebuildAll(exclude = []) {
      const skip = new Set(exclude);
      graph.buildFromGrid(lookup, [...cells.keys()].filter(k => !skip.has(k)), []);
    },
  };
}

/** 指向已經不在圖裡的節點的邊。 */
function danglingEdges(graph: SidewalkGraph): string[] {
  const out: string[] = [];
  for (const node of graph.getAllNodes()) {
    for (const e of graph.getEdgesFrom(node.id)) {
      if (!graph.getNode(e.to.id)) out.push(e.id);
    }
  }
  return out;
}

describe('人行道圖的殘邊', () => {
  it('should start out with no dangling edges', () => {
    const { graph } = eastWestRoad();
    expect(danglingEdges(graph), '剛建好就有殘邊').toHaveLength(0);
  });

  it('should leave no dangling edge when a node disappears', () => {
    // 在 (7,9) 蓋一條路 → (7,10) 北側多了一條路，那一側的人行道節點因此消失。
    // 重算範圍是 (7,9) 加一圈，蓋不到兩格外的 (6,10) —— 它手上那條指向
    // (7,10):NW 的邊沒有人清。
    const city = eastWestRoad();
    city.buildRoadAt(7, 9);

    expect(
      danglingEdges(city.graph),
      '有邊指向已經不存在的節點 —— A* 走得過去，行人走在不存在的人行道上',
    ).toHaveLength(0);
  });

  it('should not report edge ids that no longer exist', () => {
    // 退休掃描拿這份 id 判斷「這條路還在不在」。留著死 id，該退休的行人不會退休。
    const city = eastWestRoad();
    city.buildRoadAt(7, 9);

    const live = city.graph.getEdgeIds();
    const real = new Set(city.graph.getAllEdges().map(e => e.id));
    for (const id of live) {
      expect(real.has(id), `getEdgeIds 回報了一條已經不存在的邊：${id}`).toBe(true);
    }
    expect(live.size, 'getEdgeIds 與實際的邊對不起來').toBe(real.size);
  });

  it('should still match after a full rebuild', () => {
    // id 集合是隨增刪維護的，全量重建必須把它一起歸零 —— 否則上一代的 id 會留著，
    // 退休掃描會認為那些已經不存在的路還在。
    const city = eastWestRoad();
    city.buildRoadAt(7, 9);
    // 重建成一份比較小的圖 —— 重建成同一份佈局的話 id 剛好一樣，看不出有沒有清。
    city.rebuildAll(['9,10', '8,10']);

    const live = city.graph.getEdgeIds();
    const real = new Set(city.graph.getAllEdges().map(e => e.id));
    expect(live.size, '重建後 id 集合還混著上一代的邊').toBe(real.size);
    for (const id of live) expect(real.has(id), `殘留的舊 id：${id}`).toBe(true);
  });
});

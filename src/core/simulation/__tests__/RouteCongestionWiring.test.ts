import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { RoadType, RoadDirection } from '../../road/types';
import type { LaneEdge } from '../../traffic/LaneGraph';

/**
 * `RouteCongestion` 是純函式，測得很細;但「模擬有沒有真的去問它」是另一回事。
 * 接線斷掉（例如又退回全城平均、或傳一個常數）的話，那些純函式測試一個都不會紅。
 *
 * 這裡直接餵一份逐格流量圖與兩條路線:一條穿過爆量的走廊，一條走沒人的巷子。
 * 兩個人問出來的擁擠程度必須不一樣。
 */

/** 一條沿 +x 的路徑，經過 `cells` 這些格子。 */
function pathThrough(cells: string[]): LaneEdge[] {
  return cells.slice(0, -1).map((from, i) => {
    const to = cells[i + 1]!;
    return {
      id: `${from}->${to}`,
      from: {
        id: `${from}_x`, cellKey: from, position: { x: i, y: 0 },
        lane: 0, direction: 'east' as const, type: 'exit' as const, tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `${to}_n`, cellKey: to, position: { x: i + 1, y: 0 },
        lane: 0, direction: 'east' as const, type: 'entry' as const, tangent: { tx: 1, ty: 0 },
      },
      length: 1.0, type: 'straight' as const,
    };
  });
}

type Inner = {
  cityCongestionLevel: number;
  congestionFor(a: { x: number; y: number }, b: { x: number; y: number }): number;
};

function setup() {
  const state = createGameState(20, 20);
  for (let x = 0; x < 10; x++) {
    state.grid.setCell(x, 0, {
      roadType: RoadType.TWO_LANE, roadFlags: RoadDirection.EAST | RoadDirection.WEST,
    });
  }
  const loop = new SimulationLoop(state);
  const inner = loop as unknown as Inner;
  return { state, loop, inner };
}

describe('模擬真的去問逐路線的壅塞', () => {
  it('should give a busy corridor a higher number than a quiet lane', () => {
    const { state, loop, inner } = setup();

    // 爆量的走廊 vs 沒人的巷子。單位是「多少人的通勤路線經過這一格」。
    state.traffic.updatePredictedFlow(new Map([
      ['1,0', 12000], ['2,0', 12000], ['3,0', 12000],
      ['7,0', 0], ['8,0', 0], ['9,0', 0],
    ]));
    loop.commuteCache.setRouteVariants('1,0->3,0', [pathThrough(['1,0', '2,0', '3,0'])]);
    loop.commuteCache.setRouteVariants('7,0->9,0', [pathThrough(['7,0', '8,0', '9,0'])]);

    const busy = inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 });
    const quiet = inner.congestionFor({ x: 7, y: 0 }, { x: 9, y: 0 });

    expect(busy, '走在爆量走廊上卻不算塞').toBe(1);
    expect(quiet, '走在沒人的巷子卻算塞').toBe(0);
  });

  it('should fall back to the network average when the route is unknown', () => {
    // 沒算過的路線回「暢通」的話，新市民會以為開車很快 —— 那是猜，不是資料。
    const { state, loop, inner } = setup();
    state.traffic.updatePredictedFlow(new Map([['1,0', 12000]]));
    inner.cityCongestionLevel = 0.4;

    expect(loop.commuteCache.getRouteVariants('5,0->6,0'), '前置條件:這條路線沒有快取')
      .toBeUndefined();
    expect(inner.congestionFor({ x: 5, y: 0 }, { x: 6, y: 0 }), '沒算過的路線被當成暢通')
      .toBe(0.4);
  });

  it('should forget the cached numbers when the flow map changes', () => {
    // 逐路線的答案是快取的。蓋了路、車流散掉之後還回舊答案的話，玩家做的事就沒有回饋。
    const { state, loop, inner } = setup();
    const route = pathThrough(['1,0', '2,0', '3,0']);
    loop.commuteCache.setRouteVariants('1,0->3,0', [route]);

    state.traffic.updatePredictedFlow(new Map([['1,0', 12000], ['2,0', 12000], ['3,0', 12000]]));
    expect(inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 })).toBe(1);

    // 直接換掉流量圖不會清快取 —— 清快取的是 computeCongestionFlow。這裡驗的是
    // 「快取真的存在」，下一條驗它會被清掉。
    state.traffic.updatePredictedFlow(new Map());
    expect(inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 }), '沒有快取，每次都重算')
      .toBe(1);

    (loop as unknown as { computeCongestionFlow(): void }).computeCongestionFlow();
    expect(inner.congestionFor({ x: 1, y: 0 }, { x: 3, y: 0 }), '流量重算了，舊答案還留著')
      .not.toBe(1);
  });
});

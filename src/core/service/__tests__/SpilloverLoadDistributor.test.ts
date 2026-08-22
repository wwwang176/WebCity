import { describe, it, expect } from 'vitest';
import { distributeWithSpillover, type CoveringFacility } from '../SpilloverLoadDistributor';
import type { LoadDemand } from '../StationLoadDistributor';

interface Fac { id: string; capacity: number }

/** 一張手寫的「這一格由近到遠有誰涵蓋得到」表。真的那一份來自逐設施的覆蓋圖。 */
function covering(table: Record<string, CoveringFacility[]>) {
  return (x: number, y: number) => table[`${x},${y}`] ?? [];
}

describe('近的優先，滿了就換下一座', () => {
  it('should fill the nearest one first', () => {
    const facs: Fac[] = [{ id: 'A', capacity: 100 }, { id: 'B', capacity: 100 }];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 60 }], load,
      covering({ '0,0': [{ id: 'A', cost: 10 }, { id: 'B', cost: 90 }] }));

    expect(load.get('A')).toBe(60);
    expect(load.get('B'), '還沒滿就先溢出去了').toBe(0);
  });

  it('should spill the surplus into the next one along', () => {
    // 這就是使用者回報的那件事:上一版全部擠在最近那間，第二間永遠空著。
    const facs: Fac[] = [{ id: 'A', capacity: 100 }, { id: 'B', capacity: 100 }];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 150 }], load,
      covering({ '0,0': [{ id: 'A', cost: 10 }, { id: 'B', cost: 90 }] }));

    expect(load.get('A'), '最近那間該收滿').toBe(100);
    expect(load.get('B'), '溢出去的沒有落到第二近的那間').toBe(50);
  });

  it('should walk down the whole list, not just to the second', () => {
    const facs: Fac[] = [{ id: 'A', capacity: 10 }, { id: 'B', capacity: 10 }, { id: 'C', capacity: 10 }];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 25 }], load,
      covering({ '0,0': [{ id: 'A', cost: 1 }, { id: 'B', cost: 2 }, { id: 'C', cost: 3 }] }));

    expect([load.get('A'), load.get('B'), load.get('C')]).toEqual([10, 10, 5]);
  });

  it('should pile the leftover on the nearest when everything is full', () => {
    // 硬性截在容量的話，沒有任何一座會超過 100% —— 而「超載」正是這些數字的用途。
    const facs: Fac[] = [{ id: 'A', capacity: 10 }, { id: 'B', capacity: 10 }];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 50 }], load,
      covering({ '0,0': [{ id: 'A', cost: 1 }, { id: 'B', cost: 2 }] }));

    expect(load.get('B')).toBe(10);
    expect(load.get('A'), '超出的量被截掉了，沒有人顯示超載').toBe(40);
  });

  it('should never send demand to a facility that cannot reach it', () => {
    // 河對岸那一間:直線很近，但覆蓋到不了。名單裡本來就不會有它。
    const facs: Fac[] = [{ id: 'A', capacity: 5 }, { id: 'FarSide', capacity: 999 }];
    const load = new Map<string, number>();

    const r = distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 40 }], load,
      covering({ '0,0': [{ id: 'A', cost: 1 }] }));

    expect(load.get('FarSide'), '涵蓋不到的設施收了需求').toBe(0);
    expect(load.get('A')).toBe(40);
    expect(r.unassigned).toBe(0);
  });

  it('should let the block next door claim its hospital before a distant one does', () => {
    // 兩個街區都涵蓋得到 A。近的那個先占 —— 反過來的話，一個邊陲街區可以先把
    // 市中心的醫院占滿，而那不像任何現實中的就醫行為。
    const facs: Fac[] = [{ id: 'A', capacity: 100 }, { id: 'B', capacity: 100 }];
    const demands: LoadDemand[] = [
      { x: 9, y: 0, weight: 80 }, // 離 A 很遠
      { x: 1, y: 0, weight: 80 }, // 就在 A 隔壁
    ];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, demands, load, covering({
      '1,0': [{ id: 'A', cost: 1 }, { id: 'B', cost: 80 }],
      '9,0': [{ id: 'A', cost: 70 }, { id: 'B', cost: 75 }],
    }));

    // 隔壁那 80 先進 A，遠的那 80 只剩 20 個位子，其餘溢到 B。
    expect(load.get('A')).toBe(100);
    expect(load.get('B')).toBe(60);
  });

  it('should give the same answer whatever order the caller passes demands in', () => {
    // 這份攤派每 6 個 tick 重算一次。順序決定結果的話，面板上的數字會自己跳動。
    //
    // 近的那個街區**只有 A 涵蓋得到**（沒有第二選擇），遠的那個兩間都到得了。
    // 不排隊的話，遠的先占滿 A，近的就無處可去 —— 而它其實就住在 A 隔壁。
    const facs: Fac[] = [{ id: 'A', capacity: 100 }, { id: 'B', capacity: 100 }];
    const table = covering({
      '1,0': [{ id: 'A', cost: 1 }],
      '9,0': [{ id: 'A', cost: 70 }, { id: 'B', cost: 75 }],
    });
    const forward = new Map<string, number>();
    const backward = new Map<string, number>();

    distributeWithSpillover(facs, [{ x: 1, y: 0, weight: 80 }, { x: 9, y: 0, weight: 80 }], forward, table);
    distributeWithSpillover(facs, [{ x: 9, y: 0, weight: 80 }, { x: 1, y: 0, weight: 80 }], backward, table);

    expect([...forward], '順序換了答案就不一樣').toEqual([...backward]);
    // 隔壁那 80 先進 A，遠的那 80 只剩 20 個位子，其餘 60 溢到 B。
    expect(forward.get('A')).toBe(100);
    expect(forward.get('B')).toBe(60);
  });

  it('should keep unserved demand in the city total', () => {
    const facs: Fac[] = [{ id: 'A', capacity: 100 }];
    const load = new Map<string, number>();

    const r = distributeWithSpillover(facs,
      [{ x: 0, y: 0, weight: 30 }, { x: 50, y: 50, weight: 20 }], load,
      covering({ '0,0': [{ id: 'A', cost: 1 }] }));

    expect(load.get('A')).toBe(30);
    expect(r.unassigned, '沒服務到的需求消失了').toBe(20);
    expect(r.loadRatio, '分子該是 50 不是 30').toBeCloseTo(0.5, 6);
  });

  it('should drop a facility that has gone since coverage was computed', () => {
    const facs: Fac[] = [{ id: 'A', capacity: 100 }];
    const load = new Map<string, number>();

    const r = distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 40 }], load,
      covering({ '0,0': [{ id: 'DEMOLISHED', cost: 1 }] }));

    expect(load.has('DEMOLISHED')).toBe(false);
    expect(r.unassigned).toBe(40);
  });

  it('should call it infinitely overloaded when there is nowhere to go', () => {
    const r = distributeWithSpillover([], [{ x: 0, y: 0, weight: 10 }], new Map(), () => []);

    expect(r.loadRatio).toBe(Infinity);
    expect(r.unassigned).toBe(10);
  });

  it('should treat a zero-capacity facility as already full', () => {
    const facs: Fac[] = [{ id: 'Dead', capacity: 0 }, { id: 'B', capacity: 50 }];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 30 }], load,
      covering({ '0,0': [{ id: 'Dead', cost: 1 }, { id: 'B', cost: 9 }] }));

    expect(load.get('B'), '容量 0 的設施吞掉了需求').toBe(30);
    expect(load.get('Dead')).toBe(0);
  });
});

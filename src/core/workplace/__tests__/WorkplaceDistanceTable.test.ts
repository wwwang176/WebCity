import { describe, it, expect } from 'vitest';
import {
  WorkplaceDistanceTable, WorkplaceDistanceTableBuilder, MAX_WORKPLACES,
} from '../WorkplaceDistanceTable';

const W = 8, H = 6;

/** 一張 `dense[y * W + x] = cost` 的表，其餘都是 -1。 */
function dense(entries: Array<[number, number, number]>): Int32Array {
  const a = new Int32Array(W * H).fill(-1);
  for (const [x, y, cost] of entries) a[y * W + x] = cost;
  return a;
}

function build(rows: Array<{ pos: string; cells: Array<[number, number, number]> }>) {
  const b = new WorkplaceDistanceTableBuilder(W, H);
  for (const r of rows) b.addWorkplace(r.pos, dense(r.cells));
  return new WorkplaceDistanceTable(b.build());
}

describe('逐格的工作地距離表', () => {
  it('should be empty when nothing was added', () => {
    const t = build([]);

    expect(t.workplaceCount).toBe(0);
    expect(t.entryCount).toBe(0);
    expect(t.reachableWorkplacesAt(1, 1)).toEqual(new Set());
  });

  it('should give back what one workplace reached', () => {
    const t = build([{ pos: '5,5', cells: [[1, 1, 36], [2, 1, 72]] }]);

    expect(t.costAt(1, 1, '5,5')).toBe(36);
    expect(t.costAt(2, 1, '5,5')).toBe(72);
    expect(t.costAt(3, 1, '5,5'), '沒到過的格子被說成到得了').toBeUndefined();
  });

  it('should keep several workplaces on the same cell apart', () => {
    const t = build([
      { pos: '5,5', cells: [[1, 1, 36]] },
      { pos: '7,0', cells: [[1, 1, 180]] },
    ]);

    expect(t.costAt(1, 1, '5,5')).toBe(36);
    expect(t.costAt(1, 1, '7,0')).toBe(180);
    expect(t.reachableWorkplacesAt(1, 1)).toEqual(new Set(['5,5', '7,0']));
  });

  it('should not leak a cost across cells', () => {
    // 轉置的計數排序寫錯位移，最典型的症狀就是成本落到隔壁格。
    const t = build([
      { pos: '5,5', cells: [[1, 1, 36], [4, 3, 900]] },
      { pos: '7,0', cells: [[4, 3, 180]] },
    ]);

    expect(t.costAt(4, 3, '5,5')).toBe(900);
    expect(t.costAt(4, 3, '7,0')).toBe(180);
    expect(t.costAt(1, 1, '7,0')).toBeUndefined();
  });

  it('should treat a zero cost as reachable', () => {
    // 0 是合法成本（住在工作地隔壁）。用 falsy 判斷會把它當成「到不了」。
    const t = build([{ pos: '5,5', cells: [[1, 1, 0]] }]);

    expect(t.costAt(1, 1, '5,5')).toBe(0);
    expect(t.reachableWorkplacesAt(1, 1)).toEqual(new Set(['5,5']));
  });

  it('should say nothing outside the grid', () => {
    // `x = -1, y = 2` 摺出來的索引正好是 `(W - 1, 1)`。不擋界外的話，左邊出界
    // 會拿到上一列最右邊那一格的答案 —— 所以 fixture 刻意把資料放在那裡。
    const t = build([{ pos: '5,5', cells: [[W - 1, 1, 36], [1, 1, 12]] }]);

    expect(t.reachableWorkplacesAt(W - 1, 1), 'fixture 沒把資料放在會被撞到的格子上')
      .toEqual(new Set(['5,5']));
    expect(t.reachableWorkplacesAt(-1, 2), '左邊出界折回上一列了').toEqual(new Set());
    expect(t.costAt(-1, 2, '5,5')).toBeUndefined();
    expect(t.reachableWorkplacesAt(1, H)).toEqual(new Set());
    expect(t.reachableWorkplacesAt(1, -1)).toEqual(new Set());
  });

  it('should intersect with the targets asked for', () => {
    const t = build([
      { pos: '5,5', cells: [[1, 1, 36]] },
      { pos: '7,0', cells: [[1, 1, 180]] },
      { pos: '0,4', cells: [[1, 1, 9]] },
    ]);

    const got = t.distancesAt(1, 1, new Set(['5,5', '0,4', '3,3']));

    expect([...got].sort()).toEqual([['0,4', 9], ['5,5', 36]]);
  });

  it('should not answer for a workplace it has never heard of', () => {
    const t = build([{ pos: '5,5', cells: [[1, 1, 36]] }]);

    expect(t.costAt(1, 1, '9,9')).toBeUndefined();
    expect(t.distancesAt(1, 1, new Set(['9,9']))).toEqual(new Map());
  });

  it('should hand over buffers that can be transferred', () => {
    const b = new WorkplaceDistanceTableBuilder(W, H);
    b.addWorkplace('5,5', dense([[1, 1, 36]]));
    const buffers = b.build();

    const list = WorkplaceDistanceTable.transferables(buffers);

    expect(list).toEqual([buffers.offsets.buffer, buffers.wpIndex.buffer, buffers.cost.buffer]);
    // structured clone 不複製它們才是重點 —— 三個都要是自己獨立的 buffer。
    expect(new Set(list).size, '三個檢視共用同一個 buffer，transfer 會爆').toBe(3);
  });

  it('should survive a round trip through the buffers', () => {
    const b = new WorkplaceDistanceTableBuilder(W, H);
    b.addWorkplace('5,5', dense([[1, 1, 36], [2, 2, 72]]));
    b.addWorkplace('7,0', dense([[1, 1, 180]]));

    const revived = new WorkplaceDistanceTable(b.build());

    expect(revived.costAt(1, 1, '5,5')).toBe(36);
    expect(revived.costAt(2, 2, '5,5')).toBe(72);
    expect(revived.costAt(1, 1, '7,0')).toBe(180);
  });

  it('should refuse more workplaces than the index can hold', () => {
    // wpIndex 是 Uint16Array。悄悄溢位的話，第 65 536 個工作地會變成第 0 個 ——
    // 全城的通勤距離都指到別人家，而且不會有任何錯誤。
    const b = new WorkplaceDistanceTableBuilder(W, H);
    const empty = new Int32Array(W * H).fill(-1);
    for (let i = 0; i < MAX_WORKPLACES; i++) b.addWorkplace(`w${i}`, empty);

    expect(b.workplaceCount).toBe(MAX_WORKPLACES);
    expect(() => b.addWorkplace('one-too-many', empty)).toThrow(RangeError);
  });

  it('should count every entry it was given', () => {
    const b = new WorkplaceDistanceTableBuilder(W, H);
    b.addWorkplace('5,5', dense([[1, 1, 36], [2, 2, 72]]));
    b.addWorkplace('7,0', dense([[1, 1, 180]]));

    expect(new WorkplaceDistanceTable(b.build()).entryCount).toBe(3);
  });
});

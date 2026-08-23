import { describe, it, expect } from 'vitest';
import { EdgeVehicleIndex, NO_ENTRY } from '../EdgeVehicleIndex';

/** 收一批車，回一個查得動的索引。 */
function indexOf(rows: Array<[string, number, number, number, boolean]>) {
  const ix = new EdgeVehicleIndex();
  ix.begin();
  for (const [edge, vid, progress, halfLen, queueing] of rows) {
    ix.add(edge, vid, progress, halfLen, queueing);
  }
  return ix;
}

describe('逐邊的車輛索引', () => {
  it('should be empty before anything is added', () => {
    const ix = new EdgeVehicleIndex();
    ix.begin();

    expect(ix.size).toBe(0);
    expect(ix.entriesOf('e1')).toEqual([]);
  });

  it('should keep every field of one vehicle', () => {
    const ix = indexOf([['e1', 7, 1.25, 0.11, true]]);

    expect(ix.entriesOf('e1')).toEqual([{ vid: 7, progress: 1.25, halfLen: 0.11, queueing: true }]);
  });

  it('should keep vehicles on different edges apart', () => {
    const ix = indexOf([
      ['e1', 1, 0.5, 0.11, false],
      ['e2', 2, 0.7, 0.13, true],
      ['e1', 3, 0.9, 0.11, false],
    ]);

    expect(ix.entriesOf('e1').map(e => e.vid).sort()).toEqual([1, 3]);
    expect(ix.entriesOf('e2').map(e => e.vid)).toEqual([2]);
  });

  it('should say nothing for an edge it never saw', () => {
    const ix = indexOf([['e1', 1, 0.5, 0.11, false]]);

    expect(ix.entriesOf('nope')).toEqual([]);
    expect(ix.firstOf('nope')).toBe(NO_ENTRY);
  });

  it('should not leak last frame into this one', () => {
    // 這是池化那一版被撤掉的原因:殘留的欄位不會讓任何測試變紅，而失敗模式是
    // 跟車距離靜靜地算錯。這裡用「上一幀滿載、這一幀只有一台」把它釘住。
    const ix = new EdgeVehicleIndex();
    ix.begin();
    for (let i = 0; i < 10; i++) ix.add('e1', 100 + i, i, 0.2, true);

    ix.begin();
    ix.add('e1', 5, 0.5, 0.11, false);

    expect(ix.size).toBe(1);
    expect(ix.entriesOf('e1')).toEqual([{ vid: 5, progress: 0.5, halfLen: 0.11, queueing: false }]);
  });

  it('should empty an edge that has no vehicles this frame', () => {
    const ix = new EdgeVehicleIndex();
    ix.begin();
    ix.add('e1', 1, 0.5, 0.11, false);
    ix.add('e2', 2, 0.5, 0.11, false);

    ix.begin();
    ix.add('e2', 3, 0.5, 0.11, false);

    expect(ix.entriesOf('e1'), '上一幀在 e1 上的車還留著').toEqual([]);
    expect(ix.entriesOf('e2').map(e => e.vid)).toEqual([3]);
  });

  it('should grow past its initial capacity', () => {
    const rows: Array<[string, number, number, number, boolean]> = [];
    for (let i = 0; i < 500; i++) rows.push([`e${i % 40}`, i, i * 0.01, 0.11, i % 3 === 0]);
    const ix = indexOf(rows);

    expect(ix.size).toBe(500);
    let total = 0;
    for (let e = 0; e < 40; e++) total += ix.entriesOf(`e${e}`).length;
    expect(total, '長大之後掉了幾筆').toBe(500);
  });

  it('should still be right after growing mid-frame', () => {
    // 擴容會換掉底層的 buffer。散佈階段若讀到舊的那一份，資料就會半新半舊。
    const rows: Array<[string, number, number, number, boolean]> = [];
    for (let i = 0; i < 300; i++) rows.push(['e1', i, i, 0.11, i === 299]);
    const ix = indexOf(rows);

    const got = ix.entriesOf('e1');
    expect(got.length).toBe(300);
    expect(got.map(e => e.vid).sort((a, b) => a - b)).toEqual(rows.map(r => r[1]));
    expect(got.filter(e => e.queueing).map(e => e.vid), 'queueing 的旗標跟著擴容跑掉了')
      .toEqual([299]);
  });

  it('should forget the edges when the road network is replaced', () => {
    const ix = indexOf([['e1', 1, 0.5, 0.11, false]]);
    ix.resetEdges();
    ix.begin();

    expect(ix.entriesOf('e1')).toEqual([]);
  });

  it('should keep a slot for an edge across frames', () => {
    // 槽號表跨幀重用是刻意的 —— 路網不變的話字串鍵也不變，每幀重建等於白做工。
    const ix = new EdgeVehicleIndex();
    ix.begin(); ix.add('e1', 1, 0.5, 0.11, false);    ix.begin(); ix.add('e1', 2, 0.6, 0.12, true);
    expect(ix.entriesOf('e1')).toEqual([{ vid: 2, progress: 0.6, halfLen: 0.12, queueing: true }]);
  });
});

describe('同一幀之內改索引', () => {
  it('should let a vehicle change edge', () => {
    // 車走到下一條邊時要當場搬過去，後面的車才看得到它現在在哪。
    const ix = new EdgeVehicleIndex();
    ix.begin();
    const a = ix.add('e1', 1, 0.5, 0.11, false);
    ix.add('e1', 2, 0.9, 0.11, false);
    ix.moveTo(a, 'e2');

    expect(ix.entriesOf('e1').map(e => e.vid)).toEqual([2]);
    expect(ix.entriesOf('e2').map(e => e.vid)).toEqual([1]);
  });

  it('should unhook the head of a list correctly', () => {
    const ix = new EdgeVehicleIndex();
    ix.begin();
    ix.add('e1', 1, 0.1, 0.11, false);
    const head = ix.add('e1', 2, 0.2, 0.11, false);   // 後進的在最前面
    ix.moveTo(head, 'e2');

    expect(ix.entriesOf('e1').map(e => e.vid)).toEqual([1]);
    expect(ix.entriesOf('e2').map(e => e.vid)).toEqual([2]);
  });

  it('should unhook from the middle of a list correctly', () => {
    const ix = new EdgeVehicleIndex();
    ix.begin();
    ix.add('e1', 1, 0.1, 0.11, false);
    const mid = ix.add('e1', 2, 0.2, 0.11, false);
    ix.add('e1', 3, 0.3, 0.11, false);
    ix.moveTo(mid, 'e2');

    expect(ix.entriesOf('e1').map(e => e.vid).sort()).toEqual([1, 3]);
    expect(ix.entriesOf('e2').map(e => e.vid)).toEqual([2]);
  });

  it('should update progress and braking in place', () => {
    const ix = new EdgeVehicleIndex();
    ix.begin();
    const a = ix.add('e1', 1, 0.5, 0.11, false);
    ix.setProgress(a, 1.75, true);

    expect(ix.entriesOf('e1')).toEqual([{ vid: 1, progress: 1.75, halfLen: 0.11, queueing: true }]);
  });

  it('should leave the list walkable after removing the one in front', () => {
    // 摘掉一筆時，它後面那一筆的 prev 也要修。不修的話那一筆之後再被摘走，
    // 會照著過期的 prev 走，於是**這條邊的頭指標沒有更新** —— 已經開走的車
    // 還掛在原本那條邊上，後車對著一台不存在的車煞車。
    const ix = new EdgeVehicleIndex();
    ix.begin();
    const first = ix.add('e1', 1, 0.1, 0.11, false);
    const second = ix.add('e1', 2, 0.2, 0.11, false);   // 後進的在最前面
    ix.moveTo(second, 'e2');
    ix.moveTo(first, 'e2');

    expect(ix.entriesOf('e1'), '搬走的車還掛在舊的那條邊上').toEqual([]);
    expect(ix.entriesOf('e2').map(e => e.vid).sort()).toEqual([1, 2]);
  });

  it('should survive a move back and forth', () => {
    const ix = new EdgeVehicleIndex();
    ix.begin();
    const a = ix.add('e1', 1, 0.5, 0.11, false);
    ix.moveTo(a, 'e2');
    ix.moveTo(a, 'e1');

    expect(ix.entriesOf('e1').map(e => e.vid)).toEqual([1]);
    expect(ix.entriesOf('e2')).toEqual([]);
  });
});

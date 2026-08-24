import { describe, it, expect } from 'vitest';
import { EdgeVehicleIndex, NO_ENTRY } from '../EdgeVehicleIndex';

/** Takes a batch of vehicles and returns a queryable index. */
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
    // Why pooling entries was dropped: a stale field turns no test red and the failure mode is
    // a silently wrong following distance. Pinned here with a full previous frame and a single
    // vehicle in this one.
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
    // Growing replaces the backing buffers. A scatter pass reading the old ones leaves half the
    // data stale.
    const rows: Array<[string, number, number, number, boolean]> = [];
    for (let i = 0; i < 300; i++) rows.push(['e1', i, i, 0.11, i === 299]);
    const ix = indexOf(rows);

    const got = ix.entriesOf('e1');
    expect(got.length).toBe(300);
    expect(got.map(e => e.vid).sort((a, b) => a - b)).toEqual(rows.map(r => r[1]));
    expect(got.filter(e => e.queueing).map(e => e.vid), 'queueing 的旗標跟著擴容跑掉了')
      .toEqual([299]);
  });

  it('should keep a slot for an edge across frames', () => {
    // Reusing slot numbers across frames is deliberate: the string keys do not change while the
    // road network does not, so rebuilding the table each frame is wasted work.
    const ix = new EdgeVehicleIndex();
    ix.begin(); ix.add('e1', 1, 0.5, 0.11, false);    ix.begin(); ix.add('e1', 2, 0.6, 0.12, true);
    expect(ix.entriesOf('e1')).toEqual([{ vid: 2, progress: 0.6, halfLen: 0.12, queueing: true }]);
  });
});

describe('同一幀之內改索引', () => {
  it('should let a vehicle change edge', () => {
    // A vehicle crossing onto the next edge moves across immediately, so followers see where it
    // now is.
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
    const head = ix.add('e1', 2, 0.2, 0.11, false);   // the last added sits at the head
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
    // Unhooking an entry must also fix the `prev` of the one behind it. Left stale, unhooking
    // that one follows the outdated `prev` and **never updates the edge's head pointer**: a
    // vehicle that has driven off stays listed on its old edge and followers brake for a
    // vehicle that is not there.
    const ix = new EdgeVehicleIndex();
    ix.begin();
    const first = ix.add('e1', 1, 0.1, 0.11, false);
    const second = ix.add('e1', 2, 0.2, 0.11, false);   // the last added sits at the head
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

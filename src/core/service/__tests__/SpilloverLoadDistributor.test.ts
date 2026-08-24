import { describe, it, expect } from 'vitest';
import { distributeWithSpillover, type CoveringFacility } from '../SpilloverLoadDistributor';
import type { LoadDemand } from '../StationLoadDistributor';

interface Fac { id: string; capacity: number }

/** A hand-written table of which facilities cover a cell, nearest first. The real one comes
 *  from the per-facility coverage maps. */
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
    // As reported: everything crowded into the nearest facility and the second stayed empty.
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
    // Truncating at capacity means no facility ever exceeds 100%, and overload is what these
    // numbers are for.
    const facs: Fac[] = [{ id: 'A', capacity: 10 }, { id: 'B', capacity: 10 }];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 50 }], load,
      covering({ '0,0': [{ id: 'A', cost: 1 }, { id: 'B', cost: 2 }] }));

    expect(load.get('B')).toBe(10);
    expect(load.get('A'), '超出的量被截掉了，沒有人顯示超載').toBe(40);
  });

  it('should never send demand to a facility that cannot reach it', () => {
    // The facility across the river: close in a straight line but out of coverage, so it never
    // appears on the list.
    const facs: Fac[] = [{ id: 'A', capacity: 5 }, { id: 'FarSide', capacity: 999 }];
    const load = new Map<string, number>();

    const r = distributeWithSpillover(facs, [{ x: 0, y: 0, weight: 40 }], load,
      covering({ '0,0': [{ id: 'A', cost: 1 }] }));

    expect(load.get('FarSide'), '涵蓋不到的設施收了需求').toBe(0);
    expect(load.get('A')).toBe(40);
    expect(r.unassigned).toBe(0);
  });

  it('should let the block next door claim its hospital before a distant one does', () => {
    // Both blocks are covered by A, and the nearer one claims it first. Reversed, an outlying
    // block could fill a downtown hospital, which matches no real pattern of seeking care.
    const facs: Fac[] = [{ id: 'A', capacity: 100 }, { id: 'B', capacity: 100 }];
    const demands: LoadDemand[] = [
      { x: 9, y: 0, weight: 80 }, // far from A
      { x: 1, y: 0, weight: 80 }, // right beside A
    ];
    const load = new Map<string, number>();

    distributeWithSpillover(facs, demands, load, covering({
      '1,0': [{ id: 'A', cost: 1 }, { id: 'B', cost: 80 }],
      '9,0': [{ id: 'A', cost: 70 }, { id: 'B', cost: 75 }],
    }));

    // The neighbouring 80 enter A first, leaving 20 places for the distant 80 and the rest
    // spilling into B.
    expect(load.get('A')).toBe(100);
    expect(load.get('B')).toBe(60);
  });

  it('should give the same answer whatever order the caller passes demands in', () => {
    // This allocation is recomputed every 6 ticks. If order decided the result, the panel's
    // numbers would jitter on their own.
    //
    // The near block is covered **only by A** and has no second choice, while the far one
    // reaches both. Unqueued, the far block fills A and the near one has nowhere to go, while
    // living next door to A.
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
    // The neighbouring 80 enter A first, leaving 20 places for the distant 80, with 60 spilling
    // into B.
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

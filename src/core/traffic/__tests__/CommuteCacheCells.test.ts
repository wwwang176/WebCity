import { describe, it, expect } from 'vitest';
import { collectEdgeCells } from '../CommuteCacheHelpers';
import type { LaneEdge } from '../LaneGraph';

function makeEdge(fromCell: string, toCell: string): LaneEdge {
  return {
    from: { cellKey: fromCell } as any,
    to: { cellKey: toCell } as any,
    laneIndex: 0,
    direction: 0,
  } as LaneEdge;
}

describe('collectEdgeCells', () => {
  it('collects unique cell keys from edges', () => {
    const edges = [
      makeEdge('1,2', '1,3'),
      makeEdge('1,3', '2,3'),
    ];
    const cells = collectEdgeCells(edges);
    expect(cells).toEqual(new Set(['1,2', '1,3', '2,3']));
  });

  it('returns empty set for empty array', () => {
    expect(collectEdgeCells([])).toEqual(new Set());
  });

  it('deduplicates shared cells', () => {
    const edges = [
      makeEdge('0,0', '1,0'),
      makeEdge('1,0', '0,0'), // same cells, reversed
    ];
    const cells = collectEdgeCells(edges);
    expect(cells.size).toBe(2);
    expect(cells).toEqual(new Set(['0,0', '1,0']));
  });

  it('includes viaCellKey from cross-intersection turn edges', () => {
    const edge = makeEdge('1,2', '3,2');
    (edge as any).viaCellKey = '2,2';
    const cells = collectEdgeCells([edge]);
    expect(cells).toEqual(new Set(['1,2', '2,2', '3,2']));
  });

  it('ignores viaCellKey when not set', () => {
    const edge = makeEdge('1,2', '2,2');
    const cells = collectEdgeCells([edge]);
    expect(cells).toEqual(new Set(['1,2', '2,2']));
  });

  it('collects from multiple paths when combined', () => {
    const morning = [makeEdge('0,0', '1,0')];
    const evening = [makeEdge('2,2', '3,3')];
    const allCells = new Set<string>();
    for (const c of collectEdgeCells(morning)) allCells.add(c);
    for (const c of collectEdgeCells(evening)) allCells.add(c);
    expect(allCells).toEqual(new Set(['0,0', '1,0', '2,2', '3,3']));
  });
});

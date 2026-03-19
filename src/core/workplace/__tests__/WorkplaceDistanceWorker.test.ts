import { describe, it, expect } from 'vitest';
import { reverseFloodFromWorkplace, computeAllDistances } from '../../../workers/workplace-distance.worker';
import { RoadType } from '../../road/types';

const BYTES_PER_CELL = 12;

/** Build a minimal grid buffer with only roadType set. */
function makeGridBuffer(width: number, height: number, roads: Map<string, RoadType>): ArrayBuffer {
  const buf = new ArrayBuffer(width * height * BYTES_PER_CELL);
  const view = new DataView(buf);
  for (const [key, rt] of roads) {
    const [x, y] = key.split(',').map(Number);
    const offset = (y! * width + x!) * BYTES_PER_CELL;
    view.setUint8(offset + 5, rt);
  }
  return buf;
}

describe('reverseFloodFromWorkplace', () => {
  it('returns workplace position itself as reachable at cost 0', () => {
    // 5x5 grid, road at (2,2), workplace at (2,1) adjacent to road
    const roads = new Map([['2,2', RoadType.TWO_LANE]]);
    const buf = makeGridBuffer(5, 5, roads);
    const view = new DataView(buf);

    const result = reverseFloodFromWorkplace(view, 5, 5, { pos: '2,1', x: 2, y: 1 }, 60);
    // workplace (2,1) is adjacent to road (2,2), so it should be reachable
    expect(result['2,1']).toBe(0);
    expect(result['2,2']).toBe(0); // the seed road cell
  });

  it('follows straight road and includes adjacent buildings', () => {
    // Road: (1,2)-(2,2)-(3,2)-(4,2), workplace at (1,2)
    const roads = new Map<string, RoadType>([
      ['1,2', RoadType.TWO_LANE],
      ['2,2', RoadType.TWO_LANE],
      ['3,2', RoadType.TWO_LANE],
      ['4,2', RoadType.TWO_LANE],
    ]);
    const buf = makeGridBuffer(6, 5, roads);
    const view = new DataView(buf);

    const result = reverseFloodFromWorkplace(view, 6, 5, { pos: '1,2', x: 1, y: 2 }, 60);

    // Road cells should be reachable
    expect(result['1,2']).toBe(0);
    expect(result['2,2']).toBeDefined();
    expect(result['3,2']).toBeDefined();
    expect(result['4,2']).toBeDefined();

    // Building adjacent to road cell (3,1) should be reachable
    expect(result['3,1']).toBeDefined();
    // Cost should equal the road cell's cost
    expect(result['3,1']).toBe(result['3,2']);
  });

  it('respects budget limit', () => {
    // Long road, tiny budget
    const roads = new Map<string, RoadType>();
    for (let x = 0; x < 20; x++) {
      roads.set(`${x},0`, RoadType.TWO_LANE);
    }
    const buf = makeGridBuffer(20, 1, roads);
    const view = new DataView(buf);

    const result = reverseFloodFromWorkplace(view, 20, 1, { pos: '0,0', x: 0, y: 0 }, 5);

    // Should not reach all cells
    expect(result['0,0']).toBe(0);
    // Far cells should be unreachable
    expect(result['19,0']).toBeUndefined();
  });

  it('handles disconnected roads', () => {
    // Two separate road segments
    const roads = new Map<string, RoadType>([
      ['1,0', RoadType.TWO_LANE],
      ['2,0', RoadType.TWO_LANE],
      // gap
      ['5,0', RoadType.TWO_LANE],
      ['6,0', RoadType.TWO_LANE],
    ]);
    const buf = makeGridBuffer(8, 1, roads);
    const view = new DataView(buf);

    const result = reverseFloodFromWorkplace(view, 8, 1, { pos: '1,0', x: 1, y: 0 }, 60);

    expect(result['1,0']).toBe(0);
    expect(result['2,0']).toBeDefined();
    // Disconnected segment should NOT be reachable
    expect(result['5,0']).toBeUndefined();
    expect(result['6,0']).toBeUndefined();
  });
});

describe('computeAllDistances', () => {
  it('returns entries for all workplaces', () => {
    const roads = new Map<string, RoadType>([
      ['1,0', RoadType.TWO_LANE],
      ['2,0', RoadType.TWO_LANE],
      ['3,0', RoadType.TWO_LANE],
    ]);
    const buf = makeGridBuffer(5, 3, roads);
    const view = new DataView(buf);

    const entries = computeAllDistances(view, 5, 3, [
      { pos: '1,0', x: 1, y: 0 },
      { pos: '3,0', x: 3, y: 0 },
    ], 60);

    expect(entries.length).toBe(2);
    expect(entries[0]!.workplacePos).toBe('1,0');
    expect(entries[1]!.workplacePos).toBe('3,0');
    // Both should reach each other
    expect(entries[0]!.distances['3,0']).toBeDefined();
    expect(entries[1]!.distances['1,0']).toBeDefined();
  });
});

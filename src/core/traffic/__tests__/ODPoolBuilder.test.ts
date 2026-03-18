import { describe, it, expect } from 'vitest';
import { buildODPools, type CommutingCitizen } from '../ODPoolBuilder';

function parsePos(key: string) {
  const [x, y] = key.split(',').map(Number);
  return { x: x!, y: y! };
}

describe('buildODPools', () => {
  it('returns null when no citizens provided', () => {
    expect(buildODPools([], parsePos)).toBeNull();
  });

  it('returns null when no citizens are working age', () => {
    const citizens: CommutingCitizen[] = [
      { age: 20, homeId: '1,2', workplaceId: '3,4' }, // child
      { age: 220, homeId: '1,2', workplaceId: '3,4' }, // senior
    ];
    expect(buildODPools(citizens, parsePos)).toBeNull();
  });

  it('returns null when working-age citizens have no home or workplace', () => {
    const citizens: CommutingCitizen[] = [
      { age: 100, homeId: null, workplaceId: '3,4' },
      { age: 100, homeId: '1,2', workplaceId: null },
      { age: 100, homeId: null, workplaceId: null },
    ];
    expect(buildODPools(citizens, parsePos)).toBeNull();
  });

  it('builds pools for a single valid citizen', () => {
    const citizens: CommutingCitizen[] = [
      { age: 100, homeId: '2,3', workplaceId: '5,6' },
    ];
    const result = buildODPools(citizens, parsePos);
    expect(result).not.toBeNull();
    expect(result!.residential).toEqual([{ x: 2, y: 3, weight: 1 }]);
    expect(result!.destinations).toEqual([{ x: 5, y: 6, weight: 1 }]);
    expect(result!.totalResWeight).toBe(1);
    expect(result!.totalDestWeight).toBe(1);
  });

  it('aggregates weights for citizens at the same home', () => {
    const citizens: CommutingCitizen[] = [
      { age: 100, homeId: '1,1', workplaceId: '3,3' },
      { age: 120, homeId: '1,1', workplaceId: '4,4' },
      { age: 150, homeId: '2,2', workplaceId: '3,3' },
    ];
    const result = buildODPools(citizens, parsePos)!;
    expect(result.residential).toHaveLength(2);
    const home11 = result.residential.find(e => e.x === 1 && e.y === 1);
    expect(home11!.weight).toBe(2);
    const home22 = result.residential.find(e => e.x === 2 && e.y === 2);
    expect(home22!.weight).toBe(1);
    expect(result.totalResWeight).toBe(3);
  });

  it('aggregates weights for citizens at the same workplace', () => {
    const citizens: CommutingCitizen[] = [
      { age: 100, homeId: '1,1', workplaceId: '5,5' },
      { age: 120, homeId: '2,2', workplaceId: '5,5' },
    ];
    const result = buildODPools(citizens, parsePos)!;
    expect(result.destinations).toHaveLength(1);
    expect(result.destinations[0]!.weight).toBe(2);
    expect(result.totalDestWeight).toBe(2);
  });

  it('filters out non-working-age and homeless citizens from pool', () => {
    const citizens: CommutingCitizen[] = [
      { age: 100, homeId: '1,1', workplaceId: '3,3' }, // valid
      { age: 20, homeId: '1,1', workplaceId: '3,3' }, // child - filtered
      { age: 100, homeId: null, workplaceId: '3,3' },   // no home - filtered
      { age: 100, homeId: '2,2', workplaceId: '4,4' }, // valid
    ];
    const result = buildODPools(citizens, parsePos)!;
    expect(result.totalResWeight).toBe(2);
    expect(result.totalDestWeight).toBe(2);
    expect(result.residential).toHaveLength(2);
  });

  it('returns null when all destinations are missing (homes exist but no workplaces)', () => {
    const citizens: CommutingCitizen[] = [
      { age: 100, homeId: '1,1', workplaceId: null },
      { age: 100, homeId: '2,2', workplaceId: null },
    ];
    expect(buildODPools(citizens, parsePos)).toBeNull();
  });
});

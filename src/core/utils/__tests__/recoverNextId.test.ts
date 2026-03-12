import { describe, it, expect } from 'vitest';
import { recoverNextId } from '../recoverNextId';

describe('recoverNextId', () => {
  it('returns 1 for empty array', () => {
    expect(recoverNextId([], 'police_')).toBe(1);
  });

  it('returns max + 1 for a single entity', () => {
    expect(recoverNextId([{ id: 'police_3' }], 'police_')).toBe(4);
  });

  it('finds the max across multiple entities', () => {
    const entities = [
      { id: 'park-2' },
      { id: 'park-5' },
      { id: 'park-1' },
    ];
    expect(recoverNextId(entities, 'park-')).toBe(6);
  });

  it('handles different prefix formats', () => {
    expect(recoverNextId([{ id: 'school-10' }], 'school-')).toBe(11);
    expect(recoverNextId([{ id: 'garbage_7' }], 'garbage_')).toBe(8);
    expect(recoverNextId([{ id: 'cem-4' }], 'cem-')).toBe(5);
  });

  it('handles entities with non-numeric suffixes gracefully', () => {
    // NaN from parseInt → treated as 0
    const entities = [{ id: 'bad_abc' }, { id: 'bad_3' }];
    expect(recoverNextId(entities, 'bad_')).toBe(4);
  });
});

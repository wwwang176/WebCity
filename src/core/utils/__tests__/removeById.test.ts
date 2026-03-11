import { describe, it, expect } from 'vitest';
import { removeById } from '../removeById';

interface Item { id: string; value: number }

describe('removeById', () => {
  it('removes item with matching id', () => {
    const arr: Item[] = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'c', value: 3 },
    ];
    removeById(arr, 'b');
    expect(arr).toEqual([
      { id: 'a', value: 1 },
      { id: 'c', value: 3 },
    ]);
  });

  it('returns true when item was found and removed', () => {
    const arr: Item[] = [{ id: 'a', value: 1 }];
    expect(removeById(arr, 'a')).toBe(true);
  });

  it('returns false when id is not found', () => {
    const arr: Item[] = [{ id: 'a', value: 1 }];
    expect(removeById(arr, 'z')).toBe(false);
  });

  it('does not modify array when id is not found', () => {
    const arr: Item[] = [{ id: 'a', value: 1 }];
    removeById(arr, 'z');
    expect(arr.length).toBe(1);
  });

  it('removes only the first matching item', () => {
    const arr: Item[] = [
      { id: 'a', value: 1 },
      { id: 'a', value: 2 },
    ];
    removeById(arr, 'a');
    expect(arr.length).toBe(1);
    expect(arr[0]!.value).toBe(2);
  });

  it('works on empty array', () => {
    const arr: Item[] = [];
    expect(removeById(arr, 'a')).toBe(false);
    expect(arr.length).toBe(0);
  });
});

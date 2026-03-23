import { describe, it, expect } from 'vitest';
import {
  getElevatedPath,
  type ElevatedPosition,
} from '../ElevatedPath';

describe('getElevatedPath', () => {
  // --- Origin cell preserved ---

  it('keeps origin cell at startLevel (not a ramp)', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 6, y: 0 },
      0, 1,
    );
    expect(path).not.toBeNull();
    // [0] = origin at level 0, NOT ramp
    expect(path![0]).toEqual({ x: 0, y: 0, level: 0, targetLevel: 0, isRamp: false, rampDirection: null });
    // [1] = ramp 0→1
    expect(path![1]!.isRamp).toBe(true);
    expect(path![1]!.level).toBe(0);
    expect(path![1]!.targetLevel).toBe(1);
    // [2..6] = elevated at level 1
    for (let i = 2; i <= 6; i++) {
      expect(path![i]!.level).toBe(1);
      expect(path![i]!.isRamp).toBe(false);
    }
  });

  it('generates 2 ramp cells for startLevel=0, targetLevel=2 (after origin)', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 7, y: 0 },
      0, 2,
    );
    expect(path).not.toBeNull();
    // [0] origin
    expect(path![0]!.isRamp).toBe(false);
    expect(path![0]!.level).toBe(0);
    // [1] ramp 0→1
    expect(path![1]!.isRamp).toBe(true);
    expect(path![1]!.level).toBe(0);
    expect(path![1]!.targetLevel).toBe(1);
    // [2] ramp 1→2
    expect(path![2]!.isRamp).toBe(true);
    expect(path![2]!.level).toBe(1);
    expect(path![2]!.targetLevel).toBe(2);
    // [3..7] at level 2
    expect(path![3]!.level).toBe(2);
    expect(path![3]!.isRamp).toBe(false);
  });

  it('generates 3 ramp cells for startLevel=0, targetLevel=3 (after origin)', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 9, y: 0 },
      0, 3,
    );
    expect(path).not.toBeNull();
    expect(path![0]!.isRamp).toBe(false); // origin
    expect(path![1]!.isRamp).toBe(true);  // ramp 0→1
    expect(path![2]!.isRamp).toBe(true);  // ramp 1→2
    expect(path![3]!.isRamp).toBe(true);  // ramp 2→3
    expect(path![4]!.level).toBe(3);
    expect(path![4]!.isRamp).toBe(false);
  });

  // --- Descending ramps ---

  it('generates descending ramps when startLevel > targetLevel', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 5, y: 0 },
      2, 0,
    );
    expect(path).not.toBeNull();
    // [0] origin at level 2
    expect(path![0]!.level).toBe(2);
    expect(path![0]!.isRamp).toBe(false);
    // [1] ramp 2→1
    expect(path![1]!.isRamp).toBe(true);
    expect(path![1]!.rampDirection).toBe('down');
    expect(path![1]!.level).toBe(2);
    expect(path![1]!.targetLevel).toBe(1);
    // [2] ramp 1→0
    expect(path![2]!.isRamp).toBe(true);
    expect(path![2]!.level).toBe(1);
    expect(path![2]!.targetLevel).toBe(0);
    // [3..5] at level 0
    expect(path![3]!.level).toBe(0);
    expect(path![3]!.isRamp).toBe(false);
  });

  // --- Same level (no ramps) ---

  it('produces no ramps when startLevel equals targetLevel', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 3, y: 0 },
      1, 1,
    );
    expect(path).not.toBeNull();
    // All at level 1, no ramps (origin is also level 1)
    expect(path!.every(p => !p.isRamp)).toBe(true);
    expect(path!.every(p => p.level === 1)).toBe(true);
  });

  // --- Auto end ramp ---

  describe('auto end ramp', () => {
    it('adds descending ramps at end and preserves landing cell', () => {
      // from (0,0) to (6,0), start=0, target=1, end=0
      const path = getElevatedPath(
        { x: 0, y: 0 }, { x: 6, y: 0 },
        0, 1, 0,
      );
      expect(path).not.toBeNull();
      // [0]: origin level 0
      expect(path![0]!.isRamp).toBe(false);
      expect(path![0]!.level).toBe(0);
      // [1]: ramp up 0→1
      expect(path![1]!.isRamp).toBe(true);
      expect(path![1]!.rampDirection).toBe('up');
      // [2..4]: body at level 1
      expect(path![2]!.level).toBe(1);
      expect(path![2]!.isRamp).toBe(false);
      // [5]: ramp down 1→0
      expect(path![5]!.isRamp).toBe(true);
      expect(path![5]!.rampDirection).toBe('down');
      expect(path![5]!.level).toBe(1);
      expect(path![5]!.targetLevel).toBe(0);
      // [6]: landing at level 0
      expect(path![6]!.level).toBe(0);
      expect(path![6]!.isRamp).toBe(false);
    });
  });

  // --- Path too short ---

  it('returns null when path too short for origin + ramp + body', () => {
    // Need origin(1) + ramp(2) + body(1) = 4, but path is (0,0)→(0,0) = 1 cell
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 0, y: 0 },
      0, 2,
    );
    expect(path).toBeNull();
  });

  it('returns null when path too short for start + end ramps', () => {
    // Need origin(1) + ramp(1) + body(1) + ramp(1) + landing(1) = 5
    // path (0,0)→(2,0) = 3 cells → too short
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 2, y: 0 },
      0, 1, 0,
    );
    expect(path).toBeNull();
  });

  // --- L-shaped path ---

  it('works with L-shaped paths (origin preserved)', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 3, y: 3 },
      0, 1,
    );
    expect(path).not.toBeNull();
    // Total cells: 3 horizontal + 3 vertical + 1 = 7
    expect(path!).toHaveLength(7);
    // Origin at (0,0) level 0
    expect(path![0]!.x).toBe(0);
    expect(path![0]!.y).toBe(0);
    expect(path![0]!.isRamp).toBe(false);
    // Ramp at (1,0)
    expect(path![1]!.isRamp).toBe(true);
  });
});

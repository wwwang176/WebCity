import { describe, it, expect } from 'vitest';
import {
  getElevatedPath,
  type ElevatedPosition,
} from '../ElevatedPath';

describe('getElevatedPath', () => {
  // --- Basic ramp generation ---

  it('returns flat level-1 path with auto ramps when startLevel=0, targetLevel=1', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 5, y: 0 },
      0, 1,
    );
    expect(path).toHaveLength(6); // cells 0..5
    // First cell: ramp 0→1
    expect(path[0]).toEqual({ x: 0, y: 0, level: 0, targetLevel: 1, isRamp: true, rampDirection: 'up' });
    // Remaining cells: level 1, not ramp
    for (let i = 1; i < 6; i++) {
      expect(path[i]!.level).toBe(1);
      expect(path[i]!.isRamp).toBe(false);
    }
  });

  it('generates 2 ramp cells for startLevel=0, targetLevel=2', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 6, y: 0 },
      0, 2,
    );
    // Ramp cells: [0] 0→1, [1] 1→2
    expect(path[0]!.isRamp).toBe(true);
    expect(path[0]!.level).toBe(0);
    expect(path[0]!.targetLevel).toBe(1);
    expect(path[1]!.isRamp).toBe(true);
    expect(path[1]!.level).toBe(1);
    expect(path[1]!.targetLevel).toBe(2);
    // Rest at level 2
    expect(path[2]!.level).toBe(2);
    expect(path[2]!.isRamp).toBe(false);
  });

  it('generates 3 ramp cells for startLevel=0, targetLevel=3', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 8, y: 0 },
      0, 3,
    );
    expect(path[0]!.isRamp).toBe(true);
    expect(path[0]!.level).toBe(0);
    expect(path[1]!.isRamp).toBe(true);
    expect(path[1]!.level).toBe(1);
    expect(path[2]!.isRamp).toBe(true);
    expect(path[2]!.level).toBe(2);
    expect(path[3]!.level).toBe(3);
    expect(path[3]!.isRamp).toBe(false);
  });

  // --- Descending ramps ---

  it('generates descending ramps when startLevel > targetLevel', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 4, y: 0 },
      2, 0,
    );
    // Ramp cells: [0] 2→1, [1] 1→0
    expect(path[0]!.isRamp).toBe(true);
    expect(path[0]!.rampDirection).toBe('down');
    expect(path[0]!.level).toBe(2);
    expect(path[0]!.targetLevel).toBe(1);
    expect(path[1]!.isRamp).toBe(true);
    expect(path[1]!.level).toBe(1);
    expect(path[1]!.targetLevel).toBe(0);
    // Rest at level 0
    expect(path[2]!.level).toBe(0);
    expect(path[2]!.isRamp).toBe(false);
  });

  // --- Same level (no ramps) ---

  it('produces no ramps when startLevel equals targetLevel', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 3, y: 0 },
      1, 1,
    );
    expect(path.every(p => !p.isRamp)).toBe(true);
    expect(path.every(p => p.level === 1)).toBe(true);
  });

  // --- Auto end ramp ---

  describe('auto end ramp', () => {
    it('adds descending ramps at end when endLevel is provided and < targetLevel', () => {
      // Start level 0, target 1, end level 0 → ramp up at start, ramp down at end
      const path = getElevatedPath(
        { x: 0, y: 0 }, { x: 5, y: 0 },
        0, 1, 0,
      );
      // [0]: ramp up 0→1
      expect(path[0]!.isRamp).toBe(true);
      expect(path[0]!.rampDirection).toBe('up');
      // [1..3]: level 1
      expect(path[1]!.level).toBe(1);
      expect(path[1]!.isRamp).toBe(false);
      // [4]: ramp down 1→0
      expect(path[4]!.isRamp).toBe(true);
      expect(path[4]!.rampDirection).toBe('down');
      expect(path[4]!.level).toBe(1);
      expect(path[4]!.targetLevel).toBe(0);
      // [5]: level 0
      expect(path[5]!.level).toBe(0);
      expect(path[5]!.isRamp).toBe(false);
    });
  });

  // --- Path too short ---

  it('returns null when path is too short for ramps', () => {
    // Need 2 ramp cells but only 1 cell in path
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 0, y: 0 },
      0, 2,
    );
    expect(path).toBeNull();
  });

  it('returns null when path too short for start + end ramps', () => {
    // start ramp 1 + end ramp 1 = need at least 2 cells, but path has 2 cells → no room for bridge
    // Actually need at least startRamps + endRamps + 1 body cell
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 1, y: 0 },
      0, 1, 0,
    );
    // 2 cells total, need 1 up ramp + 1 down ramp + at least 1 body = 3 minimum
    expect(path).toBeNull();
  });

  // --- L-shaped path ---

  it('works with L-shaped paths (horizontal then vertical)', () => {
    const path = getElevatedPath(
      { x: 0, y: 0 }, { x: 3, y: 3 },
      0, 1,
    );
    expect(path).not.toBeNull();
    // Total cells: 3 horizontal + 3 vertical + 1 = 7
    expect(path!).toHaveLength(7);
    // First cell ramp
    expect(path![0]!.isRamp).toBe(true);
    // L-shape: horizontal first
    expect(path![1]!.x).toBe(1);
    expect(path![1]!.y).toBe(0);
    // Then vertical
    expect(path![4]!.x).toBe(3);
    expect(path![4]!.y).toBe(1);
  });
});

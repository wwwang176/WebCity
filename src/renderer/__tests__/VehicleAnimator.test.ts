import { describe, it, expect } from 'vitest';
import type { VehicleAnimator } from '../VehicleAnimator';
import { FerryAnimator } from '../FerryAnimator';

// ---------------------------------------------------------------------------
// Task 3: VehicleAnimator 介面 — 確認所有 animator 遵循統一介面
// ---------------------------------------------------------------------------

describe('VehicleAnimator interface', () => {
  it('VehicleAnimator 介面應定義 update 和 dispose 方法', () => {
    // 建立一個 minimal mock 來驗證介面形狀
    const mock: VehicleAnimator = {
      update: () => {},
      dispose: () => {},
    };
    expect(typeof mock.update).toBe('function');
    expect(typeof mock.dispose).toBe('function');
  });

  it('FerryAnimator 應滿足 VehicleAnimator 介面', () => {
    const animator: VehicleAnimator = new FerryAnimator();
    expect(typeof animator.update).toBe('function');
    expect(typeof animator.dispose).toBe('function');
  });
});

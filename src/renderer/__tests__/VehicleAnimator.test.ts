import { describe, it, expect } from 'vitest';
import type { VehicleAnimator } from '../VehicleAnimator';
import { FerryAnimator } from '../FerryAnimator';

// ---------------------------------------------------------------------------
// The VehicleAnimator interface — every animator conforms to one shape.
// ---------------------------------------------------------------------------

describe('VehicleAnimator interface', () => {
  it('VehicleAnimator 介面應定義 update 和 dispose 方法', () => {
    // A minimal mock verifying the interface's shape.
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

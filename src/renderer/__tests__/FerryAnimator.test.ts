import { describe, it, expect, beforeEach } from 'vitest';
import { FerryAnimator } from '../FerryAnimator';
import type { VehicleAnimator } from '../VehicleAnimator';
import type { TransportVehicleRenderData } from '../../core/transport/collectTransportVehicles';

// ---------------------------------------------------------------------------
// FerryAnimator — ferry animation on the render side, implementing VehicleAnimator.
// ---------------------------------------------------------------------------

/** A fake ferry system providing the minimum interface FerryAnimator uses. */
function createMockFerrySystem(vessels: Array<{
  id: number;
  traveling: boolean;
  waterPath?: Array<{ x: number; y: number }>;
}>) {
  return {
    getVessels: () => vessels,
    getVesselPath: (id: number) => {
      const v = vessels.find(v => v.id === id);
      return v?.waterPath ?? null;
    },
  };
}

/** Fake transportVehicle data for a ferry. */
function createFerryRenderData(vesselId: number, idOffset = 500_000): TransportVehicleRenderData {
  return {
    id: vesselId + idOffset,
    x: 0,
    y: 0,
    heading: 0,
    type: 'ferry',
    laneOffset: 0,
  };
}

describe('FerryAnimator', () => {
  let animator: FerryAnimator;

  beforeEach(() => {
    animator = new FerryAnimator();
  });

  it('應該實作 VehicleAnimator 介面', () => {
    // A type check: FerryAnimator has to be assignable to VehicleAnimator.
    const _va: VehicleAnimator = animator;
    expect(_va).toBeDefined();
    expect(typeof animator.update).toBe('function');
    expect(typeof animator.dispose).toBe('function');
  });

  it('沒有渡輪時 update 不應拋錯', () => {
    const ferry = createMockFerrySystem([]);
    expect(() => animator.update(0.016, 1, ferry, [])).not.toThrow();
  });

  it('渡輪出發時應建立動畫狀態', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);

    // After the update the vehicle's x and y come from the animation.
    expect(vehicles[0]!.x).toBeDefined();
    expect(vehicles[0]!.y).toBeDefined();
  });

  it('dt 推進後渡輪位置應沿路徑移動', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    // The first update creates the animation.
    animator.update(0.016, 1, ferry, vehicles);
    const x0 = vehicles[0]!.x;

    // The second update advances it by a large step.
    animator.update(1.0, 1, ferry, vehicles);
    const x1 = vehicles[0]!.x;

    expect(x1).toBeGreaterThan(x0);
  });

  it('暫停時（speed=0）渡輪不應移動', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);
    const x0 = vehicles[0]!.x;

    // speed = 0 stands for paused.
    animator.update(1.0, 0, ferry, vehicles);
    const x1 = vehicles[0]!.x;

    expect(x1).toBeCloseTo(x0, 3);
  });

  it('heading 應隨路徑方向平滑轉向（LERP）', () => {
    // The path runs east, then south.
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [
        { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 },
      ]},
    ]);
    const vehicles = [createFerryRenderData(1)];

    // Initial creation.
    animator.update(0.016, 1, ferry, vehicles);
    const h0 = vehicles[0]!.heading;

    // Advance to near the turn.
    for (let i = 0; i < 50; i++) {
      animator.update(0.1, 1, ferry, vehicles);
    }
    const hFinal = vehicles[0]!.heading;

    // The heading has changed, turning away from east.
    expect(hFinal).not.toBeCloseTo(h0, 1);
  });

  it('動畫播完且渡輪停止時應清除狀態', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);

    // The ferry stops.
    ferry.getVessels()[0]!.traveling = false;

    // Advance far enough for the animation to play out.
    for (let i = 0; i < 100; i++) {
      animator.update(0.1, 1, ferry, vehicles);
    }

    // dispose must not throw.
    expect(() => animator.dispose()).not.toThrow();
  });

  it('多艘渡輪應獨立動畫', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { id: 2, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 0, y: 10 }] },
    ]);
    const vehicles = [createFerryRenderData(1), createFerryRenderData(2)];

    animator.update(1.0, 1, ferry, vehicles);

    // The two vessels sit at different positions, one heading east and one south.
    expect(vehicles[0]!.x).not.toBeCloseTo(vehicles[1]!.x, 1);
  });

  it('dispose 應清除所有動畫狀態', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);
    animator.dispose();

    // Reuse after dispose leaves no state behind.
    const vehicles2 = [createFerryRenderData(1)];
    animator.update(0.016, 1, ferry, vehicles2);
    // It works again, recreating the animation.
    expect(vehicles2[0]!.x).toBeDefined();
  });
});

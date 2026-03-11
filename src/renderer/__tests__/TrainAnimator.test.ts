import { describe, it, expect } from 'vitest';
import { TrainAnimator, type RailSystemLike } from '../TrainAnimator';
import type { TransportVehicleRenderData } from '../../core/transport/collectTransportVehicles';

function makeFakeRailSystem(trains: Array<{ id: number; traveling: boolean }>, paths: Map<number, Array<{ x: number; y: number }>>): RailSystemLike {
  return {
    getTrains: () => trains,
    getTrainTravelPath: (id: number) => paths.get(id) ?? null,
  };
}

function makeRenderData(id: number, x: number, y: number): TransportVehicleRenderData {
  return { id: id + 400_000, x, y, heading: 0, type: 'rail_train', laneOffset: 0 };
}

describe('TrainAnimator', () => {
  it('should not modify position when train is not traveling', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem([{ id: 1, traveling: false }], new Map());
    const vehicles = [makeRenderData(1, 5, 5)];

    animator.update(0.016, 1, rail, vehicles);

    expect(vehicles[0]!.x).toBe(5);
    expect(vehicles[0]!.y).toBe(5);
  });

  it('should start animation when train begins traveling', () => {
    const animator = new TrainAnimator();
    const path = [{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 5 }];
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true }],
      new Map([[1, path]]),
    );
    const vehicles = [makeRenderData(1, 0, 5)];

    // First frame — should set up animation and start moving
    animator.update(0.5, 1, rail, vehicles);

    // Position should have advanced from origin
    expect(vehicles[0]!.x).toBeGreaterThan(0);
    expect(vehicles[0]!.y).toBe(5);
  });

  it('should smoothly advance position each frame', () => {
    const animator = new TrainAnimator();
    const path = [{ x: 0, y: 5 }, { x: 10, y: 5 }];
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true }],
      new Map([[1, path]]),
    );

    const positions: number[] = [];
    for (let i = 0; i < 5; i++) {
      const vehicles = [makeRenderData(1, 0, 5)];
      animator.update(0.1, 1, rail, vehicles);
      positions.push(vehicles[0]!.x);
    }

    // Each frame should advance further
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('should calculate heading from path direction', () => {
    const animator = new TrainAnimator();
    // Eastward path
    const path = [{ x: 0, y: 5 }, { x: 10, y: 5 }];
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true }],
      new Map([[1, path]]),
    );
    const vehicles = [makeRenderData(1, 0, 5)];

    animator.update(0.1, 1, rail, vehicles);

    // Heading should be ~0 (east)
    expect(Math.abs(vehicles[0]!.heading)).toBeLessThan(0.1);
  });

  it('should handle L-shaped path with heading change', () => {
    const animator = new TrainAnimator();
    // East then South
    const path = [
      { x: 0, y: 0 }, { x: 3, y: 0 },
      { x: 3, y: 1 }, { x: 3, y: 5 },
    ];
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true }],
      new Map([[1, path]]),
    );

    // Advance enough to reach the turn
    for (let i = 0; i < 20; i++) {
      const vehicles = [makeRenderData(1, 0, 0)];
      animator.update(0.2, 1, rail, vehicles);
    }

    // After many frames, heading should have changed from east
    const vehicles = [makeRenderData(1, 0, 0)];
    animator.update(0.2, 1, rail, vehicles);
    // Should be somewhere along the path, not at origin
    expect(vehicles[0]!.x + vehicles[0]!.y).toBeGreaterThan(0);
  });

  it('should clean up animation when train stops traveling', () => {
    const animator = new TrainAnimator();
    const path = [{ x: 0, y: 5 }, { x: 5, y: 5 }];

    // Start traveling
    const railTraveling = makeFakeRailSystem(
      [{ id: 1, traveling: true }],
      new Map([[1, path]]),
    );
    const v1 = [makeRenderData(1, 0, 5)];
    animator.update(0.1, 1, railTraveling, v1);
    expect(v1[0]!.x).toBeGreaterThan(0);

    // Stop traveling (arrived)
    const railStopped = makeFakeRailSystem(
      [{ id: 1, traveling: false }],
      new Map(),
    );
    const v2 = [makeRenderData(1, 5, 5)];
    animator.update(0.1, 1, railStopped, v2);

    // Should use the tick position (5,5), not animated
    expect(v2[0]!.x).toBe(5);
  });

  it('should respect game speed multiplier', () => {
    const path = [{ x: 0, y: 5 }, { x: 20, y: 5 }];

    const anim1 = new TrainAnimator();
    const anim2 = new TrainAnimator();

    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true }],
      new Map([[1, path]]),
    );

    const v1 = [makeRenderData(1, 0, 5)];
    anim1.update(0.5, 1, rail, v1); // speed = 1

    const v2 = [makeRenderData(1, 0, 5)];
    anim2.update(0.5, 3, rail, v2); // speed = 3

    expect(v2[0]!.x).toBeGreaterThan(v1[0]!.x);
  });

  it('should not move when paused (speed=0)', () => {
    const animator = new TrainAnimator();
    const path = [{ x: 0, y: 5 }, { x: 10, y: 5 }];
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true }],
      new Map([[1, path]]),
    );

    // First frame at normal speed to init
    const v1 = [makeRenderData(1, 0, 5)];
    animator.update(0.1, 1, rail, v1);
    const x1 = v1[0]!.x;

    // Paused frame
    const v2 = [makeRenderData(1, 0, 5)];
    animator.update(0.1, 0, rail, v2);
    const x2 = v2[0]!.x;

    expect(x2).toBe(x1); // no movement
  });
});

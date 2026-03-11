import { describe, it, expect } from 'vitest';
import { TrainAnimator, type RailSystemLike } from '../TrainAnimator';
import type { TransportVehicleRenderData } from '../../core/transport/collectTransportVehicles';

/**
 * Helper: build a fake RailSystemLike.
 * routeSegments: routeId → array of path segments (each segment = array of {x,y}).
 */
function makeFakeRailSystem(
  trains: Array<{ id: number; traveling: boolean; routeId: number }>,
  routeSegments: Map<number, Array<Array<{ x: number; y: number }>>>,
): RailSystemLike {
  return {
    getTrains: () => trains,
    getRoutePathPoints: (routeId: number) => routeSegments.get(routeId) ?? null,
  };
}

function makeRenderData(id: number, x: number, y: number): TransportVehicleRenderData {
  return { id: id + 400_000, x, y, heading: 0, type: 'rail_train', laneOffset: 0 };
}

/** 2-station route: A(0,5)→B(10,5) round trip → segments [A→B, B→A] */
function twoStationRoute(): Map<number, Array<Array<{ x: number; y: number }>>> {
  return new Map([[1, [
    [{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 5 }],  // A→B
    [{ x: 10, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 5 }],   // B→A
  ]]]);
}

describe('TrainAnimator', () => {
  it('should create animation on first update and start at station', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: false, routeId: 1 }],
      twoStationRoute(),
    );
    const vehicles = [makeRenderData(1, 0, 5)];

    // First frame — animation created but at station (waiting)
    animator.update(0.016, 1, rail, vehicles);

    // Should override position to station A (start of path)
    expect(vehicles[0]!.x).toBeCloseTo(0, 1);
    expect(vehicles[0]!.y).toBeCloseTo(5, 1);
  });

  it('should start moving after station dwell expires', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    // Exhaust the initial station wait (1.2s at speed=1)
    for (let i = 0; i < 80; i++) {
      const v = [makeRenderData(1, 0, 5)];
      animator.update(0.016, 1, rail, v);
    }

    // Now the train should have started moving
    const v = [makeRenderData(1, 0, 5)];
    animator.update(0.5, 1, rail, v);
    expect(v[0]!.x).toBeGreaterThan(0);
  });

  it('should advance position each frame while moving', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    // Skip initial station wait
    animator.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);

    const positions: number[] = [];
    for (let i = 0; i < 5; i++) {
      const v = [makeRenderData(1, 0, 5)];
      animator.update(0.05, 1, rail, v);
      positions.push(v[0]!.x);
    }

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('should snap heading to path direction (no LERP)', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    // Skip wait then advance
    animator.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);
    const v = [makeRenderData(1, 0, 5)];
    animator.update(0.1, 1, rail, v);

    // East heading = 0
    expect(v[0]!.heading).toBeCloseTo(0, 10);
  });

  it('should pause at station B then return to A (round trip)', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    // Skip initial wait (1.2s)
    animator.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);

    // Travel A→B: 10 cells / 9.0 speed ≈ 1.11s
    animator.update(1.2, 1, rail, [makeRenderData(1, 0, 5)]);

    // Should be at station B now (dwell)
    const vAtB = [makeRenderData(1, 0, 5)];
    animator.update(0.016, 1, rail, vAtB);
    expect(vAtB[0]!.x).toBeCloseTo(10, 0);

    // Wait for dwell at B (1.2s)
    animator.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);

    // Should now be heading back toward A (x decreasing from 10)
    const vReturn = [makeRenderData(1, 0, 5)];
    animator.update(0.3, 1, rail, vReturn);
    expect(vReturn[0]!.x).toBeLessThan(10);
    expect(vReturn[0]!.x).toBeGreaterThan(0);
  });

  it('should respect game speed multiplier', () => {
    const anim1 = new TrainAnimator();
    const anim2 = new TrainAnimator();

    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    // Skip wait for both
    anim1.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);
    anim2.update(1.3, 3, rail, [makeRenderData(1, 0, 5)]);

    // One frame after wait
    const v1 = [makeRenderData(1, 0, 5)];
    anim1.update(0.5, 1, rail, v1);

    const v2 = [makeRenderData(1, 0, 5)];
    anim2.update(0.5, 3, rail, v2);

    // speed=3 should advance further
    expect(v2[0]!.x).toBeGreaterThan(v1[0]!.x);
  });

  it('should not move when paused (speed=0)', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    // Skip wait
    animator.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);

    const v1 = [makeRenderData(1, 0, 5)];
    animator.update(0.1, 1, rail, v1);
    const x1 = v1[0]!.x;

    // Paused
    const v2 = [makeRenderData(1, 0, 5)];
    animator.update(0.1, 0, rail, v2);
    expect(v2[0]!.x).toBe(x1);
  });

  it('should remove animation when train is deleted', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    animator.update(0.1, 1, rail, [makeRenderData(1, 0, 5)]);

    // Train removed
    const railEmpty = makeFakeRailSystem([], new Map());
    const v = [makeRenderData(1, 0, 5)];
    animator.update(0.1, 1, railEmpty, v);

    // No override — tick position used
    expect(v[0]!.x).toBe(0);
  });

  // ── 車廂測試 ──────────────────────────────────────────

  it('should add trailing carriages (3 total)', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );
    const vehicles: TransportVehicleRenderData[] = [makeRenderData(1, 0, 5)];

    // Skip wait + advance
    animator.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);
    animator.update(0.5, 1, rail, vehicles);

    expect(vehicles).toHaveLength(3);
    expect(vehicles[0]!.type).toBe('rail_train');
    expect(vehicles[1]!.type).toBe('rail_carriage');
    expect(vehicles[2]!.type).toBe('rail_carriage');
  });

  it('should position trailing carriages behind locomotive', () => {
    const animator = new TrainAnimator();
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationRoute(),
    );

    // Skip wait + advance
    animator.update(1.3, 1, rail, [makeRenderData(1, 0, 5)]);
    const vehicles: TransportVehicleRenderData[] = [makeRenderData(1, 0, 5)];
    animator.update(0.5, 1, rail, vehicles);

    const loco = vehicles[0]!;
    const car1 = vehicles[1]!;
    const car2 = vehicles[2]!;

    expect(car1.y).toBe(5);
    expect(car2.y).toBe(5);
    expect(car1.x).toBeLessThan(loco.x);
    expect(car2.x).toBeLessThan(car1.x);
  });

  it('should add trailing carriages for stopped train (no animation)', () => {
    const animator = new TrainAnimator();
    // No route segments → no animation created
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: false, routeId: 99 }],
      new Map(),
    );
    const vehicles: TransportVehicleRenderData[] = [makeRenderData(1, 5, 5)];
    vehicles[0]!.heading = 0;

    animator.update(0.016, 1, rail, vehicles);

    expect(vehicles).toHaveLength(3);
    expect(vehicles[1]!.type).toBe('rail_carriage');
    expect(vehicles[1]!.x).toBeLessThan(vehicles[0]!.x);
    expect(vehicles[2]!.x).toBeLessThan(vehicles[1]!.x);
  });
});

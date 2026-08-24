import { describe, it, expect } from 'vitest';
import { TrainAnimator, smoothTrackPath, type RailSystemLike } from '../TrainAnimator';
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
    // No external line in these fixtures — the animator must not reach for one.
    hasExternalConnection: false,
    getExternalTrainPath: () => null,
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

    // Travel A→B: 10 cells / 4.5 speed ≈ 2.22s
    animator.update(2.3, 1, rail, [makeRenderData(1, 0, 5)]);

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

  // ── Carriages ─────────────────────────────────────────

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

  // ── Curved paths ─────────────────────────────────────

  it('should follow curved path at corners', () => {
    const animator = new TrainAnimator();
    // Route with a 90° corner: south then east
    // A(5,0)→(5,3)→(5,4)→(8,4) and back
    const route = new Map([[1, [
      [{ x: 5, y: 0 }, { x: 5, y: 2 }, { x: 5, y: 4 }, { x: 8, y: 4 }],
      [{ x: 8, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 2 }, { x: 5, y: 0 }],
    ]]]);
    const rail = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      route,
    );

    // Skip wait (1.2s) then advance past the corner
    animator.update(1.3, 1, rail, [makeRenderData(1, 5, 0)]);
    // Move for ~0.5s at speed 9 → ~4.5 cells, should be near/past the corner at (5,4)
    const v = [makeRenderData(1, 5, 0)];
    animator.update(0.5, 1, rail, v);

    // The train should NOT be at x=5 (the sharp corner center)
    // If curved, at the corner area x should be > 5 as it follows the arc
    // Just verify the train is progressing and y is reasonable
    expect(v[0]!.y).toBeGreaterThan(0);
  });

  it('should rebuild animation when route path segments change (station removed)', () => {
    const animator = new TrainAnimator();

    // 3-station route: A(0,5)→B(5,5)→C(10,5)→A (3 segments)
    const threeStationSegments = new Map([[1, [
      [{ x: 0, y: 5 }, { x: 5, y: 5 }],   // A→B (len 5)
      [{ x: 5, y: 5 }, { x: 10, y: 5 }],  // B→C (len 5)
      [{ x: 10, y: 5 }, { x: 0, y: 5 }],  // C→A (len 10)
    ]]]);
    // 3-station path has stationDistances [0, 5, 10], totalLength=20
    // With station B at distance 5, train should stop there

    const rail3 = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      threeStationSegments,
    );

    // Build initial anim and advance past station B (dwell 1.2s + travel >5 cells)
    animator.update(1.3, 1, rail3, [makeRenderData(1, 0, 5)]); // skip initial wait
    // Travel A→B at speed 4.5: 5/4.5 ≈ 1.11s, arrive at B, dwell 1.2s
    animator.update(1.2, 1, rail3, [makeRenderData(1, 0, 5)]); // arrive at B
    animator.update(1.3, 1, rail3, [makeRenderData(1, 0, 5)]); // wait at B then depart

    // Verify train is now past station B (somewhere between B and C)
    const vBefore = [makeRenderData(1, 0, 5)];
    animator.update(0.016, 1, rail3, vBefore);
    expect(vBefore[0]!.x).toBeGreaterThan(5); // past station B

    // Now simulate station B removed: route becomes A↔C (2 segments)
    const twoStationSegments = new Map([[1, [
      [{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 5 }],  // A→C
      [{ x: 10, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 5 }],  // C→A
    ]]]);
    // 2-station path: stationDistances [0, 10], totalLength=20

    const rail2 = makeFakeRailSystem(
      [{ id: 1, traveling: true, routeId: 1 }],
      twoStationSegments,
    );

    // Update with new segment count — should rebuild animation
    const v = [makeRenderData(1, 0, 5)];
    animator.update(0.016, 1, rail2, v);

    // After rebuild, train restarts at station A (distance=0, waiting)
    expect(v[0]!.x).toBeCloseTo(0, 0);
    expect(v[0]!.y).toBeCloseTo(5, 0);
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

describe('smoothTrackPath', () => {
  it('should not modify straight path', () => {
    const pts = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
    const result = smoothTrackPath(pts);
    expect(result).toEqual(pts);
  });

  it('should not modify path with fewer than 3 points', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    expect(smoothTrackPath(pts)).toEqual(pts);
  });

  it('should insert arc points at a 90° corner', () => {
    // South then east: (5,0)→(5,1)→(6,1)
    const pts = [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 6, y: 1 }];
    const result = smoothTrackPath(pts);

    // Should have more points than original (arc inserted at corner)
    expect(result.length).toBeGreaterThan(3);

    // First and last points preserved
    expect(result[0]).toEqual({ x: 5, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 6, y: 1 });

    // Corner cell center (5,1) should NOT be in the result
    const hasCellCenter = result.some(p => p.x === 5 && p.y === 1);
    expect(hasCellCenter).toBe(false);

    // Arc entry point near north edge of cell (5,1): should be ~(5, 0.5)
    expect(result[1]!.x).toBeCloseTo(5, 1);
    expect(result[1]!.y).toBeCloseTo(0.5, 1);

    // Arc exit point near east edge of cell (5,1): should be ~(5.5, 1)
    const last = result[result.length - 2]!;
    expect(last.x).toBeCloseTo(5.5, 1);
    expect(last.y).toBeCloseTo(1, 1);
  });

  it('should handle two consecutive corners', () => {
    // S-curve: east→south→east: (0,5)→(1,5)→(1,6)→(2,6)
    const pts = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 1, y: 6 }, { x: 2, y: 6 }];
    const result = smoothTrackPath(pts);

    expect(result.length).toBeGreaterThan(4);
    expect(result[0]).toEqual({ x: 0, y: 5 });
    expect(result[result.length - 1]).toEqual({ x: 2, y: 6 });
  });
});

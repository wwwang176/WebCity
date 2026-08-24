import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { TRANSPORT_SPEED } from '../BaseTransportSystem';
import type { LaneEdge } from '../../traffic/LaneGraph';

/**
 * Bus congestion is computed **per route**, not from the city average.
 *
 * Buses follow arterials, and arterials are more congested than average. Measured on a
 * 12,600-citizen save: city average 0.211 against **0.380** along one bus route (1.8x),
 * with the worst cell on the line at 1.0 (gridlocked). The city average tells the player
 * their bus is not stuck in traffic while it visibly is.
 *
 * `congestionLevel` is a single system-wide number that per-route values sit on top of.
 * A route with no value falls back to it, which means "not computed yet", not "clear".
 */

const IMPACT = TRANSPORT_SPEED.CONGESTION_SPEED_IMPACT;

type Internals = { getSpeedMultiplier(routeId?: number): number };

describe('逐路線的壅塞', () => {
  it('should slow a route by its own congestion, not the city average', () => {
    const bus = new BusSystem();
    bus.congestionLevel = 0.2;
    bus.setRouteCongestion(7, 0.8);

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(7), '這條路線沒有用自己的壅塞值')
      .toBeCloseTo(1 - 0.8 * IMPACT, 6);
  });

  it('should fall back to the system-wide level for a route it has no number for', () => {
    // Falls back to the city average rather than 0: no value means "not computed yet".
    const bus = new BusSystem();
    bus.congestionLevel = 0.2;

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(99), '沒有逐路線的值時沒有退回全城平均')
      .toBeCloseTo(1 - 0.2 * IMPACT, 6);
    expect(inner.getSpeedMultiplier(), '完全沒給路線時也該退回全城平均')
      .toBeCloseTo(1 - 0.2 * IMPACT, 6);
  });

  it('should keep routes apart', () => {
    const bus = new BusSystem();
    bus.setRouteCongestion(1, 0.1);
    bus.setRouteCongestion(2, 0.9);

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(1)).toBeCloseTo(1 - 0.1 * IMPACT, 6);
    expect(inner.getSpeedMultiplier(2), '兩條路線拿到同一個值').toBeCloseTo(1 - 0.9 * IMPACT, 6);
  });

  it('should not touch systems that do not share the road', () => {
    // Metro runs on its own track and is unaffected by surface congestion, which is what
    // the player builds it for.
    const metro = new MetroSystem();
    metro.congestionLevel = 0.9;
    metro.setRouteCongestion(1, 0.9);

    expect((metro as unknown as Internals).getSpeedMultiplier(1), '捷運被地面壅塞拖慢了')
      .toBe(1);
  });

  it('should still crawl at full gridlock', () => {
    // Vehicles must still crawl when fully congested: speed 0 never reaches the next stop
    // and makes the headway infinite.
    //
    // This does **not** pin `MIN_CONGESTION_SPEED`: congestion is capped at 1, so
    // `1 - congestion * 0.5` bottoms out at 0.5 and that floor is currently unreachable
    // (see the constant). What is pinned is that the multiplier stays positive at gridlock.
    const bus = new BusSystem();
    bus.setRouteCongestion(1, 1);

    expect((bus as unknown as Internals).getSpeedMultiplier(1))
      .toBeCloseTo(1 - IMPACT, 6);
    expect((bus as unknown as Internals).getSpeedMultiplier(1)).toBeGreaterThan(0);
  });

  it('should forget a route once it is gone', () => {
    // Route ids are never reused after deletion, so an uncleared map grows forever.
    const bus = new BusSystem();
    bus.setRouteCongestion(1, 0.9);
    bus.clearRouteCongestion(1);

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(1), '刪掉的路線還記著舊的壅塞值').toBe(1);
  });
});

describe('路線蓋到哪些格', () => {
  /**
   * Expected values are **written out by hand** rather than derived from `getRouteCells`.
   * Computing the expectation with the function under test makes both sides move together
   * and always agree.
   */
  function edge(from: string, to: string): LaneEdge {
    const [fx, fy] = from.split(',').map(Number);
    const [tx, ty] = to.split(',').map(Number);
    return {
      id: `${from}>${to}`,
      from: { id: 'f', cellKey: from, position: { x: fx!, y: fy! }, lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 } },
      to: { id: 't', cellKey: to, position: { x: tx!, y: ty! }, lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 } },
      length: 1, type: 'straight',
    } as LaneEdge;
  }

  it('should cover both ends of every edge', () => {
    // Collecting only the `from` end drops each leg's **destination**, so the last cell of
    // a route never counts towards its congestion.
    const bus = new BusSystem();
    const a = bus.addStop(0, 0);
    const b = bus.addStop(3, 0);
    const route = bus.createRoute([a, b]);
    let call = 0;
    bus.computeRouteSegments(route, () => {
      call++;
      return call === 1 ? [edge('0,0', '1,0'), edge('1,0', '2,0')] : [edge('2,0', '3,0')];
    });

    expect([...bus.getRouteCells(route.id)!].sort())
      .toEqual(['0,0', '1,0', '2,0', '3,0']);
  });

  it('should return null for a route with no segments', () => {
    expect(new BusSystem().getRouteCells(42)).toBeNull();
  });

  it('should hand back the very same set on a second ask', () => {
    const bus = new BusSystem();
    const route = bus.createRoute([bus.addStop(0, 0), bus.addStop(1, 0)]);
    bus.computeRouteSegments(route, () => [edge('0,0', '1,0')]);

    expect(bus.getRouteCells(route.id), '每次都重建一次集合')
      .toBe(bus.getRouteCells(route.id));
  });
});

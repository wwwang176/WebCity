import { describe, it, expect } from 'vitest';
import { formatRouteUsage, routeLoadStatus, CROWDING } from '../RouteLoad';

/**
 * The panel's usage column is the player's only basis for deciding how many vehicles to add.
 *
 * Clamping at 100% would make a 105% route look identical to a 400% one, when the first
 * needs one extra vehicle and the second needs three times the fleet.
 */

describe('路線載重的顯示', () => {
  it('should show how far past capacity a route is', () => {
    expect(formatRouteUsage(260, 100), '超載被夾在 100%，看不出要加幾台車').toBe('260%');
    expect(formatRouteUsage(45, 100), '一般情況的百分比不對').toBe('45%');
  });

  it('should say nothing for a route with no capacity at all', () => {
    // A route with no vehicles has no load to compute, and 0% would read as empty.
    expect(formatRouteUsage(30, 0), '沒有運能的路線印出了百分比').toBe('—');
  });

  it('should round to whole percent', () => {
    expect(formatRouteUsage(1, 3), '沒有四捨五入').toBe('33%');
  });
});

describe('載重的四個階段', () => {
  // The boundaries sit where something actually changes in the model, not on round numbers.
  it('should stay green while everyone gets on the next vehicle', () => {
    expect(routeLoadStatus(0.5)).toBe('comfortable');
    expect(routeLoadStatus(0.99), '還沒有人被留下就開始警告').toBe('comfortable');
  });

  it('should turn the moment somebody is left behind', () => {
    // At exactly 1 the seats are exactly enough, so the boundary is "above 1".
    expect(routeLoadStatus(1), '剛好夠卻說擠').toBe('comfortable');
    expect(routeLoadStatus(1.01), '有人上不去了卻還是綠的').toBe('crowded');
    expect(routeLoadStatus(1.4)).toBe('crowded');
  });

  it('should go red once the extra wait beats the basic wait', () => {
    // More than half a headway of extra waiting: waiting for a seat takes longer than waiting
    // for the vehicle.
    expect(routeLoadStatus(CROWDING.OVERLOADED_LOAD)).toBe('overloaded');
    expect(routeLoadStatus(2.9)).toBe('overloaded');
  });

  it('should call it hopeless once two full vehicles go past', () => {
    // **A label, not a cliff**: the simulation does not hide the line, only makes it very slow.
    expect(routeLoadStatus(CROWDING.HOPELESS_LOAD)).toBe('hopeless');
    expect(routeLoadStatus(Infinity)).toBe('hopeless');
  });
});

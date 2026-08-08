import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

/**
 * transferGraphDirty had exactly one setter, inside markLaneGraphDirty — which
 * only fires for road, rail, demolish and rezone edits. Creating, deleting or
 * re-vehicling a transit route, and placing a transit stop, set nothing.
 *
 * So a newly created line did not enter the transfer graph until the player
 * next happened to touch a road (no multi-leg trip would ever route through
 * it), and a deleted line stayed in flatRoutes, where the rider accounting kept
 * crediting dailyRiders to stops of a route that no longer exists (BUG-090).
 *
 * The original fix added markTransitNetworkDirty() and made ten call sites
 * call it — a rule enforced only by a comment. These tests deliberately never
 * call it: BaseTransportSystem bumps its own version counter, so the
 * invalidation has to survive a mutation site that forgets.
 */
describe('transit network edits invalidate the transfer graph', () => {
  it('should pick up a newly created route with no explicit invalidation call', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    loop.tick();
    expect(loop.getTransitRouteCount()).toBe(0);

    const a = state.metro.addStation(2, 2);
    const b = state.metro.addStation(8, 2);
    state.metro.createLine([a, b], 1);

    loop.tick();

    expect(loop.getTransitRouteCount()).toBe(1);
  });

  it('should drop a deleted route from the transfer graph', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    const a = state.metro.addStation(2, 2);
    const b = state.metro.addStation(8, 2);
    const route = state.metro.createLine([a, b], 1);
    loop.tick();
    expect(loop.getTransitRouteCount()).toBe(1);

    state.metro.deleteLine(route.id);
    loop.tick();

    expect(loop.getTransitRouteCount()).toBe(0);
  });

  it('should rebuild even when the city sits permanently at the vehicle cap', () => {
    // The rebuild used to live inside spawnCommuteVehicles, behind three early
    // returns. A city with no citizens (pop === 0) never reached it at all —
    // and neither did a real city holding at the commute-vehicle cap.
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    expect(state.citizens.getPopulation()).toBe(0);

    const a = state.metro.addStation(2, 2);
    const b = state.metro.addStation(8, 2);
    state.metro.createLine([a, b], 1);
    loop.tick();

    expect(loop.getTransitRouteCount()).toBe(1);
  });

  it('should not clear the lane graph when only transit changed', () => {
    // Transit edits must not drag the whole lane graph, commute cache and
    // workplace-distance cache with them — that is a far more expensive
    // invalidation than the transfer graph needs.
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    loop.tick();
    const generationBefore = loop.commuteCache.roadGeneration;

    const a = state.metro.addStation(2, 2);
    const b = state.metro.addStation(8, 2);
    state.metro.createLine([a, b], 1);
    loop.tick();

    expect(loop.commuteCache.roadGeneration).toBe(generationBefore);
  });

  it('should still rebuild for road edits', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    const a = state.metro.addStation(2, 2);
    const b = state.metro.addStation(8, 2);
    state.metro.createLine([a, b], 1);
    loop.tick();
    expect(loop.isTransferGraphDirty()).toBe(false);

    state.grid.setCell(5, 5, { roadType: RoadType.TWO_LANE, zoneType: ZoneType.NONE });
    loop.markLaneGraphDirty();

    expect(loop.isTransferGraphDirty()).toBe(true);
  });

  it('should keep the transfer panel data across a vehicle-count change', () => {
    // A vehicle-count change forces a rebuild (FlatRoute.isFull reads
    // route.vehicles) but must not wipe the tracker's per-building attribution:
    // route labels are unchanged, so blanking the panel on every +/- click was
    // pure loss.
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    const a = state.metro.addStation(2, 2);
    const b = state.metro.addStation(8, 2);
    const route = state.metro.createLine([a, b], 2);
    loop.tick();

    loop.transferTracker.recordBuilding('METRO-1', '3,3', '9,3');
    expect(loop.getTransferBuildings('METRO-1').homes).toContain('3,3');

    state.metro.addVehicleToRoute(route.id);
    loop.tick();

    expect(loop.getTransferBuildings('METRO-1').homes).toContain('3,3');
  });

  it('should wipe the transfer panel data when the topology changes', () => {
    const state = createGameState(20, 20);
    const loop = new SimulationLoop(state);
    const a = state.metro.addStation(2, 2);
    const b = state.metro.addStation(8, 2);
    state.metro.createLine([a, b], 1);
    loop.tick();

    loop.transferTracker.recordBuilding('METRO-1', '3,3', '9,3');
    state.metro.addStation(14, 2);
    loop.tick();

    expect(loop.getTransferBuildings('METRO-1').homes).not.toContain('3,3');
  });
});

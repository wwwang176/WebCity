import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';
import { RailNetwork } from '../../rail/RailNetwork';
import { RoadNetwork } from '../../road/RoadNetwork';
import { ElevationManager } from '../ElevationManager';
import { ElevatedRoadBuilder } from '../ElevatedRoadBuilder';
import { ElevatedRailBuilder, rebuildElevatedRailNetwork } from '../ElevatedRailBuilder';

/**
 * Demolition routes every elevated cell through
 * `elevatedRoadBuilder.removeElevated`, whatever is on it — Game.ts asks
 * `hasElevatedSegment`, which is true for an elevated railway too.
 *
 * That method deletes the segment from the ElevationManager and removes its
 * node from the RoadNetwork. The RailNetwork it knows nothing about, so the
 * node and its edges stayed: trains kept routing over a bridge that was gone
 * from the map, from the renderer and from the save.
 *
 * `ElevatedRailBuilder.removeElevated` does the right thing for rail and has
 * never been called by anything — the dead code was the missing half of this
 * bug, not a separate tidy-up.
 */
function railBridge(): {
  grid: Grid; em: ElevationManager; rail: RailNetwork; nodes: string[];
} {
  const grid = new Grid(24, 24);
  for (let x = 4; x <= 6; x++) grid.setCell(x, 5, { railType: RailType.STANDARD, railFlags: 12 });

  const em = new ElevationManager();
  const nodes: string[] = [];
  for (let x = 7; x <= 10; x++) {
    em.set(x, 5, 1, {
      roadType: RoadType.NONE, roadFlags: 0,
      railType: RailType.STANDARD, railFlags: 12,
      isRamp: false, rampAscendDirection: 0,
    });
    nodes.push(`${x},5,1`);
  }

  const rail = new RailNetwork();
  rebuildElevatedRailNetwork(em, rail);
  return { grid, em, rail, nodes };
}

describe('demolishing an elevated railway takes it out of the rail network', () => {
  it('should have the bridge in the network to begin with', () => {
    // Without this the assertions below could pass on a network that was never
    // populated.
    const { rail, nodes } = railBridge();
    for (const id of nodes) expect(rail.hasNode(id), id).toBe(true);
  });

  it('should remove the node the demolition deleted', () => {
    const { grid, em, rail } = railBridge();
    new ElevatedRoadBuilder(grid, em, null, rail).removeElevated(9, 5);

    expect(em.get(9, 5, 1), 'the segment must be gone from the map').toBeNull();
    expect(rail.hasNode('9,5,1'), 'trains can still route over a bridge that is gone').toBe(false);
  });

  it('should leave the rest of the bridge routable', () => {
    // Removing one span must not take the network with it.
    const { grid, em, rail } = railBridge();
    new ElevatedRoadBuilder(grid, em, null, rail).removeElevated(9, 5);

    expect(rail.hasNode('7,5,1')).toBe(true);
    expect(rail.hasNode('8,5,1')).toBe(true);
    expect(rail.hasNode('10,5,1')).toBe(true);
    // ...and the gap is real: 8 and 10 are no longer joined.
    expect(rail.findPath('8,5,1', '10,5,1')).toBeNull();
  });

  it('should still remove road nodes from the road network', () => {
    // The control: the rail handling must not have displaced the road handling.
    const grid = new Grid(24, 24);
    const em = new ElevationManager();
    for (let x = 7; x <= 9; x++) {
      em.set(x, 5, 1, {
        roadType: RoadType.TWO_LANE, roadFlags: 12,
        railType: RailType.NONE, railFlags: 0, isRamp: false, rampAscendDirection: 0,
      });
    }
    const road = new RoadNetwork();
    for (let x = 7; x <= 9; x++) road.addNode(`${x},5,1`);
    road.addEdge('7,5,1', '8,5,1');
    road.addEdge('8,5,1', '9,5,1');

    new ElevatedRoadBuilder(grid, em, road, new RailNetwork()).removeElevated(8, 5);

    expect(road.hasNode('8,5,1')).toBe(false);
    expect(road.hasNode('7,5,1')).toBe(true);
  });

  it('should not throw when no rail network was supplied', () => {
    // Every existing caller and test constructs the builder with two or three
    // arguments.
    const { grid, em } = railBridge();
    expect(() => new ElevatedRoadBuilder(grid, em).removeElevated(9, 5)).not.toThrow();
    expect(em.get(9, 5, 1)).toBeNull();
  });
});

describe('the rail builder can remove its own track', () => {
  it('should clear the segment and its rail node', () => {
    // ElevatedRailBuilder.removeElevated was never called by anything. It is
    // kept because buildElevatedTrack's counterpart belongs next to it, and
    // because a rail-only demolition tool would use it — so it must work.
    const { grid, em, rail } = railBridge();
    new ElevatedRailBuilder(grid, em, rail).removeElevated(9, 5);

    expect(em.get(9, 5, 1)).toBeNull();
    expect(rail.hasNode('9,5,1')).toBe(false);
  });
});

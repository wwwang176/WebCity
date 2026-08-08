import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { BusSystem } from '../BusSystem';
import { LaneGraph, type LaneEdge } from '../../traffic/LaneGraph';
import { TrafficSimulation } from '../../traffic/TrafficSimulation';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

/**
 * The topology counter exists so the transfer graph is only wiped when the
 * transit network actually changes shape — adding a vehicle to a route used to
 * empty the transfer panel for no reason (BUG-125/127).
 *
 * rebuildAllSegments then started bumping it unconditionally, on the path where
 * nothing changed as well as the one where something did. A route with no
 * segments has no routeSegments entry — onRoadChanged deletes it, and
 * computeRouteSegments returns null before ever setting one — so the
 * `if (this.routeSegments.has(route.id)) continue` guard never skips it. Every
 * lane-graph rebuild reprocesses it, fails to path it again, sets
 * suspended = true on a route that was already suspended, and bumps.
 *
 * rebuildAllSegments runs once per road edit. So a single bus route stranded by
 * a demolished road made every subsequent road edit ANYWHERE in the city wipe
 * the transfer panel's per-building attribution — precisely the regression the
 * counter was introduced to prevent (BUG-158).
 *
 * The pathfinder is stubbed rather than driven: what is under test is when the
 * counter moves, not whether A* can find a way across town. The edges handed
 * back are real ones, so the bus spawning downstream behaves normally.
 */
function realEdges(): LaneEdge[] {
  const grid = new Grid(24, 24);
  for (let x = 1; x <= 10; x++) grid.setCell(x, 3, { roadType: RoadType.TWO_LANE, roadFlags: 12 });

  const keys: string[] = [];
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  grid.forEachCell((cell, x, y) => {
    if (cell.roadType === 0) return;
    keys.push(`${x},${y}`);
    cells.set(`${x},${y}`, { roadType: cell.roadType as RoadType, roadFlags: cell.roadFlags });
  });

  const lanes = new LaneGraph();
  lanes.buildFromGrid(makeGridLookup(cells), keys);
  const edges = lanes.getAllEdges();
  expect(edges.length, 'fixture must produce real lane edges').toBeGreaterThan(0);
  return edges.slice(0, 3);
}

const EDGES = realEdges();

interface Harness {
  /** Rebuild once, as a road edit anywhere in the city would. */
  rebuild(): void;
  /** Flip whether the route's stops can be pathed between. */
  setPathable(v: boolean): void;
  version(): number;
  suspended(): boolean;
}

function harness(pathableAtStart: boolean): Harness {
  const grid = new Grid(24, 24);
  for (let x = 1; x <= 20; x++) grid.setCell(x, 3, { roadType: RoadType.TWO_LANE, roadFlags: 12 });

  const bus = new BusSystem();
  const traffic = new TrafficSimulation();
  const a = bus.addStop(3, 2); a.roadX = 3; a.roadY = 3;
  const b = bus.addStop(17, 2); b.roadX = 17; b.roadY = 3;
  const routeId = bus.createRoute([a, b], 1).id;

  let pathable = pathableAtStart;
  const findEdgePath = () => (pathable ? EDGES : null);

  return {
    rebuild: () => bus.rebuildAllSegments(findEdgePath, traffic, grid),
    setPathable: (v: boolean) => { pathable = v; },
    version: () => bus.getTopologyVersion(),
    suspended: () => bus.getRoutes().find(r => r.id === routeId)!.suspended === true,
  };
}

describe('a route that cannot be pathed stops announcing it every rebuild', () => {
  it('should suspend the route on the first rebuild, and say so once', () => {
    const h = harness(false);
    const before = h.version();
    h.rebuild();

    expect(h.suspended()).toBe(true);
    // Suspension IS a change. Going quiet must not mean going deaf.
    expect(h.version()).toBeGreaterThan(before);
  });

  it('should say nothing on the rebuilds after that', () => {
    // The assertion that stops one stranded route from wiping the transfer
    // panel on every road edit for as long as it stays stranded.
    const h = harness(false);
    h.rebuild();

    const settled = h.version();
    for (let i = 0; i < 5; i++) h.rebuild();
    expect(h.version()).toBe(settled);
    expect(h.suspended()).toBe(true);
  });

  it('should announce it again when the route comes back', () => {
    const h = harness(false);
    h.rebuild();
    const settled = h.version();

    h.setPathable(true);
    h.rebuild();

    expect(h.suspended()).toBe(false);
    expect(h.version()).toBeGreaterThan(settled);
  });

  it('should stay quiet once a working route has settled', () => {
    const h = harness(true);
    h.rebuild();
    expect(h.suspended()).toBe(false);

    const settled = h.version();
    for (let i = 0; i < 5; i++) h.rebuild();
    expect(h.version()).toBe(settled);
  });
});

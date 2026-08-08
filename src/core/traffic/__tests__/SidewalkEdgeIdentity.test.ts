import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { SidewalkGraph } from '../SidewalkGraph';

/**
 * Retirement by edge identity rests on one invariant: same id ⇒ same edge.
 * A rebuild that changes nothing keeps every id, so nobody is retired; an edge
 * that changed is a new id, so anyone standing on the old one goes.
 *
 * LaneGraph honours it — its ids are a pure function of everything that decides
 * an edge's geometry. SidewalkGraph did not, in two separate ways:
 *
 *  BUG-159  Node POSITION comes from ROAD_WIDTHS[cell.roadType]; the node ID
 *           does not mention roadType. Upgrading a two-lane street to six lanes
 *           moves every sidewalk node 0.175 cells outward and leaves every edge
 *           id untouched, so retireAgentsOnDeadEdges retires nobody and every
 *           pedestrian keeps being interpolated from the OLD positions — inside
 *           the widened carriageway — for up to DESPAWN_TIMEOUT. Crosswalk
 *           edges are worse: their length is 2 x halfWidth, so agents on the
 *           stale, shorter edge finish early and pop across the road.
 *
 *  BUG-160  The id encodes neither `type` nor `intersectionCellKey`, so the
 *           same node pair emitted as a crosswalk and as a level crossing
 *           collides, and whichever generator ran first wins — decided by cell
 *           processing order. PedestrianManager gates on
 *           `nextEdge.type === 'crosswalk'`, so pedestrians at such a junction
 *           walk straight through the traffic light.
 */
function roadRow(roadType: RoadType, railAt?: number): SidewalkGraph {
  const grid = new Grid(16, 16);
  for (let x = 1; x <= 9; x++) grid.setCell(x, 5, { roadType, roadFlags: 12 });
  // A north-south stub at x=5 makes (5,5) a real junction.
  grid.setCell(5, 4, { roadType, roadFlags: 3 });
  grid.setCell(5, 6, { roadType, roadFlags: 3 });
  grid.setCell(5, 5, { roadType, roadFlags: 15 });
  if (railAt !== undefined) grid.setCell(railAt, 4, { railType: 1, railFlags: 3 });

  const keys: string[] = [];
  grid.forEachCell((cell, x, y) => { if (cell.roadType !== RoadType.NONE) keys.push(`${x},${y}`); });

  const graph = new SidewalkGraph();
  graph.buildFromGrid(grid, keys, []);
  return graph;
}

const idsOf = (g: SidewalkGraph) => new Set(g.getAllEdges().map(e => e.id));

describe('a sidewalk edge id determines the edge', () => {
  it('should be stable across a rebuild that changes nothing', () => {
    // The other half of the invariant, and the reason the whole scheme works:
    // a no-op rebuild must retire nobody.
    expect(idsOf(roadRow(RoadType.TWO_LANE))).toEqual(idsOf(roadRow(RoadType.TWO_LANE)));
  });

  it('should change when the road widens under it', () => {
    // ROAD_WIDTHS: TWO_LANE 0.6, SIX_LANE 0.95. Every node moves.
    const narrow = roadRow(RoadType.TWO_LANE);
    const wide = roadRow(RoadType.SIX_LANE);

    const shared = [...idsOf(narrow)].filter(id => idsOf(wide).has(id));
    expect(shared, 'a widened road must not reuse its old sidewalk edge ids').toEqual([]);
  });

  it('should never give two edges of different kinds the same id', () => {
    // Whichever generator runs first used to win the dedupe, silently.
    for (const g of [roadRow(RoadType.TWO_LANE), roadRow(RoadType.TWO_LANE, 5)]) {
      const byId = new Map<string, string>();
      for (const e of g.getAllEdges()) {
        const seen = byId.get(e.id);
        if (seen !== undefined) {
          expect(seen, `edge ${e.id} exists as both ${seen} and ${e.type}`).toBe(e.type);
        }
        byId.set(e.id, e.type);
      }
    }
  });

  it('should keep the same id for the same edge in the same geometry', () => {
    // Identity has to be a function of the geometry, not of a counter or of
    // iteration order — otherwise a no-op rebuild deletes all pedestrians.
    const a = roadRow(RoadType.TWO_LANE, 5);
    const b = roadRow(RoadType.TWO_LANE, 5);
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('should give every edge a position its id accounts for', () => {
    // The binding assertion: two graphs whose edges share an id must place
    // that edge in the same place and give it the same length. This is what
    // retirement-by-id actually assumes.
    const wide = roadRow(RoadType.SIX_LANE);
    const narrow = roadRow(RoadType.TWO_LANE);
    const byId = new Map(narrow.getAllEdges().map(e => [e.id, e]));

    for (const e of wide.getAllEdges()) {
      const other = byId.get(e.id);
      if (!other) continue;
      expect(e.length, `edge ${e.id} has two lengths`).toBeCloseTo(other.length, 6);
      expect(e.from.position.x).toBeCloseTo(other.from.position.x, 6);
      expect(e.from.position.y).toBeCloseTo(other.from.position.y, 6);
    }
  });
});

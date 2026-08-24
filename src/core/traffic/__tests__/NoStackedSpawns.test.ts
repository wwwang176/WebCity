import { describe, it, expect } from 'vitest';
import { TrafficSimulation, TRAFFIC, SPAWN_CLEARANCE } from '../TrafficSimulation';
import type { LaneEdge } from '../LaneGraph';

/**
 * Vehicles spawned on the same tick end up stacked.
 *
 * Every new vehicle is placed at `edgePath[0]`'s start with `edgeProgress` 0, and commute
 * routes are shared (`CommuteCache`'s route pool hands the same array to every citizen taking
 * that trip), so everyone setting off on the same route at the same moment lands on the same
 * point and appears as a single clump.
 *
 * Car-following eventually pushes them apart (a follower's gap is negative and it does not
 * move), but only **eventually**: they clip through each other the moment they spawn, and
 * they stay there while a junction is backed up.
 *
 * The check therefore happens at spawn time: an occupied spot means no vehicle this time, and
 * that citizen sets off later.
 */

/** A straight lane path along +x, shiftable in y to simulate a neighbouring lane. */
function path(n: number, offsetY = 0): LaneEdge[] {
  const edges: LaneEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({
      id: `e${i}@${offsetY}`,
      from: {
        id: `e${i}@${offsetY}_f`, cellKey: `${i},0`, position: { x: i, y: offsetY },
        lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 },
      },
      to: {
        id: `e${i}@${offsetY}_t`, cellKey: `${i + 1},0`, position: { x: i + 1, y: offsetY },
        lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 },
      },
      length: 1.0, type: 'straight',
    });
  }
  return edges;
}

/** The longest body (a van, 0.26). Clearance must be sized for the worst case. */
const LONGEST = 0.26;

describe('車位被佔著就不要生車', () => {
  it('should refuse the second car on the same spot', () => {
    const sim = new TrafficSimulation();
    const route = path(20);
    expect(sim.spawnVehicleOnEdges(route), '第一台就生不出來').not.toBeNull();
    expect(sim.spawnVehicleOnEdges(route), '第二台疊在第一台身上').toBeNull();
    expect(sim.getVehicleCount()).toBe(1);
  });

  it('should let the next one out once the first has driven clear', () => {
    // The control for the test above, which "never spawn again after the first" would also
    // satisfy, leaving exactly one vehicle on the road.
    const sim = new TrafficSimulation();
    const route = path(20);
    sim.spawnVehicleOnEdges(route);
    for (let t = 0; t < 2 / 0.02; t++) sim.advanceEdgeVehicles(0.02);
    expect(sim.spawnVehicleOnEdges(route), '前車早就開走了，後面卻還生不出來').not.toBeNull();
    expect(sim.getVehicleCount()).toBe(2);
  });

  it('should not let a car in the next lane block the spot', () => {
    // The check is oriented to the body, not a plain centre-to-centre distance: the tightest
    // lane spacing is 0.1375 cells (a two-lane one-way road) while a body is 0.22 long. A
    // single radius small enough not to catch the neighbouring lane cannot fit a body, and two
    // vehicles in the same lane would stack.
    const sim = new TrafficSimulation();
    expect(sim.spawnVehicleOnEdges(path(20, 0))).not.toBeNull();
    expect(sim.spawnVehicleOnEdges(path(20, 0.18)), '隔壁車道的車擋住了這一格').not.toBeNull();
  });

  it('should keep the across-lane clearance under the tightest lane spacing', () => {
    // The tightest is a two-lane one-way road: 0.55 / 2 / 2 = 0.1375 cells. A lateral
    // clearance above that means the neighbouring lane always blocks and the road carries far
    // fewer vehicles.
    expect(SPAWN_CLEARANCE.ACROSS, '左右餘裕寬過最窄的車道間距').toBeLessThan(0.1375);
  });

  it('should keep the along-lane clearance long enough for a body', () => {
    // A longitudinal clearance below the body length lets two vehicles half a body apart both
    // spawn, and they clip through each other.
    expect(SPAWN_CLEARANCE.ALONG, '前後餘裕短過車身').toBeGreaterThanOrEqual(LONGEST);
  });

  it('should refuse a spot taken by a car bucketed in the neighbouring cell', () => {
    // Nearby vehicles are found through a per-cell index, and a vehicle is recorded in the
    // cell its current edge starts in. A vehicle nearly at the end of a cell is physically in
    // the next one while still indexed in the original, and querying only the spawn point's
    // cell would miss it.
    const sim = new TrafficSimulation();
    const blocker = sim.spawnVehicleOnEdges(path(20))!;
    blocker.edgeIndex = 4;
    blocker.edgeProgress = 0.98;   // indexed at 4,0, physically at (4.98, 0)
    sim.advanceEdgeVehicles(0);    // the index updates once per frame, so a moved vehicle needs one
    const arriving = path(20).slice(5).map(e => ({ ...e, id: e.id + '!' }));
    expect(sim.spawnVehicleOnEdges(arriving), '隔壁格的車沒被找到').toBeNull();
  });

  it('should let a far-away car through', () => {
    // The control: the index queries only nearby cells, and must neither miss a real blocker
    // nor block on a vehicle that is not one.
    const sim = new TrafficSimulation();
    const blocker = sim.spawnVehicleOnEdges(path(20))!;
    blocker.edgeIndex = 10;
    blocker.edgeProgress = 0.5;
    sim.advanceEdgeVehicles(0);
    const arriving = path(20).slice(5).map(e => ({ ...e, id: e.id + '!' }));
    expect(sim.spawnVehicleOnEdges(arriving), '五格外的車擋住了生成').not.toBeNull();
  });

  it('should still refuse a spot occupied from a different edge', () => {
    // The occupying vehicle need not share an edge with the newcomer; it may simply be driving
    // past the driveway. Position is what matters.
    const sim = new TrafficSimulation();
    const other = path(20, 0);
    const v = sim.spawnVehicleOnEdges(other)!;
    v.edgeIndex = 5; v.edgeProgress = 0.5;      // world coordinates (5.5, 0)
    sim.advanceEdgeVehicles(0);                 // the index updates once per frame
    const arriving = path(20).slice(5).map(e => ({ ...e, id: e.id + '!' }));
    arriving[0] = { ...arriving[0]!, from: { ...arriving[0]!.from, position: { x: 5.5, y: 0 } } };
    expect(sim.spawnVehicleOnEdges(arriving), '有車站在門口卻照樣生了一台').toBeNull();
  });

  it('should refuse a spot with a car just ahead in the same lane', () => {
    // Checking only around the spawn point's centre is not enough: a blocker need not sit on
    // the centre, and may have moved forward only slightly while still inside the body
    // clearance.
    const sim = new TrafficSimulation();
    const route = path(20);
    const first = sim.spawnVehicleOnEdges(route)!;
    first.edgeProgress = 0.2;       // same lane, 0.2 cells ahead, closer than ALONG (0.3)
    sim.advanceEdgeVehicles(0);     // the index updates once per frame
    expect(sim.spawnVehicleOnEdges(route), '前面 0.2 格有車卻照樣生了一台').toBeNull();
  });

  it('should keep the index the same size as the traffic', () => {
    // The index is rebuilt each frame. Forgetting to clear the old one is behaviourally
    // invisible — the entry objects are reused and distance comparisons read current
    // coordinates — but the entry count keeps growing and queries get slower.
    const sim = new TrafficSimulation();
    sim.spawnVehicleOnEdges(path(20));
    for (let f = 0; f < 300; f++) sim.advanceEdgeVehicles(0.02);
    const hash = (sim as unknown as { spawnHash: { size(): number } }).spawnHash;
    expect(hash.size(), '索引裡的筆數跟路上的車對不起來').toBe(sim.getVehicleCount());
  });

  it('should never refuse a bus', () => {
    // A missing bus cannot be recovered: busVehicleIds and route.vehicles still count it,
    // nothing reconciles them, and that route is permanently one vehicle short (BUG-115).
    const sim = new TrafficSimulation();
    const seg = [path(20)];
    expect(sim.addBusVehicle(seg, 1)).not.toBeNull();
    expect(sim.addBusVehicle(seg, 1), '公車被擋掉了').not.toBeNull();
    expect(sim.getVehicleCount()).toBe(2);
  });

  it('fixture sanity: a car really is shorter than the gap it needs', () => {
    // This whole group rests on two vehicles not fitting on one point.
    expect(LONGEST).toBeLessThan(TRAFFIC.MIN_GAP + LONGEST * 2);
  });
});

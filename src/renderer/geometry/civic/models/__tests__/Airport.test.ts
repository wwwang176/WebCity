import { describe, it, expect } from 'vitest';
import {
  airportSmallPlan, airportMediumPlan, airportLargePlan,
} from '../airport';
import { FACADE_TRANSIT, PART_LAMP } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { assembleVehicles } from '../../assemble';
import { buildAirplaneGeometry } from '../../../index';
import { civicColorOf } from '../../colors';
import {
  allFlightPaths, allGates, runwayCentrelines, taxiwayX, apronLaneZ,
  type Vec2,
} from '../../../../airportPaths';
import { airportLayout } from '../airport';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { AirportSize } from '../../../../../core/transport/AirportSystem';
import type { CivicPlan, CivicVolume } from '../../types';

const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (p: CivicPlan, tag: string) => p.massing.filter(v => v.tag === tag);
const marks = (p: CivicPlan) => p.decals.filter(d => d.layer === 'mark');
const bands = (p: CivicPlan) =>
  p.decals.filter(d => (d.layer ?? 'base') === 'base').sort((a, b) => a.z - b.z);

const PLANS = [
  ['小型機場', airportSmallPlan, 'airport_s', 'SMALL', 5, 4],
  ['中型機場', airportMediumPlan, 'airport_m', 'MEDIUM', 7, 4],
  ['大型機場', airportLargePlan, 'airport_l', 'LARGE', 9, 6],
] as const;

/** Whether an axis-aligned rectangle covers a point. */
interface Box { x: number; z: number; w: number; d: number }

const covers = (d: Box, p: Vec2) =>
  Math.abs(p.x - d.x) <= d.w / 2 + 1e-9 && Math.abs(p.z - d.z) <= d.d / 2 + 1e-9;

/** The rectangle a vehicle (or an aircraft) occupies at a position, measured from the **actual geometry**. */
function boxOf(v: Parameters<typeof assembleVehicles>[0][number]) {
  const geo = assembleVehicles([v], { w: 99, h: 99 });
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return {
    x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2,
    w: b.max.x - b.min.x, d: b.max.z - b.min.z,
    z0: b.min.z, z1: b.max.z,
  };
}

/**
 * The rectangle an aircraft at a gate occupies. Its nose faces the terminal (-z), so the long
 * side runs along z.
 *
 * With a hand-written dimension table, lengthening the fuselage would leave every check that
 * uses it working from the old numbers.
 */
const standBox = (g: Vec2) =>
  boxOf({ kind: 'airplane', x: g.x, z: g.z, rotationY: Math.PI / 2 });

/** Scan slice width, in cells. 0.04 is about 0.5 m: narrower than a jet bridge, and fine enough to separate nose from wing. */
const SLICE = 0.04;

/**
 * A parked aircraft's x range **per z slice**.
 *
 * A bounding box is not enough here: an aircraft's box is 10.8 x 11.7 m, while the nose section
 * is a fuselage only 1.4 m wide with empty space on both sides. A jet bridge stops **beside** the
 * nose, and judged by the box it would read as entering the aircraft.
 *
 * It scans the actual geometry's vertices rather than a hand-written outline table.
 */
function planeProfile(g: Vec2): Map<number, { x0: number; x1: number }> {
  const geo = assembleVehicles(
    [{ kind: 'airplane', x: g.x, z: g.z, rotationY: Math.PI / 2 }], { w: 99, h: 99 });
  const pos = geo.getAttribute('position');
  const out = new Map<number, { x0: number; x1: number }>();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.floor(pos.getZ(i) / SLICE);
    const cur = out.get(k);
    const x = pos.getX(i);
    if (cur) { cur.x0 = Math.min(cur.x0, x); cur.x1 = Math.max(cur.x1, x); }
    else out.set(k, { x0: x, x1: x });
  }
  return out;
}

/** Whether a rectangle touches that aircraft's **actual** outline. */
function hitsPlane(box: Box, g: Vec2): boolean {
  const bx0 = box.x - box.w / 2;
  const bx1 = box.x + box.w / 2;
  for (const [k, span] of planeProfile(g)) {
    const z0 = k * SLICE;
    if (z0 + SLICE <= box.z - box.d / 2 || z0 >= box.z + box.d / 2) continue;
    if (bx1 > span.x0 + 1e-9 && bx0 < span.x1 - 1e-9) return true;
  }
  return false;
}

/**
 * Every waypoint an aircraft passes on the ground.
 *
 * `approachStart` and `climbEnd` do not count: both are in the air and far outside the plot.
 */
function groundWaypoints(size: AirportSize): Array<{ name: string; p: Vec2 }> {
  const out: Array<{ name: string; p: Vec2 }> = [];
  for (const [i, path] of allFlightPaths(size).entries()) {
    const named: Array<[string, Vec2]> = [
      ['threshold', path.threshold],
      ['rollStop', path.rollStop],
      ['rightJunction', path.rightJunction],
      ['rightTaxiTop', path.rightTaxiTop],
      ['leftTaxiTop', path.leftTaxiTop],
      ['leftJunction', path.leftJunction],
      ['runwayEntry', path.runwayEntry],
      ['takeoffEnd', path.takeoffEnd],
      ...path.gates.map((g, j): [string, Vec2] => [`gate${j}`, g]),
    ];
    for (const [name, p] of named) out.push({ name: `路徑${i}.${name}`, p });
  }
  return out;
}

/**
 * The three airports. Their shared acceptance checks live in the table in `CivicPlans.test.ts`.
 *
 * The most important thing this group guards is that **the decorative geometry agrees with
 * `AirplaneAnimator`'s path table** (BUG-239). Drawn separately, the two describe different
 * airports: the animation's runway at the front, z = +1.20, and the decals' runway band at the
 * back — and the moment they meet, aircraft land along the terminal's roof.
 */
describe.each(PLANS)('%s', (_label, plan, type, size, w, h) => {
  it('should match its declared footprint', () => {
    expect(plan.footprint).toEqual({ w, h });
    expect(plan.facade).toBe(FACADE_TRANSIT);
    expect(plan.color).toEqual(civicColorOf(type));
  });

  it('should tile the whole plot with paving, edge to edge', () => {
    // A missing band in the middle leaves bare ground, and `assembleDecals` guards overlaps but
    // not gaps.
    const b = bands(plan);
    expect(b[0]!.z - b[0]!.d / 2, '後緣沒有鋪到底').toBeCloseTo(-h / 2, 9);
    expect(b[b.length - 1]!.z + b[b.length - 1]!.d / 2, '前緣沒有鋪到底')
      .toBeCloseTo(h / 2, 9);
    for (let i = 1; i < b.length; i++) {
      expect(b[i]!.z - b[i]!.d / 2, `第 ${i} 條帶與前一條之間有空隙`)
        .toBeCloseTo(b[i - 1]!.z + b[i - 1]!.d / 2, 9);
    }
    for (const d of b) {
      expect(d.w, '有一條帶沒有鋪滿整個寬度').toBeCloseTo(w, 9);
      expect(d.lawn, '跑道上長草').toBeFalsy();
    }
  });

  // ── Agreement with the path table (BUG-239) ───────────────

  /**
   * Every inch of ground an aircraft drives over has to be **paved**.
   *
   * This states BUG-239 directly: on the small airport, `threshold` at z = +1.20 falls inside the
   * decorative geometry's terminal band, and the aircraft lands along the roof.
   */
  it('should pave every point the aeroplane drives over', () => {
    for (const { name, p } of groundWaypoints(size)) {
      if (Math.abs(p.x) > w / 2 || Math.abs(p.z) > h / 2) continue;   // 佔地之外
      const on = bands(plan).find(d => covers(d, p));
      expect(on, `${name} (${p.x}, ${p.z}) 底下沒有鋪面`).toBeTruthy();
      expect(on!.lawn, `${name} 底下是草地`).toBeFalsy();
    }
  });

  /**
   * And nothing may stand on that path.
   *
   * Terminal, tower, jet bridge, parked aircraft: anything covering a waypoint is something the
   * animated aircraft drives through.
   */
  it('should keep every building and parked vehicle off the flight path', () => {
    const blockers: Array<{ what: string; v: CivicVolume }> = [
      ...plan.massing.filter(v => !/Light$/.test(v.tag ?? ''))
        .map(v => ({ what: `量體 ${v.tag}`, v })),
      ...plan.overhead.map(v => ({ what: `懸挑 ${v.tag}`, v })),
    ];
    for (const { name, p } of groundWaypoints(size)) {
      for (const { what, v } of blockers) {
        // A jet bridge **has to** reach beside the gate, so it only has to keep off the gate's
        // centre.
        expect(covers(v, p), `${what} 蓋在 ${name} 上`).toBe(false);
      }
    }
  });

  /**
   * A static aircraft on a working gate has an animated one park on top of it.
   *
   * `AirplaneAnimator` holds for 5 seconds and only avoids gates occupied by **other animated
   * aircraft**; anything in `CivicPlan.vehicles` is not in that set.
   */
  it('should never park a static aeroplane on a working gate or taxiway', () => {
    const CLEAR = 0.45;
    for (const v of plan.vehicles) {
      const box = boxOf(v);
      for (const g of allGates(size)) {
        expect(covers(box, g), `${v.kind} 停在機位 (${g.x}, ${g.z}) 上`).toBe(false);
      }
      // The two longitudinal taxiway bands are off limits too.
      const clearOfTaxi = Math.abs(Math.abs(box.x) - taxiwayX(size))
        >= box.w / 2 + CLEAR - 1e-9;
      const behindApron = box.z + box.d / 2 < apronLaneZ(size);
      expect(clearOfTaxi || behindApron, `${v.kind} 停在縱向滑行道上`).toBe(true);
    }
  });

  it('should draw the runway where the flight path says it is', () => {
    // The runway centreline is the path table's `threshold.z`. Drawn anywhere else, aircraft land
    // on unmarked asphalt while an empty runway sits beside them.
    for (const c of runwayCentrelines(size)) {
      const centre = marks(plan).filter(d =>
        Math.abs(d.z - c) < 1e-9 && d.w > d.d);
      expect(centre.length, `z = ${c} 的跑道沒有中線`).toBeGreaterThan(3);
      for (const d of centre) {
        expect(d.w, '跑道中線畫成連續的了 —— 那是滑行道的畫法')
          .toBeLessThan(w / 2);
      }
    }
  });

  it('should draw the taxiway centreline along the route the aeroplane takes', () => {
    // The longitudinal taxiways sit at +/-taxiwayX, running from the cross taxiway to the
    // furthest runway.
    const tx = taxiwayX(size);
    const lane = apronLaneZ(size);
    const far = Math.max(...runwayCentrelines(size));
    for (const side of [-1, 1]) {
      const line = marks(plan).find(d =>
        Math.abs(d.x - side * tx) < 1e-9 && d.d > d.w);
      expect(line, `x = ${side * tx} 沒有縱向滑行道中線`).toBeTruthy();
      expect(line!.z - line!.d / 2, '滑行道沒有接到橫向聯絡道')
        .toBeCloseTo(lane, 9);
      expect(line!.z + line!.d / 2, '滑行道沒有接到最遠那條跑道')
        .toBeCloseTo(far, 9);
    }
    const cross = marks(plan).find(d => Math.abs(d.z - lane) < 1e-9 && d.w > d.d);
    expect(cross, '沒有橫向聯絡道').toBeTruthy();
    expect(cross!.w / 2, '橫向聯絡道沒有接到兩側的縱向滑行道')
      .toBeCloseTo(tx, 9);
  });

  it('should hold aircraft short of every runway', () => {
    // Every runway needs a holding position before it: the large airport has two, and drawing one
    // leaves the other without.
    const tx = taxiwayX(size);
    for (const c of runwayCentrelines(size)) {
      // `d.w > d.d` is what makes a holding position **transverse**; without it, the
      // longitudinal taxiway centreline at the same x counts too, since its centre z also falls
      // in this range.
      const hold = marks(plan).filter(d =>
        Math.abs(Math.abs(d.x) - tx) < 1e-9 && d.w > d.d
        && d.z > c - 0.7 && d.z < c);
      expect(hold.length, `z = ${c} 的跑道前沒有兩道等待線`).toBe(2);
    }
  });

  it('should lead every gate in from the apron lane', () => {
    const lane = apronLaneZ(size);
    for (const g of allGates(size)) {
      const lead = marks(plan).find(d =>
        Math.abs(d.x - g.x) < 1e-9 && d.d > d.w);
      expect(lead, `機位 ${g.x} 沒有導引線`).toBeTruthy();
      expect(Math.min(lead!.z - lead!.d / 2, lead!.z + lead!.d / 2),
        '導引線沒有接到機位').toBeCloseTo(Math.min(lane, g.z), 9);
    }
  });

  it('should bridge exactly the gates the flight paths use', () => {
    // The large airport's two paths share the middle gate. Concatenated directly it appears
    // twice, and "one jet bridge per gate" draws a second bridge on top of the first.
    const bridges = plan.props.filter(v => v.tag === 'jetBridge');
    expect(bridges.length, '空橋數與機位數對不上').toBe(allGates(size).length);
  });

  /**
   * The three things on an apron must not foul each other: aircraft, jet bridges, ground vehicles.
   *
   * All three crowded into the 0.7 m gap between the terminal wall and the gate line pass every
   * existing acceptance check, because none of them asks whether the three collide with each
   * other.
   *
   * An aircraft's footprint is computed from the **actual geometry**: with a hand-written
   * dimension table, lengthening the fuselage would leave this check working from the old
   * numbers.
   */
  it('should keep the aeroplanes, the jet bridges and the ground crew apart', () => {
    const hits = (a: Box, b: Box) =>
      Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-9
      && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-9;

    const gates = allGates(size);
    const bridges = [...plan.props.filter(v => v.tag === 'jetBridge'),
      ...plan.props.filter(v => v.tag === 'jetBridgeLeg')]
      .map(v => ({ what: `${v.tag} ${v.x.toFixed(2)}`, box: v }));
    const crew = plan.vehicles.filter(v => v.tag === 'groundCrew')
      .map(v => ({ what: `地勤 ${v.kind}`, box: boxOf(v) }));

    // Aircraft are compared against their **actual outline** rather than a bounding box: a jet
    // bridge deliberately stops in the empty space beside the nose, and inside the box that space
    // counts as aircraft.
    for (const a of bridges) {
      for (const g of gates) {
        expect(hitsPlane(a.box, g), `${a.what} 卡到機位 ${g.x} 的飛機`).toBe(false);
      }
      for (const c of crew) expect(hits(a.box, c.box), `${a.what} 卡到 ${c.what}`).toBe(false);
    }
    for (const c of crew) {
      for (const g of gates) {
        expect(hitsPlane(c.box, g), `${c.what} 卡到機位 ${g.x} 的飛機`).toBe(false);
      }
    }
  });

  it('should tuck the jet bridges and the ground crew against the terminal wall', () => {
    // The only place they hold up is the gap between the terminal wall and the tail. Outside it
    // they either enter the terminal or block the aircraft taxiing in.
    const layout = airportLayout(size, h);
    const gateZ = allGates(size)[0]!.z;
    for (const v of plan.props.filter(x => x.tag === 'jetBridge')) {
      expect(v.z - v.d / 2, '空橋插進航廈').toBeGreaterThanOrEqual(layout.termFront - 1e-9);
      expect(v.z + v.d / 2, '空橋伸進機位').toBeLessThan(gateZ);
    }
    for (const v of plan.vehicles.filter(x => x.tag === 'groundCrew')) {
      expect(v.z, '地勤車沒有貼著航廈').toBeLessThan(gateZ);
      expect(v.z, '地勤車插進航廈').toBeGreaterThan(layout.termFront);
    }
  });

  /**
   * A jet bridge is an **arm**: one end joins the terminal, the other stops in front of the nose.
   *
   * Both ends are checked, because each can be wrong on its own: reaching into the fuselage at
   * one end, or sitting in the gap beside the gate touching **neither** the terminal nor the
   * aircraft, reading as a slab floating over the apron.
   *
   * The nose's position is computed from the **actual geometry** rather than copying the model
   * file's constant again: a mistyped `PLANE_NOSE` in `airport.ts`, or a lengthened fuselage,
   * turns this red.
   */
  it('should reach from the terminal wall down the aeroplane port side', () => {
    const term = tagged(plan, 'terminal')[0]!;
    const wall = term.z + term.d / 2;
    for (const g of allGates(size)) {
      const b = plan.props.find(v =>
        v.tag === 'jetBridge' && Math.abs(v.x - g.x) < 0.35 && v.x < g.x);
      expect(b, `機位 ${g.x} 沒有空橋`).toBeTruthy();
      expect(b!.z - b!.d / 2, '空橋的根部沒有接在航廈的牆上')
        .toBeCloseTo(wall, 9);

      // On the aircraft's port side, so it reads as reaching alongside the nose. A parked
      // aircraft faces -z, so port is -x.
      expect(b!.x, '空橋不在飛機的左舷').toBeLessThan(g.x);
      // And it runs **past the nose**: stopped in front of it, the bridge blocks the aircraft
      // taxiing in and reads as pressing against the nose rather than lying alongside the
      // fuselage.
      const nose = standBox(g).z0;
      const tip = b!.z + b!.d / 2;
      expect(tip, '空橋停在機頭前面，沒有沿著機身走').toBeGreaterThan(nose);
      expect(b!.d, '空橋不是一條伸出去的臂，是一塊貼著牆的板')
        .toBeGreaterThan(b!.w * 2);
    }
  });

  it('should keep the bridge slender enough to read as a bridge', () => {
    // Twice as long and two thirds as wide: a short broad arm reads as a canopy.
    for (const b of plan.props.filter(v => v.tag === 'jetBridge')) {
      expect(m(b.d), `空橋只有 ${m(b.d).toFixed(1)} m 長`).toBeGreaterThan(5);
      expect(m(b.w), `空橋有 ${m(b.w).toFixed(1)} m 寬 —— 那是一座天橋`)
        .toBeLessThan(1.6);
    }
  });

  it('should stand each jet bridge on a leg', () => {
    // The deck is 1 m up. Without a leg it is a slab floating over the apron.
    const legs = plan.props.filter(v => v.tag === 'jetBridgeLeg');
    expect(legs.length, '空橋沒有腳').toBe(allGates(size).length);
    for (const leg of legs) {
      expect(leg.y0, '腳沒有落地').toBeCloseTo(0, 9);
      const deck = plan.props.find(v =>
        v.tag === 'jetBridge' && Math.abs(v.x - leg.x) < 1e-9)!;
      expect(leg.y1, '腳沒有頂到橋面').toBeCloseTo(deck.y0, 9);
      expect(Math.abs(leg.z - deck.z), '腳沒有站在橋下')
        .toBeLessThanOrEqual(deck.d / 2 + 1e-9);
    }
  });

  // ── Night vocabulary ──────────────────────────────────────

  /**
   * A jet bridge has to reach the fuselage door.
   *
   * In the `overhead` layer, whose rule is to clear 2.2 m of pedestrian headroom, a jet bridge
   * sits at 4.6 m, far above a 1.44 m fuselage. A jet bridge reaches an aircraft, not a
   * pedestrian. The door height is measured from the **actual aircraft geometry** rather than
   * hard-coded: a hard-coded number would keep pointing at the old height after the aircraft is
   * made taller.
   */
  it('should meet the aeroplane door, not float above it', () => {
    const plane = buildAirplaneGeometry();
    plane.computeBoundingBox();
    const top = plane.boundingBox!.max.y;
    const bridges = plan.props.filter(v => v.tag === 'jetBridge');
    expect(bridges.length, '沒有空橋').toBeGreaterThan(0);
    for (const b of bridges) {
      expect(b.y0, `空橋橋面 ${m(b.y0).toFixed(1)} m 飄在機身上方`)
        .toBeLessThan(top);
      expect(b.y1, '空橋沉在地面下').toBeGreaterThan(top * 0.4);
    }
  });

  it('should park light-coloured ground vehicles by the terminal', () => {
    // The terminal needs a few pale work vehicles nearby. A dark ground vehicle disappears
    // against dark asphalt, and real ground crew vehicles are pale anyway.
    const service = plan.vehicles.filter(v => v.tag === 'groundCrew');
    expect(service.length, '航廈附近沒有工作車輛').toBeGreaterThanOrEqual(2);
    for (const v of service) {
      expect(v.tint, `${v.kind} 沒有指定顏色`).toBeDefined();
    }
    for (const v of service) {
      const lum = ((v.tint! >> 16 & 0xff) + (v.tint! >> 8 & 0xff) + (v.tint! & 0xff)) / 3;
      expect(lum, `${v.kind} 的地勤車不夠淺`).toBeGreaterThan(180);
    }
  });

  it('should light the runway, the thresholds and the taxiway', () => {
    for (const tag of ['runwayLight', 'thresholdLight', 'taxiwayLight']) {
      const lights = tagged(plan, tag);
      expect(lights.length, `${tag} 一顆都沒有`).toBeGreaterThanOrEqual(4);
      for (const l of lights) expect(l.part, `${tag} 不會亮`).toBe(PART_LAMP);
    }
  });

  it('should light both edges of every runway', () => {
    for (const c of runwayCentrelines(size)) {
      const near = tagged(plan, 'runwayLight').filter(l => Math.abs(l.z - c) < 0.7);
      expect(near.some(l => l.z < c), `z = ${c} 的跑道後側沒有邊燈`).toBe(true);
      expect(near.some(l => l.z > c), `z = ${c} 的跑道前側沒有邊燈`).toBe(true);
    }
  });

  it('should space the runway lights evenly', () => {
    const c = runwayCentrelines(size)[0]!;
    const row = tagged(plan, 'runwayLight')
      .filter(l => Math.abs(l.z - (c - 0.5)) < 1e-9)
      .map(l => l.x).sort((a, b) => a - b);
    const gaps = row.slice(1).map((x, i) => x - row[i]!);
    for (const g of gaps) {
      expect(m(g), `燈距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(gaps[0]!), 6);
    }
  });

  it('should keep every light small enough to be a light', () => {
    for (const v of plan.massing.filter(v => v.part === PART_LAMP)) {
      if (v.tag === 'beacon') continue;
      expect(m(v.y1 - v.y0), `${v.tag} 太大了`).toBeLessThan(1.0);
    }
  });

  it('should make the control tower the tallest thing on the field', () => {
    const cab = tagged(plan, 'towerCab')[0]!;
    const beacon = tagged(plan, 'beacon')[0]!;
    expect(cab.y1, '塔台沒有高過航廈')
      .toBeGreaterThan(tagged(plan, 'terminal')[0]!.y1);
    expect(beacon.y1, '信標不是全場最高的').toBeCloseTo(topOf(plan.massing), 9);
    expect(cab.w, '塔台頂樓沒有外挑').toBeGreaterThan(tagged(plan, 'tower')[0]!.w);
  });

  it('should fence the field', () => {
    expect(plan.fixtures.filter(f => f.kind === 'fence').length, '機場沒有圍籬')
      .toBeGreaterThanOrEqual(3);
  });

  it('should keep the greenery on the landside, behind the terminal', () => {
    // The apron side is where aircraft move. A tree planted there gets run over.
    const termFront = tagged(plan, 'terminal')[0]!;
    for (const f of plan.fixtures) {
      if (f.kind !== 'tree' && f.kind !== 'shrub' && f.kind !== 'hedge') continue;
      expect(f.z, `${f.kind} 種到停機坪上`)
        .toBeLessThanOrEqual(termFront.z + termFront.d / 2 + 1e-9);
    }
  });
});

describe('三座機場之間', () => {
  it('should grow the plot and the tower together', () => {
    const sizes = PLANS.map(([, p]) => ({
      cells: p.footprint.w * p.footprint.h,
      tower: topOf(p.massing),
    }));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!.cells, '佔地沒有變大').toBeGreaterThan(sizes[i - 1]!.cells);
      expect(sizes[i]!.tower, '塔台沒有變高').toBeGreaterThan(sizes[i - 1]!.tower);
    }
  });

  it('should share one runway vocabulary across all three', () => {
    const spacing = PLANS.map(([, p, , size]) => {
      const c = runwayCentrelines(size)[0]!;
      const row = p.massing.filter(v => v.tag === 'runwayLight'
        && Math.abs(v.z - (c - 0.5)) < 1e-9).map(v => v.x).sort((a, b) => a - b);
      return Math.round(m(row[1]! - row[0]!) * 100) / 100;
    });
    expect(new Set(spacing).size, `三座的跑道燈距不同：${spacing}`).toBe(1);
  });

  it('should give the large airport two runways, as its flight paths do', () => {
    // The large airport's animation side has two parallel paths. With one runway drawn, aircraft
    // on path B land off the asphalt.
    expect(runwayCentrelines('LARGE').length).toBe(2);
    const dark = airportLargePlan.decals.filter(d =>
      (d.layer ?? 'base') === 'base' && d.shade < 0.2);
    expect(dark.length, '大型機場只畫了一條跑道帶').toBe(2);
  });
});

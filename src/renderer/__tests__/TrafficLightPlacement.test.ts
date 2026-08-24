import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrafficLightRenderer, signalMounts, SIGNAL, type SignalMount }
  from '../TrafficLightRenderer';
import { STREET_LAMP_HEIGHT, STREET_LAMP_BULB_RADIUS } from '../RoadRenderer';
import { ROAD_WIDTHS } from '../RoadStripBuilder';
import { SIDEWALK_WIDTH } from '../../core/traffic/SidewalkGraph';
import { RoadType, RoadDirection, getLaneWidth } from '../../core/road/types';
import { LaneGraph, LANE_GEOMETRY, type Direction } from '../../core/traffic/LaneGraph';
import { makeGridLookup } from '../../../tests/helpers/makeGridLookup';

/**
 * A signal's pole stands on the kerb and its arm reaches over that side's lanes.
 *
 * Fixed at 0.18 from the centre line, all four sit **inside** the asphalt — signals only appear
 * where two arterials cross (`hasMajorOnBothAxes`), and a four-lane kerb is at 0.425 and a six-lane
 * at 0.475 — and on the opposing carriageway: traffic from the north runs at x = -0.09 while the
 * signal is at x = +0.18, across the centre line and on the driver's left.
 *
 * "Which side" is not recomputed here: this group compares against the entry points `LaneGraph`
 * actually produces. With the perpendicular written on both sides, a sign error is wrong in both
 * and the tests stay green.
 */

const CX = 10;
const CY = 20;
const MAJOR = [RoadType.FOUR_LANE, RoadType.SIX_LANE] as const;
/**
 * Every road type that has a width.
 *
 * Signals appear only where two arterials cross, but that tests the **neighbours**' road types
 * (`hasMajorOnBothAxes`); the junction cell's own type is unconstrained, so every type has to fit.
 */
const ALL = [
  RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE,
  RoadType.SIX_LANE, RoadType.HIGHWAY, RoadType.ONE_WAY,
] as const;

const DIRS: Direction[] = ['north', 'south', 'east', 'west'];

const ALL_WAYS = RoadDirection.NORTH | RoadDirection.SOUTH
  | RoadDirection.EAST | RoadDirection.WEST;

function mountsFor(roadType: number, roadFlags: number = ALL_WAYS): SignalMount[] {
  return signalMounts({ x: CX, y: CY, roadType, roadFlags });
}

/** How far this one sits from the road's centre line, on the axis perpendicular to traffic. */
function lateral(m: SignalMount, which: 'pole' | 'head'): number {
  const x = which === 'pole' ? m.poleX : m.headX;
  const z = which === 'pole' ? m.poleZ : m.headZ;
  return m.from === 'north' || m.from === 'south' ? x - CX : z - CY;
}

/** How far this one sits from the cell centre along the direction of travel; positive is the arrival side. */
function along(m: SignalMount): number {
  return m.from === 'north' ? CY - m.poleZ
    : m.from === 'south' ? m.poleZ - CY
      : m.from === 'east' ? m.poleX - CX
        : CX - m.poleX;
}

/**
 * A four-way junction's lane graph, used to ask where traffic arriving from `dir` actually runs.
 *
 * The junction plus its four neighbours: without them `buildFromGrid` cannot connect the entry
 * points.
 */
function entryOffsets(roadType: RoadType): Map<Direction, number> {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  const all = RoadDirection.NORTH | RoadDirection.SOUTH
    | RoadDirection.EAST | RoadDirection.WEST;
  cells.set(`${CX},${CY}`, { roadType, roadFlags: all });
  cells.set(`${CX},${CY - 1}`, { roadType, roadFlags: all });
  cells.set(`${CX},${CY + 1}`, { roadType, roadFlags: all });
  cells.set(`${CX - 1},${CY}`, { roadType, roadFlags: all });
  cells.set(`${CX + 1},${CY}`, { roadType, roadFlags: all });

  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);

  const out = new Map<Direction, number>();
  for (const p of graph.getConnectionPoints(`${CX},${CY}`)) {
    if (p.type !== 'entry' || p.lane !== 0) continue;
    // North-south traffic varies laterally in x, east-west in y.
    out.set(p.direction, p.direction === 'north' || p.direction === 'south'
      ? p.position.x - CX
      : p.position.y - CY);
  }
  return out;
}

describe('號誌的擺放', () => {
  it('should give one signal to each of the four approaches', () => {
    const mounts = mountsFor(RoadType.FOUR_LANE);
    expect(mounts.length, '不是四支').toBe(4);
    expect(new Set(mounts.map(m => m.from)).size, '有兩支對到同一個方向').toBe(4);
    for (const d of DIRS) {
      expect(mounts.some(m => m.from === d), `少了從${d}來的那一支`).toBe(true);
    }
  });

  it.each(ALL)('should stand the pole outside the kerb on a %s road', (roadType) => {
    // 0.18 is on the asphalt: a four-lane kerb is at 0.425.
    const kerb = ROAD_WIDTHS[roadType]! / 2;
    for (const m of mountsFor(roadType)) {
      expect(Math.abs(lateral(m, 'pole')), `${m.from} 那一支還站在柏油路上`)
        .toBeGreaterThanOrEqual(kerb);
    }
  });

  it.each(ALL)('should stand the pole on the pavement, not beyond it, on a %s road', (roadType) => {
    // Past the sidewalk it stands in grass or in a building.
    const outer = ROAD_WIDTHS[roadType]! / 2 + SIDEWALK_WIDTH;
    for (const m of mountsFor(roadType)) {
      expect(Math.abs(lateral(m, 'pole')), `${m.from} 那一支站到人行道外面了`)
        .toBeLessThanOrEqual(outer);
    }
  });

  it.each(MAJOR)('should put the signal on the approaching driver\'s side (%s)', (roadType) => {
    // The criterion comes from `LaneGraph` itself rather than a second perpendicular computed
    // here.
    const entries = entryOffsets(roadType);
    expect(entries.size, '車道圖沒有給出四個方向的進場點').toBe(4);

    for (const m of mountsFor(roadType)) {
      const carSide = entries.get(m.from)!;
      expect(Math.sign(lateral(m, 'pole')), `${m.from}：燈桿在對向那一側`)
        .toBe(Math.sign(carSide));
      expect(Math.sign(lateral(m, 'head')), `${m.from}：燈頭跑到對向去了`)
        .toBe(Math.sign(carSide));
    }
  });

  it.each(ALL)('should keep the arm on its own half of the road (%s)', (roadType) => {
    // Same side: the arm does not cross the centre line.
    const kerb = ROAD_WIDTHS[roadType]! / 2;
    for (const m of mountsFor(roadType)) {
      const head = lateral(m, 'head');
      expect(Math.abs(head), `${m.from} 的燈頭跨過中心線了`).toBeGreaterThan(0);
      expect(Math.abs(head), `${m.from} 的燈頭伸出路面外`).toBeLessThan(kerb);
      expect(Math.sign(head), `${m.from} 的橫臂彎到對面去了`)
        .toBe(Math.sign(lateral(m, 'pole')));
    }
  });

  it.each(ALL)('should hang the whole head over the carriageway (%s)', (roadType) => {
    // The head reaches at least the first lane's centre and sits **entirely** above the asphalt:
    // half of it past the kerb reads in an isometric view as hanging over the sidewalk.
    //
    // The upper bound is the kerb rather than the outermost lane's outer edge: with the arm cut to
    // `ARM_REACH` the head lands between the lanes and the kerb by design, which is a deliberate
    // length rather than an overrun.
    const laneWidth = getLaneWidth(roadType);
    const kerb = ROAD_WIDTHS[roadType]! / 2;
    for (const m of mountsFor(roadType)) {
      const head = Math.abs(lateral(m, 'head'));
      // The tolerance is for floating point: positions come from cell centre plus or minus an
      // offset, and 10 - 9.91 is not exactly 0.09.
      expect(head, `${m.from} 的燈頭還沒到第一條車道上方`)
        .toBeGreaterThanOrEqual(laneWidth / 2 - 1e-9);
      expect(head + SIGNAL.HEAD_SIZE / 2, `${m.from} 的燈頭有一半探出路緣`)
        .toBeLessThanOrEqual(kerb);
    }
  });

  it.each(ALL)('should still reach past the kerb after the arm was shortened (%s)', (roadType) => {
    // The lower bound on shortening the arm: any shorter and the head hangs over the sidewalk,
    // which is the same as having no arm.
    const kerb = ROAD_WIDTHS[roadType]! / 2;
    for (const m of mountsFor(roadType)) {
      const reach = Math.abs(lateral(m, 'pole')) - Math.abs(lateral(m, 'head'));
      expect(reach, `${m.from} 的橫臂沒有把燈頭帶進路面`)
        .toBeGreaterThan(Math.abs(lateral(m, 'pole')) - kerb);
    }
  });

  it('should move the pole outward as the road gets wider', () => {
    const reach = (t: RoadType) => Math.abs(lateral(mountsFor(t)[0]!, 'pole'));
    expect(reach(RoadType.FOUR_LANE), '四車道的桿沒有比兩車道外面')
      .toBeGreaterThan(reach(RoadType.TWO_LANE));
    expect(reach(RoadType.SIX_LANE), '六車道的桿沒有比四車道外面')
      .toBeGreaterThan(reach(RoadType.FOUR_LANE));
  });

  it.each(ALL)('should put the signal on the near side of the junction (%s)', (roadType) => {
    // The near side: the signal is on the side traffic **arrives** from, not across the
    // junction.
    for (const m of mountsFor(roadType)) {
      expect(along(m), `${m.from} 那一支跑到路口對面去了`).toBeGreaterThan(0);
      expect(along(m), `${m.from} 那一支離停止線太遠`)
        .toBeCloseTo(SIGNAL.STOP_LINE, 9);
    }
  });

  it('should keep the bulb no larger than the street lamp\'s', () => {
    // A signal bulb larger than a street lamp's turns a junction into a row of lanterns.
    expect(SIGNAL.HEAD_SIZE, '燈泡比路燈的還大')
      .toBeLessThanOrEqual(STREET_LAMP_BULB_RADIUS * 2);
  });

  it('should stand at least as tall as the street lamps beside it', () => {
    // A signal shorter than a street lamp does not read as a signal.
    expect(SIGNAL.POLE_H, '燈桿比同一條路上的路燈還矮')
      .toBeGreaterThanOrEqual(STREET_LAMP_HEIGHT);
  });

  it('should hang the head off the arm, touching it', () => {
    // "Below the arm" is not enough: with a gap between them the bulb floats. With `HEAD_Y`
    // hard-coded, shrinking the bulb to street-lamp size opens exactly that gap. Requiring them to
    // **meet** keeps it closed through any further size change.
    expect(SIGNAL.HEAD_Y + SIGNAL.HEAD_SIZE / 2, '燈泡與橫臂之間有一條縫')
      .toBeCloseTo(SIGNAL.ARM_Y - SIGNAL.ARM_T / 2, 9);
    expect(SIGNAL.ARM_Y, '橫臂高過桿頂').toBeLessThanOrEqual(SIGNAL.POLE_H);
  });

  it.each(MAJOR)('should assign each signal to the phase its approach belongs to (%s)', (roadType) => {
    for (const m of mountsFor(roadType)) {
      const expected = m.from === 'north' || m.from === 'south';
      expect(m.isNS, `${m.from} 那一支歸錯相位了`).toBe(expected);
    }
  });
});

/**
 * No signal on a side with no road.
 *
 * Signals are placed from three-way junctions upward (`dirs >= 3` in
 * `syncTrafficLightsWithGrid`), and drawing a fixed four leaves a T junction with one standing on
 * grass, controlling a road that does not exist.
 */
describe('T 字路口', () => {
  const T = RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST;

  it('should leave out the approach that has no road', () => {
    const mounts = mountsFor(RoadType.FOUR_LANE, T);
    expect(mounts.length, 'T 字路口還是畫了四支').toBe(3);
    expect(mounts.some(m => m.from === 'west'), '西邊沒有路，卻立了一支').toBe(false);
    for (const d of ['north', 'south', 'east'] as const) {
      expect(mounts.some(m => m.from === d), `少了從${d}來的那一支`).toBe(true);
    }
  });

  it('should add the fourth one back when the road is completed', () => {
    const all = RoadDirection.NORTH | RoadDirection.SOUTH
      | RoadDirection.EAST | RoadDirection.WEST;
    expect(mountsFor(RoadType.FOUR_LANE, all).length, '補上西邊那條路之後沒有補上號誌')
      .toBe(4);
  });

  it('should still place the ones it keeps exactly where the crossroads put them', () => {
    // Drawing one fewer must not move the others: a position depends on its direction alone, not
    // on how many there are.
    const cross = new Map(mountsFor(RoadType.FOUR_LANE).map(m => [m.from, m]));
    for (const m of mountsFor(RoadType.FOUR_LANE, T)) {
      const same = cross.get(m.from)!;
      expect(m.poleX, `${m.from} 的桿位移了`).toBeCloseTo(same.poleX, 9);
      expect(m.poleZ, `${m.from} 的桿位移了`).toBeCloseTo(same.poleZ, 9);
      expect(m.headX, `${m.from} 的燈頭位移了`).toBeCloseTo(same.headX, 9);
      expect(m.headZ, `${m.from} 的燈頭位移了`).toBeCloseTo(same.headZ, 9);
    }
  });
});

describe('號誌的渲染', () => {
  const light = {
    x: CX, y: CY, phase: 0, timer: 1, phaseDuration: 4,
    clearing: false, roadType: RoadType.FOUR_LANE, roadFlags: ALL_WAYS,
  };

  function instanced(scene: THREE.Scene): THREE.InstancedMesh[] {
    return scene.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  }

  it('should build a pole, an arm and a head for every approach', () => {
    const scene = new THREE.Scene();
    new TrafficLightRenderer().build(scene, [light]);
    const meshes = instanced(scene);
    expect(meshes.length, '桿／臂／燈頭三層沒有都建出來').toBe(3);
    for (const m of meshes) {
      expect(m.count, '有一層不是四支').toBe(4);
    }
  });

  it('should put the poles where the placement says', () => {
    // Computing the placement correctly and drawing it somewhere else makes the whole group above
    // worthless.
    const scene = new THREE.Scene();
    new TrafficLightRenderer().build(scene, [light]);
    const want = mountsFor(RoadType.FOUR_LANE)
      .map(m => `${m.poleX.toFixed(4)},${m.poleZ.toFixed(4)}`).sort();

    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const got: string[] = [];
    // The pole is the only layer whose base sits on the ground.
    const pole = instanced(scene).find(mesh => {
      mesh.getMatrixAt(0, m4);
      p.setFromMatrixPosition(m4);
      return Math.abs(p.y) < 0.1;
    })!;
    expect(pole, '找不到燈桿那一層').toBeTruthy();
    for (let i = 0; i < pole.count; i++) {
      pole.getMatrixAt(i, m4);
      p.setFromMatrixPosition(m4);
      got.push(`${p.x.toFixed(4)},${p.z.toFixed(4)}`);
    }
    expect(got.sort(), '畫出來的燈桿位置與擺放算出來的不一致').toEqual(want);
  });

  it('should end the arm exactly where the head hangs', () => {
    // The case above guards the height and this one the horizontal: the arm's tip has to land
    // directly above the bulb, or the bulb hangs in mid-air beside an arm reaching elsewhere.
    const scene = new THREE.Scene();
    new TrafficLightRenderer().build(scene, [light]);
    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();

    const meshes = instanced(scene);
    const arm = meshes.find(mesh => {
      mesh.getMatrixAt(0, m4);
      return Math.abs(p.setFromMatrixPosition(m4).y - SIGNAL.ARM_Y) < 1e-6;
    })!;
    const head = meshes.find(mesh => {
      mesh.getMatrixAt(0, m4);
      return Math.abs(p.setFromMatrixPosition(m4).y - SIGNAL.HEAD_Y) < 1e-6;
    })!;
    expect(arm && head, '找不到橫臂或燈泡那一層').toBeTruthy();

    const dir = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const hp = new THREE.Vector3();
    for (let i = 0; i < arm.count; i++) {
      arm.getMatrixAt(i, m4);
      pos.setFromMatrixPosition(m4);
      // The arm's geometry runs from the origin to 1 along local +x, so its tip is the start plus
      // the first basis vector.
      dir.set(m4.elements[0]!, m4.elements[1]!, m4.elements[2]!);
      tip.copy(pos).add(dir);
      head.getMatrixAt(i, m4);
      hp.setFromMatrixPosition(m4);
      // Tolerance to five decimal places: matrices live in a `Float32Array`, and at coordinates
      // around 20 single-precision eps is already 2e-6. Any tighter tests the float format rather
      // than the geometry.
      expect(tip.x, `第 ${i} 支的橫臂遠端沒有對到燈泡`).toBeCloseTo(hp.x, 5);
      expect(tip.z, `第 ${i} 支的橫臂遠端沒有對到燈泡`).toBeCloseTo(hp.z, 5);
    }
  });

  it('should stretch each arm to reach its own head', () => {
    const scene = new THREE.Scene();
    new TrafficLightRenderer().build(scene, [light]);
    const mounts = mountsFor(RoadType.FOUR_LANE);
    const wantLen = Math.hypot(
      mounts[0]!.headX - mounts[0]!.poleX, mounts[0]!.headZ - mounts[0]!.poleZ,
    );

    const m4 = new THREE.Matrix4();
    const arm = instanced(scene).find(mesh => {
      mesh.getMatrixAt(0, m4);
      return Math.abs(new THREE.Vector3().setFromMatrixPosition(m4).y - SIGNAL.ARM_Y) < 1e-6;
    })!;
    expect(arm, '找不到橫臂那一層').toBeTruthy();
    arm.getMatrixAt(0, m4);
    // The arm's local long axis is x, and rotation does not change a basis vector's length, so the
    // stretch is always read from x.
    const scale = new THREE.Vector3().setFromMatrixScale(m4);
    expect(scale.x, '橫臂沒有伸到燈頭那裡').toBeCloseTo(wantLen, 6);
  });
});

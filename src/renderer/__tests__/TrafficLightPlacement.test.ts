import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrafficLightRenderer, signalMounts, SIGNAL, type SignalMount }
  from '../TrafficLightRenderer';
import { STREET_LAMP_HEIGHT, STREET_LAMP_BULB_RADIUS } from '../RoadRenderer';
import { ROAD_WIDTHS } from '../RoadStripBuilder';
import { SIDEWALK_WIDTH } from '../../core/traffic/SidewalkGraph';
import { RoadType, RoadDirection } from '../../core/road/types';
import { LaneGraph, LANE_GEOMETRY, type Direction } from '../../core/traffic/LaneGraph';
import { makeGridLookup } from '../../../tests/helpers/makeGridLookup';

/**
 * 號誌桿站在路緣上，橫臂彎進自己這一側的車道正上方。
 *
 * 原本四支都固定插在離中心線 0.18 的地方。號誌只出現在兩條幹道相交處
 * （`hasMajorOnBothAxes`），而四車道的路緣在 0.425、六車道在 0.475 ——
 * 0.18 是在柏油路**裡面**，而且落在對向車道上：從北邊來的車走 x = −0.09，
 * 燈卻在 x = +0.18，跨過中心線、在駕駛的左手邊。
 *
 * 「哪一側」不自己重算 —— 這一組拿 `LaneGraph` 真正算出來的進場點比對。
 * 兩邊各寫一次垂直向量的話，符號錯了會一起錯，測試照樣是綠的。
 */

const CX = 10;
const CY = 20;
const MAJOR = [RoadType.FOUR_LANE, RoadType.SIX_LANE] as const;
/**
 * 每一種有寬度的路。
 *
 * 號誌只在兩條幹道相交處出現，但那是看**鄰居**的路型（`hasMajorOnBothAxes`）
 * —— 路口那一格自己是什麼型並沒有限制，所以每一種都要放得下。
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

/** 這一支離路中心線多遠（垂直於車流方向的那一軸）。 */
function lateral(m: SignalMount, which: 'pole' | 'head'): number {
  const x = which === 'pole' ? m.poleX : m.headX;
  const z = which === 'pole' ? m.poleZ : m.headZ;
  return m.from === 'north' || m.from === 'south' ? x - CX : z - CY;
}

/** 這一支沿著車流方向離格心多遠（正 = 車來的那一側）。 */
function along(m: SignalMount): number {
  return m.from === 'north' ? CY - m.poleZ
    : m.from === 'south' ? m.poleZ - CY
      : m.from === 'east' ? m.poleX - CX
        : CX - m.poleX;
}

/**
 * 一個四向十字路口的車道圖，用來問「從 `dir` 來的車實際走在哪」。
 *
 * 路口本身加上四個鄰居 —— 少了鄰居的話 `buildFromGrid` 連不出進場點。
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
    // 南北向的車橫向差在 x，東西向的差在 y
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
    // 原本的 0.18 是柏油路上：四車道的路緣在 0.425。
    const kerb = ROAD_WIDTHS[roadType]! / 2;
    for (const m of mountsFor(roadType)) {
      expect(Math.abs(lateral(m, 'pole')), `${m.from} 那一支還站在柏油路上`)
        .toBeGreaterThanOrEqual(kerb);
    }
  });

  it.each(ALL)('should stand the pole on the pavement, not beyond it, on a %s road', (roadType) => {
    // 站到人行道外面就是插在草地／建築裡了。
    const outer = ROAD_WIDTHS[roadType]! / 2 + SIDEWALK_WIDTH;
    for (const m of mountsFor(roadType)) {
      expect(Math.abs(lateral(m, 'pole')), `${m.from} 那一支站到人行道外面了`)
        .toBeLessThanOrEqual(outer);
    }
  });

  it.each(MAJOR)('should put the signal on the approaching driver\'s side (%s)', (roadType) => {
    // 判準來自 `LaneGraph` 本身，不是這裡再算一次垂直向量。
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
    // 「同側」：橫臂不過中心線。
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
    // 燈頭至少要伸過第一條車道的中心，而且**整顆**在柏油路上方 —— 半顆探出
    // 路緣的話，從等角視角看會像是掛在人行道上。
    //
    // 上界是路緣而不是「最外側車道的外緣」：橫臂縮到 `ARM_REACH` 之後，燈頭
    // 本來就會落在車道與路緣之間，那是刻意的長度，不是跑出界。
    const laneWidth = LANE_GEOMETRY.LANE_WIDTH;
    const kerb = ROAD_WIDTHS[roadType]! / 2;
    for (const m of mountsFor(roadType)) {
      const head = Math.abs(lateral(m, 'head'));
      // 容差是浮點的：位置是「格心 ± 偏移」算出來的，10 − 9.91 不會剛好是 0.09。
      expect(head, `${m.from} 的燈頭還沒到第一條車道上方`)
        .toBeGreaterThanOrEqual(laneWidth / 2 - 1e-9);
      expect(head + SIGNAL.HEAD_SIZE / 2, `${m.from} 的燈頭有一半探出路緣`)
        .toBeLessThanOrEqual(kerb);
    }
  });

  it.each(ALL)('should still reach past the kerb after the arm was shortened (%s)', (roadType) => {
    // 橫臂縮短的下限：再短就吊在人行道上，那跟沒有橫臂一樣。
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
    // 近端：燈在車**進來**的那一側，不是路口對面。
    for (const m of mountsFor(roadType)) {
      expect(along(m), `${m.from} 那一支跑到路口對面去了`).toBeGreaterThan(0);
      expect(along(m), `${m.from} 那一支離停止線太遠`)
        .toBeCloseTo(SIGNAL.STOP_LINE, 9);
    }
  });

  it('should keep the bulb no larger than the street lamp\'s', () => {
    // 號誌的燈泡比路燈還大顆的話，路口會變成一排大燈籠。
    expect(SIGNAL.HEAD_SIZE, '燈泡比路燈的還大')
      .toBeLessThanOrEqual(STREET_LAMP_BULB_RADIUS * 2);
  });

  it('should stand at least as tall as the street lamps beside it', () => {
    // 號誌比路燈矮的話，讀起來就不像號誌。
    expect(SIGNAL.POLE_H, '燈桿比同一條路上的路燈還矮')
      .toBeGreaterThanOrEqual(STREET_LAMP_HEIGHT);
  });

  it('should hang the head off the arm, touching it', () => {
    // 「在橫臂下面」不夠 —— 中間留一條縫的話，燈泡是浮在空中的。燈泡的尺寸
    // 改過一次（縮成路燈燈泡那麼大），而 `HEAD_Y` 當時是寫死的數字，於是
    // 縫就跑出來了。要求**貼合**，尺寸再改也不會鬆脫。
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
 * 沒有路的那一邊不要立號誌。
 *
 * 號誌從三向路口起就會設（`syncTrafficLightsWithGrid` 的 `dirs >= 3`），而渲染端
 * 原本固定畫四支 —— T 字路口那一支立在草地上，管著一條不存在的路。
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
    // 少畫一支不能讓其餘幾支跟著位移 —— 位置只由方向決定，與有幾支無關。
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
    // 擺放算對了但畫在別的地方的話，上面那一整組測試都是白測的。
    const scene = new THREE.Scene();
    new TrafficLightRenderer().build(scene, [light]);
    const want = mountsFor(RoadType.FOUR_LANE)
      .map(m => `${m.poleX.toFixed(4)},${m.poleZ.toFixed(4)}`).sort();

    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const got: string[] = [];
    // 桿是唯一底面貼地的那一層
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
    // 上面那條顧的是高度，這條顧的是水平：橫臂的遠端必須落在燈泡的正上方，
    // 否則燈泡是吊在半空中、旁邊有一根伸到別處的桿子。
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
      // 橫臂的幾何沿本地 +x 從原點長到 1，所以遠端是「起點 + 第一個基底向量」。
      dir.set(m4.elements[0]!, m4.elements[1]!, m4.elements[2]!);
      tip.copy(pos).add(dir);
      head.getMatrixAt(i, m4);
      hp.setFromMatrixPosition(m4);
      // 容差到小數第 5 位：矩陣存在 `Float32Array` 裡，座標約 20 時單精度的
      // eps 就有 2e-6，再嚴下去測的是浮點格式不是幾何。
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
    // 橫臂的本地長軸是 x，旋轉不改變基底向量的長度，所以拉伸量永遠讀 x。
    const scale = new THREE.Vector3().setFromMatrixScale(m4);
    expect(scale.x, '橫臂沒有伸到燈頭那裡').toBeCloseTo(wantLen, 6);
  });
});

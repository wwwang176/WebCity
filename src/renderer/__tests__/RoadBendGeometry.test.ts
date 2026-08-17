import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection, ROAD_WIDTHS } from '../../core/road/types';
import { SIDEWALK_WIDTH } from '../../core/traffic/SidewalkGraph';
import {
  buildRoadStrips, buildSidewalkStrips, buildLampPositions,
  BEND_ARC_SEGMENTS, BEND_KERB_SEGMENTS,
  type RoadCell,
} from '../RoadStripBuilder';

/**
 * 九十度彎的路面與路緣走圓弧，不是兩塊長方形拼出來的直角。
 *
 * 車道虛線與雙黃線早就是弧的（`emitLBendDashes`、`buildCurvedCenterLineData`），
 * 只有柏油與路緣還是方的 —— 所以彎道上的線是圓的、路是方的。
 *
 * 路面與路緣要一起改:只把路緣拉成弧，方形的柏油角會整塊跑到路緣外面。
 */

const NS = RoadDirection.NORTH | RoadDirection.SOUTH;
const NE = RoadDirection.NORTH | RoadDirection.EAST;
const NW = RoadDirection.NORTH | RoadDirection.WEST;
const SE = RoadDirection.SOUTH | RoadDirection.EAST;
const SW = RoadDirection.SOUTH | RoadDirection.WEST;

function cell(flags: number, roadType = RoadType.TWO_LANE): RoadCell {
  return { x: 0, y: 0, roadType, roadFlags: flags };
}

/** 這個彎繞著哪一個角轉。與 `emitLBendDashes` 用的是同一組參數。 */
function turnCentre(flags: number): { cx: number; cz: number } {
  const hasN = (flags & RoadDirection.NORTH) !== 0;
  const hasE = (flags & RoadDirection.EAST) !== 0;
  return { cx: hasE ? 0.5 : -0.5, cz: hasN ? -0.5 : 0.5 };
}

const radius = (s: { x: number; z: number }, c: { cx: number; cz: number }) =>
  Math.hypot(s.x - c.cx, s.z - c.cz);

describe('L 形彎的路面', () => {
  it('should lay the asphalt along an arc instead of two rectangles', () => {
    expect(buildRoadStrips([cell(NE)])).toHaveLength(BEND_ARC_SEGMENTS);
  });

  it('should put the outer edge exactly where the road ends', () => {
    // 外緣是看得見的那一條。長方形蓋不滿彎的環面，補的部分全部朝**內**塞 ——
    // 朝外補的話柏油會凸出路緣，那正是玩家會看到的破綻。
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half, 9);
    }
  });

  it('should keep every piece on the arc', () => {
    // 彎心在格子的角上，路心線就是那個四分之一圓。車道虛線用的也是這個半徑，
    // 所以線會落在柏油上。中心略偏內是補內側留下的，不到千分之二格。
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      expect(Math.abs(radius(s, c) - 0.5)).toBeLessThan(0.01);
    }
  });

  it('should point every piece along the arc, not along the axes', () => {
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      // 長邊方向（局部 +Z 轉過 rotY）要垂直於半徑。
      const along = { x: Math.sin(s.rotY), z: Math.cos(s.rotY) };
      const out = { x: s.x - c.cx, z: s.z - c.cz };
      expect(along.x * out.x + along.z * out.z).toBeCloseTo(0, 9);
    }
  });

  it('should not let the asphalt spill past the outer edge of the turn', () => {
    // 這是原本的病:方角落在 √2×(0.5+半幅) ≈ 1.13，而路面外緣只到 0.5+半幅 = 0.8。
    // 那塊多出來的柏油正是路緣拉成弧之後會露在外面的東西。
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      const outer = radius(s, c) + s.sx / 2;
      expect(outer).toBeLessThanOrEqual(0.5 + half + 1e-9);
    }
  });

  it('should still meet the neighbouring cells at both ends', () => {
    // 弧要從格子的北邊界一路接到東邊界。少接一段，彎道兩頭就會出現缺口。
    const c = turnCentre(NE);
    const angles = buildRoadStrips([cell(NE)])
      .map(s => Math.atan2(Math.abs(s.z - c.cz), Math.abs(s.x - c.cx)))
      .sort((a, b) => a - b);
    const step = (Math.PI / 2) / BEND_ARC_SEGMENTS;
    expect(angles[0]).toBeCloseTo(step / 2, 9);
    expect(angles[angles.length - 1]).toBeCloseTo(Math.PI / 2 - step / 2, 9);
  });

  it('should cover the whole quarter-ring, with no holes anywhere in it', () => {
    // 這一條原本問錯了問題。舊版只檢查相鄰兩段的**中線端點**有沒有接上 ——
    // 接上了，可是每一段都是直的長方形，兩段夾角 θ，於是外緣張開一個楔形的洞、
    // 內緣互相重疊。中線是唯一沒有縫的那條線，所以測試全綠而路面是破的。
    //
    // 改成直接問「這個環面上每一點有沒有被蓋到」，那才是玩家看到的東西。
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    const strips = buildRoadStrips([cell(NE)]);
    const eps = 1e-6;

    for (const rad of [0.5 - half + eps, 0.5 - half / 2, 0.5, 0.5 + half / 2, 0.5 + half - eps]) {
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * (Math.PI / 2);
        // NE 彎:dirX = -1、dirZ = +1（見 emitLBendDashes）。
        const px = c.cx - rad * Math.cos(a);
        const pz = c.cz + rad * Math.sin(a);
        const covered = strips.some(s => {
          // 換到這一段自己的座標系:局部 +Z 是長邊，+X 是寬邊。
          const dx = px - s.x, dz = pz - s.z;
          const along = dx * Math.sin(s.rotY) + dz * Math.cos(s.rotY);
          const across = dx * Math.cos(s.rotY) - dz * Math.sin(s.rotY);
          return Math.abs(along) <= s.sz / 2 + 1e-9 && Math.abs(across) <= s.sx / 2 + 1e-9;
        });
        expect(covered, `半徑 ${rad.toFixed(3)}、角度 ${(a * 180 / Math.PI).toFixed(1)}° 沒有柏油`)
          .toBe(true);
      }
    }
  });

  it('should cover the whole kerb band too', () => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    const strips = buildSidewalkStrips([cell(NE)]);
    // 路緣騎在柏油邊緣上，中心就是柏油外緣。
    const mid = 0.5 + half;
    const eps = 1e-6;

    for (const rad of [mid - SIDEWALK_WIDTH / 2 + eps, mid, mid + SIDEWALK_WIDTH / 2 - eps]) {
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * (Math.PI / 2);
        const px = c.cx - rad * Math.cos(a);
        const pz = c.cz + rad * Math.sin(a);
        const covered = strips.some(s => {
          const dx = px - s.x, dz = pz - s.z;
          const along = dx * Math.sin(s.rotY) + dz * Math.cos(s.rotY);
          const across = dx * Math.cos(s.rotY) - dz * Math.sin(s.rotY);
          return Math.abs(along) <= s.sz / 2 + 1e-9 && Math.abs(across) <= s.sx / 2 + 1e-9;
        });
        expect(covered, `路緣在 ${(a * 180 / Math.PI).toFixed(1)}° 破了`).toBe(true);
      }
    }
  });

  it('should carry at least the full road width across the turn', () => {
    // 至少要有路寬，才接得上兩頭的直路;多出來的是補內側的量，不該多到看得出來。
    for (const type of [RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE, RoadType.HIGHWAY]) {
      for (const s of buildRoadStrips([cell(NE, type)])) {
        expect(s.sx, `${type} too narrow`).toBeGreaterThanOrEqual(ROAD_WIDTHS[type]! - 1e-9);
        expect(s.sx, `${type} overshoots`).toBeLessThan(ROAD_WIDTHS[type]! + 0.02);
      }
    }
  });

  it.each([[NE], [NW], [SE], [SW]])('should turn around the right corner (%i)', (flags) => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(flags);
    for (const s of buildRoadStrips([cell(flags)])) {
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half, 9);
    }
  });

  it('should leave straight roads alone', () => {
    const strips = buildRoadStrips([cell(NS)]);
    expect(strips).toHaveLength(1);
    expect(strips[0]!.rotY).toBe(0);
    expect(strips[0]!.sz).toBeCloseTo(1, 9);
  });
});

describe('L 形彎的路緣', () => {
  it('should follow the same arc, just further out', () => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    const strips = buildSidewalkStrips([cell(NE)]);
    expect(strips).toHaveLength(BEND_KERB_SEGMENTS);
    for (const s of strips) {
      // 外緣準確 —— 路緣的外側就是玩家看到的街廓邊界。內半條壓在柏油底下，
      // 跟直路一樣。
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH / 2, 9);
      expect(s.sx).toBeGreaterThanOrEqual(SIDEWALK_WIDTH - 1e-9);
      expect(s.sx).toBeLessThan(SIDEWALK_WIDTH + 0.03);
    }
  });

  it('should keep its inner half under the asphalt, like a straight kerb does', () => {
    // 直路的路緣有一半壓在路面底下（路緣的平面在 y=0.028，路面那塊板子佔 0 到
    // 0.05）。彎道照做，露出來的才會一樣寬。埋得比半條還深也不對 —— 那是補內側
    // 的量失控，路緣會看起來比直路窄。
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      const buried = (0.5 + half) - (radius(s, c) - s.sx / 2);
      expect(buried).toBeGreaterThanOrEqual(SIDEWALK_WIDTH / 2 - 1e-9);
      expect(buried).toBeLessThan(SIDEWALK_WIDTH / 2 + 0.01);
    }
  });

  it('should only kerb the outside of the turn', () => {
    // 內側沒有路緣 —— 直路的規則是「沒有路的那一邊才鋪」，彎道的內側兩邊都有路。
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      expect(radius(s, c)).toBeGreaterThan(0.5);
    }
  });

  it.each([[NE], [NW], [SE], [SW]])('should kerb the outside for every orientation (%i)', (flags) => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(flags);
    const strips = buildSidewalkStrips([cell(flags)]);
    expect(strips).toHaveLength(BEND_KERB_SEGMENTS);
    for (const s of strips) {
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH / 2, 9);
    }
  });

  it('should leave straight roads alone', () => {
    const strips = buildSidewalkStrips([cell(NS)]);
    expect(strips).toHaveLength(2);
    for (const s of strips) expect(s.rotY).toBe(0);
  });

  it('should leave intersections alone', () => {
    const cross = cell(RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    for (const s of buildSidewalkStrips([cross])) expect(s.rotY).toBe(0);
    for (const s of buildRoadStrips([cross])) expect(s.rotY).toBe(0);
  });
});

describe('L 形彎的路緣石不能凸出去', () => {
  /** 一段長方形四個角裡，離彎心最遠的那一個。 */
  function furthestCorner(
    s: { x: number; z: number; sx: number; sz: number; rotY: number },
    c: { cx: number; cz: number },
  ): number {
    let far = 0;
    for (const a of [1, -1]) {
      for (const b of [1, -1]) {
        const px = s.x + a * (s.sz / 2) * Math.sin(s.rotY) + b * (s.sx / 2) * Math.cos(s.rotY);
        const pz = s.z + a * (s.sz / 2) * Math.cos(s.rotY) - b * (s.sx / 2) * Math.sin(s.rotY);
        far = Math.max(far, Math.hypot(px - c.cx, pz - c.cz));
      }
    }
    return far;
  }

  it('should not let the kerb bulge past its own outer radius', () => {
    // 每一段都是直的長方形，中間貼著圓弧 —— 所以**兩端的角**會凸到圓外面，
    // 凸出量是 R×(1/cos(θ/2)−1)。段數太少的話那是一圈看得見的扇貝邊，接在
    // 直路的路緣上特別明顯:直路是一條直線，彎道卻鼓出來一塊。
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const nominal = 0.5 + half + SIDEWALK_WIDTH / 2;
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      // 容許量取路緣寬的 5% —— 再多就看得出來了。
      expect(furthestCorner(s, c) - nominal).toBeLessThan(SIDEWALK_WIDTH * 0.05);
    }
  });

  it('should keep the kerb about as thick as it is on a straight', () => {
    // 補內側的量跟半徑成正比，而路緣的半徑比路面大 —— 段數不夠的話彎道的路緣
    // 會比直路胖一圈。
    for (const s of buildSidewalkStrips([cell(NE)])) {
      expect(s.sx).toBeLessThan(SIDEWALK_WIDTH * 1.05);
    }
  });

  it('should spend the extra pieces on the kerb, not on the asphalt', () => {
    // 柏油的凸出被路緣蓋住，所以它不需要那麼多段。段數分開才不會白花實例。
    expect(BEND_KERB_SEGMENTS).toBeGreaterThan(BEND_ARC_SEGMENTS);
    expect(buildSidewalkStrips([cell(NE)])).toHaveLength(BEND_KERB_SEGMENTS);
    expect(buildRoadStrips([cell(NE)])).toHaveLength(BEND_ARC_SEGMENTS);
  });
});

describe('路燈', () => {
  it('should stand on the kerb of a straight road', () => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2 + SIDEWALK_WIDTH / 2;
    const lamps = buildLampPositions([cell(NS)]);
    expect(lamps.map(l => `${l.x.toFixed(3)},${l.z.toFixed(3)}`).sort())
      .toEqual([`${(-half).toFixed(3)},0.000`, `${half.toFixed(3)},0.000`].sort());
  });

  it('should follow the kerb round a bend', () => {
    // 原本是照直路的規則擺的:南邊界與西邊界的中點。那兩點離彎心 1.003，而路緣
    // 只到 0.87 —— 路燈整個站到草地上去了。
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const onKerb = 0.5 + half + SIDEWALK_WIDTH / 2;
    const c = turnCentre(NE);
    const lamps = buildLampPositions([cell(NE)]);
    expect(lamps).toHaveLength(2);
    for (const l of lamps) {
      expect(Math.hypot(l.x - c.cx, l.z - c.cz)).toBeCloseTo(onKerb, 9);
    }
  });

  it('should not put both bend lamps in the same place', () => {
    const lamps = buildLampPositions([cell(NE)]);
    expect(Math.hypot(lamps[0]!.x - lamps[1]!.x, lamps[0]!.z - lamps[1]!.z))
      .toBeGreaterThan(0.3);
  });

  it.each([[NE], [NW], [SE], [SW]])('should light the outside of every bend (%i)', (flags) => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(flags);
    for (const l of buildLampPositions([cell(flags)])) {
      expect(Math.hypot(l.x - c.cx, l.z - c.cz)).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH / 2, 9);
    }
  });

  it('should light only the sides with no road on them', () => {
    // 十字路口三面有路，只剩一面要燈。
    const lamps = buildLampPositions([cell(RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST)]);
    expect(lamps).toHaveLength(1);
    expect(lamps[0]!.x).toBeLessThan(0);
  });

  it('should carry the source cell so the renderer can track it', () => {
    for (const l of buildLampPositions([{ x: 4, y: 7, roadType: RoadType.TWO_LANE, roadFlags: NE }])) {
      expect(l.srcX).toBe(4);
      expect(l.srcY).toBe(7);
    }
  });
});

describe('彎道的路緣石看起來要跟直路一樣寬', () => {
  const TYPES = [RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE, RoadType.SIX_LANE,
    RoadType.HIGHWAY, RoadType.ONE_WAY];

  /** 直路上露在柏油外面的那一截路緣有多寬。 */
  function visibleOnStraight(type: number): number {
    const w = ROAD_WIDTHS[type]!;
    const strip = buildSidewalkStrips([cell(NS, type)]).find(s => s.x > 0)!;
    return strip.x + strip.sx / 2 - w / 2;
  }

  it.each(TYPES)('should bury half the kerb under the asphalt on a straight (%i)', (type) => {
    // 直路的路緣是**騎在柏油邊緣上**的:strip 的中心就在 ±路寬/2，內半條壓在路面
    // 底下（路緣的平面在 y=0.028，而路面那塊板子佔 0 到 0.05）。所以看得見的只有
    // 半條 —— 這是這一條測試存在的理由，彎道必須照著同一套來。
    expect(visibleOnStraight(type)).toBeCloseTo(SIDEWALK_WIDTH / 2, 9);
  });

  it.each(TYPES)('should show exactly as much kerb on a bend (%i)', (type) => {
    // 原本彎道的整條路緣都擺在柏油外面，於是露出 0.14 而直路只露 0.07 —— 正好兩倍，
    // 每一種路寬都一樣。
    const w = ROAD_WIDTHS[type]!;
    const asphaltEdge = 0.5 + w / 2;
    const c = turnCentre(NE);
    const want = visibleOnStraight(type);
    for (const s of buildSidewalkStrips([cell(NE, type)])) {
      const visible = Math.hypot(s.x - c.cx, s.z - c.cz) + s.sx / 2 - asphaltEdge;
      expect(visible, `路寬 ${w}:彎道露出 ${visible.toFixed(4)}，直路露出 ${want.toFixed(4)}`)
        .toBeCloseTo(want, 2);
    }
  });
});

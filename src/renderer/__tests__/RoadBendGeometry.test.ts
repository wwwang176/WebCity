import { describe, it, expect } from 'vitest';
import { RoadType, RoadDirection, ROAD_WIDTHS } from '../../core/road/types';
import { SIDEWALK_WIDTH } from '../../core/traffic/SidewalkGraph';
import {
  buildRoadStrips, buildSidewalkStrips, BEND_ARC_SEGMENTS,
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
    const mid = 0.5 + half + SIDEWALK_WIDTH / 2;
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
    expect(strips).toHaveLength(BEND_ARC_SEGMENTS);
    for (const s of strips) {
      // 外緣準確 —— 路緣的外側就是玩家看到的街廓邊界。
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH, 9);
      expect(s.sx).toBeGreaterThanOrEqual(SIDEWALK_WIDTH - 1e-9);
      expect(s.sx).toBeLessThan(SIDEWALK_WIDTH + 0.03);
    }
  });

  it('should sit on the outside, only just overlapping the asphalt', () => {
    // 內緣往內咬進柏油一點點是**故意的** —— 補內側的量往那裡塞，順便把兩條帶子
    // 之間可能殘留的接縫蓋掉。咬太深就變成路緣壓在車道上了。
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      const innerEdge = radius(s, c) - s.sx / 2;
      expect(innerEdge).toBeGreaterThan(0.5 + half - 0.02);
      expect(innerEdge).toBeLessThanOrEqual(0.5 + half + 1e-9);
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
    expect(strips).toHaveLength(BEND_ARC_SEGMENTS);
    for (const s of strips) {
      expect(radius(s, c) + s.sx / 2).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH, 9);
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

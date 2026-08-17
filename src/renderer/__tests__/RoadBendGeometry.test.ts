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

  it('should keep every piece the same distance from the centre of the turn', () => {
    // 半徑 0.5 —— 彎心在格子的角上，路心線就是那個四分之一圓。車道虛線用的
    // 也是這個半徑，所以線會落在柏油正中間。
    const c = turnCentre(NE);
    for (const s of buildRoadStrips([cell(NE)])) {
      expect(radius(s, c)).toBeCloseTo(0.5, 9);
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

  it('should leave no seams between the pieces', () => {
    // 段長要取切線長。取弦長的話每一段都只連到圓上的兩點，段與段之間留下一個
    // 楔形的空隙 —— 柏油上會出現一排規律的細縫，路緣上更明顯。
    const strips = buildRoadStrips([cell(NE)]);
    for (let k = 0; k < strips.length - 1; k++) {
      const a = strips[k]!, b = strips[k + 1]!;
      const endOf = (s: typeof a, sign: number) => ({
        x: s.x + sign * (s.sz / 2) * Math.sin(s.rotY),
        z: s.z + sign * (s.sz / 2) * Math.cos(s.rotY),
      });
      // 弧是往哪個方向長的無所謂，兩段共用的端點就是彼此最近的那一對。
      const gap = Math.min(...[1, -1].flatMap(sa => [1, -1].map(sb => {
        const p = endOf(a, sa), q = endOf(b, sb);
        return Math.hypot(p.x - q.x, p.z - q.z);
      })));
      expect(gap, `第 ${k} 段與第 ${k + 1} 段之間有縫`).toBeLessThan(1e-9);
    }
  });

  it('should carry the full road width across the turn', () => {
    for (const type of [RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE, RoadType.HIGHWAY]) {
      for (const s of buildRoadStrips([cell(NE, type)])) {
        expect(s.sx, `${type}`).toBeCloseTo(ROAD_WIDTHS[type]!, 9);
      }
    }
  });

  it.each([[NE], [NW], [SE], [SW]])('should turn around the right corner (%i)', (flags) => {
    const c = turnCentre(flags);
    for (const s of buildRoadStrips([cell(flags)])) {
      expect(radius(s, c)).toBeCloseTo(0.5, 9);
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
    const expected = 0.5 + half + SIDEWALK_WIDTH / 2;
    const c = turnCentre(NE);
    const strips = buildSidewalkStrips([cell(NE)]);
    expect(strips).toHaveLength(BEND_ARC_SEGMENTS);
    for (const s of strips) {
      expect(radius(s, c)).toBeCloseTo(expected, 9);
      expect(s.sx).toBeCloseTo(SIDEWALK_WIDTH, 9);
    }
  });

  it('should stay outside the asphalt', () => {
    const half = ROAD_WIDTHS[RoadType.TWO_LANE]! / 2;
    const c = turnCentre(NE);
    for (const s of buildSidewalkStrips([cell(NE)])) {
      expect(radius(s, c) - s.sx / 2).toBeGreaterThanOrEqual(0.5 + half - 1e-9);
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
      expect(radius(s, c)).toBeCloseTo(0.5 + half + SIDEWALK_WIDTH / 2, 9);
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

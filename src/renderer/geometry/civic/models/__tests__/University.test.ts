import { describe, it, expect } from 'vitest';
import { universityPlan } from '../schoolUniv';
import { FACADE_CIVIC, PART_LAMP, PART_ROOF } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicVolume } from '../../types';

const plan = universityPlan;
const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (tag: string) => plan.massing.filter(v => v.tag === tag);
const one = (tag: string) => tagged(tag)[0]!;

const x0 = (v: CivicVolume) => v.x - v.w / 2;
const x1 = (v: CivicVolume) => v.x + v.w / 2;
const z0 = (v: CivicVolume) => v.z - v.d / 2;
const z1 = (v: CivicVolume) => v.z + v.d / 2;

/**
 * 共通的驗收在 `CivicPlans.test.ts` 的資料表裡。這裡只寫大學獨有的形狀約束。
 *
 * 辨識特徵：**四面圍合的方庭**、圓頂主樓、鐘塔。方庭是最強的那一個 ——
 * 它是城市裡唯一一棟「中間是空的」建築。
 */
describe('大學', () => {
  const ranges = tagged('range');

  it('should occupy 3x3', () => {
    expect(plan.footprint).toEqual({ w: 3, h: 3 });
    expect(plan.facade).toBe(FACADE_CIVIC);
    expect(plan.color).toEqual(civicColorOf('school_univ'));
  });

  /**
   * 方庭要**四面都圍起來**。
   *
   * 三面圍合是 U 形，讀起來是「一棟有中庭的樓」而不是「一所大學」。用射線
   * 檢查：從方庭中心往四個方向走，每一個方向都要先撞到一棟樓。只數「有四棟
   * 樓」的話，四棟排成一列也會通過。
   */
  it('should enclose the quadrangle on all four sides', () => {
    expect(ranges.length, '不是四棟').toBe(4);
    const spansX = (v: CivicVolume) => x0(v) < 0 && x1(v) > 0;
    const spansZ = (v: CivicVolume) => z0(v) < 0 && z1(v) > 0;
    const sides: Array<[string, (v: CivicVolume) => boolean]> = [
      ['+x（東）', v => x0(v) > 0 && spansZ(v)],
      ['−x（西）', v => x1(v) < 0 && spansZ(v)],
      ['+z（南）', v => z0(v) > 0 && spansX(v)],
      ['−z（北）', v => z1(v) < 0 && spansX(v)],
    ];
    for (const [name, blocks] of sides) {
      expect(ranges.some(blocks), `方庭的 ${name} 面沒有圍起來`).toBe(true);
    }
  });

  it('should leave the quadrangle open to the sky', () => {
    // 中間也蓋滿的話那是一棟大樓，不是方庭。
    for (const v of plan.massing) {
      const covers = x0(v) < 0 && x1(v) > 0 && z0(v) < 0 && z1(v) > 0;
      expect(covers, `${v.tag} 蓋在方庭上`).toBe(false);
    }
  });

  it('should join the ranges at the corners', () => {
    // 四棟之間留縫的話，方庭會從角落漏出去 —— 圍合就白做了。
    //
    // 南北兩棟用**位置**認，不用「照 z 排序取頭尾」：東西兩棟的 z 都是
    // 中間值，排序後第二個是西棟而不是南棟 —— 這條測試第一次就是這樣
    // 誤判的，而它報的錯（「側翼沒有接到北棟」）指向完全無辜的地方。
    const north = ranges.find(v => z1(v) < 0)!;
    const south = ranges.find(v => z0(v) > 0)!;
    expect(north, '沒有北棟').toBeTruthy();
    expect(south, '沒有南棟').toBeTruthy();
    const sides = ranges.filter(v => v !== north && v !== south);
    expect(sides.length, '東西兩棟不是兩棟').toBe(2);
    for (const s of sides) {
      expect(z0(s), '側棟沒有接到北棟').toBeCloseTo(z1(north), 9);
      expect(z1(s), '側棟沒有接到南棟').toBeCloseTo(z0(south), 9);
    }
  });

  // ── 圓頂 ──────────────────────────────────────────────────

  it('should stack a dome out of shrinking drums', () => {
    const drums = tagged('dome');
    expect(drums.length, '圓頂不是疊起來的').toBeGreaterThanOrEqual(3);
    for (const d of drums) {
      expect(d.shape, '圓頂的一段不是圓的').toBe('cylinder');
      expect(d.part, '圓頂會長出窗戶 —— 它要走屋頂分支').toBe(PART_ROOF);
    }
    // 由下往上一段比一段窄，而且**站在**前一段上。
    const stack = [...drums].sort((a, b) => a.y0 - b.y0);
    for (let i = 1; i < stack.length; i++) {
      expect(stack[i]!.w, '圓頂上寬下窄了').toBeLessThan(stack[i - 1]!.w);
      expect(stack[i]!.y0, '圓頂的一段浮在半空')
        .toBeCloseTo(stack[i - 1]!.y1, 9);
    }
  });

  it('should centre the dome on the block it sits on', () => {
    // 偏一邊的圓頂讀起來像是後來加蓋的。
    const drums = tagged('dome');
    const host = ranges.find(r => z1(r) < 0)!;
    for (const d of drums) {
      expect(d.x, '圓頂沒有置中').toBeCloseTo(host.x, 9);
      expect(d.z, '圓頂沒有置中').toBeCloseTo(host.z, 9);
    }
  });

  it('should light the lantern at the top', () => {
    // 夜裡圓頂只剩一個發光的頂尖 —— 那是它唯一還看得見的部分。
    const finial = one('finial');
    expect(finial.part, '頂尖不會亮').toBe(PART_LAMP);
    expect(finial.y0, '頂尖沒有站在圓頂上')
      .toBeGreaterThanOrEqual(Math.max(...tagged('dome').map(d => d.y1)) - 1e-9);
  });

  // ── 鐘塔 ──────────────────────────────────────────────────

  it('should make the clock tower the tallest thing on site', () => {
    // 遠景時整所大學只剩鐘塔的剪影。被圓頂蓋過去就白做了。
    const cap = one('towerCap');
    expect(cap.y1, '鐘塔不是最高的').toBeCloseTo(topOf(plan.massing), 9);
    expect(cap.y1, '鐘塔沒有高過圓頂')
      .toBeGreaterThan(Math.max(...tagged('dome').map(d => d.y1)));
  });

  it('should show the clock on two opposite faces', () => {
    // 只有一面的鐘塔從另一邊看就只是一根柱子。
    const faces = tagged('clockFace');
    expect(faces.length, '鐘面不到兩面').toBeGreaterThanOrEqual(2);
    for (const f of faces) expect(f.part, '鐘面不會亮').toBe(PART_LAMP);
    const tower = one('tower');
    expect(faces.some(f => f.z > tower.z), '沒有朝南的鐘面').toBe(true);
    expect(faces.some(f => f.z < tower.z), '沒有朝北的鐘面').toBe(true);
  });

  it('should stand the tower on a range, not in the courtyard', () => {
    const tower = one('tower');
    const host = ranges.find(r =>
      x0(r) <= x0(tower) + 1e-9 && x1(r) >= x1(tower) - 1e-9
      && z0(r) <= z0(tower) + 1e-9 && z1(r) >= z1(tower) - 1e-9)!;
    expect(host, '鐘塔沒有站在任何一棟樓上').toBeTruthy();
  });

  it('should stay at a believable height for a university', () => {
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(24);
    expect(top).toBeLessThan(36);
  });

  // ── 方庭的地面 ────────────────────────────────────────────

  it('should lay grass and paths in the quadrangle', () => {
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    const inQuad = base.filter(d =>
      Math.abs(d.x) < 1 && Math.abs(d.z) < 1.2);
    expect(inQuad.some(d => d.lawn), '方庭沒有草地').toBe(true);
    expect(inQuad.some(d => !d.lawn), '方庭沒有路 —— 走過去要踩草坪').toBe(true);
  });

  it('should cross the paths at the centre', () => {
    // 兩條路不交會的話那不是方庭的十字路，是兩段各走各的。
    const paths = plan.decals.filter(d =>
      (d.layer ?? 'base') === 'base' && !d.lawn && Math.abs(d.z) < 1.2);
    expect(paths.some(d => Math.abs(d.x) < 1e-9 && d.d > d.w),
      '沒有一條南北向的路穿過中心').toBe(true);
  });

  it('should put a fountain where the paths meet', () => {
    // 方庭中央的水池是這一棟最便宜的「這裡是大學」訊號。
    const basin = plan.props.filter(v => v.tag === 'fountain');
    expect(basin.length, '方庭沒有水池').toBeGreaterThan(0);
    for (const v of basin) {
      expect(Math.hypot(v.x, v.z), '水池不在方庭中央').toBeLessThan(0.1);
      expect(v.shape, '水池不是圓的').toBe('cylinder');
    }
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'hedge', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
  });
});

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

  /**
   * 圓頂是**半球**，坐在一段鼓座上。
   *
   * 使用者：「圓頂我覺得要改一下，要看起來是半球形」。原本是一疊愈往上愈窄
   * 的八角柱 —— 遠景讀得出圓頂，走近是四層台階。
   *
   * 半球的高度必然是直徑的一半，所以鼓座不是裝飾：少了它，圓頂會扁到讀不出
   * 「這一棟有圓頂」。
   */
  it('should cap the dome with a hemisphere on a drum', () => {
    const dome = one('dome');
    const drum = one('domeDrum');
    expect(dome.shape, '圓頂不是半球').toBe('dome');
    expect(drum.shape, '鼓座不是圓的').toBe('cylinder');
    for (const v of [dome, drum]) {
      expect(v.part, '圓頂會長出窗戶 —— 它要走屋頂分支').toBe(PART_ROOF);
    }
    expect(dome.y0, '半球浮在鼓座上方').toBeCloseTo(drum.y1, 9);
    expect(dome.w, '半球與鼓座不同寬 —— 接縫會露出來').toBeCloseTo(drum.w, 9);
    expect(dome.w, '半球不是正圓').toBeCloseTo(dome.d, 9);
    // 半球的高度就是半徑。壓扁或拉長的話它不再是半球。
    expect(dome.y1 - dome.y0, '半球被壓扁或拉長了').toBeCloseTo(dome.w / 2, 6);
    // 而鼓座要有真正的高度 —— 一圈 0.2 m 的邊不算鼓座。
    expect(m(drum.y1 - drum.y0), '鼓座太矮，圓頂會扁得讀不出來').toBeGreaterThan(2);
  });

  it('should centre the dome on the block it sits on', () => {
    // 偏一邊的圓頂讀起來像是後來加蓋的。
    const host = ranges.find(r => z1(r) < 0)!;
    for (const d of [one('dome'), one('domeDrum')]) {
      expect(d.x, '圓頂沒有置中').toBeCloseTo(host.x, 9);
      expect(d.z, '圓頂沒有置中').toBeCloseTo(host.z, 9);
    }
    // 而且要整個落在那一棟上面 —— 伸出去的話它懸空。
    expect(one('dome').w / 2, '圓頂比它坐的那一棟還寬')
      .toBeLessThanOrEqual(host.d / 2 + 1e-9);
  });

  it('should light the lantern at the top', () => {
    // 夜裡圓頂只剩一個發光的頂尖 —— 那是它唯一還看得見的部分。
    const finial = one('finial');
    expect(finial.part, '頂尖不會亮').toBe(PART_LAMP);
    expect(finial.y0, '頂尖沒有站在圓頂上')
      .toBeGreaterThanOrEqual(Math.max(...tagged('dome').map(d => d.y1)) - 1e-9);
  });

  /**
   * 場上只有**一個**制高點。
   *
   * 使用者：「大學保留圓頂，移除另一個高塔」。原本圓頂在北棟、鐘塔在南棟，
   * 兩座 24 m 與 27 m 的東西隔著方庭對望 —— 遠景讀起來是兩棟不同的建築，
   * 而不是一所大學。
   */
  it('should raise the dome and nothing else', () => {
    const lantern = one('finial');
    expect(lantern.y1, '圓頂的頂尖不是全場最高的')
      .toBeCloseTo(topOf(plan.massing), 9);
    for (const v of plan.massing) {
      if (v.tag === 'finial' || v.tag === 'dome' || v.tag === 'domeDrum') continue;
      // 比的是鼓座的**頂**：屋頂上的空調機組與圓頂坐在同一片屋頂上，
      // 拿鼓座的底比的話它們會被判成「第二座塔」。
      expect(v.y1, `${v.tag} 高過圓頂 —— 場上不該有第二座塔`)
        .toBeLessThan(one('domeDrum').y1 + 1e-9);
    }
  });

  it('should stay at a believable height for a university', () => {
    // 拆掉 27 m 的鐘塔之後，最高點是圓頂的頂尖。下限跟著降到 20 m ——
    // 再低的話它在遠景與旁邊的高中分不出來（高中壓在 20 m 以下）。
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(20);
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

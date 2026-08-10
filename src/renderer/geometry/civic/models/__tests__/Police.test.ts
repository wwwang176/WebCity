import { describe, it, expect } from 'vitest';
import { policePlan } from '../police';
import { FACADE_CIVIC, PART_ROOF, PART_LAMP } from '../../../buildings/parts';
import { centroidOffset, overlapOf, topOf } from '../../../buildings/massing/volume';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';

const plan = policePlan;
const m = (cells: number) => cells * METRES_PER_CELL;

/**
 * 共通的驗收（佔地、預算、夜燈、貼地）在 `CivicPlans.test.ts` 的資料表裡，
 * 這裡只寫警局**獨有**的形狀約束 —— 那些是「它看起來還是不是警局」的實體。
 */
describe('警局', () => {
  it('should occupy 2x2', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 2 });
    expect(plan.facade).toBe(FACADE_CIVIC);
  });

  it('should keep the watch tower above both wings', () => {
    // 瞭望塔是警局的辨識特徵。被翼樓蓋過去就認不出來了。
    const tower = plan.massing.find(v => v.tag === 'tower')!;
    const wings = plan.massing.filter(v => v.tag === 'wing');
    expect(tower, '找不到瞭望塔').toBeTruthy();
    expect(wings.length, 'L 形要兩支翼').toBe(2);
    for (const w of wings) {
      expect(tower.y1, '塔沒有高過翼樓').toBeGreaterThan(w.y1);
    }
  });

  it('should be an L, not a box', () => {
    // 兩支翼一長一短是 L 形的實體。體積重心偏離包圍盒中心就是「不對稱」的
    // 可算出來的指標（`centroidOffset` 的註解說明了為什麼不用光柵差異）。
    expect(centroidOffset(plan.massing), '量體太對稱 —— 它是個盒子不是 L')
      .toBeGreaterThan(0.05);
  });

  it('should not bury one volume inside another', () => {
    // 重疊的量體會產生看不見的內部面 —— 白吃三角形，而且畫面上完全看不出來。
    //
    // 用立方公尺的容差而不是嚴格的 0：`M()` 是除以 12，所以「長翼的右緣」
    // （`M(-2) + M(14)/2`）與「短翼的左緣」（`M(8) − M(6)/2`）是同一個實數
    // 的兩個不同算式，浮點下相差約 1e-17。共邊本來就該是 0，但那個 0 在
    // 浮點裡拿不到。1 立方公厘不是「埋起來的面」。
    const TOLERANCE_M3 = 1e-6;
    for (let i = 0; i < plan.massing.length; i++) {
      for (let j = i + 1; j < plan.massing.length; j++) {
        const a = plan.massing[i]!;
        const b = plan.massing[j]!;
        const m3 = overlapOf(a, b) * METRES_PER_CELL ** 3;
        expect(m3, `${a.tag ?? i} 與 ${b.tag ?? j} 重疊 ${m3.toFixed(3)} m3`)
          .toBeLessThan(TOLERANCE_M3);
      }
    }
  });

  it('should stay at a believable height for a police station', () => {
    // 24 x 24 m 的基地上，塔太矮認不出是塔、太高就變成消防局的訓練塔。
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(14);
    expect(top).toBeLessThan(22);
  });

  it('should give the wings enough height for the lobby plus real floors', () => {
    // CIVIC 立面的門廳高度是 floorHeight * 1.35，窗格從它之上才開始。
    // 翼樓不夠高的話，整棟只有門廳、一扇窗都沒有。
    const wing = plan.massing.find(v => v.tag === 'wing')!;
    const floorH = 0.22 + plan.seed[0] * 0.08;   // shader 的 mix(MIN, MAX, aSeed.x)
    const windowed = wing.y1 - floorH * 1.35;
    expect(windowed / floorH, '門廳之上不到兩層 —— 窗格幾乎看不到')
      .toBeGreaterThan(2);
  });

  it('should cap the tower with a roof, not a wall', () => {
    // 少了的話塔頂會走 `n.y > 0.85` 的自動屋頂判定，拿到的是屋頂色票沒錯，
    // 但塔冠該比塔身寬一圈才看得出是「冠」。
    const cap = plan.massing.find(v => v.tag === 'cap')!;
    const tower = plan.massing.find(v => v.tag === 'tower')!;
    expect(cap.part).toBe(PART_ROOF);
    expect(cap.w, '塔冠沒有比塔身寬').toBeGreaterThan(tower.w);
  });

  it('should put the parking bay lines on the mark layer', () => {
    // 停車格線是標線，放進量體層就會長出牆與窗；放進底層貼片就會與柏油
    // z-fighting。
    const marks = plan.decals.filter(d => d.layer === 'mark');
    expect(marks.length, '沒有任何標線').toBeGreaterThan(0);
    for (const d of marks) {
      expect(d.shade, '標線不是白漆').toBeGreaterThan(0.7);
    }
  });

  it('should use real parking bay dimensions', () => {
    // 停車格線之間要放得下一台車。工業區的「停車格」在尺度上不成立
    // （TODO.md 記著），這裡不要重演。
    const stripes = plan.decals
      .filter(d => d.layer === 'mark' && d.w < d.d)
      .map(d => d.x)
      .sort((a, b) => a - b);
    expect(stripes.length, '找不到停車格分隔線').toBeGreaterThan(2);
    for (let i = 1; i < stripes.length; i++) {
      const gap = m(stripes[i]! - stripes[i - 1]!);
      expect(gap, `停車格只有 ${gap.toFixed(1)} m 寬`).toBeGreaterThan(2.3);
      expect(gap, `停車格寬到 ${gap.toFixed(1)} m`).toBeLessThan(3.5);
    }
    const depth = m(plan.decals.find(d => d.layer === 'mark' && d.w < d.d)!.d);
    expect(depth, `停車格只有 ${depth.toFixed(1)} m 深`).toBeGreaterThan(4.5);
  });

  it('should shelter the entrance with a canopy', () => {
    expect(plan.overhead.length, '門口沒有雨棚').toBeGreaterThan(0);
    // 雨棚要高過人頭。2.2 m 是行人淨空（`OVERHEAD_CLEARANCE`）。
    for (const v of plan.overhead) {
      expect(m(v.y0), '雨棚會打到人').toBeGreaterThan(2.2);
    }
  });

  it('should light both the entrance and the car park', () => {
    // 只有門口有燈的話，夜裡整片停車場是黑的 —— 而停車場佔了基地的一半。
    const street = plan.fixtures.filter(f => f.kind === 'lamp');
    const porch = plan.props.filter(v => v.part === PART_LAMP);
    expect(street.length, '停車場的路燈太少').toBeGreaterThanOrEqual(3);
    expect(porch.length, '門口沒有燈').toBeGreaterThan(0);
    const zs = [...street, ...porch].map(v => v.z);
    expect(Math.max(...zs) - Math.min(...zs), '所有的燈擠在同一條線上')
      .toBeGreaterThan(0.3);
  });

  /**
   * 使用者的要求：「花盆什麼的所有矮物件都可以做成共用?」
   *
   * 自己再畫一份的下場是同一座城市裡兩支長得不一樣的路燈，而且改一邊不會
   * 連動另一邊。所以凡是 `geometry/props` 有的東西，這裡不准用自訂量體重寫。
   */
  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
    // 自訂量體只剩下共用圖元裡真的沒有的東西。
    const custom = new Set(plan.props.map(v => v.tag));
    expect(custom, '自訂量體裡混進了共用圖元有的東西')
      .toEqual(new Set(['porchLamp', 'bench']));
  });

  /**
   * 使用者：「巡邏車看起來是一個方塊而已，是不是有車輛的物件可以參考?」
   *
   * 有。停著的警車與街上巡邏的警車必須是同一台 —— 兩者長得不一樣是最容易
   * 被看出來的不一致。
   */
  it('should park real police cars, not grey boxes', () => {
    expect(plan.vehicles.some(v => v.kind === 'policeCar'), '沒有警車').toBe(true);
    expect(plan.props.some(v => v.tag === 'car'), '還留著手畫的車')
      .toBe(false);
  });

  it('should point the parked cars down the bays', () => {
    // 停車格是沿 z 排的，車輛幾何原本車頭朝 +x —— 不轉的話車是橫著停的，
    // 而且會壓過兩三條分隔線。
    for (const v of plan.vehicles) {
      expect(v.rotationY, `${v.kind} 沒有轉向停車格`).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('should not tag the lamp posts as glowing', () => {
    // 整支標成發光的話，夜裡會看到一根從地上亮到頂的柱子（BUG-230 的教訓）。
    // 走共用的 `lamp` 之後這條由圖元本身保證 —— 這裡守的是「真的走了共用的」。
    expect(plan.fixtures.some(f => f.kind === 'lamp'), '路燈不是共用圖元')
      .toBe(true);
    for (const v of plan.props.filter(x => x.part === PART_LAMP)) {
      const h = (v.y1 - v.y0) * METRES_PER_CELL;
      expect(h, `自訂的發光體有 ${h.toFixed(1)} m 高 —— 那是燈桿不是燈頭`)
        .toBeLessThan(1.5);
    }
  });

  it('should pave the forecourt and the car park without overlapping them', () => {
    // 底層重疊會 z-fighting。`assembleDecals` 會擋，但這裡先講清楚意圖：
    // 前庭、停車場、草地是三塊**不重疊**的鋪面，共邊即可。
    const base = plan.decals.filter(d => (d.layer ?? 'base') === 'base');
    expect(base.length, '地面只有一塊 —— 前庭、停車場、草地應該分開').toBeGreaterThanOrEqual(3);
    expect(base.some(d => d.lawn), '沒有草地').toBe(true);
  });
});

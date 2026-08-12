import { describe, it, expect } from 'vitest';
import { hospitalPlan } from '../hospital';
import {
  FACADE_CIVIC, PART_GROUND, PART_LAMP, PART_ROOF,
} from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicVolume } from '../../types';

const plan = hospitalPlan;
const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (tag: string) => plan.massing.filter(v => v.tag === tag);
const one = (tag: string) => tagged(tag)[0]!;

/** 一塊量體的前緣／後緣（z 大的一側是前）。 */
const front = (v: CivicVolume) => v.z + v.d / 2;
const back = (v: CivicVolume) => v.z - v.d / 2;

/**
 * 共通的驗收在 `CivicPlans.test.ts` 的資料表裡。這裡只寫醫院獨有的形狀約束。
 *
 * 辨識特徵：主樓 + 兩側翼 + 連廊、**頂樓直升機坪**（H 標線與周邊燈）、
 * 急診雨棚。直升機坪是最強的那一個 —— 城市裡沒有第二種建築的屋頂上有它。
 */
describe('醫院', () => {
  it('should occupy 2x3', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 3 });
    expect(plan.facade).toBe(FACADE_CIVIC);
  });

  it('should be medical white', () => {
    expect(plan.color).toEqual(civicColorOf('hospital'));
    const [r, g, b] = plan.color;
    expect(Math.min(r, g, b), '主體不夠亮').toBeGreaterThan(0.8);
    expect(Math.max(r, g, b) - Math.min(r, g, b), '醫療白要中性，不能偏色')
      .toBeLessThan(0.06);
  });

  it('should stand the main block over the wings', () => {
    // 主樓要明顯高過側翼，否則整棟讀起來是一片相同高度的板樓。
    const main = one('main');
    const wings = tagged('wing');
    expect(wings.length, '側翼不是兩支').toBe(2);
    for (const w of wings) {
      expect(main.y1 / w.y1, '主樓沒有明顯高過側翼').toBeGreaterThan(1.5);
    }
  });

  it('should mirror the two wings about the centre line', () => {
    // 不對稱的兩翼讀起來是「加蓋的」。醫院是對稱的。
    const [a, b] = tagged('wing').sort((p, q) => p.x - q.x);
    expect(a!.x, '兩翼沒有對稱').toBeCloseTo(-b!.x, 9);
    expect(a!.w).toBeCloseTo(b!.w, 9);
    expect(a!.y1).toBeCloseTo(b!.y1, 9);
  });

  /**
   * 連廊要**真的接上**兩端。
   *
   * 差幾公分的話畫面上是一條浮在半空、兩頭都沒接的走廊 —— 而在資料表裡它
   * 完全合法（沒有越界、沒有重疊、沒有超支）。
   */
  it('should bridge the main block to the wings', () => {
    const link = one('corridor');
    const main = one('main');
    const wings = tagged('wing');
    expect(back(link), '連廊沒有接上主樓').toBeCloseTo(front(main), 9);
    for (const w of wings) {
      expect(front(link), '連廊沒有接上側翼').toBeCloseTo(back(w), 9);
    }
    // 而且它要真的落在兩翼之間的縫上。
    const [a, b] = wings.sort((p, q) => p.x - q.x);
    expect(link.x - link.w / 2).toBeGreaterThanOrEqual(a!.x - a!.w / 2 - 1e-9);
    expect(link.x + link.w / 2).toBeLessThanOrEqual(b!.x + b!.w / 2 + 1e-9);
  });

  it('should keep the corridor low so the wings still read as separate', () => {
    // 連廊與側翼一樣高的話，三塊量體會併成一個大方盒。
    const link = one('corridor');
    for (const w of tagged('wing')) {
      expect(link.y1, '連廊太高，兩翼併成一塊了').toBeLessThan(w.y1 * 0.65);
    }
  });

  // ── 直升機坪 ──────────────────────────────────────────────

  it('should put a helipad on the main roof', () => {
    const pad = one('helipad');
    const roof = one('mainRoof');
    expect(pad, '沒有直升機坪').toBeTruthy();
    expect(pad.part, '停機坪不是鋪面 —— 它會長出窗戶或吃到屋頂色票')
      .toBe(PART_GROUND);
    expect(pad.y0, '停機坪沒有站在屋頂上').toBeGreaterThanOrEqual(roof.y1 - 1e-9);
    // 停機坪不能懸空在屋頂邊界外。
    expect(pad.x - pad.w / 2).toBeGreaterThanOrEqual(roof.x - roof.w / 2 - 1e-9);
    expect(pad.x + pad.w / 2).toBeLessThanOrEqual(roof.x + roof.w / 2 + 1e-9);
  });

  it('should size the helipad for an actual helicopter', () => {
    // 直升機坪的最小邊長大約是旋翼直徑，中型救護直升機約 11 m。
    const pad = one('helipad');
    expect(m(Math.min(pad.w, pad.d)), '停機坪小到停不了直升機')
      .toBeGreaterThan(9);
  });

  it('should paint an H on the pad', () => {
    // H 是停機坪唯一的識別。少了它那只是屋頂上一塊深色的方形。
    const bars = tagged('helipadH');
    expect(bars.length, 'H 不是三劃').toBe(3);
    const pad = one('helipad');
    for (const bar of bars) {
      expect(bar.part, 'H 不是鋪面').toBe(PART_GROUND);
      expect(bar.shade ?? 0, 'H 沒有比甲板亮 —— 看不出來')
        .toBeGreaterThan((pad.shade ?? 0) + 0.4);
      expect(bar.y0, 'H 沒有畫在甲板上').toBeGreaterThanOrEqual(pad.y1 - 1e-9);
    }
  });

  it('should ring the pad with lights, not dot the middle of it', () => {
    // 停機坪的燈是沿邊排的。放在中間的話直升機會停在燈上。
    const lights = tagged('padLight');
    const pad = one('helipad');
    expect(lights.length, '停機坪周邊燈太少').toBeGreaterThanOrEqual(4);
    for (const l of lights) {
      expect(l.part, '停機坪的燈不會亮').toBe(PART_LAMP);
      const nx = Math.abs(l.x - pad.x) / (pad.w / 2);
      const nz = Math.abs(l.z - pad.z) / (pad.d / 2);
      expect(Math.max(nx, nz), '有一盞燈站在停機坪中間').toBeGreaterThan(0.6);
      expect(Math.max(nx, nz), '有一盞燈掉出停機坪外').toBeLessThanOrEqual(1);
    }
  });

  // ── 急診 ──────────────────────────────────────────────────

  it('should shelter the ambulance bay', () => {
    const canopy = plan.overhead.find(v => v.tag === 'erCanopy')!;
    expect(canopy, '急診沒有雨棚').toBeTruthy();
    // 救護車 3.7 x 1.5 x 1.6 m。雨棚遮不住一台車的話它只是裝飾。
    expect(m(canopy.d), '急診雨棚太淺').toBeGreaterThan(3.5);
    expect(m(canopy.w), '急診雨棚太窄').toBeGreaterThan(6);
  });

  it('should mark the emergency entrance with its own colour', () => {
    // 醫療白的箱子上找不到急診入口。那道紅色帶就是「往這裡走」。
    const band = one('erBand');
    expect(band.color, '急診帶沒有自己的顏色').toBeTruthy();
    const [r, g, b] = band.color!;
    expect(r, '急診帶不夠紅').toBeGreaterThan(0.5);
    expect(r).toBeGreaterThan(Math.max(g, b) * 1.5);
    expect(band.color).not.toEqual(plan.color);
  });

  it('should light a cross over the emergency entrance', () => {
    // 夜裡它是醫院唯一一眼認得出來的東西。
    const bars = tagged('cross');
    expect(bars.length, '十字不成形').toBeGreaterThanOrEqual(3);
    for (const bar of bars) expect(bar.part, '十字不會亮').toBe(PART_LAMP);
    // 十字要在急診帶那一側，不是在另一頭。
    const band = one('erBand');
    for (const bar of bars) {
      expect(Math.sign(bar.x), '十字掛在急診的另一邊').toBe(Math.sign(band.x));
    }
  });

  it('should park real ambulances at the bay', () => {
    const ambulances = plan.vehicles.filter(v => v.kind === 'ambulance');
    expect(ambulances.length, '急診門口沒有救護車').toBeGreaterThanOrEqual(2);
    // 救護車要停在急診那一側，不是在員工停車場。
    const band = one('erBand');
    for (const a of ambulances) {
      expect(Math.sign(a.x), '救護車停到大門那一側去了').toBe(Math.sign(band.x));
    }
  });

  /**
   * 每一塊量體都要有屋頂，而且是**白的**。
   *
   * 少一片屋頂的話那一塊會走 `n.y > 0.85` 的自動判定 —— 拿得到屋頂色票，
   * 但沒有屋簷，量體的邊緣是刀切的。
   *
   * 而「拿得到屋頂色票」正是「醫院不夠白」的來源：公家建築
   * 那組色票是深瀝青（最亮的一個也只有 0.38），所以一棟白牆的醫院從等角
   * 視角看下去是深灰的。醫院的屋頂走 `PART_GROUND` + 高明度，顏色由這一棟
   * 自己決定 —— 這條測的就是「沒有人把它改回共用色票」。
   */
  it('should cap every block with a white roof', () => {
    for (const tag of ['main', 'wing', 'corridor']) {
      expect(tagged(`${tag}Roof`).length, `${tag} 沒有屋頂`)
        .toBe(tagged(tag).length);
      for (const r of tagged(`${tag}Roof`)) {
        expect(r.part, `${tag}Roof 走回共用屋頂色票 —— 那組是深瀝青`)
          .toBe(PART_GROUND);
        expect(r.shade, `${tag}Roof 不夠白`).toBeGreaterThan(0.8);
      }
    }
    // 而且不准有任何一片真的 `PART_ROOF` 混進來 —— 一棟白醫院上有一片
    // 深灰的雨遮，那一片會變成整棟最顯眼的東西。
    for (const v of [...plan.massing, ...plan.props, ...plan.overhead]) {
      expect(v.part, `${v.tag} 是深色屋頂`).not.toBe(PART_ROOF);
    }
  });

  it('should stay at a believable height for a hospital', () => {
    const top = m(topOf(plan.massing));
    expect(top).toBeGreaterThan(22);
    expect(top).toBeLessThan(34);
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
    expect(new Set(plan.props.map(v => v.tag)), '自訂量體裡混進了共用圖元有的東西')
      .toEqual(new Set(['bayLamp']));
  });
});

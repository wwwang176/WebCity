import { describe, it, expect } from 'vitest';
import {
  airportSmallPlan, airportMediumPlan, airportLargePlan,
} from '../airport';
import { FACADE_TRANSIT, PART_LAMP } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';
import type { CivicPlan, CivicDecal } from '../../types';

const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (p: CivicPlan, tag: string) => p.massing.filter(v => v.tag === tag);
const marks = (p: CivicPlan) => p.decals.filter(d => d.layer === 'mark');
const bands = (p: CivicPlan) =>
  p.decals.filter(d => (d.layer ?? 'base') === 'base').sort((a, b) => a.z - b.z);

const PLANS = [
  ['小型機場', airportSmallPlan, 'airport_s', 5, 4],
  ['中型機場', airportMediumPlan, 'airport_m', 7, 4],
  ['大型機場', airportLargePlan, 'airport_l', 9, 6],
] as const;

/**
 * 三座機場。共通的驗收在 `CivicPlans.test.ts` 的資料表裡。
 *
 * 三座由同一個生成器產出，所以這裡測的多半是**生成器的不變量** ——
 * 那比逐座檢查更有價值：三份手寫的配置會有三種跑道標線的畫法、三種燈距、
 * 三種滑行道寬度，而它們並排時那些不一致比任何一座畫得不好都明顯。
 */
describe.each(PLANS)('%s', (_label, plan, type, w, h) => {
  it('should match its declared footprint', () => {
    expect(plan.footprint).toEqual({ w, h });
    expect(plan.facade).toBe(FACADE_TRANSIT);
    expect(plan.color).toEqual(civicColorOf(type));
  });

  /**
   * 五條帶要**首尾相接鋪滿整塊地**。
   *
   * 中間漏一條的話那裡是一塊裸地，而 `assembleDecals` 只擋重疊、不擋空隙 ——
   * 一座跑道與滑行道之間有一條 3 m 草溝的機場，在每一條既有的驗收裡都合法。
   */
  it('should tile the whole plot with paving, edge to edge', () => {
    const b = bands(plan);
    expect(b.length, '不是五條帶').toBe(5);
    expect(b[0]!.z - b[0]!.d / 2, '後緣沒有鋪到底')
      .toBeCloseTo(-plan.footprint.h / 2, 6);
    expect(b[4]!.z + b[4]!.d / 2, '前緣沒有鋪到底')
      .toBeCloseTo(plan.footprint.h / 2, 6);
    for (let i = 1; i < b.length; i++) {
      expect(b[i]!.z - b[i]!.d / 2, `第 ${i} 條帶與前一條之間有空隙`)
        .toBeCloseTo(b[i - 1]!.z + b[i - 1]!.d / 2, 9);
    }
    for (const d of b) {
      expect(d.w, '有一條帶沒有鋪滿整個寬度').toBeCloseTo(plan.footprint.w, 6);
      expect(d.lawn, '跑道上長草').toBeFalsy();
    }
  });

  it('should keep the runway and taxiway the same width on every size', () => {
    // 跑道寬度不隨機場大小變 —— 飛機的尺寸是一樣的。
    const [runway, taxiway] = bands(plan);
    expect(m(runway!.d)).toBeCloseTo(14, 6);
    expect(m(taxiway!.d)).toBeCloseTo(9, 6);
  });

  /**
   * 跑道畫**虛**線，滑行道畫**連續**線。
   *
   * 兩者用同一種線的話，跑道與滑行道就分不出來 —— 而它們是機場地面唯一
   * 兩種真正不同的東西。
   */
  it('should dash the runway centreline and draw the taxiway one solid', () => {
    const [runway, taxiway] = bands(plan);
    const onBand = (b: CivicDecal) => marks(plan).filter(d =>
      Math.abs(d.z - b.z) < b.d / 2 && d.w > d.d);
    const runwayCentre = onBand(runway!).filter(d =>
      Math.abs(d.z - runway!.z) < 0.02);
    expect(runwayCentre.length, '跑道中線不是虛線').toBeGreaterThan(4);
    for (const d of runwayCentre) {
      expect(d.w, '跑道中線畫成連續的了').toBeLessThan(plan.footprint.w / 2);
    }
    const taxiCentre = onBand(taxiway!).filter(d =>
      Math.abs(d.z - taxiway!.z) < 0.02);
    expect(taxiCentre.length, '滑行道中線不只一條 —— 它該是連續的').toBe(1);
    expect(taxiCentre[0]!.w, '滑行道中線沒有貫穿整條')
      .toBeGreaterThan(plan.footprint.w * 0.8);
  });

  it('should hold aircraft short of the runway', () => {
    // 等待線是滑行道語彙裡唯一「有規則意義」的標記。
    const [runway, taxiway] = bands(plan);
    const holdZ = runway!.z + runway!.d / 2;
    const hold = marks(plan).find(d =>
      d.w > plan.footprint.w * 0.8 && Math.abs(d.z - holdZ) < 0.2
      && Math.abs(d.z - taxiway!.z) < taxiway!.d / 2);
    expect(hold, '滑行道上沒有等待線').toBeTruthy();
  });

  it('should angle the runway entries', () => {
    // 直角接上跑道的滑行道飛機轉不進去。轉向的標線就是為了這個。
    const angled = marks(plan).filter(d => (d.rotationY ?? 0) !== 0);
    expect(angled.length, '沒有斜的引道標線').toBeGreaterThanOrEqual(2);
  });

  it('should mark thresholds at both ends of the runway', () => {
    const [runway] = bands(plan);
    const onRunway = marks(plan).filter(d => Math.abs(d.z - runway!.z) < runway!.d / 2);
    expect(onRunway.some(d => d.x < -plan.footprint.w * 0.3), '缺一端的頭端標線')
      .toBe(true);
    expect(onRunway.some(d => d.x > plan.footprint.w * 0.3), '缺一端的頭端標線')
      .toBe(true);
  });

  // ── 夜間語彙 ──────────────────────────────────────────────

  /**
   * 一座夜裡的機場**就是**一組排好的燈。
   *
   * 三種燈缺任何一種，夜景就少掉一整條線：跑道兩側的邊燈、兩端的頭端燈、
   * 滑行道的中線燈。
   */
  it('should light the runway, the thresholds and the taxiway', () => {
    for (const tag of ['runwayLight', 'thresholdLight', 'taxiwayLight']) {
      const lights = tagged(plan, tag);
      expect(lights.length, `${tag} 一顆都沒有`).toBeGreaterThanOrEqual(4);
      for (const l of lights) expect(l.part, `${tag} 不會亮`).toBe(PART_LAMP);
    }
  });

  it('should put the runway edge lights on both edges, not just one', () => {
    // 只有一側的話夜裡看到的是一條線，不是一條跑道。
    const [runway] = bands(plan);
    const lights = tagged(plan, 'runwayLight');
    expect(lights.some(l => l.z < runway!.z), '跑道後側沒有邊燈').toBe(true);
    expect(lights.some(l => l.z > runway!.z), '跑道前側沒有邊燈').toBe(true);
  });

  it('should space the runway lights evenly', () => {
    // 不等距的跑道燈讀起來是壞掉的燈。
    const [runway] = bands(plan);
    const row = tagged(plan, 'runwayLight')
      .filter(l => l.z < runway!.z).map(l => l.x).sort((a, b) => a - b);
    const gaps = row.slice(1).map((x, i) => x - row[i]!);
    for (const g of gaps) {
      expect(m(g), `燈距不齊：${m(g).toFixed(2)} m`).toBeCloseTo(m(gaps[0]!), 6);
    }
  });

  it('should keep every light small enough to be a light', () => {
    // 0.4 m 的方塊是一顆燈；1.5 m 的是一根發光的柱子（BUG-230 的教訓）。
    for (const v of plan.massing.filter(v => v.part === PART_LAMP)) {
      if (v.tag === 'beacon') continue;
      expect(m(v.y1 - v.y0), `${v.tag} 太大了`).toBeLessThan(1.0);
    }
  });

  // ── 塔台與航廈 ────────────────────────────────────────────

  it('should make the control tower the tallest thing on the field', () => {
    const cab = tagged(plan, 'towerCab')[0]!;
    const beacon = tagged(plan, 'beacon')[0]!;
    const terminal = tagged(plan, 'terminal')[0]!;
    expect(cab.y1, '塔台沒有高過航廈').toBeGreaterThan(terminal.y1);
    expect(beacon.y1, '信標不是全場最高的').toBeCloseTo(topOf(plan.massing), 9);
    expect(beacon.part).toBe(PART_LAMP);
    expect(cab.w, '塔台頂樓沒有外挑 —— 那是一根柱子不是塔台')
      .toBeGreaterThan(tagged(plan, 'tower')[0]!.w);
  });

  // ── 停機坪 ────────────────────────────────────────────────

  it('should park a real aeroplane on every stand', () => {
    const planes = plan.vehicles.filter(v => v.kind === 'airplane');
    expect(planes.length, '機位上沒有飛機').toBeGreaterThanOrEqual(2);
    // 機頭朝航廈 —— 不轉的話它們橫著停，而且會壓過整條導引線。
    for (const p of planes) {
      expect(p.rotationY, '飛機沒有轉向機位').toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('should fit the aeroplanes inside the apron band', () => {
    // 飛機 11.7 × 10.8 m。停機坪比它淺的話，飛機會壓在滑行道與航廈上。
    const apron = bands(plan)[2]!;
    expect(m(apron.d), '停機坪太淺，放不下一架飛機').toBeGreaterThan(11.5);
    for (const p of plan.vehicles.filter(v => v.kind === 'airplane')) {
      expect(Math.abs(p.z - apron.z), '飛機沒有停在停機坪上')
        .toBeLessThan(apron.d / 2);
    }
  });

  it('should bridge every stand to the terminal', () => {
    const bridges = plan.overhead.filter(v => v.tag === 'jetBridge');
    const planes = plan.vehicles.filter(v => v.kind === 'airplane');
    expect(bridges.length, '空橋數與機位數對不上').toBe(planes.length);
    for (const b of bridges) {
      expect(planes.some(p => Math.abs(p.x - b.x) < 1e-9),
        '有一條空橋沒有對到機位').toBe(true);
    }
  });

  it('should fence the field', () => {
    expect(plan.fixtures.filter(f => f.kind === 'fence').length, '機場沒有圍籬')
      .toBeGreaterThanOrEqual(3);
  });
});

/**
 * 三座之間的關係。
 *
 * 它們是同一種建築的三個尺寸，所以「大的要更大」是唯一有意義的比較 ——
 * 而那件事**必須**測，因為三座是同一個生成器產的，參數填錯不會有任何徵兆。
 */
describe('三座機場之間', () => {
  it('should grow the stands, the tower and the plot together', () => {
    const sizes = PLANS.map(([, p]) => ({
      cells: p.footprint.w * p.footprint.h,
      stands: p.vehicles.filter(v => v.kind === 'airplane').length,
      tower: topOf(p.massing),
    }));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!.cells, '佔地沒有變大').toBeGreaterThan(sizes[i - 1]!.cells);
      expect(sizes[i]!.stands, '機位沒有變多').toBeGreaterThan(sizes[i - 1]!.stands);
      expect(sizes[i]!.tower, '塔台沒有變高').toBeGreaterThan(sizes[i - 1]!.tower);
    }
  });

  it('should share one runway vocabulary across all three', () => {
    // 三座由同一個生成器產出。跑道寬度、燈距、標線畫法必須一致 ——
    // 各寫一份的話它們並排時的不一致比任何一座畫得不好都明顯。
    const spacing = PLANS.map(([, p]) => {
      const [runway] = bands(p);
      const row = tagged(p, 'runwayLight')
        .filter(l => l.z < runway!.z).map(l => l.x).sort((a, b) => a - b);
      return Math.round(m(row[1]! - row[0]!) * 100) / 100;
    });
    expect(new Set(spacing).size, `三座的跑道燈距不同：${spacing}`).toBe(1);
  });
});

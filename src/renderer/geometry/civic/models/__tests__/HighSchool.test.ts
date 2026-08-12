import { describe, it, expect } from 'vitest';
import { highSchoolPlan, TRACK } from '../schoolHigh';
import { FACADE_CIVIC, PART_ROOF } from '../../../buildings/parts';
import { topOf } from '../../../buildings/massing/volume';
import { civicColorOf } from '../../colors';
import { METRES_PER_CELL } from '../../../../../core/grid/constants';

const plan = highSchoolPlan;
const m = (cells: number) => cells * METRES_PER_CELL;
const tagged = (tag: string) => plan.massing.filter(v => v.tag === tag);
const one = (tag: string) => tagged(tag)[0]!;
const marks = plan.decals.filter(d => d.layer === 'mark');

/**
 * 共通的驗收在 `CivicPlans.test.ts` 的資料表裡。這裡只寫高中獨有的形狀約束。
 *
 * 辨識特徵：三層教室樓、**橢圓跑道**、司令台。跑道是最強的那一個 ——
 * 城市裡沒有第二種建築的地上有一圈封閉的橢圓。
 */
describe('高中', () => {
  it('should occupy 2x3', () => {
    expect(plan.footprint).toEqual({ w: 2, h: 3 });
    expect(plan.facade).toBe(FACADE_CIVIC);
    expect(plan.color).toEqual(civicColorOf('school_high'));
  });

  it('should stand three storeys, taller than an elementary school', () => {
    // 小學壓在 12 m 以下（`School.test.ts` 釘住的）。高中要明顯高過它，
    // 否則兩者在遠景是同一棟建築。
    const top = m(topOf(plan.massing));
    expect(top, '高中不比小學高').toBeGreaterThan(13);
    expect(top).toBeLessThan(20);
  });

  it('should roof every block it builds', () => {
    for (const tag of ['main', 'annex']) {
      expect(tagged(`${tag}Roof`).length, `${tag} 沒有屋頂`).toBe(tagged(tag).length);
      for (const r of tagged(`${tag}Roof`)) expect(r.part).toBe(PART_ROOF);
    }
  });

  // ── 跑道 ──────────────────────────────────────────────────

  it('should draw the track as a closed loop', () => {
    // 一串沒有接起來的短線是虛線，不是跑道。逐段檢查「這一段的尾端接不接得上
    // 下一段的開頭」—— 只看「有很多段標線」的話，一堆散落的線也會通過。
    const lanes = TRACK.lanes;
    expect(lanes.length, '跑道不只一條線').toBeGreaterThanOrEqual(2);
    for (const lane of lanes) {
      expect(lane.length, '這一圈的段數太少，橢圓會變成多邊形')
        .toBeGreaterThanOrEqual(16);
      for (let i = 0; i < lane.length; i++) {
        const a = lane[i]!;
        const b = lane[(i + 1) % lane.length]!;
        // 一段的末端 = 中心 + 半長 × 方向。方向由 rotationY 決定。
        const end = (s: typeof a, sign: number) => ({
          x: s.x + sign * (s.w / 2) * Math.cos(s.rotationY),
          z: s.z - sign * (s.w / 2) * Math.sin(s.rotationY),
        });
        const tail = end(a, 1);
        const head = end(b, -1);
        const gap = Math.hypot(tail.x - head.x, tail.z - head.z);
        expect(m(gap), `第 ${i} 段與下一段之間斷了 ${m(gap).toFixed(2)} m`)
          .toBeLessThan(0.35);
      }
    }
  });

  /**
   * 圓角矩形，不是橢圓。
   *
   * 操場是圓角矩形，不是橢圓。真實的操場是**四段直道**
   * 加四個轉彎；橢圓沒有任何一段是直的，跑起來像一個蛋。
   *
   * 測「有沒有直道」而不是「像不像矩形」：直道的實體就是「好幾段連續的線
   * 方向完全相同」，而那正是橢圓做不到的事。
   */
  it('should have four straights, not be one endless curve', () => {
    const outer = TRACK.lanes[0]!;
    const dirs = outer.map(s => s.rotationY);
    /** 這個方向上有幾段完全同向。 */
    const runOf = (want: number) =>
      dirs.filter(d => Math.abs(Math.atan2(Math.sin(d - want), Math.cos(d - want)))
        < 1e-6).length;
    for (const [name, want] of [
      ['+x', 0], ['−x', Math.PI], ['+z', -Math.PI / 2], ['−z', Math.PI / 2],
    ] as const) {
      expect(runOf(want), `${name} 方向沒有直道 —— 這是橢圓不是圓角矩形`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it('should round the corners rather than square them off', () => {
    // 直角的操場跑不了 —— 而且那是球場不是跑道。
    expect(TRACK.r, '轉角半徑是 0，那是一個方框').toBeGreaterThan(0);
    expect(TRACK.r, '轉角半徑等於半寬，那又變回橢圓了').toBeLessThan(TRACK.b);
    const outer = TRACK.lanes[0]!;
    const curved = outer.filter(s =>
      Math.min(...[0, Math.PI, Math.PI / 2, -Math.PI / 2].map(w =>
        Math.abs(Math.atan2(Math.sin(s.rotationY - w), Math.cos(s.rotationY - w)))))
      > 1e-6);
    expect(curved.length, '沒有任何一段是彎的').toBeGreaterThanOrEqual(8);
  });

  it('should be longer than it is wide', () => {
    const outer = TRACK.lanes[0]!;
    const xs = outer.map(s => s.x);
    const zs = outer.map(s => s.z);
    const a = (Math.max(...xs) - Math.min(...xs)) / 2;
    const b = (Math.max(...zs) - Math.min(...zs)) / 2;
    expect(a / b, '跑道太方了').toBeGreaterThan(1.15);
    expect(m(b), '跑道太窄，跑不起來').toBeGreaterThan(5);
  });

  it('should nest the lanes without crossing them', () => {
    // 兩條車道線交叉的話那不是跑道，是一團線。
    //
    // 比的是**到外框的距離**（逐軸），不是到中心的直線距離：圓角矩形上
    // 「離中心最遠」的點在角上、「最近」的點在直道中央，所以內圈直道上的點
    // 比外圈轉角上的點更靠近中心 —— 用直線距離比，一條正確的內圈會被判成
    // 「跑到外面去了」。
    const [outer, inner] = TRACK.lanes;
    for (const s of inner!) {
      expect(Math.abs(s.x - TRACK.x), '內圈在 x 方向跑到外圈外面')
        .toBeLessThanOrEqual(TRACK.a - TRACK.lane + 1e-9);
      expect(Math.abs(s.z - TRACK.z), '內圈在 z 方向跑到外圈外面')
        .toBeLessThanOrEqual(TRACK.b - TRACK.lane + 1e-9);
    }
    // 而外圈真的要摸到宣告的外框，否則「內圈比較小」是廢話。
    expect(Math.max(...outer!.map(s => Math.abs(s.x - TRACK.x))))
      .toBeCloseTo(TRACK.a, 6);
  });

  it('should keep the whole track on the grass', () => {
    // 跑道畫到看台上或畫出基地是最沒有說服力的一件事。
    const field = plan.decals.find(d => d.lawn)!;
    expect(field, '沒有運動場').toBeTruthy();
    for (const s of TRACK.lanes.flat()) {
      expect(Math.abs(s.x - field.x), '跑道畫到草地外面').toBeLessThan(field.w / 2);
      expect(Math.abs(s.z - field.z), '跑道畫到草地外面').toBeLessThan(field.d / 2);
    }
  });

  it('should turn every track segment', () => {
    // 一整圈全部是軸對齊的短線的話，那是一個方框不是橢圓。
    const turned = marks.filter(d => (d.rotationY ?? 0) !== 0);
    expect(turned.length, '跑道沒有任何一段轉向').toBeGreaterThanOrEqual(16);
  });

  // ── 司令台 ────────────────────────────────────────────────

  it('should raise the podium above the field', () => {
    // 司令台是「站上去講話的地方」。與地面齊平的話它只是一塊鋪面。
    const podium = one('podium');
    expect(podium, '沒有司令台').toBeTruthy();
    const h = m(podium.y1 - podium.y0);
    expect(h, `司令台只有 ${h.toFixed(1)} m 高`).toBeGreaterThan(0.8);
    expect(h, '司令台高到變成一棟樓').toBeLessThan(2.2);
  });

  it('should face the podium onto the field', () => {
    // 背對操場的司令台是笑話。它要在教室樓與跑道之間。
    const podium = one('podium');
    const main = one('main');
    expect(podium.z, '司令台跑到教室樓後面去了').toBeGreaterThan(main.z);
    expect(podium.z, '司令台站到跑道上去了').toBeLessThan(TRACK.z);
  });

  it('should roof the podium on posts, not on walls', () => {
    // 司令台的頂棚要架在柱子上 —— 四面牆的話那是一間房，不是司令台。
    const posts = plan.props.filter(v => v.tag === 'podiumPost');
    expect(posts.length, '司令台的頂棚沒有柱子').toBe(4);
    const canopy = plan.overhead.find(v => v.tag === 'podiumRoof')!;
    expect(canopy, '司令台沒有頂棚').toBeTruthy();
    for (const p of posts) {
      expect(p.y1, '柱子沒有頂到頂棚').toBeCloseTo(canopy.y0, 6);
      expect(Math.abs(p.x - canopy.x), '柱子站到頂棚外面')
        .toBeLessThanOrEqual(canopy.w / 2 + 1e-9);
    }
  });

  it('should use the shared primitives instead of re-drawing them', () => {
    for (const kind of ['tree', 'shrub', 'flowerBed', 'lamp', 'flagpole'] as const) {
      expect(plan.fixtures.some(f => f.kind === kind), `${kind} 沒有走共用圖元`)
        .toBe(true);
    }
  });

  it('should keep the fixtures off the running surface', () => {
    // 種在跑道上的樹跟種在消防車道上的樹是同一個笑話。
    // 圓角矩形的外框是逐軸的：只要有一軸在框外就安全。
    for (const f of plan.fixtures) {
      const outside = Math.abs(f.x - TRACK.x) > TRACK.a
        || Math.abs(f.z - TRACK.z) > TRACK.b;
      expect(outside, `${f.kind} 站在跑道圈裡`).toBe(true);
    }
  });
});

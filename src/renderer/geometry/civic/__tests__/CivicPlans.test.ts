import { describe, it, expect } from 'vitest';
import { getCivicPlan, civicTypesDone } from '../registry';
import {
  assembleCivic, assembleDecals, assembleFixtures, assembleVehicles,
} from '../assemble';
import { overlapOf } from '../../buildings/massing/volume';
import { CIVIC_TRIANGLE_BUDGET } from '../types';
import { getInfraConfig } from '../../../../core/building/InfraConfig';
import { PART_THRESHOLDS, triangleCount, ZONE_CAT } from '../../buildings/parts';
import { METRES_PER_CELL } from '../../../../core/grid/constants';
import type { Volume } from '../../buildings/massing/volume';

const isLamp = (p: number) =>
  p > PART_THRESHOLDS.LAMP_MIN && p < PART_THRESHOLDS.FOLIAGE_MIN;

const partOf = (v: Volume) => v.part ?? 0;

/**
 * 這一條守的是「資料表測試在空表上是綠的」。
 *
 * `describe.each([])` 會整組**跳過**，不是失敗 —— 所以下面所有的驗收在還沒
 * 有任何 plan 的時候都不會跑，而測試報告看起來一切正常。
 *
 * 批 1 之前它本來就該是紅的（那是 TDD 的紅），批 1 之後它守著「不要不小心
 * 把整張表清空」。
 */
describe('公共建築的資料表驗收', () => {
  it('should have at least one plan registered', () => {
    expect(
      civicTypesDone().length,
      '沒有任何 plan —— 下面所有的資料表測試都被跳過了，而報告看起來是綠的',
    ).toBeGreaterThan(0);
  });
});

describe.each(civicTypesDone())('%s 的 plan', (type) => {
  const plan = getCivicPlan(type)!;
  const cfg = getInfraConfig(type)!;
  const cells = cfg.width * cfg.height;
  const all = [...plan.massing, ...plan.props, ...plan.overhead];

  it('should match the footprint declared in InfraConfig', () => {
    // 對不上就是幾何與遊戲規則各說各話 —— 建築不是壓到鄰格，就是縮在角落。
    expect(plan.footprint).toEqual({ w: cfg.width, h: cfg.height });
  });

  it('should have a facade category the shader knows', () => {
    expect(plan.facade, `${type} 的 facade 不是 FACADE_* 常數`).toBeGreaterThan(100);
    expect(ZONE_CAT[plan.facade], `facade ${plan.facade} 不在 ZONE_CAT 裡`).toBeDefined();
  });

  it('should build every layer without leaving the footprint', () => {
    // 六層全部要列。漏掉哪一層，那一層的越界就沒有人擋 —— 車輛就漏過一次：
    // 一台停在邊界上的消防車有 6.7 m 長，轉了 90 度之後伸出去半格是很容易
    // 寫出來的錯，而畫面上它只是「有點壓到隔壁」。
    expect(() => assembleCivic(plan.massing, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleCivic(plan.props, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleCivic(plan.overhead, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleDecals(plan.decals, plan.footprint)).not.toThrow();
    expect(() => assembleFixtures(plan.fixtures, plan.footprint)).not.toThrow();
    expect(() => assembleVehicles(plan.vehicles, plan.footprint)).not.toThrow();
  });

  it('should not bury one massing volume inside another', () => {
    // 重疊的量體會產生看不見的內部面 —— 白吃三角形，而且畫面上完全看不出來。
    //
    // 用立方公尺的容差而不是嚴格的 0：`M()` 是除以 12，所以「這一塊的右緣」
    // 與「下一塊的左緣」是同一個實數的兩個不同算式，浮點下相差約 1e-17。
    // 共邊本來就該是 0，但那個 0 在浮點裡拿不到。1 立方公厘不是「埋起來」。
    for (let i = 0; i < plan.massing.length; i++) {
      for (let j = i + 1; j < plan.massing.length; j++) {
        const a = plan.massing[i]!;
        const b = plan.massing[j]!;
        const m3 = overlapOf(a, b) * METRES_PER_CELL ** 3;
        expect(m3, `${type}：${a.tag ?? i} 與 ${b.tag ?? j} 重疊 ${m3.toFixed(3)} m3`)
          .toBeLessThan(1e-6);
      }
    }
  });

  /**
   * 車要停在鋪面上。
   *
   * 停在草地上的車是一眼就看得到的錯，而它在其他每一條驗收裡都合法：沒有
   * 越界、沒有重疊、沒有超支。用**旋轉之後**的實際幾何算中心 —— 手寫一份
   * 車輛尺寸表的話，哪天有人把消防車改長，這條檢查會繼續拿舊的數字算。
   *
   * 檢查中心而不是整台車：一顆輪子壓到鋪面邊緣是正常的，車**停在**草地上
   * 才是錯的。
   */
  it('should park every vehicle on something paved', () => {
    const hard = plan.decals.filter(d => (d.layer ?? 'base') === 'base' && !d.lawn);
    for (const v of plan.vehicles) {
      const geo = assembleVehicles([v], plan.footprint);
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const on = hard.some(d =>
        Math.abs(cx - d.x) <= d.w / 2 + 1e-9 && Math.abs(cz - d.z) <= d.d / 2 + 1e-9);
      expect(on, `${type} 的 ${v.kind} 停在草地上（或根本沒有鋪面）`).toBe(true);
    }
  });

  it('should not paint a marking in grass', () => {
    // `lawn` 走的是 `PART_FOLIAGE` 分支 —— 它整個不看 `shade`。所以一條標成
    // `lawn` 的標線是**綠色的**，而 `shade: 1.0`（白漆）還好端端寫在那裡。
    // 兩個欄位互相矛盾而沒有人報錯，是這個資料結構最安靜的失敗方式。
    for (const d of plan.decals.filter(x => x.layer === 'mark')) {
      expect(d.lawn, `${type} 有一條長在草裡的標線 —— 它會是綠的`).toBeFalsy();
    }
  });

  it('should keep the overhead layer above head height', () => {
    // 雨棚、月台頂、招牌都住在這一層，而它們全部要高過行人。2.2 m 是
    // `OVERHEAD_CLEARANCE`。低於它的東西在等角視角下看起來沒事，走近才發現
    // 它切過人的頭。
    for (const v of plan.overhead) {
      const h = v.y0 * METRES_PER_CELL;
      expect(h, `${type} 的 ${v.tag ?? '懸挑'} 只有 ${h.toFixed(1)} m 高 —— 會打到人`)
        .toBeGreaterThan(2.2);
    }
  });

  /** 這一條就是 BUG-238 本身 —— 做完了夜裡還是全黑的話它要轉紅。 */
  it('should light something at night', () => {
    // 兩個來源都要看：自訂量體標 PART_LAMP 的，以及共用圖元裡的路燈
    // （`geometry/props` 的 `lamp`，它的燈頭本來就是 PART_LAMP）。
    // 只看其中一邊的話，一棟全部改用共用路燈的建築會被誤判成「沒有燈」。
    const custom = all.filter(v => isLamp(partOf(v))).length;
    const shared = plan.fixtures.filter(f => f.kind === 'lamp').length;
    expect(custom + shared, `${type} 一盞燈都沒有 —— 夜裡它會是一塊黑`)
      .toBeGreaterThan(0);
  });

  it('should not tag a whole lamp post as glowing', () => {
    // 整支標成發光的話，夜裡會看到一根從地上亮到頂的柱子（BUG-230 的教訓）。
    // 燈頭是 PART_LAMP，燈桿是 PART_DETAIL。
    for (const v of all.filter(x => isLamp(partOf(x)))) {
      const h = (v.y1 - v.y0) * METRES_PER_CELL;
      expect(h, `${type} 有一個 ${h.toFixed(1)} m 高的發光體 —— 那是燈桿不是燈頭`)
        .toBeLessThan(1.5);
    }
  });

  it('should sit on the ground', () => {
    // 最低的量體要貼地。整棟浮空 0.6 m 是 BUG-224 的形狀，而它在等角視角下
    // 只表現為「陰影怪怪的」。
    const lowest = Math.min(...plan.massing.map(v => v.y0));
    expect(lowest, `${type} 的量體整批離地`).toBeLessThanOrEqual(1e-6);
  });

  it('should stay inside the per-cell triangle budget', () => {
    const layers: Array<[string, number, number]> = [
      ['量體', triangleCount(assembleCivic(plan.massing, plan.footprint, plan.color)),
        CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * cells],
      ['貼片', triangleCount(assembleDecals(plan.decals, plan.footprint)),
        CIVIC_TRIANGLE_BUDGET.DECAL_PER_CELL * cells],
      ['矮物件', triangleCount(assembleCivic(plan.props, plan.footprint, plan.color))
        + triangleCount(assembleFixtures(plan.fixtures, plan.footprint)),
        CIVIC_TRIANGLE_BUDGET.PROP_PER_CELL * cells],
      ['懸挑', triangleCount(assembleCivic(plan.overhead, plan.footprint, plan.color)),
        CIVIC_TRIANGLE_BUDGET.OVERHEAD_PER_CELL * cells],
    ];
    for (const [name, tris, budget] of layers) {
      expect(tris, `${type} 的${name}超支：${tris} > ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('should give the shader a usable seed', () => {
    // aSeed.x 是樓層節奏，shader 端是 mix(MIN, MAX, aSeed.x) —— 超出 [0,1]
    // 會外插出不存在的樓高，而立面窗格與量體的樓板線就對不上了。
    for (const [i, s] of plan.seed.entries()) {
      expect(s, `${type} 的 seed[${i}] 不在 [0,1]`).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

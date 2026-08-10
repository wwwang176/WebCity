import { describe, it, expect } from 'vitest';
import { getCivicPlan, civicTypesDone } from '../registry';
import { assembleCivic, assembleDecals } from '../assemble';
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
    expect(() => assembleCivic(plan.massing, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleCivic(plan.props, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleCivic(plan.overhead, plan.footprint, plan.color)).not.toThrow();
    expect(() => assembleDecals(plan.decals, plan.footprint)).not.toThrow();
  });

  /** 這一條就是 BUG-238 本身 —— 做完了夜裡還是全黑的話它要轉紅。 */
  it('should light something at night', () => {
    const lamps = all.filter(v => isLamp(partOf(v)));
    expect(lamps.length, `${type} 一盞燈都沒有 —— 夜裡它會是一塊黑`)
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
      ['矮物件', triangleCount(assembleCivic(plan.props, plan.footprint, plan.color)),
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

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { civicTriangleReport, civicOptions, placeCivic } from '../civic';
import { CIVIC_TRIANGLE_BUDGET } from '../../renderer/geometry/civic/types';
import {
  registerCivicPlan, resetCivicPlans, getCivicPlan,
} from '../../renderer/geometry/civic/registry';
import { FACADE_CIVIC, PART_LAMP, ZONE_CAT } from '../../renderer/geometry/buildings/parts';
import { getInfraConfig } from '../../core/building/InfraConfig';
import type { CivicPlan } from '../../renderer/geometry/civic/types';

const plan = (w = 2, h = 2): CivicPlan => ({
  footprint: { w, h },
  facade: FACADE_CIVIC,
  seed: [0.5, 0.5, 0.5],
  massing: [],
  decals: [],
  props: [],
  overhead: [],
});

const NO_TRIS = { massing: 0, decal: 0, prop: 0, overhead: 0 };

describe('civic 檢視的三角形統計', () => {
  it('should scale the budget by footprint, not per building', () => {
    // 2x2 的醫院不能套逐棟的 HOUSE: 400 —— 那條線是給「一格一棟」訂的。
    const r = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: 900 });
    expect(r.budget.massing).toBe(CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 4);
    expect(r.over.massing).toBe(false);
  });

  it('should flag a plan that blows the budget', () => {
    const r = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: 1300 });
    expect(r.over.massing).toBe(true);
  });

  it('should count cells as w * h, not as the longer side', () => {
    // 9x6 的大型機場有 54 格。取長邊的話預算會少報六倍，統計整片標紅。
    const r = civicTriangleReport({ w: 9, h: 6 }, NO_TRIS);
    expect(r.cells).toBe(54);
    expect(r.budget.massing).toBe(CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 54);
  });

  it('should budget all four layers', () => {
    const r = civicTriangleReport({ w: 1, h: 1 }, NO_TRIS);
    expect(r.budget).toEqual({
      massing: CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL,
      decal: CIVIC_TRIANGLE_BUDGET.DECAL_PER_CELL,
      prop: CIVIC_TRIANGLE_BUDGET.PROP_PER_CELL,
      overhead: CIVIC_TRIANGLE_BUDGET.OVERHEAD_PER_CELL,
    });
  });

  it('should flag each layer independently', () => {
    // 四層各有各的預算與問題。一個總開關的話，「哪一層超支」只能用猜的。
    const r = civicTriangleReport({ w: 1, h: 1 }, { ...NO_TRIS, prop: 999 });
    expect(r.over).toEqual({ massing: false, decal: false, prop: true, overhead: false });
  });
});

describe('civic 檢視的下拉選單', () => {
  beforeEach(resetCivicPlans);

  it('should list nothing before anything is converted', () => {
    // 選單列出還沒改造的種類的話，選了會是一片空地而不會報錯 —— 看起來
    // 像「壞了」而不像「還沒做」。
    expect(civicOptions()).toEqual([]);
  });

  it('should list only the types that have a plan', () => {
    registerCivicPlan('police', plan());
    registerCivicPlan('hospital', plan(2, 3));
    expect(civicOptions().map(o => o.type).sort()).toEqual(['hospital', 'police']);
    for (const o of civicOptions()) expect(getCivicPlan(o.type)).toBeDefined();
  });

  it('should label options with the name InfraConfig already defines', () => {
    // 手寫第二份名稱表的話，改了 InfraConfig 的名字選單不會跟著改。
    registerCivicPlan('police', plan());
    expect(civicOptions()[0]!.label).toContain(getInfraConfig('police')!.name);
  });

  it('should show the footprint in the label', () => {
    // 佔地決定了預算，看統計時要知道現在看的是幾格。
    registerCivicPlan('hospital', plan(2, 3));
    expect(civicOptions()[0]!.label).toContain('2×3');
  });
});

describe('placeCivic 的四層', () => {
  beforeEach(resetCivicPlans);

  /** 每層放一個看得出來的東西，好確認四層都真的建出來了。 */
  const fullPlan = (): CivicPlan => ({
    footprint: { w: 2, h: 2 },
    facade: FACADE_CIVIC,
    seed: [0.25, 0.5, 0.75],
    massing: [{ x: 0, z: 0, w: 1, d: 1, y0: 0, y1: 0.5 }],
    decals: [{ x: 0, z: 0, w: 1.8, d: 1.8, shade: 0.4 }],
    props: [{ x: 0.6, z: 0.6, w: 0.2, d: 0.2, y0: 0, y1: 0.3, part: PART_LAMP }],
    overhead: [{ x: 0, z: 0.6, w: 0.8, d: 0.3, y0: 0.4, y1: 0.45 }],
  });

  it('should build all four layers', () => {
    registerCivicPlan('police', fullPlan());
    const placed = placeCivic('police', new THREE.Scene(), 0.8)!;
    expect(placed.meshes.length, '四層沒有全部建出來').toBe(4);
    for (const key of ['massing', 'decal', 'prop', 'overhead'] as const) {
      expect(placed.tris[key], `${key} 層是空的`).toBeGreaterThan(0);
    }
  });

  /**
   * BUG-230c 的形狀：只寫量體層的逐實例屬性。
   *
   * 招牌與燈頭住在矮物件層與懸挑層，而它們的亮暗吃的是同一個 `aOccupancy`
   * —— 只餵量體層的話，那兩層的值永遠停在 0，shader 判定「沒有人」，
   * 路燈與招牌整座城市都是暗的。
   */
  it('should stamp the per-instance attributes on every layer', () => {
    registerCivicPlan('police', fullPlan());
    const placed = placeCivic('police', new THREE.Scene(), 0.8)!;
    for (const m of placed.meshes) {
      for (const name of ['aOccupancy', 'aSeed', 'aHighlight', 'aHighlightColor']) {
        expect(m.geometry.getAttribute(name), `某一層少了 ${name}`).toBeTruthy();
      }
      expect(m.geometry.getAttribute('aOccupancy').getX(0)).toBeCloseTo(0.8, 6);
      expect(m.geometry.getAttribute('aSeed').getX(0), 'aSeed 不是 plan 給的值')
        .toBeCloseTo(0.25, 6);
    }
  });

  it('should stamp the facade category on every layer', () => {
    // 少了的話那一層的 vZoneCat 是 0 —— 走進住宅低密度的立面分支。
    registerCivicPlan('police', fullPlan());
    const placed = placeCivic('police', new THREE.Scene(), 0.8)!;
    for (const m of placed.meshes) {
      expect(m.geometry.getAttribute('color').getY(0), '某一層沒有蓋上立面類別')
        .toBeCloseTo(ZONE_CAT[FACADE_CIVIC]!, 6);
    }
  });

  it('should cull only the prop and overhead layers', () => {
    // 貼片不關 —— 它是平的鋪面，關掉會讓遠景整片地變空。量體當然也不關。
    registerCivicPlan('police', fullPlan());
    const placed = placeCivic('police', new THREE.Scene(), 0.8)!;
    expect(placed.culled.length).toBe(2);
  });

  it('should not cast shadows from the decal layer', () => {
    // 平的鋪面投影會在自己底下畫出一圈黑邊。
    registerCivicPlan('police', fullPlan());
    const placed = placeCivic('police', new THREE.Scene(), 0.8)!;
    const noShadow = placed.meshes.filter(m => !m.castShadow);
    expect(noShadow.length, '不投影的層數不是一層（貼片）').toBe(1);
  });

  it('should skip a layer that has nothing in it', () => {
    // 公園沒有懸挑。空幾何仍然建出 mesh 的話是白吃一次 draw call。
    registerCivicPlan('park', { ...fullPlan(), overhead: [], props: [] });
    const placed = placeCivic('park', new THREE.Scene(), 0.8)!;
    expect(placed.meshes.length).toBe(2);
    expect(placed.culled.length).toBe(0);
  });

  it('should return null for a type that has no plan', () => {
    expect(placeCivic('police', new THREE.Scene(), 0.8)).toBeNull();
  });
});

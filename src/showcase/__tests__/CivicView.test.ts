import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { civicTriangleReport, civicOptions, placeCivic } from '../civic';
import { CIVIC_TRIANGLE_BUDGET } from '../../renderer/geometry/civic/types';
import { getCivicPlan, civicTypesDone } from '../../renderer/geometry/civic/registry';
import { FACADE_CIVIC, PART_LAMP, ZONE_CAT } from '../../renderer/geometry/buildings/parts';
import { getInfraConfig } from '../../core/building/InfraConfig';
import type { CivicPlan } from '../../renderer/geometry/civic/types';

const NO_TRIS = { massing: 0, decal: 0, prop: 0, overhead: 0 };

describe('civic 檢視的三角形統計', () => {
  it('should scale the budget by footprint, not per building', () => {
    // 2x2 的醫院不能套逐棟的 HOUSE: 400 —— 那條線是給「一格一棟」訂的。
    const r = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: 900 });
    expect(r.budget.massing).toBe(CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 4);
    expect(r.over.massing).toBe(false);
  });

  it('should flag a plan that blows the budget', () => {
    // 用預算本身推出「超支一個三角形」，不寫死數字 —— 寫死的話，調整
    // CIVIC_TRIANGLE_BUDGET 之後這條測試會靜靜地變成「沒超支也不報」。
    const justOver = CIVIC_TRIANGLE_BUDGET.MASSING_PER_CELL * 4 + 1;
    const r = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: justOver });
    expect(r.over.massing).toBe(true);
    const exact = civicTriangleReport({ w: 2, h: 2 }, { ...NO_TRIS, massing: justOver - 1 });
    expect(exact.over.massing, '剛好用完預算不算超支').toBe(false);
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

/**
 * 選單的內容會隨著改造進度變 —— 19 種是分批做的。所以這裡測的是**不變量**，
 * 不是某個時間點的清單：寫死清單的話，每做完一棟就要來改一次測試，而那種
 * 測試改久了就變成橡皮圖章。
 */
describe('civic 檢視的下拉選單', () => {
  it('should list exactly the types that have a plan', () => {
    // 列出還沒改造的種類的話，選了會是一片空地而不會報錯 —— 看起來像
    // 「壞了」而不像「還沒做」。
    expect(civicOptions().map(o => o.type).sort()).toEqual([...civicTypesDone()].sort());
    for (const o of civicOptions()) {
      expect(getCivicPlan(o.type), `${o.type} 在選單裡卻沒有 plan`).toBeDefined();
    }
  });

  it('should label every option with the name and footprint InfraConfig defines', () => {
    // 名稱手寫第二份的話，改了 InfraConfig 的名字選單不會跟著改；
    // 佔地要顯示是因為它決定了三角形預算，看統計時得知道現在看的是幾格。
    for (const o of civicOptions()) {
      const cfg = getInfraConfig(o.type)!;
      expect(o.label, `${o.type} 的標籤沒有名稱`).toContain(cfg.name);
      expect(o.label, `${o.type} 的標籤沒有佔地`).toContain(`${cfg.width}×${cfg.height}`);
    }
  });
});

describe('placeCivic 的四層', () => {
  /** 每層放一個看得出來的東西，好確認四層都真的建出來了。 */
  const fullPlan = (): CivicPlan => ({
    footprint: { w: 2, h: 2 },
    facade: FACADE_CIVIC,
    color: [0.2, 0.3, 0.8],
    seed: [0.25, 0.5, 0.75],
    massing: [{ x: 0, z: 0, w: 1, d: 1, y0: 0, y1: 0.5 }],
    decals: [{ x: 0, z: 0, w: 1.8, d: 1.8, shade: 0.4 }],
    props: [{ x: 0.6, z: 0.6, w: 0.2, d: 0.2, y0: 0, y1: 0.3, part: PART_LAMP }],
    overhead: [{ x: 0, z: 0.6, w: 0.8, d: 0.3, y0: 0.4, y1: 0.45 }],
    plants: [{ kind: 'tree', x: -0.6, z: 0.6, heightM: 5, crownRadius: 0.1 }],
  });

  it('should build every layer', () => {
    // 五個 mesh、四格預算：植栽自己一個 mesh（圓錐與球併不進稜台），
    // 但它就是矮物件，所以三角形算在 prop 那一格。
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    expect(placed.meshes.length, '有一層沒有建出來').toBe(5);
    for (const key of ['massing', 'decal', 'prop', 'overhead'] as const) {
      expect(placed.tris[key], `${key} 是空的`).toBeGreaterThan(0);
    }
  });

  it('should count plants into the prop budget, not a fifth one', () => {
    const withPlants = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    const noPlants = placeCivic({ ...fullPlan(), plants: [] }, new THREE.Scene(), 0.8)!;
    expect(withPlants.tris.prop, '植栽沒有算進 prop 的三角形數')
      .toBeGreaterThan(noPlants.tris.prop);
  });

  /**
   * BUG-230c 的形狀：只寫量體層的逐實例屬性。
   *
   * 招牌與燈頭住在矮物件層與懸挑層，而它們的亮暗吃的是同一個 `aOccupancy`
   * —— 只餵量體層的話，那兩層的值永遠停在 0，shader 判定「沒有人」，
   * 路燈與招牌整座城市都是暗的。
   */
  it('should stamp the per-instance attributes on every layer', () => {
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
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
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    for (const m of placed.meshes) {
      expect(m.geometry.getAttribute('color').getY(0), '某一層沒有蓋上立面類別')
        .toBeCloseTo(ZONE_CAT[FACADE_CIVIC]!, 6);
    }
  });

  it('should carry the building colour into every layer', () => {
    // 少了的話 shader 讀到 aBldgColor = 0 —— 整棟是黑的。
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    const massing = placed.meshes[1]!;   // LAYERS 的順序：貼片、量體、矮物件、植栽、懸挑
    const a = massing.geometry.getAttribute('aBldgColor');
    expect(a, '量體層沒有 aBldgColor').toBeTruthy();
    // Float32 存不下 0.2 —— 逐位比對會在一個與顏色無關的理由上失敗。
    for (const [i, want] of [0.2, 0.3, 0.8].entries()) {
      expect([a.getX(0), a.getY(0), a.getZ(0)][i]).toBeCloseTo(want, 6);
    }
  });

  it('should not flatten a per-volume colour override', () => {
    // `assembleCivic` 逐量體寫 aBldgColor（醫院的紅十字、大學的金頂）。
    // `stampInstanceValues` 若無條件重寫整份，那些覆寫會被抹平 ——
    // 而畫面上只表現為「紅十字不見了」。
    const p = fullPlan();
    p.massing = [
      { x: -0.3, z: 0, w: 0.4, d: 0.4, y0: 0, y1: 0.5 },
      { x: 0.3, z: 0, w: 0.4, d: 0.4, y0: 0, y1: 0.5, color: [1, 0, 0] },
    ];
    const placed = placeCivic(p, new THREE.Scene(), 0.8)!;
    const a = placed.meshes[1]!.geometry.getAttribute('aBldgColor');
    const seen = new Set<string>();
    for (let i = 0; i < a.count; i++) {
      seen.add([a.getX(i), a.getY(i), a.getZ(i)].map(v => v.toFixed(2)).join(','));
    }
    expect(seen.size, '逐量體的顏色覆寫被抹平了').toBe(2);
  });

  it('should cull only the prop and overhead layers', () => {
    // 貼片不關 —— 它是平的鋪面，關掉會讓遠景整片地變空。量體當然也不關。
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    expect(placed.culled.length, '矮物件、植栽、懸挑三層要跟著遠景關掉').toBe(3);
  });

  it('should not cast shadows from the decal layer', () => {
    // 平的鋪面投影會在自己底下畫出一圈黑邊。
    const placed = placeCivic(fullPlan(), new THREE.Scene(), 0.8)!;
    const noShadow = placed.meshes.filter(m => !m.castShadow);
    expect(noShadow.length, '不投影的層數不是一層（貼片）').toBe(1);
  });

  it('should skip a layer that has nothing in it', () => {
    // 公園沒有懸挑。空幾何仍然建出 mesh 的話是白吃一次 draw call。
    const placed = placeCivic(
      { ...fullPlan(), overhead: [], props: [], plants: [] }, new THREE.Scene(), 0.8,
    )!;
    expect(placed.meshes.length).toBe(2);
    expect(placed.culled.length).toBe(0);
  });
});

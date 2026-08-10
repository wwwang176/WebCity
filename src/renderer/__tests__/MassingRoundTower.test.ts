import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { volumesFor, isRoundBodied } from '../geometry/buildings/massing';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';
import { PART_WALL, PART_ROOF } from '../geometry/buildings/parts';
import { buildRoof } from '../geometry/buildings/massing/roofForms';
import { dimensionsFor } from '../geometry/buildings/massing/dimensions';
import type { Volume } from '../geometry/buildings/massing/volume';
import { BuildingRenderer } from '../BuildingRenderer';
import type { InstancedLayer } from '../InstancedLayer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';
import { appearanceOf } from '../BuildingAppearance';
import { paletteFor } from '../ColorPalettes';

/**
 * 商業高密度的圓塔。
 *
 * 階段 2C-1 把 17 個手寫變體換成參數化生成器時，`makeComHighV2`（八角柱身 +
 * 圓盤簷）沒有被搬過來 —— 八個組合器產出的全是長方體。圓柱這個形狀後來為了
 * 工業的煙囪與筒倉才回到 `VolumeShape`，但只有工業拿得到。
 *
 * 規格從頭到尾沒有討論過「圓形塔身」要不要留，驗收線（剪影種類、不對稱比例、
 * 三角形預算）也不會因為少一根圓塔而變紅 —— 所以測試全綠、東西沒了。
 */

const ROUND_ZONE = ZoneType.COMMERCIAL_HIGH;

function roundVariants(level: number): number[] {
  const out: number[] = [];
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    if (isRoundBodied(ROUND_ZONE, 'HIGH', level, vi)) out.push(vi);
  }
  return out;
}

describe('commercial high round tower', () => {
  it('should give at least one variant a round body at the top level', () => {
    expect(roundVariants(3).length, '商業高密度沒有任何圓形變體')
      .toBeGreaterThan(0);
  });

  it('should stay a rarity, not become the whole skyline', () => {
    // 圓塔是地標。八棟裡有一半是圓的就不叫特色了，而且它完全旋轉對稱 ——
    // 四向旋轉在它身上一點變化都生不出來，占比越高整區越單調。
    expect(roundVariants(3).length, '圓塔太常見').toBeLessThanOrEqual(2);
  });

  it('should make the round part the building itself, not equipment', () => {
    // 工業的煙囪與筒倉也是圓柱，但它們是 PART_DETAIL。分辨兩者的是零件標籤，
    // 而不是「有沒有圓柱」—— 否則工業的廠房也會被當成圓形建築。
    const vi = roundVariants(3)[0]!;
    const round = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .filter(v => v.shape === 'cylinder');
    expect(round.some(v => (v.part ?? PART_WALL) === PART_WALL), '圓柱不是牆體')
      .toBe(true);
  });

  it('should not call an industrial chimney a round building', () => {
    // 反向：工業每個等級都有煙囪或筒倉，但廠房本體是方的。
    for (let vi = 0; vi < VARIANT_COUNT; vi++) {
      expect(isRoundBodied(ZoneType.INDUSTRIAL, 'LOW', 3, vi), `工業變體 ${vi} 被當成圓形建築`)
        .toBe(false);
    }
  });

  it('should keep a circular footprint, not an ellipse', () => {
    // 寬深是各自抖動的，直接拿 (w, d) 會得到橢圓柱。圓形之所以有特色是因為
    // 它是圓的。
    const vi = roundVariants(3)[0]!;
    const body = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .find(v => v.shape === 'cylinder' && (v.part ?? PART_WALL) === PART_WALL)!;
    expect(body.w, '圓塔被壓成橢圓').toBeCloseTo(body.d, 9);
  });

  it('should cap the round tower with a cornice disc', () => {
    // 原本的 makeComHighV2 就是「柱身 + 略微外挑的圓盤」，而那片圓盤是它
    // 看起來像建築而不是一根管子的原因。
    const vi = roundVariants(3)[0]!;
    const cap = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .filter(v => v.part === PART_ROOF && v.shape === 'cylinder');
    expect(cap.length, '圓塔沒有簷板').toBeGreaterThan(0);

    const body = volumesFor(ROUND_ZONE, 'HIGH', 3, vi)
      .find(v => v.shape === 'cylinder' && (v.part ?? PART_WALL) === PART_WALL)!;
    expect(cap[0]!.w, '簷板沒有外挑').toBeGreaterThan(body.w);
  });

  it('should not put a square parapet or crown on a round top', () => {
    // 直接測 `buildRoof`，不透過變體。
    //
    // 這一條的第一版是「掃過圓塔的所有屋頂量體，斷言每一個都是圓的」——
    // 而圓塔落在 `roofFor` 的 `flat`，那條分支回傳空陣列，於是迴圈一個都
    // 沒檢查到、測試空轉綠燈。回退驗證才抓到。
    const top: Volume = {
      x: 0, z: 0, w: 0.4, d: 0.4, y0: 0, y1: 1.2, shape: 'cylinder',
    };
    const dims = dimensionsFor(ROUND_ZONE, 'HIGH', 3, 0)!;
    for (const form of ['parapet', 'crown'] as const) {
      const out = buildRoof(form, top, dims, () => 0.5);
      expect(out.length, `${form} 什麼都沒產生，這條測試等於沒測`).toBeGreaterThan(0);
      for (const v of out) {
        expect(v.shape, `${form} 在圓塔上仍然是方的`).toBe('cylinder');
      }
    }
  });

});

describe('round buildings get no overhead props', () => {
  type Internals = { overheadLayer: InstancedLayer; propLayer: InstancedLayer };

  /** 這一格會落到哪個量體變體 —— 與 BuildingRenderer 的算法一致。 */
  function variantAt(x: number, y: number, level: number): number {
    return appearanceOf({
      x, y, zoneType: ROUND_ZONE, level, seedByte: 0,
      variantCount: VARIANT_COUNT,
      paletteSize: paletteFor(ROUND_ZONE, level).length,
    }).variantIndex;
  }

  function findCell(level: number, wantRound: boolean): [number, number] {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const isRound = isRoundBodied(ROUND_ZONE, 'HIGH', level, variantAt(x, y, level));
        if (isRound === wantRound) return [x, y];
      }
    }
    throw new Error(`找不到 ${wantRound ? '圓形' : '方形'} 的格子`);
  }

  it('should skip the awning and signage layer on a round tower', () => {
    // 雨遮與招牌都是平板，貼在圓弧牆上會穿出去或懸空 —— 那是 BUG-226
    // （雨遮貼在假想牆上）的同一類錯誤，只是這次牆是彎的。
    const renderer = new BuildingRenderer();
    renderer.build(new THREE.Scene(), new Grid(40, 40));
    const internals = renderer as unknown as Internals;

    const [x, y] = findCell(3, true);
    renderer.addBuilding(x, y, ROUND_ZONE, 'HIGH', 3, false);

    expect(internals.overheadLayer.entryFor(`${x},${y}`), '圓塔還是掛了雨遮／招牌')
      .toBeUndefined();
  });

  it('should still give a square tower its awnings', () => {
    // 反向：這條擋的是「乾脆整個分區都不要懸挑」。
    const renderer = new BuildingRenderer();
    renderer.build(new THREE.Scene(), new Grid(40, 40));
    const internals = renderer as unknown as Internals;

    const [x, y] = findCell(3, false);
    renderer.addBuilding(x, y, ROUND_ZONE, 'HIGH', 3, false);

    expect(internals.overheadLayer.entryFor(`${x},${y}`), '方形塔樓的懸挑也被關掉了')
      .toBeDefined();
  });

  it('should keep the ground props on a round tower', () => {
    // 只有懸挑該關。矮物件站在地上，牆彎不彎與它無關。
    const renderer = new BuildingRenderer();
    renderer.build(new THREE.Scene(), new Grid(40, 40));
    const internals = renderer as unknown as Internals;

    const [x, y] = findCell(3, true);
    renderer.addBuilding(x, y, ROUND_ZONE, 'HIGH', 3, false);

    expect(internals.propLayer.entryFor(`${x},${y}`), '圓塔的矮物件也被關掉了')
      .toBeDefined();
  });
});

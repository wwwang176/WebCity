import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { columnarTree, shrubBall, plantRadius } from '../plants';
import { getGroundPropVariants } from '../buildings/groundProps';
import {
  PART_DETAIL, PART_FOLIAGE, triangleCount,
} from '../buildings/parts';
import { TARGET_HEIGHTS_M, LEVELS, type Density } from '../buildings/registry';
import { METRES_PER_CELL } from '../../../core/grid/constants';

const M = (m: number) => m / METRES_PER_CELL;

interface PropFingerprint { tris: number; fp: string }

/**
 * 穩定的指紋：所有頂點座標與標籤，量化到 1e-6 之後累加。
 *
 * 只比三角形數不夠 —— 把一棵樹搬到別的位置、換個半徑、標錯零件，三角形數
 * 都不會變。這次是 20 個函式的機械搬移，需要比得出「一模一樣」的東西。
 */
function fingerprint(g: THREE.BufferGeometry): string {
  let h = 2166136261;
  for (const name of ['position', 'color'] as const) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = a.array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) {
      const q = Math.round(arr[i]! * 1e6);
      h = Math.imul(h ^ (q & 0xffff), 16777619);
      h = Math.imul(h ^ ((q >>> 16) & 0xffff), 16777619);
    }
  }
  return (h >>> 0).toString(16);
}

const BASELINE: Record<string, PropFingerprint[]> = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '__tests__', 'fixtures',
    'ground-prop-triangles.json'),
  'utf8',
));

function tagsOf(geos: ReturnType<typeof columnarTree>): number[] {
  return geos.map(g => g.getAttribute('color').getX(0));
}

/**
 * 植栽圖元。
 *
 * 抽出來的理由是使用者的一句話：「警察局的樹是不是可以跟住宅的樹共用？
 * 不用再自己畫一顆」。在那之前公共建築自己寫了一棵 —— 兩棵樹在同一座城市裡
 * 長得不一樣，而且改一邊不會連動另一邊。
 *
 * 這個模組**不知道**呼叫者是誰：它吃世界座標與尺寸，不吃「格子的物件帶」。
 * 住宅那一側從帶算出座標再呼叫它，公共建築直接給座標。
 */
describe('柱狀樹', () => {
  it('should be a trunk plus a crown, not one lump', () => {
    const parts = columnarTree(0, 0, 6, M(1.2));
    expect(parts.length, '樹應該是兩件：樹幹與樹冠').toBe(2);
  });

  it('should tag the trunk as detail and the crown as foliage', () => {
    // 樹幹標 PART_WALL 的話它會長出窗戶；樹冠標錯就不是綠的。
    // 逐位比對不行 —— 頂點色是 Float32，0.2 存不下。
    const [trunk, crown] = tagsOf(columnarTree(0, 0, 6, M(1.2)));
    expect(trunk).toBeCloseTo(PART_DETAIL, 6);
    expect(crown).toBeCloseTo(PART_FOLIAGE, 6);
  });

  it('should stack the crown on top of the trunk', () => {
    const [trunk, crown] = columnarTree(0, 0, 6, M(1.2));
    trunk!.computeBoundingBox();
    crown!.computeBoundingBox();
    expect(crown!.boundingBox!.min.y, '樹冠沒有坐在樹幹上')
      .toBeGreaterThanOrEqual(trunk!.boundingBox!.max.y - 1e-6);
  });

  it('should reach the height it was asked for', () => {
    const parts = columnarTree(0, 0, 6, M(1.2));
    let top = 0;
    for (const g of parts) {
      g.computeBoundingBox();
      top = Math.max(top, g.boundingBox!.max.y);
    }
    expect(top * METRES_PER_CELL).toBeCloseTo(6, 3);
  });

  it('should stand where it was put', () => {
    // 比對「同一棵樹放在原點與放在 (0.4, −0.25) 的差」，而不是量它的中心。
    //
    // 樹幹是五邊柱，端面又是扇形（有中心頂點），所以包圍盒中心與頂點平均
    // **都不在軸心上** —— 兩者離軸心各差約 1 mm。那不是「位置錯了」，
    // 但用它們當斷言會讓這條測試在一個與位置無關的理由上紅。
    const at0 = columnarTree(0, 0, 6, M(1.2))[0]!;
    const at1 = columnarTree(0.4, -0.25, 6, M(1.2))[0]!;
    const p0 = at0.getAttribute('position');
    const p1 = at1.getAttribute('position');
    expect(p1.count).toBe(p0.count);
    for (let i = 0; i < p0.count; i++) {
      expect(p1.getX(i) - p0.getX(i)).toBeCloseTo(0.4, 6);
      expect(p1.getZ(i) - p0.getZ(i)).toBeCloseTo(-0.25, 6);
      expect(p1.getY(i) - p0.getY(i), '不該動到高度').toBeCloseTo(0, 9);
    }
  });

  it('should report a radius wide enough to bound the crown', () => {
    // 公共建築用它做佔地檢查 —— 少報的話樹會伸出去壓到鄰格。
    const r = M(1.2);
    const [, crown] = columnarTree(0, 0, 6, r);
    crown!.computeBoundingBox();
    const half = Math.max(
      Math.abs(crown!.boundingBox!.min.x), Math.abs(crown!.boundingBox!.max.x),
    );
    expect(plantRadius({ kind: 'tree', x: 0, z: 0, heightM: 6, crownRadius: r }))
      .toBeGreaterThanOrEqual(half - 1e-9);
  });
});

describe('灌木球', () => {
  it('should be foliage and sit on the ground', () => {
    const g = shrubBall(0, 0, M(0.8));
    expect(g.getAttribute('color').getX(0)).toBe(PART_FOLIAGE);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
  });
});

/**
 * 住宅的樹**一個三角形都不能變**。
 *
 * 這一輪只是把矮物件的做法搬到共用模組，住宅那一側改成先算座標再呼叫它。
 * 基準是在動任何程式碼**之前**存下來的 —— 重構之後才存的基準等於沒有基準。
 *
 * 比的是**頂點指紋**而不只是三角形數：搬錯位置、半徑算錯、標錯零件，
 * 三角形數都不會變。
 */
describe('住宅的庭院沒有被這次重構動到', () => {
  it('should keep every ground prop variant at its original triangle count', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [z, d] = key.split(':');
      for (const lv of LEVELS) {
        const got = getGroundPropVariants(Number(z), d as Density, lv).map((b) => {
          const g = b();
          const r = { tris: triangleCount(g), fp: fingerprint(g) };
          g.dispose();
          return r;
        });
        expect(got, `${key}:${lv} 的庭院變了`).toEqual(BASELINE[`${key}:${lv}`]);
      }
    }
  });
});

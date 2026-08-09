import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  getOverheadVariants, OVERHEAD_TRIANGLE_BUDGET,
} from '../geometry/buildings/overheadProps';
import {
  OVERHEAD_CLEARANCE, SHOPFRONT_CEILING, narrowestBuildingEdge,
} from '../geometry/buildings/propBands';
import { TARGET_HEIGHTS_M, LEVELS, type Density } from '../geometry/buildings/registry';
import { triangleCount } from '../geometry/buildings/parts';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;
const CELL_EDGE = 0.5;

function eachBucket(fn: (zoneType: number, density: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

function eachOverhead(fn: (geo: THREE.BufferGeometry, label: string) => void) {
  eachBucket((z, d, key) => {
    for (const level of LEVELS) {
      const variants = getOverheadVariants(z, d, level);
      for (let i = 0; i < variants.length; i++) {
        const geo = variants[i]!();
        fn(geo, `${key} L${level} v${i}`);
        geo.dispose();
      }
    }
  });
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

/**
 * 拆回一個個零件的平面輪廓。
 *
 * 懸挑物全部是 `BoxGeometry`（24 個頂點），`mergeGeometries` 依序串接，
 * 所以 24 個一組就是一個零件。只看 XZ：建築在這些高度上都是實心的，
 * 「貼不貼得到牆」是平面問題。
 */
function pieceRects(geo: THREE.BufferGeometry): Rect[] {
  const pos = geo.getAttribute('position');
  expect(pos.count % 24, '懸挑零件不是 BoxGeometry，24 頂點分組失效').toBe(0);
  const out: Rect[] = [];
  for (let p = 0; p < pos.count; p += 24) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < 24; k++) { xs.push(pos.getX(p + k)); zs.push(pos.getZ(p + k)); }
    out.push({
      x0: Math.min(...xs), x1: Math.max(...xs),
      z0: Math.min(...zs), z1: Math.max(...zs),
    });
  }
  return out;
}

const touches = (a: Rect, b: Rect) =>
  a.x0 <= b.x1 + 1e-6 && b.x0 <= a.x1 + 1e-6
  && a.z0 <= b.z1 + 1e-6 && b.z0 <= a.z1 + 1e-6;

/** 沒有連到建築（直接或透過其他零件）的零件索引。 */
function floatingPieces(geo: THREE.BufferGeometry, narrow: number): number[] {
  const rects = pieceRects(geo);
  const building: Rect = { x0: -narrow, x1: narrow, z0: -narrow, z1: narrow };
  const attached = rects.map(r => touches(r, building));
  for (let pass = 0; pass < rects.length; pass++) {
    let changed = false;
    rects.forEach((r, i) => {
      if (attached[i]) return;
      if (rects.some((o, j) => attached[j] && touches(r, o))) {
        attached[i] = true;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return attached.flatMap((ok, i) => (ok ? [] : [i]));
}

describe('overhead props', () => {
  it('should never hang low enough to hit a walking person', () => {
    // 這是懸挑物件唯一的存在理由：行人從下面走過。低於淨空就是穿模。
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y, `${label} 會打到頭`)
        .toBeGreaterThanOrEqual(OVERHEAD_CLEARANCE - 1e-6);
    });
  });

  it('should actually reach past the pedestrian envelope', () => {
    // 全都縮在建築輪廓裡的話，這一層沒有存在的意義 —— 那就只是立面零件。
    const reaching: string[] = [];
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      if (outer > HALF_ENVELOPE) reaching.push(label);
    });
    expect(reaching.length, '沒有任何懸挑物真的挑出去').toBeGreaterThan(0);
  });

  it('should stop at the cell edge', () => {
    // 越過格子邊界就會插進鄰居的建築裡。
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      expect(outer, `${label} 伸進鄰居家`).toBeLessThanOrEqual(CELL_EDGE + 1e-6);
    });
  });

  it('should stay attached to the narrowest building in its bucket', () => {
    // BUG-226：這一條原本量的是 `widestBuildingEdge` —— 每一棟的寬度是逐實例
    // 抖動的（±15%），但雨遮的幾何是整個 (分區, 密度, 等級) 桶共用的一份，
    // 它不可能知道自己掛在多寬的房子上。貼著**最寬**的那一棟，就等於在其餘
    // 每一棟上浮空 0.68–1.17 m。測試驗證的是一棟沒人看得到的房子。
    //
    // 唯一能永遠貼牆的做法是往內埋進最窄的那一棟裡：多出來的部分被牆擋住，
    // 看不見。所以內緣量的是 `narrowestBuildingEdge`。
    eachBucket((z, d, key) => {
      const narrow = narrowestBuildingEdge(z, d)!;
      for (const level of LEVELS) {
        for (const build of getOverheadVariants(z, d, level)) {
          const geo = build();
          // 判定是**連通性**而不是「有頂點碰到牆」：雨簷板掛在雨遮外緣，
          // 本來就碰不到牆，但它靠著雨遮所以不算浮空。逐零件檢查「碰到建築、
          // 或碰到已經確定沒浮空的零件」，遞移到收斂為止。
          //
          // 只看合併後的包圍盒會放行：南側與東側兩片雨遮同時浮空時，
          // 合起來的包圍盒仍然罩住建築。
          const floating = floatingPieces(geo, narrow);
          expect(floating, `${key} L${level} 有 ${floating.length} 個零件浮空`)
            .toHaveLength(0);
          geo.dispose();
        }
      }
    });
  });

  it('should hang at shopfront height, not halfway up the facade', () => {
    // 雨遮該在一樓的位置。立面 shader 的樓層高度是 2.64–3.6 m，所以「一樓
    // 樓板線」取最低的那個 —— 樓高同樣是逐實例亂數，幾何不知道自己掛在
    // 哪一棟上，取最低值才保證永遠不會越過一樓。
    //
    // 原本的高度是手挑的公尺數（3.0–3.8 m），在 5 m 高的商業低 L1 上等於
    // 掛在建築的六成高處。
    eachOverhead((geo, label) => {
      geo.computeBoundingBox();
      const bottom = geo.boundingBox!.min.y;
      expect(bottom, `${label} 掛在 ${(bottom * METRES_PER_CELL).toFixed(2)} m，超過一樓`)
        .toBeLessThanOrEqual(SHOPFRONT_CEILING + 1e-6);
    });
  });

  it('should keep signs below the roofline of the shortest building it can sit on', () => {
    // 招牌掛在雨遮上方是對的，掛到屋頂邊緣就變成別的東西了。
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        const shortest = TARGET_HEIGHTS_M[key]![level - 1]! / METRES_PER_CELL;
        for (const build of getOverheadVariants(z, d, level)) {
          const geo = build();
          geo.computeBoundingBox();
          expect(geo.boundingBox!.max.y, `${key} L${level} 的招牌爬到屋頂`)
            .toBeLessThanOrEqual(shortest * 0.6);
          geo.dispose();
        }
      }
    });
  });

  it('should never be tagged as wall', () => {
    // 雨遮長出一格一格的窗會很怪。
    eachOverhead((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        expect(col.getX(i), `${label} 頂點 ${i} 標成 PART_WALL`).toBeGreaterThan(0.1);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachOverhead((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(OVERHEAD_TRIANGLE_BUDGET);
    });
  });

  it('should give commercial, office and industrial something at level 3', () => {
    for (const [zone, density] of [
      [ZoneType.COMMERCIAL_LOW, 'LOW'], [ZoneType.COMMERCIAL_HIGH, 'HIGH'],
      [ZoneType.OFFICE, 'LOW'], [ZoneType.OFFICE, 'HIGH'],
      [ZoneType.INDUSTRIAL, 'LOW'], [ZoneType.RESIDENTIAL_HIGH, 'HIGH'],
    ] as Array<[number, Density]>) {
      expect(getOverheadVariants(zone, density, 3).length, `zone ${zone}/${density}`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it('should leave the detached house alone', () => {
    // 獨棟住宅沒有騎樓也沒有招牌。硬加會讓它看起來像店面。
    for (const level of LEVELS) {
      expect(getOverheadVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)).toHaveLength(0);
    }
  });

  it('should earn its overhang with level', () => {
    // L1 樸素、L3 有騎樓與招牌。這一層本身就是等級階梯的一部分。
    for (const [zone, density] of [
      [ZoneType.COMMERCIAL_LOW, 'LOW'], [ZoneType.COMMERCIAL_HIGH, 'HIGH'],
    ] as Array<[number, Density]>) {
      const tris = (lv: number) => getOverheadVariants(zone, density, lv)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; })
        .reduce((a, b) => a + b, 0);
      expect(tris(3), `zone ${zone} L3`).toBeGreaterThan(tris(1));
    }
  });
});

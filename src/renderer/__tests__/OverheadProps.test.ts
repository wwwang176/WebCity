import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  getOverheadVariants, OVERHEAD_TRIANGLE_BUDGET,
} from '../geometry/buildings/overheadProps';
import { OVERHEAD_CLEARANCE, SHOPFRONT_CEILING }
  from '../geometry/buildings/propBands';
import { volumesFor, VARIANT_COUNT } from '../geometry/buildings/massing';
import { maxAbsOf } from '../geometry/buildings/massing/volume';

/**
 * 這一桶最窄的那一個變體的牆面。
 *
 * **刻意不呼叫 `narrowestBuildingEdge`** —— 雨遮的幾何就是用那個函式建的，
 * 拿它當基準等於「用實作驗證實作」，那正是 BUG-226 躲過測試的方式：
 * 那條測試量的是 `buildingEdge()`，而幾何也是照它長的，所以永遠相符。
 */
function narrowestOf(z: number, d: Density, level: number): number {
  let lo = Infinity;
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    const vs = volumesFor(z, d, level, vi);
    if (vs.length > 0) lo = Math.min(lo, maxAbsOf(vs));
  }
  return lo;
}
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

/** 一個零件的頂點數：正反兩面各四個角。 */
const VERTS_PER_PIECE = 8;

/**
 * 拆回一個個零件的平面輪廓。
 *
 * 懸挑物全部是雙面 quad（正反各四個角 = 8 個頂點），`mergeGeometries` 依序
 * 串接，所以 8 個一組就是一個零件。只看 XZ：建築在這些高度上都是實心的，
 * 「貼不貼得到牆」是平面問題。
 */
function pieceRects(geo: THREE.BufferGeometry): Rect[] {
  const pos = geo.getAttribute('position');
  expect(pos.count % VERTS_PER_PIECE, '懸挑零件不是雙面 quad，分組失效').toBe(0);
  const out: Rect[] = [];
  for (let p = 0; p < pos.count; p += VERTS_PER_PIECE) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < VERTS_PER_PIECE; k++) {
      xs.push(pos.getX(p + k)); zs.push(pos.getZ(p + k));
    }
    out.push({
      x0: Math.min(...xs), x1: Math.max(...xs),
      z0: Math.min(...zs), z1: Math.max(...zs),
    });
  }
  return out;
}

/**
 * 「鎖在上面」的容差。
 *
 * 招牌離牆 20 cm 仍然是鎖在牆上的，強求貼平反而會與牆共面而 z-fighting。
 * 0.25 m 遠小於 BUG-226 的 0.68–1.17 m，所以這個容差不會讓那個缺陷溜過去。
 */
const MOUNT_TOLERANCE = 0.25 / METRES_PER_CELL;

const touches = (a: Rect, b: Rect) =>
  a.x0 <= b.x1 + MOUNT_TOLERANCE && b.x0 <= a.x1 + MOUNT_TOLERANCE
  && a.z0 <= b.z1 + MOUNT_TOLERANCE && b.z0 <= a.z1 + MOUNT_TOLERANCE;

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
      for (const level of LEVELS) {
        const narrow = narrowestOf(z, d, level);
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

  it('should be built from flat panels, not boxes', () => {
    // 雨遮 10 cm 厚，在 1 格 = 12 m 的尺度下永遠不到一個像素 —— 那六個面裡
    // 有五個是看不見的。用平面省下五分之四的三角形。
    //
    // 但平面是單面的（材質沒設 side，預設 FrontSide），而鏡頭的方位角可以
    // 自由轉，所以每一片都要正反兩面 —— 4 個三角形，仍然只有 BoxGeometry
    // 的三分之一。
    eachOverhead((geo, label) => {
      const pos = geo.getAttribute('position');
      expect(pos.count % VERTS_PER_PIECE, `${label} 不是雙面 quad`).toBe(0);
      expect(triangleCount(geo), `${label} 每片超過 4 個三角形`)
        .toBe((pos.count / VERTS_PER_PIECE) * 4);
    });
  });

  it('should be visible from every camera angle', () => {
    // 單面平面從背後看會消失。鏡頭仰角夾在 10°–80°、方位角自由，所以
    // 「朝上的面」永遠看得到，垂直的面不一定 —— 兩面都畫才是安全的做法。
    //
    // 判定：每一片的法線都必須成對出現（n 與 −n），否則就有一面沒畫。
    eachOverhead((geo, label) => {
      const n = geo.getAttribute('normal');
      const key = (i: number) =>
        `${n.getX(i).toFixed(4)},${n.getY(i).toFixed(4)},${n.getZ(i).toFixed(4)}`;
      const seen = new Set<string>();
      for (let i = 0; i < n.count; i++) seen.add(key(i));
      for (let i = 0; i < n.count; i++) {
        const flipped = `${(-n.getX(i)).toFixed(4)},${(-n.getY(i)).toFixed(4)},`
          + `${(-n.getZ(i)).toFixed(4)}`;
        expect(seen.has(flipped.replace(/-0\.0000/g, '0.0000')), `${label} 有一面沒畫`)
          .toBe(true);
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

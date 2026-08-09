import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getDecalVariants, DECAL_Y, MARK_Y } from '../geometry/buildings/decals';
import { volumesFor, VARIANT_COUNT } from '../geometry/buildings/massing';
import { maxAbsOf } from '../geometry/buildings/massing/volume';

/**
 * 這一桶最窄的那一個變體的牆面 —— 自己算，不呼叫 `narrowestBuildingEdge`。
 * 鋪面的幾何就是用那個函式建的，拿它當基準等於用實作驗證實作（BUG-226）。
 */
function narrowestOf(z: number, d: Density, level: number): number {
  let lo = Infinity;
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    const vs = volumesFor(z, d, level, vi);
    if (vs.length > 0) lo = Math.min(lo, maxAbsOf(vs));
  }
  return lo;
}
import { TARGET_HEIGHTS_M, TRIANGLE_BUDGET, LEVELS, type Density }
  from '../geometry/buildings/registry';
import { triangleCount } from '../geometry/buildings/parts';

const CELL_EDGE = 0.5;

function eachBucket(fn: (zoneType: number, density: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

function eachDecal(fn: (geo: THREE.BufferGeometry, label: string) => void) {
  eachBucket((z, d, key) => {
    for (const level of LEVELS) {
      const variants = getDecalVariants(z, d, level);
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
 * 依高度分組的四邊形。
 *
 * 每塊 `PlaneGeometry` 是連續的四個頂點，`mergeGeometries` 依序串接，所以
 * 四個一組就是一塊。不同高度的兩塊本來就該疊（標線疊在鋪面上），同高度的
 * 不該。
 */
function quadsByHeight(geo: THREE.BufferGeometry): Map<number, Rect[]> {
  const pos = geo.getAttribute('position');
  const out = new Map<number, Rect[]>();
  for (let q = 0; q + 3 < pos.count; q += 4) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < 4; k++) { xs.push(pos.getX(q + k)); zs.push(pos.getZ(q + k)); }
    const y = Math.round(pos.getY(q) * 1e6) / 1e6;
    const rect = {
      x0: Math.min(...xs), x1: Math.max(...xs),
      z0: Math.min(...zs), z1: Math.max(...zs),
    };
    const arr = out.get(y);
    if (arr) arr.push(rect);
    else out.set(y, [rect]);
  }
  return out;
}

/** 兩個矩形的重疊面積。共邊（面積 0）不算重疊。 */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0 && d > 0 ? w * d : 0;
}

describe('decal geometry', () => {
  it('should exist for every zone at every level', () => {
    // 本階段的驗收條件：沒有哪個分區是光禿的。
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        expect(getDecalVariants(z, d, level).length, `${key} L${level}`)
          .toBeGreaterThanOrEqual(1);
      }
    });
  });

  it('should lie flat on the ground', () => {
    // 有厚度的「貼片」會在側面長出牆，而牆會長出窗戶。
    eachDecal((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(b.min.y, `${label} 底層高度不對`).toBeCloseTo(DECAL_Y, 6);
      expect(b.max.y, `${label} 超過標線層`).toBeLessThanOrEqual(MARK_Y + 1e-9);
    });
  });

  it('should use exactly two heights — paving and markings', () => {
    // 停車格線本來就疊在柏油上，所以兩層是必要的。但更多層就代表底層彼此
    // 也在疊 —— 兩塊同高同位的四邊形會 z-fighting，靜態截圖看不出來、
    // 一移動鏡頭就整片閃爍。
    eachDecal((geo, label) => {
      const pos = geo.getAttribute('position');
      const ys = new Set<number>();
      for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1e6));
      expect(ys.size, `${label} 有 ${ys.size} 個高度`).toBeLessThanOrEqual(2);
      for (const y of ys) {
        const v = y / 1e6;
        expect(v === DECAL_Y || Math.abs(v - MARK_Y) < 1e-9, `${label} 高度 ${v} 不是這兩層`)
          .toBe(true);
      }
    });
  });

  it('should never lay two quads on top of each other', () => {
    // 「一個邊只能有一種鋪面」擋得住同一邊疊兩層，擋不住相鄰兩邊在**角落**
    // 互疊：四邊都鋪滿時，北側與東側各自跨滿整條邊，交出四塊 1.5 m 見方的
    // 重疊角。兩塊同高同位的四邊形會 z-fighting —— 靜態截圖看不出來，
    // 一移動鏡頭就整片閃爍，而這一層鋪在每一棟建築腳下。
    //
    // 上一版的計數式檢查（底層不超過四塊）看的是數量，看不到位置。
    eachDecal((geo, label) => {
      for (const [y, rects] of quadsByHeight(geo)) {
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            expect(
              overlapArea(rects[i]!, rects[j]!),
              `${label} 高度 ${y} 的第 ${i}、${j} 塊重疊`,
            ).toBeLessThan(1e-9);
          }
        }
      }
    });
  });

  it('should never pave the same side twice', () => {
    // 底層的重疊在幾何合併之後看不出來，所以要在結構上擋住：一個邊只能有
    // 一種鋪面。這一條盯的是「底層四邊形的數量不超過四塊」。
    eachDecal((geo, label) => {
      const pos = geo.getAttribute('position');
      let baseVerts = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - DECAL_Y) < 1e-9) baseVerts++;
      }
      // 每塊 PlaneGeometry 是 4 個頂點。
      expect(baseVerts / 4, `${label} 底層有 ${baseVerts / 4} 塊`).toBeLessThanOrEqual(4);
    });
  });

  it('should sit just above the ground, not visibly floating', () => {
    // 太低會與地面 z-fighting，太高會看出浮空。
    expect(DECAL_Y).toBeGreaterThan(0);
    expect(DECAL_Y).toBeLessThan(0.03);
  });

  it('should face up', () => {
    // 面朝下的話從上面看是黑的。
    eachDecal((geo, label) => {
      const n = geo.getAttribute('normal');
      for (let i = 0; i < n.count; i++) {
        expect(n.getY(i), `${label} 頂點 ${i} 沒有朝上`).toBeGreaterThan(0.99);
      }
    });
  });

  it('should never overlap the building footprint or reach the neighbour', () => {
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        const inner = narrowestOf(z, d, level);
        for (const build of getDecalVariants(z, d, level)) {
          const geo = build();
          const pos = geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const m = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
            expect(m, `${key} L${level} 頂點 ${i} 鋪進建築裡`)
              .toBeGreaterThanOrEqual(inner - 1e-6);
            expect(m, `${key} L${level} 頂點 ${i} 鋪到鄰居家`)
              .toBeLessThanOrEqual(CELL_EDGE + 1e-6);
          }
          geo.dispose();
        }
      }
    });
  });

  it('should only use the ground or foliage tags', () => {
    // 標成 PART_WALL 會長出窗戶；標成 PART_ROOF 會拿到屋瓦顏色。
    eachDecal((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const p = col.getX(i);
        const ok = (p > 0.35 && p < 0.65) || (p > 0.65 && p < 0.8);
        expect(ok, `${label} 頂點 ${i} 標籤 ${p}`).toBe(true);
      }
    });
  });

  it('should keep the shade channel inside [0, 1]', () => {
    eachDecal((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        expect(col.getZ(i), `${label} 頂點 ${i} 明度越界`).toBeGreaterThanOrEqual(0);
        expect(col.getZ(i), `${label} 頂點 ${i} 明度越界`).toBeLessThanOrEqual(1);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachDecal((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(TRIANGLE_BUDGET.PROP);
    });
  });

  it('should make the forecourt better with every level', () => {
    // 規格修訂 4：等級要看得出更高級。素土 -> 鋪面 -> 廣場／標線。
    eachBucket((z, d, key) => {
      const tri = (lv: number) => getDecalVariants(z, d, lv)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; })
        .reduce((a, b) => a + b, 0);
      expect(tri(2), `${key} L2 沒有比 L1 好`).toBeGreaterThanOrEqual(tri(1));
      expect(tri(3), `${key} L3 沒有比 L1 好`).toBeGreaterThan(tri(1));
    });
  });

  it('should give industrial the darkest forecourt and commercial a paler one', () => {
    // 柏油廠區與磚鋪商業街是兩種完全不同的觀感。兩者若一樣，
    // 這一層就只是替所有分區加了同一塊灰色地毯。
    const meanShade = (z: number, d: Density) => {
      const geo = getDecalVariants(z, d, 3)[0]!();
      const col = geo.getAttribute('color');
      let sum = 0;
      let n = 0;
      for (let i = 0; i < col.count; i++) {
        if (col.getX(i) > 0.65 && col.getX(i) < 0.8) { sum += col.getZ(i); n++; }
      }
      geo.dispose();
      return n === 0 ? 0 : sum / n;
    };
    expect(meanShade(5, 'LOW')).toBeLessThan(meanShade(4, 'HIGH'));
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getDecalVariants, DECAL_Y, MARK_Y } from '../geometry/buildings/decals';
import { buildingEdge } from '../geometry/buildings/propBands';
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
      const inner = buildingEdge(z, d)!;
      for (const level of LEVELS) {
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

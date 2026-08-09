import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  yardRing, hasGroundProps, getGroundPropVariants, PROP_TRIANGLE_BUDGET,
} from '../geometry/buildings/groundProps';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, LEVELS, type Density }
  from '../geometry/buildings/registry';
import { triangleCount } from '../geometry/buildings/parts';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

describe('yardRing', () => {
  it('should give the low-density house a yard worth looking at', () => {
    const ring = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW');
    expect(ring).not.toBeNull();
    // 1 m 以上才放得下看得見的樹籬與樹。
    expect((ring!.outer - ring!.inner) * METRES_PER_CELL).toBeGreaterThan(1.0);
  });

  it('should give every zone a yard now that the buildings made room', () => {
    // 階段 2B 時只有住宅低過關；階段 2B-2 縮寬之後每個分區都有 0.4 m 以上。
    // 這一條以前是「鋪滿基地的分區沒有院子」，用「寬度 == 9.8」當篩選條件 ——
    // 寬度一改就一個也選不中，測試從此空轉。
    for (const key of Object.keys(TARGET_WIDTHS_M)) {
      const [zs, ds] = key.split(':');
      expect(yardRing(Number(zs), ds as Density), key).not.toBeNull();
    }
  });

  it('should never let the yard reach past the pedestrian envelope', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      const ring = yardRing(Number(zs), ds as Density);
      if (!ring) continue;
      expect(ring.outer, key).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    }
  });

  it('should start the yard outside the widest the building can jitter to', () => {
    // 內緣若只用目標寬度而不含抖動，抖到最寬的那些房子會長進樹籬裡。
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      const ring = yardRing(Number(zs), ds as Density);
      if (!ring) continue;
      const targetHalf = TARGET_WIDTHS_M[key]! / METRES_PER_CELL / 2;
      expect(ring.inner, key).toBeGreaterThanOrEqual(targetHalf);
    }
  });
});

describe('ground prop geometry', () => {
  function eachProp(fn: (geo: THREE.BufferGeometry, label: string) => void) {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      const zoneType = Number(zs);
      const density = ds as Density;
      for (const level of LEVELS) {
        const variants = getGroundPropVariants(zoneType, density, level);
        for (let i = 0; i < variants.length; i++) {
          const geo = variants[i]!();
          fn(geo, `${key} L${level} v${i}`);
          geo.dispose();
        }
      }
    }
  }

  it('should keep every prop inside the pedestrian envelope', () => {
    // 外側越界 = 行人穿過樹籬。
    eachProp((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const outer = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      expect(outer, `${label} 外緣`).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    });
  });

  it('should not put anything inside the house footprint', () => {
    // 每個頂點都必須滿足 max(|x|,|z|) >= inner —— 只看包圍盒會漏掉
    // 「一棵樹橫跨房子」這種情形。
    const ring = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW')!;
    for (const level of LEVELS) {
      for (const build of getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)) {
        const geo = build();
        const pos = geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const m = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
          expect(m, `L${level} 頂點 ${i} 落在房子裡`).toBeGreaterThanOrEqual(ring.inner - 1e-6);
        }
        geo.dispose();
      }
    }
  });

  it('should sit on the ground, not float', () => {
    eachProp((geo, label) => {
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y, `${label} 埋進地下`).toBeGreaterThanOrEqual(-1e-6);
      expect(geo.boundingBox!.min.y, `${label} 浮空`).toBeLessThan(0.02);
    });
  });

  it('should stay inside the triangle budget', () => {
    eachProp((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(PROP_TRIANGLE_BUDGET);
    });
  });

  it('should never tag a prop as wall — walls grow windows', () => {
    // PART_WALL 會走 shader 的立面分支，樹幹會長出一格一格的窗。
    eachProp((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        expect(col.getX(i), `${label} 頂點 ${i} 標成 PART_WALL`).toBeGreaterThan(0.1);
      }
    });
  });

  it('should make the residential garden greener with every level', () => {
    // 規格修訂 4：等級要看得出更高級。素土院子 -> 樹籬 -> 修剪庭園。
    //
    // 量綠化而不是量三角形總數：L1 的四道木柵柱子多但便宜，L2 換成樹之後
    // 總數反而更低 —— 三角形數不是「豪華」的代理，綠化面積才是。
    const foliage = (level: number) =>
      getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)
        .map((b) => {
          const g = b();
          const col = g.getAttribute('color');
          let n = 0;
          for (let i = 0; i < col.count; i++) {
            if (col.getX(i) > 0.35 && col.getX(i) < 0.65) n++;
          }
          g.dispose();
          return n;
        })
        .reduce((a, b) => a + b, 0);
    expect(foliage(2), 'L2 沒有比 L1 綠').toBeGreaterThan(foliage(1));
    expect(foliage(3), 'L3 沒有比 L2 綠').toBeGreaterThan(foliage(2));
  });

  it('should make every zone richer with every level', () => {
    // 非住宅分區的「更高級」不是更綠，是更多街道家具。用同一等級裡最豐富的
    // 那個組合來比 —— 用總和會被「零件多但便宜」的組合帶偏。
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      const richest = (level: number) => Math.max(
        ...getGroundPropVariants(Number(zs), ds as Density, level)
          .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; }),
      );
      expect(richest(3), `${key} L3 沒有比 L1 豐富`).toBeGreaterThan(richest(1));
      expect(richest(2), `${key} L2 沒有比 L1 豐富`).toBeGreaterThan(richest(1));
    }
  });

  it('should offer at least four yards per level', () => {
    // 兩個變體配四向旋轉是 8 種面貌，一個 8x8 街廓看得出重複。
    for (const level of LEVELS) {
      expect(getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level).length,
        `L${level}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('should give every zone something standing on the ground', () => {
    // 階段 2B-2 縮寬的目的：不再只有住宅區有立體小物。
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        expect(getGroundPropVariants(Number(zs), ds as Density, level).length,
          `${key} L${level}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('should use a vocabulary wider than a handful of shapes', () => {
    // 「類型太少」的機器可檢查形式。不同零件的三角形數不同，所以把所有
    // 變體的三角形數集合起來，集合大小是詞彙量的下界。
    const sizes = new Set<number>();
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        for (const b of getGroundPropVariants(Number(zs), ds as Density, level)) {
          const g = b();
          sizes.add(triangleCount(g));
          g.dispose();
        }
      }
    }
    expect(sizes.size, '所有庭院組合只有 ' + sizes.size + ' 種三角形數')
      .toBeGreaterThanOrEqual(8);
  });

  it('should keep every zone inside its own band, not just residential', () => {
    // 其他分區的帶子只有 0.4 m，比住宅低的 1.45 m 窄得多 —— 沿用住宅的
    // 尺寸會直接穿牆。
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      const ring = yardRing(Number(zs), ds as Density)!;
      for (const level of LEVELS) {
        for (const build of getGroundPropVariants(Number(zs), ds as Density, level)) {
          const geo = build();
          const pos = geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const m = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
            expect(m, `${key} L${level} 頂點 ${i} 落在建築裡`)
              .toBeGreaterThanOrEqual(ring.inner - 1e-6);
            expect(m, `${key} L${level} 頂點 ${i} 擋住行人`)
              .toBeLessThanOrEqual(ring.outer + 1e-6);
          }
          geo.dispose();
        }
      }
    }
  });

  it('should give two variants of the same level genuinely different yards', () => {
    for (const level of LEVELS) {
      const [a, b] = getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level);
      const ga = a!();
      const gb = b!();
      ga.computeBoundingBox();
      gb.computeBoundingBox();
      expect(ga.boundingBox!.equals(gb.boundingBox!), `L${level} 兩個變體外形相同`).toBe(false);
      ga.dispose();
      gb.dispose();
    }
  });

  it('should agree with hasGroundProps', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        const has = hasGroundProps(Number(zs), ds as Density, level);
        expect(getGroundPropVariants(Number(zs), ds as Density, level).length > 0).toBe(has);
      }
    }
  });
});

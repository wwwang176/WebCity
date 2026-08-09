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

  it('should give a plot-filling zone no yard at all', () => {
    // 目標寬度就是包絡線的分區沒有留白，這是幾何事實不是遺漏。
    for (const key of Object.keys(TARGET_WIDTHS_M)) {
      if (TARGET_WIDTHS_M[key] !== MAX_BUILDING_WIDTH_M) continue;
      const [zs, ds] = key.split(':');
      expect(yardRing(Number(zs), ds as Density), key).toBeNull();
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

  it('should make the garden better with every level', () => {
    // 規格修訂 4：等級要看得出更高級。素土院子 -> 樹籬 -> 修剪庭園。
    const tri = (level: number) =>
      getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; })
        .reduce((a, b) => a + b, 0);
    expect(tri(2)).toBeGreaterThan(tri(1));
    expect(tri(3)).toBeGreaterThan(tri(2));
  });

  it('should offer more than one yard per level', () => {
    // 只有一種庭院的話，整條街的院子會一模一樣 —— 換一個地方重複而已。
    for (const level of LEVELS) {
      expect(getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level).length)
        .toBeGreaterThanOrEqual(2);
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

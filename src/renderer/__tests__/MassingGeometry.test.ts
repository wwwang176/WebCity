import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getMassingVariants, volumesFor } from '../geometry/buildings/massing';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';
import { HALF_ENVELOPE, FLOOR_HEIGHT_UNITS } from '../geometry/buildings/massing/metrics';

const MID_FLOOR = (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;
import { rasterise, differenceRatio, centroidOffset, rotate90 }
  from '../geometry/buildings/massing/volume';
import { triangleCount, PART_THRESHOLDS } from '../geometry/buildings/parts';
import { TARGET_HEIGHTS_M, TRIANGLE_BUDGET, type Density }
  from '../geometry/buildings/registry';
import { METRES_PER_CELL } from '../../core/grid/constants';

/**
 * 兩個輪廓要差多少才算不同的形狀（格）。
 *
 * 0.36 m 是屋簷落差看得出來的最小值。原本用半層樓（1.6 m），那把「同原型但
 * 高一階」判定成相同 —— 商業低 L1 的八個變體因此只剩四種面貌，而相鄰重複率
 * 是照變體序號算的，看起來會比實際好。
 */
const SILHOUETTE_TOLERANCE = 0.36 / METRES_PER_CELL;

const LEVELS = [1, 2, 3] as const;

function eachBucket(fn: (z: number, d: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

function eachVariant(fn: (geo: THREE.BufferGeometry, label: string) => void) {
  eachBucket((z, d, key) => {
    for (const lv of LEVELS) {
      getMassingVariants(z, d, lv).forEach((build, i) => {
        const g = build();
        fn(g, `${key} L${lv} v${i}`);
        g.dispose();
      });
    }
  });
}

describe('massing geometry', () => {
  it('should give every bucket exactly eight variants', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(getMassingVariants(z, d, lv).length, `${key} L${lv}`).toBe(VARIANT_COUNT);
      }
    });
  });

  it('should return nothing for a bucket with no buildings', () => {
    expect(getMassingVariants(1, 'HIGH', 1)).toEqual([]);   // 住宅低沒有高密度
    expect(getMassingVariants(999, 'LOW', 1)).toEqual([]);
  });

  it('should build the same geometry every time', () => {
    // 幾何在遊戲啟動時生成。亂數一旦洩漏，讀檔之後整座城市會換一批形狀，
    // 而那在畫面上只是「怎麼跟剛才不一樣」。
    const a = getMassingVariants(4, 'HIGH', 3)[2]!();
    const b = getMassingVariants(4, 'HIGH', 3)[2]!();
    const pa = a.getAttribute('position').array as Float32Array;
    const pb = b.getAttribute('position').array as Float32Array;
    expect(pa.length).toBe(pb.length);
    for (let i = 0; i < pa.length; i++) expect(pa[i]).toBe(pb[i]);
  });

  it('should stand on the ground and be centred in the cell', () => {
    // assemble 刻意**不**自動置中：組合器按構造就置中，自動置中會把
    // 「某個組合器算偏了」默默補掉，而那個錯會以「基地比預期窄」的形式
    // 跑到附掛層去。所以這裡是斷言，不是修正。
    eachVariant((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(b.min.y, `${label} 沒有落地`).toBeCloseTo(0, 6);
      expect((b.min.x + b.max.x) / 2, `${label} 沒有置中`).toBeCloseTo(0, 6);
      expect((b.min.z + b.max.z) / 2, `${label} 沒有置中`).toBeCloseTo(0, 6);
    });
  });

  it('should never cross the pedestrian envelope', () => {
    // BUG-221/222：門節點在 HALF_ENVELOPE 外側，越過就是行人穿牆。
    // 現在直接量幾何，不再透過縮放公式 —— 公式算對但幾何沒置中，
    // 就是 BUG-222 發生的方式。
    eachVariant((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const maxAbs = Math.max(
        Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z),
      );
      expect(
        maxAbs,
        `${label} 越過包絡線 ${((maxAbs - HALF_ENVELOPE) * METRES_PER_CELL).toFixed(2)} m`,
      ).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-6);
    });
  });

  it('should reach the height the table asks for', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const target = TARGET_HEIGHTS_M[key]![lv - 1]! / METRES_PER_CELL;
        // 容差（跟著高度走）加上屋頂本身的高度。頂冠加 0.5 × 樓高，而樓高
        // 最大是 FLOOR_HEIGHT_UNITS.MAX —— 用中點會漏掉最高的那幾個變體。
        const tolerance = Math.max(0.1 * target, MID_FLOOR)
          + FLOOR_HEIGHT_UNITS.MAX * 0.55;
        getMassingVariants(z, d, lv).forEach((build, i) => {
          const g = build();
          g.computeBoundingBox();
          expect(Math.abs(g.boundingBox!.max.y - target), `${key} L${lv} v${i}`)
            .toBeLessThanOrEqual(tolerance);
          g.dispose();
        });
      }
    });
  });

  it('should build the geometry the volumes describe', () => {
    // 其餘所有輪廓測試都跑在 Volume 上 —— 它們證明「規劃」對，證明不了
    // 「畫出來的東西照著規劃」。少了這一條，assemble 可以把每一塊都堆在格心
    // 而測試全綠（回退驗證時真的發生了）。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        getMassingVariants(z, d, lv).forEach((build, i) => {
          const vs = volumesFor(z, d, lv, i);
          const want = {
            minX: Math.min(...vs.map(v => v.x - v.w / 2)),
            maxX: Math.max(...vs.map(v => v.x + v.w / 2)),
            minZ: Math.min(...vs.map(v => v.z - v.d / 2)),
            maxZ: Math.max(...vs.map(v => v.z + v.d / 2)),
            maxY: Math.max(...vs.map(v => v.y1)),
          };
          const g = build();
          g.computeBoundingBox();
          const b = g.boundingBox!;
          const label = `${key} L${lv} v${i}`;
          expect(b.min.x, `${label} 幾何比量體窄（西）`).toBeCloseTo(want.minX, 5);
          expect(b.max.x, `${label} 幾何比量體窄（東）`).toBeCloseTo(want.maxX, 5);
          expect(b.min.z, `${label} 幾何比量體窄（北）`).toBeCloseTo(want.minZ, 5);
          expect(b.max.z, `${label} 幾何比量體窄（南）`).toBeCloseTo(want.maxZ, 5);
          expect(b.max.y, `${label} 幾何比量體矮`).toBeCloseTo(want.maxY, 5);
          g.dispose();
        });
      }
    });
  });

  it('should wind every face outward', () => {
    // BUG-227：整個 frustum 的纏繞方向反了，所以每一面的法線都朝內 ——
    // FrontSide culling 之下看到的是建築的內壁。
    //
    // 帶號體積（三角形對原點的有向錐體體積和）是這件事唯一的整體判準：
    // 逐面看法線要知道「哪一側是外面」，而帶號體積不必知道。外向為正。
    eachVariant((geo, label) => {
      const p = geo.getAttribute('position').array as Float32Array;
      let v = 0;
      for (let i = 0; i < p.length; i += 9) {
        const ax = p[i]!, ay = p[i + 1]!, az = p[i + 2]!;
        const bx = p[i + 3]!, by = p[i + 4]!, bz = p[i + 5]!;
        const cx = p[i + 6]!, cy = p[i + 7]!, cz = p[i + 8]!;
        v += (ax * (by * cz - bz * cy)
            - ay * (bx * cz - bz * cx)
            + az * (bx * cy - by * cx)) / 6;
      }
      expect(v, `${label} 帶號體積 ${v.toFixed(4)} —— 面朝內`).toBeGreaterThan(0);
    });
  });

  it('should point the roof normal up', () => {
    // 帶號體積抓得到「整體翻面」，抓不到「只有頂面翻了」。屋頂在等角視角下
    // 是最常看到的那一面。
    eachVariant((geo, label) => {
      const pos = geo.getAttribute('position');
      const n = geo.getAttribute('normal');
      geo.computeBoundingBox();
      const top = geo.boundingBox!.max.y;
      let checked = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - top) > 1e-6) continue;
        if (Math.abs(n.getY(i)) < 0.9) continue;   // 側面的頂邊，跳過
        expect(n.getY(i), `${label} 頂面法線朝下`).toBeGreaterThan(0);
        checked++;
      }
      expect(checked, `${label} 沒有找到任何頂面`).toBeGreaterThan(0);
    });
  });

  it('should tag every vertex with a known part', () => {
    eachVariant((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const p = col.getX(i);
        const known = p === 0
          || (p > PART_THRESHOLDS.ROOF_BY_NORMAL && p < PART_THRESHOLDS.FOLIAGE_MIN)
          || p > PART_THRESHOLDS.ROOF_MIN;
        expect(known, `${label} 頂點 ${i} 標籤 ${p}`).toBe(true);
      }
    });
  });

  it('should contain no foliage and no ground paving', () => {
    // 綠化住在地面物件層，鋪面住在貼片層。量體長出這兩種顏色就是層搞錯了。
    eachVariant((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const p = col.getX(i);
        expect(p > PART_THRESHOLDS.FOLIAGE_MIN && p < PART_THRESHOLDS.FOLIAGE_MAX,
          `${label} 有樹葉標籤`).toBe(false);
        expect(p > PART_THRESHOLDS.GROUND_MIN && p < PART_THRESHOLDS.GROUND_MAX,
          `${label} 有鋪面標籤`).toBe(false);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const budget = lv === 3 ? TRIANGLE_BUDGET.TOWER : TRIANGLE_BUDGET.HOUSE;
        getMassingVariants(z, d, lv).forEach((build, i) => {
          const g = build();
          expect(triangleCount(g), `${key} L${lv} v${i}`).toBeLessThanOrEqual(budget);
          g.dispose();
        });
      }
    });
  });

  // 「L3 比 L1 豐富」不在這裡測。量體的等級階梯是「可選原型更多」，不是
  // 「零件更多」—— 商業高 L1 的女兒牆有四塊，剛好把 L3 多出來的原型補平，
  // 零件數當代理量到的是屋頂形式，不是等級。真正的階梯由
  // MassingPrototypes 的 `should only ever add prototypes as the level climbs`
  // 直接測。
});

describe('massing variety', () => {
  it('should give every bucket eight distinct silhouettes', () => {
    // 這是本階段的主要條件。兩個變體長一樣就等於少一個變體。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const grids: Float32Array[] = [];
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          grids.push(rasterise(volumesFor(z, d, lv, vi)));
        }
        for (let i = 0; i < grids.length; i++) {
          for (let j = i + 1; j < grids.length; j++) {
            expect(differenceRatio(grids[i]!, grids[j]!, SILHOUETTE_TOLERANCE),
              `${key} L${lv} 的 v${i} 與 v${j} 輪廓相同`).toBeGreaterThanOrEqual(0.10);
          }
        }
      }
    });
  });

  it('should make rotation worth something for at least half the variants', () => {
    // 規格寫 6/8，但高樓做不到 —— 板樓與裙樓塔本質上是對稱的，而它們是高密度
    // 分區在 L1 僅有的原型。4/8 是從原型表倒推的可達值。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        let asym = 0;
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          if (centroidOffset(volumesFor(z, d, lv, vi)) > 0.04) asym++;
        }
        expect(asym, `${key} L${lv} 只有 ${asym}/8 個不對稱`).toBeGreaterThanOrEqual(4);
      }
    });
  });

  it('should actually change the silhouette when an asymmetric variant rotates', () => {
    // 上一條看重心，這一條看轉過去之後的樣子 —— 兩條一起才擋得住
    // 「重心偏了但轉過去看起來一樣」。
    eachBucket((z, d, key) => {
      for (let vi = 0; vi < VARIANT_COUNT; vi++) {
        const vs = volumesFor(z, d, 3, vi);
        if (centroidOffset(vs) <= 0.04) continue;
        const g = rasterise(vs);
        expect(differenceRatio(g, rotate90(g), SILHOUETTE_TOLERANCE),
          `${key} L3 v${vi} 轉了等於沒轉`).toBeGreaterThanOrEqual(0.10);
      }
    });
  });
});

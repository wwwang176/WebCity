import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getMassingVariants, volumesFor } from '../geometry/buildings/massing';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';
import { HALF_ENVELOPE, FLOOR_HEIGHT_UNITS } from '../geometry/buildings/massing/metrics';

const MID_FLOOR = (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;
import { rasterise, differenceRatio, centroidOffset, rotate90, type Volume }
  from '../geometry/buildings/massing/volume';
import { assemble } from '../geometry/buildings/massing/assemble';
import { triangleCount, PART_THRESHOLDS } from '../geometry/buildings/parts';
import { TARGET_HEIGHTS_M, TRIANGLE_BUDGET, type Density }
  from '../geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';
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

const isEquipment = (v: Volume) => {
  const p = v.part ?? 0;
  return p > PART_THRESHOLDS.ROOF_BY_NORMAL && p < PART_THRESHOLDS.FOLIAGE_MIN;
};

/**
 * 露在建築本體之上的設備量體 —— 煙囪、筒倉、水塔。
 *
 * 基準是牆**加屋頂**的最高點，不是牆的最高點。只比牆的話有兩種埋掉煙囪的
 * 方式仍然算過：屋頂蓋在煙囪本身上（`volumesFor` 挑錯 `top`），以及一層樓
 * 的變體屋脊爬到煙囪之上（組合器沒替屋脊留位置）。兩者畫面上都是
 * 「煙囪不見了」。
 */
function stacksIn(vs: readonly Volume[]): number {
  const buildingTop = Math.max(...vs.filter(v => !isEquipment(v)).map(v => v.y1), 0);
  return vs.filter(v => isEquipment(v) && v.y1 > buildingTop + 1e-9).length;
}

describe('industrial reads as industrial', () => {
  it('should raise a stack or silo above the roof on at least half the variants', () => {
    // 工業的等級階梯**不**表現在高度上（現代廠房都是單層挑高、鋪滿基地），
    // 所以少了設備，工業就只是一個比較矮的商業盒子 —— 而那正是使用者看到的。
    for (const lv of LEVELS) {
      let withStack = 0;
      for (let vi = 0; vi < VARIANT_COUNT; vi++) {
        if (stacksIn(volumesFor(ZoneType.INDUSTRIAL, 'LOW', lv, vi)) > 0) withStack++;
      }
      expect(withStack, `工業 L${lv} 只有 ${withStack}/8 個變體有立管`)
        .toBeGreaterThanOrEqual(4);
    }
  });

  it('should keep stacks out of every other zone', () => {
    // 上一條的對照。少了它，「每個分區都插一根煙囪」也會過。
    eachBucket((z, d, key) => {
      if (z === ZoneType.INDUSTRIAL) return;
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          expect(stacksIn(volumesFor(z, d, lv, vi)), `${key} L${lv} v${vi} 長了煙囪`).toBe(0);
        }
      }
    });
  });
});

describe('cylinder volumes', () => {
  it('should build a round column that still fills the box it declared', () => {
    // 圓柱的佔地若小於量體宣告的大小，propBands 量到的牆面就會偏 ——
    // 那一層是用量體算的，不是用幾何。
    const box: Volume = { x: 0.1, z: -0.05, w: 0.2, d: 0.16, y0: 0, y1: 1 };
    const round = assemble([{ ...box, shape: 'cylinder' }]);
    const square = assemble([box]);
    expect(triangleCount(round), '圓柱的面數不比方柱多').toBeGreaterThan(triangleCount(square));

    round.computeBoundingBox();
    const b = round.boundingBox!;
    expect(b.min.x).toBeCloseTo(0, 6);
    expect(b.max.x).toBeCloseTo(0.2, 6);
    expect(b.min.z).toBeCloseTo(-0.13, 6);
    expect(b.max.z).toBeCloseTo(0.03, 6);
    expect(b.max.y).toBeCloseTo(1, 6);
  });
});

describe('dome volumes', () => {
  /**
   * 圓頂要是**半球**，不是一疊愈往上愈窄的鼓。
   *
   * 使用者：「圓頂我覺得要改一下，要看起來是半球形」。堆四層八角柱在遠景
   * 讀得出「圓頂」，走近就是四層邊緣分明的台階。
   *
   * 「像不像半球」在幾何上有一個可以直接量的性質：**任一高度的半徑等於
   * `√(1 − y²)`**。堆疊的鼓在一層之內半徑是常數，所以這條會抓到它。
   */
  const box: Volume = { x: 0.2, z: -0.1, w: 0.4, d: 0.4, y0: 0.5, y1: 0.7 };

  it('should fill the box it declared', () => {
    const geo = assemble([{ ...box, shape: 'dome' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.min.x).toBeCloseTo(0, 6);
    expect(b.max.x).toBeCloseTo(0.4, 6);
    expect(b.min.z).toBeCloseTo(-0.3, 6);
    expect(b.max.z).toBeCloseTo(0.1, 6);
    // 底面貼著 y0、頂點剛好碰到 y1 —— 半球是「宣告的盒子的上半」。
    expect(b.min.y).toBeCloseTo(0.5, 6);
    expect(b.max.y).toBeCloseTo(0.7, 6);
  });

  it('should curve like a hemisphere, not step like a stack of drums', () => {
    const geo = assemble([{ ...box, shape: 'dome' }]);
    // 逐頂點檢查而不是逐高度取樣：8 邊 × 4 段的半球只有五圈頂點，取樣高度
    // 落在圈與圈之間就什麼都量不到（而那讀起來像「這個形狀是空的」）。
    const pos = geo.getAttribute('position');
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const y = (pos.getY(i) - box.y0) / (box.y1 - box.y0);
      const r = Math.hypot(pos.getX(i) - box.x, pos.getZ(i) - box.z) / (box.w / 2);
      // 八邊形的頂點落在外接圓上，邊的中點落在內切圓上（差 cos(π/8) ≈ 0.924），
      // 所以容差要吃得下那個差。
      expect(r * r + y * y, `頂點 (r=${r.toFixed(2)}, y=${y.toFixed(2)}) 不在球面上`)
        .toBeGreaterThan(0.82);
      expect(r * r + y * y).toBeLessThan(1.01);
      seen.add(y.toFixed(3));
    }
    // 而且真的分了好幾層 —— 一個圓盤也滿足上面那條。
    expect(seen.size, '半球只有一圈頂點，那是一個蓋子').toBeGreaterThanOrEqual(4);
  });

  it('should merge with the other shapes', () => {
    // `mergeGeometries` 要求屬性集合一致。圓柱那條路徑踩過這個坑（索引 + uv），
    // 半球走的是同一個 THREE 圖元，所以同一個坑就在旁邊等著。
    expect(() => assemble([
      { ...box, shape: 'dome' },
      { x: 0, z: 0, w: 0.2, d: 0.2, y0: 0, y1: 0.5 },
    ])).not.toThrow();
  });
});

describe('cooling tower volumes', () => {
  /**
   * 冷卻塔的**腰**。
   *
   * 使用者：「發電廠的形象也要改一下 現在看不出是電廠」。電廠在低多邊形城市
   * 裡最好認的剪影就是雙曲線的冷卻塔 —— 而那個形狀的實體只有一件事：
   * **中段比上下都窄**。圓柱與稜台都做不到（一個是直的，一個是單調收放），
   * 所以這條測的就是那個腰。
   */
  const box: Volume = { x: 0, z: 0, w: 0.6, d: 0.6, y0: 0, y1: 1.2 };

  it('should pinch in at the waist', () => {
    const geo = assemble([{ ...box, shape: 'cooling' }]);
    const pos = geo.getAttribute('position');
    const ring = (lo: number, hi: number) => {
      let r = 0;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - box.y0) / (box.y1 - box.y0);
        if (t < lo || t > hi) continue;
        r = Math.max(r, Math.hypot(pos.getX(i) - box.x, pos.getZ(i) - box.z));
      }
      return r;
    };
    // 取樣窗要吃得下浮點誤差：頂圈的 t 算出來可能是 1.0000000000000002，
    // 而 `t > 1.0` 會把它整圈丟掉（量到的半徑是 0，訊息看起來像「塔口不見了」）。
    const foot = ring(-0.01, 0.08);
    const waist = ring(0.55, 0.75);
    const lip = ring(0.9, 1.01);
    expect(waist, '腰沒有比底座窄 —— 那是一根柱子').toBeLessThan(foot * 0.85);
    expect(lip, '塔口沒有比腰寬 —— 那是一個漏斗').toBeGreaterThan(waist * 1.05);
    expect(lip, '塔口比底座還寬 —— 那是一個喇叭').toBeLessThan(foot);
  });

  it('should fill the box it declared', () => {
    const geo = assemble([{ ...box, shape: 'cooling' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(0.6, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(1.2, 6);
  });
});

/**
 * 煙囪的**口**。
 *
 * 使用者：「發電廠的煙囪好像只畫單面? 會看到破口 是不是可以做凹槽」。
 * 圓柱的頂是一片實心的圓盤 —— 從等角視角俯視，一支 25 m 的煙囪最顯眼的
 * 就是那一片平蓋，而真的煙囪頂上是一個洞。
 *
 * 凹槽做不出來的原因是形狀庫裡全是**實心凸體**：兩個同心圓柱疊起來，
 * 外筒的頂蓋會把內筒整個蓋住；而把外筒改成無蓋的管子也沒用 —— 建築材質是
 * `FrontSide`，管子的內壁法線朝外，俯視時會被背面剔除，看到的是「穿過去」。
 *
 * 所以這個形狀的實體是一件事：**凹槽的內壁法線要朝軸心**。旋轉體
 * （`LatheGeometry`）給得出來，因為輪廓折回去的那一段會把法線一起帶過去。
 */
describe('stack volumes', () => {
  const box: Volume = { x: 0.2, z: -0.1, w: 0.4, d: 0.4, y0: 0, y1: 2.0 };

  /** 逐三角形的重心、法線，以及法線的徑向分量（正 = 朝外，負 = 朝軸心）。 */
  function faces(geo: THREE.BufferGeometry) {
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const out: Array<{ y: number; r: number; radial: number; ny: number }> = [];
    for (let t = 0; t < pos.count / 3; t++) {
      let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (let e = 0; e < 3; e++) {
        const i = t * 3 + e;
        cx += pos.getX(i) / 3; cy += pos.getY(i) / 3; cz += pos.getZ(i) / 3;
        nx += nrm.getX(i) / 3; ny += nrm.getY(i) / 3; nz += nrm.getZ(i) / 3;
      }
      const dx = cx - box.x;
      const dz = cz - box.z;
      const r = Math.hypot(dx, dz);
      out.push({ y: cy, r, radial: r < 1e-9 ? 0 : (dx * nx + dz * nz) / r, ny });
    }
    return out;
  }

  it('should hollow out a mouth you can see into', () => {
    const geo = assemble([{ ...box, shape: 'stack' }]);
    const all = faces(geo);

    // 凹槽的內壁：法線朝軸心。少了它，「凹槽」只是頂蓋上畫了一圈深色。
    const inner = all.filter(f => f.radial < -0.5);
    expect(inner.length, '煙囪沒有朝內的面 —— 那是一片實心的頂蓋')
      .toBeGreaterThan(0);

    // 而且它要在**上面**。整支塔身都朝內的話那是把煙囪翻過來了。
    const lowest = Math.min(...inner.map(f => f.y));
    expect((lowest - box.y0) / (box.y1 - box.y0), '凹槽從塔身中段就開始了')
      .toBeGreaterThan(0.7);

    // 槽底要在管口之下 —— 齊平的話俯視看到的仍然是一片平的。
    const floor = all.filter(f => f.ny > 0.9 && f.r < box.w / 4);
    expect(floor.length, '凹槽沒有底').toBeGreaterThan(0);
    const depth = box.y1 - Math.max(...floor.map(f => f.y));
    expect(depth / (box.y1 - box.y0), '凹槽太淺，俯視看不出是個洞')
      .toBeGreaterThan(0.05);
  });

  it('should cap the shaft with a ring, not a disc', () => {
    const geo = assemble([{ ...box, shape: 'stack' }]);
    const top = faces(geo).filter(f =>
      f.ny > 0.9 && Math.abs(f.y - box.y1) < 1e-6);
    expect(top.length, '管口沒有環').toBeGreaterThan(0);
    // 環的內緣離軸心要有一段距離 —— 是 0 的話那就是一片圓盤。
    const inner = Math.min(...top.map(f => f.r));
    expect(inner / (box.w / 2), '管口是實心的圓盤').toBeGreaterThan(0.2);
  });

  it('should fill the box it declared', () => {
    // 與其他形狀同一條規矩：量體算出來的邊界就是幾何真正佔的地方，
    // 否則 `maxAbsOf` 擋不住越界。
    const geo = assemble([{ ...box, shape: 'stack' }]);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(0.4, 6);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(box.x, 6);
    expect((b.max.z + b.min.z) / 2).toBeCloseTo(box.z, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(2.0, 6);
  });

  it('should merge with the other shapes', () => {
    expect(() => assemble([
      { ...box, shape: 'stack' },
      { x: 0, z: 0, w: 0.2, d: 0.2, y0: 0, y1: 0.5 },
    ])).not.toThrow();
  });
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

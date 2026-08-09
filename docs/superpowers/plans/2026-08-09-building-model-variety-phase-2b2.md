# 建築模型多樣性 階段 2B-2 — 地面物件擴編至所有分區 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 把地面物件從「只有住宅低密度、只有四種零件」擴編到每個分區都有、詞彙足夠豐富。

**Architecture：** 地面物件的放置規則從一類變成三類 —— 貼片、矮物件、懸挑物件。三者的可用空間各自由不同的限制推導，其中**貼片與懸挑對每個分區都成立**，不需要動任何建築尺寸。三類共用既有的 `InstancedLayer`，只是桶的類別與陰影設定不同。

**Tech Stack：** TypeScript、Three.js、Vitest。

## Global Constraints

- `src/core/` 一律不得 import Three.js。
- TDD 強制：先寫失敗測試 → 跑到紅 → 最小實作 → 跑到綠 → commit。
- **每支新測試都要做回退驗證**：把修改改回原樣，確認測試轉紅，再改回來。
- 發現的 Bug 必須寫進 `BUGS.md` 與 `TODO.md`。
- 單一事實來源：`MAX_BUILDING_WIDTH_M`、`METRES_PER_CELL`、`TARGET_WIDTHS_M`、`widthJitterFor` 皆為既有，一律引用。
- 展示區看到的必須等於遊戲畫出來的。
- 三角形預算：貼片 `PROP` 240 不變；懸挑另計 120。

---

## 背景：上一輪的結論只對了三分之一

階段 2B 的結論是「只有住宅低密度有地面物件，其餘分區沒有留白，這是幾何事實」。
那個推導只考慮了一種放置方式 —— **站在地上、佔據高度的立體物件**，它必須避開
行人繞行建築的路徑（`BUILDING_HALF_SIZE = 0.4083`）。

實際上有三種放置方式，限制各不相同：

| 類別 | 限制 | 可用空間 |
|---|---|---|
| **貼片**（完全平，y ≈ 0.01） | 只要不與建築量體重疊。行人走在上面 —— 那本來就是人行道 | 建築外緣 → **格子邊界 0.5** |
| **矮物件**（高度 < 2 m） | 行人會撞到，必須在包絡線 0.4083 以內 | 建築外緣 → 0.4083 |
| **懸挑物件**（最低點 > 2.2 m） | 行人從下面走過 | 建築外緣 → 格子邊界 0.5，最低點 ≥ 0.1833 |

**貼片與懸挑對每個分區都有空間，而且不必動任何已確認的建築尺寸。**

各分區實際可用的三個帶寬（`up` 為向上抖動，鋪滿基地者為 0）：

| 分區 | 目標寬 | 建築外緣 | 貼片帶 | 矮物件帶 | 懸挑帶 |
|---|---|---|---|---|---|
| 住宅低 | 6.0 m | 0.2875 | **2.55 m** | **1.45 m** | 2.55 m |
| 商業低 | 8.4 m | 0.4025 | **1.17 m** | 0.07 m（無） | 1.17 m |
| 辦公低 | 8.4 m | 0.4025 | **1.17 m** | 0.07 m（無） | 1.17 m |
| 住宅高 | 9.8 m | 0.4083 | **1.10 m** | 0（無） | 1.10 m |
| 商業高 | 9.8 m | 0.4083 | **1.10 m** | 0（無） | 1.10 m |
| 工業 | 9.8 m | 0.4083 | **1.10 m** | 0（無） | 1.10 m |
| 辦公高 | 9.8 m | 0.4083 | **1.10 m** | 0（無） | 1.10 m |

一圈 1.1 m 的柏油前庭配上停車格線，對工業廠房的觀感改變不小；一道 1.1 m 的
騎樓雨遮對商業街同理。兩者都不需要把建築改窄。

**地形確認：** `cell.elevation` 從未被 `TerrainGenerator` 寫入，`DEFAULT_CELL.elevation`
是 0，所以陸地一律是平的 y = 0（`TerrainRenderer` 只把水面壓到 −0.2）。貼片放在
y = 0.01 安全。若日後真的做地形起伏，貼片與建築（固定 y = 0.05）會一起需要重做，
屆時是同一個問題。

### 矮物件要擴編到其他分區的話，得縮建築

這是唯一需要動已確認尺寸的部分，所以**單獨列為 Task 7，預設不做**：

| 分區 | 現況 | 縮到 | 矮物件帶 | 縮幅 |
|---|---|---|---|---|
| 商業低／辦公低 | 8.4 m | 7.8 m | 0.42 m | −7% |
| 住宅高／商業高／工業／辦公高 | 9.8 m | 9.0 m | 0.40 m | −8% |

0.4 m 放得下：矮柱、垃圾桶、單車架、消防栓、告示牌柱、小花台。放不下：樹、貨櫃。
若要 0.7 m（放得下大型垃圾桶與長椅）則要縮到 7.2 / 8.4 m，那是 −14%，看得出來。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/renderer/geometry/buildings/parts.ts`（改） | 新增 `PART_GROUND`、`setGroundShade`（B 通道）、門檻 |
| `src/renderer/BuildingMaterial.ts`（改） | `vGroundShade` varying + 貼片分支 |
| `src/renderer/geometry/buildings/propBands.ts`（新） | 三類放置帶的推導。純算術，不含幾何 |
| `src/renderer/geometry/buildings/groundProps.ts`（改） | 詞彙擴編；分成 `getGroundPropVariants` / `getDecalVariants` / `getOverheadVariants` |
| `src/renderer/InstancedLayer.ts`（改） | `createBucket` 加 `castShadow` 選項 —— 貼片不該投影 |
| `src/renderer/BuildingRenderer.ts`（改） | 貼片層與懸挑層 |
| `src/showcase/{main,controls}.ts`（改） | 三類各一個開關 |

---

## Task 1：`PART_GROUND` 標籤與貼片的 shader 分支

**Files:**
- Modify: `src/renderer/geometry/buildings/parts.ts`
- Modify: `src/renderer/BuildingMaterial.ts`
- Test: `src/renderer/__tests__/BuildingParts.test.ts`、`BuildingMaterial.test.ts`

**Interfaces:**
- Produces：
  - `PART_GROUND = 0.7` —— 落在 `FOLIAGE_MAX (0.65)` 與 `ROOF_MIN (0.8)` 之間的空號段
  - `PART_THRESHOLDS.GROUND_MIN = 0.65`、`GROUND_MAX = 0.8`
  - `setGroundShade(geo, shade01)` —— 寫入頂點色 B 通道（目前保留未用）
- Consumes：既有 `tagPart`、`stampZoneCategory`

- [ ] **Step 1：寫失敗測試**

加到 `BuildingParts.test.ts`：

```ts
describe('PART_GROUND', () => {
  it('should sit in the gap the shader leaves between foliage and roof', () => {
    expect(PART_GROUND).toBeGreaterThan(PART_THRESHOLDS.FOLIAGE_MAX);
    expect(PART_GROUND).toBeLessThan(PART_THRESHOLDS.ROOF_MIN);
  });

  it('should not collide with any existing tag', () => {
    const tags = [PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_GROUND, PART_ROOF];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('should keep the shade in the blue channel, leaving the tag and zone intact', () => {
    // R 是零件、G 是分區、B 以前保留。貼片要在同一份幾何裡同時有深色柏油與
    // 淺色鋪面，而 aSeed 是逐實例的 —— 分不出同一個 mesh 內的兩塊地面。
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_GROUND);
    stampZoneCategory(geo, ZONE_CAT[ZoneType.INDUSTRIAL]!);
    setGroundShade(geo, 0.25);
    const col = geo.getAttribute('color');
    expect(col.getX(0)).toBeCloseTo(PART_GROUND, 6);
    expect(col.getY(0)).toBeCloseTo(ZONE_CAT[ZoneType.INDUSTRIAL]!, 6);
    expect(col.getZ(0)).toBeCloseTo(0.25, 6);
  });
});
```

加到 `BuildingMaterial.test.ts`（既有寫法是對 GLSL 原始碼做斷言）：

```ts
it('should carry the ground shade through to the fragment shader', () => {
  const src = buildFragmentShader();
  expect(src).toContain('vGroundShade');
});

it('should branch on the ground tag before falling through to the wall', () => {
  // 落到牆的分支就會長出窗戶 —— 柏油地面上一格一格的窗。
  const src = buildFragmentShader();
  const ground = src.indexOf('isGround');
  const wall = src.indexOf('=== WALL');
  expect(ground).toBeGreaterThan(0);
  expect(ground).toBeLessThan(wall);
});
```

- [ ] **Step 2：跑測試確認失敗**

```
npx vitest run src/renderer/__tests__/BuildingParts.test.ts src/renderer/__tests__/BuildingMaterial.test.ts
```

- [ ] **Step 3：實作 `parts.ts`**

```ts
/** 地面貼片：柏油、鋪面、標線。完全平，行人走在上面。 */
export const PART_GROUND = 0.7;

export const PART_THRESHOLDS = {
  ROOF_BY_NORMAL: 0.1,
  FOLIAGE_MIN: 0.35,
  FOLIAGE_MAX: 0.65,
  GROUND_MIN: 0.65,
  GROUND_MAX: 0.8,
  ROOF_MIN: 0.8,
} as const;

/**
 * 地面明度寫在頂點色的 B 通道（原本保留未用）。
 *
 * 用頂點而不用 aSeed：同一份貼片幾何裡要同時有深色柏油車道與淺色人行道，
 * 而 aSeed 是逐實例的 —— 它分不出同一個 mesh 內的兩塊地面。
 */
export function setGroundShade(geo: THREE.BufferGeometry, shade01: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) arr[i * 3 + 2] = shade01;
}
```

- [ ] **Step 4：實作 `BuildingMaterial.ts`**

頂點著色器加 `varying float vGroundShade;` 與 `vGroundShade = color.b;`（沒有 color
屬性時設 0）。片段著色器在 `isDetail` 之後、`isFloor` 之前插入：

```glsl
  bool isGround = vPartType > ${glslFloat(PART_THRESHOLDS.GROUND_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.GROUND_MAX)};
```

```glsl
  } else if (isGround) {
    // 柏油 -> 混凝土 -> 磚鋪，由頂點的 B 通道決定。加一點世界座標雜訊，
    // 否則一整片鋪面會是死板的單一色塊。
    float g = hash21(floor(vWorldPos.xz * 26.0)) * 0.06 - 0.03;
    vec3 tarmac  = vec3(0.20, 0.20, 0.21);
    vec3 paving  = vec3(0.58, 0.57, 0.54);
    color = mix(tarmac, paving, vGroundShade) + g;
    color *= lighting;
  }
```

- [ ] **Step 5：跑測試到綠、回退驗證**

把 `isGround` 分支刪掉，確認 shader 測試轉紅；把 `setGroundShade` 改成寫 R 通道，
確認零件測試轉紅。都改回來。

- [ ] **Step 6：Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): a ground tag, so paving does not grow windows"
```

---

## Task 2：三類放置帶的推導

**Files:**
- Create: `src/renderer/geometry/buildings/propBands.ts`
- Modify: `src/renderer/geometry/buildings/groundProps.ts`（`yardRing` 移過來並改名）
- Test: `src/renderer/__tests__/PropBands.test.ts`（新）

**Interfaces:**
- Produces：

```ts
export interface Band { inner: number; outer: number }

/** 建築抖到最寬時的外緣。三類的內緣都是它。 */
export function buildingEdge(zoneType: number, density: Density): number | null

/** 貼片：建築外緣到格子邊界。行人走在上面，所以可以蓋過走道。 */
export function decalBand(zoneType: number, density: Density): Band | null

/** 矮物件：建築外緣到行人包絡線。窄於 0.033 格（0.4 m）回傳 null。 */
export function lowPropBand(zoneType: number, density: Density): Band | null

/** 懸挑：與貼片同寬，但有最低高度。 */
export function overheadBand(zoneType: number, density: Density): Band | null

/** 行人頭頂淨空（格）。低於它的東西會打到人。 */
export const OVERHEAD_CLEARANCE: number
```

- Consumes：`TARGET_WIDTHS_M`、`widthJitterFor`、`MAX_BUILDING_WIDTH_M`、`METRES_PER_CELL`

- [ ] **Step 1：寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import {
  buildingEdge, decalBand, lowPropBand, overheadBand, OVERHEAD_CLEARANCE,
} from '../geometry/buildings/propBands';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, type Density }
  from '../geometry/buildings/registry';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;
const CELL_EDGE = 0.5;

function eachBucket(fn: (zoneType: number, density: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

describe('decalBand', () => {
  it('should exist for every zone, including the plot-filling ones', () => {
    // 這是本階段的核心主張：貼片不受行人包絡線限制，因為行人走在它上面。
    eachBucket((z, d, key) => {
      const band = decalBand(z, d);
      expect(band, `${key} 沒有貼片帶`).not.toBeNull();
      expect((band!.outer - band!.inner) * METRES_PER_CELL, key).toBeGreaterThan(1.0);
    });
  });

  it('should stop at the cell edge', () => {
    // 越過格子邊界就是鋪到鄰居家或馬路上。
    eachBucket((z, d, key) => {
      expect(decalBand(z, d)!.outer, key).toBeLessThanOrEqual(CELL_EDGE + 1e-9);
    });
  });

  it('should start outside the widest the building can jitter to', () => {
    eachBucket((z, d, key) => {
      expect(decalBand(z, d)!.inner, key).toBeGreaterThanOrEqual(buildingEdge(z, d)! - 1e-9);
    });
  });

  it('should reach further out than the low prop band', () => {
    // 貼片可以蓋過走道，矮物件不行 —— 兩者若一樣寬，就是有一邊算錯了。
    eachBucket((z, d, key) => {
      const low = lowPropBand(z, d);
      if (!low) return;
      expect(decalBand(z, d)!.outer, key).toBeGreaterThan(low.outer);
    });
  });
});

describe('lowPropBand', () => {
  it('should never reach past the pedestrian envelope', () => {
    eachBucket((z, d, key) => {
      const band = lowPropBand(z, d);
      if (!band) return;
      expect(band.outer, key).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    });
  });

  it('should refuse a band too narrow to hold anything', () => {
    // 商業低與辦公低目前只剩 0.07 m。給它們一條 0.07 m 的帶子，等於默許
    // 幾何作者去猜自己塞不塞得下。
    for (const key of ['3:LOW', '6:LOW', '2:HIGH', '4:HIGH', '5:LOW', '6:HIGH']) {
      const [zs, ds] = key.split(':');
      expect(lowPropBand(Number(zs), ds as Density), key).toBeNull();
    }
  });

  it('should still give the low-density house its yard', () => {
    expect(lowPropBand(1, 'LOW')).not.toBeNull();
  });
});

describe('overheadBand', () => {
  it('should clear a walking person', () => {
    // 2.2 m 是雨遮不會打到頭的下限。
    expect(OVERHEAD_CLEARANCE * METRES_PER_CELL).toBeGreaterThanOrEqual(2.2);
  });

  it('should be allowed to overhang the walkway like a real arcade', () => {
    eachBucket((z, d, key) => {
      const band = overheadBand(z, d)!;
      expect(band.outer, key).toBeGreaterThan(HALF_ENVELOPE);
      expect(band.outer, key).toBeLessThanOrEqual(CELL_EDGE + 1e-9);
    });
  });
});
```

- [ ] **Step 2：跑測試確認失敗** —— 模組不存在。

- [ ] **Step 3：實作 `propBands.ts`**

```ts
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../core/grid/constants';
import { TARGET_WIDTHS_M, heightKey, widthJitterFor, type Density } from './registry';

/**
 * 地面物件的三類放置帶。
 *
 * 階段 2B 只推導了一類（矮物件），結論是「只有住宅低密度有空間」。那個結論
 * 沒有錯，但它只涵蓋「站在地上、佔據高度、行人會撞到」的東西。另外兩類的
 * 限制不同：
 *
 *   貼片   完全平，行人走在上面 —— 那本來就是人行道，可以鋪到格子邊界
 *   懸挑   最低點高過人頭，行人從下面走過 —— 可以像騎樓一樣挑出去
 *
 * 兩者對每個分區都有一公尺以上的空間，而且不必動任何已確認的建築尺寸。
 */

/** 行人的門節點在這裡外側。矮物件的外緣。 */
const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** 格子邊界。再過去就是鄰居家或馬路。 */
const CELL_EDGE = 0.5;

/** 行人頭頂淨空 2.2 m。低於它的懸挑物會打到人。 */
export const OVERHEAD_CLEARANCE = 2.2 / METRES_PER_CELL;

/** 矮物件帶窄於 0.4 m 就不給 —— 那個寬度塞不下任何看得見的東西。 */
const MIN_LOW_BAND = 0.4 / METRES_PER_CELL;

/** 貼片帶窄於 1 m 就不給。 */
const MIN_DECAL_BAND = 1.0 / METRES_PER_CELL;

export interface Band { inner: number; outer: number }

/**
 * 建築抖到最寬時的外緣。三類的內緣都是它。
 *
 * 用目標寬度乘最大向上抖動，而不是某個變體的實際寬度：物件是整個
 * (分區, 密度) 桶共用的，不能依賴這一格配到哪一個量體變體。
 */
export function buildingEdge(zoneType: number, density: Density): number | null {
  const target = TARGET_WIDTHS_M[heightKey(zoneType, density)];
  if (!target) return null;
  return (target / METRES_PER_CELL / 2) * (1 + widthJitterFor(zoneType, density).up);
}

function band(inner: number | null, outer: number, min: number): Band | null {
  if (inner === null || outer - inner < min) return null;
  return { inner, outer };
}

export function decalBand(zoneType: number, density: Density): Band | null {
  return band(buildingEdge(zoneType, density), CELL_EDGE, MIN_DECAL_BAND);
}

export function lowPropBand(zoneType: number, density: Density): Band | null {
  return band(buildingEdge(zoneType, density), HALF_ENVELOPE, MIN_LOW_BAND);
}

export function overheadBand(zoneType: number, density: Density): Band | null {
  return band(buildingEdge(zoneType, density), CELL_EDGE, MIN_DECAL_BAND);
}
```

`groundProps.ts` 的 `yardRing` 改為轉呼叫 `lowPropBand`，保留匯出以免既有測試斷掉。

- [ ] **Step 4：跑測試到綠 + 全量**

```
npx vitest run
npx tsc --noEmit
```

- [ ] **Step 5：回退驗證**

把 `decalBand` 的 `CELL_EDGE` 改成 `HALF_ENVELOPE`，確認「should reach further out
than the low prop band」轉紅；把 `MIN_LOW_BAND` 改成 0，確認「should refuse a band
too narrow」轉紅。都改回來。

- [ ] **Step 6：Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): three placement bands, not one

上一輪只推導了矮物件那一類，結論是「只有住宅低密度有空間」。那不是錯的，
只是不完整 —— 貼片與懸挑的限制不同，兩者對每個分區都有一公尺以上。"
```

---

## Task 3：貼片幾何 —— 每個分區都有前庭

**Files:**
- Create: `src/renderer/geometry/buildings/decals.ts`
- Test: `src/renderer/__tests__/Decals.test.ts`（新）

**Interfaces:**
- Produces：`getDecalVariants(zoneType, density, level): GeoBuilder[]`、`DECAL_Y = 0.01`
- Consumes：`decalBand`、`PART_GROUND`、`setGroundShade`、`PART_FOLIAGE`

### 各分區的貼片詞彙

| 分區 | L1 | L2 | L3 |
|---|---|---|---|
| 住宅低 | 素土（草皮補丁） | 草坪 + 短車道 | 草坪 + 車道 + 步道 |
| 住宅高 | 素混凝土環 | 混凝土環 + 綠地 | 鋪面環 + 綠地 + 步道 |
| 商業低 | 素人行道 | 人行道 + 店前鋪面 | 人行道 + 騎樓地坪 |
| 商業高 | 人行道環 | 人行道 + 廣場 | 磚鋪廣場 + 落客區 |
| 工業 | 柏油前庭 | 柏油 + 卸貨標線 | 柏油 + 卸貨標線 + 停車格 |
| 辦公低 | 素人行道 | 人行道 + 入口步道 | 鋪面 + 入口廣場 |
| 辦公高 | 人行道環 | 人行道 + 廣場 | 磚鋪廣場 + 落客區 |

明度（B 通道）：柏油 0.0、瀝青步道 0.25、混凝土 0.6、磚鋪 0.85。草皮用 `PART_FOLIAGE`。

- [ ] **Step 1：寫失敗測試**

```ts
describe('decal geometry', () => {
  function eachDecal(fn: (geo: THREE.BufferGeometry, label: string) => void) { /* 同 GroundProps 的走訪 */ }

  it('should exist for every zone at every level', () => {
    // 本階段的驗收條件：沒有哪個分區是光禿的。
    eachBucket((z, d, key) => {
      for (const level of LEVELS) {
        expect(getDecalVariants(z, d, level).length, `${key} L${level}`).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it('should lie flat on the ground', () => {
    // 有厚度的「貼片」會在側面長出牆，而牆會長出窗戶。
    eachDecal((geo, label) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(b.max.y - b.min.y, `${label} 有厚度`).toBeLessThan(1e-6);
      expect(b.min.y, label).toBeCloseTo(DECAL_Y, 6);
    });
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

  it('should never overlap the building footprint', () => {
    eachBucket((z, d, key) => {
      const inner = buildingEdge(z, d)!;
      for (const level of LEVELS) {
        for (const build of getDecalVariants(z, d, level)) {
          const geo = build();
          const pos = geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const m = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
            expect(m, `${key} L${level} 頂點 ${i} 鋪進建築裡`).toBeGreaterThanOrEqual(inner - 1e-6);
            expect(m, `${key} L${level} 頂點 ${i} 鋪到鄰居家`).toBeLessThanOrEqual(0.5 + 1e-6);
          }
          geo.dispose();
        }
      }
    });
  });

  it('should only use ground or foliage tags', () => {
    // 貼片標成 PART_WALL 會長出窗戶；標成 PART_ROOF 會拿到屋瓦顏色。
    eachDecal((geo, label) => {
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const p = col.getX(i);
        const ok = (p > 0.35 && p < 0.65) || (p > 0.65 && p < 0.8);
        expect(ok, `${label} 頂點 ${i} 標籤 ${p}`).toBe(true);
      }
    });
  });

  it('should stay inside the triangle budget', () => {
    eachDecal((geo, label) => {
      expect(triangleCount(geo), label).toBeLessThanOrEqual(TRIANGLE_BUDGET.PROP);
    });
  });

  it('should make the forecourt better with every level', () => {
    eachBucket((z, d, key) => {
      const tri = (lv: number) => getDecalVariants(z, d, lv)
        .map(b => { const g = b(); const n = triangleCount(g); g.dispose(); return n; })
        .reduce((a, b) => a + b, 0);
      expect(tri(2), `${key} L2`).toBeGreaterThanOrEqual(tri(1));
      expect(tri(3), `${key} L3`).toBeGreaterThan(tri(1));
    });
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

- [ ] **Step 3：實作 `decals.ts`**

核心零件（皆為單層四邊形，無厚度）：

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import { decalBand, type Band } from './propBands';
import { tagPart, setGroundShade, PART_GROUND, PART_FOLIAGE } from './parts';
import { LEVELS, type Density, type GeoBuilder } from './registry';

/**
 * 地面貼片 —— 建築腳下的鋪面。
 *
 * 完全平（單層四邊形，沒有厚度），行人走在上面，所以它是三類地面物件裡
 * 唯一每個分區都放得下的。有厚度的話側面會長出牆，而牆會長出窗戶。
 *
 * 地面固定在 y = 0（`cell.elevation` 從未被寫入），所以 0.01 的抬升足以
 * 避開 z-fighting，又不會看出浮空。
 */
export const DECAL_Y = 0.01;

const M = (metres: number) => metres / METRES_PER_CELL;

/** 一塊躺平的四邊形，中心在 (cx, cz)。 */
function quad(cx: number, cz: number, w: number, d: number, part: number, shade: number) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);           // 朝上
  geo.translate(cx, DECAL_Y, cz);
  tagPart(geo, part);
  setGroundShade(geo, shade);
  return geo;
}

/** 沿著整條邊的鋪面帶。 */
function apron(band: Band, axis: 'x' | 'z', sign: 1 | -1, shade: number) {
  const mid = (band.inner + band.outer) / 2;
  const depth = band.outer - band.inner;
  const len = band.outer * 2;
  return axis === 'z'
    ? quad(0, sign * mid, len, depth, PART_GROUND, shade)
    : quad(sign * mid, 0, depth, len, PART_GROUND, shade);
}

/** 四邊全鋪。工業的柏油前庭與商業的人行道環都用它。 */
function ring(band: Band, shade: number) {
  return [
    apron(band, 'z', 1, shade), apron(band, 'z', -1, shade),
    apron(band, 'x', 1, shade), apron(band, 'x', -1, shade),
  ];
}

/** 停車格／卸貨標線：沿著一條邊等距的短白線。 */
function bays(band: Band, sign: 1 | -1, count: number) {
  const mid = (band.inner + band.outer) / 2;
  const span = band.outer * 1.6;
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= count; i++) {
    const x = -span / 2 + (span / count) * i;
    out.push(quad(x, sign * mid, M(0.15), (band.outer - band.inner) * 0.9, PART_GROUND, 1.0));
  }
  return out;
}

/** 草皮補丁。標 PART_FOLIAGE，shader 會給它綠色。 */
function lawn(band: Band, axis: 'x' | 'z', sign: 1 | -1, lengthFrac: number) {
  const mid = (band.inner + band.outer) / 2;
  const depth = (band.outer - band.inner) * 0.85;
  const len = band.outer * 2 * lengthFrac;
  return axis === 'z'
    ? quad(0, sign * mid, len, depth, PART_FOLIAGE, 0)
    : quad(sign * mid, 0, depth, len, PART_FOLIAGE, 0);
}
```

各分區的組合以一張表驅動，每個 (分區, 等級) 一個 builder（貼片不需要兩個變體
—— 它在視覺上是底色，重複感來自立體物件）：

```ts
const TARMAC = 0.0;
const ASPHALT_PATH = 0.25;
const CONCRETE = 0.6;
const BRICK = 0.85;

type DecalRecipe = (b: Band) => THREE.BufferGeometry[];

const RECIPES: Record<string, [DecalRecipe, DecalRecipe, DecalRecipe]> = {
  // 住宅低：草坪為主，車道與步道隨等級加上
  '1:LOW': [
    b => [lawn(b, 'z', -1, 0.8)],
    b => [lawn(b, 'z', -1, 0.9), lawn(b, 'x', 1, 0.6), apron(b, 'z', 1, ASPHALT_PATH)],
    b => [lawn(b, 'z', -1, 0.95), lawn(b, 'x', 1, 0.8), lawn(b, 'x', -1, 0.8),
          apron(b, 'z', 1, ASPHALT_PATH)],
  ],
  // 工業：柏油鋪滿，等級加卸貨標線與停車格
  '5:LOW': [
    b => ring(b, TARMAC),
    b => [...ring(b, TARMAC), ...bays(b, 1, 4)],
    b => [...ring(b, TARMAC), ...bays(b, 1, 5), ...bays(b, -1, 5)],
  ],
  // ...其餘分區同構，見上表
};

export function getDecalVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  const band = decalBand(zoneType, density);
  if (!band) return [];
  const recipes = RECIPES[`${zoneType}:${density}`];
  if (!recipes) return [];
  const recipe = recipes[Math.max(1, Math.min(3, level)) - 1]!;
  return [() => mergeGeometries(recipe(band))!];
}
```

- [ ] **Step 4：跑測試到綠**

- [ ] **Step 5：回退驗證**

把 `quad` 的 `PlaneGeometry` 換成 `BoxGeometry(w, 0.01, d)`，確認「should lie flat」
轉紅；把某個 recipe 的 `apron` 外緣改成 `0.55`，確認「should never overlap」轉紅。

- [ ] **Step 6：Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): every zone gets a forecourt

一圈 1.1 m 的柏油配上停車格線，對工業廠房的觀感改變不小 ——
而且不必把建築改窄一公分。"
```

---

## Task 4：住宅低的立體詞彙擴編

**Files:**
- Modify: `src/renderer/geometry/buildings/groundProps.ts`
- Test: `src/renderer/__tests__/GroundProps.test.ts`

現況只有四種零件（樹籬／花台／柱狀樹／灌木），六個組合。加入八種：

| 零件 | 尺寸 | 標籤 | 出現於 |
|---|---|---|---|
| 信箱 | 0.15 × 1.1 m 柱 + 箱 | `PART_DETAIL` | L1+ |
| 垃圾桶 | 0.5 m 圓柱，高 0.9 m | `PART_DETAIL` | L1+ |
| 圍籬柱列 | 0.1 m 方柱 × 5，高 1.0 m | `PART_DETAIL` | L1、L2 |
| 單車 | 兩個環 + 桿，長 1.6 m | `PART_DETAIL` | L2+ |
| 花圃 | 0.6 m 圓，高 0.25 m | `PART_FOLIAGE` | L2+ |
| 庭園燈 | 0.08 m 桿，高 1.8 m + 燈罩 | `PART_DETAIL` | L2+ |
| 曬衣桿 | 兩根 1.7 m 柱 + 橫桿 | `PART_DETAIL` | L1、L2 |
| 修剪灌木球 | 0.45 m 球疊柱 | `PART_FOLIAGE` | L3 |

組合數從每級 2 個增為每級 **4 個**（L1/L2/L3 各 4 種庭院，配上四向旋轉 = 16 種面貌）。

- [ ] **Step 1：寫失敗測試**

```ts
it('should offer at least four yards per level', () => {
  // 兩個變體配四向旋轉是 8 種面貌，一個 8x8 街廓看得出重複。
  for (const level of LEVELS) {
    expect(getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level).length)
      .toBeGreaterThanOrEqual(4);
  }
});

it('should use more than a handful of distinct part shapes', () => {
  // 「類型太少」的機器可檢查形式：把所有變體的頂點數集合起來，不同零件
  // 的頂點數不同，集合大小是詞彙量的下界。
  const sizes = new Set<number>();
  for (const level of LEVELS) {
    for (const b of getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)) {
      const g = b();
      sizes.add(triangleCount(g));
      g.dispose();
    }
  }
  expect(sizes.size).toBeGreaterThanOrEqual(6);
});

it('should still fit the band and the budget', () => { /* 沿用既有兩條 */ });
```

- [ ] **Step 2-6：** 同前 —— 跑紅、實作零件、跑綠、回退驗證（把某個新零件放到帶外，
確認邊界測試轉紅）、commit。

---

## Task 5：懸挑物件 —— 商業街的騎樓

**Files:**
- Create: `src/renderer/geometry/buildings/overheadProps.ts`
- Test: `src/renderer/__tests__/OverheadProps.test.ts`（新）

**Interfaces:**
- Produces：`getOverheadVariants(zoneType, density, level): GeoBuilder[]`、`OVERHEAD_TRIANGLE_BUDGET = 120`

| 分區 | L1 | L2 | L3 |
|---|---|---|---|
| 商業低 | 無 | 單邊雨遮 | 雨遮 + 立體招牌 |
| 商業高 | 入口雨遮 | 雨遮 + 燈箱 | 騎樓連續雨遮 + 看板 |
| 工業 | 無 | 卸貨雨棚 | 卸貨雨棚 + 管架挑出 |
| 辦公低／高 | 無 | 入口雨遮 | 入口雨遮 + 遮陽板 |
| 住宅低／高 | 無 | 無 | 無 |

- [ ] **Step 1：寫失敗測試**

```ts
it('should never hang low enough to hit a walking person', () => {
  // 這是懸挑物件唯一的理由：行人從下面走過。低於淨空就是穿模。
  eachOverhead((geo, label) => {
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.y, `${label} 會打到頭`)
      .toBeGreaterThanOrEqual(OVERHEAD_CLEARANCE - 1e-6);
  });
});

it('should be allowed to reach past the pedestrian envelope', () => {
  // 這一條是在確認「懸挑真的挑出去了」—— 全都縮在建築裡的話，
  // 這一層沒有存在的意義。
  const reaching = [] as string[];
  eachOverhead((geo, label) => {
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const outer = Math.max(Math.abs(b.min.x), Math.abs(b.max.x),
                           Math.abs(b.min.z), Math.abs(b.max.z));
    if (outer > HALF_ENVELOPE) reaching.push(label);
  });
  expect(reaching.length).toBeGreaterThan(0);
});

it('should stop at the cell edge', () => { /* <= 0.5 */ });

it('should never be tagged as wall', () => { /* 雨遮是 PART_DETAIL 或 PART_ROOF */ });

it('should give commercial and office something at level 3', () => {
  for (const key of ['3:LOW', '4:HIGH', '6:LOW', '6:HIGH', '5:LOW']) {
    const [zs, ds] = key.split(':');
    expect(getOverheadVariants(Number(zs), ds as Density, 3).length, key)
      .toBeGreaterThanOrEqual(1);
  }
});
```

- [ ] **Step 2-6：** 跑紅、實作、跑綠、回退驗證（把雨遮下移到 1 m，確認淨空測試轉紅）、commit。

---

## Task 6：三層接線、展示區與文件

**Files:**
- Modify: `src/renderer/InstancedLayer.ts`（`createBucket` 加 `castShadow` 選項）
- Modify: `src/renderer/BuildingRenderer.ts`
- Modify: `src/showcase/{main,controls}.ts`
- Modify: `BUGS.md`、`TODO.md`、規格
- Test: `src/renderer/__tests__/GroundPropLayer.test.ts`（擴充）

- [ ] **Step 1：寫失敗測試**

```ts
it('should not let flat decals cast shadows', () => {
  // 一片沒有厚度的四邊形投出來的影子是一條線，而且每一棟都算一次。
  const { renderer, internals } = fresh();
  renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 1, false);
  const entry = internals.decalLayer.entryFor('0,0')!;
  expect(internals.decalLayer.meshFor(entry.key)!.castShadow).toBe(false);
});

it('should give an industrial cell a forecourt but no yard props', () => {
  const { renderer, internals } = fresh();
  renderer.addBuilding(0, 0, ZoneType.INDUSTRIAL, 'LOW', 3, false);
  expect(internals.decalLayer.entryFor('0,0')).toBeDefined();
  expect(internals.propLayer.entryFor('0,0')).toBeUndefined();
});

it('should never scale a decal or an overhead prop', () => { /* 同 BUG-219 的矩陣斷言 */ });

it('should take all three layers away with the building', () => { /* remove 後三層都空 */ });

it('should swap all three layers when the house upgrades', () => { /* 等級換桶 */ });
```

- [ ] **Step 2：實作**

`InstancedLayer.createBucket(scene, key, geometry, opts?: { castShadow?: boolean })`。

`BuildingRenderer` 加 `decalLayer` 與 `overheadLayer`，`syncGroundProps` 重構成
`syncAttachments(x, y, zoneType, density, level)`，一次處理三層 —— 三層的矩陣完全
相同（旋轉 + 位置，無縮放），差別只在桶的來源。

- [ ] **Step 3：展示區**

`ControlState` 的 `showProps` 拆成 `showDecals` / `showLowProps` / `showOverhead`
三個開關，統計改成四列（量體／貼片／矮物件／懸挑）。

- [ ] **Step 4：手動驗收（人工）**

`pnpm dev` → `/showcase.html`

1. **工業 + 街廓** —— 應該看到柏油前庭與停車格線；L1→L3 標線變多
2. **商業低 L3** —— 應該看到騎樓雨遮挑到走道上方
3. **住宅低** —— 庭院種類明顯比之前多，L1/L2/L3 各四種
4. 三個開關逐一切換，確認每一層都看得出貢獻
5. 高密度住宅 —— 有鋪面與綠地，沒有立體物件（除非做了 Task 7）

- [ ] **Step 5：文件 + 全量測試 + 建置 + Commit**

---

## Task 7（選配，需使用者決定）：縮建築讓其他分區也有立體小物

**只有這一項會動到已確認的尺寸。** 預設不做。

| 分區 | 現況 | 縮到 | 矮物件帶 | 縮幅 |
|---|---|---|---|---|
| 商業低／辦公低 | 8.4 m | 7.8 m | 0.42 m | −7% |
| 住宅高／商業高／工業／辦公高 | 9.8 m | 9.0 m | 0.40 m | −8% |

0.4 m 的帶子放得下：矮柱、垃圾桶、單車架、消防栓、告示牌柱、小花台。
放不下樹與貨櫃 —— 那要 0.7 m 以上，也就是縮到 7.2／8.4 m（−14%，看得出來）。

改動本身只有兩行（`TARGET_WIDTHS_M` 兩個值），`lowPropBand` 會自動開始回傳
非 null，然後補上各分區的矮物件詞彙。

- [ ] Step 1：改 `TARGET_WIDTHS_M`
- [ ] Step 2：各分區矮物件詞彙（商業：告示牌、垃圾桶、單車架；工業：油桶、矮柱、
      消防栓；辦公：旗桿、花台、單車架）
- [ ] Step 3：既有的 `lowPropBand` 測試會自動涵蓋帶寬；補詞彙的邊界測試
- [ ] Step 4：展示區確認縮幅看不看得出來

---

## 完成條件

1. 每個 (分區, 密度, 等級) 都有至少一個貼片（`Decals.test.ts`）。
2. 貼片完全平、朝上、不與建築重疊、不越過格子邊界。
3. 懸挑物件最低點不低於 2.2 m，且確實有挑出包絡線的。
4. 住宅低每級至少四種庭院，零件詞彙至少六種。
5. 貼片不投影。
6. 三層都不吃任何縮放（BUG-219 的不變式擴及新的兩層）。
7. 全量測試綠、`tsc` 0 錯、`pnpm build` 成功。
8. 使用者在展示區確認每個分區都不再光禿。

## 不在本階段

- 屋頂物件（階段 3）。
- 立面附加零件（階段 3）—— 懸挑物件與它相鄰但不同：懸挑掛在建築外、
  由分區與等級決定；立面零件貼在牆上、由量體決定。
- 貼片的地形適應 —— 目前地面永遠是平的，等真的做起伏再說。
- 參數化量體生成器（階段 2C）。

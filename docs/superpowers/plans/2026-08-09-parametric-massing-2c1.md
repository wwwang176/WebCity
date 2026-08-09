# 階段 2C-1：參數化量體生成器 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把手寫的 2–3 個量體變體換成每桶 8 個由參數生成的變體，並取消實例縮放。

**Architecture:** 生成器先產出 `Volume[]`（純算術的盒子座標），再由 `assemble` 轉成
`BufferGeometry`。中間多這一層是為了讓「不對稱、重疊、越界」能用算術精確驗證，
不必量合併後的包圍盒。幾何直接產出最終尺寸，所以實例矩陣退化成旋轉加位移 ——
那消掉 BUG-219 / BUG-226 的共同成因。

**Tech Stack:** TypeScript、Three.js（只有 `assemble` 碰）、Vitest。

**規格：** `docs/superpowers/specs/2026-08-09-parametric-massing-design.md`

**分支：** 繼續在 `feat/building-model-variety` 上做（使用者指定，不合回 main）。

---

## Global Constraints

- **TDD 強制**：先寫會紅的測試 → 跑紅 → 實作 → 跑綠 → **回退驗證**（把修正暫時
  拿掉，確認測試轉紅）→ commit。回退驗證不是選配 —— BUG-226 正是因為測試量錯
  對象而給了假綠燈。
- `src/core/` 禁止 import Three.js。本計畫全部在 `src/renderer/`，不受此限，但
  `massing/` 底下只有 `assemble.ts` 可以 import Three.js。
- 發現 Bug 必須寫入 `BUGS.md` 與 `TODO.md`。
- 1 格 = 12 公尺（`METRES_PER_CELL`）。所有幾何座標的單位是**格**。
- 行人包絡線半寬 `HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2`
  = 9.8 / 12 / 2 = 0.408333…。**任何量體越過它就是行人穿牆（BUG-221）。**
- 格子邊界 `CELL_EDGE = 0.5`。
- 樓高範圍 `FLOOR_HEIGHT_UNITS = { MIN: 0.22, MAX: 0.30 }`（2.64–3.6 m），與立面
  shader 的 `mix(0.22, 0.30, seedRhythm)` 是同一份。
- 變體數 `VARIANT_COUNT = 8`，所有 (分區, 密度, 等級) 一致。
- 三角形上限：`TRIANGLE_BUDGET.HOUSE = 400`、`TOWER = 800`。
- 每個 commit 訊息結尾加：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013CaAT8jcajKrRTLsVvFoop
  ```

### 規格的一處修正（實作前必讀）

規格第五節寫「八個變體的高度分層鋪滿 ±10%」，第十三節的驗收條件也是 ±10%。
**固定百分比是錯的模型。**

高度必須是整數層乘樓高，而樓高只能落在 [2.64, 3.6] m。對矮建築來說一層樓就是
目標高度的一大截：

```
住宅低 L1，目標 5 m，±10% = [4.5, 5.5]
  1 層 × [2.64, 3.60] = [2.64, 3.60]   全部太矮   ✗
  2 層 × [2.64, 3.60] = [5.28, 7.20]   只有 5.28 落得進去
                                        → 一個選項，八個變體高度全一樣
```

而對高樓來說，一層樓只是零頭 —— 42 m 的塔樓多一層才多 8%。

**所以容差要跟著高度走：**

```
容差 = max(0.10 × 目標高度, 一層樓)
```

「至少容得下一層樓」是這條規則的全部理由：**低於一層樓的容差在整數層的世界裡
沒有意義**，它只會讓可行組合塌成一個。

實際落點（一層樓取範圍中點 3.12 m）：

| 桶 | 目標 | 容差 | 可行樓層數 | 效果 |
|---|---|---|---|---|
| 住宅低 L1 | 5 m | 3.12 m（62%） | 1–3 層 | 平房與兩三層透天混雜 |
| 住宅低 L3 | 10 m | 3.12 m（31%） | 2–4 層 | |
| 住宅高 L1 | 22 m | 3.12 m（14%） | 6–8 層 | |
| 住宅高 L3 | 42 m | 4.2 m（10%） | 12–16 層 | 百分比開始咬 |
| 辦公高 L3 | 48 m | 4.8 m（10%） | 14–18 層 | |

**等級階梯改成看平均值，不是看極值。** 住宅低 L1 [1.9, 8.1] 與 L3 [6.9, 13.1]
會重疊 —— 一棟三層的 L1 可能比一棟兩層的 L3 高。這是刻意接受的：低矮住宅的
等級差異本來就寫在裝潢與院子上，不在樓高上，而「有時候一層有時候四層」正是
郊區街道真正的樣子。高樓那一端百分比會先咬到，所以住宅高 L1 上限 25.1 m 仍
低於 L2 下限 28.8 m，階梯完好。

**驗收條件因此改成：**

- 每個變體的高度都在 `目標 ± max(10%, 一層樓)` 內
- 這一桶**用滿了所有可行的 (樓層數, 樓高) 組合**（不是「至少三種高度」）
- 每個 (分區, 密度) 的三個等級，**平均高度嚴格遞增**
- 高層的桶（住宅高／商業高／辦公高）三個等級的高度區間**互不重疊**

---

## File Structure

### 新增

| 檔案 | 責任 | 可以 import Three.js |
|---|---|---|
| `src/renderer/geometry/buildings/massing/metrics.ts` | 共用純量常數（包絡線、樓高、離地層序） | 否 |
| `.../massing/rng.ts` | `variantRng`：每個變體一條確定性亂數流 | 否 |
| `.../massing/dimensions.ts` | 這個變體的基地寬深、樓層數、樓高 | 否 |
| `.../massing/volume.ts` | `Volume` 型別與量測工具（maxAbs、重疊、光柵化） | 否 |
| `.../massing/composers.ts` | 十個量體組合器（single、lShape、podiumTower…） | 否 |
| `.../massing/prototypes.ts` | 各分區的原型表（組合器 + 參數） | 否 |
| `.../massing/roofForms.ts` | 屋頂形式 | 否 |
| `.../massing/assemble.ts` | `Volume[]` → `BufferGeometry` | **是** |
| `.../massing/index.ts` | `getMassingVariants` / `volumesFor` | 是（轉出） |

測試：`MassingMetrics` / `MassingDimensions` / `MassingVolumes` / `MassingGeometry`
/ `MassingVariety`，全部在 `src/renderer/__tests__/`。

### 修改

| 檔案 | 改動 |
|---|---|
| `.../buildings/propBands.ts` | 常數搬走；`narrowest/widestBuildingEdge` 改成量 `Volume`；三個 band 加 `level` 參數 |
| `.../buildings/registry.ts` | 刪 17 個手寫變體與六個縮放函式；`ZONE_TYPES` / `TARGET_WIDTHS_M` 改為獨立定義 |
| `.../buildings/decals.ts` | band 呼叫加 `level`；`DECAL_Y` / `MARK_Y` 改從 `metrics` 取 |
| `.../buildings/groundProps.ts` | 同上 |
| `.../buildings/overheadProps.ts` | 同上 |
| `src/renderer/BuildingRenderer.ts` | 改用 `getMassingVariants`；矩陣去縮放；空桶不送 draw call |
| `src/renderer/BuildingAppearance.ts` | 刪 `width01` / `depth01` / `heightScale`；`variantIndexOf` 加鄰居迴避；加 `STREAM.VARIANT_RETRY` |
| `src/renderer/BuildingMaterial.ts` | `FLOOR_HEIGHT_UNITS` 改從 `metrics` 取 |
| `src/renderer/InstancedLayer.ts` | `visible = count > 0` |
| `src/showcase/main.ts`、`views.ts` | 同步 |

### 刪除

`src/renderer/__tests__/BuildingFootprint.test.ts` —— 它測的六個函式全部消失。
**它的 13 條測試逐條的去處列在 Task 8**，不准整檔刪掉了事。

---

## Task 1：`metrics.ts` —— 把共用純量搬到葉節點

**為什麼先做**：`propBands` 要量 `massing` 產出的 `Volume`，而 `massing` 要用
`SHOPFRONT_CEILING` —— 這是一個 import 循環。兩邊都要的純量搬到沒有相依的葉節點
就沒事了。

**Files:**
- Create: `src/renderer/geometry/buildings/massing/metrics.ts`
- Modify: `src/renderer/geometry/buildings/propBands.ts`（刪掉搬走的常數，改 re-export）
- Modify: `src/renderer/geometry/buildings/decals.ts`、`overheadProps.ts`、
  `src/renderer/BuildingRenderer.ts`、`src/renderer/BuildingMaterial.ts`、
  `src/showcase/main.ts`（import 改指向 `metrics`）
- Test: `src/renderer/__tests__/MassingMetrics.test.ts`（新）

**Interfaces:**
- Produces：
  ```ts
  export const HALF_ENVELOPE: number;          // 0.4083333…
  export const CELL_EDGE = 0.5;
  export const OVERHEAD_CLEARANCE: number;     // 2.2 / 12
  export const FLOOR_HEIGHT_UNITS: { readonly MIN: 0.22; readonly MAX: 0.30 };
  export const SHOPFRONT_CEILING: number;      // = FLOOR_HEIGHT_UNITS.MIN
  export const GROUND_LAYERS: {
    readonly BUILDING: 0.002; readonly DECAL: 0.002;
    readonly MARKING: 0.003; readonly LIGHT_SPOT: 0.004;
  };
  export function M(metres: number): number;   // 公尺 → 格
  ```

- [ ] **Step 1：寫失敗測試**

`src/renderer/__tests__/MassingMetrics.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  HALF_ENVELOPE, CELL_EDGE, OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS,
  SHOPFRONT_CEILING, GROUND_LAYERS, M,
} from '../geometry/buildings/massing/metrics';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

/**
 * 這些常數以前散在 propBands 裡，而 propBands 之後要 import massing —— 那是一個
 * 循環。搬到葉節點模組是為了斷開它，不是為了整齊。
 */
describe('massing metrics', () => {
  it('should agree with the shared building width constant', () => {
    // 包絡線與 SidewalkGraph 的 BUILDING_HALF_SIZE 是同一條線（BUG-221）。
    // 自己寫一個數字就會漂移。
    expect(HALF_ENVELOPE).toBeCloseTo(MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2, 12);
  });

  it('should convert metres to cells', () => {
    expect(M(12)).toBeCloseTo(1, 12);
    expect(M(2.2)).toBeCloseTo(OVERHEAD_CLEARANCE, 12);
  });

  it('should keep the pedestrian envelope inside the cell', () => {
    expect(HALF_ENVELOPE).toBeLessThan(CELL_EDGE);
  });

  it('should put the shopfront ceiling at the lowest floor the shader draws', () => {
    // 樓高是逐實例亂數，懸挑物的幾何是整桶共用的一份 —— 取最低值才保證
    // 永遠不會越過一樓。
    expect(SHOPFRONT_CEILING).toBe(FLOOR_HEIGHT_UNITS.MIN);
    expect(FLOOR_HEIGHT_UNITS.MIN).toBeLessThan(FLOOR_HEIGHT_UNITS.MAX);
  });

  it('should leave room between head clearance and the shopfront ceiling', () => {
    expect((SHOPFRONT_CEILING - OVERHEAD_CLEARANCE) * METRES_PER_CELL)
      .toBeGreaterThan(0.3);
  });

  it('should stack the ground layers in drawing order', () => {
    // 標線要疊在鋪面上，光暈要疊在標線上。順序反了就 z-fighting。
    expect(GROUND_LAYERS.MARKING).toBeGreaterThan(GROUND_LAYERS.DECAL);
    expect(GROUND_LAYERS.LIGHT_SPOT).toBeGreaterThan(GROUND_LAYERS.MARKING);
    for (const [name, y] of Object.entries(GROUND_LAYERS)) {
      expect(y, `${name} 陷進地面`).toBeGreaterThan(0);
      expect(y * METRES_PER_CELL, `${name} 浮空`).toBeLessThan(0.1);
    }
  });
});
```

- [ ] **Step 2：跑紅**

```
pnpm vitest run src/renderer/__tests__/MassingMetrics.test.ts
```
預期：`Failed to resolve import ".../massing/metrics"`。

- [ ] **Step 3：實作**

`src/renderer/geometry/buildings/massing/metrics.ts`：

```ts
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * 量體生成器與地面物件層共用的純量常數。
 *
 * 這個模組**不 import 任何本套件內的東西**，那是它存在的理由：`propBands` 要量
 * `massing` 產出的量體，而 `massing` 要用 `SHOPFRONT_CEILING` —— 常數留在
 * `propBands` 裡就是一個 import 循環。
 */

/** 公尺 → 格。1 格 = 12 m。 */
export function M(metres: number): number {
  return metres / METRES_PER_CELL;
}

/**
 * 行人包絡線半寬。
 *
 * `SidewalkGraph` 的門節點放在這裡外側，所以建築越過它就是行人走進牆裡
 * （BUG-221）。實體是 `MAX_BUILDING_WIDTH_M`，這裡只換算單位 —— 自己寫一個
 * 數字就會漂移，而漂移不會有任何東西報錯。
 */
export const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** 格子邊界。再過去就是鄰居家或馬路。 */
export const CELL_EDGE = 0.5;

/** 行人頭頂淨空 2.2 m。低於它的懸挑物會打到人。 */
export const OVERHEAD_CLEARANCE = M(2.2);

/**
 * 立面 shader 的樓層高度範圍（格）。2.64 m 到 3.6 m。
 *
 * 實體在這裡而不是 GLSL 裡：量體的樓層數要用它，而幾何與 shader 對不上的話，
 * 雨遮會掛在窗戶中間 —— 那種錯不會有任何東西報錯。
 */
export const FLOOR_HEIGHT_UNITS = { MIN: 0.22, MAX: 0.30 } as const;

/**
 * 一樓樓板線 —— 掛在店面上的東西不得高過它。
 *
 * 取**最低**的樓高：每一棟的樓高由變體決定，懸挑物的幾何是整桶共用的一份，
 * 不知道自己掛在哪一個變體上。取最低值才保證永遠不會越過一樓。
 */
export const SHOPFRONT_CEILING = FLOOR_HEIGHT_UNITS.MIN;

/**
 * 貼著地面的東西該放多高（格）。
 *
 * 這張表存在的理由是 BUG-224：分區建築原本放在 y = 0.05，那是**路面**的高度，
 * 不是地面的高度，所以每一棟都浮空 0.6 m。這些數字彼此有順序關係（標線要疊在
 * 鋪面上），散在四個檔案裡改一個就會壓到另一個。
 */
export const GROUND_LAYERS = {
  /** 建築與地面物件的底面。2.4 cm 足以避開與地形共面的 z-fighting。 */
  BUILDING: 0.002,
  /** 鋪面貼片。與建築同高，兩者在平面上不重疊。 */
  DECAL: 0.002,
  /** 停車格線與入口踏板，疊在鋪面上。 */
  MARKING: 0.003,
  /** 夜間的地面光暈，疊在標線上。 */
  LIGHT_SPOT: 0.004,
} as const;
```

- [ ] **Step 4：把 `propBands.ts` 的定義換成轉出**

刪掉 `propBands.ts` 裡的 `HALF_ENVELOPE`、`CELL_EDGE`、`OVERHEAD_CLEARANCE`、
`FLOOR_HEIGHT_UNITS`、`SHOPFRONT_CEILING`、`GROUND_LAYERS` 六段定義，改成第一行：

```ts
import {
  HALF_ENVELOPE, CELL_EDGE, OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS,
  SHOPFRONT_CEILING, GROUND_LAYERS,
} from './massing/metrics';

// 既有呼叫端從 propBands 取這些常數。實體在 metrics —— 這裡只轉出，不再定義。
export { OVERHEAD_CLEARANCE, FLOOR_HEIGHT_UNITS, SHOPFRONT_CEILING, GROUND_LAYERS };
```

`HALF_ENVELOPE` 與 `CELL_EDGE` 原本就是模組私有，不必轉出。

- [ ] **Step 5：跑全量測試**

```
pnpm vitest run && pnpm tsc --noEmit
```
預期：全綠。既有的 `GroundLayers.test.ts`、`BuildingMaterial.test.ts`、
`PropBands.test.ts` 從 `propBands` 取常數，轉出讓它們原封不動就過。

- [ ] **Step 6：回退驗證**

把 `metrics.ts` 的 `HALF_ENVELOPE` 改成寫死的 `0.4`，跑
`MassingMetrics.test.ts` —— 第一條應轉紅（`toBeCloseTo` 對 0.40833 失敗）。改回來。

- [ ] **Step 7：Commit**

```bash
git add -A
git commit -m "refactor(render): move shared massing scalars to a leaf module

propBands 之後要量 massing 產出的量體，而 massing 要用 SHOPFRONT_CEILING ——
那是一個 import 循環。兩邊都要的純量搬到沒有相依的 metrics.ts 就斷開了。

propBands 轉出這些常數，既有呼叫端不必改。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013CaAT8jcajKrRTLsVvFoop"
```

---

## Task 2：`rng.ts` 與 `dimensions.ts` —— 每個變體的尺寸

**Files:**
- Create: `src/renderer/geometry/buildings/massing/rng.ts`
- Create: `src/renderer/geometry/buildings/massing/dimensions.ts`
- Test: `src/renderer/__tests__/MassingDimensions.test.ts`（新）

**Interfaces:**
- Consumes：`metrics.ts` 的 `M`、`FLOOR_HEIGHT_UNITS`、`HALF_ENVELOPE`；
  `registry.ts` 的 `TARGET_HEIGHTS_M`、`TARGET_WIDTHS_M`、`heightKey`、`Density`；
  `BuildingAppearance.ts` 的 `hashCell`。
- Produces：
  ```ts
  // rng.ts
  export type Rng = () => number;                       // 每次呼叫回傳新的 [0, 1)
  export function variantRng(
    zoneType: number, density: Density, level: number, variantIndex: number,
  ): Rng;

  // dimensions.ts
  export const VARIANT_COUNT = 8;
  export interface HeightOption { floors: number; floorHeight: number; height: number }
  export function heightOptions(targetUnits: number): HeightOption[];
  export interface Dimensions {
    w: number; d: number;        // 基地寬深（格）
    floors: number;
    floorHeight: number;         // 格
    height: number;              // floors × floorHeight（格）
  }
  export function dimensionsFor(
    zoneType: number, density: Density, level: number, variantIndex: number,
  ): Dimensions | null;          // 這個 (分區, 密度) 沒有建築時回傳 null
  ```

- [ ] **Step 1：寫失敗測試**

`src/renderer/__tests__/MassingDimensions.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { variantRng } from '../geometry/buildings/massing/rng';
import {
  VARIANT_COUNT, heightOptions, dimensionsFor,
} from '../geometry/buildings/massing/dimensions';
import { M, FLOOR_HEIGHT_UNITS, HALF_ENVELOPE }
  from '../geometry/buildings/massing/metrics';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, type Density }
  from '../geometry/buildings/registry';

function eachBucket(fn: (z: number, d: Density, key: string) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    fn(Number(zs), ds as Density, key);
  }
}

const LEVELS = [1, 2, 3] as const;
const MID_FLOOR = (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;
/** 高樓的桶。百分比咬得住，等級區間必須互不重疊。 */
const TALL = ['2:HIGH', '4:HIGH', '6:HIGH'];

describe('variantRng', () => {
  it('should give the same stream for the same variant', () => {
    // 幾何在遊戲啟動時生成，存檔前後必須逐頂點相同 —— 亂數一旦洩漏，
    // 讀檔之後整座城市會換一批形狀。
    const a = variantRng(1, 'LOW', 2, 3);
    const b = variantRng(1, 'LOW', 2, 3);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('should give different streams to different variants', () => {
    const seen = new Set<number>();
    eachBucket((z, d) => {
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) seen.add(variantRng(z, d, lv, vi)());
      }
    });
    // 7 桶 × 3 等級 × 8 變體 = 168。撞值代表輸入的某個維度沒有進雜湊。
    expect(seen.size).toBe(168);
  });

  it('should stay inside [0, 1)', () => {
    const r = variantRng(5, 'LOW', 3, 7);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('heightOptions', () => {
  it('should never come back empty for any bucket in the table', () => {
    // 空清單代表這個目標高度湊不出整數層 —— 生成器會沒有東西可挑。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        expect(heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!)).length,
          `${key} L${lv}`).toBeGreaterThan(0);
      }
    });
  });

  it('should widen the window to at least one storey', () => {
    // 固定百分比在矮建築上會塌成一個選項：住宅低 L1 目標 5 m，±10% 只容得下
    // 「2 層 × 2.64 m」。一層樓的容差才是整數層世界裡有意義的下限。
    const floors = new Set(heightOptions(M(5)).map(o => o.floors));
    expect(floors.size, '住宅低 L1 只有一種樓層數').toBeGreaterThanOrEqual(2);
  });

  it('should keep every option within the tolerance', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const target = M(TARGET_HEIGHTS_M[key]![lv - 1]!);
        const tolerance = Math.max(0.1 * target, MID_FLOOR);
        for (const o of heightOptions(target)) {
          expect(Math.abs(o.height - target), `${key} L${lv} ${o.floors} 層`)
            .toBeLessThanOrEqual(tolerance + 1e-9);
          expect(o.height).toBeCloseTo(o.floors * o.floorHeight, 12);
          expect(o.floorHeight).toBeGreaterThanOrEqual(FLOOR_HEIGHT_UNITS.MIN - 1e-9);
          expect(o.floorHeight).toBeLessThanOrEqual(FLOOR_HEIGHT_UNITS.MAX + 1e-9);
        }
      }
    });
  });

  it('should give the tall buckets real height variety', () => {
    // 矮建築的變化來自屋頂與偏屋，高樓的變化就該來自樓層數。
    for (const key of TALL) {
      for (const lv of LEVELS) {
        expect(heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!)).length,
          `${key} L${lv}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('should come back sorted by height', () => {
    const opts = heightOptions(M(42));
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i]!.height).toBeGreaterThanOrEqual(opts[i - 1]!.height);
    }
  });

  it('should fall back to the closest option rather than returning nothing', () => {
    // 目標小於一層樓時沒有任何組合落在容差內。回空清單會讓呼叫端拿到
    // undefined 然後在別的地方爆炸，追起來很遠。
    const opts = heightOptions(M(0.5));
    expect(opts.length).toBe(1);
    expect(opts[0]!.floors).toBe(1);
  });
});

describe('dimensionsFor', () => {
  it('should return null for a bucket with no buildings', () => {
    expect(dimensionsFor(1, 'HIGH', 1, 0)).toBeNull();   // 住宅低沒有高密度
    expect(dimensionsFor(999, 'LOW', 1, 0)).toBeNull();
  });

  it('should use every height option across the eight variants', () => {
    // 「分層鋪滿」的意思：八個變體要覆蓋所有可行組合，不是隨機取樣。
    // 隨機取樣有可能八個都擠在中間。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const opts = heightOptions(M(TARGET_HEIGHTS_M[key]![lv - 1]!));
        const used = new Set<number>();
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          used.add(dimensionsFor(z, d, lv, vi)!.height);
        }
        expect(used.size, `${key} L${lv} 用了 ${used.size}/${opts.length} 個組合`)
          .toBe(Math.min(opts.length, VARIANT_COUNT));
      }
    });
  });

  it('should keep the mean height climbing with level', () => {
    // 等級階梯活在平均值裡，不在極值裡 —— 矮建築的容差寬到區間會重疊。
    eachBucket((z, d, key) => {
      const mean = (lv: number) => {
        let s = 0;
        for (let vi = 0; vi < VARIANT_COUNT; vi++) s += dimensionsFor(z, d, lv, vi)!.height;
        return s / VARIANT_COUNT;
      };
      expect(mean(2), `${key} L2 沒有比 L1 高`).toBeGreaterThan(mean(1));
      expect(mean(3), `${key} L3 沒有比 L2 高`).toBeGreaterThan(mean(2));
    });
  });

  it('should keep the tall buckets levels from overlapping at all', () => {
    // 高樓那一端百分比咬得住，所以階梯可以要求得更嚴：區間完全不重疊。
    for (const key of TALL) {
      const [zs, ds] = key.split(':');
      const range = (lv: number) => {
        const hs: number[] = [];
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          hs.push(dimensionsFor(Number(zs), ds as Density, lv, vi)!.height);
        }
        return { lo: Math.min(...hs), hi: Math.max(...hs) };
      };
      expect(range(1).hi, `${key} L1 追上 L2`).toBeLessThan(range(2).lo);
      expect(range(2).hi, `${key} L2 追上 L3`).toBeLessThan(range(3).lo);
    }
  });

  it('should keep the footprint inside the pedestrian envelope', () => {
    // 越過包絡線就是行人穿牆（BUG-221）。這裡擋的是「基地本身」，
    // 組合器把量體推出去的情形由 Task 3 擋。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          const dim = dimensionsFor(z, d, lv, vi)!;
          expect(Math.max(dim.w, dim.d) / 2, `${key} L${lv} v${vi}`)
            .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
        }
      }
    });
  });

  it('should vary the footprint between variants', () => {
    // 基地全一樣的話，矮建築就只剩屋頂形式可以變。
    const widths = new Set<number>();
    for (let vi = 0; vi < VARIANT_COUNT; vi++) {
      widths.add(Math.round(dimensionsFor(3, 'LOW', 2, vi)!.w * 1e6));
    }
    expect(widths.size).toBeGreaterThanOrEqual(6);
  });

  it('should never shrink the footprint below 85% of the target', () => {
    // 太窄的話前庭鋪面與矮物件帶會被拉開，牆腳露出一圈裸地（BUG-226 的成因）。
    eachBucket((z, d, key) => {
      const target = M(TARGET_WIDTHS_M[key]!);
      for (const lv of LEVELS) {
        for (let vi = 0; vi < VARIANT_COUNT; vi++) {
          const dim = dimensionsFor(z, d, lv, vi)!;
          expect(dim.w / target, `${key} L${lv} v${vi} 寬`)
            .toBeGreaterThanOrEqual(0.85 - 1e-9);
          expect(dim.d / target, `${key} L${lv} v${vi} 深`)
            .toBeGreaterThanOrEqual(0.85 - 1e-9);
          expect(dim.w / target).toBeLessThanOrEqual(1 + 1e-9);
          expect(dim.d / target).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    });
  });
});
```

- [ ] **Step 2：跑紅**

```
pnpm vitest run src/renderer/__tests__/MassingDimensions.test.ts
```
預期：`Failed to resolve import ".../massing/rng"`。

- [ ] **Step 3：實作 `rng.ts`**

```ts
import { hashCell } from '../../../BuildingAppearance';
import type { Density } from '../registry';

/** 每次呼叫回傳一個新的 [0, 1)。 */
export type Rng = () => number;

/**
 * 一個變體專屬的確定性亂數流。
 *
 * 與 `BuildingAppearance` 的逐格亂數是兩件事：那一條決定「這一格用哪一個變體」，
 * 這一條決定「這個變體長什麼樣」。變體的形狀不可以隨格子改變 —— 幾何是整桶
 * 共用的一份，同一個變體在城市各處必須完全一樣。
 *
 * 四個輸入壓成 hashCell 的前兩個參數（都在安全範圍內：分區 1–6、等級 1–3、
 * 變體 0–7、密度 0–1），第四個參數當呼叫計數器用。
 */
export function variantRng(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Rng {
  const a = zoneType * 8 + level;
  const b = variantIndex * 2 + (density === 'HIGH' ? 1 : 0);
  let n = 0;
  return () => hashCell(a, b, 0, n++);
}
```

- [ ] **Step 4：實作 `dimensions.ts`**

```ts
import { M, FLOOR_HEIGHT_UNITS } from './metrics';
import { variantRng } from './rng';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, heightKey, type Density } from '../registry';

/**
 * 每個 (分區, 密度, 等級) 的變體數。
 *
 * 八是「相鄰重複率」與「桶數」的折衷：純逐格雜湊的重複率是 1/V，八個是 12.5%，
 * 配上鄰居迴避才壓得到 5% 以下；再往上加只會線性推高 draw call。
 */
export const VARIANT_COUNT = 8;

/** 樓高在 [MIN, MAX] 之間取幾個樣本。五個讓矮建築也湊得出兩三種高度。 */
const FLOOR_SAMPLES = 5;

const MID_FLOOR = (FLOOR_HEIGHT_UNITS.MIN + FLOOR_HEIGHT_UNITS.MAX) / 2;

export interface HeightOption {
  floors: number;
  /** 格 */
  floorHeight: number;
  /** floors × floorHeight，格 */
  height: number;
}

function floorHeightSample(s: number): number {
  return FLOOR_HEIGHT_UNITS.MIN
    + (FLOOR_HEIGHT_UNITS.MAX - FLOOR_HEIGHT_UNITS.MIN) * s / (FLOOR_SAMPLES - 1);
}

/**
 * 這個目標高度湊得出來的 (樓層數, 樓高) 組合，依高度排序。
 *
 * **容差跟著高度走**：`max(10% × 目標, 一層樓)`。固定百分比是錯的模型 ——
 * 高度必須是整數層乘樓高，而對矮建築來說一層樓就是目標的一大截：住宅低 L1
 * 目標 5 m，±10% = [4.5, 5.5] 只容得下「2 層 × 2.64 m」一個組合，八個變體
 * 會高度全一樣。對 42 m 的塔樓來說多一層才多 8%，百分比才咬得住。
 *
 * 「至少容得下一層樓」是這條規則的全部理由：低於一層樓的容差在整數層的世界裡
 * 沒有意義。
 */
export function heightOptions(targetUnits: number): HeightOption[] {
  const tolerance = Math.max(0.1 * targetUnits, MID_FLOOR);
  const lo = targetUnits - tolerance;
  const hi = targetUnits + tolerance;

  const out: HeightOption[] = [];
  let closest: HeightOption | null = null;
  let closestGap = Infinity;

  for (let floors = 1; floors <= 64; floors++) {
    for (let s = 0; s < FLOOR_SAMPLES; s++) {
      const floorHeight = floorHeightSample(s);
      const height = floors * floorHeight;
      const opt = { floors, floorHeight, height };
      if (height >= lo && height <= hi) out.push(opt);
      const gap = Math.abs(height - targetUnits);
      if (gap < closestGap) { closestGap = gap; closest = opt; }
    }
  }

  // 目標小於一層樓時沒有任何組合落在容差內。回空清單會讓呼叫端拿到 undefined
  // 然後在別的地方爆炸，追起來很遠。
  if (out.length === 0) return closest ? [closest] : [];

  out.sort((a, b) => a.height - b.height);
  return out;
}

export interface Dimensions {
  /** 基地寬深（格） */
  w: number;
  d: number;
  floors: number;
  /** 格 */
  floorHeight: number;
  /** floors × floorHeight（格） */
  height: number;
}

/**
 * 這個變體的尺寸。這個 (分區, 密度) 沒有建築時回傳 null。
 *
 * 高度**分層鋪滿**所有可行組合而不是隨機取樣 —— 隨機取樣有可能八個都擠在中間。
 * 基地寬深各自在目標的 85%–100% 之間取：低於 85% 會讓前庭鋪面與牆腳拉開，
 * 那正是 BUG-226 的成因。
 */
export function dimensionsFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Dimensions | null {
  const key = heightKey(zoneType, density);
  const heights = TARGET_HEIGHTS_M[key];
  const targetW = TARGET_WIDTHS_M[key];
  if (!heights || targetW === undefined) return null;

  const lv = Math.max(1, Math.min(3, level));
  const opts = heightOptions(M(heights[lv - 1]!));
  const opt = opts[Math.floor((variantIndex / VARIANT_COUNT) * opts.length) % opts.length]!;

  const rng = variantRng(zoneType, density, level, variantIndex);
  const full = M(targetW);
  return {
    w: full * (0.85 + 0.15 * rng()),
    d: full * (0.85 + 0.15 * rng()),
    floors: opt.floors,
    floorHeight: opt.floorHeight,
    height: opt.height,
  };
}
```

- [ ] **Step 5：跑綠**

```
pnpm vitest run src/renderer/__tests__/MassingDimensions.test.ts
```

若「should use every height option」紅了，看訊息裡的 `用了 N/M 個組合`：
`Math.floor((vi / V) * opts.length)` 在 `opts.length > V` 時本來就取不滿八個以上，
所以斷言寫的是 `Math.min(opts.length, VARIANT_COUNT)`。真正的失敗是取不滿
`opts.length < V` 的那些桶。

- [ ] **Step 6：回退驗證（兩項）**

1. 把 `heightOptions` 的容差改成固定 `0.1 * targetUnits`（拿掉 `Math.max`）——
   `should widen the window to at least one storey` 應轉紅。改回來。
2. 把 `dimensionsFor` 的高度挑選改成 `opts[0]`（永遠取最矮的）——
   `should use every height option` 與 `should keep the mean height climbing`
   應轉紅。改回來。

- [ ] **Step 7：Commit**

```bash
git add -A
git commit -m "feat(render): per-variant rng and height options for the massing generator"
```

commit 訊息正文（貼在 -m 的多行字串裡）：

```
高度改成「樓層數 × 樓高」而不是「目標高度 × 縮放係數」，容差跟著高度走：
max(10% × 目標, 一層樓)。

固定百分比是錯的模型 —— 高度必須是整數層，而對矮建築來說一層樓就是目標的
一大截：住宅低 L1 目標 5 m，±10% 只容得下「2 層 × 2.64 m」一個組合，八個
變體會高度全一樣。放寬到一層樓之後是 1 到 3 層，那才是郊區街道的樣子。
對 42 m 的塔樓來說多一層才多 8%，百分比自然接手。

等級階梯因此改成看平均值：矮建築的區間會重疊（三層的 L1 可能比兩層的 L3
高），高樓那一端百分比咬得住，區間仍完全不重疊。
```

---

## Task 3：`volume.ts` —— 量體型別與輪廓量測

**規格的第二處修正**：規格第六節寫「每桶至少 6/8 的變體，旋轉 90° 後輪廓必須
改變」。**高樓做不到** —— 板樓與裙樓塔本質上是對稱的，而它們是高密度分區在 L1
僅有的原型。硬湊 6/8 只會逼出不合理的形狀。

真正要的是「一條街不重複」，那由兩條測試直接量：

- **每桶八個變體的輪廓兩兩相異**（差異率 ≥ 0.10）—— 這才是主要條件
- **至少 4/8 的變體旋轉後輪廓改變** —— 確保旋轉這四倍不是白給的

**Files:**
- Create: `src/renderer/geometry/buildings/massing/volume.ts`
- Test: `src/renderer/__tests__/MassingVolume.test.ts`（新）

**Interfaces:**
- Consumes：`metrics.ts` 的 `HALF_ENVELOPE`。
- Produces：
  ```ts
  export type VolumeShape = 'box' | 'gable' | 'hip' | 'shed' | 'sawtooth';
  export interface Volume {
    x: number; z: number;          // 中心（格）
    w: number; d: number;          // 寬深（格）
    y0: number; y1: number;        // 底與頂（格）
    shape?: VolumeShape;           // 預設 'box'
    part?: number;                 // 預設 PART_WALL
    facing?: 0 | 1 | 2 | 3;        // 斜面朝向 +z/+x/-z/-x，預設 0
  }

  export const RASTER = 16;
  export function maxAbsOf(vs: readonly Volume[]): number;
  export function topOf(vs: readonly Volume[]): number;
  export function overlapOf(a: Volume, b: Volume): number;   // 三維交集體積
  export function centroidOffset(vs: readonly Volume[]): number;  // 0 = 完全對稱
  export function rasterise(vs: readonly Volume[]): Float32Array; // RASTER × RASTER 高度圖
  export function rotate90(grid: Float32Array): Float32Array;
  export function differenceRatio(a: Float32Array, b: Float32Array, tolerance: number): number;
  ```

- [ ] **Step 1：寫失敗測試**

`src/renderer/__tests__/MassingVolume.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  RASTER, maxAbsOf, topOf, overlapOf, centroidOffset,
  rasterise, rotate90, differenceRatio, type Volume,
} from '../geometry/buildings/massing/volume';

const box = (o: Partial<Volume> = {}): Volume =>
  ({ x: 0, z: 0, w: 0.6, d: 0.6, y0: 0, y1: 0.5, ...o });

describe('volume measurement', () => {
  it('should measure the furthest corner from the cell centre', () => {
    // 用「離格心的最大距離」而不是包圍盒寬度：非置中的量體會單邊外凸，
    // 而寬度看不出來。那正是 BUG-222 的一半。
    expect(maxAbsOf([box()])).toBeCloseTo(0.3, 12);
    expect(maxAbsOf([box({ x: 0.2 })]), '偏心的量體').toBeCloseTo(0.5, 12);
    expect(maxAbsOf([box({ w: 0.4, d: 0.9 })]), '深比寬大').toBeCloseTo(0.45, 12);
  });

  it('should report the tallest point', () => {
    expect(topOf([box({ y1: 0.4 }), box({ y0: 0.4, y1: 0.9 })])).toBeCloseTo(0.9, 12);
  });

  it('should find no overlap between stacked volumes', () => {
    // 裙樓與塔身共用一個平面：塔的底等於裙樓的頂，接觸不算重疊。
    expect(overlapOf(box({ y1: 0.3 }), box({ y0: 0.3, y1: 1.0 }))).toBe(0);
  });

  it('should find no overlap between volumes side by side', () => {
    expect(overlapOf(box({ x: -0.3, w: 0.4 }), box({ x: 0.3, w: 0.2 }))).toBe(0);
  });

  it('should measure the intersection when volumes really do overlap', () => {
    // 重疊的量體會產生看不見的內部面 —— 白吃三角形，而且畫面上完全看不出來。
    const a = box({ x: 0, w: 0.4, d: 0.4, y0: 0, y1: 1 });
    const b = box({ x: 0.2, w: 0.4, d: 0.4, y0: 0, y1: 1 });
    expect(overlapOf(a, b)).toBeCloseTo(0.2 * 0.4 * 1, 12);
  });

  it('should call a centred single box symmetric', () => {
    expect(centroidOffset([box()])).toBeCloseTo(0, 12);
  });

  it('should call an L-shape asymmetric', () => {
    // 兩翼的重心明顯偏離包圍盒中心。
    const l: Volume[] = [
      { x: -0.1, z: 0, w: 0.4, d: 0.7, y0: 0, y1: 0.6 },
      { x: 0.2, z: -0.2, w: 0.3, d: 0.3, y0: 0, y1: 0.6 },
    ];
    expect(centroidOffset(l)).toBeGreaterThan(0.04);
  });

  it('should not be fooled by a box that is merely wider than deep', () => {
    // 7.5 x 8.2 的盒子轉 90 度看起來還是同一個盒子。重心法看得出來，
    // 光柵差異法看不出來 —— 這正是這個指標存在的理由。
    expect(centroidOffset([box({ w: 0.5, d: 0.7 })])).toBeCloseTo(0, 12);
  });
});

describe('silhouette raster', () => {
  it('should record the height of each cell', () => {
    const g = rasterise([box({ w: 1.0, d: 1.0, y1: 0.42 })]);
    expect(g.length).toBe(RASTER * RASTER);
    for (let i = 0; i < g.length; i++) expect(g[i]).toBeCloseTo(0.42, 6);
  });

  it('should leave empty ground at zero', () => {
    const g = rasterise([box({ x: -0.25, w: 0.4, d: 1.0, y1: 0.5 })]);
    // 右半邊沒有量體。
    expect(g[RASTER * 8 + RASTER - 1]).toBe(0);
    expect(g[RASTER * 8 + 1]).toBeCloseTo(0.5, 6);
  });

  it('should keep the tallest volume when two stack', () => {
    const g = rasterise([box({ y1: 0.3 }), box({ w: 0.2, d: 0.2, y0: 0.3, y1: 0.8 })]);
    expect(g[RASTER * 8 + 8]).toBeCloseTo(0.8, 6);
  });

  it('should rotate a quarter turn', () => {
    const g = rasterise([box({ x: -0.3, w: 0.3, d: 0.9, y1: 0.5 })]);
    const r = rotate90(g);
    expect(r.length).toBe(g.length);
    // 轉過之後原本靠西的那一條會靠北（或靠南，看方向），總之不再在原位。
    expect(differenceRatio(g, r, 0.05)).toBeGreaterThan(0.1);
  });

  it('should call a shape identical to itself', () => {
    const g = rasterise([box()]);
    expect(differenceRatio(g, g, 0.05)).toBe(0);
  });

  it('should call a square box unchanged by rotation', () => {
    // 正方形的盒子轉 90 度是無操作 —— 那就是現行變體的處境。
    const g = rasterise([box({ w: 0.6, d: 0.6 })]);
    expect(differenceRatio(g, rotate90(g), 0.05)).toBe(0);
  });

  it('should ignore height differences below the tolerance', () => {
    // 容差取半層樓：矮了 10 公分不算「不一樣的形狀」。
    const a = rasterise([box({ y1: 0.50 })]);
    const b = rasterise([box({ y1: 0.51 })]);
    expect(differenceRatio(a, b, 0.05)).toBe(0);
    expect(differenceRatio(a, b, 0.005)).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2：跑紅**

```
pnpm vitest run src/renderer/__tests__/MassingVolume.test.ts
```
預期：`Failed to resolve import ".../massing/volume"`。

- [ ] **Step 3：實作**

`src/renderer/geometry/buildings/massing/volume.ts`：

```ts
import { PART_WALL } from '../parts';

/**
 * 量體 —— 生成器的中間表示。
 *
 * 生成器不直接產出 `BufferGeometry`，而是先產出一串盒子的座標。多這一層是為了
 * 讓「不對稱、重疊、越界」能用算術精確驗證：階段 2B 的 BUG-222 正是因為只能量
 * 合併後的包圍盒，而漏掉了「離格心最大距離」與「包圍盒寬度」的差別。
 *
 * 座標單位是格（1 格 = 12 m），y0 = 0 是地面，格心是 (0, 0)。
 */

export type VolumeShape = 'box' | 'gable' | 'hip' | 'shed' | 'sawtooth';

export interface Volume {
  /** 中心 */
  x: number;
  z: number;
  /** 寬深 */
  w: number;
  d: number;
  /** 底與頂 */
  y0: number;
  y1: number;
  /** 畫成什麼。預設是盒子。 */
  shape?: VolumeShape;
  /** 零件標籤，預設 `PART_WALL`。 */
  part?: number;
  /** 斜面朝向：0 = +z、1 = +x、2 = −z、3 = −x。只有斜屋頂用得到。 */
  facing?: 0 | 1 | 2 | 3;
}

/** 輪廓光柵的邊長。16 夠細到分得出偏屋，又夠粗到不受浮點誤差影響。 */
export const RASTER = 16;

export const partOf = (v: Volume): number => v.part ?? PART_WALL;

const x0 = (v: Volume) => v.x - v.w / 2;
const x1 = (v: Volume) => v.x + v.w / 2;
const z0 = (v: Volume) => v.z - v.d / 2;
const z1 = (v: Volume) => v.z + v.d / 2;

/**
 * 離格心的最大距離。
 *
 * 用它而不是包圍盒寬度：非置中的量體會單邊外凸，而寬度看不出來。行人的門節點
 * 在 `HALF_ENVELOPE` 外側，所以越過它就是行人穿牆（BUG-221/222）。
 */
export function maxAbsOf(vs: readonly Volume[]): number {
  let m = 0;
  for (const v of vs) {
    m = Math.max(m, Math.abs(x0(v)), Math.abs(x1(v)), Math.abs(z0(v)), Math.abs(z1(v)));
  }
  return m;
}

/** 最高點。 */
export function topOf(vs: readonly Volume[]): number {
  let m = 0;
  for (const v of vs) m = Math.max(m, v.y1);
  return m;
}

/**
 * 兩個量體的交集體積。接觸（共面）回傳 0。
 *
 * 重疊的量體會產生看不見的內部面 —— 白吃三角形，而且畫面上完全看不出來，
 * 所以只能用算術擋。
 */
export function overlapOf(a: Volume, b: Volume): number {
  const ox = Math.min(x1(a), x1(b)) - Math.max(x0(a), x0(b));
  const oz = Math.min(z1(a), z1(b)) - Math.max(z0(a), z0(b));
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return ox > 0 && oz > 0 && oy > 0 ? ox * oz * oy : 0;
}

/**
 * 體積重心偏離包圍盒中心的距離，除以包圍盒的邊長。0 就是完全對稱。
 *
 * 這是「旋轉有沒有意義」的指標，而不是用光柵差異：一個 7.5 × 8.2 的盒子轉
 * 90° 之後光柵差異可以到 15%，但它看起來還是同一個盒子。重心看得出真正的
 * 不對稱（L 形、偏屋、偏置塔），看不出「只是寬深不同」。
 */
export function centroidOffset(vs: readonly Volume[]): number {
  let mass = 0;
  let cx = 0;
  let cz = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of vs) {
    const m = v.w * v.d * (v.y1 - v.y0);
    mass += m;
    cx += v.x * m;
    cz += v.z * m;
    minX = Math.min(minX, x0(v));
    maxX = Math.max(maxX, x1(v));
    minZ = Math.min(minZ, z0(v));
    maxZ = Math.max(maxZ, z1(v));
  }
  if (mass <= 0) return 0;
  const dx = cx / mass - (minX + maxX) / 2;
  const dz = cz / mass - (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);
  return span > 0 ? Math.hypot(dx, dz) / span : 0;
}

/**
 * 把量體光柵化成 `RASTER × RASTER` 的高度圖，涵蓋整個格子 [−0.5, 0.5]。
 *
 * 格值是該處的最高點，沒有量體的格是 0。這讓「兩個形狀像不像」變成一個算得
 * 出來的數字，而不是憑感覺。
 */
export function rasterise(vs: readonly Volume[]): Float32Array {
  const g = new Float32Array(RASTER * RASTER);
  for (let r = 0; r < RASTER; r++) {
    const z = -0.5 + (r + 0.5) / RASTER;
    for (let c = 0; c < RASTER; c++) {
      const x = -0.5 + (c + 0.5) / RASTER;
      let h = 0;
      for (const v of vs) {
        if (x >= x0(v) && x <= x1(v) && z >= z0(v) && z <= z1(v)) h = Math.max(h, v.y1);
      }
      g[r * RASTER + c] = h;
    }
  }
  return g;
}

/** 高度圖轉四分之一圈。 */
export function rotate90(grid: Float32Array): Float32Array {
  const out = new Float32Array(grid.length);
  for (let r = 0; r < RASTER; r++) {
    for (let c = 0; c < RASTER; c++) {
      out[c * RASTER + (RASTER - 1 - r)] = grid[r * RASTER + c]!;
    }
  }
  return out;
}

/**
 * 兩個高度圖的差異率：高度差超過 `tolerance` 的格子佔全部的比例。
 *
 * `tolerance` 通常取半層樓 —— 矮了十公分不算「不一樣的形狀」。
 */
export function differenceRatio(
  a: Float32Array, b: Float32Array, tolerance: number,
): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > tolerance) n++;
  return n / a.length;
}
```

- [ ] **Step 4：跑綠**

```
pnpm vitest run src/renderer/__tests__/MassingVolume.test.ts
```

- [ ] **Step 5：回退驗證（兩項）**

1. 把 `maxAbsOf` 改成回傳 `Math.max(v.w, v.d) / 2`（忽略偏心）——
   `should measure the furthest corner from the cell centre` 的第二條斷言應轉紅。
2. 把 `centroidOffset` 改成回傳光柵差異率
   （`differenceRatio(rasterise(vs), rotate90(rasterise(vs)), 0.05)`）——
   `should not be fooled by a box that is merely wider than deep` 應轉紅。
   **這一條就是這個指標存在的理由**，改回來之後要確認它綠。

- [ ] **Step 6：Commit**

```bash
git add -A
git commit -F- <<'MSG'
feat(render): Volume — the massing generator's intermediate representation

生成器先產出一串盒子的座標，再由 assemble 轉成幾何。多這一層是為了讓
「不對稱、重疊、越界」能用算術精確驗證 —— BUG-222 正是因為只能量合併後的
包圍盒，而漏掉「離格心最大距離」與「包圍盒寬度」的差別。

centroidOffset 用體積重心而不是光柵差異來判斷不對稱：一個 7.5 x 8.2 的
盒子轉 90 度之後光柵差異可以到 15%，但它看起來還是同一個盒子。

順帶修正規格第六節的「6/8 變體旋轉後輪廓改變」—— 高樓做不到，板樓與裙樓塔
本質上就是對稱的，而它們是高密度分區 L1 僅有的原型。降到 4/8，主要條件改成
「八個變體的輪廓兩兩相異」。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013CaAT8jcajKrRTLsVvFoop
MSG
```

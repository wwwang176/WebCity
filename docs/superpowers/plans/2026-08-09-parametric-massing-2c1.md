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

---

## Task 4：`composers.ts` —— 八個量體組合器

原型不是每個都手寫一份幾何，而是「組合器 + 參數」。八個組合器涵蓋所有分區，
原型表只是一張參數表（Task 5）。

**設計時丟掉的一個組合器：** 原本規劃了「一樓凹進（騎樓）」，但**它在俯視高度圖
裡看不出來** —— `rasterise` 取的是最高點，凹進去的一樓被上面的樓層蓋住，所以它會
與「單一量體」判定成同一個輪廓，讓「八個變體兩兩相異」那條測試失效。騎樓的視覺
效果本來就由懸挑層的雨遮負責，所以拿掉，不補。

**Files:**
- Create: `src/renderer/geometry/buildings/massing/composers.ts`
- Test: `src/renderer/__tests__/MassingComposers.test.ts`（新）

**Interfaces:**
- Consumes：`volume.ts` 的 `Volume`；`dimensions.ts` 的 `Dimensions`；`rng.ts` 的 `Rng`。
- Produces：
  ```ts
  export type Composer = (dims: Dimensions, rng: Rng) => Volume[];
  export function single(dims: Dimensions): Volume[];
  export function mainPlusWing(wingFrac: number, wingHeightFrac: number): Composer;
  export function lShape(armFrac: number): Composer;
  export function podiumTower(podiumFloors: number, towerFrac: number, offsetFrac: number): Composer;
  export function setback(steps: number): Composer;
  export function notch(notchFrac: number): Composer;
  export function twin(gapFrac: number): Composer;
  export function splitSpan(tallFrac: number): Composer;
  ```

**每個組合器都必須守住的三條不變式**（測試逐條檢查，不靠自律）：

1. 所有量體落在 `[-w/2, w/2] × [-d/2, d/2]` 之內 —— 基地是 `dimensions` 決定的，
   組合器不得自己撐開
2. 兩兩不重疊（接觸可以）—— 重疊會產生看不見的內部面
3. 最高點正好等於 `dims.height` —— 高度是 `dimensions` 決定的

- [ ] **Step 1：寫失敗測試**

`src/renderer/__tests__/MassingComposers.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  single, mainPlusWing, lShape, podiumTower, setback, notch, twin, splitSpan,
  type Composer,
} from '../geometry/buildings/massing/composers';
import {
  maxAbsOf, topOf, overlapOf, centroidOffset, rasterise, differenceRatio,
  type Volume,
} from '../geometry/buildings/massing/volume';
import type { Dimensions } from '../geometry/buildings/massing/dimensions';
import { variantRng } from '../geometry/buildings/massing/rng';

/** 一組有代表性的尺寸：矮寬的房子、高瘦的塔。 */
const HOUSE: Dimensions = { w: 0.62, d: 0.58, floors: 2, floorHeight: 0.26, height: 0.52 };
const TOWER: Dimensions = { w: 0.74, d: 0.70, floors: 13, floorHeight: 0.26, height: 3.38 };

const ALL: Array<[string, Composer]> = [
  ['single', (d) => single(d)],
  ['mainPlusWing', mainPlusWing(0.4, 0.5)],
  ['lShape', lShape(0.55)],
  ['podiumTower', podiumTower(2, 0.66, 0)],
  ['offsetTower', podiumTower(2, 0.6, 0.9)],
  ['setback', setback(3)],
  ['notch', notch(0.34)],
  ['twin', twin(0.24)],
  ['splitSpan', splitSpan(0.55)],
];

/** 同一組輸入跑八次，涵蓋 rng 的不同分支。 */
function samples(c: Composer, dims: Dimensions): Volume[][] {
  const out: Volume[][] = [];
  for (let vi = 0; vi < 8; vi++) out.push(c(dims, variantRng(1, 'LOW', 1, vi)));
  return out;
}

describe('composers keep the invariants', () => {
  it('should stay inside the footprint dimensions gave them', () => {
    // 基地是 dimensions 決定的（它已經確認過不越過行人包絡線）。組合器把量體
    // 推出去的話，那個檢查就白做了 —— BUG-221/222 會從這裡漏回來。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          expect(maxAbsOf(vs), `${name} 撐開了基地`)
            .toBeLessThanOrEqual(Math.max(dims.w, dims.d) / 2 + 1e-9);
        }
      }
    }
  });

  it('should never overlap its own volumes', () => {
    // 重疊會產生看不見的內部面：白吃三角形，畫面上完全看不出來。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          for (let i = 0; i < vs.length; i++) {
            for (let j = i + 1; j < vs.length; j++) {
              expect(overlapOf(vs[i]!, vs[j]!), `${name} 的第 ${i}、${j} 塊重疊`)
                .toBeCloseTo(0, 12);
            }
          }
        }
      }
    }
  });

  it('should reach exactly the height dimensions asked for', () => {
    // 高度是 dimensions 決定的。組合器自己加減會讓等級階梯漂掉。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          expect(topOf(vs), `${name} 沒有蓋到目標高度`).toBeCloseTo(dims.height, 9);
        }
      }
    }
  });

  it('should stand on the ground', () => {
    for (const [name, c] of ALL) {
      for (const vs of samples(c, TOWER)) {
        expect(Math.min(...vs.map(v => v.y0)), `${name} 沒有落地`).toBe(0);
      }
    }
  });

  it('should never emit a zero-volume block', () => {
    // 高度或寬度為 0 的量體會產生退化三角形，而且不會有任何東西報錯。
    for (const [name, c] of ALL) {
      for (const dims of [HOUSE, TOWER]) {
        for (const vs of samples(c, dims)) {
          for (const v of vs) {
            expect(v.w * v.d * (v.y1 - v.y0), `${name} 有一塊是空的`).toBeGreaterThan(1e-9);
          }
        }
      }
    }
  });
});

describe('composers earn their keep', () => {
  it('should give the asymmetric ones a real centroid offset', () => {
    // 旋轉是四倍的免費變化，但只有在形狀不對稱時才拿得到。
    const asym = ['mainPlusWing', 'lShape', 'offsetTower', 'twin', 'splitSpan'];
    for (const [name, c] of ALL) {
      if (!asym.includes(name)) continue;
      const offs = samples(c, TOWER).map(centroidOffset);
      expect(Math.max(...offs), `${name} 其實是對稱的`).toBeGreaterThan(0.04);
    }
  });

  it('should leave the symmetric ones symmetric', () => {
    // 這一條是上一條的對照。少了它，「不對稱」的門檻可能被一個回傳
    // 常數 0.05 的實作矇混過去。
    for (const name of ['single', 'setback']) {
      const c = ALL.find(e => e[0] === name)![1];
      for (const vs of samples(c, TOWER)) {
        expect(centroidOffset(vs), `${name} 不該偏心`).toBeCloseTo(0, 9);
      }
    }
  });

  it('should give every composer a silhouette of its own', () => {
    // 兩個組合器產出同一個輪廓，就等於少了一個組合器。
    const half = TOWER.floorHeight / 2;
    const grids = ALL.map(([name, c]) => [name, rasterise(c(TOWER, variantRng(1, 'LOW', 1, 0)))] as const);
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        expect(
          differenceRatio(grids[i]![1], grids[j]![1], half),
          `${grids[i]![0]} 與 ${grids[j]![0]} 輪廓相同`,
        ).toBeGreaterThanOrEqual(0.10);
      }
    }
  });

  it('should fall back to a single block when there are not enough floors', () => {
    // 一層樓的裙樓塔會讓塔身高度歸零。矮建築配到高樓原型是遲早的事。
    const oneFloor: Dimensions = { w: 0.6, d: 0.6, floors: 1, floorHeight: 0.26, height: 0.26 };
    for (const [name, c] of ALL) {
      const vs = c(oneFloor, variantRng(1, 'LOW', 1, 0));
      expect(topOf(vs), `${name} 一層樓時高度不對`).toBeCloseTo(0.26, 9);
      for (const v of vs) {
        expect(v.y1 - v.y0, `${name} 一層樓時有一塊是零高`).toBeGreaterThan(1e-9);
      }
    }
  });
});
```

- [ ] **Step 2：跑紅**

```
pnpm vitest run src/renderer/__tests__/MassingComposers.test.ts
```
預期：`Failed to resolve import ".../massing/composers"`。

- [ ] **Step 3：實作**

`src/renderer/geometry/buildings/massing/composers.ts`：

```ts
import type { Volume } from './volume';
import type { Dimensions } from './dimensions';
import type { Rng } from './rng';

/**
 * 量體組合器 —— 把一組尺寸攤成一串盒子。
 *
 * 原型不是每個都手寫一份幾何，而是「組合器 + 參數」。二十幾個原型手寫會是
 * 二十幾份幾乎一樣的座標算術，而其中任何一份算錯都只表現為「某個變體看起來
 * 怪怪的」。
 *
 * 每個組合器守三條不變式（`MassingComposers.test.ts` 逐條檢查）：
 *   1. 所有量體落在 `dims` 給的基地內 —— 基地已經確認過不越過行人包絡線
 *   2. 兩兩不重疊 —— 重疊會產生看不見的內部面
 *   3. 最高點正好等於 `dims.height` —— 高度由 `dimensions` 決定
 */
export type Composer = (dims: Dimensions, rng: Rng) => Volume[];

/** 單一量體。最簡單的那一個，也是所有退化情形的退路。 */
export function single(dims: Dimensions): Volume[] {
  return [{ x: 0, z: 0, w: dims.w, d: dims.d, y0: 0, y1: dims.height }];
}

/**
 * 主屋 + 偏屋。車庫、工具間、廠區的辦公角都是這個形狀。
 *
 * 偏屋靠 +x 且靠前（+z）—— 車庫開在前院那一側才合理。
 */
export function mainPlusWing(wingFrac: number, wingHeightFrac: number): Composer {
  return (dims, rng) => {
    const wingW = dims.w * wingFrac;
    const mainW = dims.w - wingW;
    const wingD = dims.d * (0.55 + 0.25 * rng());
    const wingH = Math.min(
      dims.height - 1e-6,
      Math.max(dims.floorHeight, dims.height * wingHeightFrac),
    );
    return [
      { x: -dims.w / 2 + mainW / 2, z: 0, w: mainW, d: dims.d, y0: 0, y1: dims.height },
      {
        x: dims.w / 2 - wingW / 2, z: dims.d / 2 - wingD / 2,
        w: wingW, d: wingD, y0: 0, y1: wingH,
      },
    ];
  };
}

/**
 * L 形平面。長翼沿北緣、短翼沿西緣，兩者在西北角相接。
 *
 * 這是最強的不對稱形狀：重心明顯偏離包圍盒中心，所以四向旋轉真的是四種面貌。
 */
export function lShape(armFrac: number): Composer {
  return (dims) => {
    const armD = dims.d * armFrac;
    const armW = dims.w * armFrac;
    const restD = dims.d - armD;
    return [
      { x: 0, z: -dims.d / 2 + armD / 2, w: dims.w, d: armD, y0: 0, y1: dims.height },
      {
        x: -dims.w / 2 + armW / 2, z: -dims.d / 2 + armD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
    ];
  };
}

/**
 * 裙樓 + 塔身。`offsetFrac` 為 0 時塔身置中（對稱），接近 1 時塔身推到裙樓
 * 邊緣（不對稱）—— 同一個組合器因此涵蓋兩種面貌。
 *
 * 樓層不足兩層時退回單一量體：一層樓的裙樓會把塔身壓成零高。
 */
export function podiumTower(
  podiumFloors: number, towerFrac: number, offsetFrac: number,
): Composer {
  return (dims, rng) => {
    if (dims.floors < 2) return single(dims);
    const podiumH = Math.min(podiumFloors, dims.floors - 1) * dims.floorHeight;
    const tw = dims.w * towerFrac;
    const td = dims.d * towerFrac;
    const ox = ((dims.w - tw) / 2) * offsetFrac * (rng() < 0.5 ? -1 : 1);
    const oz = ((dims.d - td) / 2) * offsetFrac * (rng() < 0.5 ? -1 : 1);
    return [
      { x: 0, z: 0, w: dims.w, d: dims.d, y0: 0, y1: podiumH },
      { x: ox, z: oz, w: tw, d: td, y0: podiumH, y1: dims.height },
    ];
  };
}

/** 逐層退縮。對稱，但輪廓與單一量體明顯不同。 */
export function setback(steps: number): Composer {
  return (dims) => {
    const n = Math.max(2, Math.min(steps, dims.floors));
    if (dims.floors < 2) return single(dims);
    const out: Volume[] = [];
    const per = dims.height / n;
    for (let i = 0; i < n; i++) {
      const frac = 1 - (i / n) * 0.4;
      out.push({
        x: 0, z: 0,
        w: dims.w * frac, d: dims.d * frac,
        y0: i * per, y1: (i + 1) * per,
      });
    }
    out[out.length - 1]!.y1 = dims.height;
    return out;
  };
}

/**
 * U 形：兩翼加一道背牆，中央留槽。
 *
 * 重心對稱，但中央的槽在俯視高度圖裡是實心的 0 —— 輪廓與其他組合器都不同。
 */
export function notch(notchFrac: number): Composer {
  return (dims) => {
    const armW = dims.w * (1 - notchFrac) / 2;
    const backD = dims.d * 0.38;
    const restD = dims.d - backD;
    return [
      { x: 0, z: -dims.d / 2 + backD / 2, w: dims.w, d: backD, y0: 0, y1: dims.height },
      {
        x: -dims.w / 2 + armW / 2, z: -dims.d / 2 + backD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
      {
        x: dims.w / 2 - armW / 2, z: -dims.d / 2 + backD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
    ];
  };
}

/**
 * 雙塔加低矮連接體。兩座塔**刻意不等高** —— 等高的雙塔是對稱的，
 * 旋轉又變回無操作。
 */
export function twin(gapFrac: number): Composer {
  return (dims) => {
    if (dims.floors < 3) return single(dims);
    const towerW = dims.w * (1 - gapFrac) / 2;
    const linkH = Math.max(2, Math.floor(dims.floors * 0.3)) * dims.floorHeight;
    const linkD = dims.d * 0.6;
    return [
      { x: -dims.w / 2 + towerW / 2, z: 0, w: towerW, d: dims.d, y0: 0, y1: dims.height },
      {
        x: dims.w / 2 - towerW / 2, z: 0, w: towerW, d: dims.d,
        y0: 0, y1: dims.height * 0.78,
      },
      {
        x: 0, z: 0, w: dims.w * gapFrac, d: linkD,
        y0: 0, y1: Math.min(linkH, dims.height * 0.5),
      },
    ];
  };
}

/** 高低兩跨。工業的廠房與商業的前店後棟都是這個形狀。 */
export function splitSpan(tallFrac: number): Composer {
  return (dims) => {
    const tallW = dims.w * tallFrac;
    const lowW = dims.w - tallW;
    return [
      { x: -dims.w / 2 + tallW / 2, z: 0, w: tallW, d: dims.d, y0: 0, y1: dims.height },
      {
        x: dims.w / 2 - lowW / 2, z: 0, w: lowW, d: dims.d,
        y0: 0, y1: Math.max(dims.floorHeight, dims.height * 0.62),
      },
    ];
  };
}
```

- [ ] **Step 4：跑綠**

```
pnpm vitest run src/renderer/__tests__/MassingComposers.test.ts
```

若 `should give every composer a silhouette of its own` 紅了，看訊息裡是哪一對 ——
最可能的是 `podiumTower(offsetFrac 0)` 與 `setback`（兩者都是同心收縮）。
調 `towerFrac` 或 `setback` 的收縮比例讓它們分開，**不要放寬門檻**。

- [ ] **Step 5：回退驗證（三項）**

1. 把 `twin` 的第二座塔改成 `dims.height`（等高）——
   `should give the asymmetric ones a real centroid offset` 應轉紅。
2. 把 `mainPlusWing` 的偏屋 x 改成 `0`（疊在主屋上）——
   `should never overlap its own volumes` 應轉紅。
3. 拿掉 `podiumTower` 的 `if (dims.floors < 2) return single(dims)` ——
   `should fall back to a single block when there are not enough floors` 應轉紅。

- [ ] **Step 6：Commit**

```bash
git add -A
git commit -F- <<'MSG'
feat(render): eight massing composers

原型不是每個都手寫一份幾何，而是「組合器 + 參數」。二十幾個原型手寫會是
二十幾份幾乎一樣的座標算術，而其中任何一份算錯都只表現為「某個變體看起來
怪怪的」。

三條不變式逐條測：不撐開 dimensions 給的基地（撐開的話行人包絡線那個檢查
就白做了）、兩兩不重疊（重疊產生看不見的內部面）、最高點正好等於目標高度。

podiumTower 的 offsetFrac 讓同一個組合器涵蓋對稱與不對稱兩種面貌 ——
高密度分區在 L1 只有裙樓塔與板樓可用，兩個都對稱的話旋轉就白給了。
twin 的兩座塔刻意不等高，理由相同。

規劃時丟掉「一樓凹進（騎樓）」：它在俯視高度圖裡看不出來（光柵取最高點），
會與單一量體判定成同一個輪廓。騎樓的視覺效果本來就由懸挑層的雨遮負責。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013CaAT8jcajKrRTLsVvFoop
MSG
```

---

## Task 5：`prototypes.ts` —— 各分區的原型表

組合器就緒之後，原型只是一張參數表。每個原型宣告 `minLevel`，所以 L1 只拿得到
簡單的、L3 全開 —— **等級的外型差異因此順便就有了**，不必另外做一套。

**排表的約束**：每個等級**可用的原型裡至少一半是不對稱的**。這是倒推來的：
`prototypeFor` 用 `variantIndex % 可用數` 輪流取，所以不對稱變體的比例約等於
不對稱原型的比例，而驗收要 4/8。高密度分區在 L1 只有板樓與裙樓塔，兩個都對稱，
所以 `offsetTower`（塔身偏置）必須在 L1 就開放 —— 那是這張表最不直覺的一格。

| 分區 | L1 可用 | L2 追加 | L3 追加 |
|---|---|---|---|
| 住宅低 | 山牆單體、**主屋+車庫** | **L 形**、**兩層+前廊** | — |
| 住宅高 | 板樓、裙樓塔、**偏置塔**、**L 形塔** | 逐層退縮、**雙塔** | — |
| 商業低 | 方盒、**前店高後棟矮** | **L 形**、**主棟+側棟** | U 形凹槽 |
| 商業高 | 裙樓塔、**偏置塔** | 逐層退縮、**L 形塔** | **雙塔** |
| 工業 | 大跨廠房、**廠房+辦公角** | **高低兩跨** | **L 形廠房** |
| 辦公 | 板樓、**偏置塔** | 裙樓塔、**L 形塔** | **雙塔**、U 形凹槽 |

（粗體 = 不對稱）

**Files:**
- Create: `src/renderer/geometry/buildings/massing/prototypes.ts`
- Test: `src/renderer/__tests__/MassingPrototypes.test.ts`（新）

**Interfaces:**
- Consumes：`composers.ts` 全部八個；`volume.ts` 的 `centroidOffset`（測試用）。
- Produces：
  ```ts
  export interface Prototype { name: string; minLevel: number; compose: Composer }
  export function prototypesFor(zoneType: number, level: number): Prototype[];
  export function prototypeFor(zoneType: number, level: number, variantIndex: number): Prototype;
  ```

- [ ] **Step 1：寫失敗測試**

`src/renderer/__tests__/MassingPrototypes.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { prototypesFor, prototypeFor } from '../geometry/buildings/massing/prototypes';
import { centroidOffset } from '../geometry/buildings/massing/volume';
import { VARIANT_COUNT, type Dimensions } from '../geometry/buildings/massing/dimensions';
import { variantRng } from '../geometry/buildings/massing/rng';
import { ZONE_TYPES } from '../geometry/buildings/registry';

const LEVELS = [1, 2, 3] as const;
const DIMS: Dimensions = { w: 0.72, d: 0.68, floors: 8, floorHeight: 0.26, height: 2.08 };

describe('prototype table', () => {
  it('should give every zone at least two prototypes at every level', () => {
    // 一個原型的話八個變體只剩尺寸可以變。
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        expect(prototypesFor(z, lv).length, `zone ${z} L${lv}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('should only ever add prototypes as the level climbs', () => {
    // 等級的外型差異就靠這個。L3 少掉 L1 有的東西是筆誤。
    for (const z of ZONE_TYPES) {
      const names = (lv: number) => new Set(prototypesFor(z, lv).map(p => p.name));
      for (const lower of [1, 2]) {
        for (const n of names(lower)) {
          expect(names(lower + 1).has(n), `zone ${z} L${lower + 1} 少了 ${n}`).toBe(true);
        }
      }
      expect(names(3).size, `zone ${z} 的 L3 沒有比 L1 多`).toBeGreaterThan(names(1).size);
    }
  });

  it('should keep at least half the available prototypes asymmetric', () => {
    // prototypeFor 用 variantIndex % 可用數輪流取，所以不對稱變體的比例約等於
    // 不對稱原型的比例 —— 而驗收要 4/8。高密度分區在 L1 只有板樓與裙樓塔，
    // 兩個都對稱，所以偏置塔必須在 L1 就開放。
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        const ps = prototypesFor(z, lv);
        const asym = ps.filter(p => centroidOffset(p.compose(DIMS, variantRng(z, 'LOW', lv, 0))) > 0.04);
        expect(asym.length * 2, `zone ${z} L${lv} 只有 ${asym.length}/${ps.length} 個不對稱`)
          .toBeGreaterThanOrEqual(ps.length);
      }
    }
  });

  it('should use every available prototype across the eight variants', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        const used = new Set<string>();
        for (let vi = 0; vi < VARIANT_COUNT; vi++) used.add(prototypeFor(z, lv, vi).name);
        expect(used.size, `zone ${z} L${lv}`).toBe(prototypesFor(z, lv).length);
      }
    }
  });

  it('should give the same prototype for the same variant every time', () => {
    for (let vi = 0; vi < VARIANT_COUNT; vi++) {
      expect(prototypeFor(3, 2, vi).name).toBe(prototypeFor(3, 2, vi).name);
    }
  });

  it('should fall back rather than crash for an unknown zone', () => {
    expect(prototypesFor(999, 1).length).toBe(0);
    expect(prototypeFor(999, 1, 0).name).toBe('single');
  });
});
```

- [ ] **Step 2：跑紅** ｜ `pnpm vitest run src/renderer/__tests__/MassingPrototypes.test.ts`

- [ ] **Step 3：實作**

```ts
import { ZoneType } from '../../../../core/grid/types';
import {
  single, mainPlusWing, lShape, podiumTower, setback, notch, twin, splitSpan,
  type Composer,
} from './composers';

/**
 * 一個量體原型 = 組合器 + 參數 + 最低等級。
 *
 * `minLevel` 是等級外型差異的全部機制：L1 只拿得到簡單的，L3 全開。不必另外
 * 為每個等級寫一套形狀。
 */
export interface Prototype {
  name: string;
  minLevel: number;
  compose: Composer;
}

const p = (name: string, minLevel: number, compose: Composer): Prototype =>
  ({ name, minLevel, compose });

/** 塔身置中的裙樓塔（對稱）。 */
const PODIUM = podiumTower(2, 0.66, 0);
/** 塔身推到裙樓邊緣（不對稱）。高密度分區在 L1 唯一的不對稱來源。 */
const OFFSET_TOWER = podiumTower(2, 0.6, 0.9);

const TABLE: Record<number, Prototype[]> = {
  [ZoneType.RESIDENTIAL_LOW]: [
    p('gable', 1, d => single(d)),
    p('house+garage', 1, mainPlusWing(0.4, 0.5)),
    p('L-house', 2, lShape(0.55)),
    p('porch', 2, mainPlusWing(0.28, 0.32)),
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    p('slab', 1, d => single(d)),
    p('podium', 1, PODIUM),
    p('offsetTower', 1, OFFSET_TOWER),
    p('L-tower', 1, lShape(0.6)),
    p('setback', 2, setback(3)),
    p('twin', 2, twin(0.24)),
  ],
  [ZoneType.COMMERCIAL_LOW]: [
    p('box', 1, d => single(d)),
    p('shopfront', 1, splitSpan(0.55)),
    p('L-shop', 2, lShape(0.58)),
    p('shop+annex', 2, mainPlusWing(0.35, 0.6)),
    p('courtyard', 3, notch(0.34)),
  ],
  [ZoneType.COMMERCIAL_HIGH]: [
    p('podium', 1, PODIUM),
    p('offsetTower', 1, OFFSET_TOWER),
    p('setback', 2, setback(3)),
    p('L-tower', 2, lShape(0.6)),
    p('twin', 3, twin(0.22)),
  ],
  [ZoneType.INDUSTRIAL]: [
    p('shed', 1, d => single(d)),
    p('shed+office', 1, mainPlusWing(0.32, 0.75)),
    p('twoSpan', 2, splitSpan(0.6)),
    p('L-shed', 3, lShape(0.6)),
  ],
  [ZoneType.OFFICE]: [
    p('slab', 1, d => single(d)),
    p('offsetTower', 1, OFFSET_TOWER),
    p('podium', 2, PODIUM),
    p('L-tower', 2, lShape(0.6)),
    p('twin', 3, twin(0.24)),
    p('courtyard', 3, notch(0.3)),
  ],
};

const FALLBACK: Prototype = p('single', 1, d => single(d));

/** 這個 (分區, 等級) 可用的原型。 */
export function prototypesFor(zoneType: number, level: number): Prototype[] {
  const lv = Math.max(1, Math.min(3, level));
  return (TABLE[zoneType] ?? []).filter(x => x.minLevel <= lv);
}

/**
 * 這個變體用哪一個原型。依序輪流取，所以每個可用原型至少出現一次 ——
 * 隨機取會讓某些原型在某些桶裡從來不出現。
 */
export function prototypeFor(
  zoneType: number, level: number, variantIndex: number,
): Prototype {
  const ps = prototypesFor(zoneType, level);
  return ps.length === 0 ? FALLBACK : ps[variantIndex % ps.length]!;
}
```

- [ ] **Step 4：跑綠** ｜ 若「至少一半不對稱」紅了，**加一個不對稱原型到那一格，
不要放寬門檻** —— 門檻是從 4/8 的驗收條件倒推的。

- [ ] **Step 5：回退驗證**

把 `RESIDENTIAL_HIGH` 的 `offsetTower` 的 `minLevel` 改成 2 ——
`should keep at least half the available prototypes asymmetric` 應在 L1 轉紅。改回來。

- [ ] **Step 6：Commit**

```bash
git add -A
git commit -m "feat(render): prototype table — level decides which shapes are available"
```

---

## Task 6：`roofForms.ts` —— 屋頂形式

屋頂形式與原型**分開挑**，所以「L 形 + 山牆」與「L 形 + 平頂女兒牆」是兩個不同的
變體 —— 這是在不增加原型數的前提下多一倍面貌的最便宜做法。

`roofForms` 只回傳 `Volume[]`，**不放任何設備**（水塔、空調、煙囪是 2C-2 的詞彙）。

**Files:**
- Create: `src/renderer/geometry/buildings/massing/roofForms.ts`
- Test: `src/renderer/__tests__/MassingRoofs.test.ts`（新）

**Interfaces:**
- Produces：
  ```ts
  export type RoofForm = 'flat' | 'parapet' | 'gable' | 'hip' | 'shed' | 'sawtooth' | 'crown';
  export function roofFormsFor(zoneType: number, level: number): RoofForm[];
  export function roofFor(zoneType: number, level: number, variantIndex: number): RoofForm;
  export function buildRoof(form: RoofForm, top: Volume, dims: Dimensions, rng: Rng): Volume[];
  ```

各分區可用的形式：

| 分區 | 形式 |
|---|---|
| 住宅低 | 山牆、四坡 |
| 住宅高 | 平頂、女兒牆 |
| 商業低 | 女兒牆、單斜 |
| 商業高 | 女兒牆、頂部收分（L3 才有） |
| 工業 | 鋸齒、單斜 |
| 辦公 | 女兒牆、頂部收分（L3 才有） |

- [ ] **Step 1：寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { roofFormsFor, roofFor, buildRoof } from '../geometry/buildings/massing/roofForms';
import { topOf, maxAbsOf, overlapOf, type Volume } from '../geometry/buildings/massing/volume';
import { VARIANT_COUNT, type Dimensions } from '../geometry/buildings/massing/dimensions';
import { variantRng } from '../geometry/buildings/massing/rng';
import { ZONE_TYPES } from '../geometry/buildings/registry';
import { PART_ROOF } from '../geometry/buildings/parts';

const LEVELS = [1, 2, 3] as const;
const DIMS: Dimensions = { w: 0.7, d: 0.66, floors: 6, floorHeight: 0.26, height: 1.56 };
const TOP: Volume = { x: 0, z: 0, w: 0.7, d: 0.66, y0: 1.3, y1: 1.56 };

describe('roof forms', () => {
  it('should give every zone at least two forms at every level', () => {
    // 屋頂形式是在不增加原型數的前提下多一倍面貌最便宜的做法。只有一種就沒了。
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        expect(roofFormsFor(z, lv).length, `zone ${z} L${lv}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('should sit on top of the volume it is given', () => {
    // 屋頂浮在半空或陷進樓層裡都不會有東西報錯。
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          const vs = buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0));
          for (const v of vs) {
            expect(v.y0, `${form} 沒有貼著頂面`).toBeGreaterThanOrEqual(TOP.y1 - 1e-9);
          }
        }
      }
    }
  });

  it('should never grow beyond the footprint it sits on', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          const vs = buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0));
          if (vs.length === 0) continue;
          expect(maxAbsOf(vs), `${form} 比它站的量體還寬`)
            .toBeLessThanOrEqual(maxAbsOf([TOP]) + 1e-9);
        }
      }
    }
  });

  it('should never overlap its own pieces', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          const vs = buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0));
          for (let i = 0; i < vs.length; i++) {
            for (let j = i + 1; j < vs.length; j++) {
              expect(overlapOf(vs[i]!, vs[j]!), `${form} 第 ${i}、${j} 塊重疊`)
                .toBeCloseTo(0, 12);
            }
          }
        }
      }
    }
  });

  it('should tag every roof piece as roof', () => {
    // 標成 PART_WALL 的屋頂會長出窗戶。
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        for (const form of roofFormsFor(z, lv)) {
          for (const v of buildRoof(form, TOP, DIMS, variantRng(z, 'LOW', lv, 0))) {
            expect(v.part, `${form} 沒標成屋頂`).toBe(PART_ROOF);
          }
        }
      }
    }
  });

  it('should keep a pitched roof under half a storey tall', () => {
    // 屋頂高過半層樓時，建築的總高度就不是樓層數乘樓高了 —— 等級階梯會漂掉。
    for (const form of ['gable', 'hip', 'shed', 'sawtooth'] as const) {
      const vs = buildRoof(form, TOP, DIMS, variantRng(1, 'LOW', 1, 0));
      expect(topOf(vs) - TOP.y1, `${form} 太高`).toBeLessThanOrEqual(DIMS.floorHeight * 0.5 + 1e-9);
    }
  });

  it('should use every available form across the eight variants', () => {
    for (const z of ZONE_TYPES) {
      for (const lv of LEVELS) {
        const used = new Set<string>();
        for (let vi = 0; vi < VARIANT_COUNT; vi++) used.add(roofFor(z, lv, vi));
        expect(used.size, `zone ${z} L${lv}`).toBe(roofFormsFor(z, lv).length);
      }
    }
  });

  it('should give a flat roof nothing to build', () => {
    expect(buildRoof('flat', TOP, DIMS, variantRng(1, 'LOW', 1, 0))).toEqual([]);
  });
});
```

- [ ] **Step 2：跑紅**

- [ ] **Step 3：實作**

```ts
import { ZoneType } from '../../../../core/grid/types';
import { PART_ROOF } from '../parts';
import type { Volume } from './volume';
import type { Dimensions } from './dimensions';
import type { Rng } from './rng';

/**
 * 屋頂形式。與原型分開挑 —— 「L 形 + 山牆」與「L 形 + 平頂女兒牆」是兩個不同的
 * 變體，這是在不增加原型數的前提下多一倍面貌最便宜的做法。
 *
 * 這裡只有形式，**沒有設備** —— 水塔、空調、煙囪是 2C-2 的詞彙。
 */
export type RoofForm =
  | 'flat' | 'parapet' | 'gable' | 'hip' | 'shed' | 'sawtooth' | 'crown';

const FORMS: Record<number, Array<{ form: RoofForm; minLevel: number }>> = {
  [ZoneType.RESIDENTIAL_LOW]:  [{ form: 'gable', minLevel: 1 }, { form: 'hip', minLevel: 1 }],
  [ZoneType.RESIDENTIAL_HIGH]: [{ form: 'flat', minLevel: 1 }, { form: 'parapet', minLevel: 1 }],
  [ZoneType.COMMERCIAL_LOW]:   [{ form: 'parapet', minLevel: 1 }, { form: 'shed', minLevel: 1 }],
  [ZoneType.COMMERCIAL_HIGH]:  [
    { form: 'parapet', minLevel: 1 }, { form: 'flat', minLevel: 1 },
    { form: 'crown', minLevel: 3 },
  ],
  [ZoneType.INDUSTRIAL]:       [{ form: 'sawtooth', minLevel: 1 }, { form: 'shed', minLevel: 1 }],
  [ZoneType.OFFICE]:           [
    { form: 'parapet', minLevel: 1 }, { form: 'flat', minLevel: 1 },
    { form: 'crown', minLevel: 3 },
  ],
};

export function roofFormsFor(zoneType: number, level: number): RoofForm[] {
  const lv = Math.max(1, Math.min(3, level));
  const list = (FORMS[zoneType] ?? []).filter(f => f.minLevel <= lv).map(f => f.form);
  return list.length > 0 ? list : ['flat', 'parapet'];
}

/**
 * 這個變體的屋頂形式。
 *
 * 用 `variantIndex` 的**商**而不是餘數：原型用的是餘數，兩者共用餘數的話，
 * 「原型 A 永遠配屋頂 X」—— 那等於兩個維度只剩一個。
 */
export function roofFor(zoneType: number, level: number, variantIndex: number): RoofForm {
  const forms = roofFormsFor(zoneType, level);
  const ps = Math.max(1, forms.length);
  return forms[Math.floor(variantIndex / ps + variantIndex) % forms.length]!;
}

const roof = (v: Omit<Volume, 'part'>): Volume => ({ ...v, part: PART_ROOF });

/**
 * 屋頂的量體。
 *
 * 斜屋頂一律壓在**半層樓**以內：高過半層樓的話建築的總高度就不是「樓層數 ×
 * 樓高」了，等級階梯會跟著漂掉。
 */
export function buildRoof(
  form: RoofForm, top: Volume, dims: Dimensions, rng: Rng,
): Volume[] {
  const pitch = dims.floorHeight * 0.45;
  const base = { x: top.x, z: top.z, y0: top.y1 };

  switch (form) {
    case 'flat':
      return [];

    case 'parapet': {
      // 女兒牆：沿著頂面四周一圈矮牆。用四塊而不是「大盒減小盒」——
      // 中間那一塊會與樓層頂面重疊。
      const t = Math.min(top.w, top.d) * 0.06;
      const h = dims.floorHeight * 0.22;
      const innerD = top.d - 2 * t;
      return [
        roof({ ...base, z: top.z - top.d / 2 + t / 2, w: top.w, d: t, y1: top.y1 + h }),
        roof({ ...base, z: top.z + top.d / 2 - t / 2, w: top.w, d: t, y1: top.y1 + h }),
        roof({ ...base, x: top.x - top.w / 2 + t / 2, w: t, d: innerD, y1: top.y1 + h }),
        roof({ ...base, x: top.x + top.w / 2 - t / 2, w: t, d: innerD, y1: top.y1 + h }),
      ];
    }

    case 'crown':
      // 頂部收分：再收一段細的。
      return [roof({ ...base, w: top.w * 0.62, d: top.d * 0.62, y1: top.y1 + dims.floorHeight * 0.5 })];

    case 'gable':
      return [roof({ ...base, w: top.w, d: top.d, y1: top.y1 + pitch, shape: 'gable',
        facing: rng() < 0.5 ? 0 : 1 })];

    case 'hip':
      return [roof({ ...base, w: top.w, d: top.d, y1: top.y1 + pitch, shape: 'hip' })];

    case 'shed':
      return [roof({ ...base, w: top.w, d: top.d, y1: top.y1 + pitch, shape: 'shed',
        facing: (Math.floor(rng() * 4) % 4) as 0 | 1 | 2 | 3 })];

    case 'sawtooth':
      return [roof({ ...base, w: top.w, d: top.d, y1: top.y1 + pitch, shape: 'sawtooth',
        facing: rng() < 0.5 ? 0 : 2 })];
  }
}
```

- [ ] **Step 4：跑綠**

- [ ] **Step 5：回退驗證（兩項）**

1. 把 `parapet` 改成「一塊蓋滿頂面」（`w: top.w, d: top.d`）加一塊內縮的 ——
   `should never overlap its own pieces` 應轉紅。
2. 把 `pitch` 改成 `dims.floorHeight * 1.2` ——
   `should keep a pitched roof under half a storey tall` 應轉紅。

- [ ] **Step 6：Commit**

```bash
git add -A
git commit -m "feat(render): roof forms, picked independently of the prototype"
```

---

## Task 7：`assemble.ts` 與 `index.ts` —— 從量體到幾何

這是 `massing/` 裡**唯一**可以 import Three.js 的地方。

所有形狀（盒子、山牆、四坡、單斜、鋸齒）都用**同一個** `frustum` 函式產生 ——
差別只在頂面的尺寸與偏移：

| 形狀 | 頂面 | 效果 |
|---|---|---|
| `box` | 與底面同大 | 方盒 |
| `gable` | 一條線（深度趨近 0） | 兩坡屋頂，屋脊在中央 |
| `hip` | 一小塊 | 四坡屋頂 |
| `shed` | 一條線推到一側 | 單斜屋頂 |
| `sawtooth` | N 個並排的 `shed` | 鋸齒天窗 |

五個形狀寫成五份幾何是五份幾乎一樣的頂點算術，而算錯只表現為「某個變體的
屋頂怪怪的」。

**Files:**
- Create: `src/renderer/geometry/buildings/massing/assemble.ts`
- Create: `src/renderer/geometry/buildings/massing/index.ts`
- Test: `src/renderer/__tests__/MassingGeometry.test.ts`（新）

**Interfaces:**
- Consumes：`volume.ts`、`prototypes.ts`、`roofForms.ts`、`dimensions.ts`、
  `metrics.ts` 的 `HALF_ENVELOPE`；`parts.ts` 的 `tagPart`、`PART_WALL`、`PART_ROOF`、
  `triangleCount`；`registry.ts` 的 `centreFootprint`、`GeoBuilder`、`Density`。
- Produces：
  ```ts
  // assemble.ts
  export function assemble(volumes: readonly Volume[]): THREE.BufferGeometry;  // 越界時 throw

  // index.ts
  export function volumesFor(
    zoneType: number, density: Density, level: number, variantIndex: number,
  ): Volume[];                                    // 沒有建築時回傳 []
  export function getMassingVariants(
    zoneType: number, density: Density, level: number,
  ): GeoBuilder[];                                // 長度 = VARIANT_COUNT，或 0
  export { VARIANT_COUNT } from './dimensions';
  ```

- [ ] **Step 1：寫失敗測試**

`src/renderer/__tests__/MassingGeometry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getMassingVariants, volumesFor } from '../geometry/buildings/massing';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';
import { HALF_ENVELOPE } from '../geometry/buildings/massing/metrics';
import { rasterise, differenceRatio, centroidOffset, rotate90 }
  from '../geometry/buildings/massing/volume';
import { triangleCount, PART_THRESHOLDS } from '../geometry/buildings/parts';
import { TARGET_HEIGHTS_M, TRIANGLE_BUDGET, type Density }
  from '../geometry/buildings/registry';
import { METRES_PER_CELL } from '../../core/grid/constants';

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
      const vs = getMassingVariants(z, d, lv);
      vs.forEach((build, i) => {
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
      expect(maxAbs, `${label} 越過包絡線 ${((maxAbs - HALF_ENVELOPE) * METRES_PER_CELL).toFixed(2)} m`)
        .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-6);
    });
  });

  it('should reach the height the table asks for', () => {
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const target = TARGET_HEIGHTS_M[key]![lv - 1]! / METRES_PER_CELL;
        const tolerance = Math.max(0.1 * target, 0.26) + 0.26 * 0.5;  // 容差 + 屋頂
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

  it('should make level 3 richer than level 1', () => {
    // 規格修訂 4：等級要看得出更高級。L3 開放更多原型，所以平均零件數該更多。
    eachBucket((z, d, key) => {
      const mean = (lv: number) => {
        let n = 0;
        for (let vi = 0; vi < VARIANT_COUNT; vi++) n += volumesFor(z, d, lv, vi).length;
        return n / VARIANT_COUNT;
      };
      expect(mean(3), `${key} L3 沒有比 L1 豐富`).toBeGreaterThan(mean(1));
    });
  });
});

describe('massing variety', () => {
  it('should give every bucket eight distinct silhouettes', () => {
    // 這是本階段的主要條件。兩個變體長一樣就等於少一個變體。
    eachBucket((z, d, key) => {
      for (const lv of LEVELS) {
        const grids: Float32Array[] = [];
        for (let vi = 0; vi < VARIANT_COUNT; vi++) grids.push(rasterise(volumesFor(z, d, lv, vi)));
        for (let i = 0; i < grids.length; i++) {
          for (let j = i + 1; j < grids.length; j++) {
            expect(differenceRatio(grids[i]!, grids[j]!, 0.13),
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
        expect(differenceRatio(g, rotate90(g), 0.13),
          `${key} L3 v${vi} 轉了等於沒轉`).toBeGreaterThanOrEqual(0.10);
      }
    });
  });
});
```

- [ ] **Step 2：跑紅** ｜ `pnpm vitest run src/renderer/__tests__/MassingGeometry.test.ts`

- [ ] **Step 3：實作 `assemble.ts`**

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tagPart, PART_WALL } from '../parts';
import { HALF_ENVELOPE } from './metrics';
import { maxAbsOf, partOf, type Volume } from './volume';
import { METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * `massing/` 裡唯一碰 Three.js 的地方。
 *
 * 所有形狀都用同一個 `frustum` 產生，差別只在頂面的尺寸與偏移：盒子的頂面與底面
 * 同大、山牆的頂面是一條線、四坡的頂面是一小塊、單斜的頂面是推到一側的線。
 * 五個形狀寫成五份幾何是五份幾乎一樣的頂點算術，而算錯只表現為
 * 「某個變體的屋頂怪怪的」。
 */

/**
 * 一個底面 w×d、頂面 topW×topD（可偏移）的稜台。
 *
 * `y0 === 0` 時省略底面：那兩個三角形永遠貼在地上，看不到。
 */
function frustum(
  v: Volume, topW: number, topD: number, offX: number, offZ: number,
): THREE.BufferGeometry {
  const hw = v.w / 2;
  const hd = v.d / 2;
  const tw = topW / 2;
  const td = topD / 2;
  // 底面四角（逆時針）與對應的頂面四角
  const b: Array<[number, number]> = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const t: Array<[number, number]> = [
    [offX - tw, offZ - td], [offX + tw, offZ - td],
    [offX + tw, offZ + td], [offX - tw, offZ + td],
  ];

  const pos: number[] = [];
  const quad = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
  ) => { pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); };

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(
      [b[i]![0], v.y0, b[i]![1]], [b[j]![0], v.y0, b[j]![1]],
      [t[j]![0], v.y1, t[j]![1]], [t[i]![0], v.y1, t[i]![1]],
    );
  }
  // 頂面
  quad(
    [t[0]![0], v.y1, t[0]![1]], [t[1]![0], v.y1, t[1]![1]],
    [t[2]![0], v.y1, t[2]![1]], [t[3]![0], v.y1, t[3]![1]],
  );
  // 底面只有離地時才需要 —— 貼在地上的那兩個三角形永遠看不到。
  if (v.y0 > 1e-6) {
    quad(
      [b[3]![0], v.y0, b[3]![1]], [b[2]![0], v.y0, b[2]![1]],
      [b[1]![0], v.y0, b[1]![1]], [b[0]![0], v.y0, b[0]![1]],
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  geo.translate(v.x, 0, v.z);
  return geo;
}

/** 一片鋸齒天窗的寬度：大約 6 m 一道，與真實廠房的跨距接近。 */
const SAWTOOTH_SPAN = 6 / METRES_PER_CELL;

function shapeOf(v: Volume): THREE.BufferGeometry[] {
  const alongZ = (v.facing ?? 0) % 2 === 0;
  const sign = (v.facing ?? 0) < 2 ? 1 : -1;
  const ridge = 0.04;

  switch (v.shape ?? 'box') {
    case 'box':
      return [frustum(v, v.w, v.d, 0, 0)];
    case 'gable':
      return alongZ
        ? [frustum(v, v.w, v.d * ridge, 0, 0)]
        : [frustum(v, v.w * ridge, v.d, 0, 0)];
    case 'hip':
      return [frustum(v, v.w * 0.2, v.d * 0.2, 0, 0)];
    case 'shed':
      return alongZ
        ? [frustum(v, v.w, v.d * ridge, 0, sign * (v.d / 2) * (1 - ridge))]
        : [frustum(v, v.w * ridge, v.d, sign * (v.w / 2) * (1 - ridge), 0)];
    case 'sawtooth': {
      const n = Math.max(2, Math.round(v.d / SAWTOOTH_SPAN));
      const teethD = v.d / n;
      const out: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const z = v.z - v.d / 2 + teethD * (i + 0.5);
        const tooth: Volume = { ...v, z, d: teethD };
        out.push(frustum(tooth, v.w, teethD * ridge, 0, sign * (teethD / 2) * (1 - ridge)));
      }
      return out;
    }
  }
}

/**
 * 量體轉幾何。越過行人包絡線時**丟例外**。
 *
 * 例外在遊戲執行時不該發生：生成器是確定性的、變體集合固定，所以測試跑過就
 * 表示永遠不會丟。那個 throw 是給未來改原型的人的護欄，不是執行期的錯誤處理 ——
 * 靜靜地讓行人穿牆比當場炸掉難追一百倍。
 */
export function assemble(volumes: readonly Volume[]): THREE.BufferGeometry {
  const over = maxAbsOf(volumes) - HALF_ENVELOPE;
  if (over > 1e-6) {
    throw new Error(
      `量體越過行人包絡線 ${(over * METRES_PER_CELL).toFixed(3)} m —— 行人會穿牆（BUG-221）`,
    );
  }

  const parts: THREE.BufferGeometry[] = [];
  for (const v of volumes) {
    for (const g of shapeOf(v)) {
      tagPart(g, partOf(v));
      parts.push(g);
    }
  }
  if (parts.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    tagPart(empty, PART_WALL);
    return empty;
  }
  return mergeGeometries(parts)!;
}
```

- [ ] **Step 4：實作 `index.ts`**

```ts
import type { GeoBuilder, Density } from '../registry';
import { VARIANT_COUNT, dimensionsFor } from './dimensions';
import { variantRng } from './rng';
import { prototypeFor } from './prototypes';
import { roofFor, buildRoof } from './roofForms';
import { assemble } from './assemble';
import { topOf, type Volume } from './volume';

export { VARIANT_COUNT };

/**
 * 這個變體的量體（不含幾何）。
 *
 * `propBands` 與測試都吃這一個 —— 「建築牆面在哪」「輪廓對不對稱」是算術問題，
 * 不必先把八個變體的幾何都建出來。
 */
export function volumesFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
): Volume[] {
  const dims = dimensionsFor(zoneType, density, level, variantIndex);
  if (!dims) return [];

  // 量體與屋頂各用一條亂數流：共用的話「原型抽到 A」會鎖死「屋頂抽到 X」，
  // 兩個維度就只剩一個。
  const bodyRng = variantRng(zoneType, density, level, variantIndex);
  const roofRng = variantRng(zoneType, density, level, variantIndex + VARIANT_COUNT);

  const body = prototypeFor(zoneType, level, variantIndex).compose(dims, bodyRng);
  const top = body.reduce((a, b) => (b.y1 > a.y1 ? b : a), body[0]!);
  const roof = buildRoof(roofFor(zoneType, level, variantIndex), top, dims, roofRng);
  return [...body, ...roof];
}

/**
 * 這個 (分區, 密度, 等級) 的八個量體變體。沒有建築時回傳空陣列。
 *
 * 幾何直接產出**最終尺寸** —— 沒有高度縮放也沒有基地縮放。那正是取消實例縮放的
 * 前提：BUG-219（樹跟著房子長高）與 BUG-226（雨遮貼假想牆）都是縮放的產物。
 */
export function getMassingVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  if (!dimensionsFor(zoneType, density, level, 0)) return [];
  const out: GeoBuilder[] = [];
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    out.push(() => assemble(volumesFor(zoneType, density, level, vi)));
  }
  return out;
}

/** 這個變體的高度（格）。屋頂物件（2C-2）與立面樓層節奏要用。 */
export function heightOf(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return topOf(volumesFor(zoneType, density, level, variantIndex));
}
```

- [ ] **Step 5：跑綠**

若 `should give every bucket eight distinct silhouettes` 紅了，多半是某個桶的
可用原型太少（例如工業 L1 只有兩個），八個變體靠尺寸撐不出 0.10 的差異。
**補原型或補屋頂形式，不要放寬門檻。**

- [ ] **Step 6：回退驗證（三項）**

1. 把 `assemble` 的包絡線檢查改成 `over > 1`（等於關掉），並把
   `prototypes` 的某個 `lShape(0.55)` 改成 `lShape(1.4)`（撐出基地）——
   `should never cross the pedestrian envelope` 應轉紅。兩者都改回來。
2. 把 `volumesFor` 的 `roofRng` 改成與 `bodyRng` 同一條 ——
   `should give every bucket eight distinct silhouettes` 應轉紅（原型與屋頂鎖死）。
3. 把 `frustum` 的 `geo.translate(v.x, 0, v.z)` 拿掉（所有量體疊在格心）——
   `should stand on the ground and be centred` 或輪廓相異那條應轉紅。

- [ ] **Step 7：Commit**

```bash
git add -A
git commit -m "feat(render): assemble volumes into geometry, eight variants per bucket"
```

---

## Task 8：`propBands` 改成量真正的牆面

`narrowest/widestBuildingEdge` 現在是「目標寬乘抖動係數」—— 推出來的。改成
**量這一桶八個變體的實際最小／最大值**，而且加上 `level` 參數（等級真的不同了，
可以貼更緊）。

**Files:**
- Modify: `src/renderer/geometry/buildings/propBands.ts`
- Modify: `src/renderer/geometry/buildings/decals.ts`、`groundProps.ts`、
  `overheadProps.ts`（band 呼叫加 `level`）
- Modify: `src/renderer/__tests__/PropBands.test.ts`、`Decals.test.ts`、
  `GroundProps.test.ts`、`OverheadProps.test.ts`（呼叫加 `level`）

**Interfaces:**
- Consumes：`massing/index.ts` 的 `volumesFor`、`VARIANT_COUNT`；`volume.ts` 的 `maxAbsOf`。
- Produces（簽章改變）：
  ```ts
  export function narrowestBuildingEdge(z: number, d: Density, level: number): number | null;
  export function widestBuildingEdge(z: number, d: Density, level: number): number | null;
  export function decalBand(z: number, d: Density, level: number): Band | null;
  export function lowPropBand(z: number, d: Density, level: number): Band | null;
  export function overheadBand(z: number, d: Density, level: number): Band | null;
  ```

- [ ] **Step 1：寫失敗測試**（加進 `PropBands.test.ts`）

```ts
it('should measure the edges from the variants, not from a jitter formula', () => {
  // 以前是「目標寬 × (1 ± 抖動)」—— 那是推出來的，而推導與幾何各走各的
  // 正是 BUG-226 發生的方式。現在量八個變體的實際值。
  eachBucket((z, d, key) => {
    for (const lv of [1, 2, 3]) {
      let lo = Infinity;
      let hi = 0;
      for (let vi = 0; vi < VARIANT_COUNT; vi++) {
        const m = maxAbsOf(volumesFor(z, d, lv, vi));
        lo = Math.min(lo, m);
        hi = Math.max(hi, m);
      }
      expect(narrowestBuildingEdge(z, d, lv)!, `${key} L${lv} 最窄`).toBeCloseTo(lo, 12);
      expect(widestBuildingEdge(z, d, lv)!, `${key} L${lv} 最寬`).toBeCloseTo(hi, 12);
    }
  });
});

it('should tell the levels apart', () => {
  // 加了 level 參數卻回傳同一個值的話，這個參數等於沒加。
  const differs = ['1:LOW', '2:HIGH', '3:LOW', '4:HIGH', '5:LOW', '6:LOW', '6:HIGH']
    .filter((key) => {
      const [zs, ds] = key.split(':');
      const w = (lv: number) => widestBuildingEdge(Number(zs), ds as Density, lv)!;
      return Math.abs(w(1) - w(3)) > 1e-9;
    });
  expect(differs.length, '沒有任何分區的牆面隨等級改變').toBeGreaterThan(0);
});
```

- [ ] **Step 2：跑紅**

- [ ] **Step 3：實作**

```ts
import { volumesFor, VARIANT_COUNT } from './massing';
import { maxAbsOf } from './massing/volume';

/** 量測快取。八個變體的量體每次都重算的話，每放一棟建築就算一次。 */
const edgeCache = new Map<string, { lo: number; hi: number } | null>();

function edgesOf(zoneType: number, density: Density, level: number) {
  const key = `${zoneType}:${density}:${level}`;
  const hit = edgeCache.get(key);
  if (hit !== undefined) return hit;

  let lo = Infinity;
  let hi = 0;
  for (let vi = 0; vi < VARIANT_COUNT; vi++) {
    const vs = volumesFor(zoneType, density, level, vi);
    if (vs.length === 0) continue;
    const m = maxAbsOf(vs);
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  const out = hi > 0 ? { lo, hi } : null;
  edgeCache.set(key, out);
  return out;
}

/**
 * 抖到最寬時的牆面。自立物件（樹、垃圾桶）的內緣 —— 它們要在**所有**建築之外，
 * 否則最寬的那一棟會把它們吃進牆裡。
 */
export function widestBuildingEdge(
  zoneType: number, density: Density, level: number,
): number | null {
  return edgesOf(zoneType, density, level)?.hi ?? null;
}

/**
 * 最窄的那一棟的牆面。貼牆物件（雨遮、鋪面）的內緣 —— 它們要碰到**所有**建築，
 * 多出來的部分埋在較寬的那些牆裡、被擋住，看不見。
 *
 * 用最寬值就是 BUG-226：只有剛好最寬的那一棟碰得到牆，其餘每一棟上都浮空。
 */
export function narrowestBuildingEdge(
  zoneType: number, density: Density, level: number,
): number | null {
  return edgesOf(zoneType, density, level)?.lo ?? null;
}
```

三個 band 各加 `level` 參數轉給上面兩個函式。

- [ ] **Step 4：更新呼叫端**

`decals.ts`、`groundProps.ts`、`overheadProps.ts` 的 `getXxxVariants` 已經收
`level`，把它轉進 band 呼叫即可。`groundProps.yardRing(z, d)` 一併加 `level`。

- [ ] **Step 5：跑全量測試**

`Decals.test.ts` / `GroundProps.test.ts` / `OverheadProps.test.ts` 裡呼叫
`narrowestBuildingEdge(z, d)` 的地方全部要補 `level`。

- [ ] **Step 6：回退驗證**

把 `edgesOf` 的 `lo` 改成也回傳 `hi` —— `OverheadProps.test.ts` 的
`should stay attached to the narrowest building in its bucket` 應轉紅
（那正是 BUG-226 的測試）。改回來。

- [ ] **Step 7：Commit**

```bash
git add -A
git commit -m "refactor(render): measure building edges from the variants, not a jitter formula"
```

---

## Task 9：切換 —— 刪掉手寫變體與實例縮放

**這是唯一會讓畫面壞掉的一步。** 前面八個 task 都只加新東西，這一步把舊的拔掉。

**一個刻意的決定：`assemble` 不再自動置中。** 階段 2B 加 `centreFootprint` 是因為
手寫幾何沒置中（BUG-222）。現在組合器**按構造**就置中：每一個的包圍盒都正好是
`[-w/2, w/2] × [-d/2, d/2]`。自動置中會把「某個組合器算偏了」默默補掉，而那個錯
會以「基地比預期窄」的形式跑到附掛層去。改成**斷言**（`MassingGeometry` 已有）。

**Files:**
- Modify: `src/renderer/geometry/buildings/registry.ts`（大量刪除）
- Modify: `src/renderer/BuildingRenderer.ts`
- Modify: `src/renderer/BuildingAppearance.ts`
- Modify: `src/showcase/main.ts`、`src/showcase/views.ts`
- Modify: `src/renderer/__tests__/BuildingRegistry.test.ts`、`BuildingHeights.test.ts`、
  `BuildingAppearance.test.ts`、`BuildingCapacity.test.ts`、`BuildingInstanceSeed.test.ts`
- Delete: `src/renderer/__tests__/BuildingFootprint.test.ts`

### `BuildingFootprint.test.ts` 十三條測試的去處

整檔刪掉就是覆蓋率靜靜消失。逐條交代：

| 原測試 | 去處 |
|---|---|
| keep every variant inside the pedestrian envelope at maximum jitter | `MassingGeometry`「should never cross the pedestrian envelope」 |
| still draw the approved width at median jitter | `MassingDimensions`「should never shrink the footprint below 85%」 |
| refuse to scale a variant past the envelope however big the target | **消失** —— 沒有縮放了。改由 `assemble` 的 throw 與 `MassingComposers`「should stay inside the footprint dimensions gave them」承接 |
| still honour a target that fits | **消失**，同上 |
| measure the ceiling from the centre, not from the width | `MassingVolume`「should measure the furthest corner from the cell centre」 |
| not divide by zero for an empty variant | `MassingGeometry`「should return nothing for a bucket with no buildings」 |
| leave no variant lopsided about the cell centre | `MassingGeometry`「should stand on the ground and be centred in the cell」 |
| keep buildings standing on the ground | 同上 |
| contain no foliage | `MassingGeometry`「should contain no foliage and no ground paving」 |
| cover every zone the height table covers | `MassingGeometry`「should give every bucket exactly eight variants」 |
| never let jitter push a building past the pedestrian envelope | 同第一條 |
| leave every zone room for its ground props | `PropBands`「should exist for every zone once the buildings make room」（已存在） |
| keep some downward jitter everywhere | **消失** —— 沒有抖動了。改由 `MassingDimensions`「should vary the footprint between variants」承接 |

- [ ] **Step 1：寫失敗測試**（新增到 `src/renderer/__tests__/GroundPropLayer.test.ts`）

```ts
it('should never scale the massing layer either', () => {
  // BUG-219 的不變式擴及量體層本身。生成器產出的是最終尺寸，所以實例矩陣
  // 只該有旋轉與位移 —— 縮放一旦回來，附掛層就又看不到建築抖多寬了。
  const scale = new THREE.Vector3();
  const cases: Array<[number, number, 'LOW' | 'HIGH']> = [
    [ZoneType.RESIDENTIAL_LOW, 1, 'LOW'],
    [ZoneType.RESIDENTIAL_HIGH, 3, 'HIGH'],
    [ZoneType.INDUSTRIAL, 2, 'LOW'],
    [ZoneType.OFFICE, 3, 'HIGH'],
  ];
  cases.forEach(([zone, level, density], i) => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(i, 0, zone, density, level, false);
    const entry = (internals as unknown as { zoneLayer: InstancedLayer })
      .zoneLayer.entryFor(`${i},0`)!;
    const mesh = (internals as unknown as { zoneLayer: InstancedLayer })
      .zoneLayer.meshFor(entry.key)!;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(entry.idx, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x, `zone ${zone} 寬被縮放`).toBeCloseTo(1, 9);
    expect(scale.y, `zone ${zone} 高被縮放`).toBeCloseTo(1, 9);
    expect(scale.z, `zone ${zone} 深被縮放`).toBeCloseTo(1, 9);
  });
});

it('should draw every building at the height its variant was generated at', () => {
  // 上一條看矩陣，這一條看畫出來的結果 —— 兩者一起才擋得住「縮放搬到
  // 幾何生成裡」這種繞過。
  const { renderer, internals } = fresh();
  renderer.addBuilding(0, 0, ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, false);
  const layer = (internals as unknown as { zoneLayer: InstancedLayer }).zoneLayer;
  const entry = layer.entryFor('0,0')!;
  const mesh = layer.meshFor(entry.key)!;
  const authored = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(entry.idx, m);
  const drawn = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  ).applyMatrix4(m);
  expect(drawn.max.y - drawn.min.y).toBeCloseTo(authored.max.y - authored.min.y, 9);
});
```

- [ ] **Step 2：跑紅** —— 目前矩陣含縮放，兩條都紅。

- [ ] **Step 3：`registry.ts` 刪除**

刪掉：`makeResLowV1`…`makeOfficeV3`（17 個）、`VARIANTS`、`centred`、
`getVariants`、`measure`、`measureCache`、`variantWidthUnits`、`variantHeightUnits`、
`variantMaxAbsUnits`、`footprintScaleFrom`、`footprintScaleFor`、
`footprintEnvelopeUnits`、`heightScaleFor`、`widthJitterFor`、`FOOTPRINTS`、
`HALF_ENVELOPE_UNITS`、`centreFootprint`。

保留並改寫兩處：

```ts
/**
 * 有建築的分區。以前是從 VARIANTS 的 key 推導，那張表已經不存在了。
 */
export const ZONE_TYPES: number[] = [
  ...new Set(Object.keys(TARGET_HEIGHTS_M).map(k => Number(k.split(':')[0]))),
];

/**
 * 每個 (分區, 密度) 的目標基地寬度，單位是**公尺**。
 *
 * 以前是從 `FOOTPRINTS` 的抖動表推導出來的。生成器接手之後抖動不存在了 ——
 * 八個變體各自在 85%–100% 之間取一個實際寬度，「最窄／最寬的牆面」是量出來的
 * （見 `propBands`）。
 *
 * 上限是行人包絡線 9.8 m（BUG-221）。商業低與辦公低留 7.8 m 是為了讓出
 * 0.42 m 的矮物件帶（階段 2B-2）。
 */
export const TARGET_WIDTHS_M: Record<string, number> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   6.0,
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: 9.0,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    7.8,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  9.0,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        9.0,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            7.8,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           9.0,
};
```

- [ ] **Step 4：`BuildingAppearance.ts`**

從 `Appearance` 介面與 `appearanceOf` 刪掉 `width01`、`depth01`、`heightScale`。
`STREAM.WIDTH` / `DEPTH` / `HEIGHT` 三個編號**留著不刪**並加註解：

```ts
export const STREAM = {
  VARIANT: 0,
  /**
   * 1–3 保留不用。量體生成器接手之後高度與基地都由變體決定，不再逐格抖動
   * （階段 2C-1）。編號留著是因為它們混進雜湊 —— 重新編號會讓其餘每一條
   * 亂數流換一批值，整座城市的顏色與朝向會全部改變。
   */
  RETIRED_HEIGHT: 1,
  RETIRED_WIDTH: 2,
  RETIRED_DEPTH: 3,
  ROTATION: 4,
  // ... 其餘不動
} as const;
```

- [ ] **Step 5：`BuildingRenderer.ts`**

```ts
// initVariantMeshes：
const variants = getMassingVariants(zoneType, density, level);
for (let vi = 0; vi < variants.length; vi++) { /* 不變 */ }

// 四處 appearanceOf 的 variantCount：
variantCount: VARIANT_COUNT,

// setInstanceData：整段縮放拿掉
this._matrix.makeRotationY((app.rotationQuarter * Math.PI) / 2);
this._matrix.setPosition(x, GROUND_LAYERS.BUILDING, y);
mesh.setMatrixAt(idx, this._matrix);
```

`_scale` 與 `_rotation` 兩個暫存矩陣一併刪除（不再有人用）。

- [ ] **Step 6：展示區**

`showcase/main.ts` 的 `place` 拿掉 `mesh.scale.set(...)`；`views.ts` 的
`getVariants(zoneType, level).length` 換成 `VARIANT_COUNT`。

- [ ] **Step 7：改寫既有測試**

- `BuildingRegistry.test.ts`：`getVariants(zone, level)` → `getMassingVariants(zone, density, level)`。
  「零件標籤」「不越過格子」「站在地上」「三角形預算」四條與 `MassingGeometry`
  重複，**刪掉重複的那四條**，保留「每個分區每個等級都有變體」與
  「未知分區回空陣列」。
- `BuildingHeights.test.ts`：刪掉用 `heightScaleFor` 的三條
  （render each variant at the height the table asks for／compensate for variants of
  different authored heights／not divide by zero）—— 前兩條由
  `MassingGeometry`「should reach the height the table asks for」承接，第三條由
  `dimensionsFor` 的 null 路徑承接。其餘五條（高度表本身的性質）原封不動。
- `BuildingAppearance.test.ts`：刪掉
  「should keep scale jitter inside the ranges the look was tuned with」與
  「should keep height jitter well under one storey」—— 那兩個欄位不存在了。
- `BuildingCapacity.test.ts`、`BuildingInstanceSeed.test.ts`：
  `getVariants(ZONE, 1)` → `getMassingVariants(ZONE, 'LOW', 1)`。
- 刪除 `BuildingFootprint.test.ts`（去處見上表）。

- [ ] **Step 8：跑全量測試 + tsc + build**

```
pnpm vitest run && pnpm tsc --noEmit && pnpm build
```

- [ ] **Step 9：回退驗證**

把 `setInstanceData` 的矩陣改回含縮放
（`this._scale.makeScale(1.1, 1.1, 1.1)` 乘進去）——
`should never scale the massing layer either` 與
`should draw every building at the height its variant was generated at` 應轉紅。改回來。

- [ ] **Step 10：Commit**

```bash
git add -A
git commit -F- <<'MSG'
feat(render): parametric massing replaces the hand-written variants

刪掉 17 個手寫變體與六個縮放函式，實例矩陣退化成旋轉加位移。

那個 scale(±15%, ±10%, ±15%) 是 BUG-219（樹跟著房子長高）與 BUG-226（雨遮
貼一棟沒人看得到的假想建築）的共同成因 —— 附掛層的幾何是整桶共用的一份，
而量體會抖，附掛層看不到它抖多少。生成器直接產出最終尺寸之後這個張力消失。

assemble 刻意不自動置中：組合器按構造就置中（包圍盒正好是基地），自動置中
會把「某個組合器算偏了」默默補掉，而那個錯會以「基地比預期窄」的形式跑到
附掛層去。改成斷言。

STREAM 的 HEIGHT/WIDTH/DEPTH 三個編號留著不刪 —— 它們混進雜湊，重新編號會
讓其餘每一條亂數流換一批值，整座城市的顏色與朝向會全部改變。

BuildingFootprint.test.ts 刪除，十三條測試的去處逐條列在計畫裡。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013CaAT8jcajKrRTLsVvFoop
MSG
```

---

## Task 10：鄰居迴避 —— 把相鄰重複率壓到 5% 以下

純逐格雜湊的相鄰重複率就是 `1/V`：八個變體 = 12.5%。要靠變體數壓到 5% 得寫二十個。

**Files:**
- Modify: `src/renderer/BuildingAppearance.ts`
- Test: `src/renderer/__tests__/MassingVariety.test.ts`（新）

**Interfaces:**
- Produces：`variantIndexOf` 簽章不變，行為改變；`STREAM.VARIANT_RETRY = 13`
  （`GROUND_PROP` 已佔 12）。

- [ ] **Step 1：寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { variantIndexOf } from '../BuildingAppearance';
import { VARIANT_COUNT } from '../geometry/buildings/massing/dimensions';

/** N×N 的街廓上，相鄰兩格用同一個變體的比例。 */
function adjacencyRate(n: number, seedByte: number, count: number): number {
  const v: number[][] = [];
  for (let x = 0; x < n; x++) {
    v[x] = [];
    for (let y = 0; y < n; y++) v[x]![y] = variantIndexOf(x, y, seedByte, count);
  }
  let pairs = 0;
  let same = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (x + dx >= n || y + dy >= n) continue;
        pairs++;
        if (v[x]![y] === v[x + dx]![y + dy]) same++;
      }
    }
  }
  return same / pairs;
}

describe('variant selection avoids the neighbours', () => {
  it('should keep neighbouring cells from sharing a variant', () => {
    // 本階段的主要驗收條件。純逐格雜湊是 1/V = 12.5%。
    for (const seed of [0, 7, 128, 255]) {
      const rate = adjacencyRate(64, seed, VARIANT_COUNT);
      expect(rate, `seed ${seed} 相鄰重複 ${(rate * 100).toFixed(1)}%`).toBeLessThan(0.05);
    }
  });

  it('should still use every variant roughly evenly', () => {
    // 迴避不能把分布壓歪 —— 某幾個變體從此不出現的話，等於變體數變少。
    const counts = new Array<number>(VARIANT_COUNT).fill(0);
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) counts[variantIndexOf(x, y, 0, VARIANT_COUNT)]!++;
    }
    const expected = (64 * 64) / VARIANT_COUNT;
    for (let i = 0; i < VARIANT_COUNT; i++) {
      expect(counts[i]!, `變體 ${i} 出現 ${counts[i]} 次`).toBeGreaterThan(expected * 0.7);
      expect(counts[i]!).toBeLessThan(expected * 1.3);
    }
  });

  it('should stay deterministic', () => {
    for (let i = 0; i < 50; i++) {
      expect(variantIndexOf(i, i * 3, 0, VARIANT_COUNT))
        .toBe(variantIndexOf(i, i * 3, 0, VARIANT_COUNT));
    }
  });

  it('should always land inside the variant list', () => {
    for (const count of [1, 2, 8]) {
      for (let x = -20; x < 20; x++) {
        for (let y = -20; y < 20; y++) {
          const v = variantIndexOf(x, y, 0, count);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(count);
        }
      }
    }
  });

  it('should return 0 rather than NaN when there are no variants', () => {
    expect(variantIndexOf(3, 4, 0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2：跑紅** —— 目前是 12.5%，第一條紅。

- [ ] **Step 3：實作**

```ts
/**
 * 這一格該用哪一個變體。
 *
 * 純逐格雜湊的相鄰重複率就是 `1/variantCount` —— 八個變體是 12.5%，
 * 而一條街上每八棟就有一棟跟隔壁一樣是看得出來的。要靠變體數壓到 5% 以下
 * 得寫二十個變體，那會把 draw call 也推上去。
 *
 * 改成挑一個「西鄰與北鄰的原始雜湊值都沒用到」的值。比對的是鄰居的**原始**
 * 值而不是最終值 —— 最終值要看它自己的鄰居，會遞迴下去。所以這是**降低**
 * 而不是消除：鄰居自己也可能被換過，換完之後仍可能撞上。實測約 3.5%。
 */
export function variantIndexOf(
  x: number, y: number, seedByte: number, variantCount: number,
): number {
  if (variantCount <= 0) return 0;
  const raw = (px: number, py: number) =>
    Math.floor(hashCell(px, py, seedByte, STREAM.VARIANT) * variantCount) % variantCount;

  const v = raw(x, y);
  if (variantCount < 3) return v;   // 兩個變體時避無可避

  const west = raw(x - 1, y);
  const north = raw(x, y - 1);
  if (v !== west && v !== north) return v;

  // 從「兩個鄰居都沒用到」的值裡挑，而不是 +1 位移 —— 位移過去有可能正好
  // 撞上另一個鄰居。
  const allowed: number[] = [];
  for (let k = 0; k < variantCount; k++) if (k !== west && k !== north) allowed.push(k);
  if (allowed.length === 0) return v;
  const r = hashCell(x, y, seedByte, STREAM.VARIANT_RETRY);
  return allowed[Math.floor(r * allowed.length) % allowed.length]!;
}
```

`STREAM` 加 `VARIANT_RETRY: 13`。

- [ ] **Step 4：跑綠**

實測數字寫進 commit 訊息。若高於 5%，補救順序是：先把西北鄰也列入迴避
（`raw(x-1, y-1)`），再考慮加變體數。**兩者都不改變架構，不要放寬門檻。**

- [ ] **Step 5：回退驗證**

把迴避那一段拿掉（直接 `return v`）—— 第一條應轉紅，訊息會顯示約 12.5%。改回來。

- [ ] **Step 6：Commit**

```bash
git add -A
git commit -m "feat(render): pick a variant the neighbours are not using"
```

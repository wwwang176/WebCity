# 建築模型多樣性 — 階段 2A：尺寸與桶

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓建築的大小對得上它容納的人口，讓辦公區分辨得出低密度與高密度，並在桶數成長之後把記憶體壓住。

**Architecture:** `ZONE_HEIGHTS` 現在是「乘在幾何上的縮放係數」，語意隱晦又與人口無關。改成以**公尺**為單位的目標高度表，由每個變體自己的未縮放高度反推縮放。變體桶的 key 從 (分區, 變體) 變成 (分區, 密度, 等級, 變體)，因此 `InstancedMesh` 的預配容量必須從固定 6000 改成動態成長。

**Tech Stack:** TypeScript、Three.js、Vitest（node environment）。

## Global Constraints

- **TDD 強制**：先寫紅燈測試，實作後把修正還原確認測試轉紅。
- `src/core/` 禁止 import Three.js。
- 所有既有測試保持綠：基準 **4295 個測試、303 個檔案**。
- `npx tsc --noEmit` 零錯誤；`npx vite build` 產出 `dist/index.html` 與 `dist/showcase.html`。
- 發現 Bug 寫入 `BUGS.md` 與 `TODO.md`。
- 執行測試用 `npx vitest run <path>`。
- **1 格 = 12 公尺**（`PLANNING.md:42`）。
- 本階段**不**新增幾何變體、**不**動 shader、**不**動存檔格式。剪影仍是現有 17 個。

---

## 檔案結構

| 檔案 | 改動 |
|---|---|
| `src/core/grid/constants.ts` | 新增 `METRES_PER_CELL = 12` |
| `src/renderer/geometry/buildings/registry.ts` | `ZONE_HEIGHTS`（縮放係數）換成 `TARGET_HEIGHTS_M`（公尺）；新增 `variantHeightUnits()`、`heightScaleFor()`、`bucketKey()`、`type Density` |
| `src/renderer/BuildingAppearance.ts` | `heightScale` 抖動 ±17.5% → ±5% |
| `src/renderer/BuildingRenderer.ts` | `addBuilding` / `updateBuilding` 收 `density`；桶 key 改用 `bucketKey()`；容量動態成長；色盤查詢加等級 |
| `src/Game.ts` | 兩處呼叫端補上 density |
| `src/showcase/main.ts`、`controls.ts`、`views.ts` | 展示區跟著加密度維度 |
| `src/renderer/ColorPalettes.ts`（新增） | `ZONE_PALETTES` 從 `BuildingRenderer` 搬出並加上等級維度 |

---

## Task 1: 公尺為單位的目標高度

**Files:**
- Modify: `src/core/grid/constants.ts`
- Modify: `src/renderer/geometry/buildings/registry.ts`
- Test: `src/renderer/__tests__/BuildingHeights.test.ts`

**Interfaces:**
- Produces: `METRES_PER_CELL`、`type Density = 'LOW' | 'HIGH'`、`TARGET_HEIGHTS_M`、`variantHeightUnits(zoneType, density, level, variantIndex): number`、`heightScaleFor(zoneType, density, level, variantIndex): number`。

**背景：** `ZONE_HEIGHTS` 是縮放係數，實際高度 = 幾何高度 × 係數 × 12 公尺。實測結果與容納人口完全脫節：4 人的 Small House 是 2.4 m（不到一層樓），320 人的 High Rise 是 33.7 m（11 層，應為 73 層）。決定採壓縮映射（規格修訂 1）。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingHeights.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  TARGET_HEIGHTS_M, variantHeightUnits, heightScaleFor, getVariants, LEVELS,
} from '../geometry/buildings/registry';
import { METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

/**
 * 高度以前是「乘在幾何上的縮放係數」，語意隱晦而且與容納人口無關：
 * 4 人的 Small House 被畫成 2.4 m（不到一層樓），320 人的 High Rise 被畫成
 * 33.7 m（11 層）。改成公尺表之後，這裡斷言的是「畫出來真的是那個高度」。
 */
describe('TARGET_HEIGHTS_M', () => {
  it('should cover every zone and density that has buildings', () => {
    for (const key of ['1:LOW', '2:HIGH', '3:LOW', '4:HIGH', '5:LOW', '6:LOW', '6:HIGH']) {
      expect(TARGET_HEIGHTS_M[key], `missing ${key}`).toBeDefined();
      expect(TARGET_HEIGHTS_M[key]).toHaveLength(3);
    }
  });

  it('should grow with level in every bucket', () => {
    for (const [key, heights] of Object.entries(TARGET_HEIGHTS_M)) {
      expect(heights[1], `${key} L2 not taller than L1`).toBeGreaterThan(heights[0]!);
      expect(heights[2], `${key} L3 not taller than L2`).toBeGreaterThan(heights[1]!);
    }
  });

  it('should give a four-person house at least one full storey', () => {
    // 現況是 2.4 m，也就是 0.8 層。
    expect(TARGET_HEIGHTS_M['1:LOW']![0]).toBeGreaterThanOrEqual(4.5);
  });

  it('should make a high rise a tower, not a block', () => {
    // 320 人。照實算要 220 m；壓縮後仍必須明顯高於它的基地寬度（12 m）。
    expect(TARGET_HEIGHTS_M['2:HIGH']![2]).toBeGreaterThanOrEqual(70);
  });

  it('should keep the office tower above the office block', () => {
    // BUG-220：高密度辦公 160/320/600 人，低密度 15/30/50 人。
    for (const lv of [0, 1, 2]) {
      expect(TARGET_HEIGHTS_M['6:HIGH']![lv]).toBeGreaterThan(TARGET_HEIGHTS_M['6:LOW']![lv]!);
    }
  });
});

describe('heightScaleFor', () => {
  it('should render each variant at the height the table asks for', () => {
    for (const level of LEVELS) {
      const variants = getVariants(ZoneType.RESIDENTIAL_LOW, level);
      for (let i = 0; i < variants.length; i++) {
        const scale = heightScaleFor(ZoneType.RESIDENTIAL_LOW, 'LOW', level, i);
        const metres = variantHeightUnits(ZoneType.RESIDENTIAL_LOW, 'LOW', level, i)
          * scale * METRES_PER_CELL;
        expect(metres, `res-low L${level} v${i}`)
          .toBeCloseTo(TARGET_HEIGHTS_M['1:LOW']![level - 1]!, 3);
      }
    }
  });

  it('should compensate for variants of different authored heights', () => {
    // 兩個高度不同的幾何要縮放到同一個目標高度，係數必須不同 ——
    // 否則「目標高度」只是換個名字的縮放係數。
    const a = variantHeightUnits(ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, 0);
    const b = variantHeightUnits(ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, 1);
    expect(a).not.toBeCloseTo(b, 3);
    expect(heightScaleFor(ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, 0))
      .not.toBeCloseTo(heightScaleFor(ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, 1), 3);
  });

  it('should not divide by zero when a variant has no height', () => {
    expect(Number.isFinite(heightScaleFor(ZoneType.NONE, 'LOW', 1, 0))).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingHeights.test.ts`
Expected: FAIL — `TARGET_HEIGHTS_M` 不存在

- [ ] **Step 3: 加入公尺常數**

在 `src/core/grid/constants.ts` 末端加入：

```ts
/**
 * 一格的邊長（公尺）。定義在 `PLANNING.md`：1 格 = 12 m × 12 m。
 *
 * 放在 core 而不是 renderer，是因為它是遊戲世界的事實，不是渲染選擇 ——
 * 建築高度、車輛尺寸、道路寬度都應該以它為準。
 */
export const METRES_PER_CELL = 12;
```

- [ ] **Step 4: 換掉高度表**

在 `src/renderer/geometry/buildings/registry.ts` 刪除 `ZONE_HEIGHTS`，改為：

```ts
export type Density = 'LOW' | 'HIGH';

/** 高度表的 key：分區加密度。辦公區兩種密度差 11 倍人口（BUG-220）。 */
export function heightKey(zoneType: number, density: Density): string {
  return `${zoneType}:${density}`;
}

/**
 * 每個 (分區, 密度) 三個等級的目標高度，單位是**公尺**。
 *
 * 由容納人口推導（樓層 3 m、工業 6 m；佔地率 低密度 60% / 高密度 85% /
 * 工業 70%；每人樓地板 住宅低 35、住宅高 28、商業 30、工業 40、辦公 15 m²）。
 *
 * 低密度照實算。高密度壓縮：320 人塞進 144 m² 的一格是現實的三倍密度，
 * 照實算 L3 高層住宅要 220 m、比基地寬 18 倍，一整區會像針床。
 * 壓縮之後高密度建築的視覺密度低於它實際容納的人口 —— 這是刻意接受的取捨，
 * 要讓兩者一致該改的是遊戲的人口數值，不是渲染（規格修訂 1）。
 */
export const TARGET_HEIGHTS_M: Record<string, [number, number, number]> = {
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   [5, 7, 10],
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: [30, 51, 75],
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    [5, 8, 12],
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  [24, 42, 66],
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        [8, 12, 16],
  [heightKey(ZoneType.OFFICE, 'LOW')]:            [9, 15, 24],
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           [36, 60, 90],
};

/** 未縮放幾何的高度快取，避免每次放建築都重算包圍盒。 */
const heightCache = new Map<string, number>();

/** 這個變體未經縮放時有多高（world unit）。 */
export function variantHeightUnits(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  const key = `${zoneType}:${density}:${level}:${variantIndex}`;
  const cached = heightCache.get(key);
  if (cached !== undefined) return cached;

  const variants = getVariants(zoneType, level);
  if (variants.length === 0) {
    heightCache.set(key, 0);
    return 0;
  }
  const geo = variants[variantIndex % variants.length]!();
  geo.computeBoundingBox();
  const h = geo.boundingBox!.max.y;
  geo.dispose();
  heightCache.set(key, h);
  return h;
}

/**
 * 要把這個變體縮放到目標高度該乘多少。
 *
 * 兩個高度不同的幾何要縮放到同一個目標，係數必須不同 —— 這正是「目標高度」
 * 與舊的「縮放係數」的差別。
 */
export function heightScaleFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  const target = TARGET_HEIGHTS_M[heightKey(zoneType, density)];
  if (!target) return 1;
  const units = variantHeightUnits(zoneType, density, level, variantIndex);
  if (units <= 0) return 1;
  const lv = Math.max(1, Math.min(3, level));
  return target[lv - 1]! / (units * METRES_PER_CELL);
}
```

在檔案頂端加入 import：

```ts
import { METRES_PER_CELL } from '../../../core/grid/constants';
```

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingHeights.test.ts`
Expected: PASS，8 個案例

- [ ] **Step 6: 確認測試有鑑別力**

把 `heightScaleFor` 的 `target[lv - 1]! / (units * METRES_PER_CELL)` 暫時改成
`target[lv - 1]! / METRES_PER_CELL`（忽略幾何高度），重跑。
Expected:「should render each variant at the height the table asks for」與
「should compensate for variants of different authored heights」轉紅。改回來確認全綠。

- [ ] **Step 7: Commit**

```bash
git add src/core/grid/constants.ts src/renderer/geometry/buildings/registry.ts src/renderer/__tests__/BuildingHeights.test.ts
git commit -m "feat(renderer): building heights in metres, derived from population

ZONE_HEIGHTS was a scale factor multiplied onto the geometry, which made
the real size a function of how tall someone happened to author the model.
Measured against the game's own capacities it was badly off: a four-person
house rendered at 2.4 m, under one storey, and a 320-resident high rise at
33.7 m when its population implies seventy-three floors.

The table is now metres, keyed by zone AND density, and each variant
derives its own scale from its authored height. High density is compressed
on purpose -- 320 people on a 144 m2 lot is three times real density and
would need 220 m -- and the trade is written down where the numbers are."
```

---

## Task 2: 密度進入變體桶

**Files:**
- Modify: `src/renderer/geometry/buildings/registry.ts`（`bucketKey`）
- Modify: `src/renderer/BuildingRenderer.ts`（`initVariantMeshes`、`addBuilding`、`updateBuilding`、`setInstanceData`）
- Modify: `src/Game.ts`（兩處呼叫端）
- Test: `src/renderer/__tests__/BuildingDensity.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Density`、`heightScaleFor`。
- Produces: `bucketKey(zoneType, density, level, variantIndex): string`；`BuildingRenderer.addBuilding(x, y, zoneType, density, level, burned, abandoned?)`。

**背景（BUG-220）：** `ZoneType.OFFICE` 底下有六種建築 —— 低密度 15／30／50 人，高密度 160／320／600 人。`addBuilding` 沒有帶密度，所以 15 人的 Small Office 與 160 人的 Office Building 用同一個高度與同一組變體渲染。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingDensity.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { bucketKey } from '../geometry/buildings/registry';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * BUG-220：辦公區有兩種密度，人口差 11 倍（15 對 160），而渲染層拿不到
 * 密度，所以兩者外觀完全一樣。
 */
interface Internals {
  positionToInstance: Map<string, { key: string; idx: number }>;
  variantMeshes: Map<string, THREE.InstancedMesh>;
}

function freshRenderer() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

describe('density reaches the renderer', () => {
  it('should put low and high density offices in different buckets', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(1, 1, ZoneType.OFFICE, 'LOW', 1, false);
    renderer.addBuilding(2, 1, ZoneType.OFFICE, 'HIGH', 1, false);

    const low = internals.positionToInstance.get('1,1')!;
    const high = internals.positionToInstance.get('2,1')!;
    expect(low.key).not.toBe(high.key);
  });

  it('should render a high-density office taller than a low-density one', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(1, 1, ZoneType.OFFICE, 'LOW', 1, false);
    renderer.addBuilding(2, 1, ZoneType.OFFICE, 'HIGH', 1, false);

    const heightAt = (posKey: string) => {
      const e = internals.positionToInstance.get(posKey)!;
      const m = new THREE.Matrix4();
      internals.variantMeshes.get(e.key)!.getMatrixAt(e.idx, m);
      return new THREE.Vector3().setFromMatrixScale(m).y;
    };
    expect(heightAt('2,1')).toBeGreaterThan(heightAt('1,1'));
  });

  it('should separate every level into its own bucket', () => {
    const { renderer, internals } = freshRenderer();
    renderer.addBuilding(1, 1, ZoneType.RESIDENTIAL_LOW, 'LOW', 1, false);
    renderer.addBuilding(1, 2, ZoneType.RESIDENTIAL_LOW, 'LOW', 3, false);
    expect(internals.positionToInstance.get('1,1')!.key)
      .not.toBe(internals.positionToInstance.get('1,2')!.key);
  });
});

describe('bucketKey', () => {
  it('should distinguish every dimension it carries', () => {
    const base = bucketKey(ZoneType.OFFICE, 'LOW', 1, 0);
    expect(bucketKey(ZoneType.OFFICE, 'HIGH', 1, 0)).not.toBe(base);
    expect(bucketKey(ZoneType.OFFICE, 'LOW', 2, 0)).not.toBe(base);
    expect(bucketKey(ZoneType.OFFICE, 'LOW', 1, 1)).not.toBe(base);
    expect(bucketKey(ZoneType.RESIDENTIAL_LOW, 'LOW', 1, 0)).not.toBe(base);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingDensity.test.ts`
Expected: FAIL — `bucketKey` 不存在、`addBuilding` 參數數量不符

- [ ] **Step 3: 加入 bucketKey**

在 `registry.ts` 加入：

```ts
/**
 * 變體桶的完整識別。分區、密度、等級、變體序號四個維度缺一不可：
 * 少了密度，辦公區 15 人與 160 人的建築同桶（BUG-220）；
 * 少了等級，升級只能靠縮放（BUG-219 的一半）。
 */
export function bucketKey(
  zoneType: number, density: Density, level: number, variantIndex: number,
): string {
  return `${zoneType}_${density}_${level}_${variantIndex}`;
}
```

- [ ] **Step 4: 改 BuildingRenderer**

`initVariantMeshes` 改為對每個 (分區, 密度, 等級) 建桶：

```ts
    for (const zoneType of ZONE_TYPES) {
      for (const density of ['LOW', 'HIGH'] as Density[]) {
        if (!TARGET_HEIGHTS_M[heightKey(zoneType, density)]) continue;
        for (const level of LEVELS) {
          const variants = getVariants(zoneType, level);
          for (let vi = 0; vi < variants.length; vi++) {
            const key = bucketKey(zoneType, density, level, vi);
            // ...（以下與原本相同：建幾何、stampZoneCategory、建 InstancedMesh、
            //     配置 aHighlight / aHighlightColor / aOccupancy / aSeed）
          }
        }
      }
    }
```

`addBuilding` 與 `updateBuilding` 的簽章加入 `density: Density`，放在 `zoneType` 之後：

```ts
  addBuilding(
    x: number, y: number, zoneType: number, density: Density,
    level: number, burned: boolean, abandoned = false,
  ): void {
    const variants = getVariants(zoneType, level);
    if (variants.length === 0) return;

    const palette = paletteFor(zoneType, level);
    const app = appearanceOf({
      x, y, zoneType, level, seedByte: 0,
      variantCount: variants.length, paletteSize: palette.length,
    });
    const key = bucketKey(zoneType, density, level, app.variantIndex);
    // ...（其餘不變）
```

`setInstanceData` 同樣加 `density` 參數，並把高度算式換掉：

```ts
    const finalHeight = heightScaleFor(zoneType, density, level, app.variantIndex)
      * app.heightScale;
```

刪除 `ZONE_HEIGHTS`、`levelFactor`、`baseHeight` 三行。

- [ ] **Step 5: 改 Game.ts 呼叫端**

`Game.ts:553` 的 `onBuildingAdded` 改為：

```ts
    this.simLoop.onBuildingAdded = (x, y, zoneType, level) => {
      // 密度不在回呼裡，但格子上的 buildingId 知道 —— 同一個物件同時帶著
      // level 與 density（core/building/types.ts）。
      const cell = this.state.grid.getCell(x, y);
      const density = getBuildingType(cell?.buildingId ?? 0)?.density ?? 'LOW';
      this.buildingRenderer.addBuilding(x, y, zoneType, density, level, false);
      this.buildingRenderer.removeZoneOverlay(x, y);
      this.dirty.terrain = true;
    };
```

`build()` 內的 `this.addBuilding(x, y, cell.zoneType, level, burned, abandoned)` 改為：

```ts
            const type = getBuildingType(cell.buildingId);
            const level = type?.level ?? 1;
            const density = type?.density ?? 'LOW';
            this.addBuilding(x, y, cell.zoneType, density, level, burned, abandoned);
```

其餘 `updateBuilding` 呼叫端照同一模式補上 density（用 tsc 找出來）。

- [ ] **Step 6: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingDensity.test.ts`
Expected: PASS，4 個案例

Run: `npx tsc --noEmit` → 無輸出

- [ ] **Step 7: 確認測試有鑑別力**

把 `bucketKey` 的 `${density}_` 暫時刪掉，重跑。
Expected:「should put low and high density offices in different buckets」與
`bucketKey` 那條轉紅。改回來確認全綠。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/geometry/buildings/registry.ts src/renderer/BuildingRenderer.ts src/Game.ts src/renderer/__tests__/BuildingDensity.test.ts
git commit -m "fix(renderer): the office zone's two densities are two buildings (BUG-220)

ZoneType.OFFICE holds six building types across two densities, 15 to 600
workers, and addBuilding never received the density -- so an eleven-fold
difference in population rendered identically.

The bucket key now carries zone, density, level and variant. Level being
in the key is what lets a later phase swap the building on upgrade instead
of stretching it."
```

---

## Task 3: 色盤加上等級

**Files:**
- Create: `src/renderer/ColorPalettes.ts`
- Modify: `src/renderer/BuildingRenderer.ts`
- Test: `src/renderer/__tests__/ColorPalettes.test.ts`

**Interfaces:**
- Produces: `paletteFor(zoneType: number, level: number): number[]`。

**背景（規格修訂 4）：** `ZONE_PALETTES` 只依分區，所以 L1 有機會抽到和 L3 一樣的顏色 —— 升級看不出「變好」。等級要同時改變量體、材質、零件、周邊四件事，色盤是「材質」那一項最便宜的部分。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/ColorPalettes.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { paletteFor } from '../ColorPalettes';
import { ZONE_TYPES, LEVELS } from '../geometry/buildings/registry';

/** 平均明度：升級應該更亮更乾淨，而不是換個顏色而已。 */
function meanLightness(palette: number[]): number {
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  let sum = 0;
  for (const hex of palette) {
    c.setHex(hex);
    c.getHSL(hsl);
    sum += hsl.l;
  }
  return sum / palette.length;
}

describe('paletteFor', () => {
  it('should give every zone and level a non-empty palette', () => {
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(paletteFor(zone, level).length, `zone ${zone} L${level}`).toBeGreaterThan(0);
      }
    }
  });

  it('should not hand the same palette to level 1 and level 3', () => {
    // 這正是「升級只是變高」的一部分：顏色沒有跟著變好。
    for (const zone of ZONE_TYPES) {
      expect(paletteFor(zone, 1), `zone ${zone}`).not.toEqual(paletteFor(zone, 3));
    }
  });

  it('should make the top level lighter and cleaner than the bottom', () => {
    for (const zone of ZONE_TYPES) {
      expect(meanLightness(paletteFor(zone, 3)), `zone ${zone}`)
        .toBeGreaterThan(meanLightness(paletteFor(zone, 1)));
    }
  });

  it('should fall back rather than return nothing for an unknown zone', () => {
    expect(paletteFor(999, 1).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/ColorPalettes.test.ts`
Expected: FAIL — 無法解析 `../ColorPalettes`

- [ ] **Step 3: 建立模組**

建立 `src/renderer/ColorPalettes.ts`。把 `BuildingRenderer.ts` 的 `ZONE_PALETTES` 整段搬過來，改名為 `BASE_PALETTES`，並加上：

```ts
/**
 * 依等級調整色盤。
 *
 * 等級要看得出「更高級」，不只是更高（規格修訂 4）。色盤是「材質」那一項
 * 最便宜的部分：低等級偏樸素低彩度，高等級偏明亮乾淨。
 *
 * 用調整而不是三份手寫色盤，是為了讓分區的性格（磚紅、石灰、玻璃藍）
 * 在三個等級之間保持一致 —— 換成三份手寫的很容易讓 L3 看起來像別的城市。
 */
const LEVEL_ADJUST: Record<number, { lightness: number; saturation: number }> = {
  1: { lightness: -0.06, saturation: -0.04 },
  2: { lightness: 0, saturation: 0 },
  3: { lightness: 0.07, saturation: 0.03 },
};

const cache = new Map<string, number[]>();

export function paletteFor(zoneType: number, level: number): number[] {
  const key = `${zoneType}:${level}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const base = BASE_PALETTES[zoneType] ?? [0x888888];
  const adjust = LEVEL_ADJUST[Math.max(1, Math.min(3, level))]!;
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const out = base.map((hex) => {
    c.setHex(hex);
    c.getHSL(hsl);
    c.setHSL(
      hsl.h,
      Math.max(0.02, Math.min(0.7, hsl.s + adjust.saturation)),
      Math.max(0.15, Math.min(0.92, hsl.l + adjust.lightness)),
    );
    return c.getHex();
  });
  cache.set(key, out);
  return out;
}
```

在 `BuildingRenderer.ts` 刪除 `ZONE_PALETTES`，改為 `import { paletteFor } from './ColorPalettes';`，兩處 `ZONE_PALETTES[zoneType] ?? [0x888888]` 改成 `paletteFor(zoneType, level)`。

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/ColorPalettes.test.ts`
Expected: PASS，4 個案例

- [ ] **Step 5: 確認測試有鑑別力**

把 `LEVEL_ADJUST` 三個等級都改成 `{ lightness: 0, saturation: 0 }`，重跑。
Expected:「should not hand the same palette to level 1 and level 3」與
「should make the top level lighter」轉紅。改回來確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ColorPalettes.ts src/renderer/BuildingRenderer.ts src/renderer/__tests__/ColorPalettes.test.ts
git commit -m "feat(renderer): palettes know what level they are painting

ZONE_PALETTES was keyed by zone alone, so a level 1 building could draw
the same colour as a level 3 and upgrading showed nothing but height.

Adjusted rather than hand-written per level, so a zone keeps its character
across the ladder -- three separate palettes drift until L3 looks like it
came from a different city."
```

---

## Task 4: 容量動態成長

**Files:**
- Modify: `src/renderer/BuildingRenderer.ts`
- Test: `src/renderer/__tests__/BuildingCapacity.test.ts`

**Interfaces:**
- Produces: `BuildingRenderer` 內部的 `growBucket(key)`；桶初始容量 `INITIAL_BUCKET_CAPACITY = 256`。

**背景：** 桶從 17 個變成 7 分區密度組合 × 3 等級 × 2–3 變體 ≈ **60 個**，階段 2C 之後會到 168 個。維持每個預配 6000 格會讓常駐記憶體從 6.5 MB 漲到 60 MB 以上。改成初始 256、滿了倍增。

**這是本階段最危險的一塊**：重配時實例矩陣、顏色與四個自訂屬性都要一起搬，漏搬任何一個都會讓建築戴上別人的資料。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingCapacity.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { appearanceOf } from '../BuildingAppearance';
import { getVariants } from '../geometry/buildings/registry';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

/**
 * 桶數從 17 成長到 60（2C 之後 168），固定預配 6000 會讓常駐記憶體
 * 從 6.5 MB 漲到 60 MB 以上。改成倍增之後，重配那一刻要搬矩陣、顏色與
 * 四個自訂屬性 —— 漏搬任何一個，建築就會戴上別人的資料，而且只在城市
 * 長到超過初始容量時才發生。
 */
const ZONE = ZoneType.RESIDENTIAL_LOW;

interface Internals {
  positionToInstance: Map<string, { key: string; idx: number }>;
  variantMeshes: Map<string, THREE.InstancedMesh>;
}

function freshRenderer() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

describe('bucket capacity', () => {
  it('should start small rather than pre-allocating for a full map', () => {
    const { internals } = freshRenderer();
    for (const [key, mesh] of internals.variantMeshes) {
      expect(mesh.instanceMatrix.count, `${key} pre-allocated too much`)
        .toBeLessThanOrEqual(256);
    }
  });

  it('should keep accepting buildings past the initial capacity', () => {
    const { renderer, internals } = freshRenderer();
    // 一個變體桶大約收到總數的三分之一，所以 1200 棟一定會撐破 256。
    let placed = 0;
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 30; y++) {
        renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
        placed++;
      }
    }
    expect(internals.positionToInstance.size).toBe(placed);
  });

  it('should carry every instance intact across a regrow', () => {
    const { renderer, internals } = freshRenderer();
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 30; y++) {
        renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
        cells.push([x, y]);
      }
    }

    const m = new THREE.Matrix4();
    const variants = getVariants(ZONE, 1);
    for (const [x, y] of cells) {
      const entry = internals.positionToInstance.get(`${x},${y}`)!;
      const mesh = internals.variantMeshes.get(entry.key)!;

      mesh.getMatrixAt(entry.idx, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.x, `matrix lost for ${x},${y}`).toBeCloseTo(x, 5);
      expect(p.z).toBeCloseTo(y, 5);

      const expected = appearanceOf({
        x, y, zoneType: ZONE, level: 1, seedByte: 0,
        variantCount: variants.length, paletteSize: 1,
      }).facadeSeed;
      const seed = mesh.geometry.getAttribute('aSeed');
      expect(seed.getX(entry.idx), `aSeed lost for ${x},${y}`).toBeCloseTo(expected[0], 6);
      expect(seed.getY(entry.idx)).toBeCloseTo(expected[1], 6);
      expect(seed.getZ(entry.idx)).toBeCloseTo(expected[2], 6);
    }
  });

  it('should keep the mesh in the scene after a regrow', () => {
    // 重配會建立新的 InstancedMesh；忘記把舊的移出場景、新的加進去，
    // 城市會在長到某個大小時整片消失或畫兩次。
    const scene = new THREE.Scene();
    const renderer = new BuildingRenderer();
    renderer.build(scene, new Grid(1, 1));
    const internals = renderer as unknown as Internals;

    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 30; y++) renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
    }
    for (const mesh of internals.variantMeshes.values()) {
      if (mesh.count === 0) continue;
      expect(scene.children.includes(mesh), 'a grown mesh is not in the scene').toBe(true);
    }
    const meshCount = scene.children.filter(o => o instanceof THREE.InstancedMesh).length;
    expect(meshCount, 'an orphaned mesh was left in the scene')
      .toBe(internals.variantMeshes.size);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingCapacity.test.ts`
Expected: 第一條 FAIL（預配 6000）。其餘可能通過 —— 它們釘的是重配後必須維持的性質，重配還不存在時當然成立。

- [ ] **Step 3: 換成動態成長**

在 `BuildingRenderer` 內：

```ts
  /** 桶的初始容量。滿了就倍增（見 growBucket）。 */
  private static readonly INITIAL_BUCKET_CAPACITY = 256;

  /** 每個桶目前的容量。 */
  private bucketCapacity = new Map<string, number>();
```

把 `initVariantMeshes` 內所有 `this.maxPerVariant` 換成 `BuildingRenderer.INITIAL_BUCKET_CAPACITY`，並在建桶時 `this.bucketCapacity.set(key, BuildingRenderer.INITIAL_BUCKET_CAPACITY)`。刪除 `maxPerVariant` 欄位。

新增：

```ts
  /**
   * 把一個桶的容量加倍。
   *
   * InstancedMesh 的容量在建構時固定，所以只能換一個新的並把資料整批搬過去。
   * 矩陣、顏色與四個自訂屬性都要搬 —— 漏搬任何一個，超過初始容量之後的
   * 建築就會戴上別人的資料。
   */
  private growBucket(scene: THREE.Scene, key: string): THREE.InstancedMesh {
    const old = this.variantMeshes.get(key)!;
    const oldCapacity = this.bucketCapacity.get(key)!;
    const capacity = oldCapacity * 2;

    const grown = new THREE.InstancedMesh(old.geometry, old.material, capacity);
    grown.count = old.count;
    grown.castShadow = true;
    grown.receiveShadow = true;
    grown.frustumCulled = false;

    // 矩陣
    const m = new THREE.Matrix4();
    for (let i = 0; i < old.count; i++) {
      old.getMatrixAt(i, m);
      grown.setMatrixAt(i, m);
    }
    grown.instanceMatrix.needsUpdate = true;

    // 顏色
    if (old.instanceColor) {
      const c = new THREE.Color();
      for (let i = 0; i < old.count; i++) {
        old.getColorAt(i, c);
        grown.setColorAt(i, c);
      }
      if (grown.instanceColor) grown.instanceColor.needsUpdate = true;
    }

    // 自訂屬性。幾何是共用的，所以要換成自己的一份，否則兩個 mesh 會共享
    // 同一組 buffer，舊的那份長度又不夠。
    grown.geometry = old.geometry.clone();
    for (const [name, itemSize] of [
      ['aHighlight', 1], ['aHighlightColor', 3], ['aOccupancy', 1], ['aSeed', 3],
    ] as const) {
      const src = old.geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
      const data = new Float32Array(capacity * itemSize);
      if (src) data.set((src.array as Float32Array).subarray(0, old.count * itemSize));
      grown.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    }

    scene.remove(old);
    scene.add(grown);
    this.variantMeshes.set(key, grown);
    this.bucketCapacity.set(key, capacity);
    this._buildingMeshesDirty = true;
    return grown;
  }
```

`addBuilding` 的容量檢查改為：

```ts
    const idx = this.variantCounts.get(key)!;
    if (idx >= this.bucketCapacity.get(key)!) {
      if (!this.scene) return; // 尚未 build，無處可加
      mesh = this.growBucket(this.scene, key);
    }
```

`BuildingRenderer` 需要記住 scene：在 `initVariantMeshes(scene)` 開頭 `this.scene = scene;`，並加上欄位 `private scene: THREE.Scene | null = null;`。

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingCapacity.test.ts`
Expected: PASS，4 個案例

- [ ] **Step 5: 確認測試有鑑別力**

把 `growBucket` 裡搬 `aSeed` 那一圈的 `data.set(...)` 暫時註解掉，重跑。
Expected:「should carry every instance intact across a regrow」轉紅。
再把 `scene.add(grown)` 註解掉，Expected:「should keep the mesh in the scene」轉紅。
兩者都改回來確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/BuildingRenderer.ts src/renderer/__tests__/BuildingCapacity.test.ts
git commit -m "perf(renderer): buckets grow instead of pre-allocating for a full map

Buckets went from 17 to about 60 once density and level entered the key,
and the parametric generator will take them to 168. At 6000 instances
pre-allocated each, that is 60 MB of matrices for a city that may never
build them.

They now start at 256 and double. The regrow copies matrices, colours and
all four custom attributes, and there is a test for each: miss one and a
building wears its neighbour's data, but only once the city outgrows the
initial capacity."
```

---

## Task 5: 高度抖動收斂與展示區跟進

**Files:**
- Modify: `src/renderer/BuildingAppearance.ts`
- Modify: `src/showcase/views.ts`、`src/showcase/main.ts`、`src/showcase/controls.ts`
- Test: `src/renderer/__tests__/BuildingAppearance.test.ts`（修改既有斷言）

**背景：** 高度抖動現在是 `1.0 + (h - 0.5) * 0.35`，也就是 ±17.5% —— 同一等級的房子高矮差到一層樓，看起來像等級不同。目標高度表落實之後，抖動只該是「同一種建築的自然差異」，收到 ±5%。

- [ ] **Step 1: 改測試**

在 `src/renderer/__tests__/BuildingAppearance.test.ts` 把高度範圍斷言改為：

```ts
        expect(a.heightScale).toBeGreaterThanOrEqual(0.95);
        expect(a.heightScale).toBeLessThanOrEqual(1.05);
```

並加入一條：

```ts
  it('should keep height jitter well under one storey', () => {
    // ±17.5% 讓同一等級的房子高矮差一層樓，看起來像等級不同。
    // 目標高度表落實之後，抖動只該是同一種建築的自然差異。
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 60; y++) {
        const h = appearanceOf({ ...input, x, y }).heightScale;
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    expect(hi / lo).toBeLessThan(1.12);
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingAppearance.test.ts`
Expected: FAIL — 目前是 ±17.5%

- [ ] **Step 3: 收斂抖動**

在 `BuildingAppearance.ts`：

```ts
    heightScale: 1.0 + (at(STREAM.HEIGHT) - 0.5) * 0.1,
```

並更新該欄位的註解：

```ts
  /** 0.95 ~ 1.05，套在目標高度上的自然差異 */
  heightScale: number;
```

- [ ] **Step 4: 展示區跟進**

`src/showcase/controls.ts` 的 `ControlState` 加 `density: Density`，並加一個下拉選單（選項 `低密度` / `高密度`）。

`src/showcase/views.ts` 的 `PlacedCell` 加 `density`，`blockCells` / `matrixCells` / `cellAt` 一併帶過去；`matrixCells` 改為列舉 `TARGET_HEIGHTS_M` 的每個 (分區, 密度) × 等級。

`src/showcase/main.ts` 的 `place()` 改用 `heightScaleFor(cell.zoneType, cell.density, cell.level, app.variantIndex) * app.heightScale`，刪掉 `ZONE_HEIGHTS` 的引用。

- [ ] **Step 5: 全套驗證**

Run: `npx vitest run` → 全綠
Run: `npx tsc --noEmit` → 無輸出
Run: `npx vite build` → 兩個入口都產出

- [ ] **Step 6: 人工驗證**

開 `http://localhost:5180/showcase.html`：

1. 住宅低密度 L1 → L3，高度應該是 **5 m → 10 m**（房子從一層變成三層高），不再是 2.4 → 4.1
2. 住宅高密度 L3 應該是**明顯的塔樓**（75 m，約基地寬的 6 倍）
3. 辦公選**低密度**與**高密度**，L1 應該差很多（9 m 對 36 m）
4. 同一分區同一等級的街廓，高度差異應該**很小**（±5%），不再像等級不同
5. L1 與 L3 的**顏色**應該不同，L3 更亮更乾淨

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): height jitter is a variation, not a level difference

At 17.5% the jitter spanned a whole storey, so two houses of the same
level read as different levels. With the target height table doing the
work, the jitter goes back to being what it should be: the natural
variation between two buildings of the same kind.

The showcase picks up the density dimension so both office ladders can be
inspected."
```

---

## 自我檢查

**規格覆蓋：** 修訂 1（目標高度表）→ Task 1、5。修訂 3 / BUG-220（密度維度）→ Task 2。
修訂 4 的色盤部分 → Task 3。§4.6 容量動態配置 → Task 4。
BUG-219 的高度抖動部分 → Task 5。

**本計畫不涵蓋**（屬於 2B / 2C）：地面物件脫離建築幾何（BUG-219 主體）、
九種量體原型與每桶 8 變體、豪華階梯的量體與零件部分、`aSeed.z` 的等級基準。

**型別一致性：** `Density` 在 Task 1 定義，Task 2、3、5 一致使用；
`heightScaleFor(zoneType, density, level, variantIndex)` 的參數順序在 Task 1、2、5 相同；
`bucketKey` 四參數在 Task 2 定義並在 Task 4 的桶查詢沿用；
`paletteFor(zoneType, level)` 在 Task 3 定義，Task 2 的 `addBuilding` 已改為呼叫它。

**無佔位符：** 每個 code step 都含實際程式碼；Task 2 Step 5 的「其餘呼叫端用 tsc 找出來」
是可執行的指令，不是待填欄位。

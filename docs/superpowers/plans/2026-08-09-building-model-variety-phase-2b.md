# 建築模型多樣性 階段 2B — 地面物件獨立圖層 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 把庭院的樹、樹籬、圍籬從建築幾何裡搬進獨立的實例圖層，讓它們不再隨建築升級被拉高（BUG-219），並順手修掉規畫途中量到的基地越界（BUG-222）。

**Architecture：** 新增一個與建築量體平行的 `InstancedMesh` 圖層。兩層共用同一個實例桶機制（本階段抽成 `InstancedLayer`）、同一份材質、同一組逐實例屬性，但**地面物件層的矩陣不含高度縮放也不含基地縮放** —— 它按真實公尺尺寸生成，只吃旋轉與位置。庭院可用的範圍由「建築目標寬度」與「行人包絡線」兩個既有常數推導，不另外寫死。

**Tech Stack：** TypeScript、Three.js（`BufferGeometryUtils.mergeGeometries`）、Vitest（node 環境，幾何建構可在無頭環境跑）。

## Global Constraints

- `src/core/` 一律不得 import Three.js。`groundProps.ts` 在 `src/renderer/` 底下，可以。
- TDD 強制：先寫失敗測試 → 跑到紅 → 最小實作 → 跑到綠 → commit。
- **每支新測試都要做回退驗證**：實作完成後暫時把修改改回原樣，確認測試轉紅，再改回來。不會轉紅的測試等於沒測到東西。
- 發現的 Bug 必須寫進 `BUGS.md` 與 `TODO.md`。
- 單一事實來源：`MAX_BUILDING_WIDTH_M`（`core/grid/constants.ts`，9.8 m）與 `METRES_PER_CELL`（12）是既有共用常數，新程式碼一律引用，不得重寫數字。
- 展示區看到的必須等於遊戲畫出來的。任何只改展示區不改渲染層（或反之）的做法都不接受。

---

## 背景：規畫時量到的兩件事

### 一、BUG-222 —— 14/20 個變體越過行人包絡線

`footprintScaleFor` 的上限寫成

```ts
const ceiling = 1 / (units * MAX_WIDTH_JITTER);
```

這只保證「寬度 ≤ 1 格」（半寬 0.5），而行人的門節點在 `BUILDING_HALF_SIZE = 0.4083` 外側。而且 `units` 用的是**包圍盒寬度**，非置中的幾何會單邊外凸。實測（`widthScale = 1.15` 最壞情況，單位為格）：

| 分區 | 越過 0.4083 | 越過 0.5（吃進鄰居） |
|---|---|---|
| 住宅高 | v0 0.470、v1 0.470、v2 0.594 | v2 |
| 商業低 | v0 0.475、v2 0.458 | — |
| 商業高 | v0 0.470、v1 0.470 | — |
| 工業 | v0 0.514、v1 0.509、v2 0.517 | 三個都是 |
| 辦公高 | v0/v1/v2 各 0.470 | — |

BUG-218 的包圍盒測試沒抓到，因為它檢查「原始幾何 × 抖動」，沒把 `footprintScaleFor` 算進去。

**修法有三個部分，缺一不可：**

1. **幾何置中**：`makeResHighV3` 的 z 範圍是 −0.25 ~ +0.43，等比縮放到「寬度 0.68 格」之後那一側仍在 0.43。置中之後最大半距等於寬度的一半，上限才算得準。
2. **上限改用離格心最大距離，並把抖動算進去**。
3. **鋪滿基地的分區取消「向上」的寬深抖動**（保留向下）。

第 3 點的算術值得寫下來，因為它決定了使用者已確認的尺寸會不會被改掉：

```
置中後 maxAbs = units / 2
ceiling = 0.40833 / (units/2 × (1 + up)) = 0.81667 / (units × (1 + up))
wanted  = target  / (units × 12)
```

- 鋪滿基地（target = 9.8 = `MAX_BUILDING_WIDTH_M`）且 `up = 0`：
  `wanted = 0.81667/units`，`ceiling = 0.81667/units` —— **兩者相等，上限剛好不咬**。平均寬度維持 9.8 m，最寬也是 9.8 m。
- 住宅低（target 6.0，`up = 0.15`）：`wanted = 0.5/units < ceiling = 0.7101/units` —— 上限不咬。
- 商業低／辦公低（target 8.4，`up = 0.15`）：`wanted = 0.7/units < ceiling = 0.7101/units` —— 剛好不咬。

也就是說：**取消向上抖動之後，上限退化成安全網，使用者確認過的每一個寬度都原封不動**。若改成「保留 ±15% 並讓上限去咬」，高密度的平均寬度會從 9.8 掉到 9.33 m —— 那等於偷偷改掉已確認的比例，所以不採用。

向下抖動（0.85 ~ 1.0）保留：鋪滿基地的建築仍會有偏瘦的個體，只是沒有偏胖的。

### 二、庭院帶只有在建築讓出空間時才存在

行人的門節點在 `BUILDING_HALF_SIZE`（0.4083 格 = 4.9 m）外側，所以**地面物件的外緣不能超過 0.4083** —— 這正是 BUG-221 定下的同一條線。內緣是建築自己抖到最寬時的半寬。兩者之間就是庭院帶：

| 分區 | 目標寬 | 內緣（含抖動） | 外緣 | 庭院帶 |
|---|---|---|---|---|
| 住宅低 | **6.0 m**（本階段自 7.2 下修） | 0.2875 | 0.4083 | **1.45 m** |
| 商業低 | 8.4 m | 0.4025 | 0.4083 | 0.07 m |
| 辦公低 | 8.4 m | 0.4025 | 0.4083 | 0.07 m |
| 住宅高／商業高／工業／辦公高 | 9.8 m | 0.4083 | 0.4083 | 0 |

**所以本階段只有住宅低密度有地面物件。** 其他分區沒有留白，這不是遺漏而是幾何事實 —— 它們的等級階梯要靠量體（2C）與屋頂物件（階段 3）表現，不是庭院。判斷式由上表推導，不寫死分區清單：日後若把商業低調窄，它會自動長出庭院。

**住宅低目標寬度為什麼從 7.2 下修到 6.0：** 目前的 7.2 m 量的是「房子 + 車庫 + 樹」的包圍盒，房子本體只佔 4.3 m。剝掉庭院物件之後若仍以 7.2 m 為目標，房子本體會被放大到 7.2 m，庭院只剩 0.76 m —— 使用者已確認的觀感會反過來變成「房子變大、院子變小」。6.0 m 讓房子本體維持接近原本的視覺量體，庭院帶則有 1.45 m，放得下真正看得見的樹籬與樹。這是可調的旋鈕，展示區確認後再定案。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/renderer/geometry/buildings/registry.ts`（改） | 幾何置中；`footprintScaleFor` 改為抖動感知；新增 `WIDTH_JITTER` 表與 `footprintEnvelopeUnits()` |
| `src/renderer/BuildingAppearance.ts`（改） | `widthScale`/`depthScale` 改為原始 `width01`/`depth01`；抖動範圍不再由這裡決定 |
| `src/renderer/InstancedLayer.ts`（新） | 實例桶機制：建桶、容量倍增、四個自訂屬性、swap-with-last 移除。兩個圖層共用 |
| `src/renderer/geometry/buildings/groundProps.ts`（新） | 庭院帶推導、住宅低 L1/L2/L3 的地面物件幾何、三角形預算 |
| `src/renderer/BuildingRenderer.ts`（改） | 委派給兩個 `InstancedLayer`；地面物件層的矩陣不含高度與基地縮放 |
| `src/showcase/main.ts`、`controls.ts`（改） | 顯示地面物件層 + 開關 |

---

## Task 1：基地縮放不再越過行人包絡線（BUG-222）

**Files:**
- Modify: `src/renderer/geometry/buildings/registry.ts`
- Modify: `src/renderer/BuildingAppearance.ts`
- Modify: `src/renderer/BuildingRenderer.ts:328-335`（`setInstanceData` 的縮放）
- Modify: `src/showcase/main.ts:70-75`（`place` 的縮放）
- Test: `src/renderer/__tests__/BuildingFootprint.test.ts`（新）
- Test: `src/renderer/__tests__/BuildingAppearance.test.ts`（改：範圍斷言）

**Interfaces:**
- Produces：
  - `centreFootprint(geo: THREE.BufferGeometry): void` —— 就地把 x/z 包圍盒置中（y 不動，建築要站在地面上）
  - `WIDTH_JITTER: Record<string, { down: number; up: number }>` —— key 同 `heightKey`
  - `widthJitterFor(zoneType: number, density: Density): { down: number; up: number }`
  - `footprintScaleFor(zoneType, density, level, variantIndex, jitter01?: number): number` —— `jitter01 ∈ [0,1)`，省略時取 0.5（正中間）
  - `footprintEnvelopeUnits(zoneType, density, level, variantIndex): number` —— 這個變體抖到最寬時，離格心的最大距離（格）
- Consumes：`MAX_BUILDING_WIDTH_M`、`METRES_PER_CELL`（`core/grid/constants.ts`）
- `Appearance` 介面改動：`widthScale`/`depthScale`（0.85~1.15）→ `width01`/`depth01`（`[0,1)`）

- [ ] **Step 1：寫失敗測試 —— 包絡線**

建立 `src/renderer/__tests__/BuildingFootprint.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  TARGET_HEIGHTS_M, TARGET_WIDTHS_M, getVariants, LEVELS, variantWidthUnits,
  footprintEnvelopeUnits, footprintScaleFor, widthJitterFor,
  type Density,
} from '../geometry/buildings/registry';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

function eachBucket(fn: (zoneType: number, density: Density, level: number, vi: number) => void) {
  for (const key of Object.keys(TARGET_HEIGHTS_M)) {
    const [zs, ds] = key.split(':');
    const zoneType = Number(zs);
    const density = ds as Density;
    for (const level of LEVELS) {
      const variants = getVariants(zoneType, level);
      for (let vi = 0; vi < variants.length; vi++) fn(zoneType, density, level, vi);
    }
  }
}

describe('footprint envelope', () => {
  it('should keep every variant inside the pedestrian envelope at maximum jitter', () => {
    // BUG-222：20 個變體有 14 個越線，其中 4 個吃進鄰居的格子。舊的上限
    // 只保證「寬度 <= 1 格」，而行人的門節點在 0.4083 外側。
    eachBucket((zoneType, density, level, vi) => {
      const half = footprintEnvelopeUnits(zoneType, density, level, vi);
      expect(half, `zone ${zoneType}/${density} L${level} v${vi}`)
        .toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
    });
  });

  it('should still draw the approved width at median jitter', () => {
    // 修法不得偷偷把已確認的尺寸改小。若上限咬到了，畫出來的寬度會小於
    // 尺寸表 × 抖動中位數 —— 這一條就是在盯「上限退化成安全網」。
    eachBucket((zoneType, density, level, vi) => {
      const target = TARGET_WIDTHS_M[`${zoneType}:${density}`]!;
      const { down, up } = widthJitterFor(zoneType, density);
      const median = 1 - down + 0.5 * (down + up);
      const drawnM = variantWidthUnits(zoneType, density, level, vi)
        * footprintScaleFor(zoneType, density, level, vi, 0.5) * METRES_PER_CELL;
      expect(drawnM, `zone ${zoneType}/${density} L${level} v${vi}`)
        .toBeCloseTo(target * median, 6);
    });
  });
});

describe('centreFootprint', () => {
  it('should leave no variant lopsided about the cell centre', () => {
    // 單邊外凸會浪費另一側的餘裕：makeResHighV3 的 z 是 -0.25 ~ +0.43，
    // 等比縮放到「寬度 0.68 格」之後那一側仍在 0.43。
    eachBucket((zoneType, _d, level, vi) => {
      const geo = getVariants(zoneType, level)[vi]!();
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(Math.abs(b.max.x + b.min.x), `zone ${zoneType} L${level} v${vi} x`)
        .toBeLessThan(1e-6);
      expect(Math.abs(b.max.z + b.min.z), `zone ${zoneType} L${level} v${vi} z`)
        .toBeLessThan(1e-6);
      geo.dispose();
    });
  });

  it('should keep buildings standing on the ground', () => {
    // 置中只能動 x/z。連 y 一起置中的話建築會有一半埋進地面。
    eachBucket((zoneType, _d, level, vi) => {
      const geo = getVariants(zoneType, level)[vi]!();
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y, `zone ${zoneType} L${level} v${vi}`)
        .toBeGreaterThanOrEqual(-1e-6);
      geo.dispose();
    });
  });
});

describe('widthJitterFor', () => {
  it('should give a plot-filling zone no room to grow wider', () => {
    // 目標寬度已經等於上限的分區，向上抖動必然越線。
    for (const key of Object.keys(TARGET_WIDTHS_M)) {
      const [zs, ds] = key.split(':');
      if (TARGET_WIDTHS_M[key] !== MAX_BUILDING_WIDTH_M) continue;
      expect(widthJitterFor(Number(zs), ds as Density).up, `${key} up`).toBe(0);
    }
  });

  it('should still let plot-filling buildings be thinner than the plot', () => {
    // 完全取消抖動會讓一整排塔樓寬度一模一樣。
    for (const key of Object.keys(TARGET_WIDTHS_M)) {
      const [zs, ds] = key.split(':');
      if (TARGET_WIDTHS_M[key] !== MAX_BUILDING_WIDTH_M) continue;
      expect(widthJitterFor(Number(zs), ds as Density).down).toBeGreaterThan(0.05);
    }
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

```
npx vitest run src/renderer/__tests__/BuildingFootprint.test.ts
```
預期：`footprintEnvelopeUnits`、`widthJitterFor` 未匯出 → 匯入即失敗。

- [ ] **Step 3：實作 —— `registry.ts`**

在 builder 區塊之後、`VARIANTS` 之前加入置中工具，並讓 `getVariants` 回傳的 builder 一律經過它：

```ts
/**
 * 就地把幾何的 x/z 包圍盒置中。y 不動 —— 建築要站在地面上。
 *
 * 單邊外凸的幾何會浪費另一側的餘裕：makeResHighV3 的 z 是 -0.25 ~ +0.43，
 * 寬度 0.68 但最大半距 0.43，等比縮放到「寬度 0.68 格」之後那一側仍在
 * 0.43，再乘抖動就是 0.594 —— 越過格子邊界吃進鄰居（BUG-222）。
 */
export function centreFootprint(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  geo.translate(-(b.max.x + b.min.x) / 2, 0, -(b.max.z + b.min.z) / 2);
  geo.computeBoundingBox();
}

/** 所有變體都經過置中。包在這裡而不是每個 builder 各自呼叫，才不會漏掉新變體。 */
function centred(build: GeoBuilder): GeoBuilder {
  return () => {
    const geo = build();
    centreFootprint(geo);
    return geo;
  };
}
```

`VARIANTS` 的每個 builder 以 `centred(...)` 包起來。

抖動表與上限：

```ts
/**
 * 逐實例寬深抖動的範圍，分「向下」與「向上」。
 *
 * 向上抖動會把建築推出行人包絡線，所以**目標寬度已經等於上限的分區向上為 0**。
 * 這不是把變化拿掉：向下保留 15%，鋪滿基地的分區仍會有偏瘦的個體，
 * 只是沒有偏胖的。真正的變化來源是量體變體（階段 2C），不是隨機拉寬。
 *
 * 另一種寫法是保留 ±15% 並讓上限去咬，但那會把高密度的平均寬度從 9.8
 * 壓到 9.33 m —— 等於偷偷改掉使用者已確認的比例。
 */
export const WIDTH_JITTER: Record<string, { down: number; up: number }> = {};
for (const [key, target] of Object.entries(TARGET_WIDTHS_M)) {
  WIDTH_JITTER[key] = target >= MAX_BUILDING_WIDTH_M
    ? { down: 0.15, up: 0 }
    : { down: 0.15, up: 0.15 };
}

export function widthJitterFor(zoneType: number, density: Density): { down: number; up: number } {
  return WIDTH_JITTER[heightKey(zoneType, density)] ?? { down: 0, up: 0 };
}

/**
 * 這個變體抖到最寬時，離格心的最大距離（格）。測試與庭院帶都靠它。
 *
 * 置中之後最大半距就是包圍盒寬度的一半，`jitter01 = 1` 是最寬的那一端。
 */
export function footprintEnvelopeUnits(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  return (variantWidthUnits(zoneType, density, level, variantIndex) / 2)
    * footprintScaleFor(zoneType, density, level, variantIndex, 1);
}
```

`footprintScaleFor` 改成吃原始抖動值：

```ts
const HALF_ENVELOPE_UNITS = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

export function footprintScaleFor(
  zoneType: number, density: Density, level: number, variantIndex: number,
  jitter01 = 0.5,
): number {
  const target = TARGET_WIDTHS_M[heightKey(zoneType, density)];
  if (!target) return 1;
  const units = variantWidthUnits(zoneType, density, level, variantIndex);
  if (units <= 0) return 1;

  const { down, up } = widthJitterFor(zoneType, density);
  const wanted = target / (units * METRES_PER_CELL);
  // 上限以「抖到最寬時離格心的最大距離」對上行人包絡線。用包圍盒寬度
  // 而不是最大半距，正是 BUG-222 的第二個根因。
  const ceiling = HALF_ENVELOPE_UNITS / ((units / 2) * (1 + up));
  const base = Math.min(wanted, ceiling);
  return base * (1 - down + jitter01 * (down + up));
}
```

刪掉舊的 `MAX_WIDTH_JITTER` 常數。

- [ ] **Step 4：實作 —— `BuildingAppearance.ts`**

`Appearance` 的 `widthScale` / `depthScale` 改名為 `width01` / `depth01`，值改為原始 `[0,1)`：

```ts
  /** [0, 1)，交給 footprintScaleFor 換算成縮放。範圍由分區決定，不在這裡。 */
  width01: number;
  depth01: number;
```

```ts
    width01: at(STREAM.WIDTH),
    depth01: at(STREAM.DEPTH),
```

同步改 `BuildingAppearance.test.ts` 的範圍斷言：

```ts
        expect(a.width01).toBeGreaterThanOrEqual(0);
        expect(a.width01).toBeLessThan(1);
        expect(a.depth01).toBeGreaterThanOrEqual(0);
        expect(a.depth01).toBeLessThan(1);
```

- [ ] **Step 5：實作 —— 兩個呼叫端**

`BuildingRenderer.setInstanceData`：

```ts
    const finalHeight = heightScaleFor(zoneType, density, level, app.variantIndex)
      * app.heightScale;
    this._rotation.makeRotationY((app.rotationQuarter * Math.PI) / 2);
    this._scale.makeScale(
      footprintScaleFor(zoneType, density, level, app.variantIndex, app.width01),
      finalHeight,
      footprintScaleFor(zoneType, density, level, app.variantIndex, app.depth01),
    );
```

`showcase/main.ts` 的 `place`：

```ts
  mesh.scale.set(
    footprintScaleFor(cell.zoneType, cell.density, cell.level, app.variantIndex, app.width01),
    heightScaleFor(cell.zoneType, cell.density, cell.level, app.variantIndex) * app.heightScale,
    footprintScaleFor(cell.zoneType, cell.density, cell.level, app.variantIndex, app.depth01),
  );
```

- [ ] **Step 6：跑測試**

```
npx vitest run src/renderer src/showcase
npx tsc --noEmit
```
預期：全綠、0 型別錯誤。若 `BuildingGeometry` 既有的包圍盒測試因置中而失敗，**先確認它斷言的是意圖而不是某個座標**；斷言座標的就改成斷言包絡線。

- [ ] **Step 7：回退驗證**

把 `footprintScaleFor` 的 `ceiling` 改回 `1 / (units * 1.15)`、把 `centred(...)` 拿掉，確認 `BuildingFootprint.test.ts` 前兩組轉紅；改回來。

- [ ] **Step 8：Commit**

```bash
git add src/renderer BUGS.md TODO.md
git commit -m "fix(renderer): buildings were reaching past the pedestrian envelope, four into the next cell

BUG-222。舊的上限只保證寬度 <= 1 格，而行人門節點在 0.4083 外側；
上限又用包圍盒寬度而非離格心最大距離，非置中的幾何會單邊外凸。
20 個變體有 14 個越線，工業與住宅高 v2 共 4 個吃進鄰居的格子。

三件事一起修：幾何置中、上限改用最大半距並把抖動算進去、
鋪滿基地的分區取消向上抖動（保留向下，所以塔樓仍有粗細差異）。
取消向上抖動之後上限剛好不咬，已確認過的每個寬度都原封不動。"
```

---

## Task 2：實例桶機制抽成 `InstancedLayer`

**Files:**
- Create: `src/renderer/InstancedLayer.ts`
- Modify: `src/renderer/BuildingRenderer.ts`
- Test: `src/renderer/__tests__/BuildingCapacity.test.ts`（**不得修改** —— 它是這次重構的安全網）

**Interfaces:**
- Produces：

```ts
export interface LayerEntry { key: string; idx: number }

export class InstancedLayer {
  constructor(material: THREE.Material, initialCapacity?: number)
  /** 建一個空桶。geometry 的所有權轉移給這個圖層。 */
  createBucket(scene: THREE.Scene, key: string, geometry: THREE.BufferGeometry): void
  meshFor(key: string): THREE.InstancedMesh | undefined
  entryFor(posKey: string): LayerEntry | undefined
  /** 取一個空位，容量不足時自動倍增。桶不存在時回傳 null。 */
  acquire(scene: THREE.Scene, key: string, posKey: string): { mesh: THREE.InstancedMesh; idx: number } | null
  /** swap-with-last 移除。矩陣、顏色與四個自訂屬性一起搬。 */
  release(posKey: string): void
  get meshes(): IterableIterator<THREE.InstancedMesh>
  /** 內部索引，供既有測試與 BuildingRenderer 的相容 getter 讀取。 */
  readonly bucketMap: ReadonlyMap<string, THREE.InstancedMesh>
  readonly entryMap: ReadonlyMap<string, LayerEntry>
  dispose(scene: THREE.Scene): void
}
```

- Consumes：無（純 Three.js）

- [ ] **Step 1：不寫新測試，先確認安全網會動**

```
npx vitest run src/renderer/__tests__/BuildingCapacity.test.ts
```
預期：4 支全綠。這支測試從內部 `positionToInstance` / `variantMeshes` 讀資料，涵蓋容量倍增時矩陣與 `aSeed` 是否搬對 —— 正是這次重構最容易寫壞的地方。**重構期間不准改它。**

- [ ] **Step 2：建立 `InstancedLayer.ts`**

把 `BuildingRenderer` 的 `initVariantMeshes` 建桶那一段、`growBucket` 全部、`removeBuilding` 的 swap 那一段搬過來。四個自訂屬性的名稱與長度集中成一份表：

```ts
/**
 * 每個實例都要帶的自訂屬性。名稱與長度只寫這一份 —— 建桶、倍增、
 * swap-with-last 三個地方都吃它，漏掉任何一處，建築就會戴上別人的資料，
 * 而且只在城市長到超過初始容量、或玩家拆除建築之後才發生。
 */
const INSTANCE_ATTRIBUTES = [
  ['aHighlight', 1], ['aHighlightColor', 3], ['aOccupancy', 1], ['aSeed', 3],
] as const;
```

`release()` 的 swap 迴圈改成走這張表，取代原本四段複製貼上的程式碼。

- [ ] **Step 3：`BuildingRenderer` 改為委派**

保留 `positionToInstance` 與 `variantMeshes` 兩個名字，改成轉發到圖層的 getter，讓 Step 1 的安全網原封不動仍然通過：

```ts
  private buildings = new InstancedLayer(getBuildingMaterial(), 256);

  /** 既有測試從這裡讀內部狀態，維持相容。 */
  private get variantMeshes() { return this.buildings.bucketMap; }
  private get positionToInstance() { return this.buildings.entryMap; }
```

- [ ] **Step 4：跑測試**

```
npx vitest run src/renderer
npx tsc --noEmit
```
預期：全綠。**任何一支紅的都代表搬錯了，不是測試該改。**

- [ ] **Step 5：Commit**

```bash
git add src/renderer
git commit -m "refactor(renderer): lift the instance-bucket machinery out of BuildingRenderer

地面物件層需要一模一樣的建桶、容量倍增與 swap-with-last；複製一份
200 行近乎相同的程式碼，兩份遲早會漂移。四個自訂屬性的名稱與長度
現在只寫一處，三個消費點都吃它。

BuildingCapacity.test.ts 全程未改，它就是這次重構的安全網。"
```

---

## Task 3：`groundProps.ts` —— 庭院帶與住宅低的地面物件幾何

**Files:**
- Create: `src/renderer/geometry/buildings/groundProps.ts`
- Modify: `src/renderer/geometry/buildings/registry.ts`（`TARGET_WIDTHS_M` 住宅低 7.2 → 6.0；`TRIANGLE_BUDGET` 加 `PROP`）
- Test: `src/renderer/__tests__/GroundProps.test.ts`（新）

**Interfaces:**
- Produces：

```ts
export interface YardRing { inner: number; outer: number }
/** 建築抖到最寬的外緣到行人包絡線之間。不足 0.05 格（0.6 m）時回傳 null。 */
export function yardRing(zoneType: number, density: Density, level: number): YardRing | null
export function hasGroundProps(zoneType: number, density: Density, level: number): boolean
export function getGroundPropVariants(zoneType: number, density: Density, level: number): GeoBuilder[]
export const PROP_TRIANGLE_BUDGET = 240
```

- Consumes：`footprintEnvelopeUnits`、`getVariants`、`LEVELS`（Task 1 的 registry）；`MAX_BUILDING_WIDTH_M`、`METRES_PER_CELL`；`tagPart`、`PART_FOLIAGE`、`PART_DETAIL`

- [ ] **Step 1：寫失敗測試**

建立 `src/renderer/__tests__/GroundProps.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  yardRing, hasGroundProps, getGroundPropVariants, PROP_TRIANGLE_BUDGET,
} from '../geometry/buildings/groundProps';
import { TARGET_HEIGHTS_M, TARGET_WIDTHS_M, LEVELS, type Density }
  from '../geometry/buildings/registry';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../core/grid/constants';
import { ZoneType } from '../../core/grid/types';

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

describe('yardRing', () => {
  it('should give the low-density house a yard worth looking at', () => {
    const ring = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 1)!;
    expect(ring).not.toBeNull();
    // 1 m 以上才放得下看得見的樹籬與樹。
    expect((ring.outer - ring.inner) * METRES_PER_CELL).toBeGreaterThan(1.0);
  });

  it('should give a plot-filling zone no yard at all', () => {
    // 目標寬度就是包絡線的分區沒有留白，這是幾何事實不是遺漏。
    for (const key of Object.keys(TARGET_WIDTHS_M)) {
      if (TARGET_WIDTHS_M[key] !== MAX_BUILDING_WIDTH_M) continue;
      const [zs, ds] = key.split(':');
      expect(yardRing(Number(zs), ds as Density, 1), key).toBeNull();
    }
  });

  it('should never let the yard reach past the pedestrian envelope', () => {
    for (const key of Object.keys(TARGET_HEIGHTS_M)) {
      const [zs, ds] = key.split(':');
      for (const level of LEVELS) {
        const ring = yardRing(Number(zs), ds as Density, level);
        if (!ring) continue;
        expect(ring.outer, `${key} L${level}`).toBeLessThanOrEqual(HALF_ENVELOPE + 1e-9);
      }
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

  it('should keep every prop inside the yard ring', () => {
    // 內側越界 = 樹長進客廳；外側越界 = 行人穿過樹籬。
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
    for (const level of LEVELS) {
      const ring = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', level)!;
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
      expect(geo.boundingBox!.min.y, label).toBeGreaterThanOrEqual(-1e-6);
      expect(geo.boundingBox!.min.y, `${label} 浮空`).toBeLessThan(0.02);
    });
  });

  it('should stay inside the triangle budget', () => {
    eachProp((geo, label) => {
      expect(geo.getAttribute('position').count / 3, label)
        .toBeLessThanOrEqual(PROP_TRIANGLE_BUDGET);
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
    const tri = (level: number) => getGroundPropVariants(ZoneType.RESIDENTIAL_LOW, 'LOW', level)
      .map(b => { const g = b(); const n = g.getAttribute('position').count / 3; g.dispose(); return n; })
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
```

- [ ] **Step 2：跑測試確認失敗**

```
npx vitest run src/renderer/__tests__/GroundProps.test.ts
```
預期：模組不存在。

- [ ] **Step 3：`registry.ts` —— 住宅低目標寬度下修並加預算**

```ts
  // 6.0 而不是 7.2：7.2 量的是「房子 + 車庫 + 樹」的包圍盒，房子本體只佔
  // 4.3 m。庭院物件搬出去之後若仍以 7.2 為目標，房子本體會被放大到 7.2 m、
  // 庭院只剩 0.76 m —— 觀感會反過來變成房子變大院子變小。6.0 讓房子維持
  // 接近原本的視覺量體，庭院帶則有 1.45 m。
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]:   6.0,
```

```ts
export const TRIANGLE_BUDGET = {
  HOUSE: 400,
  TOWER: 800,
  /** 地面物件另外計算：它是獨立圖層，不佔量體的預算。 */
  PROP: 240,
} as const;
```

- [ ] **Step 4：實作 `groundProps.ts`**

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../core/grid/constants';
import { TARGET_WIDTHS_M, heightKey, widthJitterFor, type Density, type GeoBuilder }
  from './registry';
import { tagPart, PART_FOLIAGE, PART_DETAIL } from './parts';

/**
 * 地面物件圖層。
 *
 * 它存在的理由是 BUG-219：等級以 `makeScale(w, h, d)` 乘在整份合併幾何上，
 * 所以住宅低密度 L1 升到 L3 時，庭院的樹跟著被拉高 1.75 倍（1.44 -> 2.52 m）。
 * 樹不會因為房子加蓋而長高。把它們搬出來之後，這一層只吃旋轉與位置，
 * 高度與基地縮放都不套用 —— 樹在每個等級都是同一個真實尺寸。
 *
 * 幾何一律以**真實尺寸**撰寫（1 格 = 12 m），不再是「會被縮放的相對比例」。
 */

const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;
/** 庭院帶窄於這個寬度就不放東西 —— 塞不下看得見的物件。 */
const MIN_RING_UNITS = 0.05;

export const PROP_TRIANGLE_BUDGET = 240;

export interface YardRing { inner: number; outer: number }

/**
 * 建築抖到最寬的外緣到行人包絡線之間的環帶。
 *
 * 內緣用「目標寬度 × 最大向上抖動」而不是實際變體的寬度：庭院物件是整個
 * (分區, 等級) 桶共用的，不能依賴配到哪一個量體變體。
 */
export function yardRing(zoneType: number, density: Density, level: number): YardRing | null {
  void level;
  const target = TARGET_WIDTHS_M[heightKey(zoneType, density)];
  if (!target) return null;
  const inner = (target / METRES_PER_CELL / 2) * (1 + widthJitterFor(zoneType, density).up);
  if (HALF_ENVELOPE - inner < MIN_RING_UNITS) return null;
  return { inner, outer: HALF_ENVELOPE };
}

export function hasGroundProps(zoneType: number, density: Density, level: number): boolean {
  return getGroundPropVariants(zoneType, density, level).length > 0;
}
```

幾何工具（皆以格為單位，`M(x)` 把公尺換成格）：

```ts
const M = (metres: number) => metres / METRES_PER_CELL;

/** 沿著某一邊的連續樹籬。`side` 是 ±x 或 ±z 的中心線位置。 */
function hedge(ring: YardRing, axis: 'x' | 'z', sign: 1 | -1, lengthFrac: number, heightM: number) {
  const mid = (ring.inner + ring.outer) / 2;
  const depth = (ring.outer - ring.inner) * 0.8;
  const len = ring.outer * 2 * lengthFrac;
  const geo = axis === 'z'
    ? new THREE.BoxGeometry(len, M(heightM), depth)
    : new THREE.BoxGeometry(depth, M(heightM), len);
  geo.translate(
    axis === 'x' ? sign * mid : 0,
    M(heightM) / 2,
    axis === 'z' ? sign * mid : 0,
  );
  tagPart(geo, PART_FOLIAGE);
  return geo;
}

/** 石砌花台／矮牆。與樹籬同形狀，但標 PART_DETAIL 而不是樹葉。 */
function planter(ring: YardRing, axis: 'x' | 'z', sign: 1 | -1, lengthFrac: number) {
  const geo = hedge(ring, axis, sign, lengthFrac, 0.4);
  tagPart(geo, PART_DETAIL);   // hedge 標的是 FOLIAGE，這裡覆蓋掉
  return geo;
}

/**
 * 柱狀樹（絲柏型）。庭院帶只有 1.45 m 寬，球狀樹冠塞不下；
 * 柱狀的樹冠窄、可以往上長，是這個尺寸下唯一像樹的選擇。
 *
 * 樹冠半徑取環帶半寬的 90%，所以放在環帶中線上時內外都不越界。
 */
function columnarTree(ring: YardRing, sx: 1 | -1, sz: 1 | -1, heightM: number) {
  const mid = (ring.inner + ring.outer) / 2;
  const r = ((ring.outer - ring.inner) / 2) * 0.9;
  const trunkH = M(heightM * 0.25);
  const crownH = M(heightM * 0.75);

  const trunk = new THREE.CylinderGeometry(M(0.09), M(0.12), trunkH, 5);
  trunk.translate(sx * mid, trunkH / 2, sz * mid);
  tagPart(trunk, PART_DETAIL);   // 樹幹不是牆，標 PART_WALL 會長出窗戶

  const crown = new THREE.ConeGeometry(r, crownH, 6);
  crown.translate(sx * mid, trunkH + crownH / 2, sz * mid);
  tagPart(crown, PART_FOLIAGE);
  return [trunk, crown];
}

/** 矮灌木叢。半徑上限同樣是環帶半寬。 */
function shrub(ring: YardRing, sx: 1 | -1, sz: 1 | -1, radiusM: number) {
  const mid = (ring.inner + ring.outer) / 2;
  const r = Math.min(M(radiusM), ((ring.outer - ring.inner) / 2) * 0.95);
  const geo = new THREE.SphereGeometry(r, 5, 4);
  geo.translate(sx * mid, r, sz * mid);
  tagPart(geo, PART_FOLIAGE);
  return geo;
}
```

住宅低的三個等級（規格修訂 4 的「周邊」欄）：

```ts
/**
 * 住宅低密度的庭院階梯。
 *
 *   L1 素土院子：兩段矮木柵 + 一叢灌木
 *   L2 樹籬與一棵樹：兩段樹籬 + 一棵柱狀樹 + 一叢灌木
 *   L3 修剪庭園：三面樹籬 + 兩棵柱狀樹 + 石砌花台 + 一叢灌木
 *
 * 每個等級兩個變體 —— 只有一種庭院的話，整條街的院子會一模一樣，
 * 等於把重複感從房子搬到院子。兩個變體之間換邊、換棵數，不換等級語彙。
 */
function yard(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts)!;
}

const RES_LOW_YARDS: Record<number, GeoBuilder[]> = {
  1: [
    () => { const r = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 1)!; return yard([
      planter(r, 'z', 1, 0.55), planter(r, 'z', -1, 0.35), shrub(r, 1, -1, 0.55),
    ]); },
    () => { const r = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 1)!; return yard([
      planter(r, 'x', -1, 0.5), shrub(r, 1, 1, 0.6), shrub(r, -1, -1, 0.45),
    ]); },
  ],
  2: [
    () => { const r = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 2)!; return yard([
      hedge(r, 'z', 1, 0.9, 0.9), hedge(r, 'x', 1, 0.7, 0.8),
      ...columnarTree(r, -1, -1, 4.0), shrub(r, 1, -1, 0.5),
    ]); },
    () => { const r = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 2)!; return yard([
      hedge(r, 'z', -1, 0.9, 0.8), hedge(r, 'x', -1, 0.6, 0.9),
      ...columnarTree(r, 1, 1, 3.6), shrub(r, -1, 1, 0.55),
    ]); },
  ],
  3: [
    () => { const r = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 3)!; return yard([
      hedge(r, 'z', 1, 0.95, 1.0), hedge(r, 'x', 1, 0.9, 1.0), hedge(r, 'x', -1, 0.9, 1.0),
      ...columnarTree(r, -1, -1, 4.8), ...columnarTree(r, 1, -1, 4.2),
      planter(r, 'z', -1, 0.7), shrub(r, -1, 1, 0.6),
    ]); },
    () => { const r = yardRing(ZoneType.RESIDENTIAL_LOW, 'LOW', 3)!; return yard([
      hedge(r, 'z', -1, 0.95, 1.0), hedge(r, 'z', 1, 0.95, 0.9), hedge(r, 'x', 1, 0.85, 1.0),
      ...columnarTree(r, -1, 1, 5.0), ...columnarTree(r, -1, -1, 4.4),
      planter(r, 'x', -1, 0.6), shrub(r, 1, -1, 0.5),
    ]); },
  ],
};

export function getGroundPropVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  if (!yardRing(zoneType, density, level)) return [];
  if (zoneType === ZoneType.RESIDENTIAL_LOW && density === 'LOW') {
    return RES_LOW_YARDS[Math.max(1, Math.min(3, level))] ?? [];
  }
  return [];
}
```

**三角形預估**（`BoxGeometry` 12、`SphereGeometry(r,5,4)` 30、5 段圓柱 20、6 段圓錐 12）：

| 等級 | 變體 0 | 變體 1 |
|---|---|---|
| L1 | 12+12+30 = 54 | 12+30+30 = 72 |
| L2 | 12+12+32+30 = 86 | 同上 86 |
| L3 | 36+64+12+30 = 142 | 同上 142 |

單一變體最大 142 < 240 ✓；逐級遞增 ✓（測試 `should make the garden better with every level` 比的是同一等級所有變體的總和：126 → 172 → 284）。

- [ ] **Step 5：跑測試到綠**

```
npx vitest run src/renderer/__tests__/GroundProps.test.ts
npx tsc --noEmit
```

- [ ] **Step 6：回退驗證**

把某個 L3 樹的位置改到 `ring.inner` 內側，確認「should not put anything inside the house footprint」轉紅；把樹幹標成 `PART_WALL`，確認「should never tag a prop as wall」轉紅。都改回來。

- [ ] **Step 7：Commit**

```bash
git add src/renderer/geometry/buildings/groundProps.ts src/renderer/geometry/buildings/registry.ts src/renderer/__tests__/GroundProps.test.ts
git commit -m "feat(renderer): ground props as real-size geometry in a derived yard ring

庭院帶由建築目標寬度與行人包絡線推導，不寫死分區清單：只有讓出空間的
分區才有院子，日後把商業低調窄它會自動長出來。住宅低目標寬度 7.2 -> 6.0，
因為 7.2 量的是房子加車庫加樹的包圍盒，房子本體只有 4.3 m。"
```

---

## Task 4：地面物件圖層接進 `BuildingRenderer`

**Files:**
- Modify: `src/renderer/BuildingRenderer.ts`
- Test: `src/renderer/__tests__/GroundPropLayer.test.ts`（新）

**Interfaces:**
- Consumes：`InstancedLayer`（Task 2）、`getGroundPropVariants`（Task 3）、`STREAM.GROUND_PROP`（本任務加入 `BuildingAppearance`）
- Produces：`BuildingRenderer` 內部第二個圖層；對外簽章不變

- [ ] **Step 1：寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { Grid } from '../../core/grid/Grid';
import { ZoneType } from '../../core/grid/types';

const ZONE = ZoneType.RESIDENTIAL_LOW;

interface Internals {
  props: { entryMap: Map<string, { key: string; idx: number }>;
           bucketMap: Map<string, THREE.InstancedMesh> };
}

function fresh() {
  const renderer = new BuildingRenderer();
  renderer.build(new THREE.Scene(), new Grid(1, 1));
  return { renderer, internals: renderer as unknown as Internals };
}

/** 這一格的地面物件在世界座標中的包圍盒。 */
function propBox(internals: Internals, x: number, y: number): THREE.Box3 {
  const entry = internals.props.entryMap.get(`${x},${y}`)!;
  const mesh = internals.props.bucketMap.get(entry.key)!;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(entry.idx, m);
  const box = new THREE.Box3().setFromBufferAttribute(
    mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  return box.applyMatrix4(m);
}

describe('ground prop layer', () => {
  it('should draw the garden at the same height whatever the building level', () => {
    // BUG-219：等級是乘在整份合併幾何上的 Y 縮放，所以住宅低 L1 升到 L3 時
    // 庭院的樹被拉高 1.75 倍（1.44 -> 2.52 m）。樹不會因為房子加蓋而長高。
    const heights = [1, 2, 3].map((level) => {
      const { renderer, internals } = fresh();
      renderer.addBuilding(0, 0, ZONE, 'LOW', level, false);
      return propBox(internals, 0, 0).max.y;
    });
    expect(heights[0]).toBeGreaterThan(0);
    expect(heights[1]).toBeCloseTo(heights[0]!, 6);
    expect(heights[2]).toBeCloseTo(heights[0]!, 6);
  });

  it('should give every low-density house a garden', () => {
    const { renderer, internals } = fresh();
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) {
      renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
    }
    expect(internals.props.entryMap.size).toBe(36);
  });

  it('should give a plot-filling zone none', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZoneType.RESIDENTIAL_HIGH, 'HIGH', 3, false);
    expect(internals.props.entryMap.has('0,0')).toBe(false);
  });

  it('should take the garden away with the building', () => {
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 1, false);
    renderer.addBuilding(1, 0, ZONE, 'LOW', 1, false);
    renderer.removeBuilding(0, 0);
    expect(internals.props.entryMap.has('0,0')).toBe(false);
    expect(internals.props.entryMap.has('1,0')).toBe(true);
  });

  it('should swap the garden when the house upgrades', () => {
    // 庭院組合依等級而不同，所以升級必須換桶 —— 只改矩陣不換桶的話，
    // L3 的房子會配著 L1 的素土院子。
    const { renderer, internals } = fresh();
    renderer.addBuilding(0, 0, ZONE, 'LOW', 1, false);
    const before = internals.props.entryMap.get('0,0')!.key;
    renderer.updateBuilding(0, 0, ZONE, 'LOW', 3, false);
    expect(internals.props.entryMap.get('0,0')!.key).not.toBe(before);
  });

  it('should keep every remaining garden on its own house after removals', () => {
    // swap-with-last 的索引 bug 只在移除之後才現形，而且畫面上看不出來。
    const { renderer, internals } = fresh();
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) {
      renderer.addBuilding(x, y, ZONE, 'LOW', 1, false);
      cells.push([x, y]);
    }
    for (let i = 0; i < cells.length; i += 3) renderer.removeBuilding(...cells[i]!);
    for (let i = 0; i < cells.length; i++) {
      if (i % 3 === 0) continue;
      const [x, y] = cells[i]!;
      const box = propBox(internals, x, y);
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      expect(cx, `${x},${y} 的院子跑到別人家`).toBeCloseTo(x, 3);
      expect(cz).toBeCloseTo(y, 3);
    }
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

- [ ] **Step 3：`BuildingAppearance` 加一條亂數流**

```ts
  /** 庭院組合。與量體變體分開，才不會「同一棟房子必定配同一個院子」。 */
  GROUND_PROP: 12,
```

`Appearance` 加 `propVariant01: number`（原始 `[0,1)`；桶數由呼叫端決定）。

- [ ] **Step 4：`BuildingRenderer` 加第二個圖層**

```ts
  /**
   * 地面物件層。與量體層平行，但**矩陣只含旋轉與位置** ——
   * 沒有高度縮放也沒有基地縮放，所以樹在每個等級都是同一個真實尺寸（BUG-219）。
   */
  private props = new InstancedLayer(getBuildingMaterial(), 256);
```

`initVariantMeshes` 內對每個 (分區, 密度, 等級) 額外建立庭院桶；`addBuilding` / `removeBuilding` / `updateBuilding` 各加一段對稱的操作。`updateBuilding` 一律 `release` 後 `acquire`，因為等級換了桶就換了。

矩陣：

```ts
    this._matrix.makeRotationY((app.rotationQuarter * Math.PI) / 2);
    this._matrix.setPosition(x, 0.05, y);
```

- [ ] **Step 5：跑測試到綠**

```
npx vitest run src/renderer
npx tsc --noEmit
```

- [ ] **Step 6：回退驗證**

把地面物件的矩陣改成與量體共用（含 `finalHeight`），確認第一支測試轉紅；改回來。

- [ ] **Step 7：Commit**

```bash
git add src/renderer
git commit -m "fix(renderer): the garden no longer grows when the house upgrades

BUG-219。等級以 makeScale 乘在整份合併幾何上，住宅低 L1 -> L3 時
庭院的樹跟著被拉高 1.75 倍（1.44 -> 2.52 m）。地面物件改成獨立圖層，
矩陣只含旋轉與位置。"
```

---

## Task 5：建築幾何剝掉庭院物件

**Files:**
- Modify: `src/renderer/geometry/buildings/registry.ts`（`makeResLowV1` / `V2` / `V3`）
- Test: `src/renderer/__tests__/BuildingFootprint.test.ts`（加一組）

- [ ] **Step 1：寫失敗測試**

加到 `BuildingFootprint.test.ts`：

```ts
describe('building massing', () => {
  it('should contain no foliage — greenery lives in the ground prop layer', () => {
    // BUG-219 的機器可檢查形式：只要量體裡還有樹葉，它就會跟著等級被拉高。
    eachBucket((zoneType, _d, level, vi) => {
      const geo = getVariants(zoneType, level)[vi]!();
      const col = geo.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        const part = col.getX(i);
        expect(part > 0.35 && part < 0.65, `zone ${zoneType} L${level} v${vi} 頂點 ${i} 是樹葉`)
          .toBe(false);
      }
      geo.dispose();
    });
  });
});
```

- [ ] **Step 2：跑測試確認失敗** —— 住宅低三個變體都該紅（樹籬、灌木、樹冠）。

- [ ] **Step 3：實作**

`makeResLowV1`：刪掉 `hedge`、`trunk`、`canopy`。
`makeResLowV2`：刪掉 `bush1`、`bush2`、`trunk`、`canopy`。
`makeResLowV3`：刪掉 `hedge1`、`hedge2`、`bush`；`fence` 也一併刪除（圍籬是地面物件，規格修訂 2 明列）。

車庫（`garage`）、門廊（`porch`）、工具間（`shed`）**留在量體裡** —— 它們是建築，跟著等級變大是對的。工業的 `dock` 與 `wall` 同理留下。

- [ ] **Step 4：跑測試到綠 + 全量**

```
npx vitest run
npx tsc --noEmit
```

- [ ] **Step 5：回退驗證** —— 把 `makeResLowV1` 的樹加回去，確認新測試轉紅。

- [ ] **Step 6：Commit**

```bash
git add src/renderer
git commit -m "refactor(renderer): greenery leaves the building geometry

車庫、門廊、工具間留在量體裡 —— 它們是建築，跟著等級變大是對的。
樹、樹籬、灌木、圍籬搬進地面物件層。"
```

---

## Task 6：展示區顯示地面物件 + 文件

**Files:**
- Modify: `src/showcase/main.ts`、`src/showcase/controls.ts`
- Modify: `BUGS.md`（BUG-219、BUG-222 標記已修）、`TODO.md`、規格文件
- Test: `src/showcase/__tests__/NeighbourSameRatio.test.ts`（不動）

- [ ] **Step 1：`place()` 加地面物件**

```ts
  const yards = getGroundPropVariants(cell.zoneType, cell.density, cell.level);
  if (state.showProps && yards.length > 0) {
    const pi = Math.floor(app.propVariant01 * yards.length) % yards.length;
    const pgeo = yards[pi]!();
    stampZoneCategory(pgeo, ZONE_CAT[cell.zoneType] ?? 0);
    const pmesh = new THREE.Mesh(pgeo, material);
    pmesh.castShadow = true;
    pmesh.receiveShadow = true;
    // 不套用縮放 —— 這正是這一層存在的理由（BUG-219）。
    pmesh.rotation.y = (app.rotationQuarter * Math.PI) / 2;
    pmesh.position.set(cell.x, 0.05, cell.z);
    sceneManager.scene.add(pmesh);
    shown.push(pmesh);
    triangles += pgeo.getAttribute('position').count / 3;
  }
```

- [ ] **Step 2：控制項加「地面物件」開關**

`ControlState` 加 `showProps: boolean`（預設 `true`），面板加一個 checkbox。使用者要能一鍵比對有無。

- [ ] **Step 3：統計加一行**

```
量體 N 三角形／棟（上限 …）
地面物件 M 三角形／棟（上限 240）
```

- [ ] **Step 4：手動驗收（人工）**

`pnpm dev` → `http://localhost:5180/showcase.html`

1. 住宅低密度 + 街廓 8×8，在 L1 / L2 / L3 之間切換 —— **樹的高度不得改變**，只有房子變高、院子變好。
2. 切「地面物件」開關 —— 房子本體的大小要看起來合理（6.0 m 目標的效果）。
3. 高密度住宅／商業／工業／辦公 —— 不該出現任何地面物件。
4. 拉時間滑桿到夜間 —— 樹不該亮燈（`PART_FOLIAGE` 走的是樹葉分支）。

- [ ] **Step 5：更新文件**

- `BUGS.md`：BUG-219 與 BUG-222 標題加「已修」，附上修法與量到的數字。
- `TODO.md`：階段 2B 打勾，補上 `BuildingRenderer.ts` 行數與測試數變化。
- 規格文件加「修訂 5」：記錄庭院帶是推導出來的、只有住宅低符合，以及住宅低目標寬度 7.2 → 6.0 的理由。

- [ ] **Step 6：全量測試 + 建置**

```
npx vitest run
npx tsc --noEmit
pnpm build
```
預期：全綠、0 型別錯誤、`dist/index.html` 與 `dist/showcase.html` 都產出。

- [ ] **Step 7：Commit**

```bash
git add src/showcase BUGS.md TODO.md docs
git commit -m "feat(showcase): show the ground prop layer, with a toggle to compare

驗收的重點是「在 L1/L2/L3 之間切換時樹的高度不變」——
那是 BUG-219 唯一看得出來的地方。"
```

---

## 完成條件

1. 20 個變體全部落在行人包絡線內（`BuildingFootprint.test.ts`）。
2. 住宅低 L1/L2/L3 的地面物件世界高度完全相同（`GroundPropLayer.test.ts`）。
3. 建築量體不含任何 `PART_FOLIAGE` 頂點。
4. 展示區可切換地面物件，三角形計數分列量體與物件。
5. 全量測試綠、`tsc` 0 錯、`pnpm build` 成功。
6. 使用者在展示區確認庭院的觀感與房子本體的大小。

## 不在本階段

- 商業低／辦公低的地面物件 —— 它們目前沒有庭院帶。若使用者要，先調窄目標寬度，物件層會自動生效。
- 工業的管架、筒倉、貨櫃 —— 工業鋪滿基地，那些是量體與屋頂物件的工作（2C／階段 3）。
- 屋頂物件層（階段 3）。
- 地面物件的 LOD（階段 4）—— 圖層獨立之後只是把 `count` 設 0，很便宜。

# 建築模型多樣性 — 階段 0 + 1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個使用正式材質與正式生成器的建築展示區，並讓所有分區的建築立面不再寫死 —— 每棟樓有自己的樓層高度、窗寬與立面相位。

**Architecture:** 把 `BuildingRenderer.ts`（3670 行）裡混在一起的三件事拆開：外觀亂數（純函式，不 import Three.js）、幾何零件與變體註冊表、shader 與材質。展示區成為這些模組的第二個消費者，因此它顯示的東西與遊戲完全一致。接著加上逐實例的 `aSeed` 屬性，把 shader 裡寫死的樓層高度與窗寬變成每棟不同。

**Tech Stack:** TypeScript、Three.js、Vite 7（多入口）、Vitest（node environment，Three.js 可直接建構幾何與網格，不需要 WebGL context）。

## Global Constraints

- **TDD 強制**：所有新功能先寫測試再寫實作。修好之後把修正還原，確認測試轉紅，再改回來。
- `src/core/` 禁止 import Three.js。本計畫的所有新檔案都在 `src/renderer/` 與 `src/showcase/`，不碰 core。
- 渲染層單向讀取 core 狀態，不回寫。
- 所有既有測試必須保持綠：基準是 **4230 個測試、292 個檔案**。
- `npx tsc --noEmit` 必須零錯誤。
- `npx vite build` 必須能產出 `dist/`。
- 發現 Bug 必須寫入 `BUGS.md` 和 `TODO.md`。
- 與使用者溝通一律使用繁體中文。
- 執行測試用 `npx vitest run <path>`，不要用 `pnpm test`（那會跑全部）。
- 本階段**不**動存檔格式、**不**動 `Grid`、**不**動 `BuildingGrowth`。`seedByte` 參數會出現在介面上但一律傳 `0`，第四階段才接上真值。

---

## 檔案結構

### 新增

| 檔案 | 職責 |
|---|---|
| `src/renderer/BuildingAppearance.ts` | 外觀亂數的唯一來源。純函式，不 import Three.js。 |
| `src/renderer/BuildingMaterial.ts` | 建築 shader 原始碼與 material singleton。 |
| `src/renderer/geometry/buildings/parts.ts` | 零件標籤常數與門檻、`tagPart`、`ZONE_CAT`、`stampZoneCategory`。 |
| `src/renderer/geometry/buildings/registry.ts` | 變體註冊表與 `getVariants(zoneType, level)`。 |
| `src/showcase/main.ts` | 展示區進入點。 |
| `src/showcase/views.ts` | 三種檢視模式的建構與 `neighbourSameRatio`。 |
| `src/showcase/controls.ts` | 控制面板（DOM，不用 Solid）。 |
| `showcase.html` | 展示區 HTML 入口。 |

### 修改

| 檔案 | 改動 |
|---|---|
| `src/renderer/BuildingRenderer.ts` | 刪掉搬走的程式碼，改為 import；`hash` 換成 `appearanceOf`；新增 `aSeed` 屬性。 |
| `vite.config.ts` | 加入第二個 rollup 入口。 |
| `docs/superpowers/specs/2026-08-09-building-model-variety-design.md` | 填入實測的效能基準數字。 |

### 測試

`src/renderer/__tests__/BuildingAppearance.test.ts`、`BuildingParts.test.ts`、`BuildingMaterial.test.ts`、`BuildingRegistry.test.ts`、`BuildingInstanceSeed.test.ts`、`src/showcase/__tests__/NeighbourSameRatio.test.ts`

---

## Task 1: 外觀亂數的唯一來源

**Files:**
- Create: `src/renderer/BuildingAppearance.ts`
- Test: `src/renderer/__tests__/BuildingAppearance.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces: `hashCell(x, y, seedByte, stream): number`、`STREAM`（常數物件）、`variantIndexOf(x, y, seedByte, variantCount): number`、`appearanceOf(input: AppearanceInput): Appearance`、型別 `AppearanceInput` 與 `Appearance`。

**背景：** 現行 `BuildingRenderer.ts:15` 的 `hash(x, y)` 只吃兩個輸入，多路亂數靠偏移輸入產生（`hash(x+100, y+100)`）。`hash(x+100,y+100)` 在 (0,0) 的值等於 `hash(x,y)` 在 (100,100) 的值，所以相距 100 格的兩棟建築有多條亂數流是共用的、只是換了角色。這個 task 用「把流編號混進雜湊」取代它。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingAppearance.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  hashCell, STREAM, variantIndexOf, appearanceOf,
} from '../BuildingAppearance';

/**
 * 這裡的每一條都對應 BuildingRenderer 現行寫法的一個具體缺陷或性質：
 * 決定論是存檔重開一致的前提；流獨立性直接針對舊寫法的對角線相關性；
 * 範圍是為了讓既有的視覺調校不被這次重構改變。
 */
describe('hashCell', () => {
  it('should return the same value for the same inputs', () => {
    expect(hashCell(3, 7, 0, STREAM.VARIANT)).toBe(hashCell(3, 7, 0, STREAM.VARIANT));
  });

  it('should stay inside [0, 1)', () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const v = hashCell(x, y, 0, STREAM.HEIGHT);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('should not share any stream value between cells 100 apart on the diagonal', () => {
    // 舊寫法的具體失效模式：hash(x+100,y+100) 在 (0,0) 等於 hash(x,y) 在 (100,100)，
    // 所以 (0,0) 與 (100,100) 的多條流共用同一批數字。
    const streams = Object.values(STREAM);
    const a = streams.map(s => hashCell(0, 0, 0, s));
    const b = streams.map(s => hashCell(100, 100, 0, s));
    for (const va of a) {
      for (const vb of b) {
        expect(va).not.toBe(vb);
      }
    }
  });

  it('should give a different value for each stream of the same cell', () => {
    const seen = new Set<number>();
    for (const s of Object.values(STREAM)) seen.add(hashCell(12, 34, 0, s));
    expect(seen.size).toBe(Object.values(STREAM).length);
  });

  it('should change when only seedByte changes', () => {
    expect(hashCell(5, 5, 0, STREAM.VARIANT)).not.toBe(hashCell(5, 5, 1, STREAM.VARIANT));
  });
});

describe('variantIndexOf', () => {
  it('should always land inside the variant list', () => {
    for (let x = 0; x < 60; x++) {
      for (let y = 0; y < 60; y++) {
        const i = variantIndexOf(x, y, 0, 8);
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(8);
      }
    }
  });

  it('should use every variant roughly evenly', () => {
    const counts = new Array<number>(8).fill(0);
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) counts[variantIndexOf(x, y, 0, 8)]!++;
    }
    const expected = 10000 / 8;
    for (const c of counts) {
      expect(c).toBeGreaterThan(expected * 0.7);
      expect(c).toBeLessThan(expected * 1.3);
    }
  });

  it('should return 0 rather than NaN when there are no variants', () => {
    expect(variantIndexOf(1, 1, 0, 0)).toBe(0);
  });
});

describe('appearanceOf', () => {
  const input = {
    x: 4, y: 9, zoneType: 2, level: 2, seedByte: 0,
    variantCount: 8, paletteSize: 8,
  };

  it('should depend on nothing but its inputs', () => {
    expect(appearanceOf(input)).toEqual(appearanceOf({ ...input }));
  });

  it('should keep scale jitter inside the ranges the look was tuned with', () => {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const a = appearanceOf({ ...input, x, y });
        expect(a.widthScale).toBeGreaterThanOrEqual(0.85);
        expect(a.widthScale).toBeLessThanOrEqual(1.15);
        expect(a.depthScale).toBeGreaterThanOrEqual(0.85);
        expect(a.depthScale).toBeLessThanOrEqual(1.15);
        expect(a.heightScale).toBeGreaterThanOrEqual(0.825);
        expect(a.heightScale).toBeLessThanOrEqual(1.175);
        expect([0, 1, 2, 3]).toContain(a.rotationQuarter);
        expect(a.paletteIndex).toBeGreaterThanOrEqual(0);
        expect(a.paletteIndex).toBeLessThan(8);
      }
    }
  });

  it('should produce three facade seed components, each in [0, 1)', () => {
    const a = appearanceOf(input);
    expect(a.facadeSeed).toHaveLength(3);
    for (const v of a.facadeSeed) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('should give two neighbouring cells different facade seeds', () => {
    const a = appearanceOf({ ...input, x: 10, y: 10 });
    const b = appearanceOf({ ...input, x: 11, y: 10 });
    expect(a.facadeSeed).not.toEqual(b.facadeSeed);
  });

  it('should agree with variantIndexOf', () => {
    expect(appearanceOf(input).variantIndex)
      .toBe(variantIndexOf(input.x, input.y, input.seedByte, input.variantCount));
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingAppearance.test.ts`
Expected: FAIL — `Failed to resolve import "../BuildingAppearance"`

- [ ] **Step 3: 寫最小實作**

建立 `src/renderer/BuildingAppearance.ts`：

```ts
/**
 * 建築外觀亂數的唯一來源。
 *
 * 純邏輯模組 —— 不 import Three.js，因此展示區與遊戲共用同一份，
 * 也因此可以完整地單元測試。
 *
 * 取代 BuildingRenderer 原本的 `hash(x, y)` 加偏移輸入寫法：
 * `hash(x+100, y+100)` 在 (0,0) 的值等於 `hash(x, y)` 在 (100,100) 的值，
 * 所以相距 100 格的兩棟建築有多條亂數流共用同一批數字、只是換了角色。
 * 這裡改成把流編號混進雜湊，流數再多也不會互相汙染。
 */

/** 亂數流編號。每個用途一條，彼此獨立。 */
export const STREAM = {
  VARIANT: 0,
  HEIGHT: 1,
  WIDTH: 2,
  DEPTH: 3,
  ROTATION: 4,
  PALETTE: 5,
  HUE: 6,
  SATURATION: 7,
  LIGHTNESS: 8,
  FACADE_RHYTHM: 9,
  FACADE_PHASE: 10,
  FACADE_MATERIAL: 11,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

/**
 * 四輸入雜湊，回傳 [0, 1)。
 *
 * 用 Math.imul 而不是 `*`：JavaScript 的 `*` 在乘積超過 2^53 時會失去精度，
 * `(a * b) | 0` 得到的並不是正確的 32 位元乘法結果。
 */
export function hashCell(x: number, y: number, seedByte: number, stream: number): number {
  let h = (x * 374761393 + y * 668265263 + seedByte * 1442695041 + stream * 2246822519 + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 11), 2246822519) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 這一格該用哪一個變體。variantCount 為 0 時回傳 0，不回傳 NaN。 */
export function variantIndexOf(
  x: number, y: number, seedByte: number, variantCount: number,
): number {
  if (variantCount <= 0) return 0;
  return Math.floor(hashCell(x, y, seedByte, STREAM.VARIANT) * variantCount) % variantCount;
}

export interface AppearanceInput {
  x: number;
  y: number;
  zoneType: number;
  level: number;
  /** 建築的身分證。第四階段之前一律傳 0。 */
  seedByte: number;
  /** 這個 (分區, 等級) 桶有幾個變體。 */
  variantCount: number;
  /** 這個分區的色盤長度。 */
  paletteSize: number;
}

export interface Appearance {
  variantIndex: number;
  /** 0.85 ~ 1.15 */
  widthScale: number;
  /** 0.85 ~ 1.15 */
  depthScale: number;
  /** 0.825 ~ 1.175，套在分區高度表算出的基準高度上 */
  heightScale: number;
  /** 0 ~ 3，四分之一圈 */
  rotationQuarter: number;
  paletteIndex: number;
  /** -0.015 ~ 0.015 */
  hueShift: number;
  /** -0.05 ~ 0.05 */
  satShift: number;
  /** -0.05 ~ 0.05 */
  lightShift: number;
  /** 交給 shader 的 aSeed：節奏、相位、材質偏好。 */
  facadeSeed: readonly [number, number, number];
}

/**
 * 這些數值範圍刻意與重構前的 BuildingRenderer.setInstanceData 一致，
 * 好讓這個 task 只搬家、不改外觀。
 */
export function appearanceOf(input: AppearanceInput): Appearance {
  const { x, y, seedByte, variantCount, paletteSize } = input;
  const at = (s: number) => hashCell(x, y, seedByte, s);

  return {
    variantIndex: variantIndexOf(x, y, seedByte, variantCount),
    widthScale: 0.85 + at(STREAM.WIDTH) * 0.3,
    depthScale: 0.85 + at(STREAM.DEPTH) * 0.3,
    heightScale: 1.0 + (at(STREAM.HEIGHT) - 0.5) * 0.35,
    rotationQuarter: Math.floor(at(STREAM.ROTATION) * 4) % 4,
    paletteIndex: paletteSize > 0
      ? Math.floor(at(STREAM.PALETTE) * paletteSize) % paletteSize
      : 0,
    hueShift: (at(STREAM.HUE) - 0.5) * 0.03,
    satShift: (at(STREAM.SATURATION) - 0.5) * 0.1,
    lightShift: (at(STREAM.LIGHTNESS) - 0.5) * 0.1,
    facadeSeed: [
      at(STREAM.FACADE_RHYTHM),
      at(STREAM.FACADE_PHASE),
      at(STREAM.FACADE_MATERIAL),
    ],
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingAppearance.test.ts`
Expected: PASS，13 個案例

若「should give a different value for each stream of the same cell」失敗，表示雜湊的雪崩不足；把 `hashCell` 第二輪的乘數 `2246822519` 換成 `2654435761` 再跑一次。不要改測試。

- [ ] **Step 5: 確認測試有鑑別力**

把 `hashCell` 的 `stream * 2246822519 +` 這一項暫時刪掉，重跑。
Expected: 「should not share any stream value between cells 100 apart」與「different value for each stream」轉紅。
確認之後把那一項改回來，重跑確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/BuildingAppearance.ts src/renderer/__tests__/BuildingAppearance.test.ts
git commit -m "feat(renderer): one source of building appearance randomness

The old scheme made extra random streams by offsetting the inputs, so
hash(x+100, y+100) at (0,0) is the same number as hash(x, y) at (100,100):
two cells 100 apart on the diagonal shared most of their streams, just in
different roles. Mixing a stream id into the hash removes the whole class.

Pure module, no Three.js, so the showcase and the game share it."
```

---

## Task 2: 零件標籤與門檻

**Files:**
- Create: `src/renderer/geometry/buildings/parts.ts`
- Test: `src/renderer/__tests__/BuildingParts.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces: `PART_WALL`、`PART_DETAIL`、`PART_FOLIAGE`、`PART_ROOF`（number）、`PART_THRESHOLDS`（物件）、`tagPart(geo, part)`、`ZONE_CAT`、`stampZoneCategory(geo, cat)`。

**背景：** shader 判定窗戶的條件是「標籤 = `PART_WALL` 且 `|n.y| < 0.3` 且 `y > 0.06`」，所以第三階段要加的水塔、冷氣機、天線會被畫上窗戶。這裡先開出 `PART_DETAIL` 這個號碼段，並且把「標籤數值」與「shader 門檻」放在同一個檔案，避免兩邊各自漂移。

現行數值（`BuildingRenderer.ts:23-25`）：`PART_WALL = 0.0`、`PART_FOLIAGE = 0.5`、`PART_ROOF = 1.0`。shader 的判定是 `isFoliage = vPartType > 0.35 && vPartType < 0.65`、`isRoof = vPartType > 0.8 || (n.y > 0.85 && vPartType < 0.1)`。`PART_DETAIL` 取 **0.2**：不在 foliage 區間、不大於 0.8、也不小於 0.1，所以不會被法線規則誤判成屋頂。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingParts.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_ROOF, PART_THRESHOLDS,
  tagPart, ZONE_CAT, stampZoneCategory,
} from '../geometry/buildings/parts';
import { ZoneType } from '../../core/grid/types';

/**
 * 零件標籤是頂點色的 R 通道，shader 用門檻把它切成四段。標籤與門檻分屬
 * 兩個檔案時，改了一邊忘了另一邊不會有任何東西報錯 —— 屋頂物件被畫上
 * 窗戶就是這樣來的。這裡把兩者放在一起，並且斷言它們一致。
 */
describe('part tags sit in the buckets the shader cuts', () => {
  it('should keep every tag distinct', () => {
    const tags = [PART_WALL, PART_DETAIL, PART_FOLIAGE, PART_ROOF];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('should classify wall as wall', () => {
    expect(PART_WALL).toBeLessThan(PART_THRESHOLDS.ROOF_BY_NORMAL);
  });

  it('should keep detail out of every other bucket', () => {
    // 高於「法線可判定為屋頂」的上限，所以水平面的細節不會變成屋頂；
    // 低於植栽下限，所以不會被上成綠色；遠低於屋頂下限。
    expect(PART_DETAIL).toBeGreaterThan(PART_THRESHOLDS.ROOF_BY_NORMAL);
    expect(PART_DETAIL).toBeLessThan(PART_THRESHOLDS.FOLIAGE_MIN);
    expect(PART_DETAIL).toBeLessThan(PART_THRESHOLDS.ROOF_MIN);
  });

  it('should classify foliage as foliage', () => {
    expect(PART_FOLIAGE).toBeGreaterThan(PART_THRESHOLDS.FOLIAGE_MIN);
    expect(PART_FOLIAGE).toBeLessThan(PART_THRESHOLDS.FOLIAGE_MAX);
  });

  it('should classify roof as roof', () => {
    expect(PART_ROOF).toBeGreaterThan(PART_THRESHOLDS.ROOF_MIN);
  });
});

describe('tagPart', () => {
  it('should write the tag on every vertex', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_DETAIL);
    const attr = geo.getAttribute('color');
    expect(attr.count).toBe(geo.getAttribute('position').count);
    for (let i = 0; i < attr.count; i++) {
      expect(attr.getX(i)).toBeCloseTo(PART_DETAIL, 6);
    }
  });

  it('should leave the zone channel at zero for stampZoneCategory to fill', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_WALL);
    const attr = geo.getAttribute('color');
    for (let i = 0; i < attr.count; i++) expect(attr.getY(i)).toBe(0);
  });
});

describe('stampZoneCategory', () => {
  it('should write the category on every vertex without touching the part tag', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    tagPart(geo, PART_ROOF);
    stampZoneCategory(geo, ZONE_CAT[ZoneType.INDUSTRIAL]!);
    const attr = geo.getAttribute('color');
    for (let i = 0; i < attr.count; i++) {
      expect(attr.getX(i)).toBeCloseTo(PART_ROOF, 6);
      expect(attr.getY(i)).toBeCloseTo(ZONE_CAT[ZoneType.INDUSTRIAL]!, 6);
    }
  });

  it('should give every zone type a distinct category', () => {
    const cats = Object.values(ZONE_CAT);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingParts.test.ts`
Expected: FAIL — 無法解析 `../geometry/buildings/parts`

- [ ] **Step 3: 寫最小實作**

建立 `src/renderer/geometry/buildings/parts.ts`。內容從 `BuildingRenderer.ts:21-54` 搬過來，加上 `PART_DETAIL` 與 `PART_THRESHOLDS`：

```ts
import * as THREE from 'three';
import { ZoneType } from '../../../core/grid/types';

/**
 * 零件類型寫在頂點色的 R 通道，分區類別寫在 G 通道，B 保留。
 *
 * 門檻與標籤值放在同一個檔案，是因為 shader 的判斷式是用這些數字組出來的
 * （見 BuildingMaterial.ts）。分開放的話，改了一邊不會有任何東西報錯。
 */
export const PART_WALL = 0.0;
/** 金屬／深色細節：水塔、冷氣機、天線、管架。不畫窗戶。 */
export const PART_DETAIL = 0.2;
export const PART_FOLIAGE = 0.5;
export const PART_ROOF = 1.0;

/** shader 用來把 R 通道切成四段的門檻。 */
export const PART_THRESHOLDS = {
  /** 低於此值且法線朝上者視為屋頂（讓平頂不必特別標記）。 */
  ROOF_BY_NORMAL: 0.1,
  FOLIAGE_MIN: 0.35,
  FOLIAGE_MAX: 0.65,
  ROOF_MIN: 0.8,
} as const;

export function tagPart(geo: THREE.BufferGeometry, part: number): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = part;
    arr[i * 3 + 1] = 0; // 分區稍後由 stampZoneCategory 填
    arr[i * 3 + 2] = 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** 分區類別常數（寫在頂點色 G 通道）。 */
export const ZONE_CAT: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]:  0.0,
  [ZoneType.RESIDENTIAL_HIGH]: 0.2,
  [ZoneType.COMMERCIAL_LOW]:   0.4,
  [ZoneType.COMMERCIAL_HIGH]:  0.6,
  [ZoneType.INDUSTRIAL]:       0.8,
  [ZoneType.OFFICE]:           1.0,
};

export function stampZoneCategory(geo: THREE.BufferGeometry, cat: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 1] = cat;
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingParts.test.ts`
Expected: PASS，9 個案例

- [ ] **Step 5: 確認測試有鑑別力**

把 `PART_DETAIL` 暫時改成 `0.5`，重跑。
Expected: 「should keep every tag distinct」與「should keep detail out of every other bucket」轉紅。改回 `0.2`，重跑確認全綠。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/geometry/buildings/parts.ts src/renderer/__tests__/BuildingParts.test.ts
git commit -m "feat(renderer): a part tag for detail that must not grow windows

The shader paints windows on anything tagged WALL whose normal is roughly
vertical, so the rooftop water tanks and AC units of a later phase would
have arrived covered in them. PART_DETAIL opens a number band for those.

The tag values and the thresholds the shader cuts them with now live in
one file, because changing one without the other fails silently."
```

---

## Task 3: shader 與材質搬家

**Files:**
- Create: `src/renderer/BuildingMaterial.ts`
- Modify: `src/renderer/BuildingRenderer.ts`（刪除 135-625 行的 shader 與材質，改為 import）
- Test: `src/renderer/__tests__/BuildingMaterial.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `PART_THRESHOLDS`。
- Produces: `BUILDING_VERT`、`BUILDING_FRAG`（string）、`getBuildingMaterial(): THREE.ShaderMaterial`、`resetBuildingMaterial(): void`（測試用，清掉 singleton）。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingMaterial.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  BUILDING_VERT, BUILDING_FRAG, getBuildingMaterial, resetBuildingMaterial,
} from '../BuildingMaterial';
import { PART_THRESHOLDS } from '../geometry/buildings/parts';

/**
 * GLSL 本身測不了，但「TS 常數有沒有真的進到 GLSL 裡」測得了 —— 而那正是
 * 兩邊會漂移的地方。
 */
describe('the shader uses the thresholds the parts module defines', () => {
  it('should carry every threshold value into the fragment source', () => {
    for (const v of Object.values(PART_THRESHOLDS)) {
      expect(BUILDING_FRAG).toContain(String(v));
    }
  });

  it('should declare the attributes the renderer writes', () => {
    expect(BUILDING_VERT).toContain('attribute float aHighlight;');
    expect(BUILDING_VERT).toContain('attribute vec3 aHighlightColor;');
    expect(BUILDING_VERT).toContain('attribute float aOccupancy;');
  });
});

describe('getBuildingMaterial', () => {
  it('should return the same instance every time', () => {
    resetBuildingMaterial();
    expect(getBuildingMaterial()).toBe(getBuildingMaterial());
  });

  it('should expose the uniforms the renderer drives', () => {
    resetBuildingMaterial();
    const m = getBuildingMaterial();
    expect(m.uniforms.uGlobalOpacity).toBeDefined();
    expect(m.uniforms.uDesaturate).toBeDefined();
    expect(m.uniforms.uTime).toBeDefined();
    expect(m.lights).toBe(true);
    expect(m.vertexColors).toBe(true);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: FAIL — 無法解析 `../BuildingMaterial`

- [ ] **Step 3: 搬家**

建立 `src/renderer/BuildingMaterial.ts`，把 `BuildingRenderer.ts` 的 `BUILDING_VERT`（135-189 行）、`BUILDING_FRAG`（191-601 行）、`createBuildingMaterial`、`getBuildingMaterial`（603-625 行）整段搬過去，開頭加上：

```ts
import * as THREE from 'three';
import { PART_THRESHOLDS } from './geometry/buildings/parts';
```

接著把 `BUILDING_FRAG` 裡三處寫死的門檻改成插值。原本是：

```glsl
  bool isFoliage = vPartType > 0.35 && vPartType < 0.65;
  bool isRoof = vPartType > 0.8 || (n.y > 0.85 && vPartType < 0.1);
```

改成（注意 `BUILDING_FRAG` 要用樣板字串，原本就是）：

```glsl
  bool isFoliage = vPartType > ${PART_THRESHOLDS.FOLIAGE_MIN} && vPartType < ${PART_THRESHOLDS.FOLIAGE_MAX};
  bool isRoof = vPartType > ${PART_THRESHOLDS.ROOF_MIN} || (n.y > 0.85 && vPartType < ${PART_THRESHOLDS.ROOF_BY_NORMAL});
```

GLSL 需要小數點才會當成 float。`0.1`、`0.35`、`0.65`、`0.8` 在 JS 轉字串後都保有小數點，所以直接插值是安全的；但為了不依賴這個巧合，在檔案頂端加一個轉換函式並用它包住每個插值：

```ts
/** 把 TS 數字寫成 GLSL 一定會當作 float 的形式（0.8 而不是 8e-1，1 而不是 1）。 */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}
```

插值改用 `${glslFloat(PART_THRESHOLDS.FOLIAGE_MIN)}`，其餘同理。

最後在檔案末端加上：

```ts
/** 測試用：清掉 singleton，讓下一次 getBuildingMaterial 重新建立。 */
export function resetBuildingMaterial(): void {
  _buildingMaterial = null;
}
```

在 `BuildingRenderer.ts` 刪除搬走的整段，改成：

```ts
import { getBuildingMaterial } from './BuildingMaterial';
```

並刪除 `BuildingRenderer.ts` 頂端因搬家而不再使用的 import（`THREE.UniformsUtils` 等若已無其他用途）。

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: PASS，4 個案例

- [ ] **Step 5: 確認沒有回歸**

Run: `npx vitest run src/renderer src/core/simulation`
Expected: 全綠

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 6: Commit**

```bash
git add src/renderer/BuildingMaterial.ts src/renderer/BuildingRenderer.ts src/renderer/__tests__/BuildingMaterial.test.ts
git commit -m "refactor(renderer): move the building shader out of the renderer

BuildingRenderer was 3670 lines of three unrelated jobs. The shader is the
first one out, and it now builds its part-type thresholds from the same TS
constants the geometry tags itself with, so the two cannot drift."
```

---

## Task 4: 變體註冊表

**Files:**
- Create: `src/renderer/geometry/buildings/registry.ts`
- Modify: `src/renderer/BuildingRenderer.ts`（刪除 627-896 行的幾何 builder 與 `VARIANTS`，改為 import）
- Test: `src/renderer/__tests__/BuildingRegistry.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `tagPart`、`PART_*`。
- Produces: `type GeoBuilder = () => THREE.BufferGeometry`、`getVariants(zoneType: number, level: number): GeoBuilder[]`、`ZONE_TYPES: number[]`、`LEVELS: readonly [1, 2, 3]`、`TRIANGLE_BUDGET`。

**背景：** 這是展示區與遊戲共同消費的介面。`level` 參數現在收下但不使用（每個等級回傳同一份清單）—— 第二階段才會依等級分流。**先把參數開出來**，展示區與渲染層才不用在第二階段再改一次呼叫端。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingRegistry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getVariants, ZONE_TYPES, LEVELS, TRIANGLE_BUDGET } from '../geometry/buildings/registry';
import { PART_THRESHOLDS } from '../geometry/buildings/parts';
import { ZoneType } from '../../core/grid/types';

/**
 * 幾何是手寫的，所以最容易出的錯是「某個零件忘了標記」與「不小心長到格子外面」。
 * 前者會讓那個面被 shader 當成牆去畫窗戶；後者會讓建築吃進鄰格或馬路。
 * 這兩件事在畫面上都不明顯，但在測試裡很好抓。
 */
describe('getVariants', () => {
  it('should give every zone at every level at least one variant', () => {
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(getVariants(zone, level).length,
          `zone ${zone} level ${level} has no variant`).toBeGreaterThan(0);
      }
    }
  });

  it('should return an empty list for a zone that has no buildings', () => {
    expect(getVariants(ZoneType.NONE, 1)).toEqual([]);
  });
});

describe('every variant geometry', () => {
  const all = ZONE_TYPES.flatMap(zone =>
    getVariants(zone, 1).map((build, i) => ({ zone, i, geo: build() })));

  it('should tag every vertex with a known part', () => {
    const known = [0.0, 0.2, 0.5, 1.0];
    for (const { zone, i, geo } of all) {
      const attr = geo.getAttribute('color');
      expect(attr, `zone ${zone} variant ${i} has no color attribute`).toBeDefined();
      for (let v = 0; v < attr.count; v++) {
        const tag = attr.getX(v);
        expect(known.some(k => Math.abs(k - tag) < 1e-6),
          `zone ${zone} variant ${i} vertex ${v} has unknown part tag ${tag}`).toBe(true);
      }
    }
  });

  it('should stay inside its own cell', () => {
    // 建築放在格子中心，縮放最大 1.15 倍，所以未縮放的包圍盒半徑上限是
    // 0.5 / 1.15 = 0.4347。超過就會吃到鄰格。
    const limit = 0.5 / 1.15;
    for (const { zone, i, geo } of all) {
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)),
        `zone ${zone} variant ${i} overflows in x`).toBeLessThanOrEqual(limit);
      expect(Math.max(Math.abs(b.min.z), Math.abs(b.max.z)),
        `zone ${zone} variant ${i} overflows in z`).toBeLessThanOrEqual(limit);
    }
  });

  it('should sit on the ground, not under it', () => {
    for (const { zone, i, geo } of all) {
      geo.computeBoundingBox();
      expect(geo.boundingBox!.min.y,
        `zone ${zone} variant ${i} dips below ground`).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it('should stay inside the triangle budget', () => {
    for (const { zone, i, geo } of all) {
      const tris = geo.getAttribute('position').count / 3;
      expect(tris, `zone ${zone} variant ${i} is ${tris} triangles`)
        .toBeLessThanOrEqual(TRIANGLE_BUDGET.TOWER);
    }
  });

  it('should not use the detail tag before the phase that introduces it', () => {
    // 這條是提醒，不是限制：第三階段加屋頂物件時把它刪掉。
    for (const { geo } of all) {
      const attr = geo.getAttribute('color');
      for (let v = 0; v < attr.count; v++) {
        expect(Math.abs(attr.getX(v) - 0.2)).toBeGreaterThan(1e-6);
      }
    }
  });

  it('should keep the foliage tag inside the shader foliage band', () => {
    for (const { geo } of all) {
      const attr = geo.getAttribute('color');
      for (let v = 0; v < attr.count; v++) {
        const tag = attr.getX(v);
        if (Math.abs(tag - 0.5) < 1e-6) {
          expect(tag).toBeGreaterThan(PART_THRESHOLDS.FOLIAGE_MIN);
          expect(tag).toBeLessThan(PART_THRESHOLDS.FOLIAGE_MAX);
        }
      }
    }
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingRegistry.test.ts`
Expected: FAIL — 無法解析 `../geometry/buildings/registry`

- [ ] **Step 3: 搬家並加上介面**

建立 `src/renderer/geometry/buildings/registry.ts`。把 `BuildingRenderer.ts:627-896` 的所有 `makeXxx()` 函式與 `VARIANTS` 整段搬過去，`tagPart` / `PART_*` 改為從 `./parts` import，並在檔尾加上：

```ts
export type GeoBuilder = () => THREE.BufferGeometry;

/** 有建築的分區。ZoneType.NONE 不在內。 */
export const ZONE_TYPES: number[] = Object.keys(VARIANTS).map(Number);

export const LEVELS = [1, 2, 3] as const;

/** 三角形上限。展示區的計數器照這兩條線標示。 */
export const TRIANGLE_BUDGET = {
  HOUSE: 400,
  TOWER: 800,
} as const;

/**
 * 這個 (分區, 等級) 桶的變體清單。
 *
 * `level` 目前收下但不使用 —— 每個等級回傳同一份清單。第二階段會讓
 * (分區, 等級) 各有自己的一組變體；先把參數開出來，呼叫端就不必再改一次。
 */
export function getVariants(zoneType: number, level: number): GeoBuilder[] {
  void level;
  return VARIANTS[zoneType] ?? [];
}
```

在 `BuildingRenderer.ts` 刪除搬走的整段，改成：

```ts
import { getVariants, ZONE_TYPES, type GeoBuilder } from './geometry/buildings/registry';
import { tagPart, stampZoneCategory, ZONE_CAT, PART_WALL, PART_FOLIAGE, PART_ROOF } from './geometry/buildings/parts';
```

（`tagPart` / `PART_*` 若 `BuildingRenderer.ts` 已無其他用途就不要 import，讓 tsc 抓出來。）

`initVariantMeshes` 原本走訪 `Object.keys(VARIANTS)`，改為走訪 `ZONE_TYPES` 並用 `getVariants(zoneType, 1)`。`addBuilding` 原本 `const variants = VARIANTS[zoneType]`，改為 `const variants = getVariants(zoneType, level)`。

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingRegistry.test.ts`
Expected: PASS，8 個案例

**若「should stay inside its own cell」有變體失敗**：那是既有幾何真的超出格子，不是測試錯。把失敗的變體記進 `BUGS.md`，並在該變體的幾何裡把超出的零件往內收到 0.43 以內。不要放寬測試的界線。

- [ ] **Step 5: 確認沒有回歸**

Run: `npx vitest run src/renderer src/core`
Expected: 全綠

Run: `npx tsc --noEmit`
Expected: 無輸出

- [ ] **Step 6: Commit**

```bash
git add src/renderer/geometry/buildings/registry.ts src/renderer/BuildingRenderer.ts src/renderer/__tests__/BuildingRegistry.test.ts
git commit -m "refactor(renderer): building geometry gets its own module and an interface

getVariants(zoneType, level) is the seam the showcase consumes and the
parametric generator will fill in. The level argument is accepted and
ignored for now so no caller has to change again later.

The move came with the first tests these geometries have ever had: every
vertex carries a known part tag, nothing overflows its cell, nothing dips
below ground, nothing exceeds the triangle budget."
```

---

## Task 5: 渲染層改用外觀模組

**Files:**
- Modify: `src/renderer/BuildingRenderer.ts:1000-1145`（`addBuilding` 與 `setInstanceData`）
- Test: `src/renderer/__tests__/BuildingInstanceSeed.test.ts`（本 task 建立，Task 9 再擴充）

**Interfaces:**
- Consumes: Task 1 的 `appearanceOf`、Task 4 的 `getVariants`。
- Produces: `BuildingRenderer` 的行為不變，但外觀改由 `appearanceOf` 決定。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/renderer/__tests__/BuildingInstanceSeed.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingRenderer } from '../BuildingRenderer';
import { appearanceOf } from '../BuildingAppearance';
import { getVariants } from '../geometry/buildings/registry';
import { ZoneType } from '../../core/grid/types';

/**
 * InstancedMesh 的移除是 swap-with-last，所以每次移除都在搬動別人的索引。
 * 桶的數量在第二階段會從 17 成長到 144，索引搬錯的機會跟著變多，而畫面上
 * 只會表現成「某棟樓忽然變成別的樣子」，很難追。這裡把不變式釘住。
 */
const ZONE = ZoneType.RESIDENTIAL_LOW;

function bucketOf(x: number, y: number): { key: string; variantIndex: number } {
  const variants = getVariants(ZONE, 1);
  const app = appearanceOf({
    x, y, zoneType: ZONE, level: 1, seedByte: 0,
    variantCount: variants.length, paletteSize: 1,
  });
  return { key: `${ZONE}_${app.variantIndex}`, variantIndex: app.variantIndex };
}

describe('instance bookkeeping', () => {
  it('should put a building in the bucket appearanceOf names', () => {
    const scene = new THREE.Scene();
    const r = new BuildingRenderer();
    r.build(scene, { width: 0, height: 0, forEachCell: () => {} } as never);

    r.addBuilding(3, 4, ZONE, 1, false);
    const entry = (r as unknown as {
      positionToInstance: Map<string, { key: string; idx: number }>;
    }).positionToInstance.get('3,4');

    expect(entry).toBeDefined();
    expect(entry!.key).toBe(bucketOf(3, 4).key);
  });

  it('should keep every surviving building pointing at its own matrix', () => {
    const scene = new THREE.Scene();
    const r = new BuildingRenderer();
    r.build(scene, { width: 0, height: 0, forEachCell: () => {} } as never);

    const alive: Array<[number, number]> = [];
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        r.addBuilding(x, y, ZONE, 1, false);
        alive.push([x, y]);
      }
    }
    // 移除三分之一，逼出 swap-with-last
    for (let i = alive.length - 1; i >= 0; i -= 3) {
      const [x, y] = alive[i]!;
      r.removeBuilding(x, y);
      alive.splice(i, 1);
    }

    const internals = r as unknown as {
      positionToInstance: Map<string, { key: string; idx: number }>;
      variantMeshes: Map<string, THREE.InstancedMesh>;
    };
    const m = new THREE.Matrix4();
    for (const [x, y] of alive) {
      const entry = internals.positionToInstance.get(`${x},${y}`)!;
      expect(entry, `no instance for ${x},${y}`).toBeDefined();
      internals.variantMeshes.get(entry.key)!.getMatrixAt(entry.idx, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.x, `instance for ${x},${y} sits at ${p.x},${p.z}`).toBeCloseTo(x, 5);
      expect(p.z).toBeCloseTo(y, 5);
    }
  });
});
```

- [ ] **Step 2: 執行測試確認失敗或通過**

Run: `npx vitest run src/renderer/__tests__/BuildingInstanceSeed.test.ts`

第一個案例會失敗（`addBuilding` 目前用舊的 `hash`，桶名不見得對得上 `appearanceOf`）。
第二個案例應該會通過 —— 它釘的是既有的正確行為，作為第二階段改容量配置時的護欄。若它一開始就失敗，代表既有的 swap-with-last 有 bug：**記進 `BUGS.md` 與 `TODO.md`，先修它，再繼續。**

- [ ] **Step 3: 改用 appearanceOf**

在 `BuildingRenderer.ts` 頂端加入：

```ts
import { appearanceOf } from './BuildingAppearance';
```

刪除 `BuildingRenderer.ts:15-19` 的 `hash` 函式。

`addBuilding` 的變體挑選（原 1004 行）改為：

```ts
    const variants = getVariants(zoneType, level);
    if (variants.length === 0) return;

    const palette = ZONE_PALETTES[zoneType] ?? [0x888888];
    const app = appearanceOf({
      x, y, zoneType, level, seedByte: 0,
      variantCount: variants.length, paletteSize: palette.length,
    });
    const key = `${zoneType}_${app.variantIndex}`;
```

`setInstanceData` 的整段亂數（原 1101-1133 行）改為：

```ts
    const palette = ZONE_PALETTES[zoneType] ?? [0x888888];
    const app = appearanceOf({
      x, y, zoneType, level, seedByte: 0,
      variantCount: getVariants(zoneType, level).length,
      paletteSize: palette.length,
    });

    const heightRange = ZONE_HEIGHTS[zoneType] ?? { min: 0.3, max: 1.0 };
    const levelFactor = level / 3;
    const baseHeight = heightRange.min + (heightRange.max - heightRange.min) * levelFactor;
    const finalHeight = baseHeight * app.heightScale;

    this._rotation.makeRotationY((app.rotationQuarter * Math.PI) / 2);
    this._scale.makeScale(app.widthScale, finalHeight, app.depthScale);
    this._matrix.multiplyMatrices(this._scale, this._rotation);
    this._matrix.setPosition(x, 0.05, y);
    mesh.setMatrixAt(idx, this._matrix);

    if (burned) {
      const burnLightness = 0.08 + app.facadeSeed[0] * 0.07;
      this._color.setHSL(0.05, 0.1, burnLightness);
    } else {
      this._color.set(palette[app.paletteIndex]!);
      const hsl = { h: 0, s: 0, l: 0 };
      this._color.getHSL(hsl);
      hsl.h += app.hueShift;
      hsl.s = Math.max(0.05, Math.min(0.6, hsl.s + app.satShift));
      hsl.l = Math.max(0.3, Math.min(0.85, hsl.l + app.lightShift));
      this._color.setHSL(hsl.h, hsl.s, hsl.l);
    }
    mesh.setColorAt(idx, this._color);
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingInstanceSeed.test.ts`
Expected: PASS，2 個案例

- [ ] **Step 5: 確認沒有回歸**

Run: `npx vitest run`
Expected: 292 檔全綠（測試數會比 4230 多出本計畫新增的部分）

Run: `npx tsc --noEmit` → 無輸出
Run: `npx vite build` → 產出 `dist/`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/BuildingRenderer.ts src/renderer/__tests__/BuildingInstanceSeed.test.ts
git commit -m "refactor(renderer): buildings take their look from BuildingAppearance

Same ranges, same look -- this only moves where the randomness comes from,
so the offset-input hash and its diagonal correlation are now gone from
the renderer entirely.

The swap-with-last invariant now has a test: after removing a third of a
144-building block, every survivor still points at a matrix positioned at
its own cell. That is the failure the next phase is most likely to cause."
```

---

## Task 6: Vite 多入口與展示區骨架

**Files:**
- Create: `showcase.html`、`src/showcase/main.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `SceneManager`（`src/renderer/SceneManager.ts`，建構子吃 `HTMLElement`，公開 `.scene` / `.camera` / `.renderer` / `.onUpdate(cb)` / `.start()` / `.orbitCamera(dAngle, dElev)` / `.zoomCamera(delta)`）、Task 3 的 `getBuildingMaterial`、Task 4 的 `getVariants`。
- Produces: `/showcase.html` 這個開發頁面。

**背景：** 重用 `SceneManager` 而不是自己建 renderer 與燈光，是「展示區必須使用正式那一份」這條約束的具體落實 —— 燈光、相機、色調全部與遊戲相同。

- [ ] **Step 1: 建立 HTML 入口**

建立 `showcase.html`：

```html
<!DOCTYPE html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebCity — 建築展示區</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #1a1d21; }
      #scene { position: absolute; inset: 0; }
      #panel {
        position: absolute; top: 12px; left: 12px; z-index: 10;
        background: rgba(20, 22, 26, 0.88); color: #e8e8e8;
        font: 13px/1.5 system-ui, sans-serif; padding: 12px 14px;
        border-radius: 8px; min-width: 240px;
      }
      #panel label { display: block; margin: 6px 0 2px; opacity: 0.75; }
      #panel select, #panel input { width: 100%; }
      #stats { margin-top: 10px; font-variant-numeric: tabular-nums; opacity: 0.9; }
      #stats .over { color: #ff8080; }
    </style>
  </head>
  <body>
    <div id="scene"></div>
    <div id="panel"></div>
    <script type="module" src="/src/showcase/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: 掛上第二個 rollup 入口**

修改 `vite.config.ts`，在 `defineConfig({...})` 內加入（放在 `server` 之後）：

```ts
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        showcase: path.resolve(__dirname, 'showcase.html'),
      },
    },
  },
```

- [ ] **Step 3: 寫展示區骨架**

建立 `src/showcase/main.ts`：

```ts
/**
 * 建築展示區 —— 不載入遊戲：沒有模擬、沒有 worker、沒有 UI 面板。
 *
 * 它刻意使用正式的 SceneManager、正式的材質與正式的變體註冊表。
 * 在這裡調到滿意的東西，進遊戲必須長得一模一樣，否則展示區沒有價值。
 */
import * as THREE from 'three';
import { SceneManager } from '../renderer/SceneManager';
import { getBuildingMaterial } from '../renderer/BuildingMaterial';
import { getVariants } from '../renderer/geometry/buildings/registry';
import { stampZoneCategory, ZONE_CAT } from '../renderer/geometry/buildings/parts';
import { ZoneType } from '../core/grid/types';

const container = document.getElementById('scene')!;
const sceneManager = new SceneManager(container);

/** 展示用地面，讓建築不是浮在虛空中。 */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshLambertMaterial({ color: 0x3a4a3a }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
sceneManager.scene.add(ground);

const shown: THREE.Object3D[] = [];

function clear(): void {
  for (const o of shown) {
    sceneManager.scene.remove(o);
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  }
  shown.length = 0;
}

/** 放一棟建築在 (x, z)。回傳它的三角形數。 */
export function place(zoneType: number, level: number, variantIndex: number, x: number, z: number): number {
  const variants = getVariants(zoneType, level);
  if (variants.length === 0) return 0;
  const geo = variants[variantIndex % variants.length]!();
  stampZoneCategory(geo, ZONE_CAT[zoneType] ?? 0);

  const mesh = new THREE.Mesh(geo, getBuildingMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(x, 0.05, z);
  sceneManager.scene.add(mesh);
  shown.push(mesh);
  return geo.getAttribute('position').count / 3;
}

// 骨架先擺一棟，證明整條路是通的
clear();
place(ZoneType.RESIDENTIAL_LOW, 1, 0, 0, 0);

const material = getBuildingMaterial();
let elapsed = 0;
sceneManager.onUpdate((dt) => {
  elapsed += dt;
  material.uniforms.uTime!.value = elapsed;
});
sceneManager.start();

document.getElementById('panel')!.textContent = '建築展示區 — 骨架';
```

- [ ] **Step 4: 人工驗證**

Run: `node node_modules/vite/bin/vite.js --port 5180 --strictPort`
開 `http://localhost:5180/showcase.html`

Expected：畫面上有一塊地面與一棟住宅低密度建築，能用滑鼠轉動視角（`SceneManager` 的既有輸入不含滑鼠事件，所以此時無法轉動 —— 這是預期的，Task 8 才加控制項）。Console 沒有錯誤。

Run: `npx vite build`
Expected: `dist/` 同時產出 `index.html` 與 `showcase.html`

- [ ] **Step 5: Commit**

```bash
git add showcase.html src/showcase/main.ts vite.config.ts
git commit -m "feat(showcase): a second Vite entry that shows the real buildings

It reuses SceneManager, the real material and the real variant registry,
so lighting, camera and geometry are identical to the game. Anything tuned
here is what ships; that is the whole point of having it."
```

---

## Task 7: 三種檢視模式與重複度指標

**Files:**
- Create: `src/showcase/views.ts`
- Modify: `src/showcase/main.ts`
- Test: `src/showcase/__tests__/NeighbourSameRatio.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `appearanceOf`、Task 4 的 `getVariants` / `ZONE_TYPES` / `LEVELS`。
- Produces: `type ViewMode = 'single' | 'block' | 'matrix'`、`blockCells(zoneType, level, size): PlacedCell[]`、`matrixCells(): PlacedCell[]`、`neighbourSameRatio(cells: PlacedCell[]): number`、`interface PlacedCell { x: number; z: number; zoneType: number; level: number; variantIndex: number; facadeSeed: readonly [number, number, number] }`。

**背景：** 驗收條件是「街廓模式中相鄰兩棟外觀完全相同的比例低於 5%」。把它寫成純函式，這個條件才是機器可檢查的，而不是憑感覺。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/showcase/__tests__/NeighbourSameRatio.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { blockCells, matrixCells, neighbourSameRatio } from '../views';
import { ZoneType } from '../../core/grid/types';
import { ZONE_TYPES, LEVELS } from '../../renderer/geometry/buildings/registry';

/**
 * 「看起來很重複」是主觀的，但「隔壁那棟跟我一模一樣」不是。這個比例就是
 * 驗收條件 §7.1 的機器可檢查形式。
 */
describe('neighbourSameRatio', () => {
  it('should report 1 when every cell is identical', () => {
    const cells = [
      { x: 0, z: 0, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 0, z: 1, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 1, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(1);
  });

  it('should report 0 when no two neighbours share a variant', () => {
    const cells = [
      { x: 0, z: 0, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, level: 1, variantIndex: 1, facadeSeed: [0.5, 0, 0] as const },
      { x: 0, z: 1, zoneType: 1, level: 1, variantIndex: 2, facadeSeed: [0.7, 0, 0] as const },
      { x: 1, z: 1, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0.9, 0, 0] as const },
    ];
    // (1,1) 與 (1,0)、(0,1) 是鄰居，變體都不同；(0,0) 與 (1,1) 不相鄰
    expect(neighbourSameRatio(cells)).toBe(0);
  });

  it('should count a shared variant as the same even when the facade seed differs', () => {
    // 階段 1 只改立面，剪影不變 —— 這個指標必須看得出剪影還是重複的，
    // 否則階段 2 的成果會被階段 1 的立面變化掩蓋掉。
    const cells = [
      { x: 0, z: 0, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0.1, 0, 0] as const },
      { x: 1, z: 0, zoneType: 1, level: 1, variantIndex: 0, facadeSeed: [0.9, 0, 0] as const },
    ];
    expect(neighbourSameRatio(cells)).toBe(1);
  });

  it('should return 0 for fewer than two cells', () => {
    expect(neighbourSameRatio([])).toBe(0);
  });
});

describe('blockCells', () => {
  it('should fill the requested square', () => {
    expect(blockCells(ZoneType.RESIDENTIAL_LOW, 1, 8)).toHaveLength(64);
  });

  it('should give each cell the appearance its coordinates imply', () => {
    const a = blockCells(ZoneType.RESIDENTIAL_LOW, 1, 8);
    const b = blockCells(ZoneType.RESIDENTIAL_LOW, 1, 8);
    expect(a).toEqual(b);
  });

  it('should report the repetition the current three variants actually give', () => {
    // 階段 1 之前，住宅低密度只有 3 個變體，所以這個比例會遠高於 5%。
    // 這一條是基準紀錄，不是門檻 —— 第二階段完成後改成 toBeLessThan(0.05)。
    const ratio = neighbourSameRatio(blockCells(ZoneType.RESIDENTIAL_LOW, 1, 8));
    expect(ratio).toBeGreaterThan(0.05);
  });
});

describe('matrixCells', () => {
  it('should include every zone at every level', () => {
    const cells = matrixCells();
    for (const zone of ZONE_TYPES) {
      for (const level of LEVELS) {
        expect(cells.some(c => c.zoneType === zone && c.level === level),
          `matrix is missing zone ${zone} level ${level}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/showcase/__tests__/NeighbourSameRatio.test.ts`
Expected: FAIL — 無法解析 `../views`

**注意：** `vitest.config.ts` 的 `include` 是 `src/**/__tests__/**/*.test.ts`，`src/showcase/__tests__/` 符合，不需要改設定。

- [ ] **Step 3: 寫實作**

建立 `src/showcase/views.ts`：

```ts
/**
 * 展示區的三種檢視。重點是「街廓」：重複感只有在一群建築同時出現時才浮現，
 * 單看一棟房子，三個變體也覺得夠用。
 */
import { appearanceOf } from '../renderer/BuildingAppearance';
import { getVariants, ZONE_TYPES, LEVELS } from '../renderer/geometry/buildings/registry';

export type ViewMode = 'single' | 'block' | 'matrix';

export interface PlacedCell {
  x: number;
  z: number;
  zoneType: number;
  level: number;
  variantIndex: number;
  facadeSeed: readonly [number, number, number];
}

function cellAt(zoneType: number, level: number, x: number, z: number, seedByte = 0): PlacedCell {
  const app = appearanceOf({
    x, y: z, zoneType, level, seedByte,
    variantCount: getVariants(zoneType, level).length,
    paletteSize: 8,
  });
  return { x, z, zoneType, level, variantIndex: app.variantIndex, facadeSeed: app.facadeSeed };
}

/** size x size 的同分區同等級街廓，原點置中。 */
export function blockCells(zoneType: number, level: number, size: number, seedByte = 0): PlacedCell[] {
  const half = Math.floor(size / 2);
  const out: PlacedCell[] = [];
  for (let z = -half; z < size - half; z++) {
    for (let x = -half; x < size - half; x++) {
      out.push(cellAt(zoneType, level, x, z, seedByte));
    }
  }
  return out;
}

/** 每個 (分區, 等級) 的所有變體排成一列，方便一眼掃過所有組合。 */
export function matrixCells(): PlacedCell[] {
  const out: PlacedCell[] = [];
  let row = 0;
  for (const zoneType of ZONE_TYPES) {
    for (const level of LEVELS) {
      const variants = getVariants(zoneType, level);
      for (let i = 0; i < variants.length; i++) {
        out.push({
          x: i * 2, z: row * 2, zoneType, level,
          variantIndex: i, facadeSeed: [0.5, 0.5, 0.5],
        });
      }
      row++;
    }
  }
  return out;
}

/**
 * 四方向相鄰、且變體相同的配對，佔所有相鄰配對的比例。
 *
 * 刻意只看 variantIndex 而不看 facadeSeed：剪影相同才是「看起來重複」的
 * 主因，立面差異蓋不掉它。階段 1 只改立面，所以這個數字在階段 1 不會下降
 * —— 那是正確的，不是指標壞了。
 */
export function neighbourSameRatio(cells: PlacedCell[]): number {
  if (cells.length < 2) return 0;
  const byKey = new Map<string, PlacedCell>();
  for (const c of cells) byKey.set(`${c.x},${c.z}`, c);

  let pairs = 0;
  let same = 0;
  for (const c of cells) {
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      const n = byKey.get(`${c.x + dx},${c.z + dz}`);
      if (!n) continue;
      pairs++;
      if (n.variantIndex === c.variantIndex && n.zoneType === c.zoneType && n.level === c.level) {
        same++;
      }
    }
  }
  return pairs === 0 ? 0 : same / pairs;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/showcase/__tests__/NeighbourSameRatio.test.ts`
Expected: PASS，8 個案例

- [ ] **Step 5: 接進展示區**

修改 `src/showcase/main.ts`，把骨架的「擺一棟」換成依模式擺放。刪除 `place(ZoneType.RESIDENTIAL_LOW, 1, 0, 0, 0);` 這一行，改為：

```ts
import { blockCells, matrixCells, neighbourSameRatio, type ViewMode, type PlacedCell } from './views';

let mode: ViewMode = 'block';
let zoneType: number = ZoneType.RESIDENTIAL_LOW;
let level = 1;
let seedByte = 0;

export function render(): void {
  clear();
  let cells: PlacedCell[];
  if (mode === 'single') {
    cells = [{ x: 0, z: 0, zoneType, level, variantIndex: 0, facadeSeed: [0.5, 0.5, 0.5] }];
  } else if (mode === 'block') {
    cells = blockCells(zoneType, level, 8, seedByte);
  } else {
    cells = matrixCells();
  }

  let triangles = 0;
  for (const c of cells) {
    triangles += place(c.zoneType, c.level, c.variantIndex, c.x, c.z);
  }

  const ratio = mode === 'block' ? neighbourSameRatio(cells) : 0;
  document.getElementById('panel')!.textContent =
    `${cells.length} 棟 ／ ${triangles} 三角形 ／ 相鄰相同 ${(ratio * 100).toFixed(1)}%`;
}

render();
```

- [ ] **Step 6: 人工驗證**

Run: `node node_modules/vite/bin/vite.js --port 5180 --strictPort`
開 `http://localhost:5180/showcase.html`

Expected：8×8 共 64 棟住宅低密度建築排成方陣，左上角面板顯示棟數、三角形數與相鄰相同比例。**記下這個比例** —— 它是第二階段的比較基準。

- [ ] **Step 7: Commit**

```bash
git add src/showcase/views.ts src/showcase/main.ts src/showcase/__tests__/NeighbourSameRatio.test.ts
git commit -m "feat(showcase): block view, and repetition as a number

The complaint is about a street, not a building, so the block view is the
one that matters. neighbourSameRatio turns the acceptance criterion into
something a test can check instead of something we squint at.

It deliberately ignores the facade seed: a shared silhouette is what reads
as repetition, and phase 1 changes only facades, so this number is
expected NOT to move until phase 2."
```

---

## Task 8: 控制項、相機與效能基準

**Files:**
- Create: `src/showcase/controls.ts`
- Modify: `src/showcase/main.ts`、`docs/superpowers/specs/2026-08-09-building-model-variety-design.md`

**Interfaces:**
- Consumes: Task 7 的 `ViewMode`。
- Produces: `mountControls(host: HTMLElement, state: ControlState, onChange: () => void): void`、`interface ControlState`。

- [ ] **Step 1: 寫控制面板**

建立 `src/showcase/controls.ts`：

```ts
/**
 * 展示區的控制面板。刻意用原生 DOM 而不是 Solid：展示區不該把遊戲的 UI
 * 相依帶進來，它要能在遊戲壞掉的時候仍然打得開。
 */
import type { ViewMode } from './views';
import { ZONE_TYPES, LEVELS } from '../renderer/geometry/buildings/registry';

export interface ControlState {
  mode: ViewMode;
  zoneType: number;
  level: number;
  seedByte: number;
  /** 手動覆寫的時間；null 表示跟著實時流動。 */
  timeOverride: number | null;
  wireframe: boolean;
}

const ZONE_NAMES: Record<number, string> = {
  1: '住宅低密度', 2: '住宅高密度', 3: '商業低密度',
  4: '商業高密度', 5: '工業', 6: '辦公',
};

export function mountControls(
  host: HTMLElement, state: ControlState, onChange: () => void,
): void {
  host.innerHTML = '';

  const row = (label: string, el: HTMLElement) => {
    const l = document.createElement('label');
    l.textContent = label;
    host.appendChild(l);
    host.appendChild(el);
  };

  const modeSel = document.createElement('select');
  for (const m of ['single', 'block', 'matrix'] as ViewMode[]) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = { single: '單體', block: '街廓 8×8', matrix: '矩陣' }[m];
    modeSel.appendChild(o);
  }
  modeSel.value = state.mode;
  modeSel.onchange = () => { state.mode = modeSel.value as ViewMode; onChange(); };
  row('檢視模式', modeSel);

  const zoneSel = document.createElement('select');
  for (const z of ZONE_TYPES) {
    const o = document.createElement('option');
    o.value = String(z);
    o.textContent = ZONE_NAMES[z] ?? String(z);
    zoneSel.appendChild(o);
  }
  zoneSel.value = String(state.zoneType);
  zoneSel.onchange = () => { state.zoneType = Number(zoneSel.value); onChange(); };
  row('分區', zoneSel);

  const levelSel = document.createElement('select');
  for (const lv of LEVELS) {
    const o = document.createElement('option');
    o.value = String(lv);
    o.textContent = `${lv} 級`;
    levelSel.appendChild(o);
  }
  levelSel.value = String(state.level);
  levelSel.onchange = () => { state.level = Number(levelSel.value); onChange(); };
  row('等級', levelSel);

  const time = document.createElement('input');
  time.type = 'range';
  time.min = '0';
  time.max = '600';
  time.step = '1';
  time.value = '0';
  time.oninput = () => { state.timeOverride = Number(time.value); };
  row('時間（拖動即接管日夜）', time);

  const live = document.createElement('button');
  live.textContent = '回到實時';
  live.onclick = () => { state.timeOverride = null; };
  host.appendChild(live);

  const reroll = document.createElement('button');
  reroll.textContent = '重新擲種子';
  reroll.onclick = () => {
    state.seedByte = (state.seedByte + 1) & 0xff;
    onChange();
  };
  host.appendChild(reroll);

  const wire = document.createElement('button');
  wire.textContent = '線框';
  wire.onclick = () => { state.wireframe = !state.wireframe; onChange(); };
  host.appendChild(wire);

  const stats = document.createElement('div');
  stats.id = 'stats';
  host.appendChild(stats);
}
```

- [ ] **Step 2: 接進 main.ts**

修改 `src/showcase/main.ts`：把散落的 `mode` / `zoneType` / `level` / `seedByte` 併成一個 `ControlState`，在 `render()` 之前呼叫 `mountControls`，並把統計輸出改寫到 `#stats`：

```ts
import { mountControls, type ControlState } from './controls';

const state: ControlState = {
  mode: 'block', zoneType: ZoneType.RESIDENTIAL_LOW, level: 1,
  seedByte: 0, timeOverride: null, wireframe: false,
};

mountControls(document.getElementById('panel')!, state, () => render());
```

`render()` 內所有 `mode` / `zoneType` / `level` / `seedByte` 改讀 `state.*`；線框由 `state.wireframe` 決定（`getBuildingMaterial().wireframe = state.wireframe`）。統計改為：

```ts
  const budget = state.level === 3 ? 800 : 400;
  const perBuilding = cells.length > 0 ? Math.round(triangles / cells.length) : 0;
  const stats = document.getElementById('stats')!;
  stats.innerHTML =
    `${cells.length} 棟<br>` +
    `<span class="${perBuilding > budget ? 'over' : ''}">${perBuilding} 三角形／棟（上限 ${budget}）</span><br>` +
    `總計 ${triangles} 三角形<br>` +
    `相鄰相同 ${(ratio * 100).toFixed(1)}%<br>` +
    `<span id="fps"></span>`;
```

時間 uniform 改為：

```ts
sceneManager.onUpdate((dt) => {
  elapsed += dt;
  material.uniforms.uTime!.value = state.timeOverride ?? elapsed;
});
```

- [ ] **Step 3: 加上 FPS 讀數**

在 `src/showcase/main.ts` 的 `onUpdate` 內累計：

```ts
let frames = 0;
let fpsClock = 0;
sceneManager.onUpdate((dt) => {
  frames++;
  fpsClock += dt;
  if (fpsClock >= 0.5) {
    const el = document.getElementById('fps');
    if (el) el.textContent = `${Math.round(frames / fpsClock)} fps`;
    frames = 0;
    fpsClock = 0;
  }
});
```

- [ ] **Step 4: 人工驗證並量測基準**

Run: `node node_modules/vite/bin/vite.js --port 5180 --strictPort`
開 `http://localhost:5180/showcase.html`

依序確認：

1. 切換分區與等級，方陣會換成該分區的建築
2. 拖動時間滑桿，窗戶會亮起、玻璃反射角度改變
3. 按「重新擲種子」，方陣的排列改變
4. 按「線框」，建築變成線框，三角形數字與看到的線條吻合
5. 每個分區的「三角形／棟」都在上限內（超過會變紅）

接著量效能基準：把 `blockCells(state.zoneType, state.level, 8, ...)` 的 `8` 暫時改成 `40`（1600 棟），記下 fps 讀數與「總計三角形」。量完改回 `8`。

- [ ] **Step 5: 把基準寫進規格**

修改 `docs/superpowers/specs/2026-08-09-building-model-variety-design.md`，在 §7 驗收條件第 3 點後面補上實測數字，例如：

```markdown
3. 大城（200×200 蓋滿）frame time **不比階段 0 量到的基準差**

   **階段 0 實測基準（2026-08-09，展示區 40×40 = 1600 棟住宅低密度 1 級）：**
   <實測 fps> fps，總計 <實測數> 三角形。第二階段完成後在同樣條件下重量，
   不得低於此值的 90%。
```

把 `<實測 fps>` 與 `<實測數>` 換成 Step 4 記下的真實數字。

- [ ] **Step 6: Commit**

```bash
git add src/showcase/controls.ts src/showcase/main.ts docs/superpowers/specs/2026-08-09-building-model-variety-design.md
git commit -m "feat(showcase): controls, triangle counter, and a measured baseline

Native DOM rather than Solid on purpose: the showcase must open even when
the game's UI is broken.

The triangle counter turns red over budget, and the baseline frame rate is
now a real number in the spec instead of a promise to measure later."
```

---

## Task 9: 逐實例的立面種子

**Files:**
- Modify: `src/renderer/BuildingRenderer.ts`（`initVariantMeshes`、`setInstanceData`、`removeBuilding`）
- Test: `src/renderer/__tests__/BuildingInstanceSeed.test.ts`（擴充 Task 5 建立的檔案）

**Interfaces:**
- Consumes: Task 1 的 `appearanceOf().facadeSeed`。
- Produces: 每個變體 mesh 上多一個 `aSeed`（`InstancedBufferAttribute`，itemSize 3）。

**背景：** shader 目前的 `floorH = 0.25`、`winW = 0.2` 是寫死的，所有住宅高與辦公建築的窗戶格完全一致 —— 這是「高樓重複性太高」的隱藏主因。要讓每棟不同，shader 需要一個逐實例的輸入。

- [ ] **Step 1: 寫失敗的測試**

在 `src/renderer/__tests__/BuildingInstanceSeed.test.ts` 末端加入：

```ts
describe('aSeed', () => {
  it('should exist on every variant mesh with three components per instance', () => {
    const scene = new THREE.Scene();
    const r = new BuildingRenderer();
    r.build(scene, { width: 0, height: 0, forEachCell: () => {} } as never);

    const meshes = (r as unknown as {
      variantMeshes: Map<string, THREE.InstancedMesh>;
    }).variantMeshes;
    expect(meshes.size).toBeGreaterThan(0);
    for (const [key, mesh] of meshes) {
      const attr = mesh.geometry.getAttribute('aSeed');
      expect(attr, `${key} has no aSeed`).toBeDefined();
      expect(attr.itemSize, `${key} aSeed itemSize`).toBe(3);
    }
  });

  it('should carry the facade seed appearanceOf gives that cell', () => {
    const scene = new THREE.Scene();
    const r = new BuildingRenderer();
    r.build(scene, { width: 0, height: 0, forEachCell: () => {} } as never);
    r.addBuilding(6, 2, ZONE, 1, false);

    const internals = r as unknown as {
      positionToInstance: Map<string, { key: string; idx: number }>;
      variantMeshes: Map<string, THREE.InstancedMesh>;
    };
    const entry = internals.positionToInstance.get('6,2')!;
    const attr = internals.variantMeshes.get(entry.key)!.geometry.getAttribute('aSeed');

    const variants = getVariants(ZONE, 1);
    const expected = appearanceOf({
      x: 6, y: 2, zoneType: ZONE, level: 1, seedByte: 0,
      variantCount: variants.length, paletteSize: 1,
    }).facadeSeed;

    expect(attr.getX(entry.idx)).toBeCloseTo(expected[0], 6);
    expect(attr.getY(entry.idx)).toBeCloseTo(expected[1], 6);
    expect(attr.getZ(entry.idx)).toBeCloseTo(expected[2], 6);
  });

  it('should follow the building when swap-with-last moves it', () => {
    // aOccupancy 已經有搬移邏輯，aSeed 漏搬的話，被搬動的那棟樓會戴上
    // 另一棟樓的立面 —— 而且只在玩家拆除建築之後才發生。
    const scene = new THREE.Scene();
    const r = new BuildingRenderer();
    r.build(scene, { width: 0, height: 0, forEachCell: () => {} } as never);

    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) cells.push([x, y]);
    for (const [x, y] of cells) r.addBuilding(x, y, ZONE, 1, false);

    for (let i = 0; i < cells.length; i += 2) {
      const [x, y] = cells[i]!;
      r.removeBuilding(x, y);
    }

    const internals = r as unknown as {
      positionToInstance: Map<string, { key: string; idx: number }>;
      variantMeshes: Map<string, THREE.InstancedMesh>;
    };
    const variants = getVariants(ZONE, 1);
    for (let i = 1; i < cells.length; i += 2) {
      const [x, y] = cells[i]!;
      const entry = internals.positionToInstance.get(`${x},${y}`)!;
      const attr = internals.variantMeshes.get(entry.key)!.geometry.getAttribute('aSeed');
      const expected = appearanceOf({
        x, y, zoneType: ZONE, level: 1, seedByte: 0,
        variantCount: variants.length, paletteSize: 1,
      }).facadeSeed;
      expect(attr.getX(entry.idx), `aSeed.x wrong at ${x},${y}`).toBeCloseTo(expected[0], 6);
      expect(attr.getY(entry.idx), `aSeed.y wrong at ${x},${y}`).toBeCloseTo(expected[1], 6);
      expect(attr.getZ(entry.idx), `aSeed.z wrong at ${x},${y}`).toBeCloseTo(expected[2], 6);
    }
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingInstanceSeed.test.ts`
Expected: 三個新案例全部 FAIL（`aSeed` 不存在）

- [ ] **Step 3: 配置屬性**

在 `BuildingRenderer.initVariantMeshes` 內，緊接在 `aOccupancy` 的配置之後加入：

```ts
        // 逐實例立面種子：節奏、相位、材質偏好。shader 用它取代寫死的
        // floorH / winW，讓同一份幾何的兩個實例立面不同。
        const seedData = new Float32Array(this.maxPerVariant * 3);
        mesh.geometry.setAttribute('aSeed',
          new THREE.InstancedBufferAttribute(seedData, 3));
```

- [ ] **Step 4: 寫入種子**

在 `setInstanceData` 末端，`mesh.setColorAt(idx, this._color);` 之後加入：

```ts
    const seedAttr = mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
    if (seedAttr) {
      const arr = seedAttr.array as Float32Array;
      arr[idx * 3] = app.facadeSeed[0];
      arr[idx * 3 + 1] = app.facadeSeed[1];
      arr[idx * 3 + 2] = app.facadeSeed[2];
      seedAttr.needsUpdate = true;
    }
```

- [ ] **Step 5: 搬移種子**

`removeBuilding` 是 swap-with-last。找到既有的 `// Swap aOccupancy` 區塊（約 1057 行），在它之後加入同樣形狀的搬移：

```ts
      // Swap aSeed（與 aOccupancy 相同的理由：不搬的話，被搬動的那棟樓會
      // 戴上被移除那棟的立面）
      const seedAttr = mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
      if (seedAttr) {
        const arr = seedAttr.array as Float32Array;
        arr[entry.idx * 3] = arr[lastIdx * 3]!;
        arr[entry.idx * 3 + 1] = arr[lastIdx * 3 + 1]!;
        arr[entry.idx * 3 + 2] = arr[lastIdx * 3 + 2]!;
        seedAttr.needsUpdate = true;
      }
```

- [ ] **Step 6: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingInstanceSeed.test.ts`
Expected: PASS，5 個案例

- [ ] **Step 7: 確認測試有鑑別力**

把 Step 5 的搬移區塊整段註解掉，重跑。
Expected: 「should follow the building when swap-with-last moves it」轉紅。取消註解，重跑確認全綠。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/BuildingRenderer.ts src/renderer/__tests__/BuildingInstanceSeed.test.ts
git commit -m "feat(renderer): a per-instance facade seed

The shader's floor height and window width are constants, so every tower
in the city wears the same window grid whatever its shape -- a hidden
cause of 'the tall buildings all look the same'. This is the input that
lets them differ.

The swap-with-last path carries it, and there is a test for that: without
it, a building only puts on its neighbour's facade after the player
demolishes something, which is a horrible thing to debug later."
```

---

## Task 10: shader 讀取立面種子

**Files:**
- Modify: `src/renderer/BuildingMaterial.ts`（`BUILDING_VERT`、`BUILDING_FRAG`）
- Test: `src/renderer/__tests__/BuildingMaterial.test.ts`（擴充）

**Interfaces:**
- Consumes: Task 9 的 `aSeed` 屬性。
- Produces: shader 內的 `vSeed` varying。

- [ ] **Step 1: 寫失敗的測試**

在 `src/renderer/__tests__/BuildingMaterial.test.ts` 的第一個 describe 內加入：

```ts
  it('should declare and forward the per-instance facade seed', () => {
    expect(BUILDING_VERT).toContain('attribute vec3 aSeed;');
    expect(BUILDING_VERT).toContain('varying vec3 vSeed;');
    expect(BUILDING_VERT).toContain('vSeed = aSeed;');
    expect(BUILDING_FRAG).toContain('varying vec3 vSeed;');
  });

  it('should no longer hardcode the floor height and window width', () => {
    // 這兩個常數是「高樓重複性太高」的隱藏主因：不論量體怎麼變，
    // 所有塔樓的窗戶格都一樣。
    expect(BUILDING_FRAG).not.toContain('float floorH = 0.25;');
    expect(BUILDING_FRAG).not.toContain('float winW = 0.2;');
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: 兩個新案例 FAIL

- [ ] **Step 3: 傳遞種子**

在 `BUILDING_VERT` 的 `attribute float aOccupancy;` 之後加入：

```glsl
attribute vec3 aSeed;
```

在 varying 宣告區加入：

```glsl
varying vec3 vSeed;
```

在 `main()` 內、`vOccupancy = aOccupancy;` 之後加入：

```glsl
  vSeed = aSeed;
```

在 `BUILDING_FRAG` 的 varying 宣告區加入：

```glsl
varying vec3 vSeed;
```

- [ ] **Step 4: 讓節奏跟著種子走**

在 `BUILDING_FRAG` 的 `void main()` 內，牆面分支開始處（`float y = vWorldPos.y;` 之前）加入：

```glsl
    // 每棟樓自己的立面節奏。以前這些是常數，所以整座城市的塔樓共用同一個
    // 窗戶格；量體再怎麼變，立面看起來還是同一棟。
    float seedRhythm = vSeed.x;
    float seedPhase = vSeed.y;
    float floorHeight = mix(0.22, 0.30, seedRhythm);
    float windowWidth = mix(0.16, 0.24, seedRhythm);
    // 相位偏移只改起算點，不改尺度 —— 窗戶仍是真實世界尺寸，但相鄰建築的
    // 窗戶不再橫向對齊成一條線。
    float phase = seedPhase * 10.0;
```

住宅高分支（`else if (vZoneCat < 0.3)`）內的：

```glsl
      float floorH = 0.25;
      float winW = 0.2;
      float fy = y / floorH;
      float fx = wallU / winW;
```

改為：

```glsl
      float fy = y / floorHeight;
      float fx = (wallU + phase) / windowWidth;
```

商業低分支上層牆面的 `float floorH = 0.3; float winW = 0.22;` 改為：

```glsl
        float fy = y / (floorHeight * 1.2);
        float fx = (wallU + phase) / (windowWidth * 1.1);
```

（其餘使用 `floorH` / `winW` 的分支照同一模式改：`fy` 用 `floorHeight` 乘上該分區原本的比值，`fx` 用 `(wallU + phase) / windowWidth` 乘上原本的比值。以原本的常數除以 0.25 與 0.2 得到比值。）

- [ ] **Step 5: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: PASS，6 個案例

- [ ] **Step 6: 人工驗證**

Run: `node node_modules/vite/bin/vite.js --port 5180 --strictPort`
開展示區，分區選「住宅高密度」、等級 3、模式「街廓 8×8」。

Expected：**相鄰建築的窗戶不再橫向連成一線**，每棟的樓層數看起來不同。按「重新擲種子」，整片立面重新排列。拖動時間滑桿到夜晚，亮燈的窗戶跟著新的格子走、沒有錯位。

若窗戶出現拉長或撕裂，表示某個分支的比值換算算錯 —— 回到 Step 4 檢查該分支。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/BuildingMaterial.ts src/renderer/__tests__/BuildingMaterial.test.ts
git commit -m "feat(renderer): every building gets its own facade rhythm

floorH and winW were constants, so every tower in the city wore the same
window grid however different its shape -- which is most of why the tall
buildings read as identical.

The phase offset moves only where the grid starts, not its scale: windows
stay real-world sized, but neighbours no longer line up into one long
horizontal rule across the map."
```

---

## Task 11: 細節零件不長窗戶

**Files:**
- Modify: `src/renderer/BuildingMaterial.ts`（`BUILDING_FRAG`）
- Test: `src/renderer/__tests__/BuildingMaterial.test.ts`（擴充）

**Interfaces:**
- Consumes: Task 2 的 `PART_DETAIL`、`PART_THRESHOLDS`。
- Produces: shader 內的細節分支。

- [ ] **Step 1: 寫失敗的測試**

在 `src/renderer/__tests__/BuildingMaterial.test.ts` 加入：

```ts
  it('should branch on the detail tag before it reaches the wall branch', () => {
    // 沒有這個分支，第三階段的水塔與冷氣機會被畫上窗戶。
    expect(BUILDING_FRAG).toContain('isDetail');
    const detailAt = BUILDING_FRAG.indexOf('isDetail');
    const wallAt = BUILDING_FRAG.indexOf('=== WALL');
    expect(detailAt).toBeGreaterThan(-1);
    expect(wallAt).toBeGreaterThan(-1);
    expect(detailAt).toBeLessThan(wallAt);
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: 新案例 FAIL

- [ ] **Step 3: 加上分支**

在 `BUILDING_FRAG` 的 `bool isFoliage = ...` 之後加入：

```glsl
  // 金屬／深色細節：水塔、冷氣機、天線、管架。不畫窗戶，也不吃分區的
  // 立面規則 —— 否則屋頂上的設備會長出一格一格的窗。
  bool isDetail = vPartType > ${glslFloat(PART_THRESHOLDS.ROOF_BY_NORMAL)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.FOLIAGE_MIN)};
```

在 `if (isFoliage) { ... }` 這一串條件鏈中，於 `isFoliage` 之後、`isFloor` 之前插入：

```glsl
  } else if (isDetail) {
    // 略帶藍的中灰金屬，靠種子微調明度，避免整片設備同一個顏色
    float m = 0.42 + vSeed.z * 0.16;
    color = vec3(m, m * 1.02, m * 1.06) * lighting;
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: PASS，7 個案例

- [ ] **Step 5: 人工驗證**

在 `src/showcase/main.ts` 的 `place()` 內，暫時於 `stampZoneCategory` 之後加入一段測試用幾何：

```ts
  // 暫時：驗證 PART_DETAIL 分支
  const tank = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8);
  tank.translate(0, 0.6, 0);
  tagPart(tank, PART_DETAIL);
  stampZoneCategory(tank, ZONE_CAT[zoneType] ?? 0);
```

（需 import `tagPart`、`PART_DETAIL`。）把它 merge 進主幾何後觀察：**水塔應該是灰色金屬，表面沒有窗格**。確認後**把這段暫時程式碼刪掉**，不要 commit。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/BuildingMaterial.ts src/renderer/__tests__/BuildingMaterial.test.ts
git commit -m "feat(renderer): detail parts read as metal, not as walls with windows

The wall branch catches anything roughly vertical, so the rooftop water
tanks and AC units of the next phase would have arrived covered in window
grids. The detail branch sits ahead of it."
```

---

## Task 12: 低密度住宅的立面

**Files:**
- Modify: `src/renderer/BuildingMaterial.ts`（`BUILDING_FRAG` 的 `vZoneCat < 0.1` 分支）
- Test: `src/renderer/__tests__/BuildingMaterial.test.ts`（擴充）

**Interfaces:**
- Consumes: Task 10 的 `floorHeight` / `windowWidth` / `phase`。
- Produces: 無新介面。

**背景：** 現行 `vZoneCat < 0.1` 分支只畫水平壁板線，完全沒有窗戶 —— 這是「非高樓都沒有窗戶」這條抱怨的直接來源。

- [ ] **Step 1: 寫失敗的測試**

在 `src/renderer/__tests__/BuildingMaterial.test.ts` 加入：

```ts
  it('should give low-density residential a window grid, not just siding lines', () => {
    // 這個分支原本只有水平壁板線，所以近看沒有任何細節可看。
    const branch = BUILDING_FRAG.slice(
      BUILDING_FRAG.indexOf('RESIDENTIAL LOW'),
      BUILDING_FRAG.indexOf('RESIDENTIAL HIGH'),
    );
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).toContain('winMask');
    expect(branch).toContain('floorHeight');
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: 新案例 FAIL

- [ ] **Step 3: 改寫分支**

把 `BUILDING_FRAG` 的：

```glsl
    if (vZoneCat < 0.1) {
      color = vBldgColor * 0.9;
      if (onWall) {
        float board = fract(y / 0.06);
        float line = smoothstep(0.0, 0.06, board) * smoothstep(0.12, 0.06, board);
        color = vBldgColor * (0.88 - line * 0.06);
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    }
```

改為：

```glsl
    if (vZoneCat < 0.1) {
      color = vBldgColor * 0.9;
      if (onWall) {
        // 水平壁板（保留原本的質感）
        float board = fract(y / 0.06);
        float line = smoothstep(0.0, 0.06, board) * smoothstep(0.12, 0.06, board);
        vec3 wallColor = vBldgColor * (0.88 - line * 0.06);

        // 住宅的窗比公寓大而稀疏，一層一排
        float houseFloor = floorHeight * 0.72;
        float houseWin = windowWidth * 1.35;
        float fy = y / houseFloor;
        float fx = (wallU + phase) / houseWin;
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fx);
        float fwY = fwidth(fy);
        float winMask =
            smoothstep(0.30 - fwX, 0.30 + fwX, fracX) * smoothstep(0.70 + fwX, 0.70 - fwX, fracX)
          * smoothstep(0.30 - fwY, 0.30 + fwY, fracY) * smoothstep(0.72 + fwY, 0.72 - fwY, fracY);

        // 一樓正中央開一道門，取代那一格窗
        bool doorRow = y < houseFloor;
        float doorX = abs(fract(fx) - 0.5);
        float doorMask = (doorRow && doorX < 0.18 && y < houseFloor * 0.78) ? 1.0 : 0.0;
        winMask = max(winMask * (doorRow ? 0.0 : 1.0), 0.0);

        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 4.7;
        float period = 150.0 + hash21(wid + 99.0) * 150.0;
        float phaseT = hash21(wid * 2.71 + 47.0) * period;
        float epoch = floor((uTime + phaseT) / period);
        float lit = hash21(wid + epoch * 13.7);
        float litThresh = mix(0.95, 0.45, occ);

        vec3 winColor;
        if (lit > litThresh) {
          float w = hash21(wid + 77.7);
          winColor = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
          winBrightness = 0.6 + hash21(wid + 21.3) * 0.4;
          isLitWindow = winMask > 0.5;
        } else {
          winColor = vBldgColor * 0.24 + vec3(0.03, 0.05, 0.08);
        }

        vec3 doorColor = vBldgColor * 0.35 + vec3(0.06, 0.03, 0.02);
        color = mix(wallColor, winColor, winMask);
        color = mix(color, doorColor, doorMask);
        windowMask = winMask;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/renderer/__tests__/BuildingMaterial.test.ts`
Expected: PASS，8 個案例

- [ ] **Step 5: 人工驗證**

開展示區，分區選「住宅低密度」、模式「單體」。

Expected：牆上有一排排窗戶，一樓正中央有一道門，壁板線仍在。切到「街廓 8×8」，相鄰房子的窗戶位置不同。拖時間到夜晚，部分窗戶亮起。

**若門出現在每一面牆的正中央而顯得奇怪**，那是可接受的 —— 低多邊形風格下四面都有門並不突兀。若你不喜歡，把 `doorMask` 的條件加上 `&& n.z > 0.5`（只在朝南的牆開門），並在展示區確認。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/BuildingMaterial.ts src/renderer/__tests__/BuildingMaterial.test.ts
git commit -m "feat(renderer): low-density houses get windows and a door

This branch drew horizontal siding lines and nothing else, which is why
the houses had nothing to look at up close. The grid is wider and sparser
than the apartment one, the ground floor trades its middle window for a
door, and the lights come on at night like everywhere else."
```

---

## Task 13: 階段驗收

**Files:**
- Modify: `TODO.md`、`BUGS.md`（若過程中發現缺陷）

- [ ] **Step 1: 全套測試**

Run: `npx vitest run`
Expected: 全綠，檔案數 ≥ 292 + 6，測試數 ≥ 4230 + 本計畫新增

- [ ] **Step 2: 型別與建置**

Run: `npx tsc --noEmit` → 無輸出
Run: `npx vite build` → 產出 `dist/index.html` 與 `dist/showcase.html`

- [ ] **Step 3: 遊戲本體人工驗證**

Run: `node node_modules/vite/bin/vite.js --port 5180 --strictPort`
開 `http://localhost:5180/`，開新遊戲，蓋路、劃住宅低密度與住宅高密度、等建築長出來。

依序確認：

1. 建築外觀與階段 0 之前**不應該有形狀上的差異**（本階段沒有動幾何）
2. 低密度住宅現在有窗戶與門
3. 高密度住宅相鄰兩棟的窗戶格不再對齊
4. 夜晚窗戶亮燈正常，玻璃反射仍在
5. 拆除建築後，旁邊的建築**沒有換成別的立面**（這是 `aSeed` 搬移的實際驗證）

- [ ] **Step 4: 更新 TODO.md**

在 `TODO.md` 加入一段：

```markdown
## 建築模型多樣性 — 階段 0 + 1 完成

規格：`docs/superpowers/specs/2026-08-09-building-model-variety-design.md`
計畫：`docs/superpowers/plans/2026-08-09-building-model-variety-phase-0-1.md`

- [x] 階段 0：外觀模組、零件模組、材質模組、變體註冊表、展示區（三檢視 + 控制項 + 基準）
- [x] 階段 1：`hash3` 取代偏移雜湊、`aSeed` 逐實例種子、`PART_DETAIL`、低密度住宅立面
- [ ] 階段 2：參數化生成器，變體 key 改成 (分區, 等級)，容量動態配置
- [ ] 階段 3：裝飾物層（屋頂物件、地面物件）
- [ ] 階段 4：`seedByte` 存進 Grid、Serializer、遷移；LOD；接進遊戲驗收
```

- [ ] **Step 5: Commit**

```bash
git add TODO.md BUGS.md
git commit -m "docs: phase 0 and 1 of building model variety are done

The showcase is up and every zone now has a facade. Silhouettes are
unchanged on purpose -- that is phase 2, and the block view's repetition
number is the thing it has to move."
```

---

## 自我檢查

**規格覆蓋：** 規格 §4.1 展示區 → Task 6、7、8。§4.3 的 `hash3` 與流獨立性 → Task 1；`seedByte` 參數位置 → Task 1（介面已開，值傳 0，第四階段接上）。§4.4 shader 介面 → Task 9、10、11、12。§4.5 模組拆分 → Task 2、3、4、5。§4.2 的 `PART_DETAIL` → Task 2、11。§6 測試策略的「幾何生成器」四條 → Task 4；「`appearanceOf`」三條 → Task 1；「實例管理」→ Task 5、9。§7 驗收條件 1 的可檢查形式 → Task 7；條件 3 的基準 → Task 8。

**規格中本計畫不涵蓋的部分**（屬於階段 2–4，將另行排計畫）：§4.2 的量體語法與分配表、§4.6 容量動態配置與 LOD、§4.3 的 `seedByte` 持久化與遷移。

**型別一致性：** `appearanceOf` 在 Task 1 定義為吃 `AppearanceInput` 物件，Task 5、7、9 的呼叫端都用同一個物件形式；`getVariants(zoneType, level)` 在 Task 4 定義，Task 5、7、8 一致；`facadeSeed` 為 `readonly [number, number, number]`，Task 9 依 `[0]/[1]/[2]` 取用，一致；`PART_THRESHOLDS` 的四個鍵在 Task 2 定義，Task 3、11 使用同名。

**無佔位符：** 每個 code step 都含實際程式碼。唯一需要人工填入的是 Task 8 Step 5 的實測數字，該步驟明確說明如何取得。

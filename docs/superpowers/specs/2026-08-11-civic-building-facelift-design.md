# 公共建築美化設計（BUG-238 治本）

**日期：** 2026-08-11
**分支：** `feat/civic-building-facelift`
**起因：** BUG-238 —— 公共建築完全沒有夜間燈光，也幾乎沒有窗。

---

## 1. 問題

城市裡有兩條建築渲染路徑，只有一條接了 shader。

| | 分區建築（住／商／工／辦公） | 公共建築（civic / infra） |
|---|---|---|
| 材質 | `getBuildingMaterial()` — 單例 `ShaderMaterial` | 220 個 `MeshLambertMaterial` |
| 幾何 | `Volume[]` → `assemble()` → 四層 `InstancedLayer` | 20 個手寫 `buildXxx()`，一堆獨立 `Mesh` |
| 窗格 | 程序化，逐分區的立面規則 | 無 |
| 夜間亮窗 | `isLitWindow` × `nightFactor`，吃 `aOccupancy` | 無 |
| 招牌／燈頭自發光 | `PART_LAMP` → `emissive` | `emissive` 出現 0 次 |
| 白天玻璃反射 | `dayGlass` + 陽光鏡面 | 無 |

公共建築**有光照、只是不會發光**：`MeshLambertMaterial` 吃場景的 directional
與 ambient，天黑會跟著暗，`castShadow` / `receiveShadow` 也都開著。缺的是
自發光與窗格，不是被照亮的能力。

## 2. 目標

19 種公共建築全部改走 `BUILDING_FRAG`，取得與分區建築同一套語彙：程序化窗格、
夜間亮窗、`PART_LAMP` 自發光、白天玻璃反射，外加貼片、矮物件、懸挑三層。

**外觀重做**（不是保留現有輪廓補細節），**不做變體**（每種一個固定外觀）。

**第一個交付目標是 `showcase.html`** —— 遊戲整合是第二階段。

## 3. 不做什麼（YAGNI）

- **不做變體。** 一座城市裡的三間小學長得一樣是可接受的；公共建築的辨識度
  比多樣性重要。`CivicPlan` 因此不帶 `variantIndex`、不吃 `seedByte`。
- **不做等級。** 公共建築沒有升級機制。
- **不新寫 shader。** `BUILDING_FRAG` 的夜間與色彩空間邏輯只能有一份 ——
  「各寫一份」在這個專案已經咬過（BUG-231 的地板顏色）。
- **不改 `InfraConfig` 的佔地尺寸。** 佔地是遊戲規則，不是渲染的自由度。
  幾何要配合佔地，不是反過來。

---

## 4. 架構

### 4.1 中間表示：`CivicPlan`

分區建築的骨架直接可以借：`Volume`（宣告式量體）→ `assemble()`（標零件、
合併）。公共建築與它只差三點 —— 多格、無變體、護欄不同。

```ts
// src/renderer/geometry/civic/types.ts

/**
 * 一棟公共建築的完整描述。
 *
 * 座標單位是**格**，原點是佔地的中心。所以 2×2 的建築可用範圍是
 * x ∈ [−1, 1]、z ∈ [−1, 1]；3×3 是 [−1.5, 1.5]。
 */
export interface CivicPlan {
  /** 佔地格數。必須與 `InfraConfig` 的 width/height 一致 —— 對不上就 throw。 */
  footprint: { w: number; h: number };
  /** 立面類別。決定 shader 走哪一條立面分支。 */
  facade: number;
  /**
   * 交給 shader 的 `aSeed`：樓層節奏、窗戶相位、材質微調。
   *
   * 分區建築由座標雜湊產生（同一種建築在城市各處長得不一樣）；公共建築
   * 相反 —— 三間小學必須長得一樣，所以由 plan 直接給定值。
   */
  seed: readonly [number, number, number];
  /** 量體。castShadow，遠景不關。 */
  massing: Volume[];
  /** 地面貼片。完全平，不投影，遠景不關。 */
  decals: CivicDecal[];
  /** 矮物件：樹、路燈、旗桿、垃圾桶、車輛。castShadow，遠景整層關掉。 */
  props: Volume[];
  /** 懸挑：雨棚、招牌、月台頂。castShadow，遠景整層關掉。 */
  overhead: Volume[];
}
```

四層與 `BuildingRenderer.attachments`／showcase 的 `ATTACHMENTS` 逐項對應，
所以三角形統計、`detailLOD`、陰影規則全部直接沿用，不必新增概念。

### 4.2 貼片不能用 `Volume`

`Volume` 產出的是稜台 —— 有側面。而側面是牆，牆會長出窗戶。既有的
`decals.ts` 已經踩過這個坑，它的註解寫著「有厚度的話側面會長出牆，而牆會
長出窗戶。所以一律用 `PlaneGeometry`」。

所以貼片是自己的型別：

```ts
/** 一塊平鋪面。單層四邊形，沒有厚度。 */
export interface CivicDecal {
  x: number; z: number;
  w: number; d: number;
  /** 明度，寫進頂點色 B 通道。0 = 柏油，1 = 白漆。 */
  shade: number;
  /** 疊放層。`mark`（標線、踏板）疊在 `base`（鋪面）之上。 */
  layer?: 'base' | 'mark';
  /** 草地。走 `PART_FOLIAGE` 拿到綠色，而不是 `PART_GROUND` 的灰階。 */
  lawn?: boolean;
}
```

**底層彼此不得重疊** —— 兩塊同高同位的四邊形會 z-fighting，靜態截圖看不
出來，一移動鏡頭就整片閃爍。疊放只能發生在 `mark` 層。這條由測試守。

### 4.3 `assembleCivic()`

復用 `assemble.ts` 的 `shapeOf` / `frustum` / `cylinder`，只換護欄：

| | 分區版 `assemble()` | 公共版 `assembleCivic()` |
|---|---|---|
| 護欄 | `maxAbsOf(volumes) ≤ HALF_ENVELOPE` | 量體不得超出自己的 footprint |
| 理由 | 行人的門節點在包絡線外側，越過就是穿牆（BUG-221） | 越出佔地就是壓到鄰格的建築或馬路 |

`shapeOf` 目前是 `assemble.ts` 的私有函式，要匯出。**`assemble()` 的既有簽章
與行為不得改變** —— 分區建築的八個變體都吃它。

護欄的邊界值：footprint `w × h` 的可用範圍是 `|x| ≤ w/2`、`|z| ≤ h/2`，
再內縮 `CIVIC_INSET`（0.02 格 = 24 cm），避免與鄰格的建築共面 z-fighting。

### 4.4 shader 擴充 —— 這裡有一個既有的重複

`ZONE_CAT` 新增四個公共類別。key 用 101 起跳，與 `ZoneType`（0–6）不相撞：

```ts
// src/renderer/geometry/buildings/parts.ts
export const FACADE_CIVIC   = 101;
export const FACADE_UTILITY = 102;
export const FACADE_TRANSIT = 103;
export const FACADE_GREEN   = 104;

export const ZONE_CAT: Record<number, number> = {
  ...既有六個 0.0 – 1.0,
  [FACADE_CIVIC]:   1.2,
  [FACADE_UTILITY]: 1.4,
  [FACADE_TRANSIT]: 1.6,
  [FACADE_GREEN]:   1.8,
};
```

| 類別 | cat | 適用 | 立面語彙 |
|---|---|---|---|
| `FACADE_CIVIC` | 1.2 | 警局、消防局、醫院、三級學校 | 磚石／混凝土，規律的中型窗，一樓有門廊。夜裡部分樓層亮（值班） |
| `FACADE_UTILITY` | 1.4 | 電廠、水廠、垃圾場、汙水廠 | 浪板牆＋高窗帶（沿用工業的語彙），紅色警示燈常亮 |
| `FACADE_TRANSIT` | 1.6 | 公車站、捷運站、火車站、渡輪碼頭、機場 | 玻璃幕＋雨棚，月台燈夜裡幾乎全亮 |
| `FACADE_GREEN` | 1.8 | 公園、墓園 | 幾乎沒有牆。走到這個分支的少量牆面是低矮的圍牆／管理小屋 |

#### 這裡的坑

`roofColorGlsl()` 是**從 `ZONE_CAT` 生成的**（門檻取相鄰兩個 cat 的中點），
所以加類別會自動長出屋頂色票分支。

但 `BUILDING_FRAG` 的**立面** if 鏈是**手寫的**：

```glsl
if      (vZoneCat < 0.1) { /* 住宅低 */ }
else if (vZoneCat < 0.3) { /* 住宅高 */ }
else if (vZoneCat < 0.5) { /* 商業低 */ }
else if (vZoneCat < 0.7) { /* 商業高 */ }
else if (vZoneCat < 0.9) { /* 工業   */ }
else                     { /* 辦公   */ }
```

那六個門檻是 `ZONE_CAT` 的第二份資料。最後那個 `else` 現在接的是辦公 ——
**加了 1.2 之後，公共建築會靜靜地掉進辦公的窗格分支**，不會有任何東西報錯。

所以第一步不是加類別，是把立面 if 鏈也改成由 `ZONE_CAT` 生成，與屋頂色票
同一個機制：立面分支寫成 `Record<facadeKey, glslBody>`，由同一張排序表串起來。
這是獨立的一輪 TDD，在加任何公共類別之前完成。

#### `vZoneCat > 1.0` 會不會被截斷

不會。`color` 是 `Float32Array` 的 `BufferAttribute`，three.js 在
`USE_COLOR` 下只宣告 `attribute vec3 color;`，不做任何轉換或 clamp；
本 shader 也不 include `color_vertex`，而是在 `BUILDING_VERT` 直接讀
`color.g`。**但這是推論，不是觀察** —— Task 1 有一條測試直接驗證
cat = 1.2 路由到 `FACADE_CIVIC` 的分支而不是辦公。

### 4.5 模組結構

```
src/renderer/geometry/civic/
  types.ts        CivicPlan / CivicDecal / CIVIC_INSET
  assemble.ts     assembleCivic() + assembleDecals()，護欄在這裡
  registry.ts     InfraType → CivicPlan 的查表，與三角形預算
  models/
    police.ts  fire.ts  hospital.ts
    schoolElementary.ts  schoolHigh.ts  university.ts
    park.ts  cemetery.ts
    power.ts  water.ts  landfill.ts  sewage.ts
    busStop.ts  metroStation.ts  trainStation.ts  ferryDock.ts
    airportSmall.ts  airportMedium.ts  airportLarge.ts
```

一個檔案一棟建築。理由是每棟的量體描述會長到 80–150 行（含註解），
放在一起就是一個 2000 行的檔案 —— 那正是 `BuildingRenderer.ts` 現在的
問題（2929 行）。

`assemble.ts` 的 `shapeOf` 匯出後由 `civic/assemble.ts` 使用；
`civic/` 不重新實作任何幾何圖元。

### 4.6 三角形預算

分區建築的預算是逐棟的（`HOUSE: 400` / `TOWER: 800`），公共建築佔地
2×2 到 9×6，套同一條線沒有意義。改成**逐格**：

```ts
export const CIVIC_TRIANGLE_BUDGET = {
  /** 每格佔地的量體上限。2×2 = 4 格 = 1200 三角形。 */
  MASSING_PER_CELL: 300,
  DECAL_PER_CELL: 60,
  PROP_PER_CELL: 120,
  OVERHEAD_PER_CELL: 80,
} as const;
```

數字的來源：分區建築 L3 塔樓是 800 量體 + 320 矮物件，佔一格。公共建築
每格給 300 是刻意低於它 —— 一座 3×3 的大學要是每格都照塔樓的密度做，
單棟就 7200 三角形，而畫面上它只有一棟。這些數字在批 1 做完之後要用
實測回頭校準，**不是推導出來的**。

---

## 5. showcase 整合

`showcase.html` 新增 `civic` 檢視模式：

- 下拉選單選 19 種 `InfraType`（`INFRA_CONFIGS` 直接餵，不另寫清單）
- 重用既有的時間滑桿、`occupancy` 滑桿、線框、三層開關
- 三角形統計改用逐格預算，並顯示佔地（`2×2`）
- 分區／密度／等級／變體四個下拉在 `civic` 模式下隱藏 —— 它們對公共建築
  沒有意義，留著只會讓人以為調了有用

地面用既有的 `createShowcaseGround`，日夜用既有的 `WeatherRenderer`。
逐實例屬性用既有的 `stampInstanceValues`（`aOccupancy` / `aSeed` /
`aHighlight` / `aHighlightColor` 四個都要餵，缺了 WebGL 一律餵 0）。

`aSeed` 對公共建築的意義：`.x` 是樓層節奏（立面窗格的樓高），`.y` 是相位，
`.z` 是材質微調。公共建築不做變體，所以這三個由 `CivicPlan` 直接給定值，
而不是由座標雜湊 —— 同一種建築在城市各處必須長得一樣。

---

## 6. 遊戲整合（第二階段，本 spec 只定義介面）

掃過四個整合點，只有一個會壞。

| 整合點 | 狀況 |
|---|---|
| `PlacementPreview.buildPreviewModel` | 建完之後 `traverse` 把所有 `Mesh` 的材質換成 ghost。與材質種類無關 → **不受影響** |
| `BuildingRenderer.snapToGround` | `Box3.setFromObject(group)` → **不受影響** |
| `uDesaturate` 地下白模式 | 公共建築改用共用材質後**免費取得**（現在沒有） |
| `HighlightManager.applyTintToGroup` | **會壞** |

### `HighlightManager` 的迴歸

```ts
const cloned = origMat.clone();
if (cloned instanceof THREE.MeshLambertMaterial) { ... }
else if (cloned instanceof THREE.MeshBasicMaterial) { ... }
child.material = cloned;
```

`ShaderMaterial` 兩個分支都不中 → 材質被 clone 一份、什麼都沒改、然後裝回去。
結果是**選取與 hover 高亮對公共建築靜默失效**，而且因為 clone 出來的
`ShaderMaterial` 不再是那個單例，`uTime` 的每幀更新也不會到它身上 ——
被高亮過的公共建築窗戶會凍結在某個亮燈狀態。

修法是走屬性而不是換材質：`BUILDING_FRAG` 已經在讀 `aHighlight` 與
`aHighlightColor`，而 showcase 的 `stampInstanceValues` 已經示範過
非實例化的 `Mesh` 怎麼餵這些屬性（普通 `BufferAttribute`，一份幾何一個值）。

這一項排在遊戲整合階段，不在 showcase 階段。

---

## 7. 機場與 taxiway

現有機場已經有完整拓撲：跑道（含 40 段中線虛線與跑道頭標記）、兩條
連絡道、停機坪、三座停機橋、塔台、機棚。**重做時保留這個拓撲**，
補上它現在完全沒有的夜間語彙：

- 跑道邊燈（兩側等距，`PART_LAMP`）
- 跑道頭燈（進場端一排）
- 連絡道中線燈（`PART_LAMP`，較暗）
- 停機坪泛光燈桿（燈桿 `PART_DETAIL`、燈頭 `PART_LAMP` —— 整支標成發光的話，
  夜裡會看到一根從地上亮到頂的柱子，這是 BUG-230 的教訓）
- 塔台玻璃罩（`PART_WALL` + `FACADE_TRANSIT` → 夜間全亮）

機場排最後一批，三種各自獨立一個檔案。9×6 的大型機場是全專案佔地最大的
單體，它的量體預算要單獨量。

---

## 8. 批次

| 批 | 內容 | 交付 |
|---|---|---|
| Task 0 | 立面 if 鏈改由 `ZONE_CAT` 生成 | 現有六個分區行為不變，測試證明 |
| Task 1 | 四個公共類別 + `civic/` 基礎建設（`types` / `assemble` / `registry`） | 一個最小的假 plan 能跑通 |
| Task 2 | showcase `civic` 模式 | 打得開、選得到、統計正確 |
| 批 1 | 民生服務 6 種：警局／消防局／醫院／小學／高中／大學 | `FACADE_CIVIC` 驗收 |
| 批 2 | 公園、墓園 | `FACADE_GREEN` 驗收 |
| 批 3 | 公用設施 4 種：電廠／水廠／垃圾場／汙水廠 | `FACADE_UTILITY` 驗收 |
| 批 4 | 交通站點 4 種 | `FACADE_TRANSIT` 驗收 |
| 批 5 | 機場 3 種（含 taxiway 夜間語彙） | 佔地上限驗收 |
| 批 6 | 遊戲整合 + `HighlightManager` 屬性化 | 實機驗收 |

每一批做完就是一個可以打開 showcase 看的狀態，不必等全部完成。

---

## 9. 測試策略

TDD 每一輪：先寫失敗的測試、跑紅、實作、跑綠、**回退驗證**（暫時撤掉修正，
確認測試轉紅）。回退不轉紅就是測試有缺口，不是可以跳過的步驟。

除了常規的形狀與尺寸測試，有六條專門擋這次的失敗模式：

1. **每個 facade 類別都路由到自己的立面分支。** 擋「加了類別卻掉進辦公」——
   這是唯一會靜默發生的錯，而且是這次改動最可能踩的。
2. **每種 plan 的 footprint 與 `InfraConfig` 一致。** 擋量體溢出鄰格。
   由 `INFRA_CONFIGS` 驅動的資料表測試，新增一種建築忘了寫 plan 會轉紅。
3. **每種 plan 至少有一個 `PART_LAMP`。** 擋「做完了夜裡還是全黑」——
   這正是 BUG-238 本身，測試要讓它不能再發生。
4. **貼片層 `castShadow = false` 且底層彼此不重疊。** 擋平面鋪面投影，
   以及 z-fighting（靜態截圖看不出來的那種）。
5. **`assemble()` 的既有行為不變。** 分區建築八個變體的三角形數與包圍盒
   在 Task 0/1 前後必須逐位相同。
6. **`PART_LAMP` 不得標在燈桿上，只能標在燈頭。** BUG-230 的教訓，
   對機場的泛光燈桿特別重要。

---

## 10. 待校準（不是待決定）

以下是刻意留到有實測之後再定的數字，不是規格的缺口：

- 逐格三角形預算的四個數字（§4.6）—— 批 1 做完後用實測校準
- 四個 facade 類別各自的窗格尺寸與亮燈門檻 —— 要開 showcase 看夜景才定得下來，
  與 `SHADOW_BIAS` 一樣沒有公式
- `CIVIC_INSET` 的 0.02 格 —— 若批 1 出現與鄰格的 z-fighting 再往上調

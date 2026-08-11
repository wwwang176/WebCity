import * as THREE from 'three';
import { ZoneType } from '../../../core/grid/types';

/**
 * 零件類型寫在頂點色的 R 通道，分區類別寫在 G 通道，B 保留。
 *
 * 門檻與標籤值放在同一個檔案，是因為 shader 的判斷式是用這些數字組出來的
 * （見 BuildingMaterial.ts）。分開放的話，改了一邊不會有任何東西報錯。
 */
export const PART_WALL = 0.0;
/** 金屬／深色細節：水塔、冷氣機、天線、管架、煙囪。不畫窗戶，也不發光。 */
export const PART_DETAIL = 0.2;
/**
 * 自己會發光的東西：路燈與庭園燈的燈頭、店家的側招、廣告看板。
 *
 * 與 `PART_DETAIL` 分開是必要的 —— 這兩者原本共用一個標籤，而水塔與管架
 * 不該在晚上亮起來。標籤只有一個的話，唯一的選擇是兩者都不亮。
 *
 * 它吃 `aOccupancy`：沒有人的建築，招牌與門口的燈都是暗的。
 */
export const PART_LAMP = 0.3;
export const PART_FOLIAGE = 0.5;
/**
 * 水面：河、渡輪碼頭的港池、抽水廠的取水口。
 *
 * 與 `PART_GROUND` 分開是必要的。水原本是「一塊很暗的鋪面」（`shade` 0.02），
 * 而地面分支的色譜是柏油到磚鋪 —— 全是灰的。使用者：「渡船口的形象要改一下，
 * 看不出來是渡船」，而一座碼頭有一半的說服力來自它旁邊那片**藍色**的水。
 */
export const PART_WATER = 0.6;
/** 地面貼片：柏油、鋪面、標線。完全平，行人走在上面。 */
export const PART_GROUND = 0.7;
/**
 * 塗裝過的殼：水塔、煙囪、儲槽、冷卻塔。
 *
 * 這是唯一**照著量體自己的顏色畫**的標籤 —— 其他每一條路都會把顏色吃掉：
 *
 * - 牆走分區的立面規則。`FACADE_UTILITY` 會把它壓成 0.70～0.90 倍，
 *   再加一條高窗帶與一排紅色警示燈（一支長了窗戶的煙囪）。
 * - `PART_DETAIL` 寫死一片金屬灰，`vBldgColor` 連讀都沒讀 ——
 *   在它上面指定顏色**等於沒指定**，而且不會有任何東西報錯。
 * - `PART_GROUND` 的色譜上限只到 `vec3(0.60, 0.58, 0.55)` 的磚鋪。
 *
 * 使用者要了兩次白色的水塔，兩次都拿到灰的，就是因為三條路都到不了白色。
 */
export const PART_SHELL = 0.9;
export const PART_ROOF = 1.0;

/**
 * 塗裝外殼的明度係數：側面 `BASE`，朝上的面再加 `TOP`。
 *
 * **`BASE` 一定要 ≥ 1。** 白色被畫成灰色的機制就是這個係數 —— 牆是
 * `vBldgColor * 0.70~0.90`、`PART_DETAIL` 是寫死的 0.42~0.58。外殼如果也
 * 小於 1，`PART_SHELL` 只是把一個灰換成另一個灰，而這一版**第一次寫的
 * 正是 0.90**：截圖裡的白水塔是米灰色的。
 *
 * 頂面再提亮是因為八邊形的殼在等角視角下側面的明暗差本來就小，
 * 不提亮的話整根讀成一片沒有厚度的板子。
 */
export const SHELL_LIFT = { BASE: 1.06, TOP: 0.14 } as const;

/** shader 用來把 R 通道切段的門檻。 */
export const PART_THRESHOLDS = {
  /** 低於此值且法線朝上者視為屋頂（讓平頂不必特別標記）。 */
  ROOF_BY_NORMAL: 0.1,
  /** 細節與燈具的分界。低於它是冷的金屬，高於它會發光。 */
  LAMP_MIN: 0.25,
  FOLIAGE_MIN: 0.35,
  FOLIAGE_MAX: 0.55,
  /** 水面。夾在草地與鋪面之間那一段。 */
  WATER_MIN: 0.55,
  WATER_MAX: 0.65,
  GROUND_MIN: 0.65,
  GROUND_MAX: 0.8,
  /**
   * 塗裝外殼。夾在鋪面與屋頂之間 —— 那一段原本是空號。
   *
   * 放在這裡而不是塞進 0.1～0.25 那幾段之間：那邊最寬只剩 0.025 的空隙，
   * 而頂點色是 Float32、GLSL 的 highp 也只有約 7 位有效數字。這裡上下各
   * 留 0.05，與其他每一段一樣寬。
   */
  SHELL_MIN: 0.85,
  SHELL_MAX: 0.95,
  ROOF_MIN: 0.95,
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

/**
 * 公共建築的立面類別。
 *
 * 它們與 `ZoneType` 共用 `ZONE_CAT` 這張表，所以**編號不能相撞** ——
 * `ZoneType` 是 0–6，這裡從 101 起跳。撞號的話後寫的那一筆會靜靜地蓋掉
 * 前一筆，而表現只是「某一區的屋頂顏色怪怪的」。
 *
 * 公共建築沒有 `ZoneType`（它們的格子是基礎設施，不是分區），所以這幾個
 * 數字不對應任何遊戲狀態 —— 它們只是頂點色 G 通道的編碼。
 */
export const FACADE_CIVIC = 101;
export const FACADE_UTILITY = 102;
export const FACADE_TRANSIT = 103;
export const FACADE_GREEN = 104;

/**
 * 分區類別常數（寫在頂點色 G 通道）。
 *
 * shader 的立面 if 鏈與屋頂色票鏈**都由這張表生成**（見 `BuildingMaterial`
 * 的 `catChainGlsl`）。加一列就會長出一個分支，所以 `FACADE_BODY` 也必須
 * 跟著加 —— 少了會在模組載入時當場丟例外，不會靜靜地畫成純色牆。
 */
export const ZONE_CAT: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]:  0.0,
  [ZoneType.RESIDENTIAL_HIGH]: 0.2,
  [ZoneType.COMMERCIAL_LOW]:   0.4,
  [ZoneType.COMMERCIAL_HIGH]:  0.6,
  [ZoneType.INDUSTRIAL]:       0.8,
  [ZoneType.OFFICE]:           1.0,
  [FACADE_CIVIC]:              1.2,
  [FACADE_UTILITY]:            1.4,
  [FACADE_TRANSIT]:            1.6,
  [FACADE_GREEN]:              1.8,
};

/**
 * 這份幾何有幾個三角形。
 *
 * `position.count / 3` 只有在非索引幾何上才對。所有建築幾何都經過
 * `mergeGeometries`，輸入是 Box / Sphere / Cylinder / Cone —— 全部索引，
 * 頂點會被多個面共用，所以那個算法少報三到五成（BUG-223）。
 */
export function triangleCount(geo: THREE.BufferGeometry): number {
  return geo.index
    ? geo.index.count / 3
    : geo.getAttribute('position').count / 3;
}

export function stampZoneCategory(geo: THREE.BufferGeometry, cat: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 1] = cat;
  }
}

/**
 * 地面明度寫進頂點色的 B 通道（原本保留未用）。0 = 柏油，1 = 磚鋪。
 *
 * 用頂點而不用 `aSeed`：同一份貼片幾何裡要同時有深色柏油車道與淺色人行道，
 * 而 `aSeed` 是逐實例的 —— 它分不出同一個 mesh 內的兩塊地面。
 */
export function setGroundShade(geo: THREE.BufferGeometry, shade01: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 2] = shade01;
  }
}

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
/** 地面貼片：柏油、鋪面、標線。完全平，行人走在上面。 */
export const PART_GROUND = 0.7;
export const PART_ROOF = 1.0;

/** shader 用來把 R 通道切段的門檻。 */
export const PART_THRESHOLDS = {
  /** 低於此值且法線朝上者視為屋頂（讓平頂不必特別標記）。 */
  ROOF_BY_NORMAL: 0.1,
  /** 細節與燈具的分界。低於它是冷的金屬，高於它會發光。 */
  LAMP_MIN: 0.25,
  FOLIAGE_MIN: 0.35,
  FOLIAGE_MAX: 0.65,
  GROUND_MIN: 0.65,
  GROUND_MAX: 0.8,
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

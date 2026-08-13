import * as THREE from 'three';
import { FLOOR_HEIGHT_UNITS } from '../buildings/massing/metrics';
import { floorHeightOf } from '../buildings/massing';
import type { Density } from '../buildings/registry';

/**
 * 逐實例屬性。
 *
 * 分區建築把這些值放在 `InstancedBufferAttribute` 上，一棟一份。公共建築畫的是
 * 普通的 `Mesh`（每一棟的幾何都不一樣，實例化沒有意義），所以那些屬性
 * **完全不存在** —— 而 WebGL 對沒有繫結的 attribute 一律餵 0，於是：
 *
 *   - `aSeed.x = 0` → 立面的樓層高度永遠是最小值，與量體真正的樓板線對不上
 *   - `aSeed.y = 0` → 每一棟的窗戶相位相同，整條街橫向對齊成一條線
 *   - `aOccupancy = 0` → shader 判定「沒有人」，所以**一扇燈都不會亮**
 *
 * 三者都不會報錯，只會讓這一棟看起來「怪怪的」。第三個就是 BUG-238 的現象：
 * 公共建築入夜之後整片是黑的。
 *
 * 這裡把同一份值攤到每個頂點上。非實例化的 `attribute` 就是逐頂點的，
 * 一份幾何一個值等於整棟建築共用，與遊戲的逐實例語意一致。
 */

/** shader 讀的四個逐實例屬性與各自的分量數。 */
const ATTRIBUTES: ReadonlyArray<readonly [string, number]> = [
  ['aHighlight', 1],
  ['aHighlightColor', 3],
  ['aOccupancy', 1],
  ['aSeed', 3],
  ['aBldgColor', 3],
];

export interface InstanceValues {
  /** 0..1，住戶／使用率。0 = 沒有人，所有窗戶與招牌都是暗的。 */
  occupancy: number;
  /** 交給 shader 的 aSeed：樓層節奏、相位、材質偏好。 */
  seed: readonly [number, number, number];
  /**
   * 牆的底色（`aBldgColor`）。省略時給中性灰。
   *
   * 分區建築走 `InstancedMesh.setColorAt`，所以這個值只在公共建築這條
   * 路徑上用得到。
   */
  color?: readonly [number, number, number];
}

/**
 * `aSeed.x` 的編碼 —— shader 端是 `mix(MIN, MAX, aSeed.x)`。
 *
 * 與 `BuildingRenderer.setInstanceData` 是同一條式子。兩邊各寫一份的話，
 * 展示區的窗戶橫列會與量體的樓板線錯開，而那不會有任何東西報錯。
 */
export function floorRhythm01(
  zoneType: number, density: Density, level: number, variantIndex: number,
): number {
  const fh = floorHeightOf(zoneType, density, level, variantIndex);
  return (fh - FLOOR_HEIGHT_UNITS.MIN) / (FLOOR_HEIGHT_UNITS.MAX - FLOOR_HEIGHT_UNITS.MIN);
}

/** 把逐實例的值攤成逐頂點屬性，寫進這份幾何。 */
const NEUTRAL_GREY = [0.7, 0.7, 0.7] as const;

export function stampInstanceValues(geo: THREE.BufferGeometry, v: InstanceValues): void {
  const count = geo.getAttribute('position').count;
  for (const [name, size] of ATTRIBUTES) {
    // `assembleCivic` 已經**逐量體**寫過 aBldgColor（醫院的紅十字、大學的
    // 金頂是單獨一塊量體的顏色）。整份重寫一次會把那些覆寫全部抹平，
    // 而畫面上只表現為「紅十字不見了」。
    if (name === 'aBldgColor' && geo.hasAttribute('aBldgColor')) continue;

    const arr = new Float32Array(count * size);
    if (name === 'aOccupancy') arr.fill(v.occupancy);
    if (name === 'aSeed' || name === 'aBldgColor') {
      const src = name === 'aSeed' ? v.seed : (v.color ?? NEUTRAL_GREY);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = src[0]!;
        arr[i * 3 + 1] = src[1]!;
        arr[i * 3 + 2] = src[2]!;
      }
    }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
}

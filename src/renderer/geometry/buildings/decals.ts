import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import { decalBand, GROUND_LAYERS, type Band } from './propBands';
import { tagPart, setGroundShade, PART_GROUND, PART_FOLIAGE } from './parts';
import { heightKey, type Density, type GeoBuilder } from './registry';

/**
 * 地面貼片 —— 建築腳下的鋪面。
 *
 * 完全平（單層四邊形，沒有厚度），行人走在上面，所以它是三類地面物件裡
 * 唯一每個分區都放得下的：矮物件要避開行人繞行建築的路徑，貼片不必 ——
 * 那條路徑本來就是人行道，鋪面正是它應該長的樣子。
 *
 * 有厚度的話側面會長出牆，而牆會長出窗戶。所以一律用 `PlaneGeometry`。
 *
 * 地面固定在 y = 0（`cell.elevation` 從未被 TerrainGenerator 寫入），
 * 離地高度統一由 `GROUND_LAYERS` 決定 —— 貼片與建築必須一樣高，
 * 否則前庭鋪面與牆腳對不上（BUG-224）。
 */

/** 底層鋪面的高度。實體在 `GROUND_LAYERS` —— 貼片與建築的離地高度必須一致，
 * 否則前庭鋪面與牆腳對不上（BUG-224）。 */
export const DECAL_Y = GROUND_LAYERS.DECAL;

/**
 * 標線與踏板的高度。
 *
 * 兩層是必要的：停車格線本來就疊在柏油上。但**底層彼此不得重疊** ——
 * 兩塊同高度同位置的四邊形會 z-fighting，而那在靜態截圖上看不出來、
 * 一移動鏡頭就整片閃爍。所以底層用「四個邊各自一種鋪面」的結構表達，
 * 疊放只能發生在標線層。
 */
export const MARK_Y = GROUND_LAYERS.MARKING;

const M = (metres: number) => metres / METRES_PER_CELL;

// 明度（頂點色 B 通道）：0 是柏油，1 是白漆。
const TARMAC = 0.0;
const ASPHALT_PATH = 0.22;
const CONCRETE = 0.58;
const BRICK = 0.85;
const LINE_PAINT = 1.0;

export type Side = 'n' | 's' | 'e' | 'w';

/** 一個邊的鋪面。`lawn` 走樹葉分支拿到綠色，其餘是 PART_GROUND 加明度。 */
type Surface = { kind: 'paved'; shade: number } | { kind: 'lawn' };

const paved = (shade: number): Surface => ({ kind: 'paved', shade });
const LAWN: Surface = { kind: 'lawn' };

interface Forecourt {
  /** 四個邊各自的鋪面。省略的邊不鋪。結構上不可能兩塊疊在同一邊。 */
  sides: Partial<Record<Side, Surface>>;
  /** 疊在鋪面之上的標線與踏板。 */
  marks?: Array<{ side: Side; kind: 'bays' | 'pad'; count?: number; shade?: number }>;
}

const AXIS: Record<Side, { axis: 'x' | 'z'; sign: 1 | -1 }> = {
  n: { axis: 'z', sign: -1 },
  s: { axis: 'z', sign: 1 },
  e: { axis: 'x', sign: 1 },
  w: { axis: 'x', sign: -1 },
};

/** 一塊躺平的四邊形，中心在 (cx, cz)。 */
function quad(
  cx: number, cz: number, w: number, d: number,
  y: number, part: number, shade: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2); // 朝上
  geo.translate(cx, y, cz);
  tagPart(geo, part);
  setGroundShade(geo, shade);
  return geo;
}

/** 沿著一整條邊的鋪面帶。 */
function sideQuad(band: Band, side: Side, surface: Surface): THREE.BufferGeometry {
  const { axis, sign } = AXIS[side];
  const mid = (band.inner + band.outer) / 2;
  const depth = band.outer - band.inner;
  const len = band.outer * 2;
  const part = surface.kind === 'lawn' ? PART_FOLIAGE : PART_GROUND;
  const shade = surface.kind === 'lawn' ? 0 : surface.shade;
  return axis === 'z'
    ? quad(0, sign * mid, len, depth, DECAL_Y, part, shade)
    : quad(sign * mid, 0, depth, len, DECAL_Y, part, shade);
}

/** 停車格／卸貨標線：沿著一條邊等距的短白線。 */
function bays(band: Band, side: Side, count: number): THREE.BufferGeometry[] {
  const { axis, sign } = AXIS[side];
  const mid = (band.inner + band.outer) / 2;
  const depth = (band.outer - band.inner) * 0.85;
  const span = band.outer * 1.7;
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= count; i++) {
    const t = -span / 2 + (span / count) * i;
    out.push(axis === 'z'
      ? quad(t, sign * mid, M(0.16), depth, MARK_Y, PART_GROUND, LINE_PAINT)
      : quad(sign * mid, t, depth, M(0.16), MARK_Y, PART_GROUND, LINE_PAINT));
  }
  return out;
}

/** 入口踏板／落客區：貼著一邊中段的一小塊。 */
function pad(band: Band, side: Side, shade: number): THREE.BufferGeometry {
  const { axis, sign } = AXIS[side];
  const mid = (band.inner + band.outer) / 2;
  const depth = (band.outer - band.inner) * 0.9;
  const len = band.outer * 0.8;
  return axis === 'z'
    ? quad(0, sign * mid, len, depth, MARK_Y, PART_GROUND, shade)
    : quad(sign * mid, 0, depth, len, MARK_Y, PART_GROUND, shade);
}

function buildForecourt(band: Band, f: Forecourt): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [side, surface] of Object.entries(f.sides)) {
    parts.push(sideQuad(band, side as Side, surface));
  }
  for (const m of f.marks ?? []) {
    if (m.kind === 'bays') parts.push(...bays(band, m.side, m.count ?? 4));
    else parts.push(pad(band, m.side, m.shade ?? CONCRETE));
  }
  return mergeGeometries(parts)!;
}

/**
 * 各分區的前庭。等級愈高鋪面愈完整、材質愈高級。
 *
 * 每個等級只有一個組合（不像立體物件有多個變體）：貼片在視覺上是底色，
 * 重複感來自站在上面的東西，不是地面本身。
 */
const RECIPES: Record<string, [Forecourt, Forecourt, Forecourt]> = {
  // 住宅低：草坪為主，車道與入口踏板隨等級加上
  [heightKey(ZoneType.RESIDENTIAL_LOW, 'LOW')]: [
    { sides: { n: LAWN } },
    { sides: { n: LAWN, e: LAWN, s: paved(ASPHALT_PATH) } },
    {
      sides: { n: LAWN, e: LAWN, w: LAWN, s: paved(ASPHALT_PATH) },
      marks: [{ side: 'n', kind: 'pad', shade: CONCRETE }],
    },
  ],
  // 住宅高：混凝土環，等級換進綠地與磚鋪入口
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: LAWN, s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: LAWN, s: paved(BRICK), e: paved(CONCRETE), w: LAWN },
      marks: [{ side: 's', kind: 'pad', shade: BRICK }],
    },
  ],
  // 商業低：人行道，等級換成店前磚鋪與騎樓地坪
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(BRICK), w: paved(CONCRETE) },
      marks: [{ side: 'n', kind: 'pad', shade: BRICK }],
    },
  ],
  // 商業高：人行道環 → 廣場 → 磚鋪廣場加落客區
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(CONCRETE), w: paved(BRICK) } },
    {
      sides: { n: paved(BRICK), s: paved(BRICK), e: paved(BRICK), w: paved(BRICK) },
      marks: [{ side: 's', kind: 'pad', shade: CONCRETE }, { side: 's', kind: 'bays', count: 3 }],
    },
  ],
  // 工業：柏油鋪滿，等級加卸貨標線與停車格
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]: [
    { sides: { n: paved(TARMAC), s: paved(TARMAC), e: paved(TARMAC), w: paved(TARMAC) } },
    {
      sides: { n: paved(TARMAC), s: paved(TARMAC), e: paved(TARMAC), w: paved(TARMAC) },
      marks: [{ side: 's', kind: 'bays', count: 4 }],
    },
    {
      sides: { n: paved(TARMAC), s: paved(TARMAC), e: paved(TARMAC), w: paved(TARMAC) },
      marks: [{ side: 's', kind: 'bays', count: 5 }, { side: 'w', kind: 'bays', count: 4 }],
    },
  ],
  // 辦公低：人行道 → 入口步道 → 磚鋪廣場帶綠地
  [heightKey(ZoneType.OFFICE, 'LOW')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) },
      marks: [{ side: 's', kind: 'pad', shade: BRICK }],
    },
    {
      sides: { n: paved(BRICK), s: paved(BRICK), e: paved(BRICK), w: LAWN },
      marks: [{ side: 's', kind: 'pad', shade: CONCRETE }],
    },
  ],
  // 辦公高：同商業高，但保留一塊綠地
  [heightKey(ZoneType.OFFICE, 'HIGH')]: [
    { sides: { n: paved(CONCRETE), s: paved(CONCRETE), e: paved(CONCRETE), w: paved(CONCRETE) } },
    { sides: { n: paved(CONCRETE), s: paved(BRICK), e: paved(CONCRETE), w: paved(CONCRETE) } },
    {
      sides: { n: paved(BRICK), s: paved(BRICK), e: paved(BRICK), w: LAWN },
      marks: [{ side: 's', kind: 'pad', shade: CONCRETE }, { side: 'n', kind: 'bays', count: 3 }],
    },
  ],
};

/** 這個 (分區, 密度, 等級) 的前庭。沒有貼片帶就沒有前庭。 */
export function getDecalVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  const band = decalBand(zoneType, density);
  if (!band) return [];
  const recipes = RECIPES[heightKey(zoneType, density)];
  if (!recipes) return [];
  const forecourt = recipes[Math.max(1, Math.min(3, level)) - 1]!;
  return [() => buildForecourt(band, forecourt)];
}

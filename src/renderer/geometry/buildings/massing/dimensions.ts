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
  for (let floors = 1; floors <= 64; floors++) {
    for (let s = 0; s < FLOOR_SAMPLES; s++) {
      const floorHeight = floorHeightSample(s);
      const height = floors * floorHeight;
      if (height >= lo && height <= hi) out.push({ floors, floorHeight, height });
    }
  }

  // 空清單在容差有一層樓下限的前提下到不了：`1 層 × MIN` 永遠落在
  // [目標 − 一層樓, 目標 + 一層樓] 之內，因為 MIN < 一層樓的中點。
  // 真的空了就是有人把容差改窄了 —— 當場炸掉比讓呼叫端拿到 undefined
  // 然後在別的地方爆炸好追一百倍。
  if (out.length === 0) {
    throw new Error(`目標高度 ${targetUnits} 湊不出任何整數層組合`);
  }

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

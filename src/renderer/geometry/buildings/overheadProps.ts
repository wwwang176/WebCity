import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import {
  overheadBand, OVERHEAD_CLEARANCE, SHOPFRONT_CEILING, type Band,
} from './propBands';
import { tagPart, PART_DETAIL, PART_ROOF } from './parts';
import { heightKey, type Density, type GeoBuilder } from './registry';

/**
 * 懸挑物件 —— 掛在建築外、行人從下面走過的東西。
 *
 * 三類地面物件裡限制最寬鬆的一類：矮物件不能越過行人包絡線（會擋路），
 * 懸挑可以，只要最低點高過人頭。真實的騎樓正是這樣運作的。
 *
 * 所以商業街不必為了雨遮把建築改窄 —— 那 1.5 m 的挑出本來就該在人行道
 * 上方。這一層存在的唯一理由就是它挑得出去；縮在建築輪廓裡的東西是立面
 * 零件（階段 3），不是懸挑。
 *
 * 幾何以真實尺寸撰寫（1 格 = 12 m），與矮物件層一樣不吃任何縮放。
 */

/**
 * 每個懸挑組合的三角形上限。
 *
 * 改用雙面平面之後實際最大值是 12（兩片雨遮加一面招牌），所以 160 那個
 * 上限等於沒有上限 —— 預算要貼著現實才擋得住下一次退化。
 */
export const OVERHEAD_TRIANGLE_BUDGET = 24;

const M = (metres: number) => metres / METRES_PER_CELL;

type Axis = 'x' | 'z';
type Sign = 1 | -1;

const AXIS: Record<Side, { axis: Axis; sign: Sign }> = {
  n: { axis: 'z', sign: -1 },
  s: { axis: 'z', sign: 1 },
  e: { axis: 'x', sign: 1 },
  w: { axis: 'x', sign: -1 },
};

export type Side = 'n' | 's' | 'e' | 'w';

function place(axis: Axis, sign: Sign, t: number, d: number): [number, number] {
  return axis === 'z' ? [t, sign * d] : [sign * d, t];
}

/**
 * 雨遮從牆到外緣的下垂量。
 *
 * 上緣貼一樓樓板線 2.64 m，所以外緣落在 2.64 − 0.36 = 2.28 m，仍高過行人
 * 淨空 2.2 m。斜面不只是好看：它讓法線帶著向上的分量，而鏡頭的仰角永遠
 * 大於 0，所以正面永遠朝著鏡頭那一側。
 */
const AWNING_DROP = M(0.36);

type Vec3 = [number, number, number];

/**
 * 一片雙面的四邊形。
 *
 * 懸挑物原本用 `BoxGeometry`，但雨遮只有 10 cm 厚 —— 在 1 格 = 12 m 的
 * 尺度下永遠不到一個像素，六個面裡有五個是白給的。改用平面之後每片從
 * 12 個三角形降到 4 個。
 *
 * 為什麼是「雙面」而不是單面：建築材質沒有設 `side`，也就是預設的
 * `FrontSide`，而鏡頭的方位角可以自由轉 —— 單面的招牌轉到背面就整片消失。
 * 兩面各給一組頂點（法線相反，不能共用頂點），culling 會自動只畫朝著鏡頭
 * 的那一面。
 */
function panel(corners: [Vec3, Vec3, Vec3, Vec3], part: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const [a, b, c, d] = corners;
  const front = [a, b, c, a, c, d];
  const back = [a, c, b, a, d, c];
  const pos = new Float32Array(36);
  [...front, ...back].forEach((v, i) => pos.set(v, i * 3));
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // 六個角落 → 兩組四頂點：測試靠「每個零件 8 個頂點」拆回零件。
  const merged = mergeVertices(geo, 1e-6);
  tagPart(merged, part);
  return merged;
}

/** 沿著一條邊，從牆面 `inner` 到 `outer` 的一片斜板／立板。 */
function spanFromWall(
  b: Band, side: Side, len: number, innerY: number, outerY: number,
  reachFrac: number, part: number,
): THREE.BufferGeometry {
  const { axis, sign } = AXIS[side];
  const near = b.inner;
  const far = b.inner + (b.outer - b.inner) * reachFrac;
  const at = (d: number, t: number, y: number): Vec3 => {
    const [x, z] = place(axis, sign, t, d);
    return [x, y, z];
  };
  return panel([
    at(near, -len / 2, innerY), at(near, len / 2, innerY),
    at(far, len / 2, outerY), at(far, -len / 2, outerY),
  ], part);
}

/**
 * 雨遮／遮陽棚：一片從牆往外下斜的板。
 *
 * 原本是「平板 + 兩根斜撐」三個零件。斜撐是懸在板子下方的橫桿，遠看只是
 * 兩條浮空的線；斜面本身就給出了遠看認得出「這是雨遮」的輪廓，而且只要
 * 一個零件。
 */
function awning(
  b: Band, side: Side, lengthFrac: number, topUnits: number,
): THREE.BufferGeometry[] {
  return [spanFromWall(
    b, side, b.outer * 2 * lengthFrac,
    topUnits, topUnits - AWNING_DROP, 1, PART_ROOF,
  )];
}

/**
 * 立體招牌：從牆面垂直挑出的小板子，掛在雨遮上方。
 *
 * 起點在牆上而不是懸挑帶的中線 —— 招牌是鎖在牆上的，中線那個位置沒有東西
 * 撐得住它。板面與牆垂直，所以它是這一層裡最需要雙面的零件。
 */
function blade(b: Band, side: Side, yUnits: number, sizeM: number) {
  const { axis, sign } = AXIS[side];
  const half = M(sizeM) / 2;
  const near = b.inner;
  const far = b.inner + (b.outer - b.inner) * 0.75;
  const at = (d: number, y: number): Vec3 => {
    const [x, z] = place(axis, sign, 0, d);
    return [x, y, z];
  };
  return panel([
    at(near, yUnits - half), at(far, yUnits - half),
    at(far, yUnits + half), at(near, yUnits + half),
  ], PART_DETAIL);
}

/** 看板：貼著立面一整條的長板，離牆一點點免得與牆共面。 */
function billboard(b: Band, side: Side, lengthFrac: number, yUnits: number) {
  const half = M(1.1) / 2;
  return spanFromWall(
    b, side, b.outer * 2 * lengthFrac,
    yUnits + half, yUnits - half, 0.08, PART_DETAIL,
  );
}

/** 卸貨雨棚：比一般雨遮長，工業用。高度與店面雨遮相同，理由見 `SHOPFRONT_CEILING`。 */
function loadingCanopy(b: Band, side: Side) {
  return awning(b, side, 0.85, SHOPFRONT_CEILING);
}

type Recipe = (b: Band) => THREE.BufferGeometry[];

/**
 * 招牌的高度。
 *
 * 以一樓樓板線為單位而不是手挑公尺數：手挑的話會出現「3.9 m 的招牌掛在
 * 5 m 高的商業低 L1 上」這種事 —— 那是建築的八成高，看起來像屋頂裝飾
 * 而不是店招。
 */
const SIGN_Y = SHOPFRONT_CEILING * 1.5;
const BILLBOARD_Y = SHOPFRONT_CEILING * 1.9;

/**
 * 各分區的懸挑物。
 *
 * 住宅低沒有 —— 獨棟住宅沒有騎樓也沒有招牌，硬加會讓它看起來像店面。
 */
const COMMERCIAL_LOW: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.8, SHOPFRONT_CEILING)],
  [
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), blade(b, 's', SIGN_Y, 0.8)],
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), ...awning(b, 'e', 0.7, SHOPFRONT_CEILING),
          blade(b, 's', SIGN_Y, 0.7)],
  ],
];

const COMMERCIAL_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [b => awning(b, 's', 0.5, SHOPFRONT_CEILING)],
  [b => [...awning(b, 's', 0.7, SHOPFRONT_CEILING), blade(b, 'e', SIGN_Y, 0.9)]],
  [
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), ...awning(b, 'e', 0.9, SHOPFRONT_CEILING),
          billboard(b, 'n', 0.9, BILLBOARD_Y)],
    b => [...awning(b, 's', 0.95, SHOPFRONT_CEILING), ...awning(b, 'w', 0.9, SHOPFRONT_CEILING),
          blade(b, 's', SIGN_Y, 1.0)],
  ],
];

const OFFICE: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.5, SHOPFRONT_CEILING)],
  [
    b => [...awning(b, 's', 0.7, SHOPFRONT_CEILING), blade(b, 's', SIGN_Y, 0.7)],
    b => [...awning(b, 's', 0.65, SHOPFRONT_CEILING), ...awning(b, 'e', 0.5, SHOPFRONT_CEILING)],
  ],
];

const INDUSTRIAL: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => loadingCanopy(b, 's')],
  [
    b => [...loadingCanopy(b, 's'), ...loadingCanopy(b, 'w')],
    b => [...loadingCanopy(b, 's'), blade(b, 'n', SIGN_Y, 0.9)],
  ],
];

const RES_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.4, SHOPFRONT_CEILING)],
  [b => [...awning(b, 's', 0.55, SHOPFRONT_CEILING), ...awning(b, 'n', 0.4, SHOPFRONT_CEILING)]],
];

const RECIPES: Record<string, [Recipe[], Recipe[], Recipe[]]> = {
  [heightKey(ZoneType.RESIDENTIAL_HIGH, 'HIGH')]: RES_HIGH,
  [heightKey(ZoneType.COMMERCIAL_LOW, 'LOW')]:    COMMERCIAL_LOW,
  [heightKey(ZoneType.COMMERCIAL_HIGH, 'HIGH')]:  COMMERCIAL_HIGH,
  [heightKey(ZoneType.INDUSTRIAL, 'LOW')]:        INDUSTRIAL,
  [heightKey(ZoneType.OFFICE, 'LOW')]:            OFFICE,
  [heightKey(ZoneType.OFFICE, 'HIGH')]:           OFFICE,
};

/** 這個 (分區, 密度, 等級) 的懸挑物。住宅低與 L1 的多數分區沒有。 */
export function getOverheadVariants(
  zoneType: number, density: Density, level: number,
): GeoBuilder[] {
  const band = overheadBand(zoneType, density, level);
  if (!band) return [];
  const byLevel = RECIPES[heightKey(zoneType, density)];
  if (!byLevel) return [];
  const recipes = byLevel[Math.max(1, Math.min(3, level)) - 1]!;
  return recipes.map(recipe => () => mergeGeometries(recipe(band))!);
}

/** 淨空常數轉出，讓幾何作者不必自己算。 */
export { OVERHEAD_CLEARANCE };

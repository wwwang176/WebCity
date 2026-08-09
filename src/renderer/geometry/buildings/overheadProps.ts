import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

export const OVERHEAD_TRIANGLE_BUDGET = 160;

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

/** 雨遮板厚與雨簷板的下垂量。兩者相加要塞進 [淨空, 一樓樓板線] 那條帶子。 */
const SLAB_THICKNESS = M(0.10);
const FASCIA_DROP = M(0.26);

/**
 * 從牆面往外挑出的一塊板。
 *
 * 內緣是 `band.inner` —— 也就是**抖到最窄**的那一棟的牆面（見 propBands）。
 * 多出來的部分埋在較寬的那些建築的牆裡、被擋住，看不見。這是唯一能讓一份
 * 共用幾何在每一棟上都貼牆的做法（BUG-226）。
 *
 * `inset` 讓招牌之類的小零件只挑出一部分，但起點仍在牆上。
 */
function slabFromWall(
  b: Band, side: Side, len: number, thickness: number, y: number,
  part: number, inset = 0,
): THREE.BufferGeometry {
  const { axis, sign } = AXIS[side];
  const reach = (b.outer - b.inner) * (1 - inset);
  const mid = b.inner + reach / 2;
  const geo = axis === 'z'
    ? new THREE.BoxGeometry(len, thickness, reach)
    : new THREE.BoxGeometry(reach, thickness, len);
  const [x, z] = place(axis, sign, 0, mid);
  geo.translate(x, y, z);
  tagPart(geo, part);
  return geo;
}

/**
 * 雨遮／遮陽棚：一片平板加外緣的雨簷板。
 *
 * 頂面貼齊 `topUnits`（店面用一樓樓板線）。原本的斜撐改成雨簷板：斜撐是
 * 三根懸在板子下方的橫桿，遠看只是三條浮空的線；雨簷板貼著板子的外緣往下，
 * 那才是遠看認得出「這是雨遮」的那個輪廓，而且少一個零件。
 */
function awning(
  b: Band, side: Side, lengthFrac: number, topUnits: number,
): THREE.BufferGeometry[] {
  const { axis, sign } = AXIS[side];
  const len = b.outer * 2 * lengthFrac;
  const slabY = topUnits - SLAB_THICKNESS / 2;

  const slab = slabFromWall(b, side, len, SLAB_THICKNESS, slabY, PART_ROOF);

  // 雨簷板：貼著外緣往下垂。掛在雨遮上而不是牆上，所以它自己碰不到牆 ——
  // 靠雨遮連著。
  const lip = M(0.10);
  const fascia = axis === 'z'
    ? new THREE.BoxGeometry(len, FASCIA_DROP, lip)
    : new THREE.BoxGeometry(lip, FASCIA_DROP, len);
  const [fx, fz] = place(axis, sign, 0, b.outer - lip / 2);
  fascia.translate(fx, slabY - SLAB_THICKNESS / 2 - FASCIA_DROP / 2, fz);
  tagPart(fascia, PART_DETAIL);

  return [slab, fascia];
}

/**
 * 立體招牌：從牆面垂直挑出的小板子，掛在雨遮上方。
 *
 * 起點在牆上而不是懸挑帶的中線 —— 招牌是鎖在牆上的，中線那個位置沒有東西
 * 撐得住它。
 */
function blade(b: Band, side: Side, yUnits: number, sizeM: number) {
  return slabFromWall(
    b, side, M(sizeM * 0.75), M(sizeM), yUnits, PART_DETAIL, 0.25,
  );
}

/** 看板：貼著立面一整條的長板，只稍微離開牆面。 */
function billboard(b: Band, side: Side, lengthFrac: number, yUnits: number) {
  return slabFromWall(
    b, side, b.outer * 2 * lengthFrac, M(1.1), yUnits, PART_DETAIL, 0.75,
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
  const band = overheadBand(zoneType, density);
  if (!band) return [];
  const byLevel = RECIPES[heightKey(zoneType, density)];
  if (!byLevel) return [];
  const recipes = byLevel[Math.max(1, Math.min(3, level)) - 1]!;
  return recipes.map(recipe => () => mergeGeometries(recipe(band))!);
}

/** 淨空常數轉出，讓幾何作者不必自己算。 */
export { OVERHEAD_CLEARANCE };

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZoneType } from '../../../core/grid/types';
import { METRES_PER_CELL } from '../../../core/grid/constants';
import { overheadBand, OVERHEAD_CLEARANCE, type Band } from './propBands';
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

/**
 * 雨遮／遮陽棚：一片斜板加兩根斜撐。
 *
 * 內緣貼著建築牆面（`band.inner`），外緣挑到 `band.outer`。這個「內緣要碰到
 * 牆」不是美觀問題 —— 少了它雨遮會浮在半空。
 */
function awning(
  b: Band, side: Side, lengthFrac: number, heightM: number,
): THREE.BufferGeometry[] {
  const { axis, sign } = AXIS[side];
  const reach = b.outer - b.inner;
  const mid = (b.inner + b.outer) / 2;
  const len = b.outer * 2 * lengthFrac;
  const y = M(heightM);
  const out: THREE.BufferGeometry[] = [];

  const slab = axis === 'z'
    ? new THREE.BoxGeometry(len, M(0.12), reach)
    : new THREE.BoxGeometry(reach, M(0.12), len);
  const [sx, sz] = place(axis, sign, 0, mid);
  slab.translate(sx, y, sz);
  tagPart(slab, PART_ROOF);
  out.push(slab);

  // 斜撐：從牆面下方拉到雨遮外緣下方。放在雨遮正下方而不是真的傾斜 ——
  // 旋轉之後包圍盒會外擴，那會讓「不越過格子邊界」變成算不準的事。
  for (const t of [-len / 2 + M(0.3), len / 2 - M(0.3)]) {
    const strut = axis === 'z'
      ? new THREE.BoxGeometry(M(0.09), M(0.09), reach)
      : new THREE.BoxGeometry(reach, M(0.09), M(0.09));
    const [x, z] = place(axis, sign, t, mid);
    strut.translate(x, y - M(0.3), z);
    tagPart(strut, PART_DETAIL);
    out.push(strut);
  }
  return out;
}

/** 立體招牌：垂直掛在牆外的板子。 */
function blade(b: Band, side: Side, t: number, heightM: number, sizeM: number) {
  const { axis, sign } = AXIS[side];
  const mid = (b.inner + b.outer) / 2;
  const [x, z] = place(axis, sign, t, mid);
  const board = axis === 'z'
    ? new THREE.BoxGeometry(M(sizeM), M(sizeM * 0.75), M(0.1))
    : new THREE.BoxGeometry(M(0.1), M(sizeM * 0.75), M(sizeM));
  board.translate(x, M(heightM), z);
  tagPart(board, PART_DETAIL);
  return board;
}

/** 看板：貼著建築頂部一整條的長板。 */
function billboard(b: Band, side: Side, lengthFrac: number, heightM: number) {
  const { axis, sign } = AXIS[side];
  const mid = (b.inner + b.outer) / 2;
  const len = b.outer * 2 * lengthFrac;
  const [x, z] = place(axis, sign, 0, mid);
  const board = axis === 'z'
    ? new THREE.BoxGeometry(len, M(1.1), M(0.14))
    : new THREE.BoxGeometry(M(0.14), M(1.1), len);
  board.translate(x, M(heightM), z);
  tagPart(board, PART_DETAIL);
  return board;
}

/** 卸貨雨棚：比一般雨遮長、比較低，工業用。 */
function loadingCanopy(b: Band, side: Side) {
  return awning(b, side, 0.85, 3.4);
}

type Recipe = (b: Band) => THREE.BufferGeometry[];

/**
 * 各分區的懸挑物。
 *
 * 住宅低沒有 —— 獨棟住宅沒有騎樓也沒有招牌，硬加會讓它看起來像店面。
 */
const COMMERCIAL_LOW: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.8, 3.0)],
  [
    b => [...awning(b, 's', 0.95, 3.2), blade(b, 's', 0.28, 3.9, 0.8)],
    b => [...awning(b, 's', 0.95, 3.0), ...awning(b, 'e', 0.7, 3.0),
          blade(b, 's', -0.3, 3.8, 0.7)],
  ],
];

const COMMERCIAL_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [b => awning(b, 's', 0.5, 3.6)],
  [b => [...awning(b, 's', 0.7, 3.6), blade(b, 'e', 0.1, 4.2, 0.9)]],
  [
    b => [...awning(b, 's', 0.95, 3.8), ...awning(b, 'e', 0.9, 3.8),
          billboard(b, 'n', 0.9, 5.2)],
    b => [...awning(b, 's', 0.95, 3.6), ...awning(b, 'w', 0.9, 3.6),
          blade(b, 's', 0.3, 4.6, 1.0)],
  ],
];

const OFFICE: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.5, 3.4)],
  [
    b => [...awning(b, 's', 0.7, 3.6), blade(b, 's', 0.3, 4.2, 0.7)],
    b => [...awning(b, 's', 0.65, 3.4), ...awning(b, 'e', 0.5, 3.4)],
  ],
];

const INDUSTRIAL: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => loadingCanopy(b, 's')],
  [
    b => [...loadingCanopy(b, 's'), ...loadingCanopy(b, 'w')],
    b => [...loadingCanopy(b, 's'), blade(b, 'n', 0, 4.4, 0.9)],
  ],
];

const RES_HIGH: [Recipe[], Recipe[], Recipe[]] = [
  [],
  [b => awning(b, 's', 0.4, 3.0)],
  [b => [...awning(b, 's', 0.55, 3.2), ...awning(b, 'n', 0.4, 3.2)]],
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

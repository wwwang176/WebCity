import { MAX_BUILDING_WIDTH_M, METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * 量體生成器與地面物件層共用的純量常數。
 *
 * 這個模組**不 import 任何本套件內的東西**，那是它存在的理由：`propBands` 要量
 * `massing` 產出的量體，而 `massing` 要用 `SHOPFRONT_CEILING` —— 常數留在
 * `propBands` 裡就是一個 import 循環。
 */

/** 公尺 → 格。1 格 = 12 m。 */
export function M(metres: number): number {
  return metres / METRES_PER_CELL;
}

/**
 * 行人包絡線半寬。
 *
 * `SidewalkGraph` 的門節點放在這裡外側，所以建築越過它就是行人走進牆裡
 * （BUG-221）。實體是 `MAX_BUILDING_WIDTH_M`，這裡只換算單位 —— 自己寫一個
 * 數字就會漂移，而漂移不會有任何東西報錯。
 */
export const HALF_ENVELOPE = MAX_BUILDING_WIDTH_M / METRES_PER_CELL / 2;

/** 格子邊界。再過去就是鄰居家或馬路。 */
export const CELL_EDGE = 0.5;

/** 行人頭頂淨空 2.2 m。低於它的懸挑物會打到人。 */
export const OVERHEAD_CLEARANCE = M(2.2);

/**
 * 立面 shader 的樓層高度範圍（格）。2.64 m 到 3.6 m。
 *
 * 實體在這裡而不是 GLSL 裡：量體的樓層數要用它，而幾何與 shader 對不上的話，
 * 雨遮會掛在窗戶中間 —— 那種錯不會有任何東西報錯。
 */
export const FLOOR_HEIGHT_UNITS = { MIN: 0.22, MAX: 0.30 } as const;

/**
 * 一樓樓板線 —— 掛在店面上的東西不得高過它。
 *
 * 取**最低**的樓高：每一棟的樓高由變體決定，懸挑物的幾何是整桶共用的一份，
 * 不知道自己掛在哪一個變體上。取最低值才保證永遠不會越過一樓。
 */
export const SHOPFRONT_CEILING = FLOOR_HEIGHT_UNITS.MIN;

/**
 * 斜屋頂的高度佔一層樓的比例。
 *
 * 壓在半層樓以內，否則建築的總高度就不是「樓層數 × 樓高」，等級階梯會漂掉。
 *
 * 住在這裡而不是 `roofForms`：組合器要靠它替屋脊留位置 —— 工業的煙囪必須
 * 露在屋脊之上，而組合器算高度時屋頂還不存在。兩邊各寫一份 0.45 的話，
 * 改了屋頂之後煙囪會被埋掉，而那不會有任何東西報錯。
 */
export const ROOF_PITCH_FRAC = 0.45;

/**
 * 開口容器的比例：`tub`（圓槽）與 `basin`（方池）共用一組。
 *
 * 這組數字必須是共用的，因為**放水面的是量體資料、挖槽的是幾何** —— 兩邊
 * 各寫一份的話，水面會浮在槽緣上或沉到槽底之下，而兩者都不會報錯：多的那一段
 * 藏在實心的池壁裡，看起來只是「水位不太對」。
 */
export const TUB = {
  /** 內壁佔宣告寬度的幾成。剩下的一成六是池壁的厚度（兩側各 8%）。 */
  INNER: 0.84,
  /** 槽緣到槽底的深度，佔全高的比例。 */
  DEPTH: 0.28,
} as const;

/**
 * 煙囪的比例。
 *
 * `DEPTH` 幾乎等於全高：管口的直徑只有塔身的一半，等角視角斜著看進去只看得到
 * 很小的一塊，凹槽淺的時候那一塊仍然亮著，讀起來是頂蓋上的一道陰影而不是
 * 一個洞。深到接近底部，看進去的才全是背光的內壁。
 */
export const STACK = {
  /** 管口內緣的半徑，佔宣告寬度的一半的幾成。 */
  BORE: 0.26,
  /** 塔身收到頂端剩多少 —— 真實煙囪都是微微收的。 */
  COLLAR: 0.44,
  /** 凹槽深度佔全高的比例。 */
  DEPTH: 0.86,
} as const;

/** 冷卻塔的腰在高度的幾成。0.65 ≈ 實際冷卻塔的比例。 */
const COOL_WAIST = 0.65;
/** 雙曲線的收斂速度。愈小腰愈細。 */
const COOL_C = 0.85;
const COOL_RINGS = 6;
/** 塔口折回去之後的內緣，佔塔頂外緣的幾成。 */
const COOL_LIP = 0.86;

/** 側面輪廓的半徑：r(t) = √(1 + ((t − waist) / c)²)。 */
function coolRadius(t: number): number {
  return Math.sqrt(1 + ((t - COOL_WAIST) / COOL_C) ** 2);
}

/** 最寬的一圈（底座）正規化成半徑 0.5，縮放之後剛好填滿宣告的盒子。 */
const COOL_NORM = 0.5 / Math.max(
  ...Array.from({ length: COOL_RINGS + 1 }, (_, i) => coolRadius(i / COOL_RINGS)));

/**
 * 冷卻塔的比例。
 *
 * `RIM` 與 `THROAT` 是**算出來的**而不是抄的：它們由雙曲線與 `COOL_LIP`
 * 決定，而航警燈要站在兩者之間那一圈環上。手寫一組數字的話，哪天腰的參數
 * 一動，燈就會掉進塔口或掛到塔外面 —— 而那不會有任何東西報錯。
 */
export const COOL = {
  /** 塔口凹槽的深度，佔全高的比例。 */
  DEPTH: 0.22,
  /** 塔頂外緣的直徑，佔宣告寬度的幾成。 */
  RIM: coolRadius(1) * COOL_NORM * 2,
  /** 塔口的直徑佔比。 */
  THROAT: coolRadius(1) * COOL_NORM * COOL_LIP * 2,
} as const;

/**
 * 冷卻塔的側面輪廓：`[半徑, 高度]`，兩者都已正規化。
 *
 * 塔口折進去再往下 —— 這一段修的是俯視時的破口。輪廓走到頂就停的話，上下
 * 都沒有蓋，也就是一根開口的管子；建築材質是 `FrontSide`，視角一高、看得進
 * 塔口的時候，對面的內壁被背面剔除，看到的是穿過去的背景。
 *
 * 補一片平蓋是錯的答案：真實的冷卻塔頂上就是開的，蓋起來它會變成筒倉。
 * 折回去的這一段法線朝向軸心，所以俯視看到的是**內壁**，而那正是凹槽。
 */
export function coolingProfile(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= COOL_RINGS; i++) {
    const t = i / COOL_RINGS;
    pts.push([coolRadius(t) * COOL_NORM, t]);
  }
  const lip = pts[pts.length - 1]![0] * COOL_LIP;
  pts.push([lip, 1]);
  pts.push([lip, 1 - COOL.DEPTH]);
  pts.push([0, 1 - COOL.DEPTH]);
  return pts;
}

/**
 * 貼著地面的東西該放多高（格）。
 *
 * 這張表存在的理由是 BUG-224：分區建築原本放在 y = 0.05，那是**路面**的高度，
 * 不是地面的高度，所以每一棟都浮空 0.6 m。這些數字彼此有順序關係（標線要疊在
 * 鋪面上），散在四個檔案裡改一個就會壓到另一個。
 */
export const GROUND_LAYERS = {
  /** 建築與地面物件的底面。2.4 cm 足以避開與地形共面的 z-fighting。 */
  BUILDING: 0.002,
  /** 鋪面貼片。與建築同高，兩者在平面上不重疊。 */
  DECAL: 0.002,
  /** 停車格線與入口踏板，疊在鋪面上。 */
  MARKING: 0.003,
  /** 夜間的地面光暈，疊在標線上。 */
  LIGHT_SPOT: 0.004,
} as const;

import type { AirportSize } from '../core/transport/AirportSystem';

/**
 * 機場的飛行路徑 —— **整個專案唯一的一份機場配置**。
 *
 * 這張表原本住在 `AirplaneAnimator.ts` 裡，而 `civic/models/airport.ts` 的
 * 裝飾幾何另外照「一座機場長什麼樣」畫了第二份。兩份都合理，只是講的不是
 * 同一座機場：小型機場的動畫跑道在 z = +1.20（前側），裝飾幾何的跑道帶卻在
 * z ∈ [−2.00, −0.83]（後側）—— 接起來的那一刻飛機會沿著航廈的屋頂降落
 * （BUG-239）。
 *
 * **路徑表是權威。** 它是調過、測過、而且在畫面上會動的東西；改它的風險遠高
 * 於改一組靜態貼片。所以跑道帶、滑行道標線、停機位與航廈的位置全部從這裡
 * 推導 —— `airport.ts` 不准自己決定任何一個 z。
 *
 * 座標單位是**格**，原點是機場佔地的中心，rotation = 0。
 */

export interface Vec2 { x: number; z: number }

export interface SizeFlightPaths {
  approachStart: Vec2;
  threshold: Vec2;
  /** Roll stop: before right junction, leaving arc space. */
  rollStop: Vec2;
  /** Right taxiway junction on runway. */
  rightJunction: Vec2;
  /** Top of right taxiway at apron level. */
  rightTaxiTop: Vec2;
  /** Z level for horizontal apron taxi. */
  apronZ: number;
  /** Left taxiway top at apron level. */
  leftTaxiTop: Vec2;
  /** Left taxiway junction on runway. */
  leftJunction: Vec2;
  /** Short distance onto runway from leftJunction (for arc detection). */
  runwayEntry: Vec2;
  gates: Vec2[];
  takeoffEnd: Vec2;
  climbEnd: Vec2;
  /** Arc radius for taxiway turns. */
  arcRadius: number;
  /** Smaller arc radius for the gate approach turn. */
  gateRadius: number;
}

// SMALL (5×4): left taxi x=-1.80, right taxi x=+1.80 (old Medium layout)
export const SMALL_PATHS: SizeFlightPaths = {
  approachStart:   { x: -11.3, z: 1.20 },
  threshold:       { x: -2.00, z: 1.20 },
  rollStop:        { x: 1.30, z: 1.20 },
  rightJunction:   { x: 1.80, z: 1.20 },
  rightTaxiTop:    { x: 1.80, z: -0.10 },
  apronZ:          -0.10,
  leftTaxiTop:     { x: -1.80, z: -0.10 },
  leftJunction:    { x: -1.80, z: 1.20 },
  runwayEntry:     { x: -1.30, z: 1.20 },
  gates:           [{ x: -0.60, z: -0.34 }, { x: 0, z: -0.34 }, { x: 0.60, z: -0.34 }],
  takeoffEnd:      { x: 2.25, z: 1.20 },
  climbEnd:        { x: 7.0, z: 1.20 },
  arcRadius:       0.35,
  gateRadius:      0.20,
};

// MEDIUM (7×4): left taxi x=-2.80, right taxi x=+2.80
export const MEDIUM_PATHS: SizeFlightPaths = {
  approachStart:   { x: -12.3, z: 1.20 },
  threshold:       { x: -3.00, z: 1.20 },
  rollStop:        { x: 2.10, z: 1.20 },
  rightJunction:   { x: 2.80, z: 1.20 },
  rightTaxiTop:    { x: 2.80, z: -0.10 },
  apronZ:          -0.10,
  leftTaxiTop:     { x: -2.80, z: -0.10 },
  leftJunction:    { x: -2.80, z: 1.20 },
  runwayEntry:     { x: -2.10, z: 1.20 },
  gates:           [{ x: -0.90, z: -0.34 }, { x: -0.30, z: -0.34 }, { x: 0.30, z: -0.34 }, { x: 0.90, z: -0.34 }],
  takeoffEnd:      { x: 3.25, z: 1.20 },
  climbEnd:        { x: 8.0, z: 1.20 },
  arcRadius:       0.50,
  gateRadius:      0.20,
};

// LARGE (9×6): left taxi x=-3.80, right taxi x=+3.80
export const LARGE_PATH_A: SizeFlightPaths = {
  approachStart:   { x: -13.3, z: 0.80 },
  threshold:       { x: -4.00, z: 0.80 },
  rollStop:        { x: 3.10, z: 0.80 },
  rightJunction:   { x: 3.80, z: 0.80 },
  rightTaxiTop:    { x: 3.80, z: -0.80 },
  apronZ:          -0.80,
  leftTaxiTop:     { x: -3.80, z: -0.80 },
  leftJunction:    { x: -3.80, z: 0.80 },
  runwayEntry:     { x: -3.10, z: 0.80 },
  gates:           [{ x: -1.50, z: -1.28 }, { x: -0.50, z: -1.28 }],
  takeoffEnd:      { x: 4.25, z: 0.80 },
  climbEnd:        { x: 9.0, z: 0.80 },
  arcRadius:       0.65,
  gateRadius:      0.43,
};

export const LARGE_PATH_B: SizeFlightPaths = {
  approachStart:   { x: -13.3, z: 2.20 },
  threshold:       { x: -4.00, z: 2.20 },
  rollStop:        { x: 3.10, z: 2.20 },
  rightJunction:   { x: 3.80, z: 2.20 },
  rightTaxiTop:    { x: 3.80, z: -0.80 },
  apronZ:          -0.80,
  leftTaxiTop:     { x: -3.80, z: -0.80 },
  leftJunction:    { x: -3.80, z: 2.20 },
  runwayEntry:     { x: -3.10, z: 2.20 },
  gates:           [{ x: 0.50, z: -1.28 }, { x: 1.50, z: -1.28 }],
  takeoffEnd:      { x: 4.25, z: 2.20 },
  climbEnd:        { x: 9.0, z: 2.20 },
  arcRadius:       0.65,
  gateRadius:      0.43,
};

/** 這個尺寸有幾條獨立的航路。大型機場有兩條平行跑道。 */
export const AIRPORT_PATH_COUNT: Record<AirportSize, number> = {
  SMALL: 1, MEDIUM: 1, LARGE: 2,
};

export function getFlightPaths(size: AirportSize, pathIndex: number): SizeFlightPaths {
  if (size === 'SMALL') return SMALL_PATHS;
  if (size === 'MEDIUM') return MEDIUM_PATHS;
  return pathIndex === 0 ? LARGE_PATH_A : LARGE_PATH_B;
}

/** 這個尺寸的所有航路。 */
export function allFlightPaths(size: AirportSize): SizeFlightPaths[] {
  return Array.from({ length: AIRPORT_PATH_COUNT[size] }, (_, i) => getFlightPaths(size, i));
}

// ===== 裝飾幾何要用的推導 =====

/**
 * 跑道中線的 z（可能有兩條）。
 *
 * 取 `threshold.z` —— 同一條路徑上 `threshold` / `rollStop` / `runwayEntry` /
 * `takeoffEnd` 全部同 z，那條線就是跑道。
 */
export function runwayCentrelines(size: AirportSize): number[] {
  return [...new Set(allFlightPaths(size).map(p => p.threshold.z))].sort((a, b) => a - b);
}

/** 兩條縱向滑行道的 |x|。左右對稱，所以只回傳一個值。 */
export function taxiwayX(size: AirportSize): number {
  return Math.abs(getFlightPaths(size, 0).rightJunction.x);
}

/** 橫向滑行道（停機坪聯絡道）的 z。 */
export function apronLaneZ(size: AirportSize): number {
  return getFlightPaths(size, 0).apronZ;
}

/**
 * 所有航路會用到的停機位，去重之後由左至右。
 *
 * 去重是必要的：兩條航路可能共用同一個機位，直接串起來的話它會出現兩次，
 * 而「每個機位一條空橋」就會多畫一條疊在一起的空橋。大型機場曾經是那樣
 * （A 用 −0.5/0.2、B 用 0.2/0.9），所以四個機位裡只有三個是不同的。
 *
 * 現在兩條航路的機位**不重疊**，四個各自獨立，間距 1.0 格 = 12 m ——
 * 原本只有三個（兩條航路共用中間那個），而 0.7 格（8.4 m）比翼展
 * （10.8 m）還窄，
 * 兩架同時停就會翼尖疊翼尖，而大型機場的 `MAX_ACTIVE` 正好是 2。
 */
export function allGates(size: AirportSize): Vec2[] {
  const seen = new Map<string, Vec2>();
  for (const p of allFlightPaths(size)) {
    for (const g of p.gates) seen.set(`${g.x},${g.z}`, g);
  }
  return [...seen.values()].sort((a, b) => a.x - b.x);
}

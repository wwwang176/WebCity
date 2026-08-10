import * as THREE from 'three';
import {
  PART_THRESHOLDS, ZONE_CAT,
  FACADE_CIVIC, FACADE_UTILITY, FACADE_TRANSIT, FACADE_GREEN,
} from './geometry/buildings/parts';
import { FLOOR_HEIGHT_UNITS, SHOPFRONT_CEILING } from './geometry/buildings/propBands';
import { roofPaletteFor, type RoofColor } from './ColorPalettes';
import { ZoneType } from '../core/grid/types';

/**
 * 把 TS 數字寫成 GLSL 一定會當作 float 的形式 —— 整數在 GLSL 裡不是 float，
 * `vPartType > 1` 會是編譯錯誤。
 */
function glslFloat(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

const vec3 = ([r, g, b]: RoofColor) =>
  `vec3(${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)})`;

/** 一個分區的色票鏈：把 [0, 1) 等分給 n 個顏色。 */
function pickChain(palette: readonly RoofColor[]): string {
  const n = palette.length;
  const head = palette.slice(0, n - 1)
    .map((c, i) => `h < ${glslFloat((i + 1) / n)} ? ${vec3(c)}\n      : `)
    .join('');
  return head + vec3(palette[n - 1]!);
}

/**
 * `ZONE_CAT` 依 cat 遞增排序後的 key。分支順序與門檻都由它推導。
 */
export function sortedFacadeKeys(): number[] {
  return sortKeysByCat(ZONE_CAT);
}

/**
 * 依 cat 遞增排序一張 cat 表的 key。
 *
 * 抽成獨立函式是為了測得到：`Object.entries` 對整數字串 key 是照**數值**
 * 遞增列舉的，而 `ZONE_CAT` 現在的 key 順序剛好等於 cat 順序 —— 所以直接
 * 用 `ZONE_CAT` 測的話，把 `.sort()` 整條拿掉也不會有任何測試轉紅。
 * 要用一張 key 順序與 cat 順序不一致的表才測得出排序有沒有真的發生。
 */
export function sortKeysByCat(table: Record<number, number>): number[] {
  return Object.entries(table)
    .map(([k, cat]) => ({ key: Number(k), cat }))
    .sort((a, b) => a.cat - b.cat)
    .map(e => e.key);
}

/**
 * 每個分支的上界 —— 相鄰兩個 cat 的中點。最後一個是 `Infinity`（GLSL 的 else）。
 *
 * 取中點而不是取下一個 cat：頂點色是 Float32，插值與往返可能讓 1.2 變成
 * 1.1999999。門檻壓在兩個分區正中間，誤差要大到半個間距才會走錯分支。
 */
export function facadeThresholds(): number[] {
  const cats = sortedFacadeKeys().map(k => ZONE_CAT[k]!);
  return cats.map((c, i) => (
    i === cats.length - 1 ? Infinity : round6((c + cats[i + 1]!) / 2)
  ));
}

/**
 * 中點修到 6 位小數。
 *
 * `(0.2 + 0.4) / 2` 是 `0.30000000000000004` —— 17 位有效數字，而 GLSL ES 1.00
 * 的 highp float 只有約 7 位，那些尾數在編譯時就沒了。留著只會讓產生出來的
 * shader 難讀，並且與人手寫的同一個數字對不起來。
 *
 * 6 位遠比分區間距（0.2）細，所以修完之後門檻仍嚴格落在兩個 cat 之間 ——
 * 那件事由測試守，不是靠這個註解。
 */
function round6(v: number): number {
  return Number(v.toFixed(6));
}

/**
 * 給定 cat 值，這條 if 鏈會走進哪一個 key 的分支。
 *
 * 它是 GLSL 的 JS 分身，本身就是第二份資料 —— 所以測試會從產生出來的原始碼
 * 把門檻數字挖回來與 `facadeThresholds()` 比對，讓這個迴圈閉合。
 */
export function facadeKeyOf(cat: number): number {
  const keys = sortedFacadeKeys();
  const th = facadeThresholds();
  for (let i = 0; i < keys.length; i++) if (cat < th[i]!) return keys[i]!;
  return keys[keys.length - 1]!;
}

/**
 * 由 `ZONE_CAT` 產生一條 if 鏈。屋頂色票與立面共用這一個 —— 兩份手寫的門檻
 * 表就是「改了一邊不會有任何東西報錯」的形狀。
 *
 * 這個函式**不排版**：`bodyOf` 與 `commentOf` 回傳的東西原樣輸出。它要能
 * 產生與手寫版逐字元相同的結果，而排版是那個目標的相反面。
 *
 * @param varName 屋頂鏈讀的是函式參數 `zoneCat`，立面鏈讀的是 varying `vZoneCat`。
 * @param join 屋頂鏈的分支之間是一個空格，立面鏈之間是一個空行。
 */
export function catChainGlsl(
  bodyOf: (facadeKey: number) => string,
  opts: {
    varName?: string;
    commentOf?: (facadeKey: number) => string;
    join?: string;
  } = {},
): string {
  const { varName = 'zoneCat', commentOf = () => '', join = ' ' } = opts;
  const keys = sortedFacadeKeys();
  const th = facadeThresholds();
  return keys.map((key, i) => {
    const guard = Number.isFinite(th[i]!)
      ? `${i === 0 ? 'if' : 'else if'} (${varName} < ${glslFloat(th[i]!)}) `
      : 'else ';
    return `${commentOf(key)}${guard}{${bodyOf(key)}}`;
  }).join(join);
}

/**
 * `getRoofColor` 的函式體，由 `ROOF_PALETTE_TABLE` 產生。
 *
 * 分區門檻取相鄰兩個 `ZONE_CAT` 的中點 —— 手寫的話門檻與分區常數是兩份資料，
 * 而改了一邊只會讓某個分區默默拿到別人的屋頂，不會有任何東西報錯。
 * 陣列索引在 WebGL1 的 GLSL ES 1.00 需要常數索引，所以仍然展開成 if 鏈。
 */
function roofColorGlsl(): string {
  return catChainGlsl(zone => `\n    c = ${pickChain(roofPaletteFor(zone))};\n  `);
}

/**
 * 每個分區的立面規則 —— `{` 與 `}` 之間的 GLSL。
 *
 * 這些分支原本直接寫在 `BUILDING_FRAG` 裡，門檻也是手寫的六個數字，
 * 也就是 `ZONE_CAT` 的第二份資料。搬出來由 `catChainGlsl` 串接之後，
 * 新增一個立面類別只要在 `ZONE_CAT` 與這兩張表各加一列 —— 而不是同時
 * 記得去改一條藏在 340 行 GLSL 中間的 if 鏈。
 */
const FACADE_BODY: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: /* glsl */ `
      color = vBldgColor * 0.9;
      if (onWall) {
        // 水平壁板（保留原本的質感）
        float board = fract(y / 0.06);
        float line = smoothstep(0.0, 0.06, board) * smoothstep(0.12, 0.06, board);
        vec3 wallColor = vBldgColor * (0.88 - line * 0.06);

        // 住宅的窗比公寓大而稀疏，一層一排
        float houseFloor = floorHeight * 0.72;
        float houseWin = windowWidth * 1.35;
        float fy = y / houseFloor;
        float fx = (wallU + phase) / houseWin;
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fx);
        float fwY = fwidth(fy);
        float winMask =
            smoothstep(0.30 - fwX, 0.30 + fwX, fracX) * smoothstep(0.70 + fwX, 0.70 - fwX, fracX)
          * smoothstep(0.30 - fwY, 0.30 + fwY, fracY) * smoothstep(0.72 + fwY, 0.72 - fwY, fracY);

        // 一樓開一道門。位置必須綁在**建築**上，不能只看格內偏移：以 fract
        // 量到牆中央的距離對每一格都成立，所以一面牆 1.5–2.3 格、四面牆繞
        // 一圈，一棟房子會長出六到八道門（BUG-233）。
        //
        // fragment shader 裡每棟固定的量只有格子座標與牆面法線，所以用格子
        // 擲一面牆，再用格心對齊那面牆的中央。
        vec2 bldgCell = floor(vWorldPos.xz + 0.5);
        float wallCentre = (abs(n.x) > abs(n.z)) ? bldgCell.y : bldgCell.x;
        float doorSide = floor(hash21(bldgCell * 3.1 + 7.0) * 4.0);
        float thisSide = (abs(n.x) > abs(n.z))
          ? (n.x > 0.0 ? 0.0 : 1.0)
          : (n.z > 0.0 ? 2.0 : 3.0);
        bool doorRow = y < houseFloor;
        // 半寬照舊是 0.18 格，只是改成量世界座標而不是 fract —— 實際寬度
        // 不變（0.93–1.4 m）。
        bool onDoorWall = abs(doorSide - thisSide) < 0.5;
        float doorMask = (doorRow && onDoorWall
          && abs(wallU - wallCentre) < houseWin * 0.18
          && y < houseFloor * 0.78) ? 1.0 : 0.0;
        // 一樓其餘的地方照樣開窗。以前這裡是 winMask = 0 —— 整層一樓沒有窗，
        // 所以它拿不到 windowMask：沒有玻璃、沒有天空反射，夜裡也永遠不亮。
        winMask *= 1.0 - doorMask;

        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 4.7;
        float period = 150.0 + hash21(wid + 99.0) * 150.0;
        float phaseT = hash21(wid * 2.71 + 47.0) * period;
        float epoch = floor((uTime + phaseT) / period);
        float lit = hash21(wid + epoch * 13.7);
        float litThresh = mix(0.95, 0.45, occ);

        vec3 winColor;
        if (lit > litThresh) {
          float w = hash21(wid + 77.7);
          winColor = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
          winBrightness = 0.6 + hash21(wid + 21.3) * 0.4;
          isLitWindow = winMask > 0.5;
        } else {
          winColor = vBldgColor * 0.24 + vec3(0.03, 0.05, 0.08);
        }

        vec3 doorColor = vBldgColor * 0.35 + vec3(0.06, 0.03, 0.02);
        color = mix(wallColor, winColor, winMask);
        color = mix(color, doorColor, doorMask);
        windowMask = winMask;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    `,
  [ZoneType.RESIDENTIAL_HIGH]: /* glsl */ `
      float fy = y / floorHeight;
      float fx = (wallU + phase) / windowWidth;
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = onWall
        ? smoothstep(0.2 - fwX, 0.2 + fwX, fracX) * smoothstep(0.8 + fwX, 0.8 - fwX, fracX)
        * smoothstep(0.25 - fwY, 0.25 + fwY, fracY) * smoothstep(0.68 + fwY, 0.68 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.88;
      if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        wallColor = vBldgColor * 0.72;
      }
      vec3 winColor;
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 7.13;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
      float litThreshRH = mix(0.95, 0.4, occ);
      if (lit > litThreshRH) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
        winBrightness = brightness;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vBldgColor * 0.22 + vec3(0.03, 0.05, 0.08);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,
  [ZoneType.COMMERCIAL_LOW]: /* glsl */ `
      if (onWall && y < ${glslFloat(SHOPFRONT_CEILING)}) {
        // 落地窗：一整層樓高的玻璃，中間只有豎向窗框，**不切樓層橫線** ——
        // 這正是它與樓上那些小窗長得不一樣的原因，要保留。
        //
        // 上緣用 SHOPFRONT_CEILING 而不是自己寫一個 0.22：雨遮就掛在這條線上，
        // 兩邊各寫一份的話，雨遮會壓在落地窗中間。
        float bay = wallU / 0.25;
        float bayU = fract(bay);
        float fwB = fwidth(bay);
        float glass = smoothstep(0.06 - fwB, 0.06 + fwB, bayU)
                    * smoothstep(0.94 + fwB, 0.94 - fwB, bayU);
        vec2 wid = floor(vec2(bay, 0.0)) + floor(vWorldPos.xz + 0.5) * 3.7;
        float r = hash21(wid);
        vec3 glassColor = mix(vec3(0.45, 0.58, 0.68), vec3(0.55, 0.7, 0.78), r);
        color = mix(vBldgColor * 0.6, glassColor, glass); // 窗框 -> 玻璃

        // 這一扇的店今晚有沒有開。逐扇而不是逐棟 —— 一排店面全暗或全亮都不對。
        float sPeriod = 150.0 + hash21(wid + 99.0) * 150.0;
        float sPhase = hash21(wid * 2.71 + 47.0) * sPeriod;
        float sEpoch = floor((uTime + sPhase) / sPeriod);
        float sLit = hash21(wid + sEpoch * 13.7);
        // 店面比樓上的辦公室更常亮著 —— 一條商店街的夜景主角就是它。
        float litThreshSF = mix(0.95, 0.25, occ);
        if (sLit > litThreshSF) {
          winBrightness = 0.7 + hash21(wid + 21.3) * 0.5;
          isLitWindow = glass > 0.5;
        }
        windowMask = glass;
        // 落地窗白天已經有自己的玻璃色與逐扇變化。整片換成統一的天空反射色
        // 會把那個變化抹掉，所以只取一部分。
        glassiness = 0.45;
      } else if (onWall) {
        // Upper wall — sparse small windows
        float fy = y / (floorHeight * 1.2);
        float fx = (wallU + phase) / (windowWidth * 1.1);
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fracX);
        float fwY = fwidth(fracY);
        float winMask = smoothstep(0.3 - fwX, 0.3 + fwX, fracX) * smoothstep(0.7 + fwX, 0.7 - fwX, fracX)
                      * smoothstep(0.3 - fwY, 0.3 + fwY, fracY) * smoothstep(0.65 + fwY, 0.65 - fwY, fracY);
        vec3 wallColor = vBldgColor * 0.85;
        vec3 winColor;
        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 5.3;
        float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
        float litThreshCL = mix(0.95, 0.5, occ);
        if (lit > litThreshCL) {
          winColor = mix(vec3(0.9, 0.85, 0.6), vec3(0.8, 0.7, 0.45), lit) * 0.8;
          winBrightness = brightness;
          isLitWindow = winMask > 0.5;
        } else {
          winColor = vBldgColor * 0.25 + vec3(0.03, 0.04, 0.08);
        }
        color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      } else {
        color = vBldgColor * 0.85;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,
  [ZoneType.COMMERCIAL_HIGH]: /* glsl */ `
      float fy = y / (floorHeight * 0.88);
      float fx = (wallU + phase) / (windowWidth * 0.5);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = onWall
        ? smoothstep(0.08 - fwX, 0.08 + fwX, fracX) * smoothstep(0.92 + fwX, 0.92 - fwX, fracX)
        * smoothstep(0.12 - fwY, 0.12 + fwY, fracY) * smoothstep(0.82 + fwY, 0.82 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.5; // narrow mullions
      vec3 winColor;
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 7.13;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
      float litThreshCH = mix(0.95, 0.3, occ);
      if (lit > litThreshCH) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.92, 0.88, 0.65), vec3(0.82, 0.72, 0.42), w) * (0.8 + w * 0.15);
        winBrightness = brightness;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vec3(0.35, 0.48, 0.58) * (0.6 + hash21(wid + 33.3) * 0.3);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,
  [ZoneType.INDUSTRIAL]: /* glsl */ `
      if (onWall) {
        // Horizontal corrugation ridges
        float ridge = fract(y / 0.08);
        float shade = smoothstep(0.0, 0.3, ridge) * smoothstep(1.0, 0.7, ridge);
        color = vBldgColor * (0.72 + shade * 0.18);

        // 高窗帶。廠房的窗開得高 —— 下面那一段牆要靠著放料架與機具，所以
        // 它不是一格一格的小窗，是一條沿著樓板線下方的長條窗。
        // 靠既有的樓層節奏定位，所以一層樓的廠房與三層樓的都對得上。
        float fy = y / floorHeight;
        float fx = (wallU + phase) / (windowWidth * 2.2);
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fx);
        float fwY = fwidth(fy);
        float bandMask =
            smoothstep(0.62 - fwY, 0.62 + fwY, fracY) * smoothstep(0.86 + fwY, 0.86 - fwY, fracY)
          * smoothstep(0.12 - fwX, 0.12 + fwX, fracX) * smoothstep(0.88 + fwX, 0.88 - fwX, fracX);

        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 6.7;
        float wPeriod = 150.0 + hash21(wid + 99.0) * 150.0;
        float wPhase = hash21(wid * 2.71 + 47.0) * wPeriod;
        float wEpoch = floor((uTime + wPhase) / wPeriod);
        float wLit = hash21(wid + wEpoch * 13.7);
        // 廠房夜裡亮的窗比住宅少 —— 只有值夜班的那幾跨。
        float litThreshIN = mix(0.98, 0.6, occ);
        vec3 winColor;
        if (wLit > litThreshIN) {
          // 偏冷白：廠房用的是金屬鹵素／LED，不是住家的黃光。
          winColor = mix(vec3(0.90, 0.92, 0.80), vec3(0.78, 0.84, 0.72), wLit) * 0.85;
          winBrightness = 0.6 + hash21(wid + 21.3) * 0.4;
          isLitWindow = bandMask > 0.5;
        } else {
          winColor = vBldgColor * 0.22 + vec3(0.04, 0.05, 0.07);
        }
        color = mix(color, winColor, bandMask);
        windowMask = bandMask;

        // Large loading door at ground level
        // **畫在高窗之後**，所以它蓋掉落在同一段高度的高窗 —— 矮樓層的廠房
        // 高窗帶會落進捲門的高度範圍，兩者疊在一起就是一扇長了窗戶的捲門。
        float doorU = fract(wallU / 0.35);
        if (y < 0.18 && doorU > 0.12 && doorU < 0.88) {
          color = vBldgColor * 0.4 + vec3(0.02, 0.02, 0.01);
          // Horizontal door slats
          float slat = fract(y / 0.03);
          color *= 0.9 + 0.1 * step(0.5, slat);

          // 有些捲門是開著的，裡面的燈光整片透出來。
          // glassiness = 0：捲門會透光，但它不是玻璃 —— 白天不該變成一片藍，
          // 也不該有陽光鏡面。
          vec2 did = vec2(floor(wallU / 0.35), 0.0) + floor(vWorldPos.xz + 0.5) * 9.1;
          float dPeriod = 200.0 + hash21(did + 5.0) * 200.0;
          float dPhase = hash21(did * 1.7 + 13.0) * dPeriod;
          float dEpoch = floor((uTime + dPhase) / dPeriod);
          float dOpen = hash21(did + dEpoch * 3.3);
          windowMask = 1.0;
          glassiness = 0.0;
          isLitWindow = dOpen > mix(0.99, 0.68, occ);
          winBrightness = 0.8 + hash21(did + 4.4) * 0.4;
        }
      } else {
        color = vBldgColor * 0.78;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    `,
  [ZoneType.OFFICE]: /* glsl */ `
      float fy = y / floorHeight;
      float fx = (wallU + phase) / (windowWidth * 0.625);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = onWall
        ? smoothstep(0.15 - fwX, 0.15 + fwX, fracX) * smoothstep(0.85 + fwX, 0.85 - fwX, fracX)
        * smoothstep(0.2 - fwY, 0.2 + fwY, fracY) * smoothstep(0.72 + fwY, 0.72 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.88;
      if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        wallColor = vBldgColor * 0.7;
      }
      vec3 winColor;
      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 7.13;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phase = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phase) / period);
      float lit = hash21(wid + epoch * 13.7);
      float bPeriod = 150.0 + hash21(wid + 55.0) * 150.0;
      float bPhase = hash21(wid * 3.14 + 31.0) * bPeriod;
      float bEpoch = floor((uTime + bPhase) / bPeriod);
      float brightness = 0.5 + hash21(wid + bEpoch * 17.3) * 0.5;
      float litThreshOF = mix(0.95, 0.35, occ);
      if (lit > litThreshOF) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
        winBrightness = brightness;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vBldgColor * 0.2 + vec3(0.03, 0.05, 0.09);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,

  [FACADE_CIVIC]: /* glsl */ `
      // 公家建築：混凝土或磚石，窗比住宅大、比辦公稀疏，樓層之間有實體腰線。
      // 一樓是挑高的門廳，所以窗格從門廳頂之上才開始 —— 直接從地面起算的話，
      // 一座警局的一樓會長出跟三樓一樣的小窗，那正是它看起來不像公家建築的原因。
      float portico = floorHeight * 1.35;
      float fy = (y - portico) / floorHeight;
      float fx = (wallU + phase) / (windowWidth * 1.15);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      float winMask = (onWall && y > portico)
        ? smoothstep(0.22 - fwX, 0.22 + fwX, fracX) * smoothstep(0.78 + fwX, 0.78 - fwX, fracX)
        * smoothstep(0.20 - fwY, 0.20 + fwY, fracY) * smoothstep(0.74 + fwY, 0.74 - fwY, fracY)
        : 0.0;

      vec3 wallColor = vBldgColor * 0.93;
      // 腰線：樓板位置的一條實體帶。公家建築的立面幾乎都有。
      if (onWall && y > portico && (fracY > 0.86 || fracY < 0.08)) {
        wallColor = vBldgColor * 0.76;
      }

      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 6.1;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phaseT = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phaseT) / period);
      float lit = hash21(wid + epoch * 13.7);
      // 值班單位夜裡亮的窗比辦公樓多、比住宅少 —— 值班室與走廊燈亮著，
      // 但整棟樓不會像上班時間那樣全開。
      float litThreshCV = mix(0.92, 0.45, occ);
      vec3 winColor;
      if (lit > litThreshCV) {
        float w = hash21(wid + 77.7);
        // 偏冷白：公家建築用的是日光燈，不是住家的黃光。
        winColor = mix(vec3(0.92, 0.94, 0.88), vec3(0.82, 0.86, 0.80), w) * (0.82 + w * 0.14);
        winBrightness = 0.6 + hash21(wid + 21.3) * 0.35;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vBldgColor * 0.24 + vec3(0.03, 0.05, 0.08);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;

      // 門廳：一整層樓高的落地玻璃，柱間分割，**不切樓層橫線**。
      // 畫在窗格之後，所以它蓋掉落在同一段高度的東西。
      if (onWall && y <= portico && y > 0.06) {
        float bay = wallU / 0.34;
        float bayU = fract(bay);
        float fwB = fwidth(bay);
        float glass = smoothstep(0.16 - fwB, 0.16 + fwB, bayU)
                    * smoothstep(0.84 + fwB, 0.84 - fwB, bayU);
        vec2 lid = vec2(floor(bay), 0.0) + floor(vWorldPos.xz + 0.5) * 4.3;
        vec3 glassColor = mix(vec3(0.42, 0.52, 0.60), vec3(0.52, 0.62, 0.68), hash21(lid));
        color = mix(vBldgColor * 0.66, glassColor, glass);   // 石材柱 -> 玻璃
        windowMask = glass;
        // 門廳整夜亮著 —— 值班台在那裡。這是公家建築夜景的主角。
        isLitWindow = glass > 0.5 && occ > 0.0;
        winBrightness = 0.75 + hash21(lid + 4.1) * 0.3;
        // 門廳玻璃白天已經有自己的顏色與逐柱變化，整片換成統一的天空反射色
        // 會把那個變化抹掉，所以只取一部分（與商業低密度的落地窗同樣理由）。
        glassiness = 0.5;
      }

      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.62 + 0.38 * ao;
    `,

  [FACADE_UTILITY]: /* glsl */ `
      // 公用設施：電廠、水廠、垃圾場、汙水廠。它們就是工業設施，只是歸市府管，
      // 所以語彙沿用工業的浪板與高窗帶 —— 但沒有捲門（那是貨運廠房的東西），
      // 換成常亮的警示燈帶。
      if (onWall) {
        float ridge = fract(y / 0.09);
        float shade = smoothstep(0.0, 0.3, ridge) * smoothstep(1.0, 0.7, ridge);
        color = vBldgColor * (0.70 + shade * 0.20);

        // 高窗帶：機具與管線佔滿下半段的牆，所以窗開在樓板線下方一條。
        float fy = y / floorHeight;
        float fx = (wallU + phase) / (windowWidth * 2.4);
        float fracY = fract(fy);
        float fracX = fract(fx);
        float fwX = fwidth(fx);
        float fwY = fwidth(fy);
        float bandMask =
            smoothstep(0.64 - fwY, 0.64 + fwY, fracY) * smoothstep(0.88 + fwY, 0.88 - fwY, fracY)
          * smoothstep(0.10 - fwX, 0.10 + fwX, fracX) * smoothstep(0.90 + fwX, 0.90 - fwX, fracX);

        vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 8.3;
        float wPeriod = 150.0 + hash21(wid + 99.0) * 150.0;
        float wPhase = hash21(wid * 2.71 + 47.0) * wPeriod;
        float wEpoch = floor((uTime + wPhase) / wPeriod);
        float wLit = hash21(wid + wEpoch * 13.7);
        // 這些設施是 24 小時運轉的，所以夜裡亮的比一般工廠多。
        float litThreshUT = mix(0.95, 0.42, occ);
        vec3 winColor;
        if (wLit > litThreshUT) {
          // 金屬鹵素的冷白。
          winColor = mix(vec3(0.90, 0.93, 0.84), vec3(0.76, 0.83, 0.74), wLit) * 0.88;
          winBrightness = 0.65 + hash21(wid + 21.3) * 0.4;
          isLitWindow = bandMask > 0.5;
        } else {
          winColor = vBldgColor * 0.22 + vec3(0.04, 0.05, 0.07);
        }
        color = mix(color, winColor, bandMask);
        windowMask = bandMask;

        // 警示燈帶：高處一排常亮的紅點。**畫在高窗之後**，所以它蓋掉落在
        // 同一段高度的高窗 —— 兩者疊在一起就是一扇長了紅點的窗。
        float lampU = fract(wallU / 0.55);
        float lampBand = smoothstep(0.40 - fwidth(y), 0.40 + fwidth(y), fracY)
                       * smoothstep(0.46 + fwidth(y), 0.46 - fwidth(y), fracY);
        float lampDot = lampBand * step(0.42, lampU) * step(lampU, 0.58);
        if (lampDot > 0.5) {
          color = vec3(0.35, 0.10, 0.08);
          windowMask = 1.0;
          // 警示燈不是玻璃 —— 白天不該變成一片藍，也不該有陽光鏡面。
          glassiness = 0.0;
          // 它與住戶無關：設施停擺了警示燈還是亮的。
          isLitWindow = true;
          winBrightness = 0.9;
        }
      } else {
        color = vBldgColor * 0.76;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    `,

  [FACADE_TRANSIT]: /* glsl */ `
      // 交通站點：玻璃幕與輕構造。月台與大廳整夜亮著 —— 車站是城市夜景裡
      // 最亮的東西之一，比辦公樓亮得多。
      float fy = y / (floorHeight * 1.1);
      float fx = (wallU + phase) / (windowWidth * 0.75);
      float fracY = fract(fy);
      float fracX = fract(fx);
      float fwX = fwidth(fx);
      float fwY = fwidth(fy);
      // 窗框很細 —— 車站的玻璃幕是大片的。
      float winMask = onWall
        ? smoothstep(0.06 - fwX, 0.06 + fwX, fracX) * smoothstep(0.94 + fwX, 0.94 - fwX, fracX)
        * smoothstep(0.08 - fwY, 0.08 + fwY, fracY) * smoothstep(0.90 + fwY, 0.90 - fwY, fracY)
        : 0.0;
      vec3 wallColor = vBldgColor * 0.55;   // 細窗櫺

      vec2 wid = floor(vec2(fx, fy)) + floor(vWorldPos.xz + 0.5) * 5.9;
      float period = 150.0 + hash21(wid + 99.0) * 150.0;
      float phaseT = hash21(wid * 2.71 + 47.0) * period;
      float epoch = floor((uTime + phaseT) / period);
      float lit = hash21(wid + epoch * 13.7);
      // 門檻壓得很低：末班車之前整座車站都是亮的。上限 0.6 是給停用的站
      // （occ = 0）留的 —— 廢站不該還亮著。
      float litThreshTR = mix(0.60, 0.12, occ);
      vec3 winColor;
      if (lit > litThreshTR) {
        float w = hash21(wid + 77.7);
        winColor = mix(vec3(0.94, 0.95, 0.90), vec3(0.86, 0.90, 0.86), w) * (0.86 + w * 0.12);
        winBrightness = 0.8 + hash21(wid + 21.3) * 0.4;
        isLitWindow = winMask > 0.5;
      } else {
        winColor = vec3(0.38, 0.50, 0.60) * (0.6 + hash21(wid + 33.3) * 0.3);
      }
      color = mix(wallColor, winColor, winMask);
      windowMask = winMask;
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    `,

  [FACADE_GREEN]: /* glsl */ `
      // 綠地：公園與墓園。這裡幾乎沒有牆 —— 走到這個分支的是圍牆、擋土牆、
      // 涼亭的柱間與管理室。
      //
      // **刻意不畫窗格。** 一個標籤分不出「管理室」與「圍牆」，而在圍牆上
      // 開窗比在管理室上不開窗難看得多。公園的夜間存在感靠 PART_LAMP 的
      // 庭園燈，不靠窗 —— 真實的公園入夜之後本來就是燈亮、房子暗。
      if (onWall) {
        // 石砌：水平砌縫加上世界座標的雜訊，避免一整面圍牆是死板的單色。
        float course = fract(y / 0.055);
        float joint = smoothstep(0.0, 0.05, course) * smoothstep(0.10, 0.05, course);
        float grain = hash21(floor(vWorldPos.xz * 18.0)) * 0.06 - 0.03;
        color = (vBldgColor * (0.86 - joint * 0.10) + grain);
      } else {
        color = vBldgColor * 0.82;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.68 + 0.32 * ao;
    `,
};

/** 掛在每個分支 `if` 之前的註解。與 `FACADE_BODY` 分開，讓 body 保持純 GLSL。 */
const FACADE_COMMENT: Record<number, string> = {
  [ZoneType.RESIDENTIAL_LOW]: '    // ---- RESIDENTIAL LOW: painted siding, no window grid ----\n    ',
  [ZoneType.RESIDENTIAL_HIGH]: '    // ---- RESIDENTIAL HIGH: medium-spaced windows ----\n    ',
  [ZoneType.COMMERCIAL_LOW]: '    // ---- COMMERCIAL LOW: storefront glass bottom, simple wall above ----\n    ',
  [ZoneType.COMMERCIAL_HIGH]: '    // ---- COMMERCIAL HIGH: dense glass curtain wall ----\n    ',
  [ZoneType.INDUSTRIAL]: '    // ---- INDUSTRIAL: corrugated metal, large doors ----\n    ',
  [ZoneType.OFFICE]: '    // ---- OFFICE: dense window grid ----\n    ',
  [FACADE_CIVIC]: '    // ---- CIVIC: masonry, banded floors, tall lit lobby ----\n    ',
  [FACADE_UTILITY]: '    // ---- UTILITY: corrugated metal, clerestory band, hazard lights ----\n    ',
  [FACADE_TRANSIT]: '    // ---- TRANSIT: light glass envelope, lit all night ----\n    ',
  [FACADE_GREEN]: '    // ---- GREEN: masonry walls only, no window grid ----\n    ',
};

/** 立面的 if 鏈。讀的是 varying `vZoneCat`，分支之間空一行。 */
function facadeChainGlsl(): string {
  return catChainGlsl(facadeBodyOf, {
    varName: 'vZoneCat',
    commentOf: key => FACADE_COMMENT[key] ?? '    ',
    join: '\n\n',
  });
}

/**
 * 這個立面類別的 GLSL。少一張表就**當場炸掉**。
 *
 * 沒有這個 throw 的話，在 `ZONE_CAT` 加了類別卻忘了寫立面，結果是那一類
 * 建築拿到一片沒有窗的純色牆 —— 畫面上看起來像「還沒做完」而不像「壞了」，
 * 而它會一路活到有人截圖問為止。整條 if 鏈存在的理由就是消滅這種靜默，
 * 所以它自己不能留一個靜默的預設值。
 */
function facadeBodyOf(key: number): string {
  const body = FACADE_BODY[key];
  if (body === undefined) {
    throw new Error(
      `立面類別 ${key} 在 ZONE_CAT 裡有 cat ${ZONE_CAT[key]} 卻沒有 FACADE_BODY`,
    );
  }
  return body;
}

// ===== Building Shader =====
export const BUILDING_VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>

attribute float aHighlight;
attribute vec3 aHighlightColor;
attribute float aOccupancy;
attribute vec3 aSeed;

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;
varying float vGroundShade;
varying float vHighlight;
varying vec3 vHighlightColor;
varying float vOccupancy;
varying vec3 vSeed;

void main() {
  vLocalPos = position;
  vHighlight = aHighlight;
  vHighlightColor = aHighlightColor;
  vOccupancy = aOccupancy;
  vSeed = aSeed;

  #ifdef USE_COLOR
    vPartType = color.r;
    vZoneCat = color.g;
    vGroundShade = color.b;
  #else
    vPartType = 0.0;
    vZoneCat = 0.0;
    vGroundShade = 0.0;
  #endif

  #ifdef USE_INSTANCING_COLOR
    vBldgColor = instanceColor;
  #else
    vBldgColor = vec3(0.7);
  #endif

  #ifdef USE_INSTANCING
    mat4 world = modelMatrix * instanceMatrix;
  #else
    mat4 world = modelMatrix;
  #endif

  vec4 wPos = world * vec4(position, 1.0);
  vWorldPos = wPos.xyz;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = projectionMatrix * viewMatrix * wPos;

  // Shadow map: transformedNormal required by shadowmap_vertex
  vec3 transformedNormal = vNormal;
  vec4 worldPosition = wPos;
  #include <shadowmap_vertex>
}
`;

export const BUILDING_FRAG = /* glsl */ `
precision highp float;

#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>

uniform float uGlobalOpacity;
uniform float uDesaturate;
uniform float uTime;

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;
varying float vGroundShade;
varying float vHighlight;
varying vec3 vHighlightColor;
varying float vOccupancy;
varying vec3 vSeed;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

// === Independent roof color palettes per zone ===
// 函式體由 ColorPalettes.ROOF_PALETTE_TABLE 產生 —— 顏色寫在那裡才測得到。
vec3 getRoofColor(float zoneCat, float h) {
  vec3 c = vec3(0.35, 0.35, 0.38);
  ${roofColorGlsl()}
  return c;
}

void main() {
  vec3 n = normalize(vNormal);
  bool isLitWindow = false;
  float windowMask = 0.0;
  float winBrightness = 1.0;

  // Read real lights from Three.js uniforms (set by lights_pars_begin)
  #if NUM_DIR_LIGHTS > 0
    // directionalLights[].direction is view-space; convert to world-space
    vec3 sd = directionalLights[0].direction;
    mat3 vm = mat3(viewMatrix);
    vec3 sunDir = normalize(vec3(dot(vm[0], sd), dot(vm[1], sd), dot(vm[2], sd)));
    vec3 sunColor = directionalLights[0].color;
    float sunIntensity = length(sunColor);
  #else
    vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
    vec3 sunColor = vec3(1.0);
    float sunIntensity = 1.0;
  #endif
  float sunDiff = max(dot(n, sunDir), 0.0);
  vec3 fillDir = normalize(vec3(-0.6, 0.3, -0.4));
  float fillDiff = max(dot(n, fillDir), 0.0);
  vec3 indirect = max(vec3(0.08), ambientLightColor * 0.7) + 0.13 * fillDiff * sunColor;
  vec3 direct = 0.45 * sunDiff * sunColor;
  vec3 lighting = indirect + direct;
  float directRatio = length(direct) / max(length(lighting), 0.001);

  bool isFoliage = vPartType > ${glslFloat(PART_THRESHOLDS.FOLIAGE_MIN)} && vPartType < ${glslFloat(PART_THRESHOLDS.FOLIAGE_MAX)};
  // 金屬／深色細節：水塔、冷氣機、天線、管架。不畫窗戶，也不吃分區的
  // 立面規則 —— 否則屋頂上的設備會長出一格一格的窗。
  bool isDetail = vPartType > ${glslFloat(PART_THRESHOLDS.ROOF_BY_NORMAL)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.LAMP_MIN)};
  // 自己會發光的東西：燈頭、側招、廣告看板。與 isDetail 分開是必要的 ——
  // 水塔與管架不該在晚上亮起來，而標籤只有一個的話唯一的選擇是兩者都不亮。
  bool isLamp = vPartType > ${glslFloat(PART_THRESHOLDS.LAMP_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.FOLIAGE_MIN)};
  // 地面貼片：柏油、鋪面、標線。自己一個分支，否則會落到牆的分支 ——
  // 柏油地面上長出一格一格的窗。
  bool isGround = vPartType > ${glslFloat(PART_THRESHOLDS.GROUND_MIN)}
    && vPartType < ${glslFloat(PART_THRESHOLDS.GROUND_MAX)};
  bool isRoof = vPartType > ${glslFloat(PART_THRESHOLDS.ROOF_MIN)} || (n.y > 0.85 && vPartType < ${glslFloat(PART_THRESHOLDS.ROOF_BY_NORMAL)});
  bool isFloor = n.y < -0.85;

  vec3 color;

  // 這一塊白天是不是玻璃。1 = 整片換成天空反射並吃陽光鏡面（一般窗戶）；
  // 0 = 完全不反射（工業的捲門夜裡會透光，但它不是玻璃）。落地窗取中間值 ——
  // 它白天已經有自己的玻璃色與逐扇變化，整片換成統一的反射色會把那個變化抹掉。
  float glassiness = 1.0;
  // 自發光。夜晚才加，而且加在陰影之後 —— 招牌與燈頭不會被自己的建築遮住。
  vec3 emissive = vec3(0.0);

  if (isFoliage) {
    // Green foliage with variation based on position
    float fh = hash21(vWorldPos.xz * 3.7);
    vec3 baseGreen = mix(vec3(0.18, 0.35, 0.12), vec3(0.25, 0.45, 0.15), fh);
    // Darker at bottom, lighter at top
    float topFade = smoothstep(0.0, 0.25, vWorldPos.y);
    color = baseGreen * (0.7 + 0.3 * topFade);
    color *= lighting;
  } else if (isLamp) {
    // 燈罩／招牌面板。白天是灰白的板子，晚上自己發光。
    float g = 0.62 + vSeed.z * 0.12;
    color = vec3(g, g * 0.98, g * 0.94) * lighting;
    // **沒有人的建築不該亮。** 燒毀與空置的建築 occupancy 是 0，招牌就跟著暗。
    // 用 smoothstep 而不是 step：半空的樓不必整排招牌一起熄。
    emissive = vec3(1.0, 0.86, 0.58) * 0.95 * smoothstep(0.0, 0.15, vOccupancy);
  } else if (isDetail) {
    // 略帶藍的中灰金屬，靠種子微調明度，避免整片設備同一個顏色
    float m = 0.42 + vSeed.z * 0.16;
    color = vec3(m, m * 1.02, m * 1.06) * lighting;
  } else if (isGround) {
    // 柏油 -> 混凝土 -> 磚鋪，由頂點的 B 通道決定。加一點世界座標雜訊，
    // 否則一整片鋪面是死板的單一色塊。
    vec3 tarmac = vec3(0.20, 0.20, 0.21);
    vec3 paving = vec3(0.60, 0.58, 0.55);
    float grain = hash21(floor(vWorldPos.xz * 26.0)) * 0.07 - 0.035;
    color = (mix(tarmac, paving, vGroundShade) + grain) * lighting;
  } else if (isFloor) {
    color = vBldgColor * 0.3;
  } else if (isRoof) {
    float rh = hash21(floor(vWorldPos.xz * 1.01));
    color = getRoofColor(vZoneCat, rh);
    color *= lighting;
  } else {
    // === WALL — zone-specific patterns ===
    // 每棟樓自己的立面節奏。以前這些是常數，所以整座城市的塔樓共用同一個
    // 窗戶格；量體再怎麼變，立面看起來還是同一棟。
    float seedRhythm = vSeed.x;
    // 相位偏移只改起算點，不改尺度 —— 窗戶仍是真實世界尺寸，但相鄰建築的
    // 窗戶不再橫向對齊成一條線。
    float phase = vSeed.y * 10.0;
    // 樓層高度的實體在 propBands.FLOOR_HEIGHT_UNITS —— 幾何（雨遮掛在哪）
    // 與 shader（窗戶畫在哪）對不上的話，雨遮會壓在窗戶中間，而那不會有
    // 任何東西報錯。
    float floorHeight = mix(${glslFloat(FLOOR_HEIGHT_UNITS.MIN)}, ${glslFloat(FLOOR_HEIGHT_UNITS.MAX)}, seedRhythm);
    float windowWidth = mix(0.16, 0.24, seedRhythm);
    float y = vWorldPos.y;
    float wallU;
    if (abs(n.x) > abs(n.z)) {
      wallU = vWorldPos.z;
    } else {
      wallU = vWorldPos.x;
    }
    bool onWall = abs(n.y) < 0.3 && y > 0.06;
    // Occupancy-adjusted lit threshold: fewer lit windows when building is less occupied
    // occ=0 → no windows lit at all (abandoned/burned/empty buildings)
    float occ = vOccupancy < 0.01 ? -1.0 : clamp(vOccupancy, 0.0, 1.0);

${facadeChainGlsl()}
  }

  // Apply shadow from directional light
  float shadowVal = 1.0;
  float rawShadow = 1.0;
  #if NUM_DIR_LIGHT_SHADOWS > 0
    rawShadow = getShadow(
      directionalShadowMap[0],
      directionalLightShadows[0].shadowMapSize,
      directionalLightShadows[0].shadowIntensity,
      directionalLightShadows[0].shadowBias,
      directionalLightShadows[0].shadowRadius,
      vDirectionalShadowCoord[0]
    );
    // Shadow only attenuates direct light (like built-in PBR materials)
    float shadowFactor = 0.45 + 0.55 * rawShadow;
    shadowVal = mix(1.0, shadowFactor, directRatio);
    color *= shadowVal;
  #endif

  // 日夜係數算在 windowMask 的判斷**之外** —— 招牌與燈頭沒有窗戶，
  // 但它們一樣要知道現在是不是晚上。
  // Per-building random offset so lights turn on gradually during dusk
  float bldgRand = fract(sin(dot(floor(vWorldPos.xz), vec2(12.9898, 78.233))) * 43758.5453);
  float onOffset = bldgRand * 0.3; // stagger over 0.3 sunIntensity range
  float dayFactor = smoothstep(0.25 + onOffset, 0.55 + onOffset, sunIntensity);
  float nightFactor = 1.0 - smoothstep(0.15 + onOffset, 0.5 + onOffset, sunIntensity);

  // Window day/night appearance
  if (windowMask > 0.01) {
    // Daytime: all windows show blue-white glass reflection
    vec3 dayGlass = vec3(0.6, 0.72, 0.82);
    color = mix(color, dayGlass * lighting * shadowVal, dayFactor * windowMask * glassiness);
    // Specular sun reflection on sun-facing glass only
    vec3 viewDirH = normalize(vec3(cameraPosition.x - vWorldPos.x, 0.0, cameraPosition.z - vWorldPos.z));
    vec3 sunDirH = normalize(vec3(sunDir.x, 0.0, sunDir.z));
    float facingSun = max(dot(n, sunDirH), 0.0);
    vec3 halfDirH = normalize(sunDirH + viewDirH);
    float spec = pow(max(dot(n, halfDirH), 0.0), 24.0);
    color += spec * sunColor * 0.8 * dayFactor * windowMask * glassiness * facingSun * rawShadow;
    // Nighttime: only lit windows show warm yellow glow
    if (isLitWindow) {
      vec3 warmGlow = vec3(0.95, 0.85, 0.5);
      color = mix(color, warmGlow * 1.35 * winBrightness, nightFactor * 0.7);
    }
  }

  // 自發光加在陰影之後：燈與招牌自己就是光源，被自己的建築遮住沒有道理。
  color += emissive * nightFactor;

  // Underground mode: white model effect (fade to near-white)
  if (uDesaturate > 0.0) {
    color = mix(color, vec3(0.88), uDesaturate);
  }

  // Highlight tint (demolish / zone selection / hover / coverage gradient)
  if (vHighlight > 0.01) {
    color = mix(color, vHighlightColor, 0.28 * vHighlight);
    // Add emissive glow so it's visible at night too
    color += vHighlightColor * 0.15 * vHighlight;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

function createBuildingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
      ]),
      uGlobalOpacity: { value: 1.0 },
      uDesaturate: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
    vertexColors: true,
    lights: true,
    transparent: true,
  });
}

let _buildingMaterial: THREE.ShaderMaterial | null = null;
export function getBuildingMaterial(): THREE.ShaderMaterial {
  if (!_buildingMaterial) _buildingMaterial = createBuildingMaterial();
  return _buildingMaterial;
}

/** 測試用：清掉 singleton，讓下一次 getBuildingMaterial 重新建立。 */
export function resetBuildingMaterial(): void {
  _buildingMaterial = null;
}

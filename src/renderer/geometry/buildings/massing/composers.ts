import type { Volume } from './volume';
import type { Dimensions } from './dimensions';
import type { Rng } from './rng';

/**
 * 量體組合器 —— 把一組尺寸攤成一串盒子。
 *
 * 原型不是每個都手寫一份幾何，而是「組合器 + 參數」。二十幾個原型手寫會是
 * 二十幾份幾乎一樣的座標算術，而其中任何一份算錯都只表現為「某個變體看起來
 * 怪怪的」。
 *
 * 每個組合器守三條不變式（`MassingComposers.test.ts` 逐條檢查）：
 *   1. 所有量體落在 `dims` 給的基地內 —— 基地已經確認過不越過行人包絡線
 *   2. 兩兩不重疊 —— 重疊會產生看不見的內部面
 *   3. 最高點正好等於 `dims.height` —— 高度由 `dimensions` 決定
 */
export type Composer = (dims: Dimensions, rng: Rng) => Volume[];

/** 單一量體。最簡單的那一個，也是所有退化情形的退路。 */
export function single(dims: Dimensions): Volume[] {
  return [{ x: 0, z: 0, w: dims.w, d: dims.d, y0: 0, y1: dims.height }];
}

/**
 * 主屋 + 偏屋。車庫、工具間、廠區的辦公角都是這個形狀。
 *
 * 偏屋靠 +x 且靠前（+z）—— 車庫開在前院那一側才合理。
 */
export function mainPlusWing(wingFrac: number, wingHeightFrac: number): Composer {
  return (dims, rng) => {
    const wingW = dims.w * wingFrac;
    const mainW = dims.w - wingW;
    const wingD = dims.d * (0.55 + 0.25 * rng());
    // 下限是**半層樓**而不是一層樓：建築本身只有一層時，「至少一層樓」會讓
    // 偏屋與主屋等高 —— 整個組合器退化成一個方盒，輪廓與 single 完全相同。
    // 1.6 m 高的側棟是儲藏間，完全合理。
    const wingH = Math.min(
      dims.height - 1e-6,
      Math.max(dims.floorHeight * 0.5, dims.height * wingHeightFrac),
    );
    return [
      { x: -dims.w / 2 + mainW / 2, z: 0, w: mainW, d: dims.d, y0: 0, y1: dims.height },
      {
        x: dims.w / 2 - wingW / 2, z: dims.d / 2 - wingD / 2,
        w: wingW, d: wingD, y0: 0, y1: wingH,
      },
    ];
  };
}

/**
 * L 形平面。長翼沿北緣、短翼沿西緣，兩者在西北角相接。
 *
 * 這是最強的不對稱形狀：重心明顯偏離包圍盒中心，所以四向旋轉真的是四種面貌。
 */
export function lShape(armFrac: number): Composer {
  return (dims) => {
    const armD = dims.d * armFrac;
    const armW = dims.w * armFrac;
    const restD = dims.d - armD;
    return [
      { x: 0, z: -dims.d / 2 + armD / 2, w: dims.w, d: armD, y0: 0, y1: dims.height },
      {
        x: -dims.w / 2 + armW / 2, z: -dims.d / 2 + armD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
    ];
  };
}

/**
 * 裙樓 + 塔身。`offsetFrac` 為 0 時塔身置中（對稱），接近 1 時塔身推到裙樓
 * 邊緣（不對稱）—— 同一個組合器因此涵蓋兩種面貌。
 *
 * 樓層不足兩層時退回單一量體：一層樓的裙樓會把塔身壓成零高。
 */
export function podiumTower(
  podiumFloors: number, towerFrac: number, offsetFrac: number,
): Composer {
  return (dims, rng) => {
    if (dims.floors < 2) return single(dims);
    const podiumH = Math.min(podiumFloors, dims.floors - 1) * dims.floorHeight;
    const tw = dims.w * towerFrac;
    const td = dims.d * towerFrac;
    const ox = ((dims.w - tw) / 2) * offsetFrac * (rng() < 0.5 ? -1 : 1);
    const oz = ((dims.d - td) / 2) * offsetFrac * (rng() < 0.5 ? -1 : 1);
    return [
      { x: 0, z: 0, w: dims.w, d: dims.d, y0: 0, y1: podiumH },
      { x: ox, z: oz, w: tw, d: td, y0: podiumH, y1: dims.height },
    ];
  };
}

/** 逐層退縮。對稱，但輪廓與單一量體明顯不同。 */
export function setback(steps: number): Composer {
  return (dims) => {
    if (dims.floors < 2) return single(dims);
    const n = Math.max(2, Math.min(steps, dims.floors));
    const out: Volume[] = [];
    const per = dims.height / n;
    for (let i = 0; i < n; i++) {
      const frac = 1 - (i / n) * 0.4;
      out.push({
        x: 0, z: 0,
        w: dims.w * frac, d: dims.d * frac,
        y0: i * per, y1: (i + 1) * per,
      });
    }
    out[out.length - 1]!.y1 = dims.height;
    return out;
  };
}

/**
 * U 形：兩翼加一道背牆，中央留槽。
 *
 * 重心對稱，但中央的槽在俯視高度圖裡是實心的 0 —— 輪廓與其他組合器都不同。
 */
export function notch(notchFrac: number): Composer {
  return (dims) => {
    const armW = dims.w * (1 - notchFrac) / 2;
    const backD = dims.d * 0.38;
    const restD = dims.d - backD;
    return [
      { x: 0, z: -dims.d / 2 + backD / 2, w: dims.w, d: backD, y0: 0, y1: dims.height },
      {
        x: -dims.w / 2 + armW / 2, z: -dims.d / 2 + backD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
      {
        x: dims.w / 2 - armW / 2, z: -dims.d / 2 + backD + restD / 2,
        w: armW, d: restD, y0: 0, y1: dims.height,
      },
    ];
  };
}

/**
 * 雙塔加低矮連接體。兩座塔**刻意不等高** —— 等高的雙塔是對稱的，
 * 旋轉又變回無操作。
 */
export function twin(gapFrac: number): Composer {
  return (dims) => {
    if (dims.floors < 3) return single(dims);
    const towerW = dims.w * (1 - gapFrac) / 2;
    const linkH = Math.max(2, Math.floor(dims.floors * 0.3)) * dims.floorHeight;
    const linkD = dims.d * 0.6;
    return [
      { x: -dims.w / 2 + towerW / 2, z: 0, w: towerW, d: dims.d, y0: 0, y1: dims.height },
      {
        // 兩座塔差三成高。差太少的話重心幾乎不偏，旋轉又變回無操作。
        x: dims.w / 2 - towerW / 2, z: 0, w: towerW, d: dims.d,
        y0: 0, y1: dims.height * 0.68,
      },
      {
        x: 0, z: 0, w: dims.w * gapFrac, d: linkD,
        y0: 0, y1: Math.min(linkH, dims.height * 0.5),
      },
    ];
  };
}

/** 高低兩跨。工業的廠房與商業的前店後棟都是這個形狀。 */
export function splitSpan(tallFrac: number): Composer {
  return (dims) => {
    const tallW = dims.w * tallFrac;
    const lowW = dims.w - tallW;
    return [
      { x: -dims.w / 2 + tallW / 2, z: 0, w: tallW, d: dims.d, y0: 0, y1: dims.height },
      {
        x: dims.w / 2 - lowW / 2, z: 0, w: lowW, d: dims.d,
        // 下限半層樓，理由同 mainPlusWing。
        y0: 0,
        y1: Math.min(dims.height - 1e-6, Math.max(dims.floorHeight * 0.5, dims.height * 0.62)),
      },
    ];
  };
}

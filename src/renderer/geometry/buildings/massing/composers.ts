import { PART_DETAIL, PART_ROOF } from '../parts';
import { ROOF_PITCH_FRAC } from './metrics';
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

/**
 * 圓塔。整棟一根圓柱，沒有裙樓。
 *
 * 這是階段 2C-1 弄丟的 `makeComHighV2`（八角柱身 + 圓盤簷）。`assemble` 的
 * 圓柱是 8 段，所以它實際上是八角柱 —— 與原本那一版一樣。
 *
 * **寬深取短邊而不是各自吃 `dims.w` / `dims.d`**：兩者是分別抖動的，直接用
 * 會得到橢圓柱，而圓形之所以是特色正因為它是圓的。取短邊也順便保證它不會
 * 越過行人包絡線。
 *
 * 它是完全旋轉對稱的 —— 四向旋轉在它身上生不出任何變化，所以在原型表裡
 * 必須排在最後，不能占掉不對稱變體的配額（見 `prototypes.ts` 的表頭）。
 */
export function roundTower(diameterFrac: number): Composer {
  return (dims) => {
    const t = Math.min(dims.w, dims.d) * diameterFrac;
    const capH = dims.floorHeight * 0.12;
    return [
      { x: 0, z: 0, w: t, d: t, y0: 0, y1: dims.height - capH, shape: 'cylinder' },
      // 略微外挑的圓盤簷。放在量體裡而不是交給屋頂形式 —— `roofFor` 是按
      // variantIndex 分層的，圓塔目前落在 `flat`（不產生任何屋頂量體），
      // 靠屋頂那條路它永遠拿不到簷板。這片簷是原本 makeComHighV2 的 cap。
      {
        x: 0, z: 0, w: t * 1.06, d: t * 1.06,
        y0: dims.height - capH, y1: dims.height,
        shape: 'cylinder', part: PART_ROOF,
      },
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

/** 立管露在屋脊之上的最小高度，一層樓的 15%。低於這個就只是「屋頂上有個包」。 */
const STACK_REVEAL = 0.15;

/**
 * 廠房頂面的高度。
 *
 * 三個限制夾出來的：
 *   下限 0.35 層樓 —— 再低就不是廠房了
 *   上限 `height − 屋脊 − 露出量` —— 立管必須看得見地高過屋脊。一層樓的
 *          建築配 0.62 的比例會讓屋脊爬到 1.07 × 高度，把煙囪整根埋掉，
 *          而工業的高度表裡一層樓的變體很常見（容差是 ±3.1 m）
 *   目標 `height × frac`
 */
function shedTop(dims: Dimensions, frac: number): number {
  const cap = dims.height - dims.floorHeight * (ROOF_PITCH_FRAC + STACK_REVEAL);
  return Math.min(
    dims.height - 1e-6,
    Math.max(dims.floorHeight * 0.35, Math.min(cap, dims.height * frac)),
  );
}

/**
 * 廠房 + 落地立管（煙囪、筒倉、水塔）。
 *
 * 工業的等級階梯**不**表現在高度上 —— 現代廠房幾乎都是單層挑高、鋪滿基地，
 * 多層工廠很少見（見 `TARGET_HEIGHTS_M` 的註解）。所以目標高度由立管去達成，
 * 廠房本體只佔其中一部分：一個 9 m 高的煙囪配 5.6 m 的廠房，遠比一個 9 m 的
 * 方盒像工廠。
 *
 * 立管標 `PART_DETAIL` 而不是 `PART_WALL`：工業的立面 shader 會在牆上畫浪板
 * 與一整排大捲門，而煙囪上不該有捲門。
 */
export function shedWithStack(
  bayFrac: number, shedFrac: number, shape: 'box' | 'cylinder',
): Composer {
  return (dims, rng) => {
    const bayW = dims.w * bayFrac;
    const shedW = dims.w - bayW;
    const stackD = Math.min(bayW, dims.d * 0.5);
    return [
      { x: -dims.w / 2 + shedW / 2, z: 0, w: shedW, d: dims.d, y0: 0, y1: shedTop(dims, shedFrac) },
      {
        // 立管靠基地的一端而不是正中央 —— 正中央的話整個組合器又對稱了，
        // 四向旋轉的四倍變化就白給。
        x: dims.w / 2 - bayW / 2,
        z: (dims.d / 2 - stackD / 2) * (rng() < 0.5 ? 0.85 : -0.85),
        w: bayW, d: stackD, y0: 0, y1: dims.height,
        shape, part: PART_DETAIL,
      },
    ];
  };
}

/**
 * 廠房 + 一排筒倉。
 *
 * 這一個是對稱的，而且刻意如此 —— 工業的不對稱來源已經有偏屋、兩跨、L 形與
 * 立管四個，再多一個只是重複；一整排等高的筒倉本來就是對稱的東西。
 */
export function siloRow(count: number, bayFrac: number, shedFrac: number): Composer {
  return (dims) => {
    const bayD = dims.d * bayFrac;
    const shedD = dims.d - bayD;
    const pitch = dims.w / count;
    // 0.82 而不是 1：筒倉之間要有縫，貼在一起在俯視輪廓上就是一道實心的牆。
    const dia = Math.min(bayD, pitch * 0.82);
    const out: Volume[] = [{
      x: 0, z: -dims.d / 2 + shedD / 2,
      w: dims.w, d: shedD, y0: 0, y1: shedTop(dims, shedFrac),
    }];
    for (let i = 0; i < count; i++) {
      out.push({
        x: -dims.w / 2 + pitch * (i + 0.5), z: dims.d / 2 - bayD / 2,
        w: dia, d: dia, y0: 0,
        // 至少一支達到目標高度，其餘矮一截 —— 一排等高的筒倉像一道柵欄。
        y1: i % 2 === 0 ? dims.height : dims.height * 0.78,
        shape: 'cylinder', part: PART_DETAIL,
      });
    }
    return out;
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

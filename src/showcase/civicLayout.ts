import { getInfraConfig, type InfraType } from '../core/building/InfraConfig';

/**
 * 把全部公共建築排進展示區。
 *
 * 公共建築模式直接把全部一起顯示出來。逐一切換看不出
 * 十九棟**彼此**的關係 —— 顏色分不分得開、高度差合不合理、街道家具的密度一不
 * 一致，這些只有並排時才看得出來，而它們正是這次改造要驗收的東西。
 *
 * 單位一律是**格**（1 格 = 12 m），與 `CivicPlan` 的座標同一套。
 */

/** 兩棟之間留的空地（格）。 */
export const CIVIC_LAYOUT_GAP = 2;

/**
 * 一列的寬度上限（格）。
 *
 * 十九棟排成一列的話總長超過 60 格 = 720 m，鏡頭要拉到看不見任何細節的高度
 * 才裝得下。18 格讓整批接近正方形 —— 而正方形是等角鏡頭最省的形狀。
 *
 * 它必須小於「兩座大型機場並排」（9 + 2 + 9 = 20），否則換行邏輯在實際資料
 * 上永遠不會觸發，而那是最容易寫錯又最不容易發現的分支。
 */
export const CIVIC_LAYOUT_ROW_LIMIT = 18;

/** 一棟建築在展示區裡的位置。`x` / `z` 是**佔地中心**，與 plan 的原點對齊。 */
export interface CivicSlot {
  type: InfraType;
  x: number;
  z: number;
}

/**
 * 依 `types` 的順序逐列排放，整批置中於原點。
 *
 * 順序**不重排** —— 它來自 `CIVIC_MODELS` 的宣告順序，而那是逐批排的。
 * 按大小重排會讓警局與消防局分開，而「藍的紅的分不分得開」正是要並排才
 * 看得出來的東西。
 *
 * 同一列的建築**前緣對齊**（z 小的那一側），不是置中對齊：對齊的邊讓「這一
 * 列有幾棟」一眼讀得出來，而置中對齊在深度差三倍時看起來像散落的。
 */
export function civicLayout(types: readonly InfraType[]): CivicSlot[] {
  const slots: CivicSlot[] = [];
  /** 這一列下一棟的左緣。 */
  let cursorX = 0;
  /** 這一列的前緣。 */
  let rowZ = 0;
  /** 這一列目前最深的一棟。下一列從它之後起算。 */
  let rowDepth = 0;

  for (const type of types) {
    const cfg = getInfraConfig(type);
    // 查不到就當 1×1。這裡不丟例外 —— 展示區是拿來看東西的，
    // 為了一個查不到的種類整頁空白不划算。
    const w = cfg?.width ?? 1;
    const h = cfg?.height ?? 1;

    // 換行是單一個 `if` 而不是迴圈 —— 所以一棟寬到單獨都超過上限的建築
    // （目前沒有，但大型機場 9 格已經是上限的一半）仍然放得下：它換一次行，
    // 然後就地放下去。曾經這裡多一個 `cursorX > 0` 的前提，但那個分支只可能
    // 在整份清單的第一棟觸發，而它做的只是把每一列一起往下推一個間距 ——
    // 置中之後完全看不出來。無效的分支比沒有分支糟：它看起來被守住了。
    if (cursorX + w > CIVIC_LAYOUT_ROW_LIMIT) {
      rowZ += rowDepth + CIVIC_LAYOUT_GAP;
      cursorX = 0;
      rowDepth = 0;
    }

    slots.push({ type, x: cursorX + w / 2, z: rowZ + h / 2 });
    cursorX += w + CIVIC_LAYOUT_GAP;
    rowDepth = Math.max(rowDepth, h);
  }

  return centre(slots);
}

/**
 * 整批排完之後佔多大（格）。
 *
 * 展示區用它把鏡頭拉到剛好框住全部 —— 十九棟排出來有 18 × 30 格，而預設的
 * 視錐是給 8×8 街廓訂的，不調的話一切到公共建築看到的是遠處一小撮。
 *
 * 算的是**含佔地**的範圍，不是中心點的範圍：只看中心的話，邊緣那一棟會有
 * 一半在畫面外。
 */
export function civicLayoutExtent(slots: readonly CivicSlot[]): { w: number; h: number } {
  if (slots.length === 0) return { w: 0, h: 0 };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of slots) {
    const cfg = getInfraConfig(s.type);
    const w = cfg?.width ?? 1;
    const h = cfg?.height ?? 1;
    x0 = Math.min(x0, s.x - w / 2);
    x1 = Math.max(x1, s.x + w / 2);
    z0 = Math.min(z0, s.z - h / 2);
    z1 = Math.max(z1, s.z + h / 2);
  }
  return { w: x1 - x0, h: z1 - z0 };
}

/**
 * 整批平移到原點。
 *
 * 展示區的鏡頭預設對著原點，而排版是從 (0, 0) 往正象限長的 —— 不平移的話
 * 開啟時看到的是空地。矩陣模式踩過這個坑，那裡是靠 `setCameraTarget` 事後
 * 補救的；這裡直接把座標排對，鏡頭就不必知道排版的事。
 */
function centre(slots: CivicSlot[]): CivicSlot[] {
  if (slots.length === 0) return slots;

  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of slots) {
    const cfg = getInfraConfig(s.type);
    const w = cfg?.width ?? 1;
    const h = cfg?.height ?? 1;
    x0 = Math.min(x0, s.x - w / 2);
    x1 = Math.max(x1, s.x + w / 2);
    z0 = Math.min(z0, s.z - h / 2);
    z1 = Math.max(z1, s.z + h / 2);
  }
  const dx = (x0 + x1) / 2;
  const dz = (z0 + z1) / 2;
  return slots.map(s => ({ ...s, x: s.x - dx, z: s.z - dz }));
}

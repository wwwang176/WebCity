import { describe, it, expect } from 'vitest';
import {
  civicLayout, civicLayoutExtent, CIVIC_LAYOUT_GAP, CIVIC_LAYOUT_ROW_LIMIT,
} from '../civicLayout';
import { civicTypesDone } from '../../renderer/geometry/civic/registry';
import { getInfraConfig, type InfraType } from '../../core/building/InfraConfig';

/**
 * 展示區把**全部**公共建築一次排出來。
 *
 * 公共建築模式直接把全部一起顯示出來。逐一切換的問題不只是麻煩 —— 十九種建築的**相互關係**（顏色分不分
 * 得開、高度差合不合理、街道家具的密度一不一致）只有並排時看得出來，而那
 * 正是這次改造要驗收的東西。
 */

/**
 * 一份混了各種尺寸、跨好幾列的清單。
 *
 * **不是** `civicTypesDone()`：那張表是逐批填滿的，一開始只有一棟 —— 而
 * 「兩兩不重疊」「列與列之間留白」在單筆資料上是空的敘述。實際踩到過：
 * 把換行的 `rowZ += rowDepth + GAP` 改成 `rowZ += GAP`（列與列直接壓在
 * 一起）時，全部測試仍然是綠的。
 *
 * 深度刻意不一致（6 / 3 / 1 / 4 …）：同一列裡最深的那一棟決定下一列從哪裡
 * 開始，用清一色 2×2 的清單測不出這件事。
 */
const MIXED: InfraType[] = [
  'airport_l', 'airport_l', 'police', 'hospital', 'bus_stop',
  'school_univ', 'airport_m', 'park', 'fire', 'school_high',
  'water', 'ferry_dock', 'cemetery',
];

const foot = (t: InfraType) => {
  const c = getInfraConfig(t)!;
  return { w: c.width, h: c.height };
};

/** 一棟建築佔的矩形（格）。 */
function rect(slot: { type: InfraType; x: number; z: number }) {
  const f = foot(slot.type);
  return {
    x0: slot.x - f.w / 2, x1: slot.x + f.w / 2,
    z0: slot.z - f.h / 2, z1: slot.z + f.h / 2,
  };
}

/** 兩兩之間的最小留白（負值 = 重疊多少）。 */
function closestPair(types: InfraType[]): { gap: number; who: string } {
  const slots = civicLayout(types);
  let gap = Infinity;
  let who = '（沒有兩棟以上）';
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = rect(slots[i]!), b = rect(slots[j]!);
      // 兩軸取大：只要有一軸分得開，兩個矩形就分得開。
      const d = Math.max(
        Math.max(a.x0 - b.x1, b.x0 - a.x1),
        Math.max(a.z0 - b.z1, b.z0 - a.z1),
      );
      if (d < gap) {
        gap = d;
        who = `${slots[i]!.type} 與 ${slots[j]!.type}`;
      }
    }
  }
  return { gap, who };
}

describe.each([
  ['實際已完成的種類', () => civicTypesDone()],
  ['混合尺寸的合成清單', () => MIXED],
])('公共建築的排版（%s）', (_label, listOf) => {
  it('should place every type exactly once, in the order given', () => {
    // 少一棟的話畫面上只表現為「我做的那棟沒出現」—— 而那與「還沒做」
    // 長得一模一樣。
    expect(civicLayout(listOf()).map(s => s.type)).toEqual(listOf());
  });

  it('should never let two buildings overlap', () => {
    // 這是排版唯一真正的正確性條件。重疊的兩棟會互相穿插，而且沒有任何
    // 錯誤訊息 —— 看起來像某一棟自己畫壞了。
    const { gap, who } = closestPair(listOf());
    expect(gap, `${who} 重疊`).toBeGreaterThan(0);
  });

  it('should keep a walkable gap between neighbours', () => {
    // 只測「不重疊」的話，把間距寫成 0 也會通過 —— 而十九棟貼在一起是
    // 一整片沒有邊界的建築群，分不出哪裡是哪一棟的基地。
    const { gap, who } = closestPair(listOf());
    expect(gap, `${who} 之間沒有留白`).toBeGreaterThanOrEqual(CIVIC_LAYOUT_GAP - 1e-9);
  });

  it('should wrap into rows instead of one endless line', () => {
    // 十九棟排成一列的話總長超過 60 格 = 720 m，鏡頭要拉到看不見細節的
    // 高度才裝得下。
    const rs = civicLayout(listOf()).map(rect);
    const width = Math.max(...rs.map(r => r.x1)) - Math.min(...rs.map(r => r.x0));
    expect(width).toBeLessThanOrEqual(CIVIC_LAYOUT_ROW_LIMIT + 1e-9);
  });

  it('should centre the whole layout on the origin', () => {
    // 展示區的鏡頭預設對著原點。整批偏在正象限的話，開啟時看到的是空地
    // ——「矩陣模式」就踩過這個坑。
    const rs = civicLayout(listOf()).map(rect);
    const cx = (Math.min(...rs.map(r => r.x0)) + Math.max(...rs.map(r => r.x1))) / 2;
    const cz = (Math.min(...rs.map(r => r.z0)) + Math.max(...rs.map(r => r.z1))) / 2;
    expect(cx).toBeCloseTo(0, 6);
    expect(cz).toBeCloseTo(0, 6);
  });
});

describe('公共建築的排版', () => {
  it('should start a new row when the next building would not fit', () => {
    // 兩座大型機場並排是 9 + 2 + 9 = 20 格，超過上限 —— 必須換行，
    // 而不是硬擠出去。
    const slots = civicLayout(['airport_l', 'airport_l']);
    expect(slots[0]!.z, '第二棟沒有換行').not.toBeCloseTo(slots[1]!.z, 6);
  });

  it('should keep the batch order so related buildings stand together', () => {
    // 順序取自 `civicTypesDone()`（= `CIVIC_MODELS` 的宣告順序，逐批排的）。
    // 按大小重排的話，警局與消防局不會相鄰 —— 而「藍的紅的分不分得開」
    // 正是要並排才看得出來的東西。
    const asked: InfraType[] = ['park', 'airport_l', 'police'];
    expect(civicLayout(asked).map(s => s.type)).toEqual(asked);
  });

  it('should return nothing for an empty list', () => {
    expect(civicLayout([])).toEqual([]);
    expect(civicLayoutExtent([])).toEqual({ w: 0, h: 0 });
  });

  it('should measure the extent including the footprints, not just the centres', () => {
    // 只量中心的話，邊緣那一棟會有一半在畫面外 —— 而鏡頭就是照這個數字拉的。
    const slots = civicLayout(['airport_l']);
    expect(civicLayoutExtent(slots)).toEqual({ w: 9, h: 6 });
  });

  it('should cover every building in the extent it reports', () => {
    const slots = civicLayout(MIXED);
    const ext = civicLayoutExtent(slots);
    for (const s of slots) {
      const r = rect(s);
      expect(Math.max(Math.abs(r.x0), Math.abs(r.x1)), `${s.type} 落在回報的範圍外`)
        .toBeLessThanOrEqual(ext.w / 2 + 1e-9);
      expect(Math.max(Math.abs(r.z0), Math.abs(r.z1)), `${s.type} 落在回報的範圍外`)
        .toBeLessThanOrEqual(ext.h / 2 + 1e-9);
    }
  });
});

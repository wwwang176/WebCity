import { describe, it, expect } from 'vitest';
import { districtOutline } from '../DistrictOutline';

/**
 * 選取中的分區在地圖上要看得見。
 *
 * 畫外框而不是把整區塗亮:分區圖層本來就已經在那些格子上鋪了一層顏色，再疊一層
 * 半透明的白只會讓那一區看起來褪色，而不是被選中。
 *
 * 座標:格子中心落在整數上（跟建築、游標一致），所以邊界落在 .5。外框跟圖層的色塊
 * 必須切在同一條線上，差半格就會看到色塊露出邊。
 */

const key = (x: number, y: number) => `${x},${y}`;
const rect = (x1: number, y1: number, x2: number, y2: number) => {
  const s = new Set<string>();
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) s.add(key(x, y));
  return s;
};

/** 線段的正規化字串，方便比對 —— 兩端點誰先誰後不該影響結果。 */
const norm = (s: { x1: number; y1: number; x2: number; y2: number }) => {
  const a = `${s.x1},${s.y1}`, b = `${s.x2},${s.y2}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};
const outlineOf = (cells: Set<string>) => districtOutline(cells).map(norm).sort();

describe('分區外框', () => {
  it('should draw a unit square around a single cell', () => {
    expect(outlineOf(rect(0, 0, 0, 0))).toEqual([
      '-0.5,-0.5|-0.5,0.5',   // 西
      '-0.5,-0.5|0.5,-0.5',   // 北
      '-0.5,0.5|0.5,0.5',     // 南
      '0.5,-0.5|0.5,0.5',     // 東
    ].sort());
  });

  it('should not draw the seam between two neighbours', () => {
    // 兩格並排的外框是 6 段，不是 8 段。中間那條線在兩邊各出現一次，兩次都要消掉。
    const segs = outlineOf(rect(0, 0, 1, 0));
    expect(segs.length, '中間的接縫沒有消掉').toBe(6);
    expect(segs).not.toContain('0.5,-0.5|0.5,0.5');
  });

  it('should trace a hole in the middle', () => {
    // 扣除模式挖出來的洞也是邊界。少了它，被挖空的中間看起來還在選取範圍裡。
    const cells = rect(0, 0, 2, 2);
    cells.delete(key(1, 1));
    const segs = outlineOf(cells);
    expect(segs.length, '外圈 12 段 + 洞 4 段').toBe(16);
    expect(segs, '洞的北邊沒有畫').toContain('0.5,0.5|1.5,0.5');
  });

  it('should outline each piece of a split district', () => {
    // 分區不必連通 —— 扣除可以把一區切成兩塊。
    const cells = new Set([...rect(0, 0, 0, 0), ...rect(5, 5, 5, 5)]);
    expect(outlineOf(cells).length).toBe(8);
  });

  it('should produce nothing for an empty district', () => {
    expect(districtOutline(new Set())).toEqual([]);
  });

  it('should ignore duplicated work on a big block', () => {
    // 5x5 的外框是 20 段。內部 4x5 + 5x4 = 40 條接縫全部要消掉。
    expect(outlineOf(rect(0, 0, 4, 4)).length).toBe(20);
  });
});

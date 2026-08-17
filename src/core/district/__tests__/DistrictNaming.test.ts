import { describe, it, expect } from 'vitest';
import { nextDistrictName, sanitiseDistrictName, DISTRICT_NAME_MAX } from '../DistrictNaming';

/**
 * 分區的名字。
 *
 * 預設名字原本是 `District ${分區數量 + 1}` —— 數量會因為合併而變少，於是合併過
 * 一次之後再開新的就可能跟既有的撞名。兩個同名的分區在側邊欄裡分不出來，而條例
 * 是設定在各自身上的。
 */

describe('預設名字', () => {
  it('should start at 1', () => {
    expect(nextDistrictName([])).toBe('District 1');
  });

  it('should skip the ones already taken', () => {
    expect(nextDistrictName(['District 1', 'District 2'])).toBe('District 3');
  });

  it('should fill a gap left by a merge', () => {
    // 合併把 District 2 併掉之後，下一個新分區該補那個洞，不是跳到 3。
    expect(nextDistrictName(['District 1', 'District 3'])).toBe('District 2');
  });

  it('should not collide with a renamed district that took the number', () => {
    // 玩家把某一區改名成 District 5 也算佔用 —— 撞名的來源不分是誰取的。
    expect(nextDistrictName(['District 1', 'District 5'])).toBe('District 2');
    expect(nextDistrictName(['District 1', 'District 2', 'District 3', 'District 5']))
      .toBe('District 4');
  });

  it('should ignore names that are not of the default shape', () => {
    expect(nextDistrictName(['Riverside', 'Docklands'])).toBe('District 1');
  });
});

describe('玩家改的名字', () => {
  it('should trim the whitespace around it', () => {
    expect(sanitiseDistrictName('  Riverside  ', 'District 1')).toBe('Riverside');
  });

  it('should fall back when the player clears it', () => {
    // 空白名字在側邊欄裡是一顆按不出東西的空按鈕。
    expect(sanitiseDistrictName('', 'District 3')).toBe('District 3');
    expect(sanitiseDistrictName('   ', 'District 3')).toBe('District 3');
  });

  it('should cut a name that would not fit the sidebar', () => {
    const long = 'x'.repeat(DISTRICT_NAME_MAX + 20);
    expect(sanitiseDistrictName(long, 'District 1').length).toBe(DISTRICT_NAME_MAX);
  });

  it('should keep a name that is exactly at the limit', () => {
    const exact = 'y'.repeat(DISTRICT_NAME_MAX);
    expect(sanitiseDistrictName(exact, 'District 1')).toBe(exact);
  });

  it('should strip newlines rather than let them into the label', () => {
    // 貼上多行文字時，換行會把側邊欄的按鈕撐開。
    expect(sanitiseDistrictName('Old\nTown', 'District 1')).toBe('Old Town');
  });
});

import { describe, it, expect } from 'vitest';
import {
  nextPolicyLevel, policyButtonText, policyEffectSummary, districtPolicyTotal,
} from '../PolicyPresentation';
import { maxLevel, POLICY_EFFECTS } from '../PolicyManager';
import { POLICY_SCOPE } from '../PolicyScope';
import { PolicyType } from '../types';

/**
 * UI 的純邏輯抽在這裡，因為 Solid 那一層綁著 `getGame()`，專案既有慣例是不測 UI
 * —— 但「按一次進幾級」「按鈕上寫什麼」是真的會錯的規則，不該只靠肉眼。
 */

const SCALE = { population: 1000, districtCells: 50 };

describe('等級循環', () => {
  it('should walk every level then return to off', () => {
    // 一顆按鈕就走得完，不必為三級各放一顆。
    const type = PolicyType.ENCOURAGE_RECYCLING;
    const seen: number[] = [];
    let level = 0;
    for (let i = 0; i <= maxLevel(type); i++) { level = nextPolicyLevel(level, type); seen.push(level); }
    expect(seen).toEqual([1, 2, 3, 0]);
  });

  it('should be a two-state toggle for a single-tier policy', () => {
    expect(nextPolicyLevel(0, PolicyType.TOURISM)).toBe(1);
    expect(nextPolicyLevel(1, PolicyType.TOURISM)).toBe(0);
  });

  it('should be a two-state toggle for a restriction policy', () => {
    // 限制型沒有效果表條目，maxLevel 是 1 —— 循環不能因此壞掉。
    expect(nextPolicyLevel(0, PolicyType.NO_HEAVY_INDUSTRY)).toBe(1);
    expect(nextPolicyLevel(1, PolicyType.NO_HEAVY_INDUSTRY)).toBe(0);
  });

  it('should recover from a level the table no longer offers', () => {
    // 存檔可能帶著一個比現在表格更高的等級。回不到 0 的話按鈕會卡住。
    expect(nextPolicyLevel(9, PolicyType.TOURISM)).toBe(0);
  });
});

describe('按鈕上的字', () => {
  it('should show one dot per level', () => {
    expect(policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, SCALE)).toContain('●●');
    expect(policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 3, SCALE)).toContain('●●●');
  });

  it('should show the current cost, not a fixed price', () => {
    // 費用寫在按鈕上而不是說明頁，是因為它會隨規模變動 —— 把分區畫大一倍數字就
    // 跳一倍，那是「依規模計費」最直接的回饋。
    const small = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, { population: 1000, districtCells: 10 });
    const big = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, { population: 1000, districtCells: 400 });
    expect(small, '兩個規模顯示同一個價錢').not.toBe(big);
  });

  it('should show no price for a restriction policy', () => {
    // 限制型不收費 —— 標一個 $0 會讓玩家以為那是「免費的好處」。
    expect(policyButtonText(PolicyType.NO_HEAVY_INDUSTRY, 1, SCALE)).not.toContain('$');
  });

  it('should show no dots and no price when off', () => {
    const off = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 0, SCALE);
    expect(off).not.toContain('●');
    expect(off).not.toContain('$');
  });

  it('should always carry the policy name', () => {
    for (const type of Object.values(PolicyType)) {
      for (const level of [0, 1, 2, 3]) {
        expect(policyButtonText(type, level, SCALE).length,
          `${type} 第 ${level} 級的按鈕沒有字`).toBeGreaterThan(0);
      }
    }
  });
});

describe('效果摘要', () => {
  it('should state both the benefit and the price on the same line', () => {
    // 取捨是玩法，藏在 tooltip 裡就沒有取捨。玩家要在按下去之前看得到代價。
    const summary = policyEffectSummary(PolicyType.ENCOURAGE_RECYCLING, 3);
    expect(summary, '沒有講好處').toMatch(/垃圾/);
    expect(summary, '沒有講代價').toMatch(/收入/);
  });

  it('should say nothing for a level that is off', () => {
    expect(policyEffectSummary(PolicyType.ENCOURAGE_RECYCLING, 0)).toBe('');
  });

  it('should describe every tier of every policy in the effect table', () => {
    // 加了一條條例卻沒有描述的話，玩家看到的是一顆沒有說明的按鈕。
    for (const [type, tiers] of Object.entries(POLICY_EFFECTS)) {
      for (let i = 1; i <= tiers!.length; i++) {
        expect(policyEffectSummary(type as PolicyType, i).length,
          `${type} 第 ${i} 級沒有描述`).toBeGreaterThan(0);
      }
    }
  });
});

describe('分區合計', () => {
  it('should add up every billable policy in the district', () => {
    const total = districtPolicyTotal(
      [
        { type: PolicyType.ENCOURAGE_RECYCLING, level: 2 },
        { type: PolicyType.TOURISM, level: 1 },
        { type: PolicyType.NO_HEAVY_INDUSTRY, level: 1 },
      ],
      SCALE,
    );
    expect(total, '合計是 0，這條測試等於空轉').toBeGreaterThan(0);
    expect(total).toBeCloseTo(
      districtPolicyTotal([{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 }], SCALE)
      + districtPolicyTotal([{ type: PolicyType.TOURISM, level: 1 }], SCALE), 6);
  });

  it('should be zero for a district with nothing switched on', () => {
    expect(districtPolicyTotal([{ type: PolicyType.TOURISM, level: 0 }], SCALE)).toBe(0);
  });
});

describe('分區面板只列分區條例', () => {
  it('should not offer a city ordinance on a district', () => {
    // 列出來玩家會按，按了沒反應（setPolicyLevel 會擋）—— 那比看不到更糟。
    const cityScoped = (Object.values(PolicyType) as PolicyType[])
      .filter(t => POLICY_SCOPE[t] === 'city');
    expect(cityScoped.length, '沒有全城條例，這條測試等於空轉').toBeGreaterThan(0);
  });
});

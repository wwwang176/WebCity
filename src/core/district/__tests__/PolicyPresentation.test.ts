import { describe, it, expect } from 'vitest';
import {
  nextPolicyLevel, policyButtonText, policyEffectSummary, districtPolicyTotal,
  districtOfferedPolicies,
} from '../PolicyPresentation';
import { maxLevel, POLICY_EFFECTS, POLICY_CONFIG } from '../PolicyManager';
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
    // 只驗長度 > 0 的話，把所有名字改成 'X' 也會過。要驗的是那個字串真的是這條
    // 條例的名字。
    for (const type of Object.values(PolicyType)) {
      const name = POLICY_CONFIG[type].name;
      for (const level of [0, 1, 2, 3]) {
        expect(policyButtonText(type, level, SCALE),
          `${type} 第 ${level} 級的按鈕沒有寫出它的名字`).toContain(name);
      }
    }
  });
});

describe('效果摘要', () => {
  it('should state both the benefit and the price on the same line', () => {
    // 取捨是玩法，藏在 tooltip 裡就沒有取捨。玩家要在按下去之前看得到代價。
    const summary = policyEffectSummary(PolicyType.ENCOURAGE_RECYCLING, 3);
    expect(summary, '沒有講好處').toMatch(/Garbage/);
    expect(summary, '沒有講代價').toMatch(/revenue/i);
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

  it('should give a distinct sentence to every policy and every tier', () => {
    // 只驗「有字」的話，一個回傳固定字串的實作也會過 —— 而那正是玩家最容易被騙
    // 的形狀:每顆按鈕的說明都一樣，看起來像有說明。
    const seen = new Map<string, string>();
    for (const type of Object.values(PolicyType)) {
      for (let lv = 1; lv <= maxLevel(type); lv++) {
        const text = policyEffectSummary(type, lv);
        const key = `${type}#${lv}`;
        const clash = seen.get(text);
        expect(clash, `${key} 的說明跟 ${clash} 一字不差`).toBeUndefined();
        seen.set(text, key);
      }
    }
    expect(seen.size, '一條說明都沒有，這條測試等於空轉').toBeGreaterThan(5);
  });

  it('should describe the quantity each policy actually moves', () => {
    // 說明必須對得上效果表 —— 不然改了數字忘了改說明，玩家看到的是舊的承諾。
    for (const type of Object.values(PolicyType)) {
      for (let lv = 1; lv <= maxLevel(type); lv++) {
        const tier = POLICY_EFFECTS[type]?.[lv - 1];
        const text = policyEffectSummary(type, lv);
        if (tier?.garbage !== undefined) expect(text, `${type} 動了垃圾卻沒說`).toContain('Garbage');
        if (tier?.landValue !== undefined) expect(text, `${type} 動了地價卻沒說`).toContain('Land value');
        if (tier?.crime !== undefined) expect(text, `${type} 動了犯罪卻沒說`).toContain('Crime');
        if (tier?.powerDemand !== undefined) expect(text, `${type} 動了電力卻沒說`).toContain('Power demand');
        if (tier?.revenue !== undefined || tier?.revenueByZone) {
          // 句首會是 Revenue，句中是 revenue —— 比對詞不是比對大小寫。
          expect(text, `${type} 動了收入卻沒說`).toMatch(/revenue/i);
        }
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
    //
    // 第一版這條只驗「範圍表裡有全城條例」，完全沒碰到那份清單 —— 把 modal 的
    // filter 拿掉照樣綠。清單本身是純資料，所以搬進 core 讓它測得到。
    const offered = districtOfferedPolicies();
    const cityScoped = (Object.values(PolicyType) as PolicyType[])
      .filter(t => POLICY_SCOPE[t] === 'city');
    expect(cityScoped.length, '沒有全城條例，這條測試等於空轉').toBeGreaterThan(0);
    for (const t of cityScoped) {
      expect(offered, `${t} 是全城條例卻出現在分區面板`).not.toContain(t);
    }
  });

  it('should offer every implemented district policy', () => {
    // 反面控制:回傳空陣列的話上面那條也會過，但玩家一條政策都看不到。
    const offered = districtOfferedPolicies();
    expect(offered.length, '分區面板一條政策都沒有').toBeGreaterThan(0);
    for (const t of offered) {
      expect(POLICY_SCOPE[t], `${t} 不是分區條例卻被列出來`).toBe('district');
    }
    expect(offered, '回收沒有被列出來').toContain(PolicyType.ENCOURAGE_RECYCLING);
    expect(offered, '禁重工業沒有被列出來').toContain(PolicyType.NO_HEAVY_INDUSTRY);
  });
});

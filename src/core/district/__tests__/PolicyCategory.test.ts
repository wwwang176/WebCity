import { describe, it, expect } from 'vitest';
import {
  policiesByCategory, POLICY_CATEGORY, CATEGORY_ORDER, RETIRED_CATEGORY,
} from '../PolicyPresentation';
import { POLICY_SCOPE } from '../PolicyScope';
import { IMPLEMENTED_POLICY_TYPES } from '../PolicyManager';
import { PolicyType } from '../types';

/**
 * 16 條擺成一排玩家找不到東西。分類是「這條條例在管什麼」。
 *
 * 這裡守的是分組本身。面板只剩標記 —— 專案沒有 DOM 測試環境，所以「modal 有沒有
 * 呼叫這個函式」守不到，那一行的正確性靠 review。分組邏輯全部搬進來就是為了把
 * 守不到的範圍縮到那一行。
 */

describe('分類表', () => {
  it('should place every policy in one of the listed categories', () => {
    // Record 是完整型別，漏一條編不過;但分類名稱打錯不會 —— 那條就會憑空消失，
    // 因為 policiesByCategory 只走 CATEGORY_ORDER。
    for (const type of Object.values(PolicyType)) {
      expect(CATEGORY_ORDER as readonly string[], `${type} 的分類不在面板的順序裡`)
        .toContain(POLICY_CATEGORY[type]);
    }
  });
});

describe('依分類分組', () => {
  it('should show every implemented district policy exactly once', () => {
    const groups = policiesByCategory('district');
    const flat = groups.flatMap(g => g.policies);
    expect(new Set(flat).size, '同一條條例被列了兩次').toBe(flat.length);
    const expected = [...IMPLEMENTED_POLICY_TYPES].filter(t => POLICY_SCOPE[t] === 'district');
    expect(new Set(flat), '分區面板列出來的條例跟該提供的對不起來').toEqual(new Set(expected));
  });

  it('should show every implemented city ordinance exactly once', () => {
    const flat = policiesByCategory('city').flatMap(g => g.policies);
    const expected = [...IMPLEMENTED_POLICY_TYPES].filter(t => POLICY_SCOPE[t] === 'city');
    expect(new Set(flat), '全城面板列出來的條例跟該提供的對不起來').toEqual(new Set(expected));
  });

  it('should never mix the two scopes', () => {
    for (const g of policiesByCategory('district')) {
      for (const t of g.policies) {
        expect(POLICY_SCOPE[t], `${t} 是全城條例卻出現在分區面板`).toBe('district');
      }
    }
    for (const g of policiesByCategory('city')) {
      for (const t of g.policies) {
        expect(POLICY_SCOPE[t], `${t} 是分區條例卻出現在全城面板`).toBe('city');
      }
    }
  });

  it('should keep the categories in a fixed order and drop the empty ones', () => {
    const names = policiesByCategory('district').map(g => g.category);
    expect(names.length, '一個分類都沒有').toBeGreaterThan(1);
    // 順序是 CATEGORY_ORDER 的子序列。面板的分類每次開都跳來跳去的話，玩家會
    // 找不到上次按的那顆按鈕。
    const positions = names.map(n => (CATEGORY_ORDER as readonly string[]).indexOf(n));
    expect(positions, '分類的順序不是固定的').toEqual([...positions].sort((a, b) => a - b));
    for (const g of policiesByCategory('district')) {
      expect(g.policies.length, `${g.category} 是空的卻還是被列出來`).toBeGreaterThan(0);
    }
  });

  it('should have no land-use or economy group in the city panel', () => {
    // 「在哪裡蓋什麼」跟「哪一區補貼」本來就都是分區的問題。這條釘的是這個設計
    // 決定 —— 哪天有一條全城的土地使用條例，這裡會紅，那時候該一起想清楚。
    const names = policiesByCategory('city').map(g => g.category);
    expect(names, '全城面板出現了土地使用分類').not.toContain('Land use');
    expect(names, '全城面板出現了經濟分類').not.toContain('Economy');
  });
});

describe('舊存檔帶著的條例', () => {
  it('should still list a policy this district carries but nobody offers any more', () => {
    // 不列出來的話玩家就再也關不掉它 —— 而它還在存檔裡。
    const retiredish = PolicyType.ENERGY_REGULATION;   // 全城條例，分區面板不提供
    const groups = policiesByCategory('district', [retiredish]);
    const retired = groups.find(g => g.category === RETIRED_CATEGORY);
    expect(retired?.policies, '已下架的條例沒有被列出來').toContain(retiredish);
  });

  it('should put it last, after everything still in force', () => {
    const groups = policiesByCategory('district', [PolicyType.ENERGY_REGULATION]);
    expect(groups[groups.length - 1]!.category, '已下架的那一組沒有排在最後')
      .toBe(RETIRED_CATEGORY);
  });

  it('should not duplicate one that is offered anyway', () => {
    const withExtra = policiesByCategory('district', [PolicyType.ENCOURAGE_RECYCLING]);
    const flat = withExtra.flatMap(g => g.policies);
    expect(flat.filter(t => t === PolicyType.ENCOURAGE_RECYCLING).length,
      '還在提供的條例被列了兩次').toBe(1);
    expect(withExtra.some(g => g.category === RETIRED_CATEGORY),
      '還在提供的條例被當成已下架').toBe(false);
  });

  it('should list nothing extra when the district carries nothing unusual', () => {
    expect(policiesByCategory('district').some(g => g.category === RETIRED_CATEGORY),
      '沒有已下架的條例卻多出一組').toBe(false);
  });
});

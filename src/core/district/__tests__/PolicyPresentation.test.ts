import { describe, it, expect } from 'vitest';
import {
  nextPolicyLevel, policyButtonText, policyEffectSummary, districtPolicyTotal,
  districtOfferedPolicies, policyLevelLabel,
} from '../PolicyPresentation';
import { maxLevel, POLICY_EFFECTS, POLICY_CONFIG } from '../PolicyManager';
import { POLICY_SCOPE } from '../PolicyScope';
import { scaleOf } from '../../__tests__/helpers/policyScale';
import { PolicyType } from '../types';

/**
 * The UI's pure logic is extracted here because the Solid layer is bound to `getGame()` and the
 * project's convention is not to test UI, while how far one press advances the level and what the
 * button says are rules that really can be wrong and should not rest on inspection alone.
 */

const SCALE = scaleOf({ population: 1000, districtCells: 50 });

describe('等級循環', () => {
  it('should walk every level then return to off', () => {
    // One button walks every level, with no need for three.
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
    // A restrictive policy has no effect table entry and a maxLevel of 1, which must not break
    // the cycle.
    expect(nextPolicyLevel(0, PolicyType.NO_HEAVY_INDUSTRY)).toBe(1);
    expect(nextPolicyLevel(1, PolicyType.NO_HEAVY_INDUSTRY)).toBe(0);
  });

  it('should recover from a level the table no longer offers', () => {
    // A save can carry a level above the current table's length. Unable to return to 0, the
    // button jams.
    expect(nextPolicyLevel(9, PolicyType.TOURISM)).toBe(0);
  });
});

describe('按鈕上的字', () => {
  it('should show one dot per level', () => {
    expect(policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, SCALE)).toContain('●●');
    expect(policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 3, SCALE)).toContain('●●●');
  });

  it('should show the current cost, not a fixed price', () => {
    // The cost is on the button rather than in a help page because it moves with scale: drawing
    // the district twice as large doubles the number, the most direct feedback that billing
    // follows scale.
    const small = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, scaleOf({ population: 1000, districtCells: 10 }));
    const big = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 2, scaleOf({ population: 1000, districtCells: 400 }));
    expect(small, '兩個規模顯示同一個價錢').not.toBe(big);
  });

  it('should show no price for a restriction policy', () => {
    // Restrictive policies charge nothing, and a $0 would read as a free benefit.
    expect(policyButtonText(PolicyType.NO_HEAVY_INDUSTRY, 1, SCALE)).not.toContain('$');
  });

  it('should show no dots and no price when off', () => {
    const off = policyButtonText(PolicyType.ENCOURAGE_RECYCLING, 0, SCALE);
    expect(off).not.toContain('●');
    expect(off).not.toContain('$');
  });

  it('should always carry the policy name', () => {
    // Checking only for a non-empty string is satisfied by renaming everything to 'X'. What has
    // to be checked is that the string really is this policy's name.
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
    // The trade-off is the gameplay, and hidden in a tooltip there is no trade-off. The player
    // has to see the cost before pressing.
    const summary = policyEffectSummary(PolicyType.ENCOURAGE_RECYCLING, 3);
    expect(summary, '沒有講好處').toMatch(/Garbage/);
    expect(summary, '沒有講代價').toMatch(/revenue/i);
  });

  it('should say nothing for a level that is off', () => {
    expect(policyEffectSummary(PolicyType.ENCOURAGE_RECYCLING, 0)).toBe('');
  });

  it('should describe every tier of every policy in the effect table', () => {
    // A policy added without a description leaves the player with an unexplained button.
    for (const [type, tiers] of Object.entries(POLICY_EFFECTS)) {
      for (let i = 1; i <= tiers!.length; i++) {
        expect(policyEffectSummary(type as PolicyType, i).length,
          `${type} 第 ${i} 級沒有描述`).toBeGreaterThan(0);
      }
    }
  });

  it('should give a distinct sentence to every policy and every tier', () => {
    // Checking only for text is satisfied by returning a fixed string, which is the shape most
    // likely to fool a player: every button explained identically, and it looks explained.
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
    // The description has to match the effect table, or a changed number with an unchanged
    // description leaves the player reading an old promise.
    for (const type of Object.values(PolicyType)) {
      for (let lv = 1; lv <= maxLevel(type); lv++) {
        const tier = POLICY_EFFECTS[type]?.[lv - 1];
        const text = policyEffectSummary(type, lv);
        if (tier?.garbage !== undefined) expect(text, `${type} 動了垃圾卻沒說`).toContain('Garbage');
        if (tier?.landValue !== undefined) expect(text, `${type} 動了地價卻沒說`).toContain('Land value');
        if (tier?.crime !== undefined) expect(text, `${type} 動了犯罪卻沒說`).toContain('Crime');
        if (tier?.powerDemand !== undefined) expect(text, `${type} 動了電力卻沒說`).toContain('Power demand');
        if (tier?.revenue !== undefined || tier?.revenueByZone) {
          // Revenue at the start of a sentence and revenue within one: the word is matched, not
          // its case.
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
    // Listed, the player presses them and nothing happens because setPolicyLevel refuses, which
    // is worse than not seeing them.
    //
    // Checking only that the scope table contains city ordinances never touches that list and
    // stays green with the modal's filter removed. The list itself is pure data, so it moved into
    // core to be testable.
    const offered = districtOfferedPolicies();
    const cityScoped = (Object.values(PolicyType) as PolicyType[])
      .filter(t => POLICY_SCOPE[t] === 'city');
    expect(cityScoped.length, '沒有全城條例，這條測試等於空轉').toBeGreaterThan(0);
    for (const t of cityScoped) {
      expect(offered, `${t} 是全城條例卻出現在分區面板`).not.toContain(t);
    }
  });

  it('should offer every implemented district policy', () => {
    // The control: returning an empty array would also satisfy the test above, with the player
    // seeing no policies at all.
    const offered = districtOfferedPolicies();
    expect(offered.length, '分區面板一條政策都沒有').toBeGreaterThan(0);
    for (const t of offered) {
      expect(POLICY_SCOPE[t], `${t} 不是分區條例卻被列出來`).toBe('district');
    }
    expect(offered, '回收沒有被列出來').toContain(PolicyType.ENCOURAGE_RECYCLING);
    expect(offered, '禁重工業沒有被列出來').toContain(PolicyType.NO_HEAVY_INDUSTRY);
  });
});

describe('等級的名字', () => {
  /**
   * The strength button and the ledger's line items have to speak one language.
   *
   * The ledger drew `●●○` while the panel said Light / Medium / Heavy, so one policy looked
   * different in two places and the player had to guess which step those two dots meant.
   */
  it('should call level 0 off', () => {
    expect(policyLevelLabel(PolicyType.ENCOURAGE_RECYCLING, 0)).toBe('Off');
  });

  it('should name the tiers of a multi-level policy', () => {
    // Three words for three levels rather than L/M/H: an abbreviation needs a hover to read.
    expect(maxLevel(PolicyType.ENCOURAGE_RECYCLING)).toBe(3);
    expect(policyLevelLabel(PolicyType.ENCOURAGE_RECYCLING, 1)).toBe('Light');
    expect(policyLevelLabel(PolicyType.ENCOURAGE_RECYCLING, 2)).toBe('Medium');
    expect(policyLevelLabel(PolicyType.ENCOURAGE_RECYCLING, 3)).toBe('Heavy');
  });

  it('should just say on for a policy that only has one level', () => {
    // A single-level policy has no strength. Forcing "Light" leaves the player expecting
    // something heavier to exist.
    expect(maxLevel(PolicyType.TOURISM)).toBe(1);
    expect(policyLevelLabel(PolicyType.TOURISM, 1)).toBe('On');
  });

  it('should not fall off the end for a level a save could carry', () => {
    // Saves are editable. Returning undefined prints "undefined" on that ledger line.
    for (const level of [99, -1, 1.5, NaN]) {
      const label = policyLevelLabel(PolicyType.ENCOURAGE_RECYCLING, level);
      expect(typeof label, `${level} 的標籤不是字串`).toBe('string');
      expect(label.length, `${level} 的標籤是空的`).toBeGreaterThan(0);
    }
  });
});

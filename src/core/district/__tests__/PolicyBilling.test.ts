import { describe, it, expect } from 'vitest';
import { policyCost, POLICY_BILLING } from '../PolicyBilling';
import { POLICY_ZONE_RESTRICTIONS, isPolicyImplemented, maxLevel } from '../PolicyManager';
import { calculateDistrictPolicyCost } from '../../economy/ExpenseCalculator';
import { PolicyType } from '../types';
import { POLICY_SCOPE, isDistrictScoped } from '../PolicyScope';
import { scaleOf } from '../../__tests__/helpers/policyScale';

/**
 * 固定費用在大城市等於免費 —— 早期是限制，後期是無感。改成跟著它服務的規模走，
 * 費用才有來由，而且「政策越成功越貴」本身就是一個要玩家自己決定何時收手的張力。
 */

const SMALL = scaleOf({ population: 100, districtCells: 20 });
const BIG = scaleOf({ population: 10_000, districtCells: 400 });

describe('條例的計費', () => {
  it('should cost nothing at level 0', () => {
    expect(policyCost(PolicyType.ENCOURAGE_RECYCLING, 0, BIG)).toBe(0);
  });

  it('should scale with the thing it serves', () => {
    const small = policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, SMALL);
    const big = policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, BIG);
    expect(small, '小分區也不用錢，沒有東西可比').toBeGreaterThan(0);
    expect(big, '大分區付得跟小分區一樣多').toBeGreaterThan(small * 5);
  });

  it('should cost more at a higher level', () => {
    expect(policyCost(PolicyType.ENCOURAGE_RECYCLING, 3, BIG))
      .toBeGreaterThan(policyCost(PolicyType.ENCOURAGE_RECYCLING, 1, BIG));
  });

  it('should not bill restriction policies', () => {
    // 限制型的代價是機會成本（該區長不出高稅收的建築），不是市府掏錢。再收一次是
    // 雙重懲罰，而且那個數字沒有來由。
    const types = Object.keys(POLICY_ZONE_RESTRICTIONS) as PolicyType[];
    expect(types.length, '沒有限制型政策，這條測試等於空轉').toBeGreaterThan(0);
    for (const type of types) {
      expect(POLICY_BILLING[type], `${type} 是限制型卻列了計費基數`).toBeUndefined();
      expect(policyCost(type, 1, BIG)).toBe(0);
    }
  });

  it('should have one perUnit entry per level the effect table offers', () => {
    // 兩張表走散的話，第三級會靜靜地用第二級的價錢。
    const entries = Object.entries(POLICY_BILLING);
    expect(entries.length, '計費表是空的，這條測試等於空轉').toBeGreaterThan(0);
    for (const [type, billing] of entries) {
      expect(billing!.perUnit.length, `${type} 的計費級數與效果級數對不上`)
        .toBe(maxLevel(type as PolicyType));
    }
  });

  it('should only bill policies the simulation actually reads', () => {
    // ExpenseCalculator 曾經另外擋一道 isPolicyImplemented。那道守衛拿掉之後測試
    // 不會紅 —— 因為它本來就是多餘的:policyCost 對沒有計費條目的型別回 0，而每
    // 一個計費條目都對應到一條真的有效果的條例。把那個前提寫成斷言，多餘的守衛
    // 就可以刪掉，而不是留一段沒有人能證明有用的防禦碼。
    for (const type of Object.keys(POLICY_BILLING) as PolicyType[]) {
      expect(isPolicyImplemented(type), `${type} 收錢卻對模擬沒有效果`).toBe(true);
    }
  });

  it('should bill on the scale that matches its scope', () => {
    // 第一版這條是拿表格的 `basis` 去驗表格自己的行為 —— 永遠成立，把 basis 改錯
    // 也不會紅。真正該釘住的是「基數必須跟範圍一致」:
    //
    // - 全城條例沒有分區格數可言（呼叫端固定傳 0），用 districtCells 計費就等於
    //   免費。
    // - 分區條例用人口計費的話，畫一格跟畫一百格收一樣多，「跟著它服務的規模走」
    //   整個失效。
    // 「跟著人口走」已經不是唯一的全城基數 —— 育兒補貼跟著孩子人頭走，免費診所
    // 跟著加權後的病人數走。所以驗的是**方向**:全城條例要跟著某一個全城的量變
    // 動、而且完全不理會分區格數;分區條例反過來。
    const base = scaleOf({
      population: 100, districtCells: 100,
      babies: 10, children: 10, teens: 10, clinicPatients: 100,
    });
    const biggerCity = scaleOf({
      population: 1000, districtCells: 100,
      babies: 100, children: 100, teens: 100, clinicPatients: 1000,
    });
    const moreCells = scaleOf({ ...base, districtCells: 1000 });

    const entries = Object.entries(POLICY_BILLING);
    expect(entries.length, '計費表是空的，這條測試等於空轉').toBeGreaterThan(0);
    for (const [type] of entries) {
      const t = type as PolicyType;
      const b = policyCost(t, 1, base);
      const p = policyCost(t, 1, biggerCity);
      const c = policyCost(t, 1, moreCells);
      if (POLICY_SCOPE[t] === 'city') {
        expect(p, `${type} 是全城條例卻不隨城市規模變`).toBeGreaterThan(b);
        expect(c, `${type} 是全城條例卻隨分區格數變 —— 全城沒有格數可言`).toBe(b);
      } else {
        expect(c, `${type} 是分區條例卻不隨格數變`).toBeGreaterThan(b);
        expect(p, `${type} 是分區條例卻隨城市規模變 —— 畫一格跟畫一百格會收一樣多`).toBe(b);
      }
    }
  });

  it('should charge a positive price for every level it offers', () => {
    for (const [type, billing] of Object.entries(POLICY_BILLING)) {
      for (const [i, per] of billing!.perUnit.entries()) {
        expect(per, `${type} 第 ${i + 1} 級的單價不是正數`).toBeGreaterThan(0);
      }
    }
  });
});

describe('預算真的照這張表收錢', () => {
  // 只測 policyCost 的話，ExpenseCalculator 完全沒改也會全綠。
  const districts = [{
    cells: { size: 400 },
    policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 2 as const }],
  }];

  it('should bill exactly what policyCost says', () => {
    expect(calculateDistrictPolicyCost(districts, scaleOf({ population: 10_000 })))
      .toBeCloseTo(policyCost(PolicyType.ENCOURAGE_RECYCLING, 2, BIG), 6);
  });

  it('should charge nothing for a district with no cells', () => {
    // 分區格數是計費基數 —— 沒有格子就沒有東西要服務。
    const empty = [{ cells: { size: 0 }, policies: districts[0]!.policies }];
    expect(calculateDistrictPolicyCost(empty, scaleOf({ population: 10_000 }))).toBe(0);
  });

  it('should charge nothing for any district policy once the cells are gone', () => {
    // 上面那條只驗了一條條例。把一區的格子全部扣光是玩家做得到的事，而那個分區
    // 會留在清單上（它身上的條例設定不該因為擦掉一次就消失）—— 留著卻繼續收費
    // 的話，帳單上會出現一筆對應不到地圖上任何東西的支出。
    //
    // 這是對**全部**分區條例的要求:哪天有人給某一條配上 flat 或 population 的
    // 計費基準，空分區就會開始無聲地收錢。
    const districtScoped = Object.values(PolicyType).filter(isDistrictScoped);
    expect(districtScoped.length, '一條分區條例都沒有，這條測試在空轉')
      .toBeGreaterThan(5);
    for (const type of districtScoped) {
      for (let level = 1; level <= maxLevel(type); level++) {
        expect(policyCost(type, level, scaleOf({ population: 10_000, babies: 50, children: 50, teens: 50, clinicPatients: 900 })),
          `${type} Lv${level} 在沒有格子的分區上還在收費`).toBe(0);
      }
    }
  });

  it('should charge nothing for a policy that is off', () => {
    const off = [{
      cells: { size: 400 },
      policies: [{ type: PolicyType.ENCOURAGE_RECYCLING, level: 0 as const }],
    }];
    expect(calculateDistrictPolicyCost(off, scaleOf({ population: 10_000 }))).toBe(0);
  });
});

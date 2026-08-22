import { describe, it, expect } from 'vitest';
import {
  buildCoverage, buildOverlayCells, overlayKind,
  COVERAGE_SERVICES, type CoverageSource,
} from '../overlays';

/**
 * 圖層資料。
 *
 * ## 兩份東西，不是一份
 *
 * 玩家打開 Police 圖層時看到的其實是**兩層**:
 *
 * - **地面色塊**:每格 80 或 0。二元的，只說「這裡有沒有警力」。
 * - **建築高亮**:沿著馬路從警局走過來的成本 ÷ 預算，綠→黃→紅 **10 階**。
 *   那才是玩家真正在讀的東西 —— 它說的是「這棟房子的警力有多勉強」。
 *
 * ## 階數必須跟畫面一模一樣
 *
 * `Game` 用 `tier = min(9, floor(ratio * 10))` 挑顏色。這裡算出來的 tier 要是差一階，
 * agent 講的「那一區是黃的」就跟玩家螢幕上看到的對不起來 —— 而那種錯最難發現，
 * 因為兩邊都「看起來很合理」。
 */

/** 十階的假色帶。真的那條在 `Game.COV_GRADIENT`，綠→黃→紅。 */
const GRADIENT = [
  0x00e676, 0x39e85c, 0x72ea42, 0xabec28, 0xe4ee0e,
  0xffe010, 0xffb02c, 0xff8048, 0xff6a4d, 0xff5252,
];

function source(over: Partial<CoverageSource> = {}): CoverageSource {
  return {
    budget: 540,
    costs: new Map([['12,8', 150], ['30,41', 518]]),
    sources: [{ x: 20, y: 20 }],
    gradient: GRADIENT,
    ...over,
  };
}

describe('服務覆蓋', () => {
  it('should list the services that have a road-cost gradient', () => {
    expect([...COVERAGE_SERVICES]).toEqual(['police', 'fire', 'health', 'education', 'garbage']);
  });

  it('should report the cost, the ratio and the budget it was measured against', () => {
    const c = buildCoverage('police', source());

    expect(c.service).toBe('police');
    expect(c.budget).toBe(540);
    expect(c.covered, '覆蓋的格子數').toBe(2);
    expect(c.cells[0]).toMatchObject({ x: 12, y: 8, cost: 150 });
    expect(c.cells[0]!.ratio, '比值不是成本 ÷ 預算').toBeCloseTo(150 / 540, 6);
  });

  it('should put the tier where the game puts it', () => {
    // `tier = min(9, floor(ratio * 10))` —— 跟 Game 挑顏色用的是同一條式子。
    const c = buildCoverage('police', source({
      budget: 100,
      costs: new Map([['0,0', 0], ['1,0', 9], ['2,0', 10], ['3,0', 55], ['4,0', 99]]),
    }));
    expect(c.cells.map(x => x.tier)).toEqual([0, 0, 1, 5, 9]);
  });

  it('should never run off the end of the gradient', () => {
    // 成本剛好等於預算時 `ratio * 10` 是 10 —— 沒有第 10 階，色帶只有 10 個。
    const c = buildCoverage('police', source({
      budget: 100,
      costs: new Map([['0,0', 100], ['1,0', 999]]),
    }));

    expect(c.cells.map(x => x.tier), '走出色帶外面了').toEqual([9, 9]);
    expect(c.cells.every(x => x.color !== undefined)).toBe(true);
    // 比值也要夾住。回一個 9.99 出去，呼叫端會以為那裡超支了十倍 ——
    // 而遊戲的語彙裡「1」就是邊界，沒有比不覆蓋更不覆蓋的東西。
    expect(c.cells.map(x => x.ratio), '比值沒有夾在 1').toEqual([1, 1]);
  });

  it('should take the colour from the gradient rather than working one out', () => {
    // 顏色不能兩邊各算一次 —— 改了色帶另一邊就不一樣。
    const c = buildCoverage('police', source({
      budget: 100,
      costs: new Map([['0,0', 0], ['1,0', 50], ['2,0', 100]]),
    }));

    expect(c.cells.map(x => x.color)).toEqual(['#00e676', '#ffe010', '#ff5252']);
  });

  it('should carry the facilities that caused those colours', () => {
    // 一片紅色看不出是該蓋新的局，還是既有那一座蓋得太遠。
    expect(buildCoverage('police', source()).sources).toEqual([{ x: 20, y: 20 }]);
  });

  it('should be empty rather than broken when nothing is built yet', () => {
    const c = buildCoverage('fire', source({ costs: new Map(), sources: [] }));

    expect(c.covered).toBe(0);
    expect(c.cells).toEqual([]);
  });

  it('should say each service has its own budget', () => {
    // 五個服務的預算不一樣。用錯一個，整張圖的階數都會偏。
    const c = buildCoverage('garbage', source({ budget: 200, costs: new Map([['0,0', 100]]) }));
    expect(c.cells[0]!.ratio, '拿別的服務的預算去除').toBeCloseTo(0.5, 6);
  });
});

describe('地面色塊', () => {
  it('should turn the cell map into something with real coordinates', () => {
    const cells = buildOverlayCells(
      new Map([['12,8', 80], ['3,41', 80]]),
      (_v) => 0x334cff,
    );

    expect(cells).toEqual([
      { x: 12, y: 8, value: 80, color: '#334cff' },
      { x: 3, y: 41, value: 80, color: '#334cff' },
    ]);
  });

  it('should ask the game for each colour instead of inventing one', () => {
    const seen: number[] = [];
    buildOverlayCells(new Map([['0,0', 30], ['1,1', 90]]), (v) => { seen.push(v); return 0; });

    expect(seen, '沒有拿實際的數值去問顏色').toEqual([30, 90]);
  });

  it('should be empty when the overlay has nothing to draw', () => {
    expect(buildOverlayCells(undefined, () => 0)).toEqual([]);
    expect(buildOverlayCells(new Map(), () => 0)).toEqual([]);
  });
});

describe('這張圖層的數字怎麼讀', () => {
  it('should mark the coverage overlays as binary', () => {
    // 這幾張地面層只有 80 跟 0。不講的話，agent 拿到一堆一模一樣的 80
    // 會以為自己漏抓了什麼。
    for (const t of ['police', 'fire', 'health', 'education', 'park', 'garbage']) {
      expect(overlayKind(t), `${t} 不是二元的？`).toBe('binary');
    }
  });

  it('should mark the ones that really are a gradient', () => {
    for (const t of ['traffic', 'pollution', 'landValue', 'crime', 'commute']) {
      expect(overlayKind(t), `${t} 不是連續的？`).toBe('continuous');
    }
  });

  it('should mark the ones whose number is a label, not an amount', () => {
    // district 的值是**身分**（哪一區），power/water 是三階的狀態。
    // 把它們當強度比大小是沒有意義的。
    for (const t of ['power', 'water', 'zone', 'district']) {
      expect(overlayKind(t), `${t} 不是分類的？`).toBe('categorical');
    }
  });

  it('should not pretend to know an overlay it has never heard of', () => {
    expect(overlayKind('banana')).toBe('unknown');
  });
});

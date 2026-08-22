import { describe, it, expect } from 'vitest';
import { serviceDotColor, serviceDotHint, severityColor } from '../serviceDot';
import { NO_COVERAGE } from '../../../core/service/ServiceStatusView';

/** 距離 `cost`、負載 `load` 的一格。 */
const cell = (cost: number, load = NO_COVERAGE) => ({ cost, load });

describe('服務圓點的顏色', () => {
  it('should stay grey where nothing reaches', () => {
    // 灰色說的是「沒有人管得到我」，跟紅色的「管得很差」是兩件事 ——
    // 前者要蓋新的，後者要蓋近的。
    expect(serviceDotColor(cell(NO_COVERAGE))).toBe('#616161');
  });

  it('should be green right next to an idle facility', () => {
    expect(serviceDotColor(cell(0, 0.2))).toBe('rgb(0,200,50)');
  });

  it('should go red next to a facility that is swamped', () => {
    // 這是使用者問的那一件事:醫院就在隔壁（距離 0），但爆到兩倍。
    // 只看距離的話這裡會是最綠的。
    expect(serviceDotColor(cell(0, 2.0)), '爆量的設施旁邊還是綠的').toBe('rgb(255,0,50)');
  });

  it('should go red at the far edge of coverage too', () => {
    expect(serviceDotColor(cell(1, 0))).toBe('rgb(255,0,50)');
  });

  it('should take the worse of distance and load', () => {
    // 距離 0.2 很好、負載 1.5 一般 → 由負載決定（0.5，黃的）。
    const byLoad = serviceDotColor(cell(0.2, 1.5));
    const byDistance = serviceDotColor(cell(0.5, 1.0));

    expect(byLoad, '負載沒有蓋過距離').toBe(byDistance);
  });

  it('should not let an unknown load lighten a bad distance', () => {
    // 公園之類沒有負載概念的服務，距離要照樣說話。
    expect(serviceDotColor(cell(1, NO_COVERAGE))).toBe('rgb(255,0,50)');
  });

  it('should be yellow in the middle', () => {
    expect(severityColor(0.5)).toBe('rgb(255,200,50)');
  });

  it('should clamp a severity that ran past 1', () => {
    expect(severityColor(3)).toBe('rgb(255,0,50)');
  });
});

describe('圓點的提示', () => {
  it('should say plainly when nothing reaches', () => {
    expect(serviceDotHint('Health', cell(NO_COVERAGE))).toBe('Health: no coverage');
  });

  it('should break the colour down into the two things it hides', () => {
    // 顏色說「有多糟」，說不出是太遠還是太滿 —— 而那決定要蓋在哪裡。
    expect(serviceDotHint('Health', cell(0.25, 1.8)))
      .toBe('Health: distance 25% · facility load 180%');
  });

  it('should not invent a load for a utility', () => {
    // 電網沒有「這一格由哪一座電廠供電、那座多滿」的概念。印一個 0% 會讓玩家
    // 以為已經檢查過了。
    expect(serviceDotHint('Power', cell(0))).toBe('Power: distance 0%');
  });
});

import { describe, it, expect } from 'vitest';
import { serviceSeverity, loadSeverity, LOAD_SEVERITY, NO_COVERAGE } from '../ServiceSeverity';
import { loadRatioToDeathMultiplier, HOSPITAL_LOAD } from '../HealthService';

describe('負載換算成嚴重度', () => {
  it('should treat a facility that is exactly full as fine', () => {
    // 剛好滿不是問題,是剛剛好。從這裡開始扣分才有意義。
    expect(loadSeverity(LOAD_SEVERITY.FULL)).toBe(0);
    expect(loadSeverity(0.5)).toBe(0);
  });

  it('should treat double capacity as completely useless', () => {
    expect(loadSeverity(LOAD_SEVERITY.USELESS)).toBe(1);
    expect(loadSeverity(10)).toBe(1);
    expect(loadSeverity(Infinity), '容量 0 而有需求時是 Infinity').toBe(1);
  });

  it('should ramp linearly between the two', () => {
    expect(loadSeverity(1.5)).toBeCloseTo(0.5, 6);
    expect(loadSeverity(1.25)).toBeCloseTo(0.25, 6);
  });

  it('should call an unknown load fine rather than terrible', () => {
    // -1 是「問不到」（公園沒有負載的概念）。這支的回傳值要拿去跟距離比大小，
    // 混進一個 -1 會讓它永遠輸,而「不知道」不該蓋過「已知很遠」。
    expect(loadSeverity(NO_COVERAGE)).toBe(0);
  });

  it('should line up with the curve the game already uses for deaths', () => {
    // 這兩個端點不是隨便挑的:遊戲自己就是這樣量超載有多糟的。差開的話,
    // 圓點會在死亡率早就爆掉之後才變紅（或反過來）。
    expect(LOAD_SEVERITY.FULL).toBe(HOSPITAL_LOAD.LOAD_THRESHOLD);
    expect(LOAD_SEVERITY.USELESS).toBe(HOSPITAL_LOAD.LOAD_MAX);

    // 嚴重度 1 的那一點，正好是醫院對死亡率完全沒有貢獻的那一點。
    expect(loadRatioToDeathMultiplier(LOAD_SEVERITY.USELESS)).toBe(HOSPITAL_LOAD.COVERED_MAX);
    expect(loadRatioToDeathMultiplier(LOAD_SEVERITY.FULL)).toBe(HOSPITAL_LOAD.COVERED_MIN);
  });
});

describe('這一格的服務有多糟', () => {
  it('should stay uncovered when there is no coverage, however empty the facilities are', () => {
    // 「沒有人管得到我」跟「管得很差」是兩件事 —— 前者要蓋新的，後者要蓋近的。
    expect(serviceSeverity(NO_COVERAGE, 0)).toBe(NO_COVERAGE);
    expect(serviceSeverity(NO_COVERAGE, 5)).toBe(NO_COVERAGE);
  });

  it('should report a swamped facility next door as bad', () => {
    // 這就是使用者問的那個情況:醫院就在隔壁（距離 0）,但爆到兩倍。
    // 舊的規則只看距離，這裡會是 0 —— 最綠的。
    expect(serviceSeverity(0, 2.0), '爆量的設施在隔壁還是綠的').toBe(1);
  });

  it('should report a far but empty facility as bad too', () => {
    expect(serviceSeverity(0.9, 0.1)).toBeCloseTo(0.9, 6);
  });

  it('should take the worse of the two, not the average', () => {
    // 平均會讓「兩種都有點糟」看起來比「一種非常糟」還嚴重。
    const bothMild = serviceSeverity(0.5, 1.5);   // 距離 0.5、負載 0.5
    const oneSevere = serviceSeverity(0.05, 2.0); // 距離 0.05、負載 1

    expect(bothMild).toBeCloseTo(0.5, 6);
    expect(oneSevere).toBe(1);
    expect(oneSevere).toBeGreaterThan(bothMild);
  });

  it('should not let an unknown load hide a bad distance', () => {
    // 公園之類沒有負載的服務，距離該照樣說話。
    expect(serviceSeverity(0.8, NO_COVERAGE)).toBeCloseTo(0.8, 6);
  });

  it('should clamp a distance ratio that ran past the budget', () => {
    expect(serviceSeverity(1.4, 0)).toBe(1);
  });
});

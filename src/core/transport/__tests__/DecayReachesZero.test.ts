import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';

/**
 * 沒有人搭之後，平滑值要真的變成 0。
 *
 * 跨日結算做的是指數平滑:
 *
 * ```
 * smoothed = 0.7 × smoothed + 0.3 × 今天的人次
 * ```
 *
 * 路線被刪掉之後就沒有人搭,`今天的人次` 恆為 0,公式退化成「每天乘 0.7」。
 * 而**乘法碰不到零** —— 數學上只是趨近,浮點數上更糟:
 *
 * ```
 * 0.7 × 5e-324  ===  5e-324
 * ```
 *
 * `5e-324` 是 JavaScript 能表示的最小正數。再乘 0.7 之後最接近的可表示值還是它自己，
 * 於是**卡在那裡**。實測從 1000 開始乘十萬次,值仍然是 `5e-324`。
 *
 * 玩家存檔裡真的長出了這種東西 —— 刪掉鐵路線之後,四座車站的平滑值是
 * `7.7e-44`、`1.16e-42`、`5e-324`、`1.25e-42`。
 *
 * 這不只是難看。載重率的算法在運能為 0 時會看「有沒有人要搭」:
 * `dailyRiders > 0 ? Infinity : 0`。`5e-324 > 0` 成立,於是載重率是無限大,
 * 那個運具就永遠掛著紅色的 hopeless（BUG-349）。
 */

function busWithRiders(riders: number): BusSystem {
  const bus = new BusSystem();
  const stop = bus.addStop(1, 1);
  stop.smoothedDailyRiders = riders;
  return bus;
}

describe('浮點數為什麼救不了自己', () => {
  it('should not shrink the smallest positive number any further', () => {
    // 這條不是在測產品程式碼,是把「為什麼需要歸零」釘在這裡 —— 少了它,
    // 下一個人看到那行 snap 只會覺得是多餘的防禦。
    expect(0.7 * Number.MIN_VALUE).toBe(Number.MIN_VALUE);
  });
});

describe('沒有人搭之後', () => {
  it('should reach exactly zero, not merely approach it', () => {
    const bus = busWithRiders(1000);
    // 三個月都沒有人搭。
    for (let day = 0; day < 90; day++) bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders, '只是趨近零而不是等於零').toBe(0);
  });

  it('should still be zero after a very long time', () => {
    const bus = busWithRiders(1000);
    for (let day = 0; day < 5000; day++) bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders).toBe(0);
  });

  it('should clear a value that is already denormal in a loaded save', () => {
    // 存檔裡已經有這種數字了 —— 載進來之後第一次結算就要清掉。
    const bus = busWithRiders(5e-324);
    bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders).toBe(0);
  });
});

describe('不能誤傷真的有人搭的路線', () => {
  it('should keep a busy stop busy', () => {
    const bus = busWithRiders(1000);
    bus.getStops()[0]!.dailyRiders = 1000;
    bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders).toBeCloseTo(1000, 6);
  });

  it('should not wipe a stop that merely had a quiet day', () => {
    // 平滑的用意就是「一天的低點不代表這站空了」。歸零的門檻不能高到把這件事吃掉。
    const bus = busWithRiders(50);
    bus.getStops()[0]!.dailyRiders = 0;
    bus.rolloverDailyRiders();

    expect(bus.getStops()[0]!.smoothedDailyRiders, '一天沒人就把整站清空了').toBeCloseTo(35, 6);
  });

  it('should still roll yesterday into lastDayRiders and reset today', () => {
    const bus = busWithRiders(0);
    bus.getStops()[0]!.dailyRiders = 42;
    bus.rolloverDailyRiders();

    const s = bus.getStops()[0]!;
    expect(s.lastDayRiders).toBe(42);
    expect(s.dailyRiders).toBe(0);
  });
});

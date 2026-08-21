import { describe, it, expect } from 'vitest';
import { extraHeadwaysWaited, expectedWait, routeLoadStatus, CROWDING } from '../RouteLoad';

/**
 * 擠不上車的等待，從「等比級數」推出來，不是挑出來的。
 *
 * 舊模型是三個手挑的數字加一道懸崖:載重 0.8 到 1.5 線性拉到 4 倍，然後 1.5 直接
 * 拒載。玩家實測的加車階梯（12 600 人的存檔，一條公車線）:
 *
 * | 公車 | 班距 | 載重 | 每日人次 |
 * |---|---|---|---|
 * | 1 台 | 141.1 | 0.05 | 8 |
 * | 2 台 | 82.3 | **1.86** | 544 |
 * | 4 台 | 41.2 | **1.02** | 723 |
 * | 8 台 | 21.8 | **1.88** | 2 070 |
 *
 * 載重在 1.0 與 1.9 之間跳 —— 跨過 1.5 全部人被踢出去，載重掉下來，人又回來。
 * **那道懸崖自己造出一個極限環。**
 *
 * 幾何形式問的是一句話:這班擠不上去的機率是 q，平均要多等幾班？答案 `q / (1 - q)`。
 * 以 `q = 1 - 1/載重` 代入，剛好是 **載重 - 1 個班距**。沒有上限、沒有懸崖、
 * 沒有魔術數字，而且「等到天荒地老」本來就等價於「不能搭」，不必再劃一條線。
 */

describe('擠不上車要多等幾班', () => {
  it('should make you wait for nobody when there is room', () => {
    expect(extraHeadwaysWaited(0.5)).toBe(0);
    expect(extraHeadwaysWaited(1)).toBe(0);
  });

  it('should charge one extra vehicle when half the queue cannot board', () => {
    // 載重 2 = 想搭的人是位子的兩倍 = 一半上不去 = 平均多等一班。
    expect(extraHeadwaysWaited(2)).toBeCloseTo(1, 10);
  });

  it('should keep rising with no ceiling', () => {
    // 舊模型封在 4 倍。封頂的意思是「再擠也不會更糟」，那不是真的。
    expect(extraHeadwaysWaited(4)).toBeCloseTo(3, 10);
    expect(extraHeadwaysWaited(11)).toBeCloseTo(10, 10);
    expect(extraHeadwaysWaited(101)).toBeCloseTo(100, 10);
  });

  it('should send a route with no capacity at all to infinity', () => {
    // 沒有車卻有人要搭 —— `computeLoadFactor` 回 Infinity。等待也該是。
    expect(extraHeadwaysWaited(Infinity)).toBe(Infinity);
  });

  it('should have no cliff anywhere', () => {
    // 舊模型在 1.5 那一點從「還能搭」變成「這條線不存在」，中間差一個乘客。
    // 掃過整段，相鄰兩點的差不能出現跳躍。
    let prev = extraHeadwaysWaited(0.5);
    for (let load = 0.51; load <= 5; load += 0.01) {
      const now = extraHeadwaysWaited(load);
      expect(now - prev, `載重 ${load.toFixed(2)} 附近有跳躍`).toBeLessThan(0.02);
      expect(now, '等待變短了').toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

describe('站在站牌前預期要等多久', () => {
  it('should be half a headway when the route is not crowded', () => {
    // 乘客隨機時間到站，平均等半個班距。這個 0.5 是算得出來的，不是挑的。
    expect(expectedWait(100, 0.5, 0.5)).toBeCloseTo(50, 10);
  });

  it('should add whole headways once people are left behind', () => {
    // 半個班距的基本等待，加上多等的整班。
    expect(expectedWait(100, 0.5, 2), '多等的那一班沒有算進去')
      .toBeCloseTo(100 * 0.5 + 100 * 1, 10);
    expect(expectedWait(100, 0.5, 3)).toBeCloseTo(100 * 0.5 + 100 * 2, 10);
  });

  it('should never come at all when there is no vehicle', () => {
    expect(expectedWait(Infinity, 0.5, 0)).toBe(Infinity);
  });
});

describe('面板的載重分段', () => {
  it('should stay green while nobody is left behind', () => {
    expect(routeLoadStatus(0.99), '還沒有人擠不上去就開始警告').toBe('comfortable');
  });

  it('should turn as soon as someone is left behind', () => {
    // 分界點是**模型裡真的會發生事情**的那一點，不是一個好看的整數。
    // 載重剛好 1 的時候位子剛好夠，沒有人被留下 —— 所以分界在「超過 1」。
    expect(routeLoadStatus(1), '剛好夠卻說擠').toBe('comfortable');
    expect(routeLoadStatus(1.01), '有人被留下了卻還是綠的').toBe('crowded');
    expect(routeLoadStatus(1.4)).toBe('crowded');
  });

  it('should go red when the extra wait passes half a headway', () => {
    expect(routeLoadStatus(CROWDING.OVERLOADED_LOAD)).toBe('overloaded');
  });

  it('should call it hopeless when two full vehicles go past', () => {
    // 這是**顯示用的標籤**，不是模擬裡的懸崖 —— 模擬只是讓它非常慢。
    expect(routeLoadStatus(CROWDING.HOPELESS_LOAD)).toBe('hopeless');
    expect(routeLoadStatus(Infinity)).toBe('hopeless');
  });
});

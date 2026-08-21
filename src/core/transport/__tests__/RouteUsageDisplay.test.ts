import { describe, it, expect } from 'vitest';
import { formatRouteUsage, routeLoadStatus, CROWDING } from '../RouteLoad';

/**
 * 面板上的 Usage 是玩家決定「該加幾台車」的唯一依據。
 *
 * 夾在 100% 的話，一條 105% 的路線跟一條 400% 的路線長得一模一樣 —— 而前者加一台
 * 就夠，後者要加三倍。夾住等於把要做決定的那個資訊藏起來。
 */

describe('路線載重的顯示', () => {
  it('should show how far past capacity a route is', () => {
    expect(formatRouteUsage(260, 100), '超載被夾在 100%，看不出要加幾台車').toBe('260%');
    expect(formatRouteUsage(45, 100), '一般情況的百分比不對').toBe('45%');
  });

  it('should say nothing for a route with no capacity at all', () => {
    // 沒有車的路線算不出載重 —— 印 0% 會讓玩家以為它很空。
    expect(formatRouteUsage(30, 0), '沒有運能的路線印出了百分比').toBe('—');
  });

  it('should round to whole percent', () => {
    expect(formatRouteUsage(1, 3), '沒有四捨五入').toBe('33%');
  });
});

describe('載重的四個階段', () => {
  // 分界點挑的是模型裡真的會發生事情的那幾點，不是好看的整數。
  it('should stay green while everyone gets on the next vehicle', () => {
    expect(routeLoadStatus(0.5)).toBe('comfortable');
    expect(routeLoadStatus(0.99), '還沒有人被留下就開始警告').toBe('comfortable');
  });

  it('should turn the moment somebody is left behind', () => {
    // 剛好 1 的時候位子剛好夠 —— 分界在「超過 1」。
    expect(routeLoadStatus(1), '剛好夠卻說擠').toBe('comfortable');
    expect(routeLoadStatus(1.01), '有人上不去了卻還是綠的').toBe('crowded');
    expect(routeLoadStatus(1.4)).toBe('crowded');
  });

  it('should go red once the extra wait beats the basic wait', () => {
    // 多等超過半個班距 —— 站在站牌前，等空位比等車本身還久。
    expect(routeLoadStatus(CROWDING.OVERLOADED_LOAD)).toBe('overloaded');
    expect(routeLoadStatus(2.9)).toBe('overloaded');
  });

  it('should call it hopeless once two full vehicles go past', () => {
    // **標籤，不是懸崖** —— 模擬不會把這條線藏起來，只是讓它非常慢。
    expect(routeLoadStatus(CROWDING.HOPELESS_LOAD)).toBe('hopeless');
    expect(routeLoadStatus(Infinity)).toBe('hopeless');
  });
});

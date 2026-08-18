import { describe, it, expect } from 'vitest';
import { formatRouteUsage, routeLoadStatus, CROWDING, USAGE_WARN_LOAD } from '../RouteLoad';

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
  it('should warn at 80% and go red at 90%', () => {
    expect(routeLoadStatus(0.79), '八成以下就開始警告').toBe('comfortable');
    expect(routeLoadStatus(CROWDING.COMFORT_LOAD), '到了八成還沒開始警告').toBe('crowded');
    expect(routeLoadStatus(0.89), '不到九成就變紅').toBe('crowded');
    expect(routeLoadStatus(USAGE_WARN_LOAD), '到了九成還沒變紅').toBe('overloaded');
    expect(routeLoadStatus(1.4), '九成以上就該一直是紅的').toBe('overloaded');
  });

  it('should still call out the load where the route disappears', () => {
    // 顏色從九成就變紅，但一五○% 是模擬裡真的會發生的另一件事:路線從那個人的
    // 選項裡消失。顏色一樣紅，文案要不一樣 —— 不然玩家看不出「快滿了」跟
    // 「已經沒有人搭得上去了」的差別。
    expect(routeLoadStatus(CROWDING.REFUSE_LOAD - 0.01), '還擠得上去卻說擠不上')
      .toBe('overloaded');
    expect(routeLoadStatus(CROWDING.REFUSE_LOAD), '已經擠不上去了卻還說擠得上')
      .toBe('refusing');
  });

  it('should agree with the rule that actually drops the route', () => {
    // `isOverCapacity` 是「這條路線對這個人不存在」的那道判斷。面板說 refusing 的
    // 時候，模擬就該真的已經不提供它了 —— 兩邊各寫一個數字的話，玩家看到的文案
    // 跟實際發生的事會靜靜地分家。
    for (const load of [0, 0.5, 0.8, 0.9, 1.2, 1.5, 3]) {
      const dropped = load >= CROWDING.REFUSE_LOAD;
      expect(routeLoadStatus(load) === 'refusing', `載重 ${load} 的狀態跟模擬對不起來`)
        .toBe(dropped);
    }
  });
});

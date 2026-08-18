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

describe('載重的三個階段', () => {
  it('should name the stage by what the simulation actually does at it', () => {
    // 顏色不是美感問題:三段各自對應模擬裡一件真的會發生的事。
    expect(routeLoadStatus(CROWDING.COMFORT_LOAD - 0.01), '舒適區被判成擁擠')
      .toBe('comfortable');
    expect(routeLoadStatus(CROWDING.COMFORT_LOAD), '到了舒適上限還說舒適')
      .toBe('crowded');
    expect(routeLoadStatus(CROWDING.REFUSE_LOAD - 0.01), '還擠得上去卻說擠不上')
      .toBe('crowded');
    expect(routeLoadStatus(CROWDING.REFUSE_LOAD), '已經擠不上去了卻還說擠得上')
      .toBe('refusing');
  });

  it('should agree with the rule that actually drops the route', () => {
    // `isOverCapacity` 是「這條路線對這個人不存在」的那道判斷。面板說 refusing 的
    // 時候，模擬就該真的已經不提供它了 —— 兩邊各寫一個數字的話，玩家看到黃燈
    // 卻發現沒有人搭得上去。
    for (const load of [0, 0.5, 0.8, 1.2, 1.5, 3]) {
      const dropped = load >= CROWDING.REFUSE_LOAD;
      expect(routeLoadStatus(load) === 'refusing', `載重 ${load} 的燈號跟模擬對不起來`)
        .toBe(dropped);
    }
  });
});

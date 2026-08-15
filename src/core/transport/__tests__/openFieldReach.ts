import type { StopReach } from '../../traffic/StopWalkReach';

/**
 * 一片沒有任何障礙的空地：走到哪裡的距離都等於曼哈頓距離。
 *
 * 這是**測試替身**，不是產品裡的第二套算法 —— 產品只有 `SidewalkStopReach`
 * 一個實作。用它的測試要驗的是路線挑選、換乘與時間估計本身的算術，把「走到站牌
 * 多遠」固定成一個好預測的數字，算術錯了才看得出來。
 *
 * 「馬路會擋住行人」那一面不在這裡驗，由 `StopChoiceAcrossRoad.test.ts` 與
 * `TransitAccessAcrossRoad.test.ts` 拿真的人行道圖去驗。
 */
export const openFieldReach: StopReach = {
  cellsWithin(x, y, maxDist) {
    const cells = new Map<string, number>();
    const r = Math.floor(maxDist);
    for (let dy = -r; dy <= r; dy++) {
      const rest = r - Math.abs(dy);
      for (let dx = -rest; dx <= rest; dx++) {
        const cx = x + dx, cy = y + dy;
        if (cx < 0 || cy < 0) continue;
        cells.set(`${cx},${cy}`, Math.abs(dx) + Math.abs(dy));
      }
    }
    return cells;
  },
};

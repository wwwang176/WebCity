import { describe, it, expect } from 'vitest';
import {
  VEHICLE_DIMS, TRUCK_DIMS, BUS_DIMS, SERVICE_VEHICLE_DIMS, MAX_VEHICLE_HALF_LEN,
} from '../TrafficSimulation';

/**
 * 跟車查詢靠 `MAX_VEHICLE_HALF_LEN` 提前收工:找到一台之後，只有**比它更長**的車
 * 才可能在更遠的地方留下更小的空隙 —— 空隙扣的是兩台車的半個車身。
 *
 * 估大了只是多掃一條邊。估小了，查詢會跳過真正該讓的那台，車就開進它尾巴。
 * 所以加車種的時候這裡要紅。
 */

const ALL_LENGTHS: [string, number][] = [
  ...VEHICLE_DIMS.map((d, i) => [`VEHICLE_DIMS[${i}]`, d.length] as [string, number]),
  ['TRUCK_DIMS', TRUCK_DIMS.length],
  ['BUS_DIMS', BUS_DIMS.length],
  ...Object.entries(SERVICE_VEHICLE_DIMS).map(([k, d]) => [`SERVICE_VEHICLE_DIMS.${k}`, d.length] as [string, number]),
];

describe('路上最長的那台車', () => {
  it('should cover every vehicle body in the game', () => {
    for (const [name, length] of ALL_LENGTHS) {
      expect(length / 2, `${name} 比 MAX_VEHICLE_HALF_LEN 還長 —— 跟車查詢會跳過它`)
        .toBeLessThanOrEqual(MAX_VEHICLE_HALF_LEN);
    }
  });

  it('should not be wildly larger than the longest body', () => {
    // 反向對照:隨手填一個大數字也會讓上面那條過，但提前收工就等於沒用了。
    const longest = Math.max(...ALL_LENGTHS.map(([, l]) => l));
    expect(MAX_VEHICLE_HALF_LEN, '比實際最長的車身還大，提前收工形同虛設')
      .toBeLessThanOrEqual(longest / 2);
  });
});

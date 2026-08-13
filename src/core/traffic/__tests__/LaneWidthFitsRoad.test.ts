import { describe, it, expect } from 'vitest';
import { LaneGraph } from '../LaneGraph';
import { SERVICE_VEHICLE_DIMS } from '../TrafficSimulation';
import {
  RoadType, RoadDirection, ROAD_WIDTHS, getLaneCount, getLaneWidth,
} from '../../road/types';
import { ROAD_WIDTHS as SIDEWALK_ROAD_WIDTHS } from '../SidewalkGraph';
import { makeGridLookup } from '../../../../tests/helpers/makeGridLookup';

/**
 * 車開在自己的路面上。
 *
 * 車道寬原本是一個寫死的常數（`LANE_GEOMETRY.LANE_WIDTH = 0.18`），與路寬
 * （`ROAD_WIDTHS`）各算各的。六車道每向三條 = 0.54，而路面半寬只有 0.475
 * —— 最外側那條車道有一部分在路面外，而車子實際上就開在那裡：一台 0.125 寬的
 * 卡車，車身會壓出路緣 0.0375 格（45 公分），輪子落在人行道上。
 *
 * 改成從路寬算：`路寬 / 2 / 該向車道數`。
 */

const WITH_WIDTH = [
  RoadType.RURAL, RoadType.TWO_LANE, RoadType.FOUR_LANE,
  RoadType.SIX_LANE, RoadType.HIGHWAY, RoadType.ONE_WAY,
] as const;

/** 最寬的車。卡車與消防車同寬，取服務車輛那張表裡的最大值。 */
const WIDEST_VEHICLE = Math.max(
  ...Object.values(SERVICE_VEHICLE_DIMS).map(d => d.width),
);

/** 一條東西向的直路，回傳中間那格每條車道的橫向偏移（離路中心線）。 */
function laneOffsets(roadType: RoadType): number[] {
  const cells = new Map<string, { roadType: RoadType; roadFlags: number }>();
  for (let x = 0; x < 3; x++) {
    cells.set(`${x},0`, {
      roadType,
      roadFlags: (x > 0 ? RoadDirection.WEST : 0) | (x < 2 ? RoadDirection.EAST : 0),
    });
  }
  const graph = new LaneGraph();
  graph.buildFromGrid(makeGridLookup(cells), [...cells.keys()]);
  return graph.getConnectionPoints('1,0')
    .filter(p => p.type === 'exit' && p.direction === 'east')
    .sort((a, b) => a.lane - b.lane)
    .map(p => p.position.y);
}

describe('車道寬與路寬', () => {
  it('should have exactly one table of road widths', () => {
    // 兩份各自寫一次的話，改了其中一份，車與柏油就會對不上 —— 而那是靜悄悄的。
    expect(SIDEWALK_ROAD_WIDTHS, '路寬有第二份拷貝').toBe(ROAD_WIDTHS);
  });

  it.each(WITH_WIDTH)('should fit every lane inside the asphalt on a %s road', (roadType) => {
    const half = ROAD_WIDTHS[roadType]!/ 2;
    const lanes = getLaneCount(roadType);
    expect(lanes * getLaneWidth(roadType), `${roadType}：該向車道加起來比路面半寬還寬`)
      .toBeLessThanOrEqual(half + 1e-9);
  });

  it.each(WITH_WIDTH)('should keep the widest vehicle on the asphalt on a %s road', (roadType) => {
    // 車道**中心**在路面內還不夠 —— 車有寬度。
    const half = ROAD_WIDTHS[roadType]! / 2;
    const outermost = (getLaneCount(roadType) - 0.5) * getLaneWidth(roadType);
    expect(outermost + WIDEST_VEHICLE / 2, `${roadType}：最外側車道的車會壓到路緣外`)
      .toBeLessThanOrEqual(half + 1e-9);
  });

  it.each(WITH_WIDTH)('should place the lanes the graph hands out inside the road (%s)', (roadType) => {
    // 上面兩條驗的是算式，這一條驗的是**車道圖真的照它排**。
    const half = ROAD_WIDTHS[roadType]! / 2;
    const offsets = laneOffsets(roadType);
    expect(offsets.length, `${roadType}：車道圖沒有給出車道`).toBe(getLaneCount(roadType));
    for (const o of offsets) {
      expect(Math.abs(o) + WIDEST_VEHICLE / 2, `${roadType}：車道圖把車排到路面外`)
        .toBeLessThanOrEqual(half + 1e-9);
      expect(Math.abs(o), `${roadType}：車道壓在中心線上`).toBeGreaterThan(0);
    }
  });

  it('should widen the lanes as the road widens, per direction', () => {
    // 四車道與六車道同屬幹道，但六車道要塞三條 —— 每條就得窄一點。
    expect(getLaneWidth(RoadType.SIX_LANE), '六車道的車道沒有比四車道窄')
      .toBeLessThan(getLaneWidth(RoadType.FOUR_LANE));
    expect(getLaneWidth(RoadType.FOUR_LANE), '四車道的車道沒有比兩車道窄')
      .toBeLessThan(getLaneWidth(RoadType.TWO_LANE));
  });

  it('should keep opposing traffic on opposite sides', () => {
    // 車道由中心線往外排，所以最內側那條的中心是半個車道寬 —— 不能是 0，
    // 那會讓對向的車重疊在中心線上。
    for (const roadType of WITH_WIDTH) {
      const innermost = 0.5 * getLaneWidth(roadType);
      expect(innermost, `${roadType}：最內側車道壓在中心線上`).toBeGreaterThan(0);
    }
  });

  it('should still split a one-way road into its full lane count', () => {
    // 單行道所有車道同向，所以它的車道數就是全部 —— 車道寬還是切自己的半寬，
    // 這是既有行為，這裡釘住它不要在改動中被順手改掉。
    expect(getLaneCount(RoadType.ONE_WAY)).toBe(2);
  });
});

describe('車道圖用的是算出來的車道寬', () => {
  it('should not fall back to a fixed lane width', () => {
    // 兩車道與六車道若拿到同一個間距，就表示還在用寫死的常數。
    const two = laneOffsets(RoadType.TWO_LANE);
    const six = laneOffsets(RoadType.SIX_LANE);
    expect(two[0], '兩車道的車道位置還是寫死的 0.09').not.toBeCloseTo(six[0]!, 6);
  });

  it('should space the lanes evenly across the half road', () => {
    const six = laneOffsets(RoadType.SIX_LANE).map(Math.abs).sort((a, b) => a - b);
    const w = getLaneWidth(RoadType.SIX_LANE);
    expect(six).toHaveLength(3);
    six.forEach((o, i) => {
      expect(o, `第 ${i} 條車道的中心不在 (i + 0.5) × 車道寬`)
        .toBeCloseTo((i + 0.5) * w, 9);
    });
  });
});

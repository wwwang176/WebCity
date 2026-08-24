import { describe, it, expect } from 'vitest';
import { TransitAccessField } from '../TransitAccessField';
import { SidewalkStopReach } from '../../traffic/StopWalkReach';
import { cityWithMainRoad } from '../../traffic/__tests__/gridCityFixture';
import { TransportType, type TransportStop } from '../types';
import type { FlatRoute } from '../MultiModalRouter';

/**
 * Stop catchment is measured along the sidewalk graph.
 *
 * This field decides who counts as served by a bus. Straight-line distance puts the far
 * side of a road two tiles away, so households there count as reachable: commute times are
 * understated and pedestrians are sent to a stop they can only reach by detouring to a
 * junction. The pedestrian visibly walking the long way round is this field's error, not a
 * pathfinding one.
 */

function stop(id: number, x: number, y: number): TransportStop {
  return {
    id, x, y, type: TransportType.BUS,
    passengers: 0, dailyRiders: 0, lastDayRiders: 0, smoothedDailyRiders: 0,
  };
}

function busRoute(stops: TransportStop[]): FlatRoute {
  return {
    routeId: 1, type: TransportType.BUS, speed: 2, stops,
    segDists: null, headway: 10, loadFactor: 0, source: { stops, vehicles: 1 }, seatsPerVehicle: 0,
  };
}

/** Metro has a wider walk limit than bus, because people walk further for it. */
function metroRoute(stops: TransportStop[]): FlatRoute {
  return {
    routeId: 1, type: TransportType.METRO, speed: 3, stops,
    segDists: null, headway: 10, loadFactor: 0, source: { stops, vehicles: 1 }, seatsPerVehicle: 0,
  };
}

const SPEED = 1;

describe('涵蓋範圍不跨越馬路', () => {
  it('should cover a home on the same side of the road', () => {
    const { graph } = cityWithMainRoad(8);
    const route = busRoute([stop(1, 12, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], SPEED, new SidewalkStopReach(graph));

    expect(field.at(13, 11).length, '同一側的隔壁格算不到，這條測試等於沒測')
      .toBeGreaterThan(0);
  });

  it('should not cover a home across the road from the stop', () => {
    // Junctions sit at x=8 and x=16, the stop at x=12. Crossing means 4 tiles to a junction,
    // across, and 4 tiles back — well beyond the 5-tile walk limit, so this household cannot
    // actually reach the bus.
    const { graph } = cityWithMainRoad(8);
    const route = busRoute([stop(1, 12, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], SPEED, new SidewalkStopReach(graph));

    expect(
      field.at(12, 9),
      '馬路對面被算成搭得到 —— 通勤時間被低估，行人會被派去繞路口',
    ).toHaveLength(0);
  });

  it('should cover both sides when the stop sits by an intersection', () => {
    // Same road, but a stop placed next to the junction really is reachable from the other
    // side, which makes stop placement a decision with consequences.
    const { graph } = cityWithMainRoad(8);
    const route = busRoute([stop(1, 9, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], SPEED, new SidewalkStopReach(graph));

    expect(field.at(9, 9).length, '緊鄰路口的站牌，對面仍然算不到').toBeGreaterThan(0);
  });

  it('should charge the real walking distance, not the straight line', () => {
    // The same position as a metro station: an 8-tile limit accommodates the 7.44-tile
    // detour, so the far side is reachable — but the recorded distance is the real walk, not
    // the straight-line 2 tiles.
    const { graph } = cityWithMainRoad(8);
    const route = metroRoute([stop(1, 12, 11), stop(2, 4, 11)]);
    const field = TransitAccessField.build([route], SPEED, new SidewalkStopReach(graph));

    const across = field.at(12, 9)[0];
    expect(across, '捷運的上限是 8 格，繞路口的 7.44 格應該進得來').toBeDefined();
    expect(across!.walkTime, '走到對面的時間被當成直線的 2 格').toBeGreaterThan(6);
  });

  it('should let people walk further for a metro than for a bus', () => {
    // Identical position and graph; only the transport type differs.
    const { graph } = cityWithMainRoad(8);
    const stops = [stop(1, 12, 11), stop(2, 4, 11)];
    const reach = new SidewalkStopReach(graph);

    const byBus = TransitAccessField.build([busRoute(stops)], SPEED, reach);
    const byMetro = TransitAccessField.build([metroRoute(stops)], SPEED, reach);

    expect(byBus.at(12, 9), '公車的服務範圍延伸到馬路對面了').toHaveLength(0);
    expect(byMetro.at(12, 9).length, '捷運與公車的服務範圍一模一樣').toBeGreaterThan(0);
  });
});

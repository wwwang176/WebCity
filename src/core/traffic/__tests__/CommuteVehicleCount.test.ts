import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * The panel card asks how many residents are driving to work, and the player reads it to judge
 * whether a policy has pushed people onto transit.
 *
 * Vehicles on the road come from four sources and three are unrelated to residents' mode
 * choice: through traffic scales with `population / 100`, freight with industrial output, and
 * service vehicles with dispatch. Summing all four holds the number up when residents really do
 * switch to the bus, so a working policy shows no effect.
 */

const edge = () => makeCellEdge('0,0', '1,0', 0, { length: 1 });
const edgeOfLength = (length: number) => makeCellEdge('0,0', '1,0', 0, { length });

describe('路上有幾台是居民在通勤', () => {
  it('should count only vehicles a citizen is driving', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edge()], 1);
    ts.addVehicleOnEdges([edge()], 2);

    expect(ts.getCommuteVehicleCount(), '通勤車沒被算進去').toBe(2);
  });

  it('should ignore through traffic, freight and service vehicles', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edge()], 7);       // a commuter
    ts.addVehicleOnEdges([edge()]);          // through traffic, no citizenId
    ts.addFreightVehicle([edge()], '3,3');   // freight
    ts.addServiceVehicle([edge()], 'fire');  // a service vehicle
    ts.addBusVehicle([[edge()]], 1);         // a bus is not a resident forced to drive

    expect(ts.getCommuteVehicleCount(), '把不是通勤的車也算進去了').toBe(1);
    expect(ts.getVehicleCount(), '總車輛數不該跟著變 —— 車流上限還是要看全部').toBe(5);
  });

  it('should be zero on an empty map', () => {
    expect(new TrafficSimulation().getCommuteVehicleCount()).toBe(0);
  });
});

/**
 * The average trip length card beside it is the other half of the same figure: one says how
 * many people are driving, the other how far. Mixing in through traffic makes the two describe
 * different cities — through traffic crosses from a map edge to a building and is longer than
 * an ordinary commute, so a handful of trips move the average.
 */
describe('居民通勤開多遠', () => {
  it('should average only the trips citizens are driving', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edgeOfLength(2), edgeOfLength(4)], 1);  // commute: 6
    ts.addVehicleOnEdges([edgeOfLength(4)], 2);                   // commute: 4

    expect(ts.getCommuteAveragePathLength(), '通勤車的平均路程算錯').toBeCloseTo(5);
  });

  it('should ignore through traffic, freight and service vehicles', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edgeOfLength(4)], 1);            // a commuter
    ts.addVehicleOnEdges([edgeOfLength(40)]);              // through traffic, right across the map
    ts.addFreightVehicle([edgeOfLength(30)], '3,3');       // freight
    ts.addServiceVehicle([edgeOfLength(20)], 'fire');      // a service vehicle
    ts.addBusVehicle([[edgeOfLength(50)]], 1);             // a bus runs a whole route

    expect(ts.getCommuteAveragePathLength(), '被不是通勤的車把平均拉走了').toBeCloseTo(4);
  });

  it('should be zero when nobody is driving to work', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edgeOfLength(10)]);  // through traffic only

    expect(ts.getCommuteAveragePathLength(), '沒有人開車通勤卻算得出平均').toBe(0);
  });
});

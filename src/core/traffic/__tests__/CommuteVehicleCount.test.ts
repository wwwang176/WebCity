import { describe, it, expect } from 'vitest';
import { TrafficSimulation } from '../TrafficSimulation';
import { makeCellEdge } from '../../../../tests/helpers/makeLaneEdge';

/**
 * 面板上那張卡片問的是「有多少居民正在開車通勤」—— 玩家拿它判斷政策有沒有把人
 * 趕上大眾運輸。
 *
 * 路上跑的車有四種來源，其中三種跟居民的運具選擇完全無關:過境車流的量是
 * `人口 ÷ 100`、貨運看的是工業產能、服務車輛是派工。把四種加在一起的話，居民
 * 真的改搭公車了，數字卻會被另外三種撐住 —— 政策生效但看不出來。
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
    ts.addVehicleOnEdges([edge()], 7);       // 通勤
    ts.addVehicleOnEdges([edge()]);          // 過境車流 —— 沒有 citizenId
    ts.addFreightVehicle([edge()], '3,3');   // 貨運
    ts.addServiceVehicle([edge()], 'fire');  // 服務車輛
    ts.addBusVehicle([[edge()]], 1);         // 公車本身不是「被迫開車的人」

    expect(ts.getCommuteVehicleCount(), '把不是通勤的車也算進去了').toBe(1);
    expect(ts.getVehicleCount(), '總車輛數不該跟著變 —— 車流上限還是要看全部').toBe(5);
  });

  it('should be zero on an empty map', () => {
    expect(new TrafficSimulation().getCommuteVehicleCount()).toBe(0);
  });
});

/**
 * 旁邊那張「平均路程」跟車輛數是同一組數字的兩面 —— 一張說有多少人在開車，一張說
 * 他們開多遠。混進過境車流的話兩張會各自說不同的城市:過境車流是從地圖邊緣穿到
 * 某棟建築，路程本來就比一般通勤長，少少幾台就能把平均拉走。
 */
describe('居民通勤開多遠', () => {
  it('should average only the trips citizens are driving', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edgeOfLength(2), edgeOfLength(4)], 1);  // 通勤:6
    ts.addVehicleOnEdges([edgeOfLength(4)], 2);                   // 通勤:4

    expect(ts.getCommuteAveragePathLength(), '通勤車的平均路程算錯').toBeCloseTo(5);
  });

  it('should ignore through traffic, freight and service vehicles', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edgeOfLength(4)], 1);            // 通勤
    ts.addVehicleOnEdges([edgeOfLength(40)]);              // 過境:穿過整張地圖
    ts.addFreightVehicle([edgeOfLength(30)], '3,3');       // 貨運
    ts.addServiceVehicle([edgeOfLength(20)], 'fire');      // 服務車輛
    ts.addBusVehicle([[edgeOfLength(50)]], 1);             // 公車跑的是整條路線

    expect(ts.getCommuteAveragePathLength(), '被不是通勤的車把平均拉走了').toBeCloseTo(4);
  });

  it('should be zero when nobody is driving to work', () => {
    const ts = new TrafficSimulation();
    ts.addVehicleOnEdges([edgeOfLength(10)]);  // 只有過境車流

    expect(ts.getCommuteAveragePathLength(), '沒有人開車通勤卻算得出平均').toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  setVertexColors,
  buildCarGeometry,
  buildBusGeometry,
  buildTruckGeometry,
  buildFiretruckGeometry,
  buildTransportBusGeometry,
  buildMetroTrainGeometry,
  buildMetroCarriageGeometry,
  buildRailTrainGeometry,
  buildFerryGeometry,
} from '../geometry';

// ---------------------------------------------------------------------------
// Task 1: vehicleGeometry 拆分為獨立檔案後，barrel export 應保持完整
// ---------------------------------------------------------------------------

describe('geometry barrel export', () => {
  it('setVertexColors 應該從 barrel export 匯出', () => {
    expect(typeof setVertexColors).toBe('function');
  });

  it.each([
    ['buildCarGeometry', buildCarGeometry],
    ['buildBusGeometry', buildBusGeometry],
    ['buildTruckGeometry', buildTruckGeometry],
    ['buildFiretruckGeometry', buildFiretruckGeometry],
    ['buildTransportBusGeometry', buildTransportBusGeometry],
    ['buildMetroTrainGeometry', buildMetroTrainGeometry],
    ['buildMetroCarriageGeometry', buildMetroCarriageGeometry],

    ['buildRailTrainGeometry', buildRailTrainGeometry],
    ['buildFerryGeometry', buildFerryGeometry],
  ])('%s 應該是可呼叫的函數', (_name, fn) => {
    expect(typeof fn).toBe('function');
  });

  it.each([
    ['buildCarGeometry', buildCarGeometry],
    ['buildBusGeometry', buildBusGeometry],
    ['buildTruckGeometry', buildTruckGeometry],
    ['buildFiretruckGeometry', buildFiretruckGeometry],

    ['buildRailTrainGeometry', buildRailTrainGeometry],
    ['buildFerryGeometry', buildFerryGeometry],
    ['buildMetroTrainGeometry', buildMetroTrainGeometry],
    ['buildMetroCarriageGeometry', buildMetroCarriageGeometry],
  ])('%s 應該返回有效的 BufferGeometry', (_name, fn) => {
    const geo = fn();
    expect(geo).toBeDefined();
    const pos = geo.attributes.position;
    expect(pos).toBeDefined();
    expect(pos!.count).toBeGreaterThan(0);
    // 所有 geometry 都應該有 vertex colors
    expect(geo.attributes.color).toBeDefined();
  });

  it('buildTransportBusGeometry 應與 buildBusGeometry 返回相同頂點數', () => {
    const bus = buildBusGeometry();
    const transportBus = buildTransportBusGeometry();
    expect(transportBus.attributes.position!.count).toBe(bus.attributes.position!.count);
  });

});

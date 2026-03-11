import { describe, it, expect } from 'vitest';
import { collectTransportVehicles, type TransportVehicleRenderData } from '../collectTransportVehicles';
import { BusSystem } from '../BusSystem';
import { TramSystem } from '../TramSystem';
import { RailSystem } from '../RailSystem';
import { FerrySystem } from '../FerrySystem';
import { TaxiSystem } from '../TaxiSystem';

/** Helper to build an empty surface-transport systems object */
function emptySystems() {
  return {
    bus: new BusSystem(),
    tram: new TramSystem(),
    rail: new RailSystem(),
    ferry: new FerrySystem(),
    taxi: new TaxiSystem(),
  };
}

// ---------------------------------------------------------------------------
// collectTransportVehicles — 將各交通系統的車輛轉換為渲染用資料
// (metro_train 已移至 MetroTunnelRenderer，不再經過此 collector)
// ---------------------------------------------------------------------------
describe('collectTransportVehicles', () => {
  it('應該返回空陣列當所有系統都沒有車輛時', () => {
    const result = collectTransportVehicles(emptySystems());
    expect(result).toEqual([]);
  });

  it('應該收集 BusSystem 的車輛並標記為 transport_bus 類型', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(10, 0);
    bus.createRoute([s1, s2], 2);

    const result = collectTransportVehicles({ ...emptySystems(), bus });

    expect(result).toHaveLength(2);
    for (const v of result) {
      expect(v.type).toBe('transport_bus');
      expect(v).toHaveProperty('x');
      expect(v).toHaveProperty('y');
      expect(v).toHaveProperty('heading');
      expect(v).toHaveProperty('id');
    }
  });

  it('應該收集 TramSystem 的車輛並標記為 tram 類型', () => {
    const tram = new TramSystem();
    const s1 = tram.addStop(0, 0);
    const s2 = tram.addStop(3, 0);
    tram.createRoute([s1, s2], 1);

    const result = collectTransportVehicles({ ...emptySystems(), tram });

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('tram');
  });

  it('應該收集 RailSystem 的列車並標記為 rail_train 類型', () => {
    const rail = new RailSystem();
    const s1 = rail.buildStation(0, 0);
    const s2 = rail.buildStation(10, 10);
    rail.createLine([s1, s2]);

    const result = collectTransportVehicles({ ...emptySystems(), rail });

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('rail_train');
  });

  it('應該收集 FerrySystem 的渡輪並標記為 ferry 類型', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(5, 5)!;
    ferry.createRoute([d1, d2], 1);

    const result = collectTransportVehicles({ ...emptySystems(), ferry });

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('ferry');
  });

  it('應該收集 TaxiSystem 的車輛並標記為 taxi 類型', () => {
    const taxi = new TaxiSystem();
    taxi.addStand(0, 0, 2); // 每個招呼站預設 2 輛

    const result = collectTransportVehicles({ ...emptySystems(), taxi });

    expect(result).toHaveLength(2);
    for (const v of result) {
      expect(v.type).toBe('taxi');
    }
  });

  it('應該同時收集多個系統的車輛', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    bus.createRoute([s1, s2], 1);

    const taxi = new TaxiSystem();
    taxi.addStand(10, 10, 1);

    const result = collectTransportVehicles({ ...emptySystems(), bus, taxi });

    // 1 bus + 1 taxi = 2
    expect(result).toHaveLength(2);
    expect(result.filter(v => v.type === 'transport_bus')).toHaveLength(1);
    expect(result.filter(v => v.type === 'taxi')).toHaveLength(1);
  });

  it('車輛的位置應該反映 TransportVehicle.position', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(3, 7);
    const s2 = bus.addStop(10, 7);
    bus.createRoute([s1, s2], 1);
    bus.tick();

    const result = collectTransportVehicles({ ...emptySystems(), bus });

    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBe(3);
    expect(result[0]!.y).toBe(7);
  });

  it('每個車輛的 ID 應該全域唯一（含前綴避免跨系統碰撞）', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    bus.createRoute([s1, s2], 1);

    const tram = new TramSystem();
    const t1 = tram.addStop(0, 0);
    const t2 = tram.addStop(3, 0);
    tram.createRoute([t1, t2], 1);

    const result = collectTransportVehicles({ ...emptySystems(), bus, tram });

    const ids = result.map(v => v.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('laneOffset 應該為 0（交通系統車輛不走車道）', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    bus.createRoute([s1, s2], 1);

    const result = collectTransportVehicles({ ...emptySystems(), bus });

    expect(result[0]!.laneOffset).toBe(0);
  });
});

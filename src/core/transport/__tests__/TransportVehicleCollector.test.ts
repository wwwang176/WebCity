import { describe, it, expect } from 'vitest';
import { collectTransportVehicles, type TransportVehicleRenderData } from '../collectTransportVehicles';
import { RailSystem } from '../RailSystem';
import { FerrySystem } from '../FerrySystem';

/** Helper to build an empty surface-transport systems object */
function emptySystems() {
  return {
    rail: new RailSystem(),
    ferry: new FerrySystem(),
  };
}

// ---------------------------------------------------------------------------
// collectTransportVehicles — 將各交通系統的車輛轉換為渲染用資料
// Bus vehicles are now rendered via TrafficSimulation (not collected here).
// ---------------------------------------------------------------------------
describe('collectTransportVehicles', () => {
  it('should return empty array when no vehicles in any system', () => {
    const result = collectTransportVehicles(emptySystems());
    expect(result).toEqual([]);
  });

  it('should collect RailSystem trains as rail_train type', () => {
    const rail = new RailSystem();
    const s1 = rail.buildStation(0, 0);
    const s2 = rail.buildStation(10, 10);
    rail.createLine([s1, s2]);

    const result = collectTransportVehicles({ ...emptySystems(), rail });

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('rail_train');
  });

  it('should collect FerrySystem vessels as ferry type', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(5, 5)!;
    ferry.createRoute([d1, d2], 1);

    const result = collectTransportVehicles({ ...emptySystems(), ferry });

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('ferry');
  });

  it('should collect vehicles from multiple systems', () => {
    const rail = new RailSystem();
    const rs1 = rail.buildStation(0, 0);
    const rs2 = rail.buildStation(10, 10);
    rail.createLine([rs1, rs2]);

    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(5, 5)!;
    ferry.createRoute([d1, d2], 1);

    const result = collectTransportVehicles({ rail, ferry });

    // 1 rail_train + 1 ferry = 2
    expect(result).toHaveLength(2);
    expect(result.filter(v => v.type === 'rail_train')).toHaveLength(1);
    expect(result.filter(v => v.type === 'ferry')).toHaveLength(1);
  });

  it('each vehicle ID should be globally unique (with prefix offsets)', () => {
    const rail = new RailSystem();
    const rs1 = rail.buildStation(0, 0);
    const rs2 = rail.buildStation(10, 10);
    rail.createLine([rs1, rs2]);

    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(5, 5)!;
    ferry.createRoute([d1, d2], 1);

    const result = collectTransportVehicles({ rail, ferry });

    const ids = result.map(v => v.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('laneOffset should be 0 for transport vehicles', () => {
    const rail = new RailSystem();
    const rs1 = rail.buildStation(0, 0);
    const rs2 = rail.buildStation(10, 10);
    rail.createLine([rs1, rs2]);

    const result = collectTransportVehicles({ rail, ferry: new FerrySystem() });
    expect(result[0]!.laneOffset).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { collectTransportRoutes, type TransportRouteRenderData } from '../collectTransportRoutes';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { RailSystem } from '../RailSystem';
import { FerrySystem } from '../FerrySystem';

// ---------------------------------------------------------------------------
// collectTransportRoutes — collects route data for TransportRouteRenderer.
// ---------------------------------------------------------------------------
describe('collectTransportRoutes', () => {
  it('應該返回空陣列當所有系統都沒有路線時', () => {
    const result = collectTransportRoutes({
      bus: new BusSystem(),
      metro: new MetroSystem(),

      rail: new RailSystem(),
      ferry: new FerrySystem(),
    });
    expect(result).toEqual([]);
  });

  it('應該收集 BusSystem 路線並附上正確顏色', () => {
    const bus = new BusSystem();
    const s1 = bus.addStop(0, 0);
    const s2 = bus.addStop(5, 0);
    const s3 = bus.addStop(10, 5);
    bus.createRoute([s1, s2, s3]);

    const result = collectTransportRoutes({
      bus,
      metro: new MetroSystem(),

      rail: new RailSystem(),
      ferry: new FerrySystem(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.system).toBe('BUS');
    expect(result[0]!.color).toBe(0xff9800); // orange
    expect(result[0]!.stops).toHaveLength(3);
    expect(result[0]!.stops[0]).toEqual({ x: 0, y: 0 });
    expect(result[0]!.stops[1]).toEqual({ x: 5, y: 0 });
    expect(result[0]!.stops[2]).toEqual({ x: 10, y: 5 });
  });

  it('應該收集 MetroSystem 路線並附上正確顏色', () => {
    const metro = new MetroSystem();
    const s1 = metro.addStation(0, 0);
    const s2 = metro.addStation(5, 5);
    metro.createLine([s1, s2]);

    const result = collectTransportRoutes({
      bus: new BusSystem(),
      metro,

      rail: new RailSystem(),
      ferry: new FerrySystem(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.system).toBe('METRO');
    expect(result[0]!.color).toBe(0x00bcd4); // cyan
    expect(result[0]!.stops).toHaveLength(2);
  });

  it('應該收集 RailSystem 路線並附上正確顏色', () => {
    const rail = new RailSystem();
    const s1 = rail.buildStation(0, 0);
    const s2 = rail.buildStation(10, 10);
    rail.createLine([s1, s2]);

    const result = collectTransportRoutes({
      bus: new BusSystem(),
      metro: new MetroSystem(),

      rail,
      ferry: new FerrySystem(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.system).toBe('RAIL');
    expect(result[0]!.color).toBe(0xff5722); // orange-red
  });

  it('應該收集 FerrySystem 路線並附上正確顏色', () => {
    const ferry = new FerrySystem();
    const d1 = ferry.addDock(0, 0)!;
    const d2 = ferry.addDock(5, 5)!;
    ferry.createRoute([d1, d2]);

    const result = collectTransportRoutes({
      bus: new BusSystem(),
      metro: new MetroSystem(),

      rail: new RailSystem(),
      ferry,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.system).toBe('FERRY');
    expect(result[0]!.color).toBe(0x0097a7); // dark cyan
  });

  it('應該同時收集多個系統的多條路線', () => {
    const bus = new BusSystem();
    const bs1 = bus.addStop(0, 0);
    const bs2 = bus.addStop(5, 0);
    const bs3 = bus.addStop(10, 0);
    bus.createRoute([bs1, bs2]); // route 1
    bus.createRoute([bs2, bs3]); // route 2

    const metro = new MetroSystem();
    const ms1 = metro.addStation(0, 0);
    const ms2 = metro.addStation(5, 5);
    metro.createLine([ms1, ms2]); // route 3

    const result = collectTransportRoutes({
      bus,
      metro,

      rail: new RailSystem(),
      ferry: new FerrySystem(),
    });

    expect(result).toHaveLength(3);
    expect(result.filter(r => r.system === 'BUS')).toHaveLength(2);
    expect(result.filter(r => r.system === 'METRO')).toHaveLength(1);
  });

  it('每條路線應有唯一的 routeId', () => {
    const bus = new BusSystem();
    const bs1 = bus.addStop(0, 0);
    const bs2 = bus.addStop(5, 0);
    bus.createRoute([bs1, bs2]);

    const metro = new MetroSystem();
    const ms1 = metro.addStation(0, 0);
    const ms2 = metro.addStation(5, 5);
    metro.createLine([ms1, ms2]);

    const result = collectTransportRoutes({
      bus,
      metro,

      rail: new RailSystem(),
      ferry: new FerrySystem(),
    });

    const ids = result.map(r => r.routeId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

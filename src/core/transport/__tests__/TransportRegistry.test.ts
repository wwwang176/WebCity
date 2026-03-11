import { describe, it, expect } from 'vitest';
import { getSystemForMode, getTransitSystems } from '../TransportRegistry';
import { TransportMode, TransportType } from '../types';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { RailSystem } from '../RailSystem';
import { FerrySystem } from '../FerrySystem';

function makeSystems() {
  return {
    bus: new BusSystem(),
    metro: new MetroSystem(),
    rail: new RailSystem(),
    ferry: new FerrySystem(),
  };
}

describe('TransportRegistry', () => {
  describe('getSystemForMode', () => {
    it('returns BusSystem for TransportMode.BUS', () => {
      const s = makeSystems();
      expect(getSystemForMode(s, TransportMode.BUS)).toBe(s.bus);
    });

    it('returns MetroSystem for TransportMode.METRO', () => {
      const s = makeSystems();
      expect(getSystemForMode(s, TransportMode.METRO)).toBe(s.metro);
    });

    it('returns RailSystem for TransportMode.RAIL', () => {
      const s = makeSystems();
      expect(getSystemForMode(s, TransportMode.RAIL)).toBe(s.rail);
    });

    it('returns FerrySystem for TransportMode.FERRY', () => {
      const s = makeSystems();
      expect(getSystemForMode(s, TransportMode.FERRY)).toBe(s.ferry);
    });

    it('returns undefined for TransportMode.WALK', () => {
      const s = makeSystems();
      expect(getSystemForMode(s, TransportMode.WALK)).toBeUndefined();
    });

    it('returns undefined for TransportMode.DRIVE', () => {
      const s = makeSystems();
      expect(getSystemForMode(s, TransportMode.DRIVE)).toBeUndefined();
    });
  });

  describe('getTransitSystems', () => {
    it('returns all 4 transit systems with correct TransportType', () => {
      const s = makeSystems();
      const entries = getTransitSystems(s);
      expect(entries).toHaveLength(4);

      const types = entries.map(e => e.type);
      expect(types).toContain(TransportType.BUS);
      expect(types).toContain(TransportType.METRO);
      expect(types).toContain(TransportType.RAIL);
      expect(types).toContain(TransportType.FERRY);
    });

    it('maps each type to the correct system instance', () => {
      const s = makeSystems();
      const entries = getTransitSystems(s);
      const map = new Map(entries.map(e => [e.type, e.system]));

      expect(map.get(TransportType.BUS)).toBe(s.bus);
      expect(map.get(TransportType.METRO)).toBe(s.metro);
      expect(map.get(TransportType.RAIL)).toBe(s.rail);
      expect(map.get(TransportType.FERRY)).toBe(s.ferry);
    });

    it('each system exposes getStops() from BaseTransportSystem', () => {
      const s = makeSystems();
      s.bus.addStop(1, 2);
      s.metro.addStop(3, 4);

      const entries = getTransitSystems(s);
      const busEntry = entries.find(e => e.type === TransportType.BUS)!;
      const metroEntry = entries.find(e => e.type === TransportType.METRO)!;

      expect(busEntry.system.getStops()).toHaveLength(1);
      expect(metroEntry.system.getStops()).toHaveLength(1);
    });
  });
});

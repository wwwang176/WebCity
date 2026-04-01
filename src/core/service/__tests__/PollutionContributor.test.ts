import { describe, it, expect } from 'vitest';
import { GarbageService } from '../GarbageService';
import { SewageService } from '../SewageService';
import type { PollutionSource } from '../../environment/Pollution';

describe('PollutionContributor', () => {
  describe('GarbageService.getPollutionSources()', () => {
    it('should return empty array when no facilities', () => {
      const svc = new GarbageService();
      expect(svc.getPollutionSources()).toEqual([]);
    });

    it('should return base pollution from all cells even when under 50% load', () => {
      const svc = new GarbageService();
      svc.addFacility(5, 5, 1000);
      // Don't add any load — still emits base pollution from 4 cells
      const sources = svc.getPollutionSources();
      expect(sources.length).toBe(4);
      expect(sources[0]!.type).toBe('ground');
      expect(sources.every(s => s.amount > 0)).toBe(true);
    });

    it('should return base + overload pollution when facility is over 50% load', () => {
      const svc = new GarbageService();
      svc.addFacility(5, 5, 100);
      // Tick with enough garbage to fill more than 50%
      svc.tick(100); // 100 units of garbage into capacity=100
      const sources = svc.getPollutionSources();
      // 4 base + 4 overload = 8
      expect(sources.length).toBe(8);
      expect(sources[0]!.type).toBe('ground');
      expect(sources.every(s => s.amount > 0)).toBe(true);
    });
  });

  describe('SewageService.getPollutionSources()', () => {
    it('should return empty array when no untreated sewage', () => {
      const svc = new SewageService();
      svc.addTreatmentPlant(5, 5, 200);
      svc.tick(100); // treated
      expect(svc.getPollutionSources()).toEqual([]);
    });

    it('should return water pollution at outlet locations when untreated sewage exists', () => {
      const svc = new SewageService();
      svc.addOutlet(10, 10);
      // No treatment plant, so all sewage is untreated
      svc.tick(200); // produces 2 units of sewage, 0 capacity → untreated = 2
      const sources = svc.getPollutionSources();
      expect(sources.length).toBe(1);
      expect(sources[0]!.x).toBe(10);
      expect(sources[0]!.y).toBe(10);
      expect(sources[0]!.type).toBe('water');
      expect(sources[0]!.amount).toBeGreaterThan(0);
    });

    it('should return pollution at all outlets', () => {
      const svc = new SewageService();
      svc.addOutlet(5, 5);
      svc.addOutlet(15, 15);
      svc.tick(500); // 5 units untreated
      const sources = svc.getPollutionSources();
      expect(sources.length).toBe(2);
    });
  });
});

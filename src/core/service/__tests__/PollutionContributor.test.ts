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

    it('should return empty array when facilities are under 50% load', () => {
      const svc = new GarbageService();
      svc.addFacility(5, 5, 1000);
      // Don't add any load
      expect(svc.getPollutionSources()).toEqual([]);
    });

    it('should return ground pollution source when facility is over 50% load', () => {
      const svc = new GarbageService();
      svc.addFacility(5, 5, 100);
      // Manually set load by ticking with high population
      // Tick with enough population to fill more than 50%
      svc.tick(10000); // produces 100 units of garbage
      const sources = svc.getPollutionSources();
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0]!.x).toBe(5);
      expect(sources[0]!.y).toBe(5);
      expect(sources[0]!.type).toBe('ground');
      expect(sources[0]!.amount).toBeGreaterThan(0);
    });
  });

  describe('SewageService.getPollutionSources()', () => {
    it('should return empty array when no untreated sewage', () => {
      const svc = new SewageService();
      svc.addTreatmentPlant(5, 5, 200);
      svc.tick(100); // treated
      expect(svc.getPollutionSources()).toEqual([]);
    });

    it('should return ground pollution at outlet locations when untreated sewage exists', () => {
      const svc = new SewageService();
      svc.addOutlet(10, 10);
      // No treatment plant, so all sewage is untreated
      svc.tick(200); // produces 2 units of sewage, 0 capacity → untreated = 2
      const sources = svc.getPollutionSources();
      expect(sources.length).toBe(1);
      expect(sources[0]!.x).toBe(10);
      expect(sources[0]!.y).toBe(10);
      expect(sources[0]!.type).toBe('ground');
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

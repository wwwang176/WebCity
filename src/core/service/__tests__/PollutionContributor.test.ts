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
      // Directly set load above 50% to test overload pollution
      (svc.getFacilities()[0]! as any).currentLoad = 100;
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

    it('should return water pollution at unsupplied building locations', () => {
      const svc = new SewageService();
      // No treatment plant → nothing supplied
      svc.reportSewage(10, 10, 200);
      svc.tick(200);
      const sources = svc.getPollutionSources();
      expect(sources.length).toBe(1);
      expect(sources[0]!.x).toBe(10);
      expect(sources[0]!.y).toBe(10);
      expect(sources[0]!.type).toBe('water');
      expect(sources[0]!.amount).toBeGreaterThan(0);
    });

    it('should return pollution at all unsupplied buildings', () => {
      const svc = new SewageService();
      svc.reportSewage(5, 5, 250);
      svc.reportSewage(15, 15, 250);
      svc.tick(500);
      const sources = svc.getPollutionSources();
      expect(sources.length).toBe(2);
    });
  });
});

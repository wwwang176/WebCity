import { describe, it, expect, vi } from 'vitest';
import {
  COVERAGE_OVERLAY_TYPES,
  getCoverageService,
  type CoverageServices,
} from '../CoverageOverlay';

function makeServices(): CoverageServices {
  return {
    police: { getCoverage: vi.fn().mockReturnValue(false) },
    fire: { getCoverage: vi.fn().mockReturnValue(false) },
    health: { getCoverage: vi.fn().mockReturnValue(false) },
    education: { getCoverage: vi.fn().mockReturnValue(false) },
    parks: { getCoverage: vi.fn().mockReturnValue(false) },
    garbage: { getCoverage: vi.fn().mockReturnValue(false) },
  };
}

describe('CoverageOverlay', () => {
  describe('COVERAGE_OVERLAY_TYPES', () => {
    it('should include police, fire, health, education, park, garbage', () => {
      expect(COVERAGE_OVERLAY_TYPES).toContain('police');
      expect(COVERAGE_OVERLAY_TYPES).toContain('fire');
      expect(COVERAGE_OVERLAY_TYPES).toContain('health');
      expect(COVERAGE_OVERLAY_TYPES).toContain('education');
      expect(COVERAGE_OVERLAY_TYPES).toContain('park');
      expect(COVERAGE_OVERLAY_TYPES).toContain('garbage');
    });

    it('should have exactly 6 coverage overlay types', () => {
      expect(COVERAGE_OVERLAY_TYPES).toHaveLength(6);
    });
  });

  describe('getCoverageService', () => {
    it('should return the correct service for each overlay type', () => {
      const services = makeServices();
      expect(getCoverageService(services, 'police')).toBe(services.police);
      expect(getCoverageService(services, 'fire')).toBe(services.fire);
      expect(getCoverageService(services, 'health')).toBe(services.health);
      expect(getCoverageService(services, 'education')).toBe(services.education);
      expect(getCoverageService(services, 'park')).toBe(services.parks);
      expect(getCoverageService(services, 'garbage')).toBe(services.garbage);
    });

    it('should return undefined for non-coverage overlay types', () => {
      const services = makeServices();
      expect(getCoverageService(services, 'power')).toBeUndefined();
      expect(getCoverageService(services, 'zone')).toBeUndefined();
      expect(getCoverageService(services, 'traffic')).toBeUndefined();
      expect(getCoverageService(services, 'none')).toBeUndefined();
    });

    it('should call getCoverage on the correct service', () => {
      const services = makeServices();
      (services.fire.getCoverage as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const svc = getCoverageService(services, 'fire')!;
      expect(svc.getCoverage(5, 10)).toBe(true);
      expect(services.fire.getCoverage).toHaveBeenCalledWith(5, 10);
    });
  });
});

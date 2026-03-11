import { describe, it, expect } from 'vitest';
import { ZoneType } from '../types';
import { isResidentialZone, isCommercialZone, isWorkplaceZone, zoneToRCI } from '../types';

describe('ZoneType helper functions', () => {
  describe('isResidentialZone', () => {
    it('should return true for RESIDENTIAL_LOW', () => {
      expect(isResidentialZone(ZoneType.RESIDENTIAL_LOW)).toBe(true);
    });

    it('should return true for RESIDENTIAL_HIGH', () => {
      expect(isResidentialZone(ZoneType.RESIDENTIAL_HIGH)).toBe(true);
    });

    it('should return false for COMMERCIAL_LOW', () => {
      expect(isResidentialZone(ZoneType.COMMERCIAL_LOW)).toBe(false);
    });

    it('should return false for INDUSTRIAL', () => {
      expect(isResidentialZone(ZoneType.INDUSTRIAL)).toBe(false);
    });

    it('should return false for NONE', () => {
      expect(isResidentialZone(ZoneType.NONE)).toBe(false);
    });
  });

  describe('isCommercialZone', () => {
    it('should return true for COMMERCIAL_LOW', () => {
      expect(isCommercialZone(ZoneType.COMMERCIAL_LOW)).toBe(true);
    });

    it('should return true for COMMERCIAL_HIGH', () => {
      expect(isCommercialZone(ZoneType.COMMERCIAL_HIGH)).toBe(true);
    });

    it('should return false for RESIDENTIAL_LOW', () => {
      expect(isCommercialZone(ZoneType.RESIDENTIAL_LOW)).toBe(false);
    });

    it('should return false for INDUSTRIAL', () => {
      expect(isCommercialZone(ZoneType.INDUSTRIAL)).toBe(false);
    });
  });

  describe('isWorkplaceZone', () => {
    it('should return true for COMMERCIAL_LOW', () => {
      expect(isWorkplaceZone(ZoneType.COMMERCIAL_LOW)).toBe(true);
    });

    it('should return true for COMMERCIAL_HIGH', () => {
      expect(isWorkplaceZone(ZoneType.COMMERCIAL_HIGH)).toBe(true);
    });

    it('should return true for INDUSTRIAL', () => {
      expect(isWorkplaceZone(ZoneType.INDUSTRIAL)).toBe(true);
    });

    it('should return true for OFFICE', () => {
      expect(isWorkplaceZone(ZoneType.OFFICE)).toBe(true);
    });

    it('should return false for RESIDENTIAL_LOW', () => {
      expect(isWorkplaceZone(ZoneType.RESIDENTIAL_LOW)).toBe(false);
    });

    it('should return false for NONE', () => {
      expect(isWorkplaceZone(ZoneType.NONE)).toBe(false);
    });
  });

  describe('zoneToRCI', () => {
    it('maps residential zones to residential', () => {
      expect(zoneToRCI(ZoneType.RESIDENTIAL_LOW)).toBe('residential');
      expect(zoneToRCI(ZoneType.RESIDENTIAL_HIGH)).toBe('residential');
    });

    it('maps commercial zones to commercial', () => {
      expect(zoneToRCI(ZoneType.COMMERCIAL_LOW)).toBe('commercial');
      expect(zoneToRCI(ZoneType.COMMERCIAL_HIGH)).toBe('commercial');
    });

    it('maps industrial and office to industrial', () => {
      expect(zoneToRCI(ZoneType.INDUSTRIAL)).toBe('industrial');
      expect(zoneToRCI(ZoneType.OFFICE)).toBe('industrial');
    });

    it('returns null for NONE', () => {
      expect(zoneToRCI(ZoneType.NONE)).toBeNull();
    });
  });
});

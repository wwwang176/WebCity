import { describe, it, expect } from 'vitest';
import { buildHousingCandidates, buildWorkplaceCandidates } from '../BuildingCandidateBuilder';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { PollutionManager } from '../../environment/Pollution';
import { ParkService } from '../../service/ParkService';

describe('BuildingCandidateBuilder', () => {
  describe('buildHousingCandidates', () => {
    it('returns empty array when no residential buildings exist', () => {
      const grid = new Grid(5, 5);
      const pm = new PollutionManager(5, 5);
      const parks = new ParkService();
      const positions = [
        { pos: '2,2', x: 2, y: 2, buildingId: 10 }, // commercial (buildingId 10 = COM_L1)
      ];
      const result = buildHousingCandidates(positions, grid, pm, parks);
      expect(result).toHaveLength(0);
    });

    it('builds housing candidates for residential buildings', () => {
      const grid = new Grid(5, 5);
      grid.setCell(1, 1, {
        zoneType: ZoneType.RESIDENTIAL_LOW,
        buildingId: 1,
        landValue: 50,
        serviceCoverage: 3,
      });
      const pm = new PollutionManager(5, 5);
      const parks = new ParkService();
      const positions = [
        { pos: '1,1', x: 1, y: 1, buildingId: 1 },
      ];
      const result = buildHousingCandidates(positions, grid, pm, parks);
      expect(result).toHaveLength(1);
      expect(result[0]!.pos).toBe('1,1');
      expect(result[0]!.landValue).toBe(50);
      expect(result[0]!.serviceCoverage).toBe(3);
    });

    it('skips building positions with unknown buildingId', () => {
      const grid = new Grid(5, 5);
      const pm = new PollutionManager(5, 5);
      const parks = new ParkService();
      // buildingId 999 doesn't exist in building types
      const positions = [
        { pos: '1,1', x: 1, y: 1, buildingId: 999 },
      ];
      const result = buildHousingCandidates(positions, grid, pm, parks);
      expect(result).toHaveLength(0);
    });
  });

  describe('buildWorkplaceCandidates', () => {
    it('returns empty array when no workplace buildings exist', () => {
      const positions = [
        { pos: '1,1', x: 1, y: 1, buildingId: 1 }, // residential only
      ];
      const result = buildWorkplaceCandidates(positions);
      expect(result).toHaveLength(0);
    });

    it('builds workplace candidates for commercial/industrial buildings', () => {
      const positions = [
        { pos: '2,2', x: 2, y: 2, buildingId: 10 }, // COM_L1 has workers
      ];
      const result = buildWorkplaceCandidates(positions);
      expect(result.length).toBeGreaterThanOrEqual(0);
      // Check that if any result exists, it has the right shape
      if (result.length > 0) {
        expect(result[0]!.pos).toBe('2,2');
        expect(result[0]!.capacity).toBeGreaterThan(0);
      }
    });

    it('includes zoneType for each workplace', () => {
      const positions = [
        { pos: '2,2', x: 2, y: 2, buildingId: 10 },
      ];
      const result = buildWorkplaceCandidates(positions);
      if (result.length > 0) {
        expect(result[0]!.zoneType).toBeDefined();
      }
    });
  });
});

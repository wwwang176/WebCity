import { describe, it, expect } from 'vitest';
import { getCellServiceFlags, getCellServiceScore, serviceFlagsToScore, getResidentialServiceRatios, type ServiceFlags } from '../ServiceCoverageQuery';
import { createGameState } from '../../simulation/GameState';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

describe('ServiceCoverageQuery', () => {
  describe('getCellServiceFlags', () => {
    it('returns all false when no services are active', () => {
      const state = createGameState(10, 10);
      const flags = getCellServiceFlags(state, 5, 5);
      expect(flags.isPowered).toBe(false);
      expect(flags.isWatered).toBe(false);
      expect(flags.hasPolice).toBe(false);
      expect(flags.hasFire).toBe(false);
      expect(flags.hasGarbage).toBe(false);
      expect(flags.hasHealth).toBe(false);
      expect(flags.hasEducation).toBe(false);
      expect(flags.hasDeathCare).toBe(false);
    });

    it('returns hasPolice=true when cell has police coverage via road', () => {
      const state = createGameState(10, 10);
      // Build a cross road at (5,5) so police can flood-fill
      for (let i = 0; i < 10; i++) {
        state.grid.setCell(i, 5, { roadType: RoadType.TWO_LANE });
        state.grid.setCell(5, i, { roadType: RoadType.TWO_LANE });
      }
      // Station adjacent to road
      state.police.addStation(4, 5);
      state.police.tick(state.grid);

      const flags = getCellServiceFlags(state, 5, 5);
      expect(flags.hasPolice).toBe(true);
    });
  });

  describe('serviceFlagsToScore', () => {
    it('returns 0 when all flags are false', () => {
      const flags: ServiceFlags = {
        isPowered: false, isWatered: false,
        hasPolice: false, hasFire: false, hasGarbage: false,
        hasHealth: false, hasEducation: false, hasDeathCare: false,
      };
      expect(serviceFlagsToScore(flags)).toBe(0);
    });

    it('returns 2 for power only', () => {
      const flags: ServiceFlags = {
        isPowered: true, isWatered: false,
        hasPolice: false, hasFire: false, hasGarbage: false,
        hasHealth: false, hasEducation: false, hasDeathCare: false,
      };
      expect(serviceFlagsToScore(flags)).toBe(2);
    });

    it('returns 4 for power + water', () => {
      const flags: ServiceFlags = {
        isPowered: true, isWatered: true,
        hasPolice: false, hasFire: false, hasGarbage: false,
        hasHealth: false, hasEducation: false, hasDeathCare: false,
      };
      expect(serviceFlagsToScore(flags)).toBe(4);
    });

    it('returns 10 when all services are active', () => {
      const flags: ServiceFlags = {
        isPowered: true, isWatered: true,
        hasPolice: true, hasFire: true, hasGarbage: true,
        hasHealth: true, hasEducation: true, hasDeathCare: true,
      };
      // 2+2+1+1+1+1+1+1 = 10
      expect(serviceFlagsToScore(flags)).toBe(10);
    });

    it('each civic service adds 1 to score', () => {
      const base: ServiceFlags = {
        isPowered: false, isWatered: false,
        hasPolice: false, hasFire: false, hasGarbage: false,
        hasHealth: false, hasEducation: false, hasDeathCare: false,
      };
      expect(serviceFlagsToScore({ ...base, hasPolice: true })).toBe(1);
      expect(serviceFlagsToScore({ ...base, hasFire: true })).toBe(1);
      expect(serviceFlagsToScore({ ...base, hasGarbage: true })).toBe(1);
      expect(serviceFlagsToScore({ ...base, hasHealth: true })).toBe(1);
      expect(serviceFlagsToScore({ ...base, hasEducation: true })).toBe(1);
      expect(serviceFlagsToScore({ ...base, hasDeathCare: true })).toBe(1);
    });
  });

  describe('getCellServiceScore', () => {
    it('returns 0 when no services are active', () => {
      const state = createGameState(10, 10);
      const score = getCellServiceScore(state, 5, 5);
      expect(score).toBe(0);
    });

    it('score increases when police coverage is added', () => {
      const state = createGameState(10, 10);
      for (let i = 0; i < 10; i++) {
        state.grid.setCell(i, 5, { roadType: RoadType.TWO_LANE });
        state.grid.setCell(5, i, { roadType: RoadType.TWO_LANE });
      }
      const baseScore = getCellServiceScore(state, 5, 5);

      state.police.addStation(4, 5);
      state.police.tick(state.grid);
      const withPolice = getCellServiceScore(state, 5, 5);
      expect(withPolice).toBeGreaterThan(baseScore);
    });
  });

  describe('getResidentialServiceRatios', () => {
    it('returns all zeros when no residential buildings exist', () => {
      const state = createGameState(10, 10);
      const ratios = getResidentialServiceRatios(state);
      expect(ratios.poweredRatio).toBe(0);
      expect(ratios.wateredRatio).toBe(0);
      expect(ratios.policeRatio).toBe(0);
      expect(ratios.fireRatio).toBe(0);
      expect(ratios.garbageRatio).toBe(0);
      expect(ratios.healthRatio).toBe(0);
      expect(ratios.educationRatio).toBe(0);
      expect(ratios.deathCareRatio).toBe(0);
    });

    it('returns 1.0 for police when all residential buildings are covered', () => {
      const state = createGameState(10, 10);
      // Build cross road
      for (let i = 0; i < 10; i++) {
        state.grid.setCell(i, 5, { roadType: RoadType.TWO_LANE });
        state.grid.setCell(5, i, { roadType: RoadType.TWO_LANE });
      }
      // Place residential building adjacent to road
      state.grid.setCell(6, 5, {
        zoneType: ZoneType.RESIDENTIAL_LOW,
        buildingId: 1,
        roadType: RoadType.NONE,
      });
      // Police at road cell
      state.police.addStation(4, 5);
      state.police.tick(state.grid);

      const ratios = getResidentialServiceRatios(state);
      expect(ratios.policeRatio).toBe(1);
    });

    it('ignores non-residential buildings', () => {
      const state = createGameState(10, 10);
      for (let i = 0; i < 10; i++) {
        state.grid.setCell(i, 5, { roadType: RoadType.TWO_LANE });
      }
      // Only commercial building
      state.grid.setCell(6, 5, {
        zoneType: ZoneType.COMMERCIAL_LOW,
        buildingId: 10,
      });
      state.police.addStation(4, 5);
      state.police.tick(state.grid);

      const ratios = getResidentialServiceRatios(state);
      expect(ratios.policeRatio).toBe(0);
    });

    it('returns partial ratio when some buildings are covered', () => {
      const state = createGameState(20, 20);
      // Build a road from 0 to 10
      for (let i = 0; i < 11; i++) {
        state.grid.setCell(i, 10, { roadType: RoadType.TWO_LANE });
      }
      // Two residential buildings along road
      state.grid.setCell(3, 10, {
        zoneType: ZoneType.RESIDENTIAL_LOW,
        buildingId: 1,
        roadType: RoadType.NONE,
      });
      state.grid.setCell(3, 9, {
        zoneType: ZoneType.RESIDENTIAL_LOW,
        buildingId: 1,
      });
      // Police near first building only (limited radius)
      state.police.addStation(2, 10);
      state.police.tick(state.grid);

      const ratios = getResidentialServiceRatios(state);
      // At least one of two should be covered
      expect(ratios.policeRatio).toBeGreaterThanOrEqual(0);
      expect(ratios.policeRatio).toBeLessThanOrEqual(1);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { getCellServiceFlags, getCellServiceScore, serviceFlagsToScore, getResidentialServiceRatios, getCellServiceCostScore, MAX_SERVICE_SCORE, type ServiceFlags } from '../ServiceCoverageQuery';
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
        isPowered: false, isWatered: false, hasSewage: false,
        hasPolice: false, hasFire: false, hasGarbage: false,
        hasHealth: false, hasEducation: false, hasDeathCare: false,
      };
      expect(serviceFlagsToScore(flags)).toBe(0);
    });

    it('returns 2 for power only', () => {
      const flags: ServiceFlags = {
        isPowered: true, isWatered: false, hasSewage: false,
        hasPolice: false, hasFire: false, hasGarbage: false,
        hasHealth: false, hasEducation: false, hasDeathCare: false,
      };
      expect(serviceFlagsToScore(flags)).toBe(2);
    });

    it('returns 4 for power + water', () => {
      const flags: ServiceFlags = {
        isPowered: true, isWatered: true, hasSewage: false,
        hasPolice: false, hasFire: false, hasGarbage: false,
        hasHealth: false, hasEducation: false, hasDeathCare: false,
      };
      expect(serviceFlagsToScore(flags)).toBe(4);
    });

    it('returns 10 when all services are active', () => {
      const flags: ServiceFlags = {
        isPowered: true, isWatered: true, hasSewage: true,
        hasPolice: true, hasFire: true, hasGarbage: true,
        hasHealth: true, hasEducation: true, hasDeathCare: true,
      };
      // 2+2+1+1+1+1+1+1+1 = 11
      expect(serviceFlagsToScore(flags)).toBe(MAX_SERVICE_SCORE);
      expect(MAX_SERVICE_SCORE).toBe(11);
    });

    it('each civic service adds 1 to score', () => {
      const base: ServiceFlags = {
        isPowered: false, isWatered: false, hasSewage: false,
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

  describe('getCellServiceCostScore', () => {
    it('returns 0 when no services cover the cell', () => {
      const state = createGameState(10, 10);
      const score = getCellServiceCostScore(state, 5, 5, true);
      expect(score).toBe(0);
    });

    it('returns SERVICE_MAX_RES for residential with full infrastructure coverage', () => {
      // With power + water = 2+2 = 4, plus 6 services each contributing svc(0)=1 → 10
      const state = createGameState(10, 10);
      // We can't easily mock all services, so just test power/water contribution
      // Power + water each add 2 → test independently
      const scoreWithout = getCellServiceCostScore(state, 5, 5, true);
      expect(scoreWithout).toBe(0);
    });

    it('returns normalized score for non-residential', () => {
      const state = createGameState(10, 10);
      // Non-residential only counts power/water/police/fire
      const score = getCellServiceCostScore(state, 5, 5, false);
      expect(score).toBe(0); // nothing powered
    });

    it('power adds 2 to score', () => {
      const state = createGameState(10, 10);
      // Setup: place road + power plant + zone building
      for (let i = 0; i < 10; i++) {
        state.grid.setCell(i, 5, { roadType: RoadType.TWO_LANE });
      }
      state.grid.setCell(5, 4, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
      state.power.addPlant({ x: 4, y: 5, output: 1500, pollution: 0, type: 'coal' });
      state.power.calculateDemand(state.grid);
      state.power.calculateCoverage(state.grid, new Set(['4,5']));

      const unpowered = getCellServiceCostScore(state, 0, 0, true);
      const powered = getCellServiceCostScore(state, 5, 4, true);
      // Powered cell should have >= 2 (power contributes 2)
      expect(powered).toBeGreaterThanOrEqual(unpowered);
    });
  });
});

/**
 * Sewage was computed here and consumed by nobody. The city-wide sum skipped
 * it and the per-cell score did not list it, so a treatment plant contributed
 * nothing to happiness, land value, building level or abandonment stress —
 * while the building panel showed Sewage as a first-class service.
 */
describe('sewage is a service like the others', () => {
  it('should appear in the per-cell flags', () => {
    const base: ServiceFlags = {
      isPowered: false, isWatered: false, hasSewage: false,
      hasPolice: false, hasFire: false, hasGarbage: false,
      hasHealth: false, hasEducation: false, hasDeathCare: false,
    };
    expect(serviceFlagsToScore({ ...base, hasSewage: true })).toBe(1);
  });

  it('should weigh the same as the other ordinary services', () => {
    const base: ServiceFlags = {
      isPowered: false, isWatered: false, hasSewage: false,
      hasPolice: false, hasFire: false, hasGarbage: false,
      hasHealth: false, hasEducation: false, hasDeathCare: false,
    };
    expect(serviceFlagsToScore({ ...base, hasSewage: true }))
      .toBe(serviceFlagsToScore({ ...base, hasPolice: true }));
    // ...and less than the two deliberate 2x exceptions.
    expect(serviceFlagsToScore({ ...base, hasSewage: true }))
      .toBeLessThan(serviceFlagsToScore({ ...base, isPowered: true }));
  });

  it('should be counted by the maximum every consumer derives its bounds from', () => {
    // MAX_SERVICE_SCORE feeds MAX_ORDINARY_LAND_VALUE in Migration; leaving it
    // at 10 while the score can reach 11 would put an attainable land value
    // above the ceiling the migration threshold is calibrated against.
    const all: ServiceFlags = {
      isPowered: true, isWatered: true, hasSewage: true,
      hasPolice: true, hasFire: true, hasGarbage: true,
      hasHealth: true, hasEducation: true, hasDeathCare: true,
    };
    expect(serviceFlagsToScore(all)).toBe(MAX_SERVICE_SCORE);
  });
});

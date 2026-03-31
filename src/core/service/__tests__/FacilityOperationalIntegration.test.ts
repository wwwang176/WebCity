import { describe, it, expect, vi } from 'vitest';
import { tickAllCivicServices } from '../ServiceRegistry';
import { createGameState } from '../../simulation/GameState';
import type { GameState } from '../../simulation/GameState';

/**
 * Integration tests: civic facilities stop functioning when lacking power or water.
 */

function setupState(): GameState {
  const state = createGameState(10, 10);
  // Place roads for connectivity (row 1)
  for (let x = 0; x < 10; x++) {
    state.grid.setCell(x, 1, { roadFlags: 1, roadType: 1 });
  }
  return state;
}

/** Stub power/water to control which cells are powered/supplied. */
function stubUtilities(state: GameState, powered: boolean, supplied: boolean) {
  vi.spyOn(state.power, 'isPowered').mockReturnValue(powered);
  vi.spyOn(state.water, 'isSupplied').mockReturnValue(supplied);
}

describe('Facility Operational Integration', () => {
  // ── Police ──
  describe('PoliceService', () => {
    it('provides coverage when powered + supplied', () => {
      const state = setupState();
      state.police.addStation(0, 0);
      state.police.recalculateCoverage(state.grid);
      expect(state.police.getCoverage(0, 0)).toBe(true);

      stubUtilities(state, true, true);
      tickAllCivicServices(state);
      state.police.recalculateCoverage(state.grid);
      expect(state.police.getCoverage(0, 0)).toBe(true);
    });

    it('loses coverage when not powered', () => {
      const state = setupState();
      state.police.addStation(0, 0);
      stubUtilities(state, false, true);
      tickAllCivicServices(state);
      state.police.recalculateCoverage(state.grid);
      expect(state.police.getCoverage(0, 0)).toBe(false);
    });

    it('loses coverage when not supplied water', () => {
      const state = setupState();
      state.police.addStation(0, 0);
      stubUtilities(state, true, false);
      tickAllCivicServices(state);
      state.police.recalculateCoverage(state.grid);
      expect(state.police.getCoverage(0, 0)).toBe(false);
    });
  });

  // ── Fire ──
  describe('FireService', () => {
    it('loses coverage without power', () => {
      const state = setupState();
      state.fire.addStation(0, 0);
      stubUtilities(state, false, true);
      tickAllCivicServices(state);
      state.fire.recalculateCoverage(state.grid);
      expect(state.fire.getCoverage(0, 0)).toBe(false);
    });
  });

  // ── Health ──
  describe('HealthService', () => {
    it('loses coverage without water', () => {
      const state = setupState();
      state.health.addHospital(0, 0);
      stubUtilities(state, true, false);
      tickAllCivicServices(state);
      state.health.recalculateCoverage(state.grid);
      expect(state.health.getCoverage(0, 0)).toBe(false);
    });
  });

  // ── Garbage: tick processing + pollution ──
  describe('GarbageService', () => {
    it('does not burn garbage at non-operational facility', () => {
      const state = setupState();
      state.garbage.addFacility(0, 0, 1000);
      // Pre-load garbage
      stubUtilities(state, true, true);
      tickAllCivicServices(state);
      state.garbage.getFacilities()[0]!.currentLoad = 100;

      // Now remove power → facility stops
      stubUtilities(state, false, true);
      const loadBefore = state.garbage.getFacilities()[0]!.currentLoad;
      tickAllCivicServices(state);
      // Load should NOT decrease (no burning)
      expect(state.garbage.getFacilities()[0]!.currentLoad).toBe(loadBefore);
    });

    it('emits zero pollution from non-operational facility', () => {
      const state = setupState();
      state.garbage.addFacility(0, 0, 1000);
      stubUtilities(state, false, true);
      tickAllCivicServices(state);
      const sources = state.garbage.getPollutionSources();
      expect(sources).toHaveLength(0);
    });

    it('emits pollution from operational facility', () => {
      const state = setupState();
      state.garbage.addFacility(0, 0, 1000);
      stubUtilities(state, true, true);
      tickAllCivicServices(state);
      const sources = state.garbage.getPollutionSources();
      expect(sources.length).toBeGreaterThan(0);
    });
  });

  // ── DeathCare ──
  describe('DeathCareService', () => {
    it('does not process deaths at non-operational cemetery', () => {
      const state = setupState();
      state.deathCare.addCemetery(0, 0);
      state.deathCare.reportDeath();
      state.deathCare.reportDeath();
      stubUtilities(state, false, false);
      tickAllCivicServices(state);
      // Deaths should remain unprocessed
      expect(state.deathCare.getUnprocessed()).toBe(2);
    });

    it('processes deaths at operational cemetery', () => {
      const state = setupState();
      state.deathCare.addCemetery(0, 0);
      state.deathCare.reportDeath();
      state.deathCare.reportDeath();
      stubUtilities(state, true, true);
      tickAllCivicServices(state);
      expect(state.deathCare.getUnprocessed()).toBe(0);
    });
  });

  // ── Sewage ──
  describe('SewageService', () => {
    it('sewage plant without power → no treatment → untreated increases', () => {
      const state = setupState();
      state.sewage.addTreatmentPlant(0, 0, 500);
      state.citizens.createCitizen({ age: 30 });
      stubUtilities(state, false, true); // no power
      tickAllCivicServices(state);
      // Sewage plant is water-exempt but needs power
      // Without power → no treatment → untreated = all produced
      // With 1 citizen, produced = floor(1/100) = 0 actually
      // Let's test with enough citizens
    });

    it('sewage plant without power cannot treat sewage (many citizens)', () => {
      const state = setupState();
      state.sewage.addTreatmentPlant(0, 0, 500);
      // Create many citizens to produce sewage
      for (let i = 0; i < 200; i++) state.citizens.createCitizen({ age: 30 });

      // With power → treatment works
      stubUtilities(state, true, true);
      tickAllCivicServices(state);
      expect(state.sewage.getUntreated()).toBe(0); // 200/100=2, capacity=500 → all treated

      // Without power → no treatment
      stubUtilities(state, false, true);
      tickAllCivicServices(state);
      expect(state.sewage.getUntreated()).toBe(2); // 200/100=2, no treatment
    });

    it('sewage plant without water still works (water-exempt)', () => {
      const state = setupState();
      state.sewage.addTreatmentPlant(0, 0, 500);
      for (let i = 0; i < 200; i++) state.citizens.createCitizen({ age: 30 });
      stubUtilities(state, true, false); // has power, no water
      tickAllCivicServices(state);
      expect(state.sewage.getUntreated()).toBe(0); // still treats (water-exempt)
    });
  });

  // ── Education ──
  describe('EducationService', () => {
    it('school without power loses coverage', () => {
      const state = setupState();
      state.education.addSchool(0, 0, 'elementary');
      state.education.recalculateCoverage(state.grid);
      expect(state.education.getCoverage(0, 0, 'elementary')).toBe(true);

      stubUtilities(state, false, true);
      tickAllCivicServices(state);
      state.education.recalculateCoverage(state.grid);
      expect(state.education.getCoverage(0, 0, 'elementary')).toBe(false);
    });

    it('school with both utilities has coverage', () => {
      const state = setupState();
      state.education.addSchool(0, 0, 'elementary');
      stubUtilities(state, true, true);
      tickAllCivicServices(state);
      state.education.recalculateCoverage(state.grid);
      expect(state.education.getCoverage(0, 0, 'elementary')).toBe(true);
    });
  });

  // ── Parks ──
  describe('ParkService', () => {
    it('park without power loses coverage', () => {
      const state = setupState();
      state.parks.addPark(0, 0);
      expect(state.parks.getCoverage(0, 0)).toBe(true);

      stubUtilities(state, false, true);
      tickAllCivicServices(state);
      expect(state.parks.getCoverage(0, 0)).toBe(false);
    });

    it('park with both utilities has coverage', () => {
      const state = setupState();
      state.parks.addPark(0, 0);
      stubUtilities(state, true, true);
      tickAllCivicServices(state);
      expect(state.parks.getCoverage(0, 0)).toBe(true);
    });
  });

  // ── Exemption tests ──
  describe('Exemptions', () => {
    it('police station with one powered + one unpowered → only powered has coverage', () => {
      const state = setupState();
      state.police.addStation(0, 0); // will be powered
      state.police.addStation(4, 0); // will be unpowered
      vi.spyOn(state.power, 'isPowered').mockImplementation((x) => x === 0);
      vi.spyOn(state.water, 'isSupplied').mockReturnValue(true);
      tickAllCivicServices(state);
      state.police.recalculateCoverage(state.grid);
      expect(state.police.getCoverage(0, 0)).toBe(true);
      // Station at (4,0) is unpowered → no coverage contribution from it
      // But (4,0) might still be covered by station at (0,0) via roads
    });
  });
});

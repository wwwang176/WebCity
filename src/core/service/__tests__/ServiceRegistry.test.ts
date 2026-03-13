import { describe, it, expect } from 'vitest';
import { getTotalServiceMaintenanceCost, getCivicServices } from '../ServiceRegistry';
import { createGameState } from '../../simulation/GameState';

describe('ServiceRegistry', () => {
  describe('getCivicServices', () => {
    it('returns all 10 civic services', () => {
      const state = createGameState(10, 10);
      const services = getCivicServices(state);
      expect(services).toHaveLength(10);
    });

    it('every returned service has getMaintenanceCost method', () => {
      const state = createGameState(10, 10);
      const services = getCivicServices(state);
      for (const svc of services) {
        expect(typeof svc.getMaintenanceCost).toBe('function');
      }
    });
  });

  describe('getTotalServiceMaintenanceCost', () => {
    it('returns 0 when all services are empty', () => {
      const state = createGameState(10, 10);
      expect(getTotalServiceMaintenanceCost(state)).toBe(0);
    });

    it('sums costs from all services that have facilities', () => {
      const state = createGameState(10, 10);
      // Add some facilities
      state.police.addStation(0, 0);      // cost: 4
      state.fire.addStation(1, 1);        // cost: 4
      state.garbage.addFacility(2, 2); // cost: 3
      // Expected sum: 4 + 4 + 3 = 11
      expect(getTotalServiceMaintenanceCost(state)).toBe(11);
    });

    it('matches the manual sum of all individual getMaintenanceCost() calls', () => {
      const state = createGameState(10, 10);
      state.power.addPlant({ x: 0, y: 0, capacity: 100, fuelType: 'coal' });
      state.water.addPlant(1, 1);
      state.police.addStation(2, 2);
      state.fire.addStation(3, 3);
      state.health.addHospital(4, 4);
      state.education.addSchool(5, 5, 'elementary');
      state.parks.addPark(6, 6);
      state.garbage.addFacility(7, 7);
      state.sewage.addTreatmentPlant(8, 8);
      state.deathCare.addCemetery(9, 9);

      const manualSum = state.power.getMaintenanceCost()
        + state.water.getMaintenanceCost()
        + state.police.getMaintenanceCost()
        + state.fire.getMaintenanceCost()
        + state.health.getMaintenanceCost()
        + state.education.getMaintenanceCost()
        + state.parks.getMaintenanceCost()
        + state.garbage.getMaintenanceCost()
        + state.sewage.getMaintenanceCost()
        + state.deathCare.getMaintenanceCost();

      expect(getTotalServiceMaintenanceCost(state)).toBe(manualSum);
    });
  });
});

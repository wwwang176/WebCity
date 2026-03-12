import { describe, it, expect, vi } from 'vitest';
import { INFRA_SERVICE_ACTIONS, type InfraServiceContext } from '../InfraServiceActions';
import type { InfraType } from '../InfraConfig';

describe('INFRA_SERVICE_ACTIONS', () => {
  it('should have place and remove actions for all infra types with services', () => {
    const serviceTypes: InfraType[] = [
      'power', 'water', 'police', 'fire', 'hospital',
      'school', 'school_high', 'school_univ',
      'park', 'garbage', 'sewage', 'cemetery',
    ];
    for (const type of serviceTypes) {
      const actions = INFRA_SERVICE_ACTIONS[type];
      expect(actions, `Missing actions for ${type}`).toBeDefined();
      expect(typeof actions!.place).toBe('function');
      expect(typeof actions!.remove).toBe('function');
    }
  });

  it('place("police") should call police.addStation', () => {
    const addStation = vi.fn();
    const ctx: InfraServiceContext = {
      power: { addPlant: vi.fn(), removePlant: vi.fn() },
      water: { addPlant: vi.fn(), removePlant: vi.fn() },
      police: { addStation, removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
      fire: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
      health: { addHospital: vi.fn(), removeHospital: vi.fn(), getHospitals: vi.fn().mockReturnValue([]) },
      education: { addSchool: vi.fn(), removeSchool: vi.fn(), getSchools: vi.fn().mockReturnValue([]) },
      parks: { addPark: vi.fn(), removePark: vi.fn(), getParks: vi.fn().mockReturnValue([]) },
      garbage: { addFacility: vi.fn(), removeFacility: vi.fn(), getFacilities: vi.fn().mockReturnValue([]) },
      sewage: { addTreatmentPlant: vi.fn(), removeTreatmentPlant: vi.fn(), getTreatmentPlants: vi.fn().mockReturnValue([]) },
      deathCare: { addCemetery: vi.fn(), removeCemetery: vi.fn(), getCemeteries: vi.fn().mockReturnValue([]) },
    };
    INFRA_SERVICE_ACTIONS.police!.place(ctx, 5, 10);
    expect(addStation).toHaveBeenCalledWith(5, 10);
  });

  it('remove("police") should find and remove station by coordinates', () => {
    const removeStation = vi.fn();
    const ctx: InfraServiceContext = {
      power: { addPlant: vi.fn(), removePlant: vi.fn() },
      water: { addPlant: vi.fn(), removePlant: vi.fn() },
      police: { addStation: vi.fn(), removeStation, getStations: vi.fn().mockReturnValue([{ id: 42, x: 5, y: 10 }]) },
      fire: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
      health: { addHospital: vi.fn(), removeHospital: vi.fn(), getHospitals: vi.fn().mockReturnValue([]) },
      education: { addSchool: vi.fn(), removeSchool: vi.fn(), getSchools: vi.fn().mockReturnValue([]) },
      parks: { addPark: vi.fn(), removePark: vi.fn(), getParks: vi.fn().mockReturnValue([]) },
      garbage: { addFacility: vi.fn(), removeFacility: vi.fn(), getFacilities: vi.fn().mockReturnValue([]) },
      sewage: { addTreatmentPlant: vi.fn(), removeTreatmentPlant: vi.fn(), getTreatmentPlants: vi.fn().mockReturnValue([]) },
      deathCare: { addCemetery: vi.fn(), removeCemetery: vi.fn(), getCemeteries: vi.fn().mockReturnValue([]) },
    };
    INFRA_SERVICE_ACTIONS.police!.remove(ctx, 5, 10);
    expect(removeStation).toHaveBeenCalledWith(42);
  });

  it('remove should do nothing if station not found at coordinates', () => {
    const removeStation = vi.fn();
    const ctx: InfraServiceContext = {
      power: { addPlant: vi.fn(), removePlant: vi.fn() },
      water: { addPlant: vi.fn(), removePlant: vi.fn() },
      police: { addStation: vi.fn(), removeStation, getStations: vi.fn().mockReturnValue([{ id: 1, x: 0, y: 0 }]) },
      fire: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
      health: { addHospital: vi.fn(), removeHospital: vi.fn(), getHospitals: vi.fn().mockReturnValue([]) },
      education: { addSchool: vi.fn(), removeSchool: vi.fn(), getSchools: vi.fn().mockReturnValue([]) },
      parks: { addPark: vi.fn(), removePark: vi.fn(), getParks: vi.fn().mockReturnValue([]) },
      garbage: { addFacility: vi.fn(), removeFacility: vi.fn(), getFacilities: vi.fn().mockReturnValue([]) },
      sewage: { addTreatmentPlant: vi.fn(), removeTreatmentPlant: vi.fn(), getTreatmentPlants: vi.fn().mockReturnValue([]) },
      deathCare: { addCemetery: vi.fn(), removeCemetery: vi.fn(), getCemeteries: vi.fn().mockReturnValue([]) },
    };
    INFRA_SERVICE_ACTIONS.police!.remove(ctx, 99, 99);
    expect(removeStation).not.toHaveBeenCalled();
  });

  it('place("power") should call power.addPlant with default params', () => {
    const addPlant = vi.fn();
    const ctx: InfraServiceContext = {
      power: { addPlant, removePlant: vi.fn() },
      water: { addPlant: vi.fn(), removePlant: vi.fn() },
      police: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
      fire: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
      health: { addHospital: vi.fn(), removeHospital: vi.fn(), getHospitals: vi.fn().mockReturnValue([]) },
      education: { addSchool: vi.fn(), removeSchool: vi.fn(), getSchools: vi.fn().mockReturnValue([]) },
      parks: { addPark: vi.fn(), removePark: vi.fn(), getParks: vi.fn().mockReturnValue([]) },
      garbage: { addFacility: vi.fn(), removeFacility: vi.fn(), getFacilities: vi.fn().mockReturnValue([]) },
      sewage: { addTreatmentPlant: vi.fn(), removeTreatmentPlant: vi.fn(), getTreatmentPlants: vi.fn().mockReturnValue([]) },
      deathCare: { addCemetery: vi.fn(), removeCemetery: vi.fn(), getCemeteries: vi.fn().mockReturnValue([]) },
    };
    INFRA_SERVICE_ACTIONS.power!.place(ctx, 3, 7);
    expect(addPlant).toHaveBeenCalledWith({ x: 3, y: 7, output: 500, pollution: 10, type: 'coal' });
  });

  it('should have actions for all 3 school types', () => {
    for (const type of ['school', 'school_high', 'school_univ'] as InfraType[]) {
      expect(INFRA_SERVICE_ACTIONS[type]).toBeDefined();
    }
  });
});

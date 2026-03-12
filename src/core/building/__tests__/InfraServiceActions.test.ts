import { describe, it, expect, vi } from 'vitest';
import { INFRA_SERVICE_ACTIONS, type InfraServiceContext } from '../InfraServiceActions';
import type { InfraType } from '../InfraConfig';

describe('INFRA_SERVICE_ACTIONS', () => {
  it('should have place and remove actions for all infra types with services', () => {
    const serviceTypes: InfraType[] = [
      'power', 'water', 'police', 'fire', 'hospital',
      'school', 'school_high', 'school_univ',
      'park', 'garbage', 'sewage', 'cemetery',
      'bus_stop', 'metro_station', 'train_station', 'ferry_dock',
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

  it('place("bus_stop") should call bus.addStop', () => {
    const addStop = vi.fn();
    const ctx = makeMinimalCtx();
    ctx.bus = { addStop, removeStop: vi.fn(), getStops: vi.fn().mockReturnValue([]) };
    INFRA_SERVICE_ACTIONS.bus_stop!.place(ctx, 4, 6);
    expect(addStop).toHaveBeenCalledWith(4, 6);
  });

  it('remove("metro_station") should find and remove station by coordinates', () => {
    const removeStation = vi.fn();
    const ctx = makeMinimalCtx();
    ctx.metro = { addStation: vi.fn(), removeStation, getStations: vi.fn().mockReturnValue([{ id: 7, x: 3, y: 5 }]) };
    INFRA_SERVICE_ACTIONS.metro_station!.remove(ctx, 3, 5);
    expect(removeStation).toHaveBeenCalledWith(7);
  });

  it('should have actions for all 4 transport stop types', () => {
    for (const type of ['bus_stop', 'metro_station', 'train_station', 'ferry_dock'] as InfraType[]) {
      expect(INFRA_SERVICE_ACTIONS[type]).toBeDefined();
    }
  });

  it('should have airport actions', () => {
    expect(INFRA_SERVICE_ACTIONS.airport).toBeDefined();
    expect(typeof INFRA_SERVICE_ACTIONS.airport!.place).toBe('function');
    expect(typeof INFRA_SERVICE_ACTIONS.airport!.remove).toBe('function');
  });

  it('remove("airport") should call airport.demolishAtCell with grid clearing callback', () => {
    const demolishAtCell = vi.fn();
    const ctx = makeMinimalCtx();
    ctx.airport = { demolishAtCell };
    INFRA_SERVICE_ACTIONS.airport!.remove(ctx, 5, 5);
    expect(demolishAtCell).toHaveBeenCalledWith(5, 5, expect.any(Function));
  });

  it('remove("airport") clearCell callback should clear matching airport cells', () => {
    let clearCellFn: ((cx: number, cy: number) => void) | undefined;
    const demolishAtCell = vi.fn((_x: number, _y: number, fn: (cx: number, cy: number) => void) => {
      clearCellFn = fn;
      return true;
    });
    const setCell = vi.fn();
    const ctx = makeMinimalCtx();
    ctx.airport = { demolishAtCell };
    // airport buildingId = 237 (from InfraConfig)
    ctx.grid = {
      getCell: vi.fn().mockReturnValue({ buildingId: 237 }),
      setCell,
    };
    INFRA_SERVICE_ACTIONS.airport!.remove(ctx, 5, 5);
    expect(clearCellFn).toBeDefined();
    clearCellFn!(3, 4);
    expect(setCell).toHaveBeenCalledWith(3, 4, { buildingId: 0, reserved: 0 });
  });
});

/** Helper: create a minimal InfraServiceContext with all fields mocked. */
function makeMinimalCtx(): InfraServiceContext {
  return {
    power: { addPlant: vi.fn(), removePlant: vi.fn() },
    water: { addPlant: vi.fn(), removePlant: vi.fn() },
    police: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
    fire: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
    health: { addHospital: vi.fn(), removeHospital: vi.fn(), getHospitals: vi.fn().mockReturnValue([]) },
    education: { addSchool: vi.fn(), removeSchool: vi.fn(), getSchools: vi.fn().mockReturnValue([]) },
    parks: { addPark: vi.fn(), removePark: vi.fn(), getParks: vi.fn().mockReturnValue([]) },
    garbage: { addFacility: vi.fn(), removeFacility: vi.fn(), getFacilities: vi.fn().mockReturnValue([]) },
    sewage: { addTreatmentPlant: vi.fn(), removeTreatmentPlant: vi.fn(), getTreatmentPlants: vi.fn().mockReturnValue([]) },
    deathCare: { addCemetery: vi.fn(), removeCemetery: vi.fn(), getCemeteries: vi.fn().mockReturnValue([]) },
    bus: { addStop: vi.fn(), removeStop: vi.fn(), getStops: vi.fn().mockReturnValue([]) },
    metro: { addStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
    rail: { buildStation: vi.fn(), removeStation: vi.fn(), getStations: vi.fn().mockReturnValue([]) },
    ferry: { addDock: vi.fn(), removeDock: vi.fn(), getDocks: vi.fn().mockReturnValue([]) },
    airport: { demolishAtCell: vi.fn() },
    grid: { getCell: vi.fn().mockReturnValue(null), setCell: vi.fn() },
  };
}

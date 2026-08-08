import { describe, it, expect } from 'vitest';
import { PoliceService } from '../PoliceService';
import { HealthService } from '../HealthService';
import { EducationService } from '../EducationService';
import { ParkService } from '../ParkService';
import { DeathCareService } from '../DeathCareService';
import { GarbageService } from '../GarbageService';
import { DistrictManager } from '../../district/DistrictManager';
import { CitizenManager } from '../../citizen/CitizenManager';

/**
 * Verify that each service instance generates IDs independently.
 * Module-level nextId counters leaked state between instances, causing
 * non-deterministic IDs depending on test execution order.
 * After refactoring to instance-level counters, each new instance starts at 1.
 */
describe('Service ID isolation (instance-level counters)', () => {
  it('PoliceService: new instances start with _1 IDs', () => {
    const a = new PoliceService();
    const b = new PoliceService();
    const idA = a.addStation(0, 0);
    const idB = b.addStation(0, 0);
    expect(idA).toBe('police_1');
    expect(idB).toBe('police_1');
  });

  it('HealthService: new instances start with _1 IDs', () => {
    const a = new HealthService();
    const b = new HealthService();
    const idA = a.addHospital(0, 0);
    const idB = b.addHospital(0, 0);
    expect(idA).toBe('hospital_1');
    expect(idB).toBe('hospital_1');
  });

  it('EducationService: new instances start with _1 IDs', () => {
    const a = new EducationService();
    const b = new EducationService();
    const idA = a.addSchool(0, 0, 'elementary');
    const idB = b.addSchool(0, 0, 'elementary');
    expect(idA).toBe('elem-1');
    expect(idB).toBe('elem-1');
  });

  it('ParkService: new instances start with _1 IDs', () => {
    const a = new ParkService();
    const b = new ParkService();
    const idA = a.addPark(0, 0);
    const idB = b.addPark(0, 0);
    expect(idA).toBe('park-1');
    expect(idB).toBe('park-1');
  });

  it('DeathCareService: new instances start with _1 IDs', () => {
    const a = new DeathCareService();
    const b = new DeathCareService();
    const idA = a.addCemetery(0, 0);
    const idB = b.addCemetery(0, 0);
    expect(idA).toBe('cem-1');
    expect(idB).toBe('cem-1');
  });

  it('GarbageService: new instances start with _1 IDs', () => {
    const a = new GarbageService();
    const b = new GarbageService();
    const idA = a.addFacility(0, 0);
    const idB = b.addFacility(0, 0);
    expect(idA).toBe('garbage_1');
    expect(idB).toBe('garbage_1');
  });

  it('DistrictManager: new instances start with _1 IDs', () => {
    const a = new DistrictManager();
    const b = new DistrictManager();
    const dA = a.createDistrict('A');
    const dB = b.createDistrict('B');
    expect(dA.id).toBe('district_1');
    expect(dB.id).toBe('district_1');
  });

  it('CitizenManager: new instances start with ID 1', () => {
    const a = new CitizenManager();
    const b = new CitizenManager();
    const cA = a.createCitizen()!;
    const cB = b.createCitizen()!;
    expect(cA.id).toBe(1);
    expect(cB.id).toBe(1);
  });
});

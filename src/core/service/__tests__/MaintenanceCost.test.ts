import { describe, it, expect } from 'vitest';
import { PoliceService } from '../PoliceService';
import { FireService } from '../FireService';
import { HealthService } from '../HealthService';
import { EducationService } from '../EducationService';
import { ParkService } from '../ParkService';
import { GarbageService } from '../GarbageService';
import { SewageService } from '../SewageService';
import { DeathCareService } from '../DeathCareService';
import { PowerGrid } from '../PowerGrid';
import { WaterNetwork } from '../WaterNetwork';
import type { CivicService } from '../CivicService';

describe('CivicService.getMaintenanceCost()', () => {
  describe('PoliceService', () => {
    it('should return 0 when no stations', () => {
      const svc = new PoliceService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 4 per station', () => {
      const svc = new PoliceService();
      svc.addStation(5, 5);
      expect(svc.getMaintenanceCost()).toBe(4);
      svc.addStation(10, 10);
      expect(svc.getMaintenanceCost()).toBe(8);
    });
  });

  describe('FireService', () => {
    it('should return 0 when no stations', () => {
      const svc = new FireService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 4 per station', () => {
      const svc = new FireService();
      svc.addStation(5, 5);
      expect(svc.getMaintenanceCost()).toBe(4);
      svc.addStation(10, 10);
      expect(svc.getMaintenanceCost()).toBe(8);
    });
  });

  describe('HealthService', () => {
    it('should return 0 when no hospitals', () => {
      const svc = new HealthService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 8 per hospital', () => {
      const svc = new HealthService();
      svc.addHospital(5, 5);
      expect(svc.getMaintenanceCost()).toBe(8);
      svc.addHospital(10, 10);
      expect(svc.getMaintenanceCost()).toBe(16);
    });
  });

  describe('EducationService', () => {
    it('should return 0 when no schools', () => {
      const svc = new EducationService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 5 per school', () => {
      const svc = new EducationService();
      svc.addSchool(5, 5, 'elementary');
      expect(svc.getMaintenanceCost()).toBe(5);
      svc.addSchool(10, 10, 'university');
      expect(svc.getMaintenanceCost()).toBe(10);
    });
  });

  describe('ParkService', () => {
    it('should return 0 when no parks', () => {
      const svc = new ParkService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 2 per park', () => {
      const svc = new ParkService();
      svc.addPark(5, 5);
      expect(svc.getMaintenanceCost()).toBe(2);
      svc.addPark(10, 10);
      expect(svc.getMaintenanceCost()).toBe(4);
    });
  });

  describe('GarbageService', () => {
    it('should return 0 when no facilities', () => {
      const svc = new GarbageService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 3 per facility', () => {
      const svc = new GarbageService();
      svc.addFacility(5, 5, 'landfill');
      expect(svc.getMaintenanceCost()).toBe(3);
      svc.addFacility(10, 10, 'incinerator');
      expect(svc.getMaintenanceCost()).toBe(6);
    });
  });

  describe('SewageService', () => {
    it('should return 0 when no treatment plants', () => {
      const svc = new SewageService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 4 per treatment plant', () => {
      const svc = new SewageService();
      svc.addTreatmentPlant(5, 5);
      expect(svc.getMaintenanceCost()).toBe(4);
      svc.addTreatmentPlant(10, 10);
      expect(svc.getMaintenanceCost()).toBe(8);
    });
  });

  describe('DeathCareService', () => {
    it('should return 0 when no facilities', () => {
      const svc = new DeathCareService();
      expect(svc.getMaintenanceCost()).toBe(0);
    });

    it('should return 2 per cemetery and crematorium', () => {
      const svc = new DeathCareService();
      svc.addCemetery(5, 5);
      expect(svc.getMaintenanceCost()).toBe(2);
      svc.addCrematorium(10, 10);
      expect(svc.getMaintenanceCost()).toBe(4);
    });
  });

  describe('PowerGrid', () => {
    it('should return 0 when no plants', () => {
      const power = new PowerGrid();
      expect(power.getMaintenanceCost()).toBe(0);
    });

    it('should return 5 per plant', () => {
      const power = new PowerGrid();
      power.addPlant({ x: 5, y: 5, output: 100, pollution: 0, type: 'solar' });
      expect(power.getMaintenanceCost()).toBe(5);
      power.addPlant({ x: 10, y: 10, output: 200, pollution: 0, type: 'coal' });
      expect(power.getMaintenanceCost()).toBe(10);
    });
  });

  describe('WaterNetwork', () => {
    it('should return 0 when no plants', () => {
      const water = new WaterNetwork();
      expect(water.getMaintenanceCost()).toBe(0);
    });

    it('should return 3 per plant', () => {
      const water = new WaterNetwork();
      water.addPlant({ x: 5, y: 5, output: 100 });
      expect(water.getMaintenanceCost()).toBe(3);
      water.addPlant({ x: 10, y: 10, output: 200 });
      expect(water.getMaintenanceCost()).toBe(6);
    });
  });

  describe('CivicService interface compliance', () => {
    const services: { name: string; instance: CivicService }[] = [
      { name: 'PoliceService', instance: new PoliceService() },
      { name: 'FireService', instance: new FireService() },
      { name: 'HealthService', instance: new HealthService() },
      { name: 'EducationService', instance: new EducationService() },
      { name: 'ParkService', instance: new ParkService() },
      { name: 'GarbageService', instance: new GarbageService() },
      { name: 'SewageService', instance: new SewageService() },
      { name: 'DeathCareService', instance: new DeathCareService() },
    ];

    for (const { name, instance } of services) {
      it(`${name} should implement CivicService interface`, () => {
        expect(typeof instance.tick).toBe('function');
        expect(typeof instance.getMaintenanceCost).toBe('function');
        expect(typeof instance.toJSON).toBe('function');
        expect(instance.getMaintenanceCost()).toBe(0);
      });
    }
  });
});

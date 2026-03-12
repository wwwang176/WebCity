import { describe, it, expect } from 'vitest';
import { classifyBuilding } from '../BuildingClassifier';
import { getInfraBuildingId } from '../InfraConfig';

describe('classifyBuilding', () => {
  it('should classify zone buildings as "zone"', () => {
    // buildingId 1-100 are zone buildings (residential, commercial, industrial, office)
    const result = classifyBuilding(1);
    expect(result.category).toBe('zone');
    if (result.category === 'zone') {
      expect(result.buildingType).toBeDefined();
      expect(result.buildingType.id).toBe(1);
    }
  });

  it('should classify transport stops as "transport"', () => {
    const busStopId = getInfraBuildingId('bus_stop');
    const result = classifyBuilding(busStopId);
    expect(result.category).toBe('transport');
    if (result.category === 'transport') {
      expect(result.transportType).toBe('bus');
    }
  });

  it('should classify metro station as "transport"', () => {
    const metroId = getInfraBuildingId('metro_station');
    const result = classifyBuilding(metroId);
    expect(result.category).toBe('transport');
    if (result.category === 'transport') {
      expect(result.transportType).toBe('metro');
    }
  });

  it('should classify train station as "transport"', () => {
    const trainId = getInfraBuildingId('train_station');
    const result = classifyBuilding(trainId);
    expect(result.category).toBe('transport');
    if (result.category === 'transport') {
      expect(result.transportType).toBe('rail');
    }
  });

  it('should classify ferry dock as "transport"', () => {
    const ferryId = getInfraBuildingId('ferry_dock');
    const result = classifyBuilding(ferryId);
    expect(result.category).toBe('transport');
    if (result.category === 'transport') {
      expect(result.transportType).toBe('ferry');
    }
  });

  it('should classify infrastructure buildings as "infra"', () => {
    const policeId = getInfraBuildingId('police');
    const result = classifyBuilding(policeId);
    expect(result.category).toBe('infra');
    if (result.category === 'infra') {
      expect(result.config.type).toBe('police');
    }
  });

  it('should classify power plant as "infra"', () => {
    const powerId = getInfraBuildingId('power');
    const result = classifyBuilding(powerId);
    expect(result.category).toBe('infra');
    if (result.category === 'infra') {
      expect(result.config.type).toBe('power');
    }
  });

  it('should return "unknown" for buildingId 0', () => {
    expect(classifyBuilding(0).category).toBe('unknown');
  });

  it('should return "unknown" for unrecognized buildingId', () => {
    expect(classifyBuilding(9999).category).toBe('unknown');
  });
});

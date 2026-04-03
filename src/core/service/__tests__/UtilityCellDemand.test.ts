import { describe, it, expect } from 'vitest';
import { calculateUtilityCellDemand, type UtilityCellDemandConfig } from '../UtilityCellDemand';
import { ZoneType } from '../../grid/types';

describe('calculateUtilityCellDemand', () => {
  const config: UtilityCellDemandConfig = {
    zoneConsumption: {
      RESIDENTIAL: { base: 1, perCapita: 0.1 },
      COMMERCIAL: { base: 2, perCapita: 0.2 },
      INDUSTRIAL: { base: 3, perCapita: 0.3 },
      OFFICE: { base: 1.5, perCapita: 0.15 },
    },
    infraConsumption: {
      police: 5,
      fire: 5,
    },
    infraTypeToKey: {
      police: 'police',
      fire: 'fire',
    },
    excludedBuildingId: 254, // power plant
  };

  it('returns 0 for empty cell', () => {
    expect(calculateUtilityCellDemand(config, 0, ZoneType.NONE, 0, 0)).toBe(0);
  });

  it('calculates zone demand for residential building', () => {
    // buildingId=1 is a zone building (Tiny House: residents=2, workers=0)
    const demand = calculateUtilityCellDemand(config, 1, ZoneType.RESIDENTIAL_LOW, 2, 0);
    // base + perCapita * residents = 1 + 0.1 * 2 = 1.2
    expect(demand).toBeCloseTo(1.2);
  });

  it('calculates zone demand for industrial building', () => {
    const demand = calculateUtilityCellDemand(config, 13, ZoneType.INDUSTRIAL, 0, 5);
    // base + perCapita * workers = 3 + 0.3 * 5 = 4.5
    expect(demand).toBeCloseTo(4.5);
  });

  it('returns 0 for excluded building (e.g. power plant)', () => {
    expect(calculateUtilityCellDemand(config, 254, ZoneType.NONE, 0, 0)).toBe(0);
  });

  it('returns infra consumption for infrastructure building', () => {
    // buildingId 252 is police station, infraType='police'
    const demand = calculateUtilityCellDemand(config, 252, ZoneType.NONE, 0, 0);
    expect(demand).toBe(5);
  });

  it('returns 0 for unknown infrastructure', () => {
    // buildingId with no matching infra key
    const configNoKeys: UtilityCellDemandConfig = {
      ...config,
      infraConsumption: {},
      infraTypeToKey: {},
    };
    expect(calculateUtilityCellDemand(configNoKeys, 252, ZoneType.NONE, 0, 0)).toBe(0);
  });
});

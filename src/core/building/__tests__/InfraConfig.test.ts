import { describe, it, expect } from 'vitest';
import {
  INFRA_CONFIGS,
  getInfraConfig,
  getInfraConfigById,
  type InfraType,
  type Rotation,
  getRotatedSize,
} from '../InfraConfig';

describe('InfraConfig', () => {
  const ALL_TYPES: InfraType[] = [
    'park', 'police', 'fire', 'school', 'power', 'water',
    'garbage', 'sewage', 'cemetery', 'hospital', 'school_high',
    'school_univ', 'airport',
  ];

  it('should have config for every infrastructure type', () => {
    for (const type of ALL_TYPES) {
      const config = getInfraConfig(type);
      expect(config).toBeDefined();
      expect(config!.type).toBe(type);
    }
  });

  it('should return undefined for unknown type', () => {
    const config = getInfraConfig('unknown' as InfraType);
    expect(config).toBeUndefined();
  });

  it('should have correct buildingId for each type', () => {
    expect(getInfraConfig('power')!.buildingId).toBe(254);
    expect(getInfraConfig('water')!.buildingId).toBe(253);
    expect(getInfraConfig('police')!.buildingId).toBe(252);
    expect(getInfraConfig('fire')!.buildingId).toBe(251);
    expect(getInfraConfig('hospital')!.buildingId).toBe(250);
    expect(getInfraConfig('school')!.buildingId).toBe(249);
    expect(getInfraConfig('park')!.buildingId).toBe(248);
    expect(getInfraConfig('garbage')!.buildingId).toBe(247);
    expect(getInfraConfig('sewage')!.buildingId).toBe(246);
    expect(getInfraConfig('cemetery')!.buildingId).toBe(245);
    expect(getInfraConfig('school_high')!.buildingId).toBe(244);
    expect(getInfraConfig('school_univ')!.buildingId).toBe(243);
    expect(getInfraConfig('airport')!.buildingId).toBe(237);
  });

  it('should have correct dimensions', () => {
    // 1x1
    expect(getInfraConfig('park')!.width).toBe(1);
    expect(getInfraConfig('park')!.height).toBe(1);

    // 2x2
    for (const type of ['police', 'fire', 'school', 'power', 'water', 'garbage', 'sewage', 'cemetery'] as InfraType[]) {
      const cfg = getInfraConfig(type)!;
      expect(cfg.width).toBe(2);
      expect(cfg.height).toBe(2);
    }

    // 2x3
    expect(getInfraConfig('hospital')!.width).toBe(2);
    expect(getInfraConfig('hospital')!.height).toBe(3);
    expect(getInfraConfig('school_high')!.width).toBe(2);
    expect(getInfraConfig('school_high')!.height).toBe(3);

    // 3x3
    expect(getInfraConfig('school_univ')!.width).toBe(3);
    expect(getInfraConfig('school_univ')!.height).toBe(3);

    // 4x4
    expect(getInfraConfig('airport')!.width).toBe(4);
    expect(getInfraConfig('airport')!.height).toBe(4);
  });

  it('should have correct costs', () => {
    expect(getInfraConfig('park')!.cost).toBe(200);
    expect(getInfraConfig('police')!.cost).toBe(800);
    expect(getInfraConfig('fire')!.cost).toBe(800);
    expect(getInfraConfig('school')!.cost).toBe(800);
    expect(getInfraConfig('power')!.cost).toBe(1000);
    expect(getInfraConfig('water')!.cost).toBe(600);
    expect(getInfraConfig('garbage')!.cost).toBe(800);
    expect(getInfraConfig('sewage')!.cost).toBe(800);
    expect(getInfraConfig('cemetery')!.cost).toBe(600);
    expect(getInfraConfig('hospital')!.cost).toBe(1600);
    expect(getInfraConfig('school_high')!.cost).toBe(1200);
    expect(getInfraConfig('school_univ')!.cost).toBe(3000);
  });

  it('should have positive width, height, and cost', () => {
    for (const config of INFRA_CONFIGS) {
      expect(config.width).toBeGreaterThan(0);
      expect(config.height).toBeGreaterThan(0);
      expect(config.cost).toBeGreaterThan(0);
    }
  });

  it('should have a name for each config', () => {
    for (const config of INFRA_CONFIGS) {
      expect(config.name).toBeTruthy();
      expect(typeof config.name).toBe('string');
    }
  });

  describe('getInfraConfigById', () => {
    it('should find config by buildingId', () => {
      expect(getInfraConfigById(254)!.type).toBe('power');
      expect(getInfraConfigById(248)!.type).toBe('park');
      expect(getInfraConfigById(243)!.type).toBe('school_univ');
      expect(getInfraConfigById(237)!.type).toBe('airport');
    });

    it('should return undefined for non-infra buildingId', () => {
      expect(getInfraConfigById(0)).toBeUndefined();
      expect(getInfraConfigById(1)).toBeUndefined();
      expect(getInfraConfigById(999)).toBeUndefined();
    });
  });

  describe('getRotatedSize', () => {
    it('should not swap dimensions for 0° and 180°', () => {
      expect(getRotatedSize(2, 3, 0)).toEqual({ w: 2, h: 3 });
      expect(getRotatedSize(2, 3, 180)).toEqual({ w: 2, h: 3 });
    });

    it('should swap dimensions for 90° and 270°', () => {
      expect(getRotatedSize(2, 3, 90)).toEqual({ w: 3, h: 2 });
      expect(getRotatedSize(2, 3, 270)).toEqual({ w: 3, h: 2 });
    });

    it('should not change square dimensions regardless of rotation', () => {
      for (const rot of [0, 90, 180, 270] as Rotation[]) {
        expect(getRotatedSize(3, 3, rot)).toEqual({ w: 3, h: 3 });
      }
    });
  });

  it('should have all INFRA_CONFIGS entries with unique buildingIds', () => {
    const ids = INFRA_CONFIGS.map(c => c.buildingId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have all INFRA_CONFIGS entries with unique types', () => {
    const types = INFRA_CONFIGS.map(c => c.type);
    const uniqueTypes = new Set(types);
    expect(uniqueTypes.size).toBe(types.length);
  });
});

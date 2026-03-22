import { describe, it, expect, beforeEach } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager, POLICY_CONFIG, POLICY_ZONE_RESTRICTIONS } from '../PolicyManager';
import type { DistrictLookup } from '../PolicyManager';
import { setSpecialization, getSpecialization, getSpecializationBonus, SPECIALIZATION_BONUSES } from '../Specialization';
import { CitySpecialization, CitySpecType } from '../CitySpecialization';
import { PolicyType, Specialization, type District } from '../types';
import { ZoneType } from '../../grid/types';

describe('DistrictManager', () => {
  let dm: DistrictManager;

  beforeEach(() => {
    dm = new DistrictManager();
  });

  it('should create a district with a name', () => {
    const district = dm.createDistrict('Downtown');
    expect(district.id).toBeDefined();
    expect(district.name).toBe('Downtown');
    expect(district.cells.size).toBe(0);
    expect(district.policies).toEqual([]);
  });

  it('should add cells to a district', () => {
    const district = dm.createDistrict('Suburbs');
    dm.addCellToDistrict(district.id, 3, 5);
    dm.addCellToDistrict(district.id, 4, 5);
    const updated = dm.getDistrict(district.id);
    expect(updated!.cells.size).toBe(2);
    expect(updated!.cells.has('3,5')).toBe(true);
    expect(updated!.cells.has('4,5')).toBe(true);
  });

  it('should remove cells from a district', () => {
    const district = dm.createDistrict('Suburbs');
    dm.addCellToDistrict(district.id, 3, 5);
    dm.addCellToDistrict(district.id, 4, 5);
    dm.removeCellFromDistrict(district.id, 3, 5);
    const updated = dm.getDistrict(district.id);
    expect(updated!.cells.size).toBe(1);
    expect(updated!.cells.has('3,5')).toBe(false);
  });

  it('should get district at coordinate', () => {
    const d1 = dm.createDistrict('Zone A');
    dm.addCellToDistrict(d1.id, 1, 1);
    dm.addCellToDistrict(d1.id, 1, 2);

    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d2.id, 5, 5);

    expect(dm.getDistrictAt(1, 1)?.name).toBe('Zone A');
    expect(dm.getDistrictAt(5, 5)?.name).toBe('Zone B');
    expect(dm.getDistrictAt(9, 9)).toBeNull();
  });

  it('should rename a district', () => {
    const district = dm.createDistrict('Old Name');
    dm.renameDistrict(district.id, 'New Name');
    expect(dm.getDistrict(district.id)!.name).toBe('New Name');
  });

  it('should merge two districts', () => {
    const d1 = dm.createDistrict('Zone A');
    dm.addCellToDistrict(d1.id, 1, 1);
    dm.addCellToDistrict(d1.id, 1, 2);

    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d2.id, 3, 3);
    dm.addCellToDistrict(d2.id, 4, 4);

    const merged = dm.mergeDistricts(d1.id, d2.id);
    expect(merged.cells.size).toBe(4);
    expect(merged.cells.has('1,1')).toBe(true);
    expect(merged.cells.has('3,3')).toBe(true);
    // Second district should be removed
    expect(dm.getDistrict(d2.id)).toBeUndefined();
    // Merged keeps first district's name
    expect(merged.name).toBe('Zone A');
  });

  it('adding a cell to one district should remove it from others', () => {
    const d1 = dm.createDistrict('Zone A');
    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d1.id, 5, 5);
    expect(dm.getDistrictAt(5, 5)?.id).toBe(d1.id);

    // Move cell from d1 to d2
    dm.addCellToDistrict(d2.id, 5, 5);
    expect(dm.getDistrictAt(5, 5)?.id).toBe(d2.id);
    expect(dm.getDistrict(d1.id)!.cells.has('5,5')).toBe(false);
  });

  it('getDistrictAt returns null after cell removed', () => {
    const d = dm.createDistrict('Zone');
    dm.addCellToDistrict(d.id, 3, 3);
    expect(dm.getDistrictAt(3, 3)).not.toBeNull();
    dm.removeCellFromDistrict(d.id, 3, 3);
    expect(dm.getDistrictAt(3, 3)).toBeNull();
  });

  it('getDistrictAt returns correct district after merge', () => {
    const d1 = dm.createDistrict('Zone A');
    const d2 = dm.createDistrict('Zone B');
    dm.addCellToDistrict(d1.id, 1, 1);
    dm.addCellToDistrict(d2.id, 2, 2);
    dm.mergeDistricts(d1.id, d2.id);
    expect(dm.getDistrictAt(2, 2)?.id).toBe(d1.id);
  });

  it('getDistrictAt returns correct district after split', () => {
    const d = dm.createDistrict('Big');
    dm.addCellToDistrict(d.id, 1, 1);
    dm.addCellToDistrict(d.id, 2, 2);
    const split = dm.splitDistrict(d.id, new Set(['2,2']));
    expect(dm.getDistrictAt(1, 1)?.id).toBe(d.id);
    expect(dm.getDistrictAt(2, 2)?.id).toBe(split.id);
  });

  it('should split a district into two', () => {
    const d = dm.createDistrict('Big Zone');
    dm.addCellToDistrict(d.id, 0, 0);
    dm.addCellToDistrict(d.id, 1, 1);
    dm.addCellToDistrict(d.id, 2, 2);
    dm.addCellToDistrict(d.id, 3, 3);

    const cellsForNewDistrict = new Set(['2,2', '3,3']);
    const newDistrict = dm.splitDistrict(d.id, cellsForNewDistrict);

    expect(newDistrict.cells.size).toBe(2);
    expect(newDistrict.cells.has('2,2')).toBe(true);
    expect(newDistrict.cells.has('3,3')).toBe(true);

    const original = dm.getDistrict(d.id);
    expect(original!.cells.size).toBe(2);
    expect(original!.cells.has('0,0')).toBe(true);
    expect(original!.cells.has('1,1')).toBe(true);
  });
});

describe('PolicyManager', () => {
  let dm: DistrictManager;
  let pm: PolicyManager;

  beforeEach(() => {
    dm = new DistrictManager();
    pm = new PolicyManager(dm);
  });

  it('should apply a policy to a district', () => {
    const district = dm.createDistrict('Test');
    pm.applyPolicy(district.id, PolicyType.NO_HEAVY_INDUSTRY);
    expect(pm.isPolicyActive(district.id, PolicyType.NO_HEAVY_INDUSTRY)).toBe(true);
  });

  it('should remove a policy from a district', () => {
    const district = dm.createDistrict('Test');
    pm.applyPolicy(district.id, PolicyType.ENCOURAGE_RECYCLING);
    pm.removePolicy(district.id, PolicyType.ENCOURAGE_RECYCLING);
    expect(pm.isPolicyActive(district.id, PolicyType.ENCOURAGE_RECYCLING)).toBe(false);
  });

  it('should return false for inactive policy', () => {
    const district = dm.createDistrict('Test');
    expect(pm.isPolicyActive(district.id, PolicyType.TOURISM)).toBe(false);
  });

  it('should return policy cost', () => {
    const cost = pm.getPolicyCost(PolicyType.NO_HEAVY_INDUSTRY);
    expect(cost).toBeGreaterThan(0);
  });

  it('NO_HEAVY_INDUSTRY should block industrial buildings', () => {
    const district = dm.createDistrict('Clean Zone');
    pm.applyPolicy(district.id, PolicyType.NO_HEAVY_INDUSTRY);
    expect(pm.canBuildInDistrict(district.id, ZoneType.INDUSTRIAL)).toBe(false);
    expect(pm.canBuildInDistrict(district.id, ZoneType.COMMERCIAL_LOW)).toBe(true);
  });

  it('HIGH_DENSITY_BAN should block high density zones', () => {
    const district = dm.createDistrict('Low Rise');
    pm.applyPolicy(district.id, PolicyType.HIGH_DENSITY_BAN);
    expect(pm.canBuildInDistrict(district.id, ZoneType.RESIDENTIAL_HIGH)).toBe(false);
    expect(pm.canBuildInDistrict(district.id, ZoneType.COMMERCIAL_HIGH)).toBe(false);
    expect(pm.canBuildInDistrict(district.id, ZoneType.RESIDENTIAL_LOW)).toBe(true);
    expect(pm.canBuildInDistrict(district.id, ZoneType.COMMERCIAL_LOW)).toBe(true);
  });

  it('POLICY_ZONE_RESTRICTIONS table drives canBuildInDistrict (OCP)', () => {
    const district = dm.createDistrict('Test');
    // Verify each restriction entry blocks the right zones
    for (const [policyType, blockedZones] of Object.entries(POLICY_ZONE_RESTRICTIONS)) {
      pm.applyPolicy(district.id, policyType as PolicyType);
      for (const zone of blockedZones!) {
        expect(pm.canBuildInDistrict(district.id, zone)).toBe(false);
      }
      pm.removePolicy(district.id, policyType as PolicyType);
    }
  });

  it('should get all policy costs', () => {
    for (const policyType of Object.values(PolicyType)) {
      const cost = pm.getPolicyCost(policyType);
      expect(cost).toBeTypeOf('number');
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('POLICY_CONFIG should contain name and cost for every PolicyType', () => {
    for (const policyType of Object.values(PolicyType)) {
      const cfg = POLICY_CONFIG[policyType];
      expect(cfg).toBeDefined();
      expect(cfg.name).toBeTruthy();
      expect(cfg.cost).toBeGreaterThan(0);
    }
  });

  it('separate PolicyManager instances should have independent ID counters', () => {
    const dm2 = new DistrictManager();
    const pm2 = new PolicyManager(dm2);
    const d1 = dm.createDistrict('A');
    const d2 = dm2.createDistrict('B');
    pm.applyPolicy(d1.id, PolicyType.TOURISM);
    pm2.applyPolicy(d2.id, PolicyType.TOURISM);
    // Both should start from 1 independently
    expect(d1.policies[0]!.id).toMatch(/^policy_1$/);
    expect(d2.policies[0]!.id).toMatch(/^policy_1$/);
  });

  it('should work with a mock DistrictLookup (DIP)', () => {
    const mockDistrict: District = {
      id: 'mock_1',
      name: 'Mock District',
      cells: new Set<string>(),
      policies: [],
      specialization: Specialization.NONE,
    };
    const mockLookup: DistrictLookup = {
      getDistrict: (id: string) => (id === 'mock_1' ? mockDistrict : undefined),
    };
    const mockPm = new PolicyManager(mockLookup);
    mockPm.applyPolicy('mock_1', PolicyType.TOURISM);
    expect(mockPm.isPolicyActive('mock_1', PolicyType.TOURISM)).toBe(true);
    expect(mockPm.isPolicyActive('nonexistent', PolicyType.TOURISM)).toBe(false);
  });
});

describe('Specialization', () => {
  let dm: DistrictManager;

  beforeEach(() => {
    dm = new DistrictManager();
  });

  it('should default to NONE specialization', () => {
    const district = dm.createDistrict('Default');
    expect(getSpecialization(dm, district.id)).toBe(Specialization.NONE);
  });

  it('should set specialization on a district', () => {
    const district = dm.createDistrict('Farm District');
    setSpecialization(dm, district.id, Specialization.FARMING);
    expect(getSpecialization(dm, district.id)).toBe(Specialization.FARMING);
  });

  it('should return bonuses for specializations', () => {
    const farmBonus = getSpecializationBonus(Specialization.FARMING);
    expect(farmBonus.efficiencyMultiplier).toBeGreaterThan(1);
    expect(farmBonus.revenueMultiplier).toBeGreaterThanOrEqual(1);

    const noneBonus = getSpecializationBonus(Specialization.NONE);
    expect(noneBonus.efficiencyMultiplier).toBe(1);
    expect(noneBonus.revenueMultiplier).toBe(1);
  });

  it('should provide different bonuses for different specializations', () => {
    const highTech = getSpecializationBonus(Specialization.HIGH_TECH);
    const mining = getSpecializationBonus(Specialization.MINING);
    // Both should have bonuses but they may differ
    expect(highTech.efficiencyMultiplier).toBeGreaterThan(1);
    expect(mining.efficiencyMultiplier).toBeGreaterThan(1);
  });

  it('SPECIALIZATION_BONUSES should have entry for every Specialization enum value', () => {
    const allSpecs = Object.values(Specialization).filter(v => typeof v === 'number') as Specialization[];
    for (const spec of allSpecs) {
      expect(SPECIALIZATION_BONUSES[spec]).toBeDefined();
      expect(SPECIALIZATION_BONUSES[spec].efficiencyMultiplier).toBeGreaterThanOrEqual(1);
      expect(SPECIALIZATION_BONUSES[spec].revenueMultiplier).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('CitySpecialization', () => {
  let cs: CitySpecialization;

  beforeEach(() => {
    cs = new CitySpecialization();
  });

  it('should default to NONE', () => {
    expect(cs.getCurrent()).toBe(CitySpecType.NONE);
    expect(cs.getBonus().revenueMultiplier).toBe(1);
  });

  it('should require population to choose a specialization', () => {
    expect(cs.canChoose(CitySpecType.MINING_CITY, 1000)).toBe(false);
    expect(cs.canChoose(CitySpecType.MINING_CITY, 5000)).toBe(true);
  });

  it('should fail to choose if population too low', () => {
    const result = cs.choose(CitySpecType.TECH_CITY, 2000);
    expect(result).toBe(false);
    expect(cs.getCurrent()).toBe(CitySpecType.NONE);
  });

  it('MINING_CITY: revenue boost + negative happiness + crime', () => {
    cs.choose(CitySpecType.MINING_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBeGreaterThan(1);
    expect(bonus.happinessModifier).toBeLessThan(0);
    expect(bonus.crimeModifier).toBeGreaterThan(0);
  });

  it('TECH_CITY: revenue boost + positive happiness + low crime', () => {
    cs.choose(CitySpecType.TECH_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBeGreaterThan(1);
    expect(bonus.happinessModifier).toBeGreaterThan(0);
    expect(bonus.crimeModifier).toBeLessThan(0);
  });

  it('TOURISM_CITY: revenue boost + positive happiness', () => {
    cs.choose(CitySpecType.TOURISM_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBe(1.2);
    expect(bonus.happinessModifier).toBeGreaterThan(0);
  });

  it('GAMBLING_CITY: high revenue but high crime and low happiness', () => {
    cs.choose(CitySpecType.GAMBLING_CITY, 5000);
    const bonus = cs.getBonus();
    expect(bonus.revenueMultiplier).toBe(1.4);
    expect(bonus.happinessModifier).toBeLessThan(0);
    expect(bonus.crimeModifier).toBeGreaterThanOrEqual(15);
  });

  it('should allow choosing NONE without population requirement', () => {
    cs.choose(CitySpecType.MINING_CITY, 5000);
    expect(cs.getCurrent()).toBe(CitySpecType.MINING_CITY);
    cs.choose(CitySpecType.NONE, 0);
    expect(cs.getCurrent()).toBe(CitySpecType.NONE);
  });
});

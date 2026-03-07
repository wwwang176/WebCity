import { describe, it, expect, beforeEach } from 'vitest';
import { DistrictManager } from '../DistrictManager';
import { PolicyManager } from '../PolicyManager';
import { setSpecialization, getSpecialization, getSpecializationBonus } from '../Specialization';
import { PolicyType, Specialization } from '../types';
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

  it('should get all policy costs', () => {
    for (const policyType of Object.values(PolicyType)) {
      const cost = pm.getPolicyCost(policyType);
      expect(cost).toBeTypeOf('number');
      expect(cost).toBeGreaterThan(0);
    }
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
});

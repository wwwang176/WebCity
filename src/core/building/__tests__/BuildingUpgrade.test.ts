import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../../zone/ZoneManager';
import { BuildingGrowth } from '../BuildingGrowth';
import { BuildingUpgrade, UPGRADE_THRESHOLDS, meetsUpgradeRequirements, UPGRADE_REQUIREMENTS, KEEP_REQUIREMENTS } from '../BuildingUpgrade';
import { getBuildingType } from '../types';

function setupWithBuilding(): { grid: Grid; upgrade: BuildingUpgrade } {
  const grid = new Grid(20, 20);
  const builder = new RoadBuilder(grid);
  builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
  const zone = new ZoneManager(grid);
  zone.setZone(5, 4, ZoneType.RESIDENTIAL_LOW);
  const growth = new BuildingGrowth(grid);
  growth.tryGrow(5, 4, {
    hasPower: true,
    hasWater: true,
    rciDemand: { residential: 50, commercial: 50, industrial: 50 },
  });
  return { grid, upgrade: new BuildingUpgrade(grid) };
}

describe('BuildingUpgrade', () => {
  it('should upgrade Level 1 to Level 2 when conditions met', () => {
    const { grid, upgrade } = setupWithBuilding();
    const before = getBuildingType(grid.getCell(5, 4)!.buildingId);
    expect(before!.level).toBe(1);

    const result = upgrade.tryUpgrade(5, 4, {
      serviceCoverageCount: 3,
      landValue: 50,
      crimeRate: 10,
      pollution: 10,
    });
    expect(result).toBe(true);
    const after = getBuildingType(grid.getCell(5, 4)!.buildingId);
    expect(after!.level).toBe(2);
  });

  it('should not upgrade when service coverage is too low', () => {
    const { upgrade } = setupWithBuilding();
    const result = upgrade.canUpgrade(5, 4, {
      serviceCoverageCount: 1,
      landValue: 50,
      crimeRate: 10,
      pollution: 10,
    });
    expect(result).toBe(false);
  });

  it('should downgrade when conditions drop', () => {
    const { grid, upgrade } = setupWithBuilding();
    // Upgrade first
    upgrade.tryUpgrade(5, 4, {
      serviceCoverageCount: 3,
      landValue: 50,
      crimeRate: 10,
      pollution: 10,
    });
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(2);

    // Downgrade
    const result = upgrade.tryDowngrade(5, 4, {
      serviceCoverageCount: 1,
      landValue: 30,
      crimeRate: 50,
      pollution: 50,
    });
    expect(result).toBe(true);
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(1);
  });

  it('should have higher capacity at Level 2', () => {
    const { grid, upgrade } = setupWithBuilding();
    const before = getBuildingType(grid.getCell(5, 4)!.buildingId);
    upgrade.tryUpgrade(5, 4, {
      serviceCoverageCount: 3,
      landValue: 50,
      crimeRate: 10,
      pollution: 10,
    });
    const after = getBuildingType(grid.getCell(5, 4)!.buildingId);
    expect(after!.residents + after!.workers).toBeGreaterThan(before!.residents + before!.workers);
  });

  it('UPGRADE_THRESHOLDS level 3 should be stricter than level 2', () => {
    expect(UPGRADE_THRESHOLDS.LEVEL_3.minServiceCoverage)
      .toBeGreaterThan(UPGRADE_THRESHOLDS.LEVEL_2.minServiceCoverage);
    expect(UPGRADE_THRESHOLDS.LEVEL_3.minLandValue)
      .toBeGreaterThan(UPGRADE_THRESHOLDS.LEVEL_2.minLandValue);
  });

  it('UPGRADE_THRESHOLDS downgrade thresholds should be below upgrade thresholds', () => {
    expect(UPGRADE_THRESHOLDS.DOWNGRADE_2.minLandValue)
      .toBeLessThan(UPGRADE_THRESHOLDS.LEVEL_2.minLandValue);
    expect(UPGRADE_THRESHOLDS.DOWNGRADE_3.minLandValue)
      .toBeLessThan(UPGRADE_THRESHOLDS.LEVEL_3.minLandValue);
  });

  it('should change appearance after upgrade', () => {
    const { grid, upgrade } = setupWithBuilding();
    const before = getBuildingType(grid.getCell(5, 4)!.buildingId);
    upgrade.tryUpgrade(5, 4, {
      serviceCoverageCount: 3,
      landValue: 50,
      crimeRate: 10,
      pollution: 10,
    });
    const after = getBuildingType(grid.getCell(5, 4)!.buildingId);
    expect(after!.appearanceId).not.toBe(before!.appearanceId);
  });
});

describe('meetsUpgradeRequirements (data-driven)', () => {
  it('returns true when all conditions meet level 2 requirements', () => {
    const req = UPGRADE_REQUIREMENTS[2]!;
    expect(meetsUpgradeRequirements({ serviceCoverageCount: 3, landValue: 50, crimeRate: 0, pollution: 0 }, req)).toBe(true);
  });

  it('returns false when service coverage is below level 2 threshold', () => {
    const req = UPGRADE_REQUIREMENTS[2]!;
    expect(meetsUpgradeRequirements({ serviceCoverageCount: 2, landValue: 50, crimeRate: 0, pollution: 0 }, req)).toBe(false);
  });

  it('returns false when land value is below level 2 threshold', () => {
    const req = UPGRADE_REQUIREMENTS[2]!;
    expect(meetsUpgradeRequirements({ serviceCoverageCount: 3, landValue: 49, crimeRate: 0, pollution: 0 }, req)).toBe(false);
  });

  it('returns true when all conditions meet level 3 requirements', () => {
    const req = UPGRADE_REQUIREMENTS[3]!;
    expect(meetsUpgradeRequirements({ serviceCoverageCount: 5, landValue: 80, crimeRate: 10, pollution: 10 }, req)).toBe(true);
  });

  it('returns false when crime exceeds level 3 threshold', () => {
    const req = UPGRADE_REQUIREMENTS[3]!;
    expect(meetsUpgradeRequirements({ serviceCoverageCount: 5, landValue: 80, crimeRate: 20, pollution: 10 }, req)).toBe(false);
  });

  it('returns false when pollution exceeds level 3 threshold', () => {
    const req = UPGRADE_REQUIREMENTS[3]!;
    expect(meetsUpgradeRequirements({ serviceCoverageCount: 5, landValue: 80, crimeRate: 10, pollution: 30 }, req)).toBe(false);
  });

  it('UPGRADE_REQUIREMENTS covers all defined levels', () => {
    expect(UPGRADE_REQUIREMENTS[2]).toBeDefined();
    expect(UPGRADE_REQUIREMENTS[3]).toBeDefined();
  });

  it('KEEP_REQUIREMENTS covers all defined levels', () => {
    expect(KEEP_REQUIREMENTS[2]).toBeDefined();
    expect(KEEP_REQUIREMENTS[3]).toBeDefined();
  });
});

import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../../zone/ZoneManager';
import { BuildingGrowth } from '../BuildingGrowth';
import { BuildingUpgrade, UPGRADE_THRESHOLDS } from '../BuildingUpgrade';
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

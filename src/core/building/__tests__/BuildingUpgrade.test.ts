import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneManager } from '../../zone/ZoneManager';
import { BuildingGrowth } from '../BuildingGrowth';
import {
  BuildingUpgrade,
  meetsRequirement,
  avgEducationScore,
  UPGRADE_REQUIREMENTS,
  KEEP_REQUIREMENTS,
} from '../BuildingUpgrade';
import { getBuildingType } from '../types';
import { EducationLevel } from '../../citizen/types';

function setupWithBuilding(zone: ZoneType = ZoneType.RESIDENTIAL_LOW): { grid: Grid; upgrade: BuildingUpgrade } {
  const grid = new Grid(20, 20);
  const builder = new RoadBuilder(grid);
  builder.buildRoad({ x: 5, y: 5 }, { x: 15, y: 5 }, RoadType.TWO_LANE, 100000);
  const zm = new ZoneManager(grid);
  zm.setZone(5, 4, zone);
  const growth = new BuildingGrowth(grid);
  growth.tryGrow(5, 4, {
    hasPower: true,
    hasWater: true,
    rciDemand: { residential: 50, commercial: 50, industrial: 50 },
  });
  return { grid, upgrade: new BuildingUpgrade(grid) };
}

// ── avgEducationScore ────────────────────────────────────────────────

describe('avgEducationScore', () => {
  it('returns 0 for empty list', () => {
    expect(avgEducationScore([])).toBe(0);
  });

  it('computes correct average', () => {
    const workers = [
      { education: EducationLevel.NONE },
      { education: EducationLevel.UNIVERSITY },
    ];
    expect(avgEducationScore(workers)).toBe(1.5); // (0+3)/2
  });

  it('returns 3 for all university', () => {
    const workers = [
      { education: EducationLevel.UNIVERSITY },
      { education: EducationLevel.UNIVERSITY },
    ];
    expect(avgEducationScore(workers)).toBe(3);
  });
});

// ── meetsRequirement (zone-aware) ────────────────────────────────────

describe('meetsRequirement', () => {
  const req2 = UPGRADE_REQUIREMENTS[2]!;
  const req3 = UPGRADE_REQUIREMENTS[3]!;

  describe('residential/commercial — uses landValue', () => {
    it('meets Lv2 when landValue >= 50', () => {
      expect(meetsRequirement(ZoneType.RESIDENTIAL_LOW, { landValue: 50, avgEducation: 0 }, req2)).toBe(true);
    });

    it('fails Lv2 when landValue < 50', () => {
      expect(meetsRequirement(ZoneType.RESIDENTIAL_LOW, { landValue: 49, avgEducation: 3 }, req2)).toBe(false);
    });

    it('ignores avgEducation for residential', () => {
      expect(meetsRequirement(ZoneType.COMMERCIAL_HIGH, { landValue: 80, avgEducation: 0 }, req3)).toBe(true);
    });
  });

  describe('industrial/office — uses avgEducation', () => {
    it('meets Lv2 when avgEducation >= 1.0', () => {
      expect(meetsRequirement(ZoneType.INDUSTRIAL, { landValue: 0, avgEducation: 1.0 }, req2)).toBe(true);
    });

    it('fails Lv2 when avgEducation < 1.0', () => {
      expect(meetsRequirement(ZoneType.INDUSTRIAL, { landValue: 999, avgEducation: 0.9 }, req2)).toBe(false);
    });

    it('meets Lv3 when avgEducation >= 2.0', () => {
      expect(meetsRequirement(ZoneType.OFFICE, { landValue: 0, avgEducation: 2.0 }, req3)).toBe(true);
    });

    it('ignores landValue for industrial', () => {
      expect(meetsRequirement(ZoneType.INDUSTRIAL, { landValue: 0, avgEducation: 2.0 }, req3)).toBe(true);
    });
  });
});

// ── BuildingUpgrade class (residential) ──────────────────────────────

describe('BuildingUpgrade — residential', () => {
  it('should upgrade Lv1 to Lv2 when landValue meets threshold', () => {
    const { grid, upgrade } = setupWithBuilding();
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(1);

    const result = upgrade.tryUpgrade(5, 4, { landValue: 50, avgEducation: 0 });
    expect(result).toBe(true);
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(2);
  });

  it('should not upgrade when landValue too low', () => {
    const { upgrade } = setupWithBuilding();
    expect(upgrade.canUpgrade(5, 4, { landValue: 30, avgEducation: 3 })).toBe(false);
  });

  it('should downgrade when landValue drops below keep threshold', () => {
    const { grid, upgrade } = setupWithBuilding();
    upgrade.tryUpgrade(5, 4, { landValue: 50, avgEducation: 0 });
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(2);

    const result = upgrade.tryDowngrade(5, 4, { landValue: 30, avgEducation: 0 });
    expect(result).toBe(true);
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(1);
  });

  it('should NOT downgrade when landValue is between keep and upgrade thresholds (hysteresis)', () => {
    const { grid, upgrade } = setupWithBuilding();
    upgrade.tryUpgrade(5, 4, { landValue: 50, avgEducation: 0 });
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(2);

    // landValue 40 is below upgrade (50) but above keep (35) — should stay
    expect(upgrade.shouldDowngrade(5, 4, { landValue: 40, avgEducation: 0 })).toBe(false);
  });

  it('should have higher capacity at Level 2', () => {
    const { grid, upgrade } = setupWithBuilding();
    const before = getBuildingType(grid.getCell(5, 4)!.buildingId)!;
    upgrade.tryUpgrade(5, 4, { landValue: 50, avgEducation: 0 });
    const after = getBuildingType(grid.getCell(5, 4)!.buildingId)!;
    expect(after.residents + after.workers).toBeGreaterThan(before.residents + before.workers);
  });

  it('should change appearance after upgrade', () => {
    const { grid, upgrade } = setupWithBuilding();
    const before = getBuildingType(grid.getCell(5, 4)!.buildingId)!;
    upgrade.tryUpgrade(5, 4, { landValue: 50, avgEducation: 0 });
    const after = getBuildingType(grid.getCell(5, 4)!.buildingId)!;
    expect(after.appearanceId).not.toBe(before.appearanceId);
  });
});

// ── BuildingUpgrade class (industrial) ───────────────────────────────

describe('BuildingUpgrade — industrial', () => {
  it('should upgrade Lv1 to Lv2 when avgEducation meets threshold', () => {
    const { grid, upgrade } = setupWithBuilding(ZoneType.INDUSTRIAL);
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(1);

    const result = upgrade.tryUpgrade(5, 4, { landValue: 0, avgEducation: 1.0 });
    expect(result).toBe(true);
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(2);
  });

  it('should not upgrade when avgEducation too low', () => {
    const { upgrade } = setupWithBuilding(ZoneType.INDUSTRIAL);
    expect(upgrade.canUpgrade(5, 4, { landValue: 999, avgEducation: 0.5 })).toBe(false);
  });

  it('should downgrade when avgEducation drops below keep threshold', () => {
    const { grid, upgrade } = setupWithBuilding(ZoneType.INDUSTRIAL);
    upgrade.tryUpgrade(5, 4, { landValue: 0, avgEducation: 1.0 });
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(2);

    const result = upgrade.tryDowngrade(5, 4, { landValue: 0, avgEducation: 0.3 });
    expect(result).toBe(true);
    expect(getBuildingType(grid.getCell(5, 4)!.buildingId)!.level).toBe(1);
  });

  it('should NOT downgrade when avgEducation is in hysteresis band', () => {
    const { grid, upgrade } = setupWithBuilding(ZoneType.INDUSTRIAL);
    upgrade.tryUpgrade(5, 4, { landValue: 0, avgEducation: 1.0 });

    // 0.7 is below upgrade (1.0) but above keep (0.5) — should stay
    expect(upgrade.shouldDowngrade(5, 4, { landValue: 0, avgEducation: 0.7 })).toBe(false);
  });
});

// ── Requirements tables ──────────────────────────────────────────────

describe('Requirements tables', () => {
  it('UPGRADE_REQUIREMENTS Lv3 should be stricter than Lv2', () => {
    expect(UPGRADE_REQUIREMENTS[3]!.minLandValue).toBeGreaterThan(UPGRADE_REQUIREMENTS[2]!.minLandValue);
    expect(UPGRADE_REQUIREMENTS[3]!.minAvgEducation).toBeGreaterThan(UPGRADE_REQUIREMENTS[2]!.minAvgEducation);
  });

  it('KEEP_REQUIREMENTS should be below UPGRADE_REQUIREMENTS for same level', () => {
    expect(KEEP_REQUIREMENTS[2]!.minLandValue).toBeLessThan(UPGRADE_REQUIREMENTS[2]!.minLandValue);
    expect(KEEP_REQUIREMENTS[3]!.minLandValue).toBeLessThan(UPGRADE_REQUIREMENTS[3]!.minLandValue);
    expect(KEEP_REQUIREMENTS[2]!.minAvgEducation).toBeLessThan(UPGRADE_REQUIREMENTS[2]!.minAvgEducation);
    expect(KEEP_REQUIREMENTS[3]!.minAvgEducation).toBeLessThan(UPGRADE_REQUIREMENTS[3]!.minAvgEducation);
  });

  it('covers all defined levels', () => {
    expect(UPGRADE_REQUIREMENTS[2]).toBeDefined();
    expect(UPGRADE_REQUIREMENTS[3]).toBeDefined();
    expect(KEEP_REQUIREMENTS[2]).toBeDefined();
    expect(KEEP_REQUIREMENTS[3]).toBeDefined();
  });
});

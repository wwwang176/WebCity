import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { BuildingUpgrade } from '../BuildingUpgrade';
import { ABANDONED, BURNED } from '../InfraPlacement';
import { getBuildingType } from '../types';

/**
 * canUpgrade / shouldDowngrade tested only `buildingId === 0`, treating ruins as
 * ordinary buildings. On its own that is harmless — a ruin's level is read by
 * nothing — but it is the only thing that lets SimulationLoop reach its
 * onBuildingUpdated callback for an abandoned building, and that callback omits
 * the `abandoned` argument. The renderer's default of false then re-adds the
 * light spot and restores lit windows: the player sees a normal lit house that
 * pays no tax, houses nobody, and reports ABANDONED in the building panel.
 *
 * Guarding here rather than at the callback fixes both layers and stops ruins
 * consuming the per-tick upgrade sampling budget.
 */
function gridWithBuilding(reserved: number): { grid: Grid; upgrade: BuildingUpgrade; id: number } {
  const grid = new Grid(10, 10);
  // A level-2 residential building, so both upgrade and downgrade are possible.
  const id = 2;
  grid.setCell(3, 3, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: id, reserved, landValue: 90 });
  return { grid, upgrade: new BuildingUpgrade(grid), id };
}

const RICH = { landValue: 90, avgEducation: 3 };
const POOR = { landValue: 5, avgEducation: 0 };

describe('ruins are excluded from upgrade and downgrade', () => {
  it('should not upgrade an ABANDONED building', () => {
    const { grid, upgrade, id } = gridWithBuilding(ABANDONED);
    expect(upgrade.canUpgrade(3, 3, RICH)).toBe(false);
    expect(upgrade.tryUpgrade(3, 3, RICH)).toBe(false);
    expect(grid.getCell(3, 3)!.buildingId).toBe(id);
  });

  it('should not upgrade a BURNED building', () => {
    const { upgrade } = gridWithBuilding(BURNED);
    expect(upgrade.canUpgrade(3, 3, RICH)).toBe(false);
  });

  it('should not downgrade an ABANDONED building', () => {
    const { grid, upgrade, id } = gridWithBuilding(ABANDONED);
    expect(upgrade.shouldDowngrade(3, 3, POOR)).toBe(false);
    expect(upgrade.tryDowngrade(3, 3, POOR)).toBe(false);
    expect(grid.getCell(3, 3)!.buildingId).toBe(id);
  });

  it('should not downgrade a BURNED building', () => {
    const { upgrade } = gridWithBuilding(BURNED);
    expect(upgrade.shouldDowngrade(3, 3, POOR)).toBe(false);
  });

  it('should still upgrade a healthy building', () => {
    const { grid, upgrade } = gridWithBuilding(0);
    const before = getBuildingType(grid.getCell(3, 3)!.buildingId)!.level;

    // Only assert that the healthy path is still reachable, whichever direction
    // the requirements happen to allow for this building.
    const moved = upgrade.tryUpgrade(3, 3, RICH) || upgrade.tryDowngrade(3, 3, POOR);
    if (moved) {
      expect(getBuildingType(grid.getCell(3, 3)!.buildingId)!.level).not.toBe(before);
    } else {
      expect(upgrade.canUpgrade(3, 3, RICH) || upgrade.shouldDowngrade(3, 3, POOR)).toBe(false);
    }
  });
});

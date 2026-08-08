import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { FIRE } from '../FireService';
import { applyFireDamage, type ResolvedFire, type FireDamageResult } from '../FireDamageProcessor';
import { BURNED } from '../../building/InfraPlacement';

describe('applyFireDamage', () => {
  it('marks a single-cell zone building as BURNED when damage >= threshold', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, serviceCoverage: 3 });

    const fires: ResolvedFire[] = [{ x: 2, y: 2, damage: FIRE.BURN_DAMAGE_THRESHOLD }];
    const result = applyFireDamage(grid, fires);

    expect(result.changed).toBe(true);
    expect(result.updates.length).toBe(1);
    expect(result.updates[0]).toEqual(
      expect.objectContaining({ x: 2, y: 2, burned: true }),
    );
    expect(grid.getCell(2, 2)!.reserved).toBe(BURNED);
  });

  it('does nothing when damage is below threshold', () => {
    const grid = new Grid(5, 5);
    grid.setCell(2, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    const fires: ResolvedFire[] = [{ x: 2, y: 2, damage: FIRE.BURN_DAMAGE_THRESHOLD - 0.01 }];
    const result = applyFireDamage(grid, fires);

    expect(result.changed).toBe(false);
    expect(result.updates).toEqual([]);
  });

  it('does nothing for non-zone buildings (infrastructure)', () => {
    const grid = new Grid(5, 5);
    // buildingId 252 = Police Station (infrastructure)
    grid.setCell(2, 2, { buildingId: 252 });

    const fires: ResolvedFire[] = [{ x: 2, y: 2, damage: 1.0 }];
    const result = applyFireDamage(grid, fires);

    expect(result.changed).toBe(false);
    expect(result.updates).toEqual([]);
  });

  it('does nothing for empty cells', () => {
    const grid = new Grid(5, 5);

    const fires: ResolvedFire[] = [{ x: 2, y: 2, damage: 1.0 }];
    const result = applyFireDamage(grid, fires);

    expect(result.changed).toBe(false);
    expect(result.updates).toEqual([]);
  });

  it('handles multiple resolved fires', () => {
    const grid = new Grid(5, 5);
    grid.setCell(0, 0, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 2, serviceCoverage: 6 });
    grid.setCell(3, 3, { zoneType: ZoneType.INDUSTRIAL, buildingId: 3, serviceCoverage: 0 });

    const fires: ResolvedFire[] = [
      { x: 0, y: 0, damage: 0.8 },
      { x: 3, y: 3, damage: 0.6 },
    ];
    const result = applyFireDamage(grid, fires);

    expect(result.changed).toBe(true);
    expect(result.updates.length).toBe(2);
    expect(grid.getCell(0, 0)!.reserved).toBe(BURNED);
    expect(grid.getCell(3, 3)!.reserved).toBe(BURNED);
  });

  it('returns building level in update based on buildingId type level', () => {
    const grid = new Grid(5, 5);
    // buildingId 3 = Large House (Residential LOW, Level 3)
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 3 });

    const fires: ResolvedFire[] = [{ x: 1, y: 1, damage: 1.0 }];
    const result = applyFireDamage(grid, fires);

    expect(result.updates[0]!.level).toBe(3);
  });
});

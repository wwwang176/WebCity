import { describe, it, expect, beforeEach } from 'vitest';
import { ShoppingAccess } from '../ShoppingAccess';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

// Residential: 1(RL Lv1, 4 res), 4(RH Lv1, 80 res)
// Commercial:  7(CL Lv1, 4 workers), 10(CH Lv1, 80 workers)

describe('ShoppingAccess', () => {
  let grid: Grid;
  let shopping: ShoppingAccess;

  beforeEach(() => {
    grid = new Grid(20, 20);
    shopping = new ShoppingAccess();
  });

  it('should find residential with commercial connected via road', () => {
    // Road: (2,0)-(4,0)
    grid.setCell(2, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(3, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(4, 0, { roadType: RoadType.TWO_LANE });
    // Commercial at (2,1), Residential at (4,1)
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(4, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    shopping.calculate(grid);

    const res = shopping.getResidentialAccess(4, 1);
    expect(res.ratio).toBeGreaterThan(0);
    expect(res.hasAccess).toBe(true);

    const com = shopping.getCommercialCustomers(2, 1);
    expect(com.ratio).toBeGreaterThan(0);
    expect(com.hasCustomers).toBe(true);
  });

  it('should not find access when disconnected', () => {
    grid.setCell(2, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(10, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(10, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    shopping.calculate(grid);

    const res = shopping.getResidentialAccess(10, 1);
    expect(res.ratio).toBe(0);
    expect(res.hasAccess).toBe(false);

    const com = shopping.getCommercialCustomers(2, 1);
    expect(com.ratio).toBe(0);
    expect(com.hasCustomers).toBe(false);
  });

  it('should give higher ratio when more commercial capacity nearby', () => {
    // Road: (0,0)-(6,0)
    for (let x = 0; x <= 6; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 1 residential (4 residents)
    grid.setCell(0, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    // 3 commercial shops (4 workers each)
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(6, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    shopping.calculate(grid);

    const res = shopping.getResidentialAccess(0, 1);
    // 12 workers / 4 residents = 3.0 → capped at 1.0
    expect(res.ratio).toBe(1);
  });

  it('should give partial ratio when commercial capacity is less than residential', () => {
    for (let x = 0; x <= 4; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 1 high-density residential (80 residents)
    grid.setCell(0, 1, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    // 1 small shop (4 workers)
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    shopping.calculate(grid);

    const res = shopping.getResidentialAccess(0, 1);
    // 4 workers / 80 residents = 0.05
    expect(res.ratio).toBeCloseTo(4 / 80);
    expect(res.hasAccess).toBe(true);
  });

  it('commercial should have no customers without nearby residential', () => {
    for (let x = 0; x <= 4; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // Only commercial, no residential
    grid.setCell(2, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    shopping.calculate(grid);

    const com = shopping.getCommercialCustomers(2, 1);
    expect(com.ratio).toBe(0);
    expect(com.hasCustomers).toBe(false);
  });

  it('commercial ratio should reflect customer density', () => {
    for (let x = 0; x <= 4; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // 1 high-density apartment (80 residents) + 1 small shop (4 workers)
    grid.setCell(0, 1, { zoneType: ZoneType.RESIDENTIAL_HIGH, buildingId: 4 });
    grid.setCell(4, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });

    shopping.calculate(grid);

    const com = shopping.getCommercialCustomers(4, 1);
    // 80 residents / 4 workers = 20 → capped at 1
    expect(com.ratio).toBe(1);
    expect(com.hasCustomers).toBe(true);
  });

  it('should connect regardless of distance if road-connected', () => {
    // Long road — no distance limit, only connectivity matters
    for (let x = 0; x <= 19; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    grid.setCell(19, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    shopping.calculate(grid);

    const com = shopping.getCommercialCustomers(0, 1);
    expect(com.hasCustomers).toBe(true);
    expect(com.ratio).toBe(1); // 4 residents / 4 workers = 1

    const res = shopping.getResidentialAccess(19, 1);
    expect(res.hasAccess).toBe(true);
    expect(res.ratio).toBe(1); // 4 workers / 4 residents = 1
  });

  it('should isolate disconnected components', () => {
    // Two separate road networks
    for (let x = 0; x <= 3; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    for (let x = 10; x <= 13; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // Component A: commercial only
    grid.setCell(0, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
    // Component B: residential only
    grid.setCell(10, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    shopping.calculate(grid);

    // Component A: no customers
    expect(shopping.getCommercialCustomers(0, 1).hasCustomers).toBe(false);
    // Component B: no shops
    expect(shopping.getResidentialAccess(10, 1).hasAccess).toBe(false);
  });

  it('should return default values before calculate is called', () => {
    const res = shopping.getResidentialAccess(0, 0);
    expect(res.ratio).toBe(1);
    expect(res.hasAccess).toBe(true);

    const com = shopping.getCommercialCustomers(0, 0);
    expect(com.ratio).toBe(1);
    expect(com.hasCustomers).toBe(true);
  });

  it('should handle both commercial densities for customer calculation', () => {
    for (let x = 0; x <= 4; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    // High-density commercial (80 workers) with small residential (4 residents)
    grid.setCell(0, 1, { zoneType: ZoneType.COMMERCIAL_HIGH, buildingId: 10 });
    grid.setCell(4, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

    shopping.calculate(grid);

    const com = shopping.getCommercialCustomers(0, 1);
    // 4 residents / 80 workers = 0.05 → very few customers
    expect(com.ratio).toBeCloseTo(4 / 80);
  });

  it('multiple residential buildings increase commercial customer ratio', () => {
    for (let x = 0; x <= 6; x++) grid.setCell(x, 0, { roadType: RoadType.TWO_LANE });
    grid.setCell(0, 1, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 }); // 4 workers
    grid.setCell(2, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 4 res
    grid.setCell(4, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 4 res
    grid.setCell(6, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 }); // 4 res

    shopping.calculate(grid);

    const com = shopping.getCommercialCustomers(0, 1);
    // 12 residents / 4 workers = 3.0 → capped at 1
    expect(com.ratio).toBe(1);
  });

  it('setRoadLookup injects dependency (DIP) without module-level state', () => {
    // Verify the instance method exists and can be called
    const mockLookup = {
      getAllKeysAtPosition: (_x: number, _y: number) => [] as string[],
      getCompatibleNeighborKeys: (_src: string, _nx: number, _ny: number) => [] as string[],
      getCellByKey: (_key: string) => null,
      getAllCellKeys: () => [] as string[],
    };
    // Should not throw
    shopping.setRoadLookup(mockLookup as any);
    // calculate should work without module-level state
    shopping.calculate(grid);
    const res = shopping.getResidentialAccess(0, 0);
    expect(res.ratio).toBeDefined();
  });
});

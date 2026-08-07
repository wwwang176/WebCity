import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { ZoneType } from '../../grid/types';
import { SewageService } from '../SewageService';

/**
 * calculateCoverage iterated every treatment plant, consulting neither
 * connectedPlantIds nor operationalPlantIds — while getConnectedTreatmentCapacity
 * in the same class filters on both. Two sets of state, only one of them used.
 *
 * The visible consequence is not just an inflated coverage number:
 * getPollutionSources skips any cell that isSupplied, so with every plant
 * unpowered the totals correctly showed untreated sewage rising while not a
 * single water-pollution source was emitted anywhere in the city — no penalty at
 * all for a completely failed sewage network.
 */
function cityWithPlant() {
  const grid = new Grid(20, 20);
  new RoadBuilder(grid).buildRoad({ x: 2, y: 10 }, { x: 15, y: 10 }, RoadType.TWO_LANE, 1e6);
  for (let x = 5; x < 12; x++) {
    grid.setCell(x, 9, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  const sewage = new SewageService();
  sewage.addTreatmentPlant(3, 11);
  sewage.updateConnectedPlants(grid);
  return { grid, sewage };
}

describe('sewage coverage respects operational plants', () => {
  it('should supply cells while the plant has power', () => {
    const { grid, sewage } = cityWithPlant();
    sewage.updateOperationalStatus(() => true, () => true);
    sewage.calculateCoverage(grid);

    expect(sewage.isSupplied(6, 9)).toBe(true);
  });

  it('should supply nothing once the plant loses power', () => {
    const { grid, sewage } = cityWithPlant();
    sewage.updateOperationalStatus(() => false, () => true);
    sewage.calculateCoverage(grid);

    expect(sewage.isSupplied(6, 9)).toBe(false);
    expect(sewage.isInCoverage(6, 9)).toBe(false);
  });

  it('should emit water pollution at buildings once the network fails', () => {
    // getPollutionSources skips supplied cells, so the phantom coverage above
    // silently suppressed every water-pollution source in the city.
    const { grid, sewage } = cityWithPlant();
    sewage.reportSewage(6, 9, 10);
    sewage.updateOperationalStatus(() => false, () => true);
    sewage.calculateCoverage(grid);

    expect(sewage.getPollutionSources().length).toBeGreaterThan(0);
  });

  it('should emit no water pollution while the network works', () => {
    const { grid, sewage } = cityWithPlant();
    sewage.reportSewage(6, 9, 10);
    sewage.updateOperationalStatus(() => true, () => true);
    sewage.calculateCoverage(grid);

    expect(sewage.getPollutionSources()).toHaveLength(0);
  });

  it('should ignore a plant that is not connected to a road', () => {
    const grid = new Grid(20, 20);
    new RoadBuilder(grid).buildRoad({ x: 2, y: 10 }, { x: 15, y: 10 }, RoadType.TWO_LANE, 1e6);
    grid.setCell(6, 9, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    const sewage = new SewageService();
    sewage.addTreatmentPlant(18, 18); // nowhere near the road
    sewage.updateConnectedPlants(grid);
    sewage.updateOperationalStatus(() => true, () => true);

    sewage.calculateCoverage(grid);

    expect(sewage.isSupplied(6, 9)).toBe(false);
  });
});

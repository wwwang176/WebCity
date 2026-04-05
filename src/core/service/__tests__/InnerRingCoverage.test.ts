/**
 * Inner-ring coverage integration tests.
 *
 * Verifies that every civic / service-coverage class (PoliceService, FireService,
 * HealthService, SchoolService, DeathCareService, GarbageService) actually covers
 * buildings sitting in the one-tile inner ring — i.e. 2 tiles back from a road,
 * which is the reach allowed by ZoneManager/BuildingGrowth.
 *
 * If expandCoverageToBuildings or roadFlood seed reach regresses to 4-neighbour,
 * these tests should fail.
 */

import { describe, it, expect } from 'vitest';
import { PoliceService } from '../PoliceService';
import { FireService } from '../FireService';
import { HealthService } from '../HealthService';
import { SchoolService } from '../SchoolService';
import { DeathCareService } from '../DeathCareService';
import { GarbageService } from '../GarbageService';
import { RoadType } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

/**
 * Horizontal road at y=roadY from x=0 to x=width-1, everything else empty.
 * Use this so every civic service under test has a long straight road to
 * flood along.
 */
function makeHorizontalRoadGrid(width: number, height: number, roadY: number): SizedGrid {
  return {
    width,
    height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: y === roadY ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

describe('Inner-ring coverage — civic services reach buildings 2 tiles from road', () => {
  // Layout for every test: road at y=10 spanning x=0..29.
  // Facility (2x2 or 2x3) sits with its footprint touching the road (y=8 or 9).
  // Inner-ring probe: a building at y=8 (2 tiles above road) — should be covered.
  // Out-of-reach probe: a building at y=7 (3 tiles above road) — should NOT be covered.
  const GRID_W = 30;
  const GRID_H = 20;
  const ROAD_Y = 10;

  function makeGrid(): SizedGrid {
    return makeHorizontalRoadGrid(GRID_W, GRID_H, ROAD_Y);
  }

  it('PoliceService covers inner-ring buildings (y=ROAD_Y-2)', () => {
    const grid = makeGrid();
    const police = new PoliceService();
    police.addStation(5, 8); // 2x2 at (5,8)-(6,9), bottom row touches road
    police.tick(grid);
    expect(police.getCoverage(3, ROAD_Y - 2)).toBe(true);  // inner ring
    expect(police.getCoverage(12, ROAD_Y - 2)).toBe(true); // further inner ring
    expect(police.getCoverage(3, ROAD_Y - 3)).toBe(false); // beyond reach
  });

  it('FireService covers inner-ring buildings', () => {
    const grid = makeGrid();
    const fire = new FireService();
    fire.addStation(5, 8);
    fire.recalculateCoverage(grid);
    expect(fire.getCoverage(3, ROAD_Y - 2)).toBe(true);
    expect(fire.getCoverage(12, ROAD_Y - 2)).toBe(true);
    expect(fire.getCoverage(3, ROAD_Y - 3)).toBe(false);
  });

  it('HealthService covers inner-ring buildings (2x3 hospital footprint)', () => {
    const grid = makeGrid();
    const health = new HealthService();
    // 2x3 hospital: width=2, height=3. Primary at (5,7) means cells (5..6, 7..9).
    // Bottom row (y=9) is adjacent to road at y=10.
    health.addHospital(5, 7);
    health.recalculateCoverage(grid);
    expect(health.getCoverage(3, ROAD_Y - 2)).toBe(true);
    expect(health.getCoverage(12, ROAD_Y - 2)).toBe(true);
    expect(health.getCoverage(3, ROAD_Y - 3)).toBe(false);
  });

  it('SchoolService (elementary) covers inner-ring buildings', () => {
    const grid = makeGrid();
    const school = new SchoolService('elementary');
    school.addSchool(5, 8);
    school.recalculateCoverage(grid);
    expect(school.getCoverage(3, ROAD_Y - 2)).toBe(true);
    expect(school.getCoverage(3, ROAD_Y - 3)).toBe(false);
  });

  it('DeathCareService covers inner-ring buildings', () => {
    const grid = makeGrid();
    const deathCare = new DeathCareService();
    deathCare.addCemetery(5, 8);
    deathCare.recalculateCoverage(grid);
    expect(deathCare.getCoverage(3, ROAD_Y - 2)).toBe(true);
    expect(deathCare.getCoverage(3, ROAD_Y - 3)).toBe(false);
  });

  it('GarbageService (utility reach=1 at placement, reach=2 at coverage expansion) covers inner ring', () => {
    // Landfill placement still requires strict road adjacency (roadReach=1),
    // but once placed, its coverage expansion picks up inner-ring buildings
    // so trucks can collect from them.
    const grid = makeGrid();
    const garbage = new GarbageService();
    garbage.addFacility(5, 8);
    garbage.recalculateCoverage(grid);
    expect(garbage.getCoverage(3, ROAD_Y - 2)).toBe(true);
    expect(garbage.getCoverage(12, ROAD_Y - 2)).toBe(true);
    expect(garbage.getCoverage(3, ROAD_Y - 3)).toBe(false);
  });

  it('civic service placed one empty tile back from road still covers inner ring on opposite side', () => {
    // Police station at (5, 8) with road at y=10. The facility itself has a
    // gap row at y=9 between it and the road → relies on roadReach=2 seeding.
    // We verify buildings on the OPPOSITE side of the road (y=11, y=12) are
    // still covered via the Dijkstra flood.
    const grid = makeHorizontalRoadGrid(GRID_W, GRID_H, ROAD_Y);
    const police = new PoliceService();
    police.addStation(5, 7); // 2x2 at (5,7)-(6,8) — bottom row at y=8 is 2 cells from road at y=10
    police.tick(grid);
    expect(police.isFacilityConnected('police_1')).toBe(true);
    // Opposite side of the road: direct adjacency
    expect(police.getCoverage(5, ROAD_Y + 1)).toBe(true);
    // Opposite side inner ring
    expect(police.getCoverage(5, ROAD_Y + 2)).toBe(true);
    // 3 tiles beyond road on far side — outside reach
    expect(police.getCoverage(5, ROAD_Y + 3)).toBe(false);
  });
});

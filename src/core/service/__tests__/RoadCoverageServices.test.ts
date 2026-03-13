import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { HealthService } from '../HealthService';
import { EducationService } from '../EducationService';
import { DeathCareService } from '../DeathCareService';
import { ROAD_COVERAGE } from '../RoadCoverageFlood';
import { RoadType, RoadDirection } from '../../road/types';
import type { SizedGrid } from '../../grid/GridHelpers';

/** Create a grid with a horizontal road at row roadY from x=1 to x=endX. */
function makeRoadGrid(width: number, height: number, roadY: number, endX?: number): SizedGrid {
  const ex = endX ?? width - 1;
  return {
    width,
    height,
    getCell(x: number, y: number) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { roadType: (y === roadY && x >= 1 && x <= ex) ? RoadType.TWO_LANE : RoadType.NONE };
    },
  };
}

describe('HealthService road-based coverage', () => {
  it('getCoverage uses road-distance after recalculateCoverage', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const health = new HealthService();
    health.addHospital(0, 15);
    health.recalculateCoverage(grid);

    // Adjacent to road = covered
    expect(health.getCoverage(5, 15)).toBe(true);
    // Building adjacent to road
    expect(health.getCoverage(5, 14)).toBe(true);
  });

  it('getCoverage returns false for unreachable cells', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const health = new HealthService();
    health.addHospital(0, 15);
    health.recalculateCoverage(grid);

    // Far from any road connection
    expect(health.getCoverage(0, 0)).toBe(false);
  });

  it('getHealthBonus works with road-based coverage', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const health = new HealthService();
    health.addHospital(0, 15);
    health.recalculateCoverage(grid);

    expect(health.getHealthBonus(5, 15)).toBe(20);
    expect(health.getHealthBonus(0, 0)).toBe(0);
  });

  it('getCoveredCellsWithCost returns cost map for overlay', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const health = new HealthService();
    health.addHospital(0, 15);
    health.recalculateCoverage(grid);

    const cells = health.getCoveredCellsWithCost();
    expect(cells.size).toBeGreaterThan(0);
  });

  it('previewCoverage returns merged preview', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const health = new HealthService();
    health.addHospital(0, 15);
    health.recalculateCoverage(grid);

    const preview = health.previewCoverage({ x: 28, y: 15 }, grid);
    expect(preview.size).toBeGreaterThan(0);
  });
});

describe('EducationService road-based coverage', () => {
  it('elementary has smallest coverage budget', () => {
    expect(ROAD_COVERAGE.EDUCATION_ELEMENTARY_BUDGET).toBeLessThan(ROAD_COVERAGE.EDUCATION_HIGHSCHOOL_BUDGET);
  });

  it('highschool has medium coverage budget', () => {
    expect(ROAD_COVERAGE.EDUCATION_HIGHSCHOOL_BUDGET).toBeLessThan(ROAD_COVERAGE.EDUCATION_UNIVERSITY_BUDGET);
  });

  it('university has largest coverage budget', () => {
    expect(ROAD_COVERAGE.EDUCATION_UNIVERSITY_BUDGET).toBeGreaterThan(ROAD_COVERAGE.EDUCATION_HIGHSCHOOL_BUDGET);
  });

  it('getCoverage uses road-distance per school type', () => {
    const grid = makeRoadGrid(50, 50, 25);
    const edu = new EducationService();
    edu.addSchool(0, 25, 'elementary');
    edu.recalculateCoverage(grid);

    // Near the school = covered
    expect(edu.getCoverage(3, 25)).toBe(true);
  });

  it('getCoverage with type filter only checks that school type', () => {
    const grid = makeRoadGrid(50, 50, 25);
    const edu = new EducationService();
    edu.addSchool(0, 25, 'elementary');
    edu.recalculateCoverage(grid);

    expect(edu.getCoverage(3, 25, 'elementary')).toBe(true);
    expect(edu.getCoverage(3, 25, 'highschool')).toBe(false);
  });

  it('university covers more area than elementary on same road', () => {
    // Long road, measure how far each school type reaches
    const grid = makeRoadGrid(200, 10, 5, 199);
    const eduElem = new EducationService();
    eduElem.addSchool(0, 5, 'elementary');
    eduElem.recalculateCoverage(grid);

    const eduUni = new EducationService();
    eduUni.addSchool(0, 5, 'university');
    eduUni.recalculateCoverage(grid);

    // Find farthest covered x for each
    let elemMax = 0;
    let uniMax = 0;
    for (let x = 1; x < 200; x++) {
      if (eduElem.getCoverage(x, 5)) elemMax = x;
      if (eduUni.getCoverage(x, 5)) uniMax = x;
    }
    expect(uniMax).toBeGreaterThan(elemMax);
  });

  it('getEducationLevel returns highest level available at position', () => {
    const grid = makeRoadGrid(50, 50, 25);
    const edu = new EducationService();
    edu.addSchool(0, 25, 'elementary');
    edu.addSchool(0, 25, 'university');
    edu.recalculateCoverage(grid);

    expect(edu.getEducationLevel(3, 25)).toBe('university');
  });

  it('getCoveredCellsWithCost returns cost map', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const edu = new EducationService();
    edu.addSchool(0, 15, 'elementary');
    edu.recalculateCoverage(grid);

    const cells = edu.getCoveredCellsWithCost();
    expect(cells.size).toBeGreaterThan(0);
  });
});

describe('DeathCareService road-based coverage', () => {
  it('getCoverage uses road-distance after recalculateCoverage', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const dc = new DeathCareService();
    dc.addCemetery(0, 15);
    dc.recalculateCoverage(grid);

    expect(dc.getCoverage(5, 15)).toBe(true);
    expect(dc.getCoverage(5, 14)).toBe(true); // adjacent to road
  });

  it('getCoverage returns false for unreachable cells', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const dc = new DeathCareService();
    dc.addCemetery(0, 15);
    dc.recalculateCoverage(grid);

    expect(dc.getCoverage(0, 0)).toBe(false);
  });

  it('getCoveredCellsWithCost returns cost map for overlay', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const dc = new DeathCareService();
    dc.addCemetery(0, 15);
    dc.recalculateCoverage(grid);

    const cells = dc.getCoveredCellsWithCost();
    expect(cells.size).toBeGreaterThan(0);
  });

  it('previewCoverage returns merged preview', () => {
    const grid = makeRoadGrid(30, 30, 15);
    const dc = new DeathCareService();
    dc.addCemetery(0, 15);
    dc.recalculateCoverage(grid);

    const preview = dc.previewCoverage({ x: 28, y: 15 }, grid);
    expect(preview.size).toBeGreaterThan(0);
  });
});

describe('Garbage extended budget', () => {
  it('garbage budget is significantly larger than police/fire', () => {
    expect(ROAD_COVERAGE.GARBAGE_BUDGET).toBeGreaterThan(ROAD_COVERAGE.POLICE_BUDGET * 2);
  });
});

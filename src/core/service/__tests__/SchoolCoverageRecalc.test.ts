import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { RoadBuilder } from '../../road/RoadBuilder';
import { RoadType } from '../../road/types';
import { placeInfraOnGrid } from '../../building/InfraPlacement';
import { tickAllCivicServices } from '../ServiceRegistry';
import type { SchoolType } from '../EducationService';

const ELEMENTARY: SchoolType = 'elementary';

/**
 * Every other RoadCoverageService goes through updateRoadServiceOps, which
 * recalculates coverage when the operational set changes. Education went through
 * its own call that discarded the `changed` flag, and SchoolService answers
 * getCoverage from the array built at recalc time without consulting
 * operationalIds (unlike ParkService, which filters at query time). So a school
 * that lost power kept full coverage until the player next touched a road.
 */
function cityWithSchool() {
  const state = createGameState(30, 30);
  new RoadBuilder(state.grid).buildRoad({ x: 2, y: 10 }, { x: 25, y: 10 }, RoadType.TWO_LANE, 1e6);

  placeInfraOnGrid(state.grid, 4, 11, 'power', 0);
  state.power.addPlant({ x: 4, y: 11, output: 500, pollution: 20, type: 'coal' });
  placeInfraOnGrid(state.grid, 8, 11, 'water', 0);
  state.water.addPlant({ x: 8, y: 11, output: 500 });

  placeInfraOnGrid(state.grid, 12, 11, 'school', 0);
  state.education.addSchool(12, 11, ELEMENTARY);

  return state;
}

describe('school coverage follows operational status', () => {
  it('should drop coverage when the school loses power, without a road change', () => {
    const state = cityWithSchool();
    state.power.calculateCoverage(state.grid);
    state.water.calculateCoverage(state.grid);
    state.education.recalculateCoverage(state.grid);

    tickAllCivicServices(state);
    expect(state.education.getCoverage(12, 10, ELEMENTARY)).toBe(true);

    // Cut the power at the source and let the utility networks resettle.
    state.power.removePlant(4, 11);
    state.power.calculateCoverage(state.grid);

    tickAllCivicServices(state);

    expect(state.education.getCoverage(12, 10, ELEMENTARY)).toBe(false);
  });

  it('should restore coverage when power comes back', () => {
    const state = cityWithSchool();
    state.power.calculateCoverage(state.grid);
    state.water.calculateCoverage(state.grid);
    state.education.recalculateCoverage(state.grid);
    tickAllCivicServices(state);

    state.power.removePlant(4, 11);
    state.power.calculateCoverage(state.grid);
    tickAllCivicServices(state);
    expect(state.education.getCoverage(12, 10, ELEMENTARY)).toBe(false);

    state.power.addPlant({ x: 4, y: 11, output: 500, pollution: 20, type: 'coal' });
    state.power.calculateCoverage(state.grid);
    tickAllCivicServices(state);

    expect(state.education.getCoverage(12, 10, ELEMENTARY)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';
import { GarbageService } from '../GarbageService';
import { SewageService } from '../SewageService';
import { EducationService } from '../EducationService';
import { createGameState } from '../../simulation/GameState';
import { tickAllCivicServices } from '../ServiceRegistry';
import { placeInfraOnGrid } from '../../building/InfraPlacement';

/**
 * "Does this facility work?" has two ingredients — it must be reachable by road
 * (connectedFacilityIds) and it must have power and water
 * (isFacilityOperationalById) — and different call sites were asking different
 * halves of the question.
 *
 * GarbageService.collectPending and processFacilities require both.
 * getPollutionSources used getOperationalFacilities(), which ignores road
 * connectivity. A landfill with power but no road therefore emitted its base
 * pollution, took a share of the uncollected-garbage penalty, and — because
 * that share is only emitted at the rubbish itself when NO facility is working
 * — hid the street-level pollution the player was supposed to see, all while
 * collecting and burning nothing.
 */
function cityWith(connectedLandfill: boolean): { grid: Grid; garbage: GarbageService } {
  const grid = new Grid(20, 20);
  for (let x = 1; x <= 8; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  // Rubbish-producing houses along the road.
  for (let x = 1; x <= 8; x++) {
    grid.setCell(x, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }

  const garbage = new GarbageService();
  // Connected: adjacent to the road. Disconnected: marooned in the far corner.
  if (connectedLandfill) garbage.addFacility(3, 0);
  else garbage.addFacility(16, 16);
  garbage.recalculateCoverage(grid);
  return { grid, garbage };
}

describe('a landfill with no road connection does not pollute', () => {
  it('should emit base pollution from a connected landfill', () => {
    const { garbage } = cityWith(true);
    const sources = garbage.getPollutionSources();
    expect(sources.length).toBeGreaterThan(0);
  });

  it('should emit nothing from a landfill nothing can reach', () => {
    // It burns nothing and collects nothing, so it has nothing to emit.
    const { garbage } = cityWith(false);
    expect(garbage.getPollutionSources()).toEqual([]);
  });
});

/**
 * Reported capacity must be capacity the city can actually use.
 *
 * HealthService was fixed for this (BUG-100): coverage already excluded
 * non-operational hospitals while getTotalCapacity summed every one, so
 * blacked-out hospitals kept suppressing the death rate. The same shape
 * survived in three other services, where it feeds either the simulation
 * (school places) or the infrastructure panel (landfill and treatment capacity)
 * — advertising room the city does not have, precisely when it is failing.
 */
describe('reported capacity counts only facilities that work', () => {
  it('should exclude an unreachable landfill from total capacity', () => {
    const connected = cityWith(true).garbage;
    const marooned = cityWith(false).garbage;

    expect(connected.getTotalCapacity()).toBeGreaterThan(0);
    expect(marooned.getTotalCapacity()).toBe(0);
  });

  it('should exclude an unreachable treatment plant from treatment capacity', () => {
    const grid = new Grid(20, 20);
    for (let x = 1; x <= 8; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    const sewage = new SewageService();
    sewage.addTreatmentPlant(16, 16);
    sewage.updateConnectedPlants(grid);

    expect(sewage.getTreatmentCapacity()).toBe(0);
  });

  it('should count a reachable treatment plant', () => {
    const { sewage } = sewerCity();
    expect(sewage.getTreatmentCapacity()).toBeGreaterThan(0);
  });

  it('should exclude an unpowered school from school places', () => {
    const grid = new Grid(20, 20);
    for (let x = 1; x <= 8; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    const education = new EducationService();
    education.addSchool(3, 2, 'elementary');
    education.recalculateCoverage(grid);
    expect(education.getTotalCapacity('elementary')).toBeGreaterThan(0);

    education.updateOperationalStatus(() => false, () => false);

    expect(education.getTotalCapacity('elementary')).toBe(0);
  });
});

/**
 * Sewage coverage is precomputed into a Set at slow-slot 1, but operational
 * status is refreshed at slow-slot 2 — so a treatment plant that lost power
 * kept serving its whole catchment until the next cycle came round to slot 1.
 * Education recalculates immediately on a status change; sewage did not.
 */
function sewerCity(): { grid: Grid; sewage: SewageService } {
  const grid = new Grid(20, 20);
  for (let x = 1; x <= 8; x++) grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
  grid.setCell(4, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });

  const sewage = new SewageService();
  sewage.addTreatmentPlant(3, 0);
  sewage.updateConnectedPlants(grid);
  sewage.calculateCoverage(grid);
  return { grid, sewage };
}

describe('sewage coverage follows its plants losing power immediately', () => {
  it('should supply the house while the plant has power', () => {
    const { sewage } = sewerCity();
    expect(sewage.isSupplied(4, 2)).toBe(true);
  });

  it('should report a status change when a plant loses power', () => {
    const { sewage } = sewerCity();
    const changed = sewage.updateOperationalStatus(() => false, () => true);
    expect(changed).toBe(true);
  });

  it('should report no change when nothing moved', () => {
    // Negative control: a recalc on every tick would be a needless full flood.
    const { sewage } = sewerCity();
    sewage.updateOperationalStatus(() => true, () => true);
    expect(sewage.updateOperationalStatus(() => true, () => true)).toBe(false);
  });

  it('should drop coverage as soon as the recalc runs', () => {
    const { grid, sewage } = sewerCity();
    sewage.updateOperationalStatus(() => false, () => true);
    sewage.recalculateCoverage(grid);
    expect(sewage.isSupplied(4, 2)).toBe(false);
  });

  it('should restore coverage when power comes back', () => {
    const { grid, sewage } = sewerCity();
    sewage.updateOperationalStatus(() => false, () => true);
    sewage.recalculateCoverage(grid);
    sewage.updateOperationalStatus(() => true, () => true);
    sewage.recalculateCoverage(grid);
    expect(sewage.isSupplied(4, 2)).toBe(true);
  });

  it('should be wired into tickAllCivicServices, not just callable', () => {
    // The return value is useless if nobody acts on it. Losing the power plant
    // must drop sewage coverage on the very next civic-service tick, without
    // waiting for the slow cycle to come back round to slot 1.
    const state = createGameState(20, 20);
    for (let x = 1; x <= 8; x++) state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: 12 });
    state.grid.setCell(5, 2, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
    placeInfraOnGrid(state.grid, 7, 2, 'power', 0);
    state.power.addPlant({ x: 7, y: 2, output: 2000, pollution: 0, type: 'coal' });
    placeInfraOnGrid(state.grid, 2, 2, 'sewage', 0);
    state.sewage.addTreatmentPlant(2, 2);
    state.sewage.updateConnectedPlants(state.grid);
    state.power.calculateDemand(state.grid);
    state.power.calculateCoverage(state.grid);
    expect(state.power.isPowered(2, 2)).toBe(true);

    tickAllCivicServices(state);
    state.sewage.calculateCoverage(state.grid);
    expect(state.sewage.isSupplied(5, 2)).toBe(true);

    state.power.removePlant(7, 2);
    state.power.calculateCoverage(state.grid);
    tickAllCivicServices(state);

    expect(state.sewage.isSupplied(5, 2)).toBe(false);
  });
});

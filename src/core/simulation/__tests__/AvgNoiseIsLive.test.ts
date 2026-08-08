import { describe, it, expect } from 'vitest';
import { SimulationLoop } from '../SimulationLoop';
import { createGameState } from '../GameState';
import { ZoneType } from '../../grid/types';
import { RoadType } from '../../road/types';

/**
 * `getAvgNoise` reads the live pollution grid rather than `cell.noiseLevel`,
 * and that change shipped with no test at all.
 *
 * `noiseLevel` is written only by updateLandValue, which runs every
 * MEDIUM_TICK_INTERVAL (60 ticks), while growth and happiness run every 6. So
 * every residential building grown in the last ten slow ticks passes the
 * `buildingId > 0` filter carrying a noiseLevel of 0 and drags the city average
 * down — BUG-092 removed the empty-zoned-cell half of that dilution and left
 * this half in place (BUG-121).
 *
 * The observable difference is precisely a building whose cell field has not
 * caught up yet, so that is what these construct.
 */
function noisyStreet() {
  const state = createGameState(16, 16);
  for (let x = 1; x <= 12; x++) {
    state.grid.setCell(x, 5, { roadType: RoadType.HIGHWAY, roadFlags: 12, trafficDensity: 60 });
  }
  for (let x = 1; x <= 12; x++) {
    state.grid.setCell(x, 6, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  }
  return state;
}

/** getAvgNoise is private; this is the quantity, not the plumbing. */
const avgNoise = (loop: SimulationLoop): number =>
  (loop as unknown as { getAvgNoise(): number }).getAvgNoise();

/**
 * Traffic on the motorway row.
 *
 * Setting `cell.trafficDensity` by hand does not work: updatePollution calls
 * syncTrafficDensity first, which rewrites the field from
 * `traffic.getSegmentDensity` and therefore zeroes anything the fixture wrote.
 * The density has to come from the traffic simulation, so that is where it goes.
 */
function driveTheMotorway(state: ReturnType<typeof noisyStreet>, density: number): void {
  const traffic = state.traffic as unknown as { getSegmentDensity(key: string): number };
  traffic.getSegmentDensity = (key: string) => (key.endsWith(',5') ? density : 0);
}

/** Populate the live pollution grid without letting updateLandValue run — the
 *  window every freshly grown building sits in. */
function pollute(loop: SimulationLoop): void {
  (loop as unknown as { updatePollution(): void }).updatePollution();
}

describe('city noise is read live, not from the cell field', () => {
  it('should report the noise beside a motorway even before land value has run', () => {
    const state = noisyStreet();
    const loop = new SimulationLoop(state);

    driveTheMotorway(state, 60);
    pollute(loop);

    let anyCellField = 0;
    state.grid.forEachCell(c => { anyCellField += c.noiseLevel; });
    expect(anyCellField, 'the cell field must still be stale for this case to mean anything')
      .toBe(0);

    expect(avgNoise(loop), 'read the stale cell field instead of live pollution')
      .toBeGreaterThan(0);
  });

  it('should agree with the pollution grid it reads from', () => {
    const state = noisyStreet();
    const loop = new SimulationLoop(state);
    driveTheMotorway(state, 60);
    pollute(loop);

    let total = 0;
    let count = 0;
    for (let x = 1; x <= 12; x++) {
      total += state.pollution.getPollutionAt(x, 6).noise;
      count++;
    }
    expect(avgNoise(loop)).toBeCloseTo(total / count, 6);
  });

  it('should be zero in a city with no residential buildings', () => {
    // The control: without it, "greater than 0" would be satisfiable by
    // returning a constant.
    const state = createGameState(16, 16);
    for (let x = 1; x <= 12; x++) {
      state.grid.setCell(x, 5, { roadType: RoadType.HIGHWAY, roadFlags: 12, trafficDensity: 60 });
    }
    const loop = new SimulationLoop(state);
    (state.traffic as unknown as { getSegmentDensity(k: string): number })
      .getSegmentDensity = (key: string) => (key.endsWith(',5') ? 60 : 0);
    pollute(loop);
    expect(avgNoise(loop)).toBe(0);
  });

  it('should ignore a zoned cell with nothing built on it', () => {
    // BUG-092's half of the same dilution, kept as a control so the live read
    // cannot quietly reintroduce it.
    const withEmpties = noisyStreet();
    for (let x = 1; x <= 12; x++) {
      withEmpties.grid.setCell(x, 7, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 0 });
    }
    const loopA = new SimulationLoop(withEmpties);
    driveTheMotorway(withEmpties, 60);
    pollute(loopA);

    const builtOnly = noisyStreet();
    const loopB = new SimulationLoop(builtOnly);
    driveTheMotorway(builtOnly, 60);
    pollute(loopB);

    expect(avgNoise(loopA)).toBeCloseTo(avgNoise(loopB), 6);
  });
});

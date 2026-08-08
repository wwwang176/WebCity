import { describe, it, expect } from 'vitest';
import { Grid } from '../../grid/Grid';
import { ZoneType } from '../../grid/types';
import { BURNED, ABANDONED, placeInfraOnGrid } from '../InfraPlacement';
import { forEachGridPollutionSource } from '../../environment/GridPollutionSources';
import { avgResidentialMetric, avgResidentialAt } from '../../environment/CityMetrics';
import { createGameState } from '../../simulation/GameState';
import { getResidentialServiceRatios } from '../../service/ServiceCoverageQuery';
import type { PollutionSource } from '../../environment/Pollution';

/**
 * `buildingId > 0` is not the same question as "is there a working building
 * here". The `reserved` field distinguishes a live building from a burnt-out
 * shell (BURNED), an abandoned one (ABANDONED), and a secondary footprint cell
 * of a multi-cell facility (MULTI_CELL_OCCUPIED) — and isActiveZoneCell is the
 * shared predicate for all of it (BUG-073).
 *
 * Four consumers were still asking the bare question:
 *
 *  - GridPollutionSources: a factory that had burned down kept emitting its
 *    full 60 ground pollution and 40 noise, forever. Nothing ever clears it,
 *    so a fire in an industrial district permanently poisoned the land value
 *    around it and the developer's own 2%-per-tick cleanup could not help.
 *  - CityMetrics: burnt and abandoned houses were averaged into the city's
 *    pollution and noise figures — exactly the cells whose cached readings are
 *    stale, since updateLandValue skips them.
 *  - ServiceCoverageQuery: ruins counted toward the denominator of every
 *    service ratio, so the coverage panel dropped after a fire even though
 *    every inhabited house was still covered.
 */
function industrialGrid(reserved: number): Grid {
  const grid = new Grid(8, 8);
  grid.setCell(3, 3, { zoneType: ZoneType.INDUSTRIAL, buildingId: 15, reserved });
  return grid;
}

function pollutionFrom(grid: Grid): PollutionSource[] {
  const out: PollutionSource[] = [];
  forEachGridPollutionSource(grid, s => out.push(s));
  return out;
}

describe('a ruin is not a working building', () => {
  it('should emit industrial pollution from a live factory', () => {
    const sources = pollutionFrom(industrialGrid(0));
    expect(sources.filter(s => s.type === 'ground')).toHaveLength(1);
    expect(sources.filter(s => s.type === 'noise')).toHaveLength(1);
  });

  it('should emit nothing from a burned factory', () => {
    expect(pollutionFrom(industrialGrid(BURNED))).toHaveLength(0);
  });

  it('should emit nothing from an abandoned factory', () => {
    expect(pollutionFrom(industrialGrid(ABANDONED))).toHaveLength(0);
  });

  it('should emit nothing from a facility standing on industrial land', () => {
    // placeInfraOnGrid clears zoneType (BUG-074), but an old save restored
    // before that fix still has both set, and the secondary cells of any
    // multi-cell facility must never be treated as zone buildings either.
    const grid = new Grid(8, 8);
    placeInfraOnGrid(grid, 3, 3, 'police', 0);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cell = grid.getCell(3 + dx, 3 + dy)!;
        grid.setCell(3 + dx, 3 + dy, { zoneType: ZoneType.INDUSTRIAL, reserved: cell.reserved });
      }
    }
    expect(pollutionFrom(grid)).toHaveLength(0);
  });
});

describe('city averages ignore ruins', () => {
  function twoHouses(secondReserved: number): Grid {
    const grid = new Grid(8, 8);
    grid.setCell(1, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 10, reserved: 0 });
    grid.setCell(2, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, pollution: 90, reserved: secondReserved });
    return grid;
  }

  it('should average both houses while both are standing', () => {
    expect(avgResidentialMetric(twoHouses(0), c => c.pollution)).toBe(50);
  });

  it('should ignore a burned house', () => {
    expect(avgResidentialMetric(twoHouses(BURNED), c => c.pollution)).toBe(10);
  });

  it('should ignore an abandoned house in the positional average too', () => {
    const grid = twoHouses(ABANDONED);
    expect(avgResidentialAt(grid, (_x, _y) => 4)).toBe(4);
    // One cell counted, not two — a second cell would not change the mean of a
    // constant, so count it directly.
    let counted = 0;
    avgResidentialAt(grid, () => { counted++; return 0; });
    expect(counted).toBe(1);
  });
});

describe('service coverage ratios ignore ruins', () => {
  /** One powered live house near the plant, one ruin on the far side of the map. */
  function cityWithARuin(ruinReserved: number) {
    const state = createGameState(16, 16);
    state.grid.setCell(1, 2, { roadType: 2, roadFlags: 12 });
    state.grid.setCell(2, 2, { roadType: 2, roadFlags: 12 });
    state.power.addPlant({ x: 1, y: 2, output: 500, pollution: 0, type: 'coal' });
    state.grid.setCell(2, 1, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: 0 });
    state.grid.setCell(14, 14, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1, reserved: ruinReserved });
    state.power.calculateDemand(state.grid);
    state.power.calculateCoverage(state.grid);
    return state;
  }

  it('should report full power coverage when the only unpowered house is a ruin', () => {
    const state = cityWithARuin(BURNED);
    expect(state.power.isPowered(2, 1)).toBe(true);
    expect(state.power.isPowered(14, 14)).toBe(false);

    expect(getResidentialServiceRatios(state).poweredRatio).toBe(1);
  });

  it('should still count a live house that happens to be unpowered', () => {
    // Negative control: the ratio must drop for a real building, so "ignore
    // ruins" cannot be satisfied by ignoring unpowered houses generally.
    const state = cityWithARuin(0);
    expect(getResidentialServiceRatios(state).poweredRatio).toBe(0.5);
  });
});

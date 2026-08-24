import { describe, it, expect } from 'vitest';
import { createGameState } from '../GameState';
import { SimulationLoop } from '../SimulationLoop';
import { PolicyType } from '../../district/types';
import { ZoneType } from '../../grid/types';

/**
 * Changing the effects table is not the same as the simulation reading it. This goes end to
 * end: set the policy, run land value, read the cell back. Testing `PolicyManager` alone stays
 * green with `SimulationLoop` not wired at all.
 *
 * Buildings are planted **directly into the grid**. `updateLandValue` starts with
 * `if (cell.buildingId === 0) return`, and building growth requires power and water on the
 * cell, so a test city with only roads and zoning grows nothing, both runs get the initial
 * value, and the test checks equality rather than a decrease.
 *
 * Six ticks only: `updateLandValue` runs at tick 2, six ticks is enough, and it is short
 * enough not to be contaminated by the randomness of growth and relocation.
 */

/** Small Shop (COMMERCIAL_LOW). */
const SHOP = 7;

function landValueAt(withPolicy: boolean): number {
  const state = createGameState(30, 30);
  const loop = new SimulationLoop(state);
  for (let x = 5; x < 15; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
  for (let x = 6; x < 14; x++) {
    state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
  }
  const d = state.districts.createDistrict('D');
  for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
  if (withPolicy) state.policies.setPolicyLevel(d.id, PolicyType.TOURISM, 1);

  for (let i = 0; i < 6; i++) loop.tick();
  return state.grid.getCell(10, 11)!.landValue;
}

describe('條例的犯罪代價真的進到地價', () => {
  it('should lower land value inside the district that took the policy', () => {
    const plain = landValueAt(false);
    // Positive control: with land value never computed, both runs are 0 and `toBeLessThan`
    // is false too — but for an entirely different reason, so the two are asserted separately.
    expect(plain, '地價沒有被算過，這條測試等於空轉').toBeGreaterThan(0);
    expect(landValueAt(true), '開了帶犯罪代價的政策，地價卻沒有變差').toBeLessThan(plain);
  });

  it('should leave land value outside the district alone', () => {
    // The crime cost is per district. Charging it city-wide would strip the lever of its
    // spatial meaning.
    const outside = (withPolicy: boolean) => {
      const state = createGameState(30, 30);
      const loop = new SimulationLoop(state);
      for (let x = 5; x < 25; x++) state.grid.setCell(x, 10, { roadType: 1, roadFlags: 0b1111 });
      for (let x = 6; x < 24; x++) {
        state.grid.setCell(x, 11, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: SHOP });
      }
      const d = state.districts.createDistrict('D');
      // The district covers only the left half.
      for (let x = 6; x < 14; x++) state.districts.addCellToDistrict(d.id, x, 11);
      if (withPolicy) state.policies.setPolicyLevel(d.id, PolicyType.TOURISM, 1);
      for (let i = 0; i < 6; i++) loop.tick();
      return state.grid.getCell(20, 11)!.landValue;
    };
    expect(outside(true), '分區外的地價也被扣了').toBe(outside(false));
  });
});

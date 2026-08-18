import { describe, it, expect } from 'vitest';
import { createGameState } from '../../simulation/GameState';
import { SimulationLoop } from '../../simulation/SimulationLoop';
import { ZoneType } from '../../grid/types';
import { RoadType, RoadDirection } from '../../road/types';
import { UnifiedRoadLookup } from '../../road/UnifiedRoadLookup';
import { createSyncFakeWorker } from '../../traffic/__tests__/SyncFakeWorker';
import { PolicyType } from '../types';
import { POLICY_EFFECTS } from '../PolicyManager';

const HOME = { x: 6, y: 2 };
const WORK = { x: 16, y: 2 };

function build(stopA: number, stopB: number, charge: number) {
  const state = createGameState(60, 60);
  for (let x = 2; x <= 58; x++) {
    let flags = RoadDirection.EAST | RoadDirection.WEST;
    if (x === 2) flags = RoadDirection.EAST;
    if (x === 58) flags = RoadDirection.WEST;
    state.grid.setCell(x, 1, { roadType: RoadType.TWO_LANE, roadFlags: flags });
  }
  state.grid.setCell(HOME.x, HOME.y, { zoneType: ZoneType.RESIDENTIAL_LOW, buildingId: 1 });
  state.grid.setCell(WORK.x, WORK.y, { zoneType: ZoneType.COMMERCIAL_LOW, buildingId: 7 });
  const sA = state.bus.addStop(stopA, 1);
  const sB = state.bus.addStop(stopB, 1);
  const sC = state.bus.addStop(57, 1);
  state.bus.createRoute([sA, sB, sC], 1);
  for (let k = 0; k < 20; k++) {
    state.citizens.createCitizen({ age: 100, homeId: `${HOME.x},${HOME.y}`, workplaceId: `${WORK.x},${WORK.y}` });
  }
  if (charge > 1) {
    (POLICY_EFFECTS as Record<string, unknown>)[PolicyType.CONGESTION_CHARGE] = [{ driveDeterrence: charge }];
    const d = state.districts.createDistrict('Downtown');
    for (let x = 12; x <= 20; x++) for (let y = 0; y <= 4; y++) state.districts.addCellToDistrict(d.id, x, y);
    state.policies.setPolicyLevel(d.id, PolicyType.CONGESTION_CHARGE, 1);
  }
  state.clock.tick += 7;
  const loop = new SimulationLoop(state);
  loop.setRoadLookup(UnifiedRoadLookup.fromGrid(state.grid));
  loop.setPathfindingWorker(createSyncFakeWorker());
  for (let i = 0; i < 6; i++) loop.tick();
  const riders = sA.dailyRiders + sB.dailyRiders;
  return `cars=${state.traffic.getVehicleCount()} riders=${riders}`;
}

describe('probe3', () => {
  it('sweep', () => {
    for (const k of [1, 1.2, 1.3, 1.5, 1.75, 2.5]) {
      console.log(`deterrence ${k}  ${build(7, 15, k)}`);
    }
    expect(true).toBe(true);
  });
});

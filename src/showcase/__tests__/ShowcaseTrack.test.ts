import { describe, it, expect } from 'vitest';
import { showcaseTrackGrid, createShowcaseTrack, TRACK_CELLS } from '../track';
import { RailType, TrackDirection } from '../../core/rail/types';
import { TRACK_WIDTH } from '../../renderer/TrackRenderer';
import { CIVIC_LAYOUT_GAP } from '../civicLayout';
import { trainStationPlan } from '../../renderer/geometry/civic/models/transit';

/**
 * The showcase draws the **real** track.
 *
 * A station is built **on** track: `canPlaceTransportStop` requires `railType != 0` on the cell, and
 * `placeTransportStopOnGrid` changes only buildingId, reserved and zoneType — the track stays
 * untouched in the cell and `TrackRenderer` still draws the ballast, sleepers and rails there.
 *
 * So in game the rails do run through the station. What lacks them is the **showcase**: that page
 * holds buildings only, with no `TrackRenderer`, so the corridor through the middle of the station is
 * an empty grey band — which makes the station not drawing rails of its own (BUG-241) look like an
 * omission.
 *
 * The showcase is what gets the track, not the building: the station still may not draw rails of its
 * own.
 */
describe('展示區的軌道', () => {
  const mid = (TRACK_CELLS - 1) / 2;

  it('should lay a straight track through the middle cell', () => {
    const grid = showcaseTrackGrid();
    const cell = grid.getCell(mid, 0)!;
    expect(cell.railType, '中間那一格沒有軌道').toBe(RailType.STANDARD);
    expect(cell.railFlags & TrackDirection.WEST, '軌道沒有往西接').toBeTruthy();
    expect(cell.railFlags & TrackDirection.EAST, '軌道沒有往東接').toBeTruthy();
    // One direction only. A crossing would take two corridors out of the station and leave 4 m in
    // each of the four corners.
    expect(cell.railFlags & TrackDirection.NORTH, '軌道還往北接').toBe(0);
    expect(cell.railFlags & TrackDirection.SOUTH, '軌道還往南接').toBe(0);
  });

  it('should run the track out past both ends of the building', () => {
    // Laid on the station's cell alone, the track stops at the footprint's edge and reads as
    // decoration beside a platform rather than a line running through.
    expect(TRACK_CELLS, '軌道只有車站那一格').toBeGreaterThanOrEqual(3);
    // Nor too long: the showcase's spacing is `CIVIC_LAYOUT_GAP`, 2 cells, so the neighbouring
    // building's edge is only 2.5 cells from the station's cell centre — and track reaching past that
    // with its end extensions (`EDGE_EXTEND`, 0.5 cells each) sends a rail out through someone's
    // roof.
    const reach = TRACK_CELLS / 2 + 0.5;
    expect(reach, `軌道伸出 ${reach} 格，會壓到隔壁`)
      .toBeLessThan(1 / 2 + CIVIC_LAYOUT_GAP);
    const grid = showcaseTrackGrid();
    for (let x = 0; x < TRACK_CELLS; x++) {
      expect(grid.getCell(x, 0)!.railType, `第 ${x} 格沒有軌道`)
        .toBe(RailType.STANDARD);
    }
  });

  it('should centre the track on the building', () => {
    const group = createShowcaseTrack();
    expect(group.children.length, '沒有畫出任何軌道').toBeGreaterThan(0);
    // Cell centres are on integer coordinates, so the whole group shifts back by half its length to
    // put the middle cell on the origin.
    expect(group.position.x, '軌道沒有對準建築').toBeCloseTo(-mid, 9);
    expect(group.position.z, '軌道偏離了格心').toBeCloseTo(0, 9);
  });

  it('should offset the track to the slot the building stands on', () => {
    const group = createShowcaseTrack({ x: 12, z: -4 });
    expect(group.position.x).toBeCloseTo(12 - mid, 9);
    expect(group.position.z).toBeCloseTo(-4, 9);
  });

  it('should still leave the corridor to the real track', () => {
    // The showcase drawing it does not license the station to draw its own: two sets of rails would
    // never line up.
    expect(trainStationPlan.props.filter(v => v.tag === 'rail').length,
      '火車站又自己畫了鋼軌').toBe(0);
    const corridor = trainStationPlan.decals.find(d => d.tag === 'corridor')!;
    expect(corridor, '走廊那塊碴色不見了').toBeTruthy();
    expect(corridor.d / 2, '走廊比真的碴床還窄')
      .toBeGreaterThanOrEqual(TRACK_WIDTH);
  });
});

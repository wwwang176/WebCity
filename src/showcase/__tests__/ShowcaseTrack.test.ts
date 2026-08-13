import { describe, it, expect } from 'vitest';
import { showcaseTrackGrid, createShowcaseTrack, TRACK_CELLS } from '../track';
import { RailType, TrackDirection } from '../../core/rail/types';
import { TRACK_WIDTH } from '../../renderer/TrackRenderer';
import { CIVIC_LAYOUT_GAP } from '../civicLayout';
import { trainStationPlan } from '../../renderer/geometry/civic/models/transit';

/**
 * 展示區要畫**真的**那條軌道。
 *
 * 火車站蓋在軌道**上**：`canPlaceTransportStop` 要求那一格 `railType ≠ 0`，
 * 而 `placeTransportStopOnGrid` 只改 buildingId／reserved／zoneType —— 軌道
 * 原封不動留在格子裡，`TrackRenderer` 照樣在同一格畫出碴床、枕木與鋼軌。
 *
 * 所以遊戲裡的鋼軌本來就貫穿車站。看不到的是**展示區**：那一頁只放建築，
 * 沒有 `TrackRenderer`，於是車站中間那條走廊是一片空的灰帶 —— 而那讓
 * 「這一格不畫自己的鐵軌」（BUG-241）看起來像是漏畫。
 *
 * 補的是展示區，不是建築：這一格仍然不准自己畫鋼軌。
 */
describe('展示區的軌道', () => {
  const mid = (TRACK_CELLS - 1) / 2;

  it('should lay a straight track through the middle cell', () => {
    const grid = showcaseTrackGrid();
    const cell = grid.getCell(mid, 0)!;
    expect(cell.railType, '中間那一格沒有軌道').toBe(RailType.STANDARD);
    expect(cell.railFlags & TrackDirection.WEST, '軌道沒有往西接').toBeTruthy();
    expect(cell.railFlags & TrackDirection.EAST, '軌道沒有往東接').toBeTruthy();
    // 只讓一個方向。十字的話車站的走廊要讓出兩條，四個角各剩 4 m。
    expect(cell.railFlags & TrackDirection.NORTH, '軌道還往北接').toBe(0);
    expect(cell.railFlags & TrackDirection.SOUTH, '軌道還往南接').toBe(0);
  });

  it('should run the track out past both ends of the building', () => {
    // 只鋪車站那一格的話，軌道會在佔地邊界斷掉 —— 那讀起來是一段月台旁邊的
    // 裝飾，不是一條穿過去的線。
    expect(TRACK_CELLS, '軌道只有車站那一格').toBeGreaterThanOrEqual(3);
    // 但也不能鋪太長：展示區的間距是 `CIVIC_LAYOUT_GAP`（2 格），所以隔壁
    // 那一棟的邊緣離車站的格心只有 2.5 格 —— 軌道連同兩端的延伸段
    // （`EDGE_EXTEND`，各 0.5 格）壓過去的話，會有一條鐵軌從別人的屋頂穿出來。
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
    // 格心在整數座標上，所以整組要往回位移半條線，中間那一格才落在原點。
    expect(group.position.x, '軌道沒有對準建築').toBeCloseTo(-mid, 9);
    expect(group.position.z, '軌道偏離了格心').toBeCloseTo(0, 9);
  });

  it('should offset the track to the slot the building stands on', () => {
    const group = createShowcaseTrack({ x: 12, z: -4 });
    expect(group.position.x).toBeCloseTo(12 - mid, 9);
    expect(group.position.z).toBeCloseTo(-4, 9);
  });

  it('should still leave the corridor to the real track', () => {
    // 展示區畫得出來，不代表這一格可以自己畫。兩份鋼軌永遠對不齊。
    expect(trainStationPlan.props.filter(v => v.tag === 'rail').length,
      '火車站又自己畫了鋼軌').toBe(0);
    const corridor = trainStationPlan.decals.find(d => d.tag === 'corridor')!;
    expect(corridor, '走廊那塊碴色不見了').toBeTruthy();
    expect(corridor.d / 2, '走廊比真的碴床還窄')
      .toBeGreaterThanOrEqual(TRACK_WIDTH);
  });
});

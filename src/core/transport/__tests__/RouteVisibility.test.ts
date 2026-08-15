import { describe, it, expect } from 'vitest';
import {
  filterRoutesForViewMode,
  type TransportRouteRenderData,
} from '../collectTransportRoutes';
import { ViewMode, TRANSPORT_FOCUS_MODES, getFocusedStopKind } from '../../ViewMode';

/**
 * 路線連線是**進了 focus 才看的東西**。
 *
 * 原本反過來：正常視角畫全部四套系統的線，一進 focus 就全部清掉 —— 玩家點進
 * 「公車」想看路網，看到的是沒有線的地圖；平常想看城市，卻被四色虛線蓋滿。
 *
 * 這裡也守著「每一種交通工具都對得到自己的 focus 模式」——`TRANSPORT_FOCUS_MODES`
 * 是唯一那張表，新增一種交通工具時漏掉對應就會在這裡爆掉。
 */

function route(
  routeId: number, system: TransportRouteRenderData['system'],
): TransportRouteRenderData {
  return {
    routeId, system, color: 0xffffff,
    stops: [{ x: 1, y: 1 }, { x: 5, y: 5 }],
  };
}

const ALL_ROUTES: TransportRouteRenderData[] = [
  route(1, 'BUS'), route(2, 'BUS'),
  route(3, 'METRO'),
  route(4, 'RAIL'),
  route(5, 'FERRY'),
];

/**
 * 每一種交通工具的 focus 模式，該留下哪些路線 id。
 *
 * 捷運是空的：地下模式本來就有 `MetroTunnelRenderer` 畫出真正的隧道，地面再疊
 * 一條直線虛線只是同一件事的第二種畫法。鐵路留著 —— 軌道畫的是路線的形狀，
 * 連線畫的是停靠順序，兩者說的不是同一件事。
 */
const EXPECTED: [ViewMode, number[]][] = [
  [ViewMode.BUS_FOCUS, [1, 2]],
  [ViewMode.UNDERGROUND, []],
  [ViewMode.RAIL_FOCUS, [4]],
  [ViewMode.FERRY_FOCUS, [5]],
];

function idsFor(mode: ViewMode): number[] {
  return filterRoutesForViewMode(ALL_ROUTES, mode).map(r => r.routeId);
}

describe('哪個視角看得到路線連線', () => {
  it('should draw nothing in the normal view', () => {
    expect(idsFor(ViewMode.NORMAL), '正常視角被四色虛線蓋滿').toEqual([]);
  });

  it('should draw nothing in transfer focus', () => {
    // 轉乘聚焦有自己的一組疊圖線（`Game.showTransferRoute`），再畫一次系統路線
    // 只會把要看的那一條蓋掉。
    expect(idsFor(ViewMode.TRANSFER_FOCUS)).toEqual([]);
  });

  it.each(EXPECTED)('should draw only its own system in %s', (mode, expected) => {
    expect(idsFor(mode)).toEqual(expected);
  });

  it('should cover every transport focus mode', () => {
    // `TRANSPORT_FOCUS_MODES` 是唯一那張表。新增一種交通工具卻忘了在這裡對應，
    // 那個模式就會靜靜地一條線都不畫。
    const covered = new Set(EXPECTED.map(([mode]) => mode));
    for (const mode of Object.values(TRANSPORT_FOCUS_MODES)) {
      expect(covered.has(mode), `${mode} 沒有對應的路線系統`).toBe(true);
      expect(getFocusedStopKind(mode), `${mode} 對不回任何一種交通工具`).not.toBeNull();
    }
  });

  it('should still know underground focuses the metro', () => {
    // 不畫地面連線與「這個視角不聚焦捷運」是兩件事 —— 站點要不要保持原色是看
    // 後者。兩件事混成一個判斷的話，地下模式的捷運站會跟著漂白。
    expect(getFocusedStopKind(ViewMode.UNDERGROUND)).toBe('metro');
  });

  it('should not claim a focused vehicle for the plain views', () => {
    expect(getFocusedStopKind(ViewMode.NORMAL)).toBeNull();
    expect(getFocusedStopKind(ViewMode.TRANSFER_FOCUS)).toBeNull();
  });
});

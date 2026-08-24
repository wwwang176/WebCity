import { describe, it, expect } from 'vitest';
import {
  filterRoutesForViewMode,
  type TransportRouteRenderData,
} from '../collectTransportRoutes';
import { ViewMode, TRANSPORT_FOCUS_MODES, getFocusedStopKind } from '../../ViewMode';

/**
 * Route connectors are **something you enter a focus mode to see**.
 *
 * The inverse — all four systems drawn in the normal view and cleared on focus — leaves
 * anyone who clicks "bus" to inspect the network looking at a map with no lines, while the
 * ordinary city view is buried under four colours of dashes.
 *
 * These also pin that every transport type maps to its own focus mode.
 * `TRANSPORT_FOCUS_MODES` is the single table, so adding a transport type without a mapping
 * fails here.
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
 * Route ids each transport focus mode keeps.
 *
 * Metro is empty: `MetroTunnelRenderer` already draws the real tunnels in underground mode,
 * and a straight dashed line on the surface is a second drawing of the same thing. Rail is
 * kept: the track shows the route's shape, the connector shows its stopping order.
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
    // Transfer focus has its own overlay lines (`Game.showTransferRoute`); drawing the
    // system routes again would bury the one being inspected.
    expect(idsFor(ViewMode.TRANSFER_FOCUS)).toEqual([]);
  });

  it.each(EXPECTED)('should draw only its own system in %s', (mode, expected) => {
    expect(idsFor(mode)).toEqual(expected);
  });

  it('should cover every transport focus mode', () => {
    // `TRANSPORT_FOCUS_MODES` is the single table. A transport type added without a mapping
    // here silently draws no lines in its mode.
    const covered = new Set(EXPECTED.map(([mode]) => mode));
    for (const mode of Object.values(TRANSPORT_FOCUS_MODES)) {
      expect(covered.has(mode), `${mode} 沒有對應的路線系統`).toBe(true);
      expect(getFocusedStopKind(mode), `${mode} 對不回任何一種交通工具`).not.toBeNull();
    }
  });

  it('should still know underground focuses the metro', () => {
    // Drawing no ground connectors and not focusing the metro are two different things;
    // whether stops keep their colour depends on the second. Merging them into one check
    // washes out the metro stations in underground mode.
    expect(getFocusedStopKind(ViewMode.UNDERGROUND)).toBe('metro');
  });

  it('should not claim a focused vehicle for the plain views', () => {
    expect(getFocusedStopKind(ViewMode.NORMAL)).toBeNull();
    expect(getFocusedStopKind(ViewMode.TRANSFER_FOCUS)).toBeNull();
  });
});

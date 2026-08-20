import { describe, it, expect } from 'vitest';
import { BusSystem } from '../BusSystem';
import { MetroSystem } from '../MetroSystem';
import { TRANSPORT_SPEED } from '../BaseTransportSystem';
import type { LaneEdge } from '../../traffic/LaneGraph';

/**
 * 公車的壅塞要**逐路線**算，不是吃全城平均。
 *
 * 公車跟著幹道跑，而幹道本來就比平均塞。玩家 12 600 人的存檔實測:全城平均 0.211，
 * 那條公車路線沿線 **0.380**（1.8 倍），路線上最塞的一格已經是 1.0（塞死）。
 * 吃全城平均等於告訴玩家「你的公車沒有塞在車陣裡」，而畫面上它明明卡在那裡。
 *
 * `congestionLevel` 是系統層級的單一數字，逐路線的值疊在它上面 —— 問不到某條路線時
 * 退回它，那是「還沒算過」，不是「暢通」。
 */

const IMPACT = TRANSPORT_SPEED.CONGESTION_SPEED_IMPACT;

type Internals = { getSpeedMultiplier(routeId?: number): number };

describe('逐路線的壅塞', () => {
  it('should slow a route by its own congestion, not the city average', () => {
    const bus = new BusSystem();
    bus.congestionLevel = 0.2;
    bus.setRouteCongestion(7, 0.8);

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(7), '這條路線沒有用自己的壅塞值')
      .toBeCloseTo(1 - 0.8 * IMPACT, 6);
  });

  it('should fall back to the system-wide level for a route it has no number for', () => {
    // 退回全城平均而不是 0 —— 問不到是「還沒算過」，不是「暢通」。
    const bus = new BusSystem();
    bus.congestionLevel = 0.2;

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(99), '沒有逐路線的值時沒有退回全城平均')
      .toBeCloseTo(1 - 0.2 * IMPACT, 6);
    expect(inner.getSpeedMultiplier(), '完全沒給路線時也該退回全城平均')
      .toBeCloseTo(1 - 0.2 * IMPACT, 6);
  });

  it('should keep routes apart', () => {
    const bus = new BusSystem();
    bus.setRouteCongestion(1, 0.1);
    bus.setRouteCongestion(2, 0.9);

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(1)).toBeCloseTo(1 - 0.1 * IMPACT, 6);
    expect(inner.getSpeedMultiplier(2), '兩條路線拿到同一個值').toBeCloseTo(1 - 0.9 * IMPACT, 6);
  });

  it('should not touch systems that do not share the road', () => {
    // 捷運走自己的軌道。地面塞不塞跟它無關 —— 這正是玩家蓋捷運的理由。
    const metro = new MetroSystem();
    metro.congestionLevel = 0.9;
    metro.setRouteCongestion(1, 0.9);

    expect((metro as unknown as Internals).getSpeedMultiplier(1), '捷運被地面壅塞拖慢了')
      .toBe(1);
  });

  it('should still crawl at full gridlock', () => {
    // 塞死也還是要爬得動 —— 速度 0 會讓車永遠到不了下一站，班距變成無限大。
    //
    // 注意這**不是**在守 `MIN_CONGESTION_SPEED`:壅塞上限是 1，所以
    // `1 - 壅塞 × 0.5` 最低就是 0.5，那個下限目前摸不到（見常數本身的說明）。
    // 這裡守的是「塞死時速度倍率仍然是正的」。
    const bus = new BusSystem();
    bus.setRouteCongestion(1, 1);

    expect((bus as unknown as Internals).getSpeedMultiplier(1))
      .toBeCloseTo(1 - IMPACT, 6);
    expect((bus as unknown as Internals).getSpeedMultiplier(1)).toBeGreaterThan(0);
  });

  it('should forget a route once it is gone', () => {
    // 路線刪掉之後編號不會重用，不清的話會一直長。
    const bus = new BusSystem();
    bus.setRouteCongestion(1, 0.9);
    bus.clearRouteCongestion(1);

    const inner = bus as unknown as Internals;
    expect(inner.getSpeedMultiplier(1), '刪掉的路線還記著舊的壅塞值').toBe(1);
  });
});

describe('路線蓋到哪些格', () => {
  /**
   * 期望值**手寫**，不從 `getRouteCells` 自己算 —— 這一輪原本的接線測試就是用被測
   * 函式算期望值，兩邊一起變，永遠對得上。突變驗證照出來的。
   */
  function edge(from: string, to: string): LaneEdge {
    const [fx, fy] = from.split(',').map(Number);
    const [tx, ty] = to.split(',').map(Number);
    return {
      id: `${from}>${to}`,
      from: { id: 'f', cellKey: from, position: { x: fx!, y: fy! }, lane: 0, direction: 'east', type: 'exit', tangent: { tx: 1, ty: 0 } },
      to: { id: 't', cellKey: to, position: { x: tx!, y: ty! }, lane: 0, direction: 'east', type: 'entry', tangent: { tx: 1, ty: 0 } },
      length: 1, type: 'straight',
    } as LaneEdge;
  }

  it('should cover both ends of every edge', () => {
    // 只收起點那一端的話，每一段的**終點**會漏掉 —— 路線末端那一格永遠不算進壅塞。
    const bus = new BusSystem();
    const a = bus.addStop(0, 0);
    const b = bus.addStop(3, 0);
    const route = bus.createRoute([a, b]);
    let call = 0;
    bus.computeRouteSegments(route, () => {
      call++;
      return call === 1 ? [edge('0,0', '1,0'), edge('1,0', '2,0')] : [edge('2,0', '3,0')];
    });

    expect([...bus.getRouteCells(route.id)!].sort())
      .toEqual(['0,0', '1,0', '2,0', '3,0']);
  });

  it('should return null for a route with no segments', () => {
    expect(new BusSystem().getRouteCells(42)).toBeNull();
  });

  it('should hand back the very same set on a second ask', () => {
    const bus = new BusSystem();
    const route = bus.createRoute([bus.addStop(0, 0), bus.addStop(1, 0)]);
    bus.computeRouteSegments(route, () => [edge('0,0', '1,0')]);

    expect(bus.getRouteCells(route.id), '每次都重建一次集合')
      .toBe(bus.getRouteCells(route.id));
  });
});

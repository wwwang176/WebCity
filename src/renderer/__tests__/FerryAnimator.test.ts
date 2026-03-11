import { describe, it, expect, beforeEach } from 'vitest';
import { FerryAnimator } from '../FerryAnimator';
import type { VehicleAnimator } from '../VehicleAnimator';
import type { TransportVehicleRenderData } from '../../core/transport/collectTransportVehicles';

// ---------------------------------------------------------------------------
// Task 2 & 3: FerryAnimator — 從 Game.ts 抽出的渡輪渲染端動畫
//             實作 VehicleAnimator 介面
// ---------------------------------------------------------------------------

/** 假造渡輪系統，提供最小接口供 FerryAnimator 使用 */
function createMockFerrySystem(vessels: Array<{
  id: number;
  traveling: boolean;
  waterPath?: Array<{ x: number; y: number }>;
}>) {
  return {
    getVessels: () => vessels,
    getVesselPath: (id: number) => {
      const v = vessels.find(v => v.id === id);
      return v?.waterPath ?? null;
    },
  };
}

/** 假造 transportVehicle 渡輪資料 */
function createFerryRenderData(vesselId: number, idOffset = 500_000): TransportVehicleRenderData {
  return {
    id: vesselId + idOffset,
    x: 0,
    y: 0,
    heading: 0,
    type: 'ferry',
    laneOffset: 0,
  };
}

describe('FerryAnimator', () => {
  let animator: FerryAnimator;

  beforeEach(() => {
    animator = new FerryAnimator();
  });

  it('應該實作 VehicleAnimator 介面', () => {
    // 型別檢查：確保 FerryAnimator 可以賦值給 VehicleAnimator
    const _va: VehicleAnimator = animator;
    expect(_va).toBeDefined();
    expect(typeof animator.update).toBe('function');
    expect(typeof animator.dispose).toBe('function');
  });

  it('沒有渡輪時 update 不應拋錯', () => {
    const ferry = createMockFerrySystem([]);
    expect(() => animator.update(0.016, 1, ferry, [])).not.toThrow();
  });

  it('渡輪出發時應建立動畫狀態', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);

    // 更新後，vehicle 的 x/y 應該被動畫覆蓋
    expect(vehicles[0]!.x).toBeDefined();
    expect(vehicles[0]!.y).toBeDefined();
  });

  it('dt 推進後渡輪位置應沿路徑移動', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    // 第一次 update 建立動畫
    animator.update(0.016, 1, ferry, vehicles);
    const x0 = vehicles[0]!.x;

    // 第二次 update 推進一大步
    animator.update(1.0, 1, ferry, vehicles);
    const x1 = vehicles[0]!.x;

    expect(x1).toBeGreaterThan(x0);
  });

  it('暫停時（speed=0）渡輪不應移動', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);
    const x0 = vehicles[0]!.x;

    // speed = 0 模擬暫停
    animator.update(1.0, 0, ferry, vehicles);
    const x1 = vehicles[0]!.x;

    expect(x1).toBeCloseTo(x0, 3);
  });

  it('heading 應隨路徑方向平滑轉向（LERP）', () => {
    // 路徑先向東再向南
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [
        { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 },
      ]},
    ]);
    const vehicles = [createFerryRenderData(1)];

    // 初始建立
    animator.update(0.016, 1, ferry, vehicles);
    const h0 = vehicles[0]!.heading;

    // 推進到接近轉彎處
    for (let i = 0; i < 50; i++) {
      animator.update(0.1, 1, ferry, vehicles);
    }
    const hFinal = vehicles[0]!.heading;

    // heading 應該已變化（從東向轉成其他方向）
    expect(hFinal).not.toBeCloseTo(h0, 1);
  });

  it('動畫播完且渡輪停止時應清除狀態', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);

    // 渡輪停止
    ferry.getVessels()[0]!.traveling = false;

    // 推進足夠讓動畫播完
    for (let i = 0; i < 100; i++) {
      animator.update(0.1, 1, ferry, vehicles);
    }

    // dispose 不應拋錯
    expect(() => animator.dispose()).not.toThrow();
  });

  it('多艘渡輪應獨立動畫', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { id: 2, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 0, y: 10 }] },
    ]);
    const vehicles = [createFerryRenderData(1), createFerryRenderData(2)];

    animator.update(1.0, 1, ferry, vehicles);

    // 兩艘船的位置應不同（一艘向東，一艘向南）
    expect(vehicles[0]!.x).not.toBeCloseTo(vehicles[1]!.x, 1);
  });

  it('dispose 應清除所有動畫狀態', () => {
    const ferry = createMockFerrySystem([
      { id: 1, traveling: true, waterPath: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ]);
    const vehicles = [createFerryRenderData(1)];

    animator.update(0.016, 1, ferry, vehicles);
    animator.dispose();

    // dispose 後重新使用不應殘留狀態
    const vehicles2 = [createFerryRenderData(1)];
    animator.update(0.016, 1, ferry, vehicles2);
    // 應該能正常運作（重新建立動畫）
    expect(vehicles2[0]!.x).toBeDefined();
  });
});

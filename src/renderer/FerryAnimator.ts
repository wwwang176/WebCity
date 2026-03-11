/**
 * FerryAnimator — 渡輪渲染端動畫（從 Game.ts 抽出）。
 *
 * 實作 VehicleAnimator 介面，負責：
 * - 沿 A* 水路路徑做距離插值（純 LERP）
 * - heading 平滑轉向
 * - 動畫狀態管理（建立/清除）
 */
import {
  buildFerryPathInfo,
  interpolateFerryPath,
  type FerryPathInfo,
} from '../core/transport/FerryLinePath';
import type { VehicleAnimator } from './VehicleAnimator';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';

/** 渡輪視覺移動速度（世界單位/秒），與 tick 無關 */
const FERRY_VISUAL_SPEED = 1.5;
/** 渡輪轉向速率（弧度/秒），越大轉越快 */
const FERRY_TURN_RATE = 3.0;
/** 渡輪 ID 偏移量（對應 collectTransportVehicles） */
const FERRY_ID_OFFSET = 500_000;

interface FerryAnimState {
  pathInfo: FerryPathInfo;
  distance: number;
  heading: number;
}

/** 最小渡輪系統介面（避免直接依賴 FerrySystem 類別） */
export interface FerrySystemLike {
  getVessels(): Iterable<{ id: number; traveling: boolean }>;
  getVesselPath(id: number): ReadonlyArray<{ x: number; y: number }> | null;
}

export class FerryAnimator implements VehicleAnimator {
  private anims = new Map<number, FerryAnimState>();

  /**
   * 每幀推進渡輪動畫，並覆蓋 transportVehicles 中 ferry 的位置/heading。
   */
  update(
    dt: number,
    speed: number,
    ferrySystem: FerrySystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    // 同步動畫狀態：新出發時建立動畫，動畫播完才清除
    for (const v of ferrySystem.getVessels()) {
      if (v.traveling) {
        const waterPath = ferrySystem.getVesselPath(v.id);
        const existing = this.anims.get(v.id);
        // 新出發或新航段（path 參照不同）→ 建立新動畫
        if (waterPath && waterPath.length > 1 &&
            (!existing || existing.pathInfo.path !== waterPath)) {
          const info = buildFerryPathInfo(waterPath);
          const initPos = interpolateFerryPath(info, 0);
          this.anims.set(v.id, {
            pathInfo: info,
            distance: 0,
            heading: existing?.heading ?? initPos?.heading ?? 0,
          });
        }
      }
      // 不在 !traveling 時刪除 — 讓動畫播放到終點
    }

    // 推進渡輪動畫距離 + heading LERP & 清除已播完的動畫
    for (const [vesselId, anim] of this.anims) {
      anim.distance += FERRY_VISUAL_SPEED * dt * speed;
      // Heading LERP：取路徑目標朝向，平滑轉向
      const target = interpolateFerryPath(anim.pathInfo, anim.distance);
      if (target) {
        let diff = target.heading - anim.heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const t = Math.min(1, FERRY_TURN_RATE * dt * Math.max(speed, 0.001));
        anim.heading += diff * t;
      }
      if (anim.distance >= anim.pathInfo.totalLength) {
        const vessel = [...ferrySystem.getVessels()].find(v => v.id === vesselId);
        if (!vessel || !vessel.traveling) {
          this.anims.delete(vesselId);
        }
      }
    }

    // 覆蓋渡輪的視覺位置和朝向（使用 LERP heading）
    for (const vd of transportVehicles) {
      if (vd.type === 'ferry') {
        const vesselId = vd.id - FERRY_ID_OFFSET;
        const anim = this.anims.get(vesselId);
        if (anim) {
          const pos = interpolateFerryPath(anim.pathInfo, anim.distance);
          if (pos) {
            vd.x = pos.x;
            vd.y = pos.y;
            vd.heading = anim.heading;
          }
        }
      }
    }
  }

  dispose(): void {
    this.anims.clear();
  }
}

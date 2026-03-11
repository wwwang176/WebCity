/**
 * TrainAnimator — 火車渲染端動畫（每幀推進，不靠 tick）。
 *
 * 與 FerryAnimator 相同模式：
 * - 沿 A* 軌道路徑做距離插值
 * - heading 平滑轉向
 * - 覆蓋 transportVehicles 中 rail_train 的位置/heading
 */
import {
  buildFerryPathInfo,
  interpolateFerryPath,
  type FerryPathInfo,
} from '../core/transport/FerryLinePath';
import type { VehicleAnimator } from './VehicleAnimator';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';

/** 火車視覺移動速度（世界單位/秒），與 tick 無關 */
const TRAIN_VISUAL_SPEED = 4.0;
/** 火車轉向速率（弧度/秒） */
const TRAIN_TURN_RATE = 4.0;
/** 火車 ID 偏移量（對應 collectTransportVehicles） */
const RAIL_ID_OFFSET = 400_000;

interface TrainAnimState {
  pathInfo: FerryPathInfo;
  distance: number;
  heading: number;
  /** Reference to the path array to detect new segments. */
  pathRef: ReadonlyArray<{ x: number; y: number }>;
}

/** Minimal RailSystem interface to avoid tight coupling. */
export interface RailSystemLike {
  getTrains(): Iterable<{ id: number; traveling: boolean }>;
  getTrainTravelPath(trainId: number): ReadonlyArray<{ x: number; y: number }> | null;
}

export class TrainAnimator implements VehicleAnimator {
  private anims = new Map<number, TrainAnimState>();

  /**
   * 每幀推進火車動畫，並覆蓋 transportVehicles 中 rail_train 的位置/heading。
   */
  update(
    dt: number,
    speed: number,
    railSystem: RailSystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    // 同步動畫狀態：建立/清除
    const travelingSet = new Set<number>();
    for (const train of railSystem.getTrains()) {
      if (train.traveling) {
        travelingSet.add(train.id);
        const path = railSystem.getTrainTravelPath(train.id);
        const existing = this.anims.get(train.id);
        // 新出發或新航段 → 建立新動畫
        if (path && path.length > 1 &&
            (!existing || existing.pathRef !== path)) {
          const info = buildFerryPathInfo(path);
          const initPos = interpolateFerryPath(info, 0);
          this.anims.set(train.id, {
            pathInfo: info,
            distance: 0,
            heading: existing?.heading ?? initPos?.heading ?? 0,
            pathRef: path,
          });
        }
      }
    }

    // 清除不再 traveling 的動畫（到站即清除，讓 tick position 接管）
    for (const trainId of this.anims.keys()) {
      if (!travelingSet.has(trainId)) {
        this.anims.delete(trainId);
      }
    }

    // 推進動畫距離 + heading LERP
    for (const [, anim] of this.anims) {
      anim.distance += TRAIN_VISUAL_SPEED * dt * speed;

      // Heading LERP
      const target = interpolateFerryPath(anim.pathInfo, anim.distance);
      if (target) {
        let diff = target.heading - anim.heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const t = Math.min(1, TRAIN_TURN_RATE * dt * Math.max(speed, 0.001));
        anim.heading += diff * t;
      }
    }

    // 覆蓋 rail_train 的視覺位置和朝向
    for (const vd of transportVehicles) {
      if (vd.type === 'rail_train') {
        const trainId = vd.id - RAIL_ID_OFFSET;
        const anim = this.anims.get(trainId);
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

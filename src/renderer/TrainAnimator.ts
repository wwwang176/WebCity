/**
 * TrainAnimator — 火車渲染端動畫（每幀推進，不靠 tick）。
 *
 * 與地鐵 (MetroTunnelRenderer + advanceTrain) 相同模式：
 * - 從 routePaths 建構完整來回路徑（A→B→A 或 A→B→C→A）
 * - 沿路徑做距離插值，到站時暫停固定秒數
 * - heading 直接取自路徑切線方向（不做 LERP）
 * - 每列火車渲染 3 節車廂（機車頭 + 2 客車廂）
 */
import {
  buildFerryPathInfo,
  interpolateFerryPath,
  type FerryPathInfo,
} from '../core/transport/FerryLinePath';
import type { VehicleAnimator } from './VehicleAnimator';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';

/** 火車視覺移動速度（世界單位/秒） */
const TRAIN_VISUAL_SPEED = 9.0;
/** 火車 ID 偏移量（對應 collectTransportVehicles） */
const RAIL_ID_OFFSET = 400_000;
/** 車廂中心間距（世界單位） */
const CARRIAGE_SPACING = 0.33;
/** 每列火車車廂數（機車頭 + 拖車） */
const CARRIAGES_PER_TRAIN = 3;
/** 到站視覺停留秒數（與地鐵相同模式） */
const STATION_WAIT_TIME = 1.2;
/** 轉角圓弧插值點數 */
const ARC_POINTS = 6;
/** 外部火車生成間隔（秒） */
const EXTERNAL_TRAIN_INTERVAL = 12.0;
/** 外部火車 ID 起始偏移 */
const EXTERNAL_TRAIN_ID = 900_000;

interface TrainAnimState {
  /** 完整來回路徑（A→B→A 串接） */
  pathInfo: FerryPathInfo;
  /** 路徑上各站的距離 */
  stationDistances: number[];
  /** 目前在路徑上的距離 */
  distance: number;
  /** 正在停站 */
  atStation: boolean;
  /** 停站倒數（秒） */
  waitTimer: number;
  /** 下一站索引 */
  nextStationIdx: number;
  /** 所屬路線 ID（偵測路線變更） */
  routeId: number;
  /** 建立動畫時的路段數量（偵測站點增減） */
  segmentCount: number;
}

/** Minimal RailSystem interface to avoid tight coupling. */
export interface RailSystemLike {
  getTrains(): Iterable<{ id: number; traveling: boolean; routeId: number }>;
  /** Get parsed route path segments for building full round-trip animation. */
  getRoutePathPoints(routeId: number): ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> | null;
  /** Whether any station has external connection. */
  hasExternalConnection: boolean;
  /** Get a random path from map edge to an external station. */
  getExternalTrainPath(): ReadonlyArray<{ x: number; y: number }> | null;
}

/** External train animation state (edge → station → edge, then despawn). */
interface ExternalTrainAnim {
  pathInfo: FerryPathInfo;
  distance: number;
  stationDist: number;
  phase: 'incoming' | 'dwell' | 'outgoing';
  waitTimer: number;
}

/**
 * 將直角轉彎替換為圓弧插值點，使火車沿弧線行駛。
 * 直線段保持不變，僅在相鄰方向變化時插入四分之一圓弧。
 */
export function smoothTrackPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  radius = 0.5,
): Array<{ x: number; y: number }> {
  if (points.length < 3) return [...points];

  const R = radius;
  const result: Array<{ x: number; y: number }> = [];
  result.push(points[0]!);

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, curr = points[i]!, next = points[i + 1]!;
    const eDx = Math.sign(curr.x - prev.x);
    const eDy = Math.sign(curr.y - prev.y);
    const xDx = Math.sign(next.x - curr.x);
    const xDy = Math.sign(next.y - curr.y);

    // Straight — keep the point
    if (eDx === xDx && eDy === xDy) { result.push(curr); continue; }

    // Corner — generate quarter-circle arc
    const arcCx = curr.x + xDx * R - eDx * R;
    const arcCy = curr.y + xDy * R - eDy * R;
    const entryX = curr.x - eDx * R;
    const entryY = curr.y - eDy * R;
    const exitX = curr.x + xDx * R;
    const exitY = curr.y + xDy * R;

    const startA = Math.atan2(entryY - arcCy, entryX - arcCx);
    const endA = Math.atan2(exitY - arcCy, exitX - arcCx);
    let sweep = endA - startA;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;

    for (let j = 0; j <= ARC_POINTS; j++) {
      const a = startA + (j / ARC_POINTS) * sweep;
      result.push({ x: arcCx + R * Math.cos(a), y: arcCy + R * Math.sin(a) });
    }
  }

  result.push(points[points.length - 1]!);
  return result;
}

/**
 * 從路線的各段路徑建構完整來回路徑。
 * 例如 2 站: segments = [A→B, B→A] → 串接為 A→...→B→...→A
 */
function buildFullPath(segments: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): {
  pathInfo: FerryPathInfo;
  stationDistances: number[];
} | null {
  if (segments.length === 0) return null;

  const fullPoints: Array<{ x: number; y: number }> = [];
  const stationDistances: number[] = [0];
  let cumDist = 0;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    if (seg.length < 2) return null;

    // 平滑此段路徑（轉角→圓弧）
    const smoothed = smoothTrackPath(seg);

    // 第一段全部加入，後續段跳過第一點（與前段終點重複）
    const startIdx = s === 0 ? 0 : 1;
    for (let i = startIdx; i < smoothed.length; i++) {
      fullPoints.push(smoothed[i]!);
    }

    // 計算平滑後的段長度
    let segLen = 0;
    for (let i = 1; i < smoothed.length; i++) {
      const dx = smoothed[i]!.x - smoothed[i - 1]!.x;
      const dy = smoothed[i]!.y - smoothed[i - 1]!.y;
      segLen += Math.sqrt(dx * dx + dy * dy);
    }
    cumDist += segLen;

    // 此段終點 = 下一站（最後一段的終點 = 起點站，由 wrap 處理，不加入）
    if (s < segments.length - 1) {
      stationDistances.push(cumDist);
    }
  }

  if (fullPoints.length < 2) return null;

  const pathInfo = buildFerryPathInfo(fullPoints);
  return { pathInfo, stationDistances };
}

/**
 * Build a round-trip path for an external train: edge → station → edge.
 * Returns path info and the distance at the station (midpoint).
 */
function buildExternalPath(points: ReadonlyArray<{ x: number; y: number }>): {
  pathInfo: FerryPathInfo;
  stationDist: number;
} | null {
  if (points.length < 2) return null;

  const forward = smoothTrackPath(points);
  const reversed = [...points].reverse();
  const backward = smoothTrackPath(reversed);

  // Concatenate forward + backward, skip duplicate midpoint
  const fullPoints: Array<{ x: number; y: number }> = [...forward];
  for (let i = 1; i < backward.length; i++) {
    fullPoints.push(backward[i]!);
  }

  // Station distance = length of forward path
  let stationDist = 0;
  for (let i = 1; i < forward.length; i++) {
    const dx = forward[i]!.x - forward[i - 1]!.x;
    const dy = forward[i]!.y - forward[i - 1]!.y;
    stationDist += Math.sqrt(dx * dx + dy * dy);
  }

  if (fullPoints.length < 2) return null;
  const pathInfo = buildFerryPathInfo(fullPoints);
  return { pathInfo, stationDist };
}

export class TrainAnimator implements VehicleAnimator {
  private anims = new Map<number, TrainAnimState>();
  /** Reusable Set for active train IDs (avoids per-frame allocation). */
  private activeIds = new Set<number>();
  /** External train animation (at most one at a time). */
  private externalTrain: ExternalTrainAnim | null = null;
  /** Countdown to next external train spawn (seconds). */
  private externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL * 0.5; // first one sooner

  /**
   * 每幀推進火車動畫，並覆蓋 transportVehicles 中 rail_train 的位置/heading。
   * 同時為每列火車追加尾隨車廂（rail_carriage）。
   */
  update(
    dt: number,
    speed: number,
    railSystem: RailSystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    // ── 建立 / 清理動畫 ──
    const activeTrainIds = this.activeIds;
    activeTrainIds.clear();
    for (const train of railSystem.getTrains()) {
      activeTrainIds.add(train.id);

      // Invalidate stale animation when route paths change (e.g. station removed)
      const existing = this.anims.get(train.id);
      if (existing) {
        const currentSegments = railSystem.getRoutePathPoints(train.routeId);
        if (!currentSegments || currentSegments.length !== existing.segmentCount) {
          this.anims.delete(train.id);
        }
      }

      if (!this.anims.has(train.id)) {
        const segments = railSystem.getRoutePathPoints(train.routeId);
        if (segments && segments.length > 0) {
          const result = buildFullPath(segments);
          if (result) {
            this.anims.set(train.id, {
              pathInfo: result.pathInfo,
              stationDistances: result.stationDistances,
              distance: 0,
              atStation: true,
              waitTimer: STATION_WAIT_TIME,
              nextStationIdx: 1 % result.stationDistances.length,
              routeId: train.routeId,
              segmentCount: segments.length,
            });
          }
        }
      }
    }

    // 移除已不存在的火車動畫
    for (const trainId of this.anims.keys()) {
      if (!activeTrainIds.has(trainId)) {
        this.anims.delete(trainId);
      }
    }

    // ── 推進動畫（與地鐵 advanceTrain 相同邏輯）──
    for (const [, anim] of this.anims) {
      if (dt <= 0) continue;

      if (anim.atStation) {
        anim.waitTimer -= dt * speed;
        if (anim.waitTimer <= 0) {
          anim.atStation = false;
        }
        continue;
      }

      const prevDist = anim.distance;
      anim.distance += TRAIN_VISUAL_SPEED * dt * speed;

      // 目標距離：下一站
      const targetDist = anim.nextStationIdx === 0
        ? anim.pathInfo.totalLength
        : anim.stationDistances[anim.nextStationIdx]!;

      // 是否跨越下一站
      if (prevDist < targetDist && anim.distance >= targetDist) {
        anim.distance = anim.nextStationIdx === 0 ? 0 : targetDist;
        anim.atStation = true;
        anim.waitTimer = STATION_WAIT_TIME;
        anim.nextStationIdx = (anim.nextStationIdx + 1) % anim.stationDistances.length;
      }

      // 安全 wrap
      if (anim.distance >= anim.pathInfo.totalLength) {
        anim.distance -= anim.pathInfo.totalLength;
      }
    }

    // ── 覆蓋 rail_train 位置 + 追加尾隨車廂 ──
    // Push carriages directly to transportVehicles (no intermediate array).
    // Iterate only the original range to avoid processing just-added carriages.
    const originalLen = transportVehicles.length;

    for (let vi = 0; vi < originalLen; vi++) {
      const vd = transportVehicles[vi]!;
      if (vd.type !== 'rail_train') continue;

      const trainId = vd.id - RAIL_ID_OFFSET;
      const anim = this.anims.get(trainId);

      if (anim) {
        // 機車頭位置
        const pos = interpolateFerryPath(anim.pathInfo, anim.distance);
        if (pos) {
          vd.x = pos.x;
          vd.y = pos.y;
          vd.heading = pos.heading;
        }

        // 尾隨車廂沿路徑往後排列
        for (let c = 1; c < CARRIAGES_PER_TRAIN; c++) {
          const cDist = anim.distance - c * CARRIAGE_SPACING;
          const wrappedDist = cDist >= 0
            ? cDist
            : cDist + anim.pathInfo.totalLength;
          const cPos = interpolateFerryPath(anim.pathInfo, wrappedDist);
          if (cPos) {
            transportVehicles.push({
              id: vd.id + c * 10000,
              x: cPos.x,
              y: cPos.y,
              heading: cPos.heading,
              type: 'rail_carriage',
              laneOffset: 0,
            });
          }
        }
      } else {
        // 無動畫 → 車廂沿 heading 反方向排列
        for (let c = 1; c < CARRIAGES_PER_TRAIN; c++) {
          transportVehicles.push({
            id: vd.id + c * 10000,
            x: vd.x - Math.cos(vd.heading) * c * CARRIAGE_SPACING,
            y: vd.y + Math.sin(vd.heading) * c * CARRIAGE_SPACING,
            heading: vd.heading,
            type: 'rail_carriage',
            laneOffset: 0,
          });
        }
      }
    }

    // ── External train (edge → station → edge) ──
    this.updateExternalTrain(dt, speed, railSystem, transportVehicles);
  }

  // ── External train implementation ──

  private updateExternalTrain(
    dt: number,
    speed: number,
    railSystem: RailSystemLike,
    transportVehicles: TransportVehicleRenderData[],
  ): void {
    if (dt <= 0 || speed <= 0) return;

    // Spawn logic
    if (!this.externalTrain) {
      if (!railSystem.hasExternalConnection) return;
      this.externalSpawnTimer -= dt * speed;
      if (this.externalSpawnTimer > 0) return;

      const pathPoints = railSystem.getExternalTrainPath();
      if (!pathPoints) { this.externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL; return; }

      const result = buildExternalPath(pathPoints);
      if (!result) { this.externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL; return; }

      this.externalTrain = {
        pathInfo: result.pathInfo,
        distance: 0,
        stationDist: result.stationDist,
        phase: 'incoming',
        waitTimer: 0,
      };
    }

    const ext = this.externalTrain;

    // Animate
    if (ext.phase === 'incoming') {
      ext.distance += TRAIN_VISUAL_SPEED * dt * speed;
      if (ext.distance >= ext.stationDist) {
        ext.distance = ext.stationDist;
        ext.phase = 'dwell';
        ext.waitTimer = STATION_WAIT_TIME;
      }
    } else if (ext.phase === 'dwell') {
      ext.waitTimer -= dt * speed;
      if (ext.waitTimer <= 0) {
        ext.phase = 'outgoing';
      }
    } else {
      ext.distance += TRAIN_VISUAL_SPEED * dt * speed;
      if (ext.distance >= ext.pathInfo.totalLength) {
        this.externalTrain = null;
        this.externalSpawnTimer = EXTERNAL_TRAIN_INTERVAL;
        return;
      }
    }

    // Render: add locomotive + carriages to transportVehicles
    const pos = interpolateFerryPath(ext.pathInfo, ext.distance);
    if (!pos) return;

    transportVehicles.push({
      id: EXTERNAL_TRAIN_ID,
      x: pos.x, y: pos.y, heading: pos.heading,
      type: 'rail_train', laneOffset: 0,
    });

    for (let c = 1; c < CARRIAGES_PER_TRAIN; c++) {
      const cDist = Math.max(0, ext.distance - c * CARRIAGE_SPACING);
      const cPos = interpolateFerryPath(ext.pathInfo, cDist);
      if (cPos) {
        transportVehicles.push({
          id: EXTERNAL_TRAIN_ID + c * 10000,
          x: cPos.x, y: cPos.y, heading: cPos.heading,
          type: 'rail_carriage', laneOffset: 0,
        });
      }
    }
  }

  dispose(): void {
    this.anims.clear();
    this.externalTrain = null;
  }
}

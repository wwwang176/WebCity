/**
 * 交通路線連線的幾何。純邏輯模組，禁止 import Three.js。
 *
 * 站與站之間拱成拋物線。直線連線在密集的路網上會糊成一團 —— 兩條共用同一段的
 * 路線完全重疊，看不出哪一條經過哪一站；拱起來之後每一跳各自成弧，長短一眼
 * 看得出來。
 */

/** 世界座標的一點。`z` 對應格座標的 `y`（俯視的那一軸）。 */
export interface ArcPoint {
  x: number;
  y: number;
  z: number;
}

/** 格座標上的一站。 */
export interface StopPos {
  x: number;
  y: number;
}

export const ARC = {
  /**
   * 拱高佔跳距的比例。純粹是外觀值 —— 太小看不出是弧，太大會擋住底下的城市。
   */
  RISE_RATIO: 0.48,
  /**
   * 拱高的上限（格）。橫跨全城的一跳照比例算會拱到鏡頭外，而玩家要看的是
   * 「這條線經過哪些站」，不是弧本身。
   */
  RISE_MAX: 6.0,
  /** 每格取樣幾段。段數不夠的話弧會看起來是折線。 */
  SEGMENTS_PER_CELL: 2,
  /** 一跳最少／最多幾段。近距離的兩站也要圓，跨城的一跳不必無限細分。 */
  SEGMENTS_MIN: 8,
  SEGMENTS_MAX: 32,
} as const;

/** 這一跳要拱多高。 */
function riseFor(distance: number): number {
  return Math.min(ARC.RISE_MAX, distance * ARC.RISE_RATIO);
}

/** 這一跳要切幾段。 */
function segmentsFor(distance: number): number {
  const wanted = Math.round(distance * ARC.SEGMENTS_PER_CELL);
  return Math.max(ARC.SEGMENTS_MIN, Math.min(ARC.SEGMENTS_MAX, wanted));
}

/**
 * 一跳的取樣點，含頭尾兩端。
 *
 * 弧**只在垂直方向拱**：水平投影仍然是 from→to 的直線，否則線會繞過不相干的
 * 街區。高度用 `4h·t·(1−t)` —— 端點為 0、中點為 h 的那條拋物線。
 */
export function sampleRouteArc(from: StopPos, to: StopPos, baseY: number): ArcPoint[] {
  const dx = to.x - from.x;
  const dz = to.y - from.y;
  const distance = Math.hypot(dx, dz);
  const rise = riseFor(distance);
  const segments = segmentsFor(distance);

  const points: ArcPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      x: from.x + dx * t,
      y: baseY + rise * 4 * t * (1 - t),
      z: from.y + dz * t,
    });
  }
  return points;
}

/**
 * 整條路線的折線：逐跳取樣，最後繞回第一站。
 *
 * 接點只留一份 —— 每一跳都從自己的頭開始取樣，直接串起來的話中間那一站會出現
 * 兩次，虛線的節拍會在每個站牌打結。
 */
export function buildRoutePolyline(stops: readonly StopPos[], baseY: number): ArcPoint[] {
  if (stops.length < 2) return [];

  const points: ArcPoint[] = [];
  for (let i = 0; i < stops.length; i++) {
    const from = stops[i]!;
    const to = stops[(i + 1) % stops.length]!;
    const hop = sampleRouteArc(from, to, baseY);
    // 最後一點留給下一跳的頭，收尾那一跳則補上，讓環真的閉合。
    const end = i === stops.length - 1 ? hop.length : hop.length - 1;
    for (let j = 0; j < end; j++) points.push(hop[j]!);
  }
  return points;
}

/**
 * FerryLinePath — 渡輪渲染端路徑插值。
 *
 * 純邏輯模組，禁止 import Three.js。
 * 提供 A* 水路路徑的距離插值功能，供渲染端動畫使用。
 */

export interface FerryPathInfo {
  path: ReadonlyArray<{ x: number; y: number }>;
  segmentLengths: number[];
  cumulativeLengths: number[];  // [0, L0, L0+L1, ...]
  totalLength: number;
}

/**
 * 從 A* 路徑建立路徑資訊（預計算段長度）。
 */
export function buildFerryPathInfo(
  path: ReadonlyArray<{ x: number; y: number }>,
): FerryPathInfo {
  if (path.length < 2) {
    return { path, segmentLengths: [], cumulativeLengths: [0], totalLength: 0 };
  }

  const segmentLengths: number[] = [];
  const cumulativeLengths: number[] = [0];

  for (let i = 1; i < path.length; i++) {
    const dx = path[i]!.x - path[i - 1]!.x;
    const dy = path[i]!.y - path[i - 1]!.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(len);
    cumulativeLengths.push(cumulativeLengths[cumulativeLengths.length - 1]! + len);
  }

  return {
    path,
    segmentLengths,
    cumulativeLengths,
    totalLength: cumulativeLengths[cumulativeLengths.length - 1]!,
  };
}

/**
 * 在路徑上按距離插值，取得位置和朝向。
 */
export function interpolateFerryPath(
  info: FerryPathInfo,
  distance: number,
): { x: number; y: number; heading: number } | null {
  if (info.path.length < 2) return null;

  const d = Math.max(0, Math.min(distance, info.totalLength));

  for (let i = 0; i < info.path.length - 1; i++) {
    const segEnd = info.cumulativeLengths[i + 1]!;
    if (d <= segEnd || i === info.path.length - 2) {
      const segStart = info.cumulativeLengths[i]!;
      const segLen = info.segmentLengths[i]!;
      const t = segLen > 0 ? (d - segStart) / segLen : 0;

      const p0 = info.path[i]!;
      const p1 = info.path[i + 1]!;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      const heading = Math.atan2(-(p1.y - p0.y), p1.x - p0.x);

      return { x, y, heading };
    }
  }

  return null;
}

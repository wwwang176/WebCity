/**
 * MetroTunnelPath — 計算地鐵隧道的幾何路徑（純邏輯，禁止 import Three.js）。
 *
 * 供 MetroTunnelRenderer 讀取並生成 TubeGeometry。
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface TunnelSegment {
  from: Point2D;
  to: Point2D;
  /** 平滑曲線控制點（含 from 和 to） */
  controlPoints: Point2D[];
}

/**
 * 根據站點列表計算隧道段。
 * 地鐵路線為環形（% stops.length），但 2 站時正向和反向路徑重疊，只需 1 段。
 * 3+ 站時產生完整環形（N 段）。
 */
export function computeTunnelSegments(stations: readonly Point2D[]): TunnelSegment[] {
  if (stations.length < 2) return [];

  const segments: TunnelSegment[] = [];

  // 2 站：只需 A→B（B→A 視覺重疊）
  // 3+ 站：完整環形 A→B→C→...→A
  const count = stations.length === 2 ? 1 : stations.length;

  for (let i = 0; i < count; i++) {
    const from = stations[i]!;
    const to = stations[(i + 1) % stations.length]!;

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    segments.push({
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      controlPoints: [
        { x: from.x, y: from.y },
        { x: midX, y: midY },
        { x: to.x, y: to.y },
      ],
    });
  }

  return segments;
}

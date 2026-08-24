/**
 * Geometry of the metro tunnels, read by MetroTunnelRenderer to build its TubeGeometry.
 *
 * Pure logic: must not import Three.js.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface TunnelSegment {
  from: Point2D;
  to: Point2D;
  /** Smoothing control points, including `from` and `to`. */
  controlPoints: Point2D[];
}

/**
 * Tunnel segments for a list of stations.
 *
 * Metro lines are loops (% stops.length). With 2 stations the forward and return paths
 * overlap, so one segment is enough; with 3 or more the loop needs N segments.
 */
export function computeTunnelSegments(stations: readonly Point2D[]): TunnelSegment[] {
  if (stations.length < 2) return [];

  const segments: TunnelSegment[] = [];

  // 2 stations: A->B only, since B->A overlaps visually.
  // 3+ stations: the full loop A->B->C->...->A.
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

import type { LaneEdge } from './LaneGraph';
import { cubicBezierPoint, cubicBezierTangent } from './BezierPath';

type Point = { x: number; y: number };

/**
 * Interpolate position along a LaneEdge at parameter t ∈ [0,1].
 * Uses cubic Bezier if control points exist, otherwise linear interpolation.
 */
export function interpolateEdgePosition(edge: LaneEdge, t: number): Point {
  if (edge.bezierControl && edge.bezierControl.length >= 2) {
    return cubicBezierPoint(
      edge.from.position,
      edge.bezierControl[0]!,
      edge.bezierControl[1]!,
      edge.to.position,
      t,
    );
  }
  return {
    x: edge.from.position.x + (edge.to.position.x - edge.from.position.x) * t,
    y: edge.from.position.y + (edge.to.position.y - edge.from.position.y) * t,
  };
}

/**
 * Interpolate tangent (direction vector) along a LaneEdge at parameter t ∈ [0,1].
 * Uses cubic Bezier derivative if control points exist, otherwise constant linear direction.
 */
export function interpolateEdgeTangent(edge: LaneEdge, t: number): Point {
  if (edge.bezierControl && edge.bezierControl.length >= 2) {
    return cubicBezierTangent(
      edge.from.position,
      edge.bezierControl[0]!,
      edge.bezierControl[1]!,
      edge.to.position,
      t,
    );
  }
  return {
    x: edge.to.position.x - edge.from.position.x,
    y: edge.to.position.y - edge.from.position.y,
  };
}

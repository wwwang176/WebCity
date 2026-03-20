import type { LaneEdge } from './LaneGraph';
import { quadraticBezierPoint, quadraticBezierTangent, quadraticBezierPointInto, quadraticBezierTangentInto } from './BezierPath';

type Point = { x: number; y: number };

/**
 * Interpolate position along a LaneEdge at parameter t ∈ [0,1].
 * Uses quadratic Bezier if a control point exists, otherwise linear interpolation.
 */
export function interpolateEdgePosition(edge: LaneEdge, t: number): Point {
  if (edge.bezierControl && edge.bezierControl.length >= 1) {
    return quadraticBezierPoint(
      edge.from.position,
      edge.bezierControl[0]!,
      edge.to.position,
      t,
    );
  }
  return {
    x: edge.from.position.x + (edge.to.position.x - edge.from.position.x) * t,
    y: edge.from.position.y + (edge.to.position.y - edge.from.position.y) * t,
  };
}

/** Zero-alloc version: writes result into `out`. */
export function interpolateEdgePositionInto(edge: LaneEdge, t: number, out: Point): void {
  if (edge.bezierControl && edge.bezierControl.length >= 1) {
    quadraticBezierPointInto(edge.from.position, edge.bezierControl[0]!, edge.to.position, t, out);
    return;
  }
  out.x = edge.from.position.x + (edge.to.position.x - edge.from.position.x) * t;
  out.y = edge.from.position.y + (edge.to.position.y - edge.from.position.y) * t;
}

/**
 * Interpolate tangent (direction vector) along a LaneEdge at parameter t ∈ [0,1].
 * Uses quadratic Bezier derivative if a control point exists, otherwise constant linear direction.
 */
export function interpolateEdgeTangent(edge: LaneEdge, t: number): Point {
  if (edge.bezierControl && edge.bezierControl.length >= 1) {
    return quadraticBezierTangent(
      edge.from.position,
      edge.bezierControl[0]!,
      edge.to.position,
      t,
    );
  }
  return {
    x: edge.to.position.x - edge.from.position.x,
    y: edge.to.position.y - edge.from.position.y,
  };
}

/** Zero-alloc version: writes result into `out`. */
export function interpolateEdgeTangentInto(edge: LaneEdge, t: number, out: Point): void {
  if (edge.bezierControl && edge.bezierControl.length >= 1) {
    quadraticBezierTangentInto(edge.from.position, edge.bezierControl[0]!, edge.to.position, t, out);
    return;
  }
  out.x = edge.to.position.x - edge.from.position.x;
  out.y = edge.to.position.y - edge.from.position.y;
}

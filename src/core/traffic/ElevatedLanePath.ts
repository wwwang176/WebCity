/**
 * Build a simplified LaneEdge[] path from a cell-level path that may
 * contain elevated node keys ("x,y,level").
 *
 * Used when the full LaneGraph doesn't have elevated lane data.
 * Creates straight center-of-cell edges — no multi-lane, no Bezier.
 */

import { type LaneEdge, type ConnectionPoint } from './LaneGraph';
import { parsePosKeyUnsafe, parseLevelFromKey } from '../grid/GridHelpers';

/** Height per elevation level in world units — must match ElevatedRoadRenderer. */
const LEVEL_HEIGHT = 0.6;

/**
 * Convert a cell-key path (possibly with "x,y,level" keys) into a simple
 * LaneEdge[] that the TrafficSimulation can drive vehicles along.
 */
export function buildSimpleEdgePath(cellPath: string[]): LaneEdge[] {
  if (cellPath.length < 2) return [];

  const edges: LaneEdge[] = [];

  for (let i = 0; i < cellPath.length - 1; i++) {
    const fromKey = cellPath[i]!;
    const toKey = cellPath[i + 1]!;
    const from = parsePosKeyUnsafe(fromKey);
    const to = parsePosKeyUnsafe(toKey);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const tx = dx / len;
    const ty = dy / len;

    const dir = getDir(tx, ty);

    const fromPt: ConnectionPoint = {
      id: `${fromKey}:${dir}:0:exit`,
      position: { x: from.x, y: from.y },
      tangent: { tx, ty },
      cellKey: fromKey,
      lane: 0,
      direction: dir,
      type: 'exit',
    };

    const toPt: ConnectionPoint = {
      id: `${toKey}:${dir}:0:entry`,
      position: { x: to.x, y: to.y },
      tangent: { tx, ty },
      cellKey: toKey,
      lane: 0,
      direction: dir,
      type: 'entry',
    };

    edges.push({
      id: `${fromKey}->${toKey}`,
      from: fromPt,
      to: toPt,
      length: len,
      type: 'straight',
    });
  }

  return edges;
}

/** Check if a cell-key path contains any elevated node keys. */
export function hasElevatedKeys(cellPath: string[]): boolean {
  for (const key of cellPath) {
    if (parseLevelFromKey(key) > 0) return true;
  }
  return false;
}

/** Get the elevation level for a cell key (0 for ground). */
export function getElevationForKey(key: string): number {
  return parseLevelFromKey(key);
}

/** Get the world Y height for an elevation level. */
export function getElevationY(level: number): number {
  return level * LEVEL_HEIGHT;
}

type Direction = 'north' | 'south' | 'east' | 'west';

function getDir(tx: number, ty: number): Direction {
  if (Math.abs(tx) > Math.abs(ty)) return tx > 0 ? 'east' : 'west';
  return ty > 0 ? 'south' : 'north';
}

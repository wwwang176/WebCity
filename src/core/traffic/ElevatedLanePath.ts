/**
 * Build a simplified LaneEdge[] path from a cell-level path that may
 * contain elevated node keys ("x,y,level").
 *
 * Inserts boundary points around ramp cells so the height change is
 * concentrated within the ramp cell (not spread across two edges).
 */

import { type LaneEdge, type ConnectionPoint } from './LaneGraph';
import { parsePosKeyUnsafe, parseLevelFromKey } from '../grid/GridHelpers';

/** Height per elevation level in world units — must match ElevatedRoadRenderer. */
const LEVEL_HEIGHT = 0.6;

type Direction = 'north' | 'south' | 'east' | 'west';

interface Waypoint {
  x: number;
  y: number;
  cellKey: string; // original cell key (for elevation lookup)
}

/**
 * Convert a cell-key path (possibly with "x,y,level" keys) into a simple
 * LaneEdge[] that the TrafficSimulation can drive vehicles along.
 *
 * For ramp cells, inserts boundary waypoints so the slope is confined
 * to exactly one grid cell.
 */
export function buildSimpleEdgePath(cellPath: string[]): LaneEdge[] {
  if (cellPath.length < 2) return [];

  // Build waypoint list: cell centers + boundary points around ramps
  const waypoints: Waypoint[] = [];

  for (let i = 0; i < cellPath.length; i++) {
    const key = cellPath[i]!;
    const pos = parsePosKeyUnsafe(key);
    const level = parseLevelFromKey(key);
    const prevKey = i > 0 ? cellPath[i - 1]! : null;
    const nextKey = i < cellPath.length - 1 ? cellPath[i + 1]! : null;
    const prevLevel = prevKey ? parseLevelFromKey(prevKey) : level;
    const nextLevel = nextKey ? parseLevelFromKey(nextKey) : level;

    const isRamp = level !== prevLevel || level !== nextLevel;
    const isLevelTransition = (prevKey !== null && prevLevel !== level)
                           || (nextKey !== null && nextLevel !== level);

    if (isRamp && isLevelTransition) {
      // Insert boundary point BEFORE ramp center (between prev and this)
      if (prevKey !== null) {
        const prev = parsePosKeyUnsafe(prevKey);
        const bx = (prev.x + pos.x) / 2;
        const by = (prev.y + pos.y) / 2;
        // Use the LOWER level's key so elevation = lower level
        waypoints.push({ x: bx, y: by, cellKey: prevLevel < level ? prevKey : key });
      }

      // Ramp center
      waypoints.push({ x: pos.x, y: pos.y, cellKey: key });

      // Insert boundary point AFTER ramp center (between this and next)
      if (nextKey !== null) {
        const next = parsePosKeyUnsafe(nextKey);
        const bx = (pos.x + next.x) / 2;
        const by = (pos.y + next.y) / 2;
        // Use the HIGHER level's key so elevation = higher level
        waypoints.push({ x: bx, y: by, cellKey: nextLevel > level ? nextKey : key });
      }
    } else {
      // Normal cell: just add center
      waypoints.push({ x: pos.x, y: pos.y, cellKey: key });
    }
  }

  // Deduplicate waypoints at same position (can happen at boundaries)
  const deduped: Waypoint[] = [waypoints[0]!];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = deduped[deduped.length - 1]!;
    const cur = waypoints[i]!;
    if (Math.abs(cur.x - prev.x) > 0.01 || Math.abs(cur.y - prev.y) > 0.01) {
      deduped.push(cur);
    }
  }

  // Build edges from waypoints
  const edges: LaneEdge[] = [];
  for (let i = 0; i < deduped.length - 1; i++) {
    const from = deduped[i]!;
    const to = deduped[i + 1]!;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 0.1;
    const tx = dx / len;
    const ty = dy / len;
    const dir = getDir(tx, ty);

    const fromPt: ConnectionPoint = {
      id: `wp${i}:${dir}:0:exit`,
      position: { x: from.x, y: from.y },
      tangent: { tx, ty },
      cellKey: from.cellKey,
      lane: 0,
      direction: dir,
      type: 'exit',
    };

    const toPt: ConnectionPoint = {
      id: `wp${i + 1}:${dir}:0:entry`,
      position: { x: to.x, y: to.y },
      tangent: { tx, ty },
      cellKey: to.cellKey,
      lane: 0,
      direction: dir,
      type: 'entry',
    };

    edges.push({
      id: `wp${i}->wp${i + 1}`,
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

function getDir(tx: number, ty: number): Direction {
  if (Math.abs(tx) > Math.abs(ty)) return tx > 0 ? 'east' : 'west';
  return ty > 0 ? 'south' : 'north';
}

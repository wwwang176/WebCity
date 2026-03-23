/**
 * Build a simplified LaneEdge[] path from a cell-level path that may
 * contain elevated node keys ("x,y,level").
 *
 * For ramp cells, replaces center with two boundary waypoints so
 * the height change is confined to exactly one grid cell.
 */

import { type LaneEdge, type ConnectionPoint } from './LaneGraph';
import { parsePosKeyUnsafe, parseLevelFromKey } from '../grid/GridHelpers';

type Direction = 'north' | 'south' | 'east' | 'west';

interface Waypoint {
  x: number;
  y: number;
  cellKey: string;
}

/**
 * Convert a cell-key path into LaneEdges.
 * Ramp cells are replaced with boundary waypoints so the slope
 * spans exactly one grid cell.
 */
export function buildSimpleEdgePath(cellPath: string[]): LaneEdge[] {
  if (cellPath.length < 2) return [];

  const n = cellPath.length;

  // Pass 1: identify ramp cells
  // A ramp is an elevated cell (level > 0) that has a neighbor at a different level.
  const isRamp: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const lv = parseLevelFromKey(cellPath[i]!);
    if (lv === 0) { isRamp.push(false); continue; }
    const prevLv = i > 0 ? parseLevelFromKey(cellPath[i - 1]!) : lv;
    const nextLv = i < n - 1 ? parseLevelFromKey(cellPath[i + 1]!) : lv;
    isRamp.push(lv !== prevLv || lv !== nextLv);
  }

  // Pass 2: build waypoints
  const waypoints: Waypoint[] = [];
  for (let i = 0; i < n; i++) {
    if (isRamp[i]) {
      const pos = parsePosKeyUnsafe(cellPath[i]!);

      // Entry boundary (between prev cell and this ramp)
      if (i > 0) {
        const prev = parsePosKeyUnsafe(cellPath[i - 1]!);
        waypoints.push({
          x: (prev.x + pos.x) / 2,
          y: (prev.y + pos.y) / 2,
          cellKey: cellPath[i - 1]!, // neighbor's key → neighbor's level
        });
      }

      // Exit boundary (between this ramp and next cell)
      if (i < n - 1) {
        const next = parsePosKeyUnsafe(cellPath[i + 1]!);
        waypoints.push({
          x: (pos.x + next.x) / 2,
          y: (pos.y + next.y) / 2,
          cellKey: cellPath[i]!, // own key → this ramp's level
        });
      }
    } else {
      // Normal cell: emit center
      const pos = parsePosKeyUnsafe(cellPath[i]!);
      waypoints.push({ x: pos.x, y: pos.y, cellKey: cellPath[i]! });
    }
  }

  // Deduplicate waypoints at same position
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
  return level * 0.6;
}

function getDir(tx: number, ty: number): Direction {
  if (Math.abs(tx) > Math.abs(ty)) return tx > 0 ? 'east' : 'west';
  return ty > 0 ? 'south' : 'north';
}

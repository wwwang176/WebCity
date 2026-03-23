import { getLShapedPath } from '../grid/GridHelpers';
import { type ElevatedPosition, MAX_ELEVATION_LEVEL } from './types';

/**
 * Compute an elevated L-shaped path with automatic ramp generation.
 *
 * - Ramps are placed at the START of the path (ascending/descending from startLevel toward targetLevel).
 * - If endLevel is provided, descending ramps are also placed at the END of the path.
 * - Returns null if the path is too short to fit the required ramps.
 *
 * Pure function — no side effects.
 */
export function getElevatedPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  startLevel: number,
  targetLevel: number,
  endLevel?: number,
): ElevatedPosition[] | null {
  const basePath = getLShapedPath(from, to);
  if (basePath.length === 0) return null;

  const startDiff = targetLevel - startLevel;
  const startRampCount = Math.abs(startDiff);
  const startDir: 'up' | 'down' | null = startDiff > 0 ? 'up' : startDiff < 0 ? 'down' : null;

  const endDiff = endLevel !== undefined ? targetLevel - endLevel : 0;
  const endRampCount = Math.abs(endDiff);

  // Need startRamps + body(≥1) + endRamps + landing(1 if endRamps>0)
  const landingCount = endRampCount > 0 ? 1 : 0;
  const minLength = startRampCount + 1 + endRampCount + landingCount;

  if (basePath.length < minLength) return null;

  const result: ElevatedPosition[] = [];

  // --- Start ramps ---
  for (let i = 0; i < startRampCount; i++) {
    const pos = basePath[i]!;
    const step = Math.sign(startDiff);
    const level = startLevel + i * step;
    result.push({
      x: pos.x,
      y: pos.y,
      level,
      targetLevel: level + step,
      isRamp: true,
      rampDirection: startDir,
    });
  }

  // --- Body cells (between start ramps and end ramps + landing) ---
  const tailCount = endRampCount + landingCount;
  const bodyEnd = basePath.length - tailCount;
  for (let i = startRampCount; i < bodyEnd; i++) {
    const pos = basePath[i]!;
    result.push({
      x: pos.x,
      y: pos.y,
      level: targetLevel,
      targetLevel: targetLevel,
      isRamp: false,
      rampDirection: null,
    });
  }

  // --- End ramps ---
  if (endRampCount > 0 && endLevel !== undefined) {
    const endDir: 'up' | 'down' = endDiff > 0 ? 'down' : 'up';
    const endStep = -Math.sign(endDiff);
    for (let i = 0; i < endRampCount; i++) {
      const pos = basePath[bodyEnd + i]!;
      const level = targetLevel + i * endStep;
      result.push({
        x: pos.x,
        y: pos.y,
        level,
        targetLevel: level + endStep,
        isRamp: true,
        rampDirection: endDir,
      });
    }

    // --- Landing cell at endLevel ---
    const landingPos = basePath[basePath.length - 1]!;
    result.push({
      x: landingPos.x,
      y: landingPos.y,
      level: endLevel,
      targetLevel: endLevel,
      isRamp: false,
      rampDirection: null,
    });
  }

  return result;
}

export type { ElevatedPosition };

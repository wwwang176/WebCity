import { getLShapedPath } from '../grid/GridHelpers';
import { type ElevatedPosition, MAX_ELEVATION_LEVEL } from './types';

/**
 * Compute an elevated L-shaped path with automatic ramp generation.
 *
 * Layout: [origin] [ramp...] [body...] [ramp...] [landing]
 *
 * - The FIRST cell (origin) stays at startLevel, not a ramp — it is the
 *   existing ground road the user clicked on.
 * - Ramps begin at the SECOND cell onward.
 * - If endLevel is provided, the LAST cell (landing) stays at endLevel,
 *   and descending ramps are placed just before it.
 * - Returns null if the path is too short to fit origin + ramps + body.
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

  // Layout: origin(1) + startRamps + body(≥0 or ≥1) + endRamps + landing(1 if endRamps>0)
  // When origin is already at targetLevel (startRampCount=0), it serves as the body — no extra body needed.
  const landingCount = endRampCount > 0 ? 1 : 0;
  const minBodyCount = startRampCount > 0 ? 1 : 0;
  const minLength = 1 + startRampCount + minBodyCount + endRampCount + landingCount;

  if (basePath.length < minLength) return null;

  const result: ElevatedPosition[] = [];

  // --- Origin cell (stays at startLevel, not a ramp) ---
  const origin = basePath[0]!;
  result.push({
    x: origin.x,
    y: origin.y,
    level: startLevel,
    targetLevel: startLevel,
    isRamp: false,
    rampDirection: null,
  });

  // --- Start ramps (begin at index 1) ---
  for (let i = 0; i < startRampCount; i++) {
    const pos = basePath[1 + i]!;
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

  // --- Body cells ---
  const bodyStart = 1 + startRampCount;
  const tailCount = endRampCount + landingCount;
  const bodyEnd = basePath.length - tailCount;
  for (let i = bodyStart; i < bodyEnd; i++) {
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

  // --- End ramps + landing ---
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

    // Landing cell (stays at endLevel, not a ramp)
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

/**
 * Computes how many ramp cells are needed at the start and end of an
 * elevated-road ghost preview, based on the elevation state of the
 * drag start / end points.
 */
export function computePreviewRampCounts(
  pathLength: number,
  elevationLevel: number,
  startOnElevated: boolean,
  endOnGround: boolean,
): { startRampCount: number; endRampCount: number } {
  const startRampCount = startOnElevated
    ? 0
    : Math.min(elevationLevel, pathLength - 1);
  const endRampCount = endOnGround
    ? Math.min(elevationLevel, Math.max(0, pathLength - 2 - startRampCount))
    : 0;
  return { startRampCount, endRampCount };
}

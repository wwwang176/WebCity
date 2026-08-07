import { describe, it, expect } from 'vitest';
import { canAdvanceThrough, type SignalLookup, type CrossingLookup } from '../CanAdvance';

/** Lights that are red only when entering one specific cell. */
function lightsBlocking(blockedX: number, blockedY: number): SignalLookup {
  return { canPass: (_cx, _cy, nx, ny) => !(nx === blockedX && ny === blockedY) };
}
const allGreen: SignalLookup = { canPass: () => true };
const noCrossings: CrossingLookup = { isCrossingBlocked: () => false };
function crossingBlocking(x: number, y: number): CrossingLookup {
  return { isCrossingBlocked: (cx, cy) => cx === x && cy === y };
}

describe('canAdvanceThrough', () => {
  it('allows a straight move when everything is clear', () => {
    expect(canAdvanceThrough(allGreen, noCrossings, '2,3', '3,3')).toBe(true);
  });

  it('blocks a straight move on a red light at the destination', () => {
    expect(canAdvanceThrough(lightsBlocking(3, 3), noCrossings, '2,3', '3,3')).toBe(false);
  });

  // BUG-058: the intersection a turn skips over appears in neither cur nor next.
  it('blocks a turn on a red light at the skipped intersection', () => {
    expect(canAdvanceThrough(lightsBlocking(3, 3), noCrossings, '2,3', '3,4', '3,3')).toBe(false);
  });

  it('blocks a turn on a closed level crossing at the skipped intersection', () => {
    expect(canAdvanceThrough(allGreen, crossingBlocking(3, 3), '2,3', '3,4', '3,3')).toBe(false);
  });

  it('allows a turn when the skipped intersection is clear', () => {
    expect(canAdvanceThrough(lightsBlocking(9, 9), noCrossings, '2,3', '3,4', '3,3')).toBe(true);
  });

  it('still checks the destination cell for a turn edge', () => {
    expect(canAdvanceThrough(lightsBlocking(3, 4), noCrossings, '2,3', '3,4', '3,3')).toBe(false);
  });

  it('handles negative coordinates', () => {
    expect(canAdvanceThrough(lightsBlocking(-1, 0), noCrossings, '-2,0', '-1,0')).toBe(false);
  });
});

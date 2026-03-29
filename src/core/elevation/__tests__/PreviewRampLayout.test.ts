import { describe, it, expect } from 'vitest';
import { computePreviewRampCounts } from '../PreviewRampLayout';

describe('computePreviewRampCounts', () => {
  // S1: Ground → Air (start=ground, end=not ground road)
  it('S1: ground→air — start ramp only', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(6, 1, false, false);
    expect(startRampCount).toBe(1);
    expect(endRampCount).toBe(0);
  });

  // S2: Ground → Ground (both ends are ground roads)
  it('S2: ground→ground — start + end ramps', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(6, 1, false, true);
    expect(startRampCount).toBe(1);
    expect(endRampCount).toBe(1);
  });

  // S3: Elevated → Air (start already elevated, end empty)
  it('S3: elevated→air — no ramps', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(6, 1, true, false);
    expect(startRampCount).toBe(0);
    expect(endRampCount).toBe(0);
  });

  // S4: Elevated → Ground (start elevated, end ground road)
  it('S4: elevated→ground — end ramp only', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(6, 1, true, true);
    expect(startRampCount).toBe(0);
    expect(endRampCount).toBe(1);
  });

  // S5: Ground → Elevated (start ground, end already elevated)
  it('S5: ground→elevated — start ramp only', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(6, 1, false, false);
    expect(startRampCount).toBe(1);
    expect(endRampCount).toBe(0);
  });

  // S6: Elevated → Elevated
  it('S6: elevated→elevated — no ramps', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(6, 1, true, false);
    expect(startRampCount).toBe(0);
    expect(endRampCount).toBe(0);
  });

  // --- LV2 scenarios ---

  it('LV2 ground→ground — 2 start ramps + 2 end ramps', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(8, 2, false, true);
    expect(startRampCount).toBe(2);
    expect(endRampCount).toBe(2);
  });

  it('LV2 elevated→ground — 0 start + 2 end ramps', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(8, 2, true, true);
    expect(startRampCount).toBe(0);
    expect(endRampCount).toBe(2);
  });

  // --- Edge cases: short paths ---

  it('path too short for both ramps — prioritises start ramp', () => {
    // LV1, path=3: origin + 1 start ramp + 1 body. No room for end ramp.
    const { startRampCount, endRampCount } = computePreviewRampCounts(3, 1, false, true);
    expect(startRampCount).toBe(1);
    expect(endRampCount).toBe(0);
  });

  it('minimum viable ground→ground LV1 path (len=4)', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(4, 1, false, true);
    expect(startRampCount).toBe(1);
    expect(endRampCount).toBe(1);
  });

  it('elevated→ground with short path LV1 (len=3)', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(3, 1, true, true);
    expect(startRampCount).toBe(0);
    expect(endRampCount).toBe(1);
  });

  it('LV2 ground→ground short path (len=5) — endRampCount capped', () => {
    // startRampCount=2, available for end = 5-2-2 = 1
    const { startRampCount, endRampCount } = computePreviewRampCounts(5, 2, false, true);
    expect(startRampCount).toBe(2);
    expect(endRampCount).toBe(1);
  });

  it('path length 2 — minimal, no room for ramps beyond start', () => {
    const { startRampCount, endRampCount } = computePreviewRampCounts(2, 1, false, true);
    expect(startRampCount).toBe(1);
    expect(endRampCount).toBe(0);
  });

  // --- No overlap guarantee ---

  it('start and end ramps never overlap indices', () => {
    for (let pathLen = 2; pathLen <= 12; pathLen++) {
      for (let level = 1; level <= 3; level++) {
        for (const startElev of [true, false]) {
          for (const endGnd of [true, false]) {
            const { startRampCount, endRampCount } = computePreviewRampCounts(
              pathLen, level, startElev, endGnd,
            );
            // Start ramp indices: [1, startRampCount]
            // End ramp indices: [last - endRampCount, last - 1] where last = pathLen - 1
            const last = pathLen - 1;
            if (startRampCount > 0 && endRampCount > 0) {
              expect(startRampCount).toBeLessThan(last - endRampCount);
            }
          }
        }
      }
    }
  });
});

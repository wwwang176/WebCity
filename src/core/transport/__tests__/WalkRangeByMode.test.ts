import { describe, it, expect } from 'vitest';
import { WALK_RANGE_BY_TYPE, walkRangeFor } from '../WalkRange';
import { TransportType } from '../types';

/**
 * How far people will walk differs by transport type.
 *
 * A single global walk limit would give a bus stop and a metro station identical catchments.
 * People walk further for metro — it is fast, frequent and sparsely stationed — and less far
 * for an infrequent bus, whose stops are dense enough not to need it.
 *
 * These are hard "cannot reach" bounds, not behaviour rules. The finer trade-off is handled
 * by time itself: walking time enters the comparison and is scaled by a reluctance factor
 * (see `WalkWillingness`).
 */

describe('分運具的步行上限', () => {
  it('should let people walk further for rail than for a bus', () => {
    expect(walkRangeFor(TransportType.RAIL))
      .toBeGreaterThan(walkRangeFor(TransportType.BUS));
    expect(walkRangeFor(TransportType.METRO))
      .toBeGreaterThan(walkRangeFor(TransportType.BUS));
  });

  it('should put the ferry between the two', () => {
    // Ferry docks are sparse (they must be on water) but slow, which pulls both ways.
    expect(walkRangeFor(TransportType.FERRY))
      .toBeGreaterThan(walkRangeFor(TransportType.BUS));
    expect(walkRangeFor(TransportType.FERRY))
      .toBeLessThanOrEqual(walkRangeFor(TransportType.METRO));
  });

  it('should give every transport type a range', () => {
    for (const type of Object.values(TransportType)) {
      expect(walkRangeFor(type), `${type} 沒有步行上限`).toBeGreaterThan(0);
    }
  });

  it('should stay within what a person would actually walk', () => {
    for (const type of Object.values(TransportType)) {
      expect(walkRangeFor(type), `${type} 的上限大到沒有意義`).toBeLessThanOrEqual(12);
    }
  });

  it('should fall back for an unknown type', () => {
    expect(walkRangeFor('NOT_A_MODE' as TransportType)).toBe(WALK_RANGE_BY_TYPE.FALLBACK);
  });

  it('should expose the widest range for sizing the walk-coverage scan', () => {
    // Walk coverage is computed once per stop and must use the widest limit as its radius,
    // otherwise a metro station's coverage is truncated by the bus limit.
    const widest = Math.max(...Object.values(TransportType).map(walkRangeFor));
    expect(WALK_RANGE_BY_TYPE.WIDEST).toBe(widest);
  });
});

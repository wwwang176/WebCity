import { describe, it, expect } from 'vitest';
import { ElevationManager } from '../ElevationManager';
import { RoadType } from '../../road/types';

/**
 * BUG-143 established that elevated RAIL shares the layers map with elevated
 * ROAD, carrying `roadType: 0`, and that a lookup which does not ask about
 * roadType will happily hand back a rail deck when a road deck was wanted —
 * that was the whole reason getHighestRoadType exists.
 *
 * chooseStartLevel, written twelve lines below it, repeated the mistake: it
 * asks only whether SOMETHING occupies the level. The new tie-to-lower rule
 * then made that newly load-bearing (BUG-162).
 *
 * With a road deck at level 3, a rail deck at level 1 and level 2 selected,
 * both are one level away, the tie goes to the lower, and the run starts on the
 * railway. Since `segAtTargetLevel` is false, crossLevelStart is true, so
 * `existingAtStart` is non-null and the placement loop writes
 * `roadType: existingAtStart.roadType` — which is 0. The origin keeps
 * roadType NONE, UnifiedRoadLookup finds no road cell there, and the paid,
 * maintained, rendered viaduct has no lane edge to anything: the exact BUG-097
 * symptom the start-level rework was written to remove.
 */
const road = (roadType: RoadType) => ({
  roadType, roadFlags: 12, railType: 0, railFlags: 0,
  isRamp: false, rampAscendDirection: 0,
});
const rail = () => ({
  roadType: 0, roadFlags: 0, railType: 1, railFlags: 3,
  isRamp: false, rampAscendDirection: 0,
});

describe('an elevated run starts from a level that carries a road', () => {
  it('should pick the road deck over an equally close rail deck', () => {
    const em = new ElevationManager();
    em.set(5, 5, 3, road(RoadType.TWO_LANE));
    em.set(5, 5, 1, rail());

    // Both are one level from 2. The old tie-break took the lower — the rail.
    expect(em.chooseStartLevel(5, 5, 2, false)).toBe(3);
  });

  it('should never return a level that carries only rail', () => {
    const em = new ElevationManager();
    em.set(7, 7, 2, rail());
    // Nothing to start from at all; the caller's own guard handles that.
    expect(em.chooseStartLevel(7, 7, 1, false)).toBe(0);
  });

  it('should still prefer the ground when a ground road is there', () => {
    const em = new ElevationManager();
    em.set(4, 4, 3, road(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(4, 4, 1, true)).toBe(0);
  });

  it('should still take the level being built when a road is already on it', () => {
    const em = new ElevationManager();
    em.set(6, 6, 1, road(RoadType.TWO_LANE));
    em.set(6, 6, 3, road(RoadType.SIX_LANE));
    expect(em.chooseStartLevel(6, 6, 3, false)).toBe(3);
    expect(em.chooseStartLevel(6, 6, 1, false)).toBe(1);
  });

  it('should still break a genuine tie between two ROAD decks toward the lower', () => {
    // The cheaper structure, and the likelier intent.
    const em = new ElevationManager();
    em.set(8, 8, 1, road(RoadType.TWO_LANE));
    em.set(8, 8, 3, road(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(8, 8, 2, false)).toBe(1);
  });

  it('should ignore rail decks entirely when choosing between road decks', () => {
    const em = new ElevationManager();
    em.set(9, 9, 1, rail());
    em.set(9, 9, 2, rail());
    em.set(9, 9, 3, road(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(9, 9, 1, false)).toBe(3);
  });

  it('should treat a deck carrying both road and rail as a road deck', () => {
    // A level crossing on a viaduct is still somewhere a road can start.
    const em = new ElevationManager();
    em.set(10, 10, 1, { ...road(RoadType.TWO_LANE), railType: 1, railFlags: 3 });
    em.set(10, 10, 3, road(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(10, 10, 2, false)).toBe(1);
  });
});

import { describe, it, expect } from 'vitest';
import { ElevationManager } from '../ElevationManager';
import { RoadType } from '../../road/types';
import { RailType } from '../../rail/types';

/**
 * "The highest occupied level" answers a different question from the two places
 * that asked it.
 *
 *  - Pollution needs the noisiest ROAD tier at a position. Taking the highest
 *    level's roadType reports 0 whenever an elevated RAIL deck sits above an
 *    elevated road, which is exactly the BUG-099 symptom the elevated-tier
 *    lookup was added to fix: the motorway underneath becomes silent and the
 *    land under it keeps an inflated value.
 *  - Extending a viaduct needs the level nearest the one being built, so the
 *    ramps come out with the right count and direction.
 */
const seg = (roadType: number, railType = RailType.NONE) => ({
  roadType, roadFlags: 12, railType, railFlags: 0,
  isRamp: false, rampAscendDirection: 0,
});

describe('the elevated road tier at a position', () => {
  it('should report the road on a single deck', () => {
    const em = new ElevationManager();
    em.set(3, 3, 1, seg(RoadType.HIGHWAY));
    expect(em.getHighestRoadType(3, 3)).toBe(RoadType.HIGHWAY);
  });

  it('should still find the road under an elevated rail deck', () => {
    // Rail at level 2 has roadType NONE. Reading the highest level's roadType
    // silently reported "no road here".
    const em = new ElevationManager();
    em.set(3, 3, 1, seg(RoadType.HIGHWAY));
    em.set(3, 3, 2, seg(RoadType.NONE, RailType.STANDARD));

    expect(em.getHighestRoadType(3, 3)).toBe(RoadType.HIGHWAY);
  });

  it('should report the noisiest tier when two road decks stack', () => {
    const em = new ElevationManager();
    em.set(3, 3, 1, seg(RoadType.TWO_LANE));
    em.set(3, 3, 2, seg(RoadType.HIGHWAY));
    expect(em.getHighestRoadType(3, 3)).toBe(RoadType.HIGHWAY);
  });

  it('should report NONE where there is no elevated road at all', () => {
    const em = new ElevationManager();
    em.set(3, 3, 1, seg(RoadType.NONE, RailType.STANDARD));
    expect(em.getHighestRoadType(3, 3)).toBe(RoadType.NONE);
    expect(em.getHighestRoadType(9, 9)).toBe(RoadType.NONE);
  });
});

describe('choosing which level to extend from', () => {
  it('should pick the level being built when one is already there', () => {
    const em = new ElevationManager();
    em.set(3, 3, 1, seg(RoadType.TWO_LANE));
    em.set(3, 3, 2, seg(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(3, 3, 2, false)).toBe(2);
  });

  it('should pick the nearest level below the target', () => {
    const em = new ElevationManager();
    em.set(3, 3, 1, seg(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(3, 3, 2, false)).toBe(1);
  });

  it('should prefer the ground road over a viaduct passing far overhead', () => {
    // Ground road plus a level-3 deck, building at level 1: taking the highest
    // level started the path at 3 and descended, when the obvious intent — and
    // the cheaper structure — is to ramp up from the ground.
    const em = new ElevationManager();
    em.set(3, 3, 3, seg(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(3, 3, 1, true)).toBe(0);
  });

  it('should prefer the lower of two equally distant levels', () => {
    const em = new ElevationManager();
    em.set(3, 3, 1, seg(RoadType.TWO_LANE));
    em.set(3, 3, 3, seg(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(3, 3, 2, false)).toBe(1);
  });

  it('should fall back to ground when nothing is elevated here', () => {
    const em = new ElevationManager();
    expect(em.chooseStartLevel(3, 3, 2, true)).toBe(0);
  });

  it('should still answer with an elevated level when there is no ground road', () => {
    const em = new ElevationManager();
    em.set(3, 3, 2, seg(RoadType.TWO_LANE));
    expect(em.chooseStartLevel(3, 3, 1, false)).toBe(2);
  });
});

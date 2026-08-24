import { describe, it, expect } from 'vitest';
import { serviceDotColor, serviceDotHint, severityColor } from '../serviceDot';
import { NO_COVERAGE } from '../../../core/service/ServiceStatusView';

/** A cell at distance `cost` and load `load`. */
const cell = (cost: number, load = NO_COVERAGE) => ({ cost, load });

describe('服務圓點的顏色', () => {
  it('should stay grey where nothing reaches', () => {
    // Grey says nothing covers this cell while red says it is covered badly: the first calls for a new
    // facility, the second for a nearer one.
    expect(serviceDotColor(cell(NO_COVERAGE))).toBe('#616161');
  });

  it('should be green right next to an idle facility', () => {
    expect(serviceDotColor(cell(0, 0.2))).toBe('rgb(0,200,50)');
  });

  it('should go red next to a facility that is swamped', () => {
    // The hospital is next door at distance 0 and running at twice its capacity. On distance alone this
    // is the greenest cell there is.
    expect(serviceDotColor(cell(0, 2.0)), '爆量的設施旁邊還是綠的').toBe('rgb(255,0,50)');
  });

  it('should go red at the far edge of coverage too', () => {
    expect(serviceDotColor(cell(1, 0))).toBe('rgb(255,0,50)');
  });

  it('should take the worse of distance and load', () => {
    // A distance of 0.2 is good and a load of 1.5 is middling, so the load decides: 0.5, yellow.
    const byLoad = serviceDotColor(cell(0.2, 1.5));
    const byDistance = serviceDotColor(cell(0.5, 1.0));

    expect(byLoad, '負載沒有蓋過距離').toBe(byDistance);
  });

  it('should not let an unknown load lighten a bad distance', () => {
    // For a service with no notion of load, such as parks, the distance still speaks.
    expect(serviceDotColor(cell(1, NO_COVERAGE))).toBe('rgb(255,0,50)');
  });

  it('should be yellow in the middle', () => {
    expect(severityColor(0.5)).toBe('rgb(255,200,50)');
  });

  it('should clamp a severity that ran past 1', () => {
    expect(severityColor(3)).toBe('rgb(255,0,50)');
  });
});

describe('圓點的提示', () => {
  it('should say plainly when nothing reaches', () => {
    expect(serviceDotHint('Health', cell(NO_COVERAGE))).toBe('Health: no coverage');
  });

  it('should break the colour down into the two things it hides', () => {
    // The colour says how bad it is, not whether the cause is distance or load, and that decides where
    // to build.
    expect(serviceDotHint('Health', cell(0.25, 1.8)))
      .toBe('Health: distance 25% · facility load 180%');
  });

  it('should not invent a load for a utility', () => {
    // The grid has no notion of which plant supplies a cell or how full that plant is. Printing 0%
    // reads as the check having been made.
    expect(serviceDotHint('Power', cell(0))).toBe('Power: distance 0%');
  });
});

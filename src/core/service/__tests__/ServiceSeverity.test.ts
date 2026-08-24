import { describe, it, expect } from 'vitest';
import { serviceSeverity, loadSeverity, LOAD_SEVERITY, NO_COVERAGE } from '../ServiceSeverity';
import { loadRatioToDeathMultiplier, HOSPITAL_LOAD } from '../HealthService';

describe('負載換算成嚴重度', () => {
  it('should treat a facility that is exactly full as fine', () => {
    // Exactly full is not a problem but exactly right. Penalties only make sense from here on.
    expect(loadSeverity(LOAD_SEVERITY.FULL)).toBe(0);
    expect(loadSeverity(0.5)).toBe(0);
  });

  it('should treat double capacity as completely useless', () => {
    expect(loadSeverity(LOAD_SEVERITY.USELESS)).toBe(1);
    expect(loadSeverity(10)).toBe(1);
    expect(loadSeverity(Infinity), '容量 0 而有需求時是 Infinity').toBe(1);
  });

  it('should ramp linearly between the two', () => {
    expect(loadSeverity(1.5)).toBeCloseTo(0.5, 6);
    expect(loadSeverity(1.25)).toBeCloseTo(0.25, 6);
  });

  it('should call an unknown load fine rather than terrible', () => {
    // -1 means unavailable, as for parks with no notion of load. This value is compared against
    // distance, and a -1 mixed in would always lose, letting "unknown" override "known to be
    // far".
    expect(loadSeverity(NO_COVERAGE)).toBe(0);
  });

  it('should line up with the curve the game already uses for deaths', () => {
    // The two endpoints are not arbitrary: this is how the game already measures how bad
    // overload is. Diverging, the dots would turn red long after the death rate had climbed, or
    // the other way round.
    expect(LOAD_SEVERITY.FULL).toBe(HOSPITAL_LOAD.LOAD_THRESHOLD);
    expect(LOAD_SEVERITY.USELESS).toBe(HOSPITAL_LOAD.LOAD_MAX);

    // The point of severity 1 is exactly where a hospital stops affecting the death rate.
    expect(loadRatioToDeathMultiplier(LOAD_SEVERITY.USELESS)).toBe(HOSPITAL_LOAD.COVERED_MAX);
    expect(loadRatioToDeathMultiplier(LOAD_SEVERITY.FULL)).toBe(HOSPITAL_LOAD.COVERED_MIN);
  });
});

describe('這一格的服務有多糟', () => {
  it('should stay uncovered when there is no coverage, however empty the facilities are', () => {
    // "Nobody reaches me" and "served badly" are different: the first calls for a new facility
    // and the second for a nearer one.
    expect(serviceSeverity(NO_COVERAGE, 0)).toBe(NO_COVERAGE);
    expect(serviceSeverity(NO_COVERAGE, 5)).toBe(NO_COVERAGE);
  });

  it('should report a swamped facility next door as bad', () => {
    // The reported situation: the hospital is next door at distance 0 but running at twice
    // capacity. On distance alone this is 0, the greenest there is.
    expect(serviceSeverity(0, 2.0), '爆量的設施在隔壁還是綠的').toBe(1);
  });

  it('should report a far but empty facility as bad too', () => {
    expect(serviceSeverity(0.9, 0.1)).toBeCloseTo(0.9, 6);
  });

  it('should take the worse of the two, not the average', () => {
    // An average makes two mildly bad terms look worse than one very bad one.
    const bothMild = serviceSeverity(0.5, 1.5);   // distance 0.5, load 0.5
    const oneSevere = serviceSeverity(0.05, 2.0); // distance 0.05, load 1

    expect(bothMild).toBeCloseTo(0.5, 6);
    expect(oneSevere).toBe(1);
    expect(oneSevere).toBeGreaterThan(bothMild);
  });

  it('should not let an unknown load hide a bad distance', () => {
    // For a service with no load, parks among them, distance must still speak.
    expect(serviceSeverity(0.8, NO_COVERAGE)).toBeCloseTo(0.8, 6);
  });

  it('should clamp a distance ratio that ran past the budget', () => {
    expect(serviceSeverity(1.4, 0)).toBe(1);
  });
});

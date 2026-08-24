import { describe, it, expect } from 'vitest';
import { chooseModeMultiModal, type AvailableTransport } from '../ModeChoice';
import { TransportType, TransportMode } from '../types';
import type { MultiLegRoute } from '../MultiModalRouter';

/**
 * Walking costs real walking time, and walking is harder than sitting.
 *
 * Driving is one tile per tick in the model. Walking at the same rate makes a tile on foot
 * cost the same as a tile by car, so a long walk to a stop is free and the only thing
 * stopping it is the hard walk-range limit.
 *
 * Two separate effects:
 * - **Speed**: crossing a tile on foot takes longer than by car (9 km/h vs 60 km/h).
 * - **Reluctance**: a minute walking is harder than a minute seated. This affects
 *   **comparison** only; the reported commute time is the time actually spent, otherwise
 *   the commute overlay shows a number nobody spent.
 */

const WALK_SPEED = 0.15;
const NEUTRAL = { walkSpeed: WALK_SPEED, walkWeight: 1, congestionLevel: 0 , driveDeterrence: 1};

function transit(estimatedTime: number, walkTime: number): AvailableTransport {
  return { type: TransportType.BUS, estimatedTime, walkTime };
}

function multiLeg(totalTime: number, walkTime: number): MultiLegRoute {
  return {
    legs: [{ type: 'ride', fromX: 0, fromY: 0, toX: 1, toY: 0, estimatedTime: totalTime, transitType: TransportType.METRO }],
    totalTime,
    walkTime,
  };
}

describe('走路的時間', () => {
  it('should take longer to walk a cell than to drive it', () => {
    const walk = chooseModeMultiModal({ x: 0, y: 0 }, { x: 2, y: 0 }, [], [], NEUTRAL);
    expect(walk.mode).toBe(TransportMode.WALK);
    // Two tiles: 2 ticks by car, 2 / 0.15 = about 13.3 on foot.
    expect(walk.time, '走兩格跟開兩格一樣快').toBeGreaterThan(2);
    expect(walk.time).toBeCloseTo(2 / WALK_SPEED);
  });

  it('should scale with the walk speed it is given', () => {
    const slow = chooseModeMultiModal({ x: 0, y: 0 }, { x: 3, y: 0 }, [], [],
      { ...NEUTRAL, walkSpeed: 0.1 });
    const fast = chooseModeMultiModal({ x: 0, y: 0 }, { x: 3, y: 0 }, [], [],
      { ...NEUTRAL, walkSpeed: 1 });
    expect(slow.time).toBeGreaterThan(fast.time);
  });
});

describe('步行的不情願權重', () => {
  const home = { x: 0, y: 0 };
  const work = { x: 40, y: 0 };

  it('should not change the reported time', () => {
    // Weighting is for comparison only. The reported value must be the time actually spent,
    // otherwise the commute overlay shows a number nobody spent.
    const patient = chooseModeMultiModal(home, work, [transit(30, 20)], [],
      { ...NEUTRAL, walkWeight: 1 , driveDeterrence: 1});
    const impatient = chooseModeMultiModal(home, work, [transit(30, 20)], [],
      { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1});

    expect(patient.mode).toBe(TransportMode.BUS);
    expect(patient.time).toBe(30);
    if (impatient.mode === TransportMode.BUS) expect(impatient.time).toBe(30);
  });

  it('should turn someone away from a trip that is mostly walking', () => {
    // Driving takes 40 ticks. Transit is nominally 30, but 25 of them are on foot, so for
    // someone impatient about walking that is 25 * 2.5 + 5 = 67.5, worse than driving.
    const mostlyWalking = [transit(30, 25)];

    expect(
      chooseModeMultiModal(home, work, mostlyWalking, [], { ...NEUTRAL, walkWeight: 1 , driveDeterrence: 1}).mode,
      '不加權時本來就不搭，這條測試等於沒測',
    ).toBe(TransportMode.BUS);

    expect(
      chooseModeMultiModal(home, work, mostlyWalking, [], { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1}).mode,
      '一趟通勤有八成在走路，還是照搭不誤',
    ).toBe(TransportMode.DRIVE);
  });

  it('should leave a trip that is mostly riding alone', () => {
    // The same 30 ticks, but only 3 on foot, so weighting barely moves it.
    const mostlyRiding = [transit(30, 3)];
    expect(
      chooseModeMultiModal(home, work, mostlyRiding, [], { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1}).mode,
      '走幾步就到站的路線也被權重趕跑了',
    ).toBe(TransportMode.BUS);
  });

  it('should apply to transfer routes too', () => {
    const walky = multiLeg(30, 25);
    expect(
      chooseModeMultiModal(home, work, [], [walky], { ...NEUTRAL, walkWeight: 1 , driveDeterrence: 1}).mode,
    ).toBe(TransportMode.METRO);
    expect(
      chooseModeMultiModal(home, work, [], [walky], { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1}).mode,
      '轉乘路線的步行段沒有被加權',
    ).toBe(TransportMode.DRIVE);
  });

  it('should compare single-transit and transfers on the same scale', () => {
    // The transfer is nominally faster but almost entirely on foot, so weighting must put it
    // behind the single-mode option.
    const single = transit(32, 4);
    const transfer = multiLeg(30, 24);
    const choice = chooseModeMultiModal(home, work, [single], [transfer],
      { ...NEUTRAL, walkWeight: 2.5 , driveDeterrence: 1});

    expect(choice.multiLeg, '兩種走法沒有放在同一把尺上比').toBeNull();
    expect(choice.mode).toBe(TransportMode.BUS);
  });
});

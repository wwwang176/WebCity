import { describe, it, expect } from 'vitest';
import { chooseModeMultiModal, MODE_CHOICE } from '../ModeChoice';
import { TransportMode, TransportType } from '../types';
import type { MultiLegRoute, TransitLeg } from '../MultiModalRouter';

/**
 * Neutral mode-choice parameters: one tile per tick on foot, no reluctance weighting.
 *
 * This file checks the arithmetic of the selection logic itself. Walking speed and weight
 * are covered separately by `WalkCostInModeChoice.test.ts`.
 */
function neutral(congestionLevel: number) {
  return { congestionLevel, walkSpeed: 1, walkWeight: 1 , driveDeterrence: 1};
}


/**
 * Choosing a mode already requires computing how long each option takes, so the chosen
 * option's time is reported alongside the mode rather than discarded.
 *
 * Commute time is the most direct thing a citizen feels about the city: it reflects
 * distance, congestion and transit at once. Job changes and relocations decide on it rather
 * than on straight-line distance, which cannot tell living next to a metro station apart
 * from living nowhere.
 */

function rideLeg(time: number, type = TransportType.METRO): TransitLeg {
  return {
    type: 'ride', fromX: 0, fromY: 0, toX: 10, toY: 0,
    estimatedTime: time, transitType: type, routeIdx: 0, boardStopIdx: 0, alightStopIdx: 1,
  };
}

describe('通勤時間要跟著交通方式一起回傳', () => {
  it('should report how long walking takes', () => {
    const r = chooseModeMultiModal({ x: 0, y: 0 }, { x: 2, y: 1 }, [], [], neutral(0));
    expect(r.mode).toBe(TransportMode.WALK);
    expect(r.time, '走 3 格的時間').toBe(3);
  });

  it('should report drive time including congestion', () => {
    // Drive time = distance * (1 + congestion). Congestion lengthens the same trip, which is
    // what the player should feel.
    const clear = chooseModeMultiModal({ x: 0, y: 0 }, { x: 20, y: 0 }, [], [], neutral(0));
    const jammed = chooseModeMultiModal({ x: 0, y: 0 }, { x: 20, y: 0 }, [], [], neutral(1));

    expect(clear.mode).toBe(TransportMode.DRIVE);
    expect(clear.time).toBe(20);
    expect(jammed.time, '壅塞沒有反映在通勤時間上').toBe(40);
  });

  it('should report the transit time when transit wins', () => {
    const r = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 40, y: 0 },
      [{ type: TransportType.METRO, estimatedTime: 15, walkTime: 0 }],
      [], neutral(0),
    );
    expect(r.mode).toBe(TransportMode.METRO);
    expect(r.time, '搭捷運的時間沒有回傳').toBe(15);
  });

  it('should report the multi-leg total when transferring wins', () => {
    const route: MultiLegRoute = { legs: [rideLeg(8), rideLeg(9)], totalTime: 17, walkTime: 0 };
    const r = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 40, y: 0 },
      [{ type: TransportType.BUS, estimatedTime: 30, walkTime: 0 }],
      [route], neutral(0),
    );
    expect(r.multiLeg).toBe(route);
    expect(r.time).toBe(17);
  });

  it('should report the transit time even when transit is the slower choice', () => {
    // Transit is chosen as long as it is no more than 1.5x slower than driving, and the
    // citizen spends that slower time. Reporting the driving time would make job changes and
    // relocations believe they are better off than they are.
    const driveTime = 20;
    const transitTime = driveTime * MODE_CHOICE.TRANSIT_TIME_MULTIPLIER_THRESHOLD - 1;
    const r = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 20, y: 0 },
      [{ type: TransportType.METRO, estimatedTime: transitTime, walkTime: 0 }],
      [], neutral(0),
    );
    expect(r.mode).toBe(TransportMode.METRO);
    expect(r.time).toBe(transitTime);
  });

  it('should let a metro line cut the commute of a distant citizen', () => {
    // The whole point: same home, same job, and the commute shortens once a metro exists.
    const home = { x: 0, y: 0 };
    const work = { x: 45, y: 0 };
    const before = chooseModeMultiModal(home, work, [], [], neutral(0.5));
    const after = chooseModeMultiModal(
      home, work, [{ type: TransportType.METRO, estimatedTime: 20, walkTime: 0 }], [], neutral(0.5),
    );

    expect(before.mode).toBe(TransportMode.DRIVE);
    expect(after.time, '蓋了捷運通勤時間沒有變短').toBeLessThan(before.time);
  });
});

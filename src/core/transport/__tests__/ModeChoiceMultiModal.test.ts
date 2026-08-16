import { describe, it, expect } from 'vitest';
import { chooseModeMultiModal } from '../ModeChoice';
import { TransportMode, TransportType } from '../types';
import type { MultiLegRoute, TransitLeg } from '../MultiModalRouter';

/**
 * 中性的模式選擇參數：走路一格一 tick、不加不情願權重。
 *
 * 這一檔驗的是選擇邏輯本身的算術。步行速度與權重的效果由
 * `WalkCostInModeChoice.test.ts` 單獨驗。
 */
function neutral(congestionLevel: number) {
  return { congestionLevel, walkSpeed: 1, walkWeight: 1 };
}


function walkLeg(fx: number, fy: number, tx: number, ty: number, time: number): TransitLeg {
  return { type: 'walk', fromX: fx, fromY: fy, toX: tx, toY: ty, estimatedTime: time };
}

function rideLeg(
  fx: number, fy: number, tx: number, ty: number,
  time: number, transitType: TransportType, routeIdx = 0,
): TransitLeg {
  return {
    type: 'ride', fromX: fx, fromY: fy, toX: tx, toY: ty,
    estimatedTime: time, transitType, routeIdx, boardStopIdx: 0, alightStopIdx: 1,
  };
}

function makeMultiLeg(legs: TransitLeg[], totalTime: number): MultiLegRoute {
  const walkTime = legs.reduce((s, l) => l.type === 'walk' ? s + l.estimatedTime : s, 0);
  return { legs, totalTime, walkTime };
}

describe('chooseModeMultiModal', () => {
  it('walks for short distances', () => {
    const result = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 1, y: 1 },
      [{ type: TransportType.BUS, estimatedTime: 1, walkTime: 0 }],
      [],
      neutral(0),
    );
    expect(result.mode).toBe(TransportMode.WALK);
    expect(result.multiLeg).toBeNull();
  });

  it('drives when no transit beats threshold', () => {
    // distance=10, driveTime=10*(1+0)=10, threshold=15
    // single transit time=20 > 15 → drive
    const result = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      [{ type: TransportType.BUS, estimatedTime: 20, walkTime: 0 }],
      [],
      neutral(0),
    );
    expect(result.mode).toBe(TransportMode.DRIVE);
    expect(result.multiLeg).toBeNull();
  });

  it('chooses single transit when it beats driving and no multi-modal', () => {
    // distance=10, driveTime=10*(1+0.5)=15, threshold=22.5
    const result = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      [{ type: TransportType.METRO, estimatedTime: 8, walkTime: 0 }],
      [],
      neutral(0.5),
    );
    expect(result.mode).toBe(TransportMode.METRO);
    expect(result.multiLeg).toBeNull();
  });

  it('chooses multi-modal when it beats single transit', () => {
    const multi = makeMultiLeg([
      walkLeg(0, 0, 1, 0, 1),
      rideLeg(1, 0, 10, 0, 4, TransportType.BUS),
      walkLeg(10, 0, 10, 1, 1),
      rideLeg(10, 1, 19, 0, 3, TransportType.METRO),
      walkLeg(19, 0, 20, 0, 1),
    ], 10);

    // distance=20, driveTime=20*(1+0)=20, threshold=30
    // single transit=25, multi-modal=10 → multi-modal wins
    const result = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 20, y: 0 },
      [{ type: TransportType.BUS, estimatedTime: 25, walkTime: 0 }],
      [multi],
      neutral(0),
    );
    expect(result.mode).toBe(TransportMode.BUS); // primary = first ride type
    expect(result.multiLeg).toBe(multi);
  });

  it('chooses single transit when it beats multi-modal', () => {
    const multi = makeMultiLeg([
      walkLeg(0, 0, 1, 0, 1),
      rideLeg(1, 0, 10, 0, 10, TransportType.BUS),
      walkLeg(10, 0, 10, 1, 1),
      rideLeg(10, 1, 19, 0, 8, TransportType.METRO),
      walkLeg(19, 0, 20, 0, 1),
    ], 21);

    // distance=20, driveTime=20, threshold=30
    // single=12, multi=21 → single wins
    const result = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 20, y: 0 },
      [{ type: TransportType.METRO, estimatedTime: 12, walkTime: 0 }],
      [multi],
      neutral(0),
    );
    expect(result.mode).toBe(TransportMode.METRO);
    expect(result.multiLeg).toBeNull();
  });

  it('drives when both transit options exceed threshold', () => {
    const multi = makeMultiLeg([
      walkLeg(0, 0, 1, 0, 1),
      rideLeg(1, 0, 9, 0, 50, TransportType.BUS),
      walkLeg(9, 0, 10, 0, 1),
    ], 52);

    // distance=10, driveTime=10*(1+0)=10, threshold=15
    // single=20 > 15, multi=52 > 15 → drive
    const result = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      [{ type: TransportType.BUS, estimatedTime: 20, walkTime: 0 }],
      [multi],
      neutral(0),
    );
    expect(result.mode).toBe(TransportMode.DRIVE);
    expect(result.multiLeg).toBeNull();
  });

  it('handles empty transit options', () => {
    const result = chooseModeMultiModal(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      [],
      [],
      neutral(0),
    );
    expect(result.mode).toBe(TransportMode.DRIVE);
  });
});

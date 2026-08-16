import { describe, it, expect } from 'vitest';
import { WALK_RANGE_BY_TYPE, walkRangeFor } from '../WalkRange';
import { TransportType } from '../types';

/**
 * 願意為哪一種運具走多遠，不是同一個數字。
 *
 * 一個全域的步行上限意味著公車站與捷運站的服務範圍一模一樣。現實剛好相反：人願意
 * 為捷運多走，因為它快、班次密、而且站本來就稀疏；為一班很久才來一次的公車，走三
 * 分鐘就不肯了 —— 何況公車站密集，本來就不必走遠。
 *
 * 這個上限是「絕對走不到」的硬邊界，不是行為規則。真正做細部取捨的是時間本身：
 * 走路花的時間會進到比較裡，還要再乘一份不情願（見 `WalkWillingness`）。
 */

describe('分運具的步行上限', () => {
  it('should let people walk further for rail than for a bus', () => {
    expect(walkRangeFor(TransportType.RAIL))
      .toBeGreaterThan(walkRangeFor(TransportType.BUS));
    expect(walkRangeFor(TransportType.METRO))
      .toBeGreaterThan(walkRangeFor(TransportType.BUS));
  });

  it('should put the ferry between the two', () => {
    // 渡輪碼頭稀疏（要臨水），但慢 —— 兩邊拉扯。
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
    // 站牌的步行涵蓋範圍是一次算出來的，要用最寬的那一個當半徑，否則捷運站
    // 掃出來的範圍會被公車的上限截掉。
    const widest = Math.max(...Object.values(TransportType).map(walkRangeFor));
    expect(WALK_RANGE_BY_TYPE.WIDEST).toBe(widest);
  });
});

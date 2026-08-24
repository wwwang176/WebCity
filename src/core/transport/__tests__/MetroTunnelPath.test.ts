import { describe, it, expect } from 'vitest';
import { computeTunnelSegments, type TunnelSegment } from '../MetroTunnelPath';

describe('MetroTunnelPath', () => {
  describe('computeTunnelSegments', () => {
    it('兩個站點產生一條隧道段', () => {
      const stations = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ];
      const segments = computeTunnelSegments(stations);
      expect(segments).toHaveLength(1);
    });

    it('三個站點產生三條隧道段（環形路線）', () => {
      const stations = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ];
      const segments = computeTunnelSegments(stations);
      // Loop: A->B, B->C, C->A
      expect(segments).toHaveLength(3);
    });

    it('環狀路線（最後一站回到第一站）產生 N 條隧道段', () => {
      const stations = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ];
      const segments = computeTunnelSegments(stations);
      // 3 stations in loop: A→B, B→C, C→A
      expect(segments).toHaveLength(3);
    });

    it('每條隧道段都有 from 和 to 座標', () => {
      const stations = [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ];
      const segments = computeTunnelSegments(stations);
      expect(segments[0]!.from).toEqual({ x: 0, y: 0 });
      expect(segments[0]!.to).toEqual({ x: 10, y: 5 });
    });

    it('單站不產生隧道段', () => {
      const stations = [{ x: 0, y: 0 }];
      const segments = computeTunnelSegments(stations);
      expect(segments).toHaveLength(0);
    });

    it('無站點不產生隧道段', () => {
      const segments = computeTunnelSegments([]);
      expect(segments).toHaveLength(0);
    });

    it('隧道段 controlPoints 包含平滑曲線的控制點', () => {
      const stations = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];
      const segments = computeTunnelSegments(stations);
      expect(segments[0]!.controlPoints.length).toBeGreaterThanOrEqual(2);
      // The first control point matches `from`.
      const first = segments[0]!.controlPoints[0]!;
      expect(first.x).toBe(0);
      expect(first.y).toBe(0);
      // The last control point matches `to`.
      const last = segments[0]!.controlPoints[segments[0]!.controlPoints.length - 1]!;
      expect(last.x).toBe(10);
      expect(last.y).toBe(10);
    });

    it('多條路線獨立計算隧道段', () => {
      const line1Stations = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ];
      const line2Stations = [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ];
      const seg1 = computeTunnelSegments(line1Stations);
      const seg2 = computeTunnelSegments(line2Stations);
      expect(seg1).toHaveLength(1);
      expect(seg2).toHaveLength(1);
      // Line 1 is at y=0, line 2 at y=5.
      expect(seg1[0]!.from.y).toBe(0);
      expect(seg2[0]!.from.y).toBe(5);
    });
  });
});

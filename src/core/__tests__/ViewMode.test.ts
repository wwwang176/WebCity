import { describe, it, expect } from 'vitest';
import { ViewMode, VIEW_MODE_OPACITY, isSurfaceVehicle, UNDERGROUND_TUNNEL_Y } from '../ViewMode';

describe('ViewMode', () => {
  describe('VIEW_MODE_OPACITY', () => {
    it('NORMAL 模式下所有地面物體不透明', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.NORMAL];
      expect(op.building).toBe(1.0);
      expect(op.road).toBe(1.0);
      expect(op.terrain).toBe(1.0);
      expect(op.surfaceVehicle).toBe(1.0);
    });

    it('NORMAL 模式下地鐵隧道和列車不可見', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.NORMAL];
      expect(op.metroTunnel).toBe(0.0);
      expect(op.metroTrain).toBe(0.0);
    });

    it('UNDERGROUND 模式下地面物體半透明', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.UNDERGROUND];
      expect(op.building).toBeLessThan(1.0);
      expect(op.road).toBeLessThan(1.0);
      expect(op.terrain).toBeLessThan(1.0);
      expect(op.surfaceVehicle).toBeLessThan(1.0);
    });

    it('UNDERGROUND 模式下地鐵隧道和列車完全可見', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.UNDERGROUND];
      expect(op.metroTunnel).toBe(1.0);
      expect(op.metroTrain).toBe(1.0);
    });

    it('UNDERGROUND 模式建築最半透明 (0.12)', () => {
      expect(VIEW_MODE_OPACITY[ViewMode.UNDERGROUND].building).toBe(0.12);
    });

    it('UNDERGROUND 模式道路半透明 (0.15)', () => {
      expect(VIEW_MODE_OPACITY[ViewMode.UNDERGROUND].road).toBe(0.15);
    });

    it('UNDERGROUND 模式地形半透明 (0.2)', () => {
      expect(VIEW_MODE_OPACITY[ViewMode.UNDERGROUND].terrain).toBe(0.2);
    });
  });

  describe('UNDERGROUND constants', () => {
    it('隧道 Y 位置在地面以下', () => {
      expect(UNDERGROUND_TUNNEL_Y).toBeLessThan(0);
    });

    it('隧道 Y = -0.15', () => {
      expect(UNDERGROUND_TUNNEL_Y).toBe(-0.15);
    });

  });

  describe('isSurfaceVehicle', () => {
    it('car 是地面車輛', () => {
      expect(isSurfaceVehicle('car')).toBe(true);
    });

    it('bus 是地面車輛', () => {
      expect(isSurfaceVehicle('bus')).toBe(true);
    });

    it('transport_bus 是地面車輛', () => {
      expect(isSurfaceVehicle('transport_bus')).toBe(true);
    });

    it('truck 是地面車輛', () => {
      expect(isSurfaceVehicle('truck')).toBe(true);
    });

    it('tram 是地面車輛', () => {
      expect(isSurfaceVehicle('tram')).toBe(true);
    });

    it('metro_train 不是地面車輛', () => {
      expect(isSurfaceVehicle('metro_train')).toBe(false);
    });

    it('ferry 是地面車輛', () => {
      expect(isSurfaceVehicle('ferry')).toBe(true);
    });

    it('taxi 是地面車輛', () => {
      expect(isSurfaceVehicle('taxi')).toBe(true);
    });
  });
});

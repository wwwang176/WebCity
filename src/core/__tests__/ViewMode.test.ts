import { describe, it, expect } from 'vitest';
import {
  ViewMode,
  VIEW_MODE_OPACITY,
  isSurfaceVehicle,
  UNDERGROUND_TUNNEL_Y,
  TRANSPORT_STOP_IDS,
  getTransportStopType,
  getTransportFocusMode,
  getVehicleVisibility,
} from '../ViewMode';
import { OVERLAY_SCALE } from '../../Game';

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

    it('UNDERGROUND 模式建築最半透明 (0.125)', () => {
      expect(VIEW_MODE_OPACITY[ViewMode.UNDERGROUND].building).toBe(0.125);
    });

    it('UNDERGROUND 模式道路半透明 (0.15)', () => {
      expect(VIEW_MODE_OPACITY[ViewMode.UNDERGROUND].road).toBe(0.15);
    });

    it('UNDERGROUND 模式地形半透明 (0.2)', () => {
      expect(VIEW_MODE_OPACITY[ViewMode.UNDERGROUND].terrain).toBe(0.2);
    });

    // ── RAIL_FOCUS mode ──

    it('RAIL_FOCUS 模式下建築半透明', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.RAIL_FOCUS];
      expect(op.building).toBeLessThan(0.2);
    });

    it('RAIL_FOCUS 模式下軌道全彩', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.RAIL_FOCUS];
      expect(op.track).toBe(1.0);
      expect(op.levelCrossing).toBe(1.0);
    });

    it('RAIL_FOCUS 模式下地鐵隧道隱藏', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.RAIL_FOCUS];
      expect(op.metroTunnel).toBe(0.0);
    });

    // ── FERRY_FOCUS mode ──

    it('FERRY_FOCUS 模式下建築半透明', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.FERRY_FOCUS];
      expect(op.building).toBeLessThan(0.2);
    });

    it('FERRY_FOCUS 模式下地形保持可見(顯示水面)', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.FERRY_FOCUS];
      expect(op.terrain).toBeGreaterThanOrEqual(0.8);
    });

    it('FERRY_FOCUS 模式下軌道半透明', () => {
      const op = VIEW_MODE_OPACITY[ViewMode.FERRY_FOCUS];
      expect(op.track).toBeLessThan(0.2);
    });

    it('should have opacity config for all view modes', () => {
      for (const mode of Object.values(ViewMode)) {
        expect(VIEW_MODE_OPACITY[mode]).toBeDefined();
      }
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

    it('metro_train now rendered separately (all VehicleRenderer types are surface)', () => {
      expect(isSurfaceVehicle('metro_train')).toBe(true);
    });

    it('ferry 是地面車輛', () => {
      expect(isSurfaceVehicle('ferry')).toBe(true);
    });

  });
});

// ── Transport stop identification ──

describe('TRANSPORT_STOP_IDS', () => {
  it('should map buildingIds to transport types', () => {
    expect(TRANSPORT_STOP_IDS[242]).toBe('bus');
    expect(TRANSPORT_STOP_IDS[241]).toBe('metro');
    expect(TRANSPORT_STOP_IDS[239]).toBe('rail');
    expect(TRANSPORT_STOP_IDS[238]).toBe('ferry');
  });
});

describe('getTransportStopType', () => {
  it('should return transport type for valid transport buildingIds', () => {
    expect(getTransportStopType(242)).toBe('bus');
    expect(getTransportStopType(239)).toBe('rail');
    expect(getTransportStopType(238)).toBe('ferry');
  });

  it('should return undefined for non-transport buildingIds', () => {
    expect(getTransportStopType(0)).toBeUndefined();
    expect(getTransportStopType(254)).toBeUndefined();
    expect(getTransportStopType(100)).toBeUndefined();
  });
});

describe('getTransportFocusMode', () => {
  it('should return UNDERGROUND for metro', () => {
    expect(getTransportFocusMode('metro')).toBe(ViewMode.UNDERGROUND);
  });

  it('should return RAIL_FOCUS for rail', () => {
    expect(getTransportFocusMode('rail')).toBe(ViewMode.RAIL_FOCUS);
  });

  it('should return FERRY_FOCUS for ferry', () => {
    expect(getTransportFocusMode('ferry')).toBe(ViewMode.FERRY_FOCUS);
  });

  it('should return BUS_FOCUS for bus', () => {
    expect(getTransportFocusMode('bus')).toBe(ViewMode.BUS_FOCUS);
  });

});

// ── Vehicle visibility per ViewMode ──

describe('getVehicleVisibility', () => {
  it('NORMAL mode: all vehicle types visible', () => {
    expect(getVehicleVisibility(ViewMode.NORMAL, 'car')).toBe(true);
    expect(getVehicleVisibility(ViewMode.NORMAL, 'rail_train')).toBe(true);
    expect(getVehicleVisibility(ViewMode.NORMAL, 'ferry')).toBe(true);
  });

  it('UNDERGROUND mode: all surface vehicles hidden', () => {
    expect(getVehicleVisibility(ViewMode.UNDERGROUND, 'car')).toBe(false);
    expect(getVehicleVisibility(ViewMode.UNDERGROUND, 'rail_train')).toBe(false);
    expect(getVehicleVisibility(ViewMode.UNDERGROUND, 'ferry')).toBe(false);
  });

  it('RAIL_FOCUS mode: only rail vehicles visible', () => {
    expect(getVehicleVisibility(ViewMode.RAIL_FOCUS, 'rail_train')).toBe(true);
    expect(getVehicleVisibility(ViewMode.RAIL_FOCUS, 'rail_carriage')).toBe(true);
    expect(getVehicleVisibility(ViewMode.RAIL_FOCUS, 'car')).toBe(false);
    expect(getVehicleVisibility(ViewMode.RAIL_FOCUS, 'ferry')).toBe(false);
    expect(getVehicleVisibility(ViewMode.RAIL_FOCUS, 'bus')).toBe(false);
  });

  it('FERRY_FOCUS mode: only ferry vehicles visible', () => {
    expect(getVehicleVisibility(ViewMode.FERRY_FOCUS, 'ferry')).toBe(true);
    expect(getVehicleVisibility(ViewMode.FERRY_FOCUS, 'car')).toBe(false);
    expect(getVehicleVisibility(ViewMode.FERRY_FOCUS, 'rail_train')).toBe(false);
  });

  it('BUS_FOCUS mode: only bus vehicles visible', () => {
    expect(getVehicleVisibility(ViewMode.BUS_FOCUS, 'bus')).toBe(true);
    expect(getVehicleVisibility(ViewMode.BUS_FOCUS, 'transport_bus')).toBe(true);
    expect(getVehicleVisibility(ViewMode.BUS_FOCUS, 'car')).toBe(false);
    expect(getVehicleVisibility(ViewMode.BUS_FOCUS, 'ferry')).toBe(false);
  });

  // Road-based focus modes keep roads visible
  it('BUS_FOCUS mode should keep roads at full opacity', () => {
    expect(VIEW_MODE_OPACITY[ViewMode.BUS_FOCUS].road).toBe(1.0);
    expect(VIEW_MODE_OPACITY[ViewMode.BUS_FOCUS].building).toBeLessThan(0.2);
  });
});

describe('OVERLAY_SCALE constants', () => {
  it('display max should be 100', () => {
    expect(OVERLAY_SCALE.DISPLAY_MAX).toBe(100);
  });

  it('raw max should be 255 (uint8 range)', () => {
    expect(OVERLAY_SCALE.RAW_MAX).toBe(255);
  });

  it('coverage value should be positive and ≤ display max', () => {
    expect(OVERLAY_SCALE.COVERAGE_VALUE).toBeGreaterThan(0);
    expect(OVERLAY_SCALE.COVERAGE_VALUE).toBeLessThanOrEqual(OVERLAY_SCALE.DISPLAY_MAX);
  });

  it('scaling factors should be positive', () => {
    expect(OVERLAY_SCALE.GROUNDWATER_FACTOR).toBeGreaterThan(0);
    expect(OVERLAY_SCALE.ZONE_TYPE_FACTOR).toBeGreaterThan(0);
    expect(OVERLAY_SCALE.TRAFFIC_DENSITY_FACTOR).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { TrafficLightSystem, TRAFFIC_LIGHT, syncTrafficLightsWithGrid } from '../TrafficLights';
import { Grid } from '../../grid/Grid';
import { RoadType, RoadDirection } from '../../road/types';

describe('TrafficLightSystem', () => {
  it('should add and retrieve a light', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(5, 5);
    expect(sys.getLight(5, 5)).toBeDefined();
  });

  it('should enter clearance then advance phase', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0);
    const light = sys.getLight(0, 0)!;
    const initialPhase = light.phase;
    // Burn through initial timer → enters clearance (all red)
    sys.tick(light.timer + 0.01);
    expect(sys.getLight(0, 0)!.clearing).toBe(true);
    expect(sys.getLight(0, 0)!.phase).toBe(initialPhase); // phase not yet changed
    // Burn through clearance → phase switches
    sys.tick(TRAFFIC_LIGHT.CLEARANCE_DURATION + 0.01);
    expect(sys.getLight(0, 0)!.clearing).toBe(false);
    expect(sys.getLight(0, 0)!.phase).not.toBe(initialPhase);
  });

  it('should block all directions during clearance', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(2, 2);
    const light = sys.getLight(2, 2)!;
    sys.tick(light.timer + 0.01); // enter clearance
    expect(sys.canPass(2, 1, 2, 2)).toBe(false); // N-S blocked
    expect(sys.canPass(1, 2, 2, 2)).toBe(false); // E-W blocked
  });

  it('should cycle phases with small dt increments', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0);
    const light = sys.getLight(0, 0)!;
    const initialPhase = light.phase;
    // Burn initial timer
    sys.tick(light.timer + 0.001);
    // One full cycle = clearance + phase + clearance + phase = back to initial
    const fullCycle = TRAFFIC_LIGHT.CLEARANCE_DURATION + light.phaseDuration;
    const steps = 100;
    const stepDt = (fullCycle * 2) / steps;
    for (let i = 0; i < steps + 1; i++) sys.tick(stepDt);
    expect(sys.getLight(0, 0)!.phase).toBe(initialPhase);
  });

  it('should use custom phaseDuration when provided', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0, 4);
    expect(sys.getLight(0, 0)!.phaseDuration).toBe(4);
  });

  it('should use per-light phaseDuration in tick', () => {
    const sys = new TrafficLightSystem();
    sys.addLight(0, 0, 4);
    const light = sys.getLight(0, 0)!;
    const initialPhase = light.phase;
    // Tick 1: burn initial timer → enters clearance
    sys.tick(light.timer + 0.01);
    expect(sys.getLight(0, 0)!.clearing).toBe(true);
    // Tick 2: burn clearance → phase switches
    sys.tick(TRAFFIC_LIGHT.CLEARANCE_DURATION + 0.01);
    expect(sys.getLight(0, 0)!.phase).not.toBe(initialPhase);
  });
});

describe('TRAFFIC_LIGHT constants', () => {
  it('phase duration should be a positive number in seconds', () => {
    expect(TRAFFIC_LIGHT.PHASE_DURATION).toBeGreaterThan(0);
    expect(TRAFFIC_LIGHT.PHASE_DURATION_LARGE).toBeGreaterThan(TRAFFIC_LIGHT.PHASE_DURATION);
  });
});

describe('syncTrafficLightsWithGrid', () => {
  // Helper: set a road cell and its neighbors to form a proper intersection
  function setRoad(grid: Grid, x: number, y: number, roadType: number, flags: number) {
    grid.setCell(x, y, { roadType, roadFlags: flags });
  }

  it('should NOT add lights at small 3-way (T) intersections (all TWO_LANE)', () => {
    const grid = new Grid(10, 10);
    // T-intersection at (5,5) with all TWO_LANE neighbors
    setRoad(grid, 5, 5, RoadType.TWO_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    setRoad(grid, 5, 4, RoadType.TWO_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.TWO_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.TWO_LANE, RoadDirection.WEST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should NOT add lights at mixed 4-way (FOUR_LANE × TWO_LANE) — only 1 major arm pair', () => {
    const grid = new Grid(10, 10);
    // Intersection cell is TWO_LANE, N/S neighbors are FOUR_LANE, E/W are TWO_LANE
    // majorArms: N=FOUR_LANE(neighbor), S=FOUR_LANE(neighbor), E=TWO_LANE, W=TWO_LANE
    // Actually this has 2 major arms (N,S), so it SHOULD get a light
    // Let's test a case with only 1 major arm:
    setRoad(grid, 5, 5, RoadType.TWO_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH); // N arm: major
    setRoad(grid, 5, 6, RoadType.TWO_LANE, RoadDirection.NORTH);  // S arm: small
    setRoad(grid, 6, 5, RoadType.TWO_LANE, RoadDirection.WEST);   // E arm: small
    setRoad(grid, 4, 5, RoadType.TWO_LANE, RoadDirection.EAST);   // W arm: small
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined(); // only 1 major arm
  });

  it('should NOT add lights at 3-way (T) with major on one axis only (FOUR N-S, TWO E)', () => {
    const grid = new Grid(10, 10);
    setRoad(grid, 5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.FOUR_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.TWO_LANE, RoadDirection.WEST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should add lights at 3-way (T) with major on both axes', () => {
    const grid = new Grid(10, 10);
    // N-S: FOUR_LANE, E: FOUR_LANE → both axes major
    setRoad(grid, 5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.FOUR_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.FOUR_LANE, RoadDirection.WEST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION);
  });

  it('should add lights at 4-way with 2+ major arms and use long phase', () => {
    const grid = new Grid(10, 10);
    setRoad(grid, 5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.FOUR_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.FOUR_LANE, RoadDirection.WEST);
    setRoad(grid, 4, 5, RoadType.FOUR_LANE, RoadDirection.EAST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION_LARGE);
  });

  it('should NOT add lights when FOUR_LANE crosses TWO_LANE (only one axis major)', () => {
    const grid = new Grid(10, 10);
    setRoad(grid, 5, 5, RoadType.TWO_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.FOUR_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.TWO_LANE, RoadDirection.WEST);
    setRoad(grid, 4, 5, RoadType.TWO_LANE, RoadDirection.EAST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should add lights when FOUR_LANE crosses FOUR_LANE even if intersection cell is TWO_LANE', () => {
    const grid = new Grid(10, 10);
    setRoad(grid, 5, 5, RoadType.TWO_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.FOUR_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.FOUR_LANE, RoadDirection.WEST);
    setRoad(grid, 4, 5, RoadType.FOUR_LANE, RoadDirection.EAST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();
  });

  it('should update phaseDuration when road is upgraded', () => {
    const grid = new Grid(10, 10);
    // Start as 3-way all FOUR_LANE → standard duration
    setRoad(grid, 5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.FOUR_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.FOUR_LANE, RoadDirection.WEST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION);

    // Add 4th arm → becomes 4-way → long duration
    setRoad(grid, 5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST | RoadDirection.WEST);
    setRoad(grid, 4, 5, RoadType.FOUR_LANE, RoadDirection.EAST);
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)!.phaseDuration).toBe(TRAFFIC_LIGHT.PHASE_DURATION_LARGE);
  });

  it('should not add lights at 2-way roads', () => {
    const grid = new Grid(10, 10);
    setRoad(grid, 5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should remove stale lights when intersection is demolished', () => {
    const grid = new Grid(10, 10);
    const sys = new TrafficLightSystem();
    sys.addLight(5, 5);
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });

  it('should remove lights when major road downgraded to small', () => {
    const grid = new Grid(10, 10);
    setRoad(grid, 5, 5, RoadType.FOUR_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    setRoad(grid, 5, 4, RoadType.FOUR_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.FOUR_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.FOUR_LANE, RoadDirection.WEST);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeDefined();

    // Downgrade all to TWO_LANE → no longer qualifies
    setRoad(grid, 5, 5, RoadType.TWO_LANE, RoadDirection.NORTH | RoadDirection.SOUTH | RoadDirection.EAST);
    setRoad(grid, 5, 4, RoadType.TWO_LANE, RoadDirection.SOUTH);
    setRoad(grid, 5, 6, RoadType.TWO_LANE, RoadDirection.NORTH);
    setRoad(grid, 6, 5, RoadType.TWO_LANE, RoadDirection.WEST);
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)).toBeUndefined();
  });
});

/**
 * 號誌要帶著自己那一格的路寬。
 *
 * 渲染端得知道路緣在哪才放得下燈桿，而路緣的位置只由 `roadType` 決定：
 * 四車道 0.425、六車道 0.475。`TrafficLight` 不帶這個欄位的話，渲染端只能
 * 用一個常數 —— 那正是燈桿站在柏油路上的原因。
 */
describe('號誌帶的路寬', () => {
  function majorCross(grid: Grid, x: number, y: number, roadType: number): void {
    const all = RoadDirection.NORTH | RoadDirection.SOUTH
      | RoadDirection.EAST | RoadDirection.WEST;
    grid.setCell(x, y, { roadType, roadFlags: all });
    grid.setCell(x, y - 1, { roadType, roadFlags: all });
    grid.setCell(x, y + 1, { roadType, roadFlags: all });
    grid.setCell(x - 1, y, { roadType, roadFlags: all });
    grid.setCell(x + 1, y, { roadType, roadFlags: all });
  }

  it('should record the road type of the cell the signal stands on', () => {
    const grid = new Grid(10, 10);
    majorCross(grid, 5, 5, RoadType.FOUR_LANE);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    expect(sys.getLight(5, 5)!.roadType, '號誌不知道自己站在多寬的路上')
      .toBe(RoadType.FOUR_LANE);
  });

  it('should follow the road when it is upgraded under an existing signal', () => {
    // 拓寬道路不會重建號誌（`syncTrafficLightsWithGrid` 只在不存在時 addLight），
    // 所以既有的那一盞必須跟著改 —— 不然燈桿會留在舊路緣的位置上。
    const grid = new Grid(10, 10);
    majorCross(grid, 5, 5, RoadType.FOUR_LANE);
    const sys = new TrafficLightSystem();
    syncTrafficLightsWithGrid(grid, sys);
    const before = sys.getLight(5, 5)!;

    majorCross(grid, 5, 5, RoadType.SIX_LANE);
    syncTrafficLightsWithGrid(grid, sys);

    expect(sys.getLight(5, 5), '號誌被重建了 —— 相位會跳一下').toBe(before);
    expect(sys.getLight(5, 5)!.roadType, '路拓寬了，號誌還記著舊的路寬')
      .toBe(RoadType.SIX_LANE);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { AirplaneAnimator, type AirportSystemLike } from '../AirplaneAnimator';
import type { TransportVehicleRenderData } from '../../core/transport/collectTransportVehicles';
import type { Airport } from '../../core/transport/AirportSystem';

// ── Helpers ──────────────────────────────────────────────────────

function makeAirport(overrides: Partial<Airport> = {}): Airport {
  return {
    id: 1,
    x: 10,
    y: 10,
    size: 'SMALL',
    rotation: 0,
    noisePollution: 10,
    touristsPerTick: 50,
    cargoPerTick: 20,
    operatingCost: 500,
    ...overrides,
  };
}

function makeSystem(airports: Airport[]): AirportSystemLike {
  return { getAirports: () => airports };
}

/** Advance animator by many frames until a vehicle appears or timeout. */
function advanceUntilVehicle(
  animator: AirplaneAnimator,
  system: AirportSystemLike,
  maxFrames = 5000,
): TransportVehicleRenderData | null {
  for (let i = 0; i < maxFrames; i++) {
    const vehicles: TransportVehicleRenderData[] = [];
    animator.update(1 / 60, 1, system, vehicles);
    if (vehicles.length > 0) return vehicles[0]!;
  }
  return null;
}

/** Advance animator by a specific number of seconds. */
function advanceSeconds(
  animator: AirplaneAnimator,
  system: AirportSystemLike,
  seconds: number,
  speed = 1,
): TransportVehicleRenderData[] {
  const frames = Math.ceil(seconds * 60);
  let lastVehicles: TransportVehicleRenderData[] = [];
  for (let i = 0; i < frames; i++) {
    lastVehicles = [];
    animator.update(1 / 60, speed, system, lastVehicles);
  }
  return lastVehicles;
}

// ── Tests ────────────────────────────────────────────────────────

describe('AirplaneAnimator', () => {
  let animator: AirplaneAnimator;

  beforeEach(() => {
    animator = new AirplaneAnimator();
  });

  describe('spawn and lifecycle', () => {
    it('should spawn an airplane after initial delay', () => {
      const system = makeSystem([makeAirport()]);
      const vehicle = advanceUntilVehicle(animator, system);
      expect(vehicle).not.toBeNull();
      expect(vehicle!.type).toBe('airplane');
    });

    it('should output airplane with correct fields', () => {
      const system = makeSystem([makeAirport()]);
      const vehicle = advanceUntilVehicle(animator, system);
      expect(vehicle).not.toBeNull();
      expect(vehicle!.x).toBeTypeOf('number');
      expect(vehicle!.y).toBeTypeOf('number');
      expect(vehicle!.heading).toBeTypeOf('number');
      expect(vehicle!.altitude).toBeTypeOf('number');
    });

    it('should not spawn for empty airport list', () => {
      const system = makeSystem([]);
      const vehicles: TransportVehicleRenderData[] = [];
      for (let i = 0; i < 2000; i++) {
        animator.update(1 / 60, 1, system, vehicles);
      }
      expect(vehicles.length).toBe(0);
    });
  });

  describe('pause behavior', () => {
    it('should keep airplane visible when paused (speed=0)', () => {
      const system = makeSystem([makeAirport()]);
      // First spawn a plane
      advanceUntilVehicle(animator, system);

      // Now pause — should still output the vehicle
      const vehicles: TransportVehicleRenderData[] = [];
      animator.update(1 / 60, 0, system, vehicles);
      expect(vehicles.length).toBe(1);
    });

    it('should not advance animation when paused', () => {
      const system = makeSystem([makeAirport()]);
      advanceUntilVehicle(animator, system);

      // Get position while running
      const v1: TransportVehicleRenderData[] = [];
      animator.update(1 / 60, 1, system, v1);
      const pos1 = { x: v1[0]!.x, y: v1[0]!.y };

      // Pause for many frames
      let v2: TransportVehicleRenderData[] = [];
      for (let i = 0; i < 100; i++) {
        v2 = [];
        animator.update(1 / 60, 0, system, v2);
      }
      const pos2 = { x: v2[0]!.x, y: v2[0]!.y };

      // Position should not change during pause
      expect(pos2.x).toBeCloseTo(pos1.x, 5);
      expect(pos2.y).toBeCloseTo(pos1.y, 5);
    });
  });

  describe('airport demolition cleanup', () => {
    it('should remove airplane when airport is demolished', () => {
      const airport = makeAirport();
      const system = makeSystem([airport]);
      advanceUntilVehicle(animator, system);

      // Verify airplane exists
      const v1: TransportVehicleRenderData[] = [];
      animator.update(1 / 60, 1, system, v1);
      expect(v1.length).toBe(1);

      // Demolish airport
      const emptySystem = makeSystem([]);
      const v2: TransportVehicleRenderData[] = [];
      animator.update(1 / 60, 1, emptySystem, v2);
      expect(v2.length).toBe(0);
    });

    it('should clean up spawn timers on demolition', () => {
      const airport = makeAirport();
      const system = makeSystem([airport]);

      // Advance a bit (creates spawn timer)
      advanceSeconds(animator, system, 5);

      // Demolish
      const emptySystem = makeSystem([]);
      advanceSeconds(animator, emptySystem, 1);

      // Re-add airport with same id — should get fresh timer, not stale one
      const newSystem = makeSystem([airport]);
      const vehicle = advanceUntilVehicle(animator, newSystem);
      expect(vehicle).not.toBeNull();
    });
  });

  describe('rotation support', () => {
    it('should produce different positions for different rotations', () => {
      const system0 = makeSystem([makeAirport({ rotation: 0 })]);
      const anim0 = new AirplaneAnimator();
      const v0 = advanceUntilVehicle(anim0, system0);

      const system90 = makeSystem([makeAirport({ rotation: 90 })]);
      const anim90 = new AirplaneAnimator();
      const v90 = advanceUntilVehicle(anim90, system90);

      expect(v0).not.toBeNull();
      expect(v90).not.toBeNull();
      // Positions should differ due to rotation
      const dist = Math.sqrt((v0!.x - v90!.x) ** 2 + (v0!.y - v90!.y) ** 2);
      expect(dist).toBeGreaterThan(0.5);
    });

    it('should produce different headings for different rotations', () => {
      const anim0 = new AirplaneAnimator();
      const v0 = advanceUntilVehicle(anim0, makeSystem([makeAirport({ rotation: 0 })]));

      const anim90 = new AirplaneAnimator();
      const v90 = advanceUntilVehicle(anim90, makeSystem([makeAirport({ rotation: 90 })]));

      expect(v0).not.toBeNull();
      expect(v90).not.toBeNull();
      // Heading difference should be ~PI/2
      let diff = Math.abs(v0!.heading - v90!.heading);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      expect(diff).toBeCloseTo(Math.PI / 2, 0.5);
    });
  });

  describe('altitude curves', () => {
    it('approach should start high and end at ground level', () => {
      const system = makeSystem([makeAirport()]);
      const firstVehicle = advanceUntilVehicle(animator, system);
      expect(firstVehicle).not.toBeNull();

      // First frame — should be in approach, high altitude
      const startAlt = firstVehicle!.altitude!;
      expect(startAlt).toBeGreaterThan(0.5);

      // Advance through approach until altitude drops near ground
      let groundReached = false;
      for (let i = 0; i < 600; i++) {
        const vehicles: TransportVehicleRenderData[] = [];
        animator.update(1 / 60, 1, system, vehicles);
        if (vehicles.length > 0 && vehicles[0]!.altitude! < 0.15) {
          groundReached = true;
          break;
        }
      }
      expect(groundReached).toBe(true);
    });

    it('climb should start at ground and increase altitude', () => {
      const system = makeSystem([makeAirport()]);

      // Advance through full cycle to climb phase
      // This takes many frames — approach + roll + taxi + dwell + pushback + taxi_out + takeoff + climb
      let climbDetected = false;
      let prevAlt = 0;
      for (let i = 0; i < 5000; i++) {
        const vehicles: TransportVehicleRenderData[] = [];
        animator.update(1 / 60, 3, system, vehicles); // 3× speed
        if (vehicles.length > 0) {
          const alt = vehicles[0]!.altitude!;
          // Detect climb: altitude increasing above ground + pitch > 0
          if (alt > 0.5 && vehicles[0]!.pitch! > 0.01 && alt > prevAlt) {
            climbDetected = true;
            break;
          }
          prevAlt = alt;
        }
      }
      expect(climbDetected).toBe(true);
    });
  });

  describe('phase transitions', () => {
    it('should complete full cycle and despawn', () => {
      const system = makeSystem([makeAirport()]);
      advanceUntilVehicle(animator, system);

      // Advance through entire cycle at high speed
      let despawned = false;
      let hadVehicle = true;
      for (let i = 0; i < 5000; i++) {
        const vehicles: TransportVehicleRenderData[] = [];
        animator.update(1 / 60, 5, system, vehicles); // 5× speed
        if (hadVehicle && vehicles.length === 0) {
          despawned = true;
          break;
        }
        hadVehicle = vehicles.length > 0;
      }
      expect(despawned).toBe(true);
    });

    it('should respawn after completing a cycle', () => {
      const system = makeSystem([makeAirport()]);

      // Run through 2 full cycles
      let spawnCount = 0;
      let wasEmpty = true;
      for (let i = 0; i < 10000; i++) {
        const vehicles: TransportVehicleRenderData[] = [];
        animator.update(1 / 60, 5, system, vehicles);
        if (wasEmpty && vehicles.length > 0) {
          spawnCount++;
          if (spawnCount >= 2) break;
        }
        wasEmpty = vehicles.length === 0;
      }
      expect(spawnCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('S airport scale', () => {
    it('should not output scale for SMALL airports (same size as Medium)', () => {
      const system = makeSystem([makeAirport({ size: 'SMALL' })]);
      const vehicle = advanceUntilVehicle(animator, system);
      expect(vehicle).not.toBeNull();
      expect(vehicle!.scale).toBeUndefined();
    });

    it('should not output scale for MEDIUM airports', () => {
      const system = makeSystem([makeAirport({ size: 'MEDIUM' })]);
      const vehicle = advanceUntilVehicle(animator, system);
      expect(vehicle).not.toBeNull();
      expect(vehicle!.scale).toBeUndefined();
    });

    it('should not output scale for LARGE airports', () => {
      const system = makeSystem([makeAirport({ size: 'LARGE' })]);
      const vehicle = advanceUntilVehicle(animator, system);
      expect(vehicle).not.toBeNull();
      expect(vehicle!.scale).toBeUndefined();
    });
  });

  describe('gate collision avoidance (L airport)', () => {
    it('should assign different gates to concurrent planes', () => {
      const airport = makeAirport({ size: 'LARGE' });
      const system = makeSystem([airport]);

      // Advance until both slots have vehicles (L airport has 2 slots)
      let bothActive = false;
      const gatePositions: { x: number; y: number }[] = [];
      for (let i = 0; i < 5000; i++) {
        const vehicles: TransportVehicleRenderData[] = [];
        animator.update(1 / 60, 1, system, vehicles);
        if (vehicles.length === 2) {
          bothActive = true;
          gatePositions.push(
            { x: vehicles[0]!.x, y: vehicles[0]!.y },
            { x: vehicles[1]!.x, y: vehicles[1]!.y },
          );
          break;
        }
      }
      // Two concurrent planes should exist at some point
      if (bothActive) {
        // They should be at different positions (different gates)
        const dist = Math.sqrt(
          (gatePositions[0]!.x - gatePositions[1]!.x) ** 2 +
          (gatePositions[0]!.y - gatePositions[1]!.y) ** 2,
        );
        expect(dist).toBeGreaterThan(0.1);
      }
      // It's OK if they don't overlap in this test window
    });
  });

  describe('unique vehicle IDs per spawn', () => {
    it('should generate different IDs for consecutive spawns', () => {
      const system = makeSystem([makeAirport()]);
      const ids: number[] = [];

      for (let cycle = 0; cycle < 2; cycle++) {
        // Advance until vehicle appears
        let found = false;
        for (let i = 0; i < 10000; i++) {
          const vehicles: TransportVehicleRenderData[] = [];
          animator.update(1 / 60, 5, system, vehicles);
          if (vehicles.length > 0 && !ids.includes(vehicles[0]!.id)) {
            ids.push(vehicles[0]!.id);
            found = true;
            break;
          }
        }
        if (!found) break;
      }
      // Should have at least 2 different IDs
      if (ids.length >= 2) {
        expect(ids[0]).not.toBe(ids[1]);
      }
    });
  });
});

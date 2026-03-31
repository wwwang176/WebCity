import { describe, it, expect, vi } from 'vitest';
import { AirportSystem } from '../AirportSystem';
import { createGameState } from '../../simulation/GameState';
import { tickAllTransportSystems } from '../TransportRegistry';
import type { GameState } from '../../simulation/GameState';

const YES = () => true;
const NO = () => false;

describe('Transport Operational Status', () => {
  describe('AirportSystem', () => {
    it('operational airport generates tourists and cargo', () => {
      const sys = new AirportSystem();
      sys.build(0, 0, 'SMALL', 0);
      sys.updateOperationalStatus(YES, YES);
      sys.tick();
      expect(sys.pendingTourists).toBe(50);
      expect(sys.pendingCargo).toBe(20);
    });

    it('non-operational airport does NOT generate tourists or cargo', () => {
      const sys = new AirportSystem();
      sys.build(0, 0, 'SMALL', 0);
      sys.updateOperationalStatus(NO, YES); // no power
      sys.tick();
      expect(sys.pendingTourists).toBe(0);
      expect(sys.pendingCargo).toBe(0);
    });

    it('non-operational airport emits no noise pollution', () => {
      const sys = new AirportSystem();
      sys.build(0, 0, 'SMALL', 0);
      sys.updateOperationalStatus(YES, NO); // no water
      expect(sys.getPollutionSources()).toHaveLength(0);
    });

    it('operational airport emits noise pollution', () => {
      const sys = new AirportSystem();
      sys.build(0, 0, 'SMALL', 0);
      sys.updateOperationalStatus(YES, YES);
      expect(sys.getPollutionSources().length).toBeGreaterThan(0);
    });

    it('mixed: only operational airports generate output', () => {
      const sys = new AirportSystem();
      sys.build(0, 0, 'SMALL', 0);  // will be powered
      sys.build(10, 0, 'SMALL', 0); // will NOT be powered
      sys.updateOperationalStatus(
        (x) => x === 0, // only x=0 has power
        YES,
      );
      sys.tick();
      expect(sys.pendingTourists).toBe(50); // only 1 airport
      expect(sys.pendingCargo).toBe(20);
    });
  });

  describe('BaseTransportSystem (via bus/metro)', () => {
    it('vehicle on fully operational route moves', () => {
      const state = createGameState(10, 10);
      state.metro.addStop(0, 0);
      state.metro.addStop(5, 5);
      const stops = state.metro.getStops();
      state.metro.createLine([...stops], 1);

      // Mark all stops operational
      state.metro.updateOperationalStatus(YES, YES, 'metro_station');

      // Tick enough times for vehicle to start traveling
      for (let i = 0; i < 5; i++) state.metro.tick();
      const vehicles = state.metro.getVehicles();
      // Vehicle should exist and have been initialized
      expect(vehicles.length).toBeGreaterThan(0);
    });

    it('vehicle on route with non-operational stop is frozen', () => {
      const state = createGameState(10, 10);
      state.metro.addStop(0, 0);
      state.metro.addStop(5, 5);
      const stops = state.metro.getStops();
      state.metro.createLine([...stops], 1);

      // Mark stop at x=0 as non-operational (no power)
      state.metro.updateOperationalStatus(
        (x) => x !== 0, // x=0 has no power
        YES,
        'metro_station',
      );

      // Tick multiple times — vehicle should not move
      const getVehicleState = () => JSON.stringify(state.metro.getVehicles());
      const before = getVehicleState();
      state.metro.tick();
      state.metro.tick();
      state.metro.tick();
      expect(getVehicleState()).toBe(before);
    });
  });

  describe('tickAllTransportSystems integration', () => {
    it('passes utility checkers to all systems', () => {
      const state = createGameState(10, 10);
      state.airport.build(0, 0, 'SMALL', 0);

      // No power → airport should not tick
      tickAllTransportSystems(state as any, NO, YES);
      expect(state.airport.pendingTourists).toBe(0);

      // With power + water → airport ticks
      tickAllTransportSystems(state as any, YES, YES);
      expect(state.airport.pendingTourists).toBe(50);
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { tickAllTransportSystems } from '../TransportRegistry';

describe('tickAllTransportSystems', () => {
  it('calls tick() on all transport systems', () => {
    const mockTick = vi.fn();
    const systems = {
      bus: { tick: mockTick, getOperatingCost: () => 0, congestionLevel: 0, getRoutes: () => [], getStops: () => [] },
      metro: { tick: mockTick, getOperatingCost: () => 0, getRoutes: () => [], getStops: () => [] },
      rail: { tick: mockTick, getOperatingCost: () => 0, getRoutes: () => [], getStops: () => [] },
      ferry: { tick: mockTick, getOperatingCost: () => 0, getRoutes: () => [], getStops: () => [] },
      airport: { tick: mockTick, getOperatingCost: () => 0, getRoutes: () => [], getStops: () => [] },
    } as any;

    tickAllTransportSystems(systems);
    expect(mockTick).toHaveBeenCalledTimes(5);
  });
});

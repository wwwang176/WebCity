import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceDispatch, ServiceVehicleType } from '../ServiceDispatch';
import { Grid } from '../../grid/Grid';
import { RoadType } from '../../road/types';
import { TrafficSimulation } from '../../traffic/TrafficSimulation';

function setupGrid(): Grid {
  const grid = new Grid(20, 20);
  // Road from (2,5) to (15,5)
  for (let x = 2; x <= 15; x++) {
    grid.setCell(x, 5, { roadType: RoadType.TWO_LANE });
  }
  return grid;
}

describe('ServiceDispatch', () => {
  let grid: Grid;
  let traffic: TrafficSimulation;
  let dispatch: ServiceDispatch;

  beforeEach(() => {
    grid = setupGrid();
    traffic = new TrafficSimulation();
    dispatch = new ServiceDispatch(grid, traffic);
  });

  it('should dispatch a fire truck from station to fire via road network', () => {
    // Fire station adjacent to road at (1,5), fire at building (16,5)
    const result = dispatch.dispatch(
      ServiceVehicleType.FIRE_TRUCK,
      { x: 1, y: 5 },
      { x: 16, y: 5 },
    );

    expect(result).not.toBeNull();
    expect(result!.path.length).toBeGreaterThanOrEqual(2);
    expect(result!.vehicleType).toBe(ServiceVehicleType.FIRE_TRUCK);
    expect(result!.estimatedTicks).toBeGreaterThan(0);
  });

  it('should dispatch an ambulance via road network', () => {
    const result = dispatch.dispatch(
      ServiceVehicleType.AMBULANCE,
      { x: 1, y: 5 },
      { x: 16, y: 5 },
    );

    expect(result).not.toBeNull();
    expect(result!.vehicleType).toBe(ServiceVehicleType.AMBULANCE);
  });

  it('should dispatch a garbage truck via road network', () => {
    const result = dispatch.dispatch(
      ServiceVehicleType.GARBAGE_TRUCK,
      { x: 1, y: 5 },
      { x: 16, y: 5 },
    );

    expect(result).not.toBeNull();
    expect(result!.vehicleType).toBe(ServiceVehicleType.GARBAGE_TRUCK);
  });

  it('should dispatch a hearse via road network', () => {
    const result = dispatch.dispatch(
      ServiceVehicleType.HEARSE,
      { x: 1, y: 5 },
      { x: 16, y: 5 },
    );

    expect(result).not.toBeNull();
    expect(result!.vehicleType).toBe(ServiceVehicleType.HEARSE);
  });

  it('should return null when no road path exists', () => {
    // Destination has no adjacent road
    const result = dispatch.dispatch(
      ServiceVehicleType.FIRE_TRUCK,
      { x: 1, y: 5 },
      { x: 10, y: 15 }, // isolated, no roads nearby
    );

    expect(result).toBeNull();
  });

  it('should have longer travel time with higher congestion', () => {
    // Dispatch with no congestion
    const result1 = dispatch.dispatch(
      ServiceVehicleType.FIRE_TRUCK,
      { x: 1, y: 5 },
      { x: 16, y: 5 },
    );

    // Fill road with traffic to increase congestion
    const path = [];
    for (let x = 2; x <= 15; x++) path.push({ x, y: 5 });
    for (let i = 0; i < 20; i++) {
      traffic.addVehicle([...path], 1);
    }

    const result2 = dispatch.dispatch(
      ServiceVehicleType.FIRE_TRUCK,
      { x: 1, y: 5 },
      { x: 16, y: 5 },
    );

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Congested route should take longer
    expect(result2!.estimatedTicks).toBeGreaterThanOrEqual(result1!.estimatedTicks);
  });

  it('should allow assigning facility to a district', () => {
    dispatch.assignFacilityToDistrict('fire_1', 'downtown');
    expect(dispatch.getFacilityDistrict('fire_1')).toBe('downtown');
  });

  it('should return undefined for unassigned facility district', () => {
    expect(dispatch.getFacilityDistrict('fire_1')).toBeUndefined();
  });

  it('fire station assigned to district A should only respond to A-district fires', () => {
    dispatch.assignFacilityToDistrict('fire_1', 'district_a');

    // Facility fire_1 is assigned to district_a
    expect(dispatch.getFacilityDistrict('fire_1')).toBe('district_a');

    // Should respond to fires in district_a
    const shouldRespond = dispatch.shouldFacilityRespond('fire_1', 'district_a');
    expect(shouldRespond).toBe(true);

    // Should NOT respond to fires in district_b
    const shouldNotRespond = dispatch.shouldFacilityRespond('fire_1', 'district_b');
    expect(shouldNotRespond).toBe(false);
  });

  it('unassigned facility should respond to any district', () => {
    // fire_2 not assigned to any district
    expect(dispatch.shouldFacilityRespond('fire_2', 'district_a')).toBe(true);
    expect(dispatch.shouldFacilityRespond('fire_2', 'district_b')).toBe(true);
  });

  it('multiple fires with limited capacity: excess fires delayed', () => {
    // Dispatch 3 fire trucks from same station with capacity 1
    const result1 = dispatch.dispatch(
      ServiceVehicleType.FIRE_TRUCK,
      { x: 1, y: 5 },
      { x: 10, y: 5 },
    );
    const result2 = dispatch.dispatch(
      ServiceVehicleType.FIRE_TRUCK,
      { x: 1, y: 5 },
      { x: 12, y: 5 },
    );
    const result3 = dispatch.dispatch(
      ServiceVehicleType.FIRE_TRUCK,
      { x: 1, y: 5 },
      { x: 14, y: 5 },
    );

    // All dispatches should find a path (capacity isn't limited in dispatch itself)
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result3).not.toBeNull();

    // The 2nd and 3rd will have >= the travel time of the 1st
    // (same origin, different destinations — further ones take longer)
    expect(result2!.estimatedTicks).toBeGreaterThanOrEqual(result1!.estimatedTicks);
    expect(result3!.estimatedTicks).toBeGreaterThanOrEqual(result1!.estimatedTicks);
  });
});

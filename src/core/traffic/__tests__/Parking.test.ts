import { describe, it, expect } from 'vitest';
import { ParkingSystem } from '../Parking';

describe('ParkingSystem', () => {
  it('should register building parking capacity based on workers', () => {
    const parking = new ParkingSystem();
    // Commercial building with 20 workers → parking spots = workers / 2 = 10
    parking.registerBuilding('10,5', 20);
    expect(parking.getCapacity('10,5')).toBe(10);
  });

  it('should allow parking when spots available', () => {
    const parking = new ParkingSystem();
    parking.registerBuilding('10,5', 20); // 10 spots
    const result = parking.tryPark('10,5');
    expect(result).toBe(true);
    expect(parking.getOccupied('10,5')).toBe(1);
  });

  it('should reject parking when full', () => {
    const parking = new ParkingSystem();
    parking.registerBuilding('10,5', 4); // 2 spots
    parking.tryPark('10,5');
    parking.tryPark('10,5');
    const result = parking.tryPark('10,5');
    expect(result).toBe(false);
    expect(parking.getOccupied('10,5')).toBe(2);
  });

  it('should release parking spot when vehicle leaves', () => {
    const parking = new ParkingSystem();
    parking.registerBuilding('10,5', 4); // 2 spots
    parking.tryPark('10,5');
    parking.tryPark('10,5');
    expect(parking.isFull('10,5')).toBe(true);
    parking.release('10,5');
    expect(parking.getOccupied('10,5')).toBe(1);
    expect(parking.isFull('10,5')).toBe(false);
  });

  it('should find nearby parking when destination is full', () => {
    const parking = new ParkingSystem();
    parking.registerBuilding('10,5', 2); // 1 spot
    parking.registerBuilding('11,5', 10); // 5 spots
    parking.registerBuilding('12,5', 10); // 5 spots
    parking.tryPark('10,5'); // fill it up

    const nearby = parking.findNearbyParking('10,5', [
      { key: '11,5', distance: 1 },
      { key: '12,5', distance: 2 },
    ]);
    expect(nearby).toBe('11,5'); // closest available
  });

  it('should return null when no nearby parking available', () => {
    const parking = new ParkingSystem();
    parking.registerBuilding('10,5', 2); // 1 spot
    parking.tryPark('10,5');

    const nearby = parking.findNearbyParking('10,5', []);
    expect(nearby).toBeNull();
  });

  it('should return 0 capacity for unregistered buildings', () => {
    const parking = new ParkingSystem();
    expect(parking.getCapacity('99,99')).toBe(0);
    expect(parking.getOccupied('99,99')).toBe(0);
    expect(parking.isFull('99,99')).toBe(true); // no capacity = full
  });

  it('should unregister building and free all spots', () => {
    const parking = new ParkingSystem();
    parking.registerBuilding('10,5', 20);
    parking.tryPark('10,5');
    parking.unregisterBuilding('10,5');
    expect(parking.getCapacity('10,5')).toBe(0);
  });

  it('should track total parking overflow count', () => {
    const parking = new ParkingSystem();
    parking.registerBuilding('10,5', 2); // 1 spot
    parking.tryPark('10,5');
    parking.tryPark('10,5'); // rejected
    parking.tryPark('10,5'); // rejected
    expect(parking.getOverflowCount()).toBe(2);
  });
});

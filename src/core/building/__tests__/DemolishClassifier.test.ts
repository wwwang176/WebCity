import { describe, it, expect } from 'vitest';
import { classifyDemolishCell, type DemolishAction } from '../DemolishClassifier';
import { getInfraBuildingId } from '../InfraConfig';

describe('classifyDemolishCell', () => {
  it('should return skip for null cell', () => {
    expect(classifyDemolishCell(null, null)).toEqual({ action: 'skip' });
  });

  it('should classify airport cell as multi_cell_infra', () => {
    const airportBid = getInfraBuildingId('airport_s');
    const cell = { buildingId: airportBid, railType: 0 };
    const result = classifyDemolishCell(cell, { x: 5, y: 5 });
    expect(result.action).toBe('multi_cell_infra');
  });

  it('should classify multi-cell infra with primary cell', () => {
    const policeBid = getInfraBuildingId('police');
    const cell = { buildingId: policeBid, railType: 0 };
    const primary = { x: 5, y: 5 };
    const result = classifyDemolishCell(cell, primary);
    expect(result.action).toBe('multi_cell_infra');
    if (result.action === 'multi_cell_infra') {
      expect(result.infraType).toBe('police');
      expect(result.primaryX).toBe(5);
      expect(result.primaryY).toBe(5);
      expect(result.cx).toBeDefined();
      expect(result.cy).toBeDefined();
    }
  });

  it('should classify 1×1 transport stop (bus_stop)', () => {
    const busBid = getInfraBuildingId('bus_stop');
    const cell = { buildingId: busBid, railType: 0 };
    const result = classifyDemolishCell(cell, null); // no primary for 1×1
    expect(result.action).toBe('single_cell_infra');
    if (result.action === 'single_cell_infra') {
      expect(result.infraType).toBe('bus_stop');
    }
  });

  it('should classify 1×1 transport stop (metro_station)', () => {
    const metroBid = getInfraBuildingId('metro_station');
    const cell = { buildingId: metroBid, railType: 0 };
    const result = classifyDemolishCell(cell, null);
    expect(result.action).toBe('single_cell_infra');
    if (result.action === 'single_cell_infra') {
      expect(result.infraType).toBe('metro_station');
    }
  });

  // BUG-052: an orphaned secondary cell of a multi-cell building must never fall
  // into 'regular' — that branch zeroes the cell WITHOUT unregistering the
  // service, producing a facility that is invisible and impossible to remove.
  it('should not classify an orphaned multi-cell infra cell as regular', () => {
    const hospitalBid = getInfraBuildingId('hospital');
    const cell = { buildingId: hospitalBid, railType: 0 };
    const result = classifyDemolishCell(cell, null); // primary unresolvable
    expect(result.action).not.toBe('regular');
    expect(result.action).toBe('single_cell_infra');
    if (result.action === 'single_cell_infra') {
      expect(result.infraType).toBe('hospital');
    }
  });

  it('should classify regular cell with road', () => {
    const cell = { buildingId: 0, railType: 0 };
    const result = classifyDemolishCell(cell, null);
    expect(result.action).toBe('regular');
    if (result.action === 'regular') {
      expect(result.hasTrack).toBe(false);
    }
  });

  it('should classify regular cell with rail track', () => {
    const cell = { buildingId: 0, railType: 1 };
    const result = classifyDemolishCell(cell, null);
    expect(result.action).toBe('regular');
    if (result.action === 'regular') {
      expect(result.hasTrack).toBe(true);
    }
  });

  it('should classify zone building as regular', () => {
    const cell = { buildingId: 1, railType: 0 }; // zone building id
    const result = classifyDemolishCell(cell, null);
    expect(result.action).toBe('regular');
  });

  it('should classify multi-cell infra center coords correctly for fire station', () => {
    const fireBid = getInfraBuildingId('fire');
    const cell = { buildingId: fireBid, railType: 0 };
    const primary = { x: 10, y: 10 };
    const result = classifyDemolishCell(cell, primary);
    expect(result.action).toBe('multi_cell_infra');
    if (result.action === 'multi_cell_infra') {
      expect(result.infraType).toBe('fire');
      // fire station is 2×2, center = primary + floor(2/2) = primary + 1
      expect(result.cx).toBe(11);
      expect(result.cy).toBe(11);
    }
  });
});

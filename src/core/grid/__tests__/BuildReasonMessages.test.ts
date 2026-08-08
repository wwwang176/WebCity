import { describe, it, expect } from 'vitest';
import { getBuildReasonMessage, formatBuildFailure, BUILD_REASON_MESSAGES } from '../BuildReasonMessages';
import { INFRA_CONFIGS } from '../../building/InfraConfig';

/**
 * A build failure has to say WHAT failed, not just why.
 *
 * Road and rail failures went through handleBuildResult and read "Cannot build
 * road: Cannot build on water". The three PLACEMENT paths — civic/utility
 * infrastructure, transit stops, airports — passed the bare reason with no
 * subject at all, so trying to drop a water plant inland produced "No
 * groundwater here — build near rivers" floating on its own, and several other
 * reasons are outright ambiguous without a subject: "Tile is occupied",
 * "Must be built adjacent to a road", "Out of bounds" tell you nothing about
 * which of the twenty tools just refused you.
 */
describe('build failure messages name their subject', () => {
  it('should prefix the subject', () => {
    expect(formatBuildFailure('Water Plant', 'NO_GROUNDWATER'))
      .toBe('Cannot place Water Plant: No groundwater here — build near rivers');
  });

  it('should use the same reason text as the bare lookup', () => {
    for (const reason of Object.keys(BUILD_REASON_MESSAGES)) {
      expect(formatBuildFailure('Police Station', reason))
        .toBe(`Cannot place Police Station: ${getBuildReasonMessage(reason)}`);
    }
  });

  it('should fall back to the raw reason for an unmapped code', () => {
    // Better a raw enum name than a blank message.
    expect(formatBuildFailure('Park', 'SOME_NEW_REASON'))
      .toBe('Cannot place Park: SOME_NEW_REASON');
  });

  it('should still work with no subject', () => {
    // Callers that genuinely have nothing to name must not print "undefined".
    expect(formatBuildFailure('', 'OUT_OF_BOUNDS')).toBe('Out of bounds');
  });

  it('should have a message for every reason canPlaceInfra can return', () => {
    // The reasons in InfraPlacement's PlaceResult union. A missing entry falls
    // back to the raw SCREAMING_CASE code, which is what a player would see.
    const fromPlacement = [
      'OUT_OF_BOUNDS', 'WATER_TILE', 'TILE_OCCUPIED', 'UNKNOWN_TYPE', 'NO_GROUNDWATER',
      'NEED_RAIL_TRACK', 'NEED_ADJACENT_WATER', 'NOT_ADJACENT_TO_ROAD', 'INFRASTRUCTURE_EXISTS',
    ];
    for (const r of fromPlacement) {
      expect(BUILD_REASON_MESSAGES[r], r).toBeDefined();
      expect(getBuildReasonMessage(r)).not.toBe(r);
    }
  });

  it('should have a display name for every placeable facility', () => {
    // The subject comes from InfraConfig.name, so an unnamed config would
    // produce "Cannot place : ...".
    for (const cfg of INFRA_CONFIGS) {
      expect(cfg.name, cfg.type).toBeTruthy();
    }
  });
});

/**
 * Every one of these strings is the entire explanation a player gets for a
 * refused build, so each is pinned exactly. Asserting instead that
 * formatBuildFailure agrees with getBuildReasonMessage is true by construction
 * and would hold for any text at all, including a typo or an empty string.
 */
describe('the reason text itself', () => {
  const PINNED: Array<[string, string]> = [
    ['WATER_TILE', 'Cannot build on water'],
    ['MOUNTAIN_TILE', 'Mountain in the way'],
    ['OUT_OF_BOUNDS', 'Out of bounds'],
    ['INSUFFICIENT_FUNDS', 'Insufficient funds'],
    ['BUILDING_EXISTS', 'Building in the way'],
    ['INFRASTRUCTURE_EXISTS', 'Infrastructure in the way'],
    ['PARALLEL_RAIL', 'Cannot run parallel to rail'],
    ['PARALLEL_ROAD', 'Cannot run parallel to road'],
    ['TILE_OCCUPIED', 'Tile is occupied'],
    ['NO_GROUNDWATER', 'No groundwater here — build near rivers'],
    ['UNKNOWN_TYPE', 'Unknown building type'],
    ['NEED_RAIL_TRACK', 'Train station must be built on rail track'],
    ['AIRPORT_OUT_OF_BOUNDS', 'Airport area is out of bounds'],
    ['AIRPORT_AREA_OCCUPIED', 'Airport area is not fully clear'],
    ['START_NOT_ON_ROAD', 'Must start on an existing road'],
    ['PATH_TOO_SHORT', 'Not enough space for ramp'],
    ['LEVEL_OCCUPIED', 'Elevation level already occupied'],
    ['RAMP_OCCUPIED', 'Cannot build over existing ramp'],
    ['RAMP_ON_WATER', 'Cannot build ramp on water'],
    ['RAMP_OVER_ROAD', 'Road underneath — no room for ramp'],
    ['RAMP_ABOVE', 'Ramp above — cannot build here'],
    ['WATER_CROSSING_NO_TURN', 'Bridge over water must be straight'],
  ];

  for (const [reason, text] of PINNED) {
    it(`should read "${text}" for ${reason}`, () => {
      expect(BUILD_REASON_MESSAGES[reason]).toBe(text);
      expect(getBuildReasonMessage(reason)).toBe(text);
      expect(formatBuildFailure('Fire Station', reason))
        .toBe(`Cannot place Fire Station: ${text}`);
    });
  }

  it('should return the raw code for an unmapped reason', () => {
    expect(getBuildReasonMessage('UNKNOWN_REASON')).toBe('UNKNOWN_REASON');
  });
});

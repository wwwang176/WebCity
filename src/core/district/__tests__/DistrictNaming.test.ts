import { describe, it, expect } from 'vitest';
import { nextDistrictName, sanitiseDistrictName, DISTRICT_NAME_MAX } from '../DistrictNaming';

/**
 * District names.
 *
 * A default of `District ${count + 1}` collides after a merge, which lowers the count: the next
 * new district can take a name that already exists. Two districts with one name are
 * indistinguishable in the sidebar, and policies are set on each of them separately.
 */

describe('預設名字', () => {
  it('should start at 1', () => {
    expect(nextDistrictName([])).toBe('District 1');
  });

  it('should skip the ones already taken', () => {
    expect(nextDistrictName(['District 1', 'District 2'])).toBe('District 3');
  });

  it('should fill a gap left by a merge', () => {
    // After a merge takes District 2 away, the next district fills that gap rather than jumping
    // to 3.
    expect(nextDistrictName(['District 1', 'District 3'])).toBe('District 2');
  });

  it('should not collide with a renamed district that took the number', () => {
    // A district the player renamed to District 5 counts as taken: a collision is a collision
    // whoever caused it.
    expect(nextDistrictName(['District 1', 'District 5'])).toBe('District 2');
    expect(nextDistrictName(['District 1', 'District 2', 'District 3', 'District 5']))
      .toBe('District 4');
  });

  it('should ignore names that are not of the default shape', () => {
    expect(nextDistrictName(['Riverside', 'Docklands'])).toBe('District 1');
  });
});

describe('玩家改的名字', () => {
  it('should trim the whitespace around it', () => {
    expect(sanitiseDistrictName('  Riverside  ', 'District 1')).toBe('Riverside');
  });

  it('should fall back when the player clears it', () => {
    // A blank name is an empty button in the sidebar with nothing to press.
    expect(sanitiseDistrictName('', 'District 3')).toBe('District 3');
    expect(sanitiseDistrictName('   ', 'District 3')).toBe('District 3');
  });

  it('should cut a name that would not fit the sidebar', () => {
    const long = 'x'.repeat(DISTRICT_NAME_MAX + 20);
    expect(sanitiseDistrictName(long, 'District 1').length).toBe(DISTRICT_NAME_MAX);
  });

  it('should keep a name that is exactly at the limit', () => {
    const exact = 'y'.repeat(DISTRICT_NAME_MAX);
    expect(sanitiseDistrictName(exact, 'District 1')).toBe(exact);
  });

  it('should strip newlines rather than let them into the label', () => {
    // Pasting multi-line text would otherwise stretch the sidebar's button.
    expect(sanitiseDistrictName('Old\nTown', 'District 1')).toBe('Old Town');
  });
});

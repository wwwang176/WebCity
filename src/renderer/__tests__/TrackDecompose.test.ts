import { describe, it, expect } from 'vitest';
import { decomposeFlags } from '../TrackRenderer';

const N = 0b0001;
const S = 0b0010;
const W = 0b0100;
const E = 0b1000;

describe('decomposeFlags', () => {
  it('straight NS → 1 straight, 0 arcs', () => {
    const r = decomposeFlags(N | S);
    expect(r.straights).toEqual(['NS']);
    expect(r.arcs).toHaveLength(0);
    expect(r.orphans).toHaveLength(0);
  });

  it('straight EW → 1 straight, 0 arcs', () => {
    const r = decomposeFlags(E | W);
    expect(r.straights).toEqual(['EW']);
    expect(r.arcs).toHaveLength(0);
    expect(r.orphans).toHaveLength(0);
  });

  it('corner N+E → 0 straights, 1 arc (NE)', () => {
    const r = decomposeFlags(N | E);
    expect(r.straights).toHaveLength(0);
    expect(r.arcs).toEqual(['NE']);
    expect(r.orphans).toHaveLength(0);
  });

  it('corner S+W → 0 straights, 1 arc (SW)', () => {
    const r = decomposeFlags(S | W);
    expect(r.straights).toHaveLength(0);
    expect(r.arcs).toEqual(['SW']);
    expect(r.orphans).toHaveLength(0);
  });

  it('T-junction N+S+E → 1 straight (NS), 2 arcs (NE, SE)', () => {
    const r = decomposeFlags(N | S | E);
    expect(r.straights).toEqual(['NS']);
    expect(r.arcs).toContain('NE');
    expect(r.arcs).toContain('SE');
    expect(r.arcs).toHaveLength(2);
    expect(r.orphans).toHaveLength(0);
  });

  it('T-junction E+W+N → 1 straight (EW), 2 arcs (NE, NW)', () => {
    const r = decomposeFlags(E | W | N);
    expect(r.straights).toEqual(['EW']);
    expect(r.arcs).toContain('NE');
    expect(r.arcs).toContain('NW');
    expect(r.arcs).toHaveLength(2);
  });

  it('cross N+S+E+W → 2 straights, 4 arcs', () => {
    const r = decomposeFlags(N | S | E | W);
    expect(r.straights).toContain('NS');
    expect(r.straights).toContain('EW');
    expect(r.straights).toHaveLength(2);
    expect(r.arcs).toHaveLength(4);
    expect(r.arcs).toContain('NE');
    expect(r.arcs).toContain('NW');
    expect(r.arcs).toContain('SE');
    expect(r.arcs).toContain('SW');
    expect(r.orphans).toHaveLength(0);
  });

  it('single direction N → orphan', () => {
    const r = decomposeFlags(N);
    expect(r.straights).toHaveLength(0);
    expect(r.arcs).toHaveLength(0);
    expect(r.orphans).toEqual(['N']);
  });

  it('single direction W → orphan', () => {
    const r = decomposeFlags(W);
    expect(r.straights).toHaveLength(0);
    expect(r.arcs).toHaveLength(0);
    expect(r.orphans).toEqual(['W']);
  });

  it('no flags → empty', () => {
    const r = decomposeFlags(0);
    expect(r.straights).toHaveLength(0);
    expect(r.arcs).toHaveLength(0);
    expect(r.orphans).toHaveLength(0);
  });
});

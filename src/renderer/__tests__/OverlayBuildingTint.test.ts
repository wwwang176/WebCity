import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { Grid } from '../../core/grid/Grid';

/**
 * A building standing on a colour patch takes that patch's colour.
 *
 * Zoning and land value are drawn on the ground, and buildings stand on the ground: a fully built
 * block shows only roofs and never the grade of the cell underneath. (While the patches were
 * misaligned it was visible, because the colour showed southeast of each building; once aligned, it
 * is entirely covered.)
 *
 * So `Game` tints the buildings too, and the colour cannot be computed twice: with a lookup table on
 * each side, changing one leaves the other different. These cases pin building colour to the colour
 * of the ground in that cell.
 */

const W = 16;
const H = 16;

/** Builds an overlay and returns the hex colour of cell (x,y)'s vertex. */
function groundHex(type: OverlayType, x: number, y: number, value: number): number {
  const renderer = new OverlayRenderer();
  const scene = new THREE.Scene();
  renderer.setOverlay(type, scene, new Grid(W, H), new Map([[`${x},${y}`, value]]));
  const mesh = (renderer as unknown as { mesh: THREE.Mesh | null }).mesh!;
  const attr = mesh.geometry.getAttribute('color');
  const idx = y * W + x;
  return new THREE.Color().setRGB(attr.getX(idx), attr.getY(idx), attr.getZ(idx)).getHex();
}

describe('colorFor', () => {
  it.each([
    [OverlayType.ZONE, 15],
    [OverlayType.ZONE, 30],
    [OverlayType.ZONE, 45],
    [OverlayType.LAND_VALUE, 10],
    [OverlayType.LAND_VALUE, 55],
    [OverlayType.LAND_VALUE, 100],
    [OverlayType.POLLUTION, 70],
    [OverlayType.CRIME, 40],
  ])('should hand out the same colour the ground gets (%s @ %i)', (type, value) => {
    expect(new OverlayRenderer().colorFor(type, value)).toBe(groundHex(type, 4, 6, value));
  });

  it('should keep two levels apart', () => {
    // Different values within one overlay have to look different; returning one colour for
    // everything would pass the case above.
    const r = new OverlayRenderer();
    expect(r.colorFor(OverlayType.LAND_VALUE, 10)).not.toBe(r.colorFor(OverlayType.LAND_VALUE, 90));
    expect(r.colorFor(OverlayType.ZONE, 15)).not.toBe(r.colorFor(OverlayType.ZONE, 45));
  });

  it('should clamp out-of-range values instead of wrapping', () => {
    const r = new OverlayRenderer();
    expect(r.colorFor(OverlayType.LAND_VALUE, 200)).toBe(r.colorFor(OverlayType.LAND_VALUE, 100));
    expect(r.colorFor(OverlayType.LAND_VALUE, -50)).toBe(r.colorFor(OverlayType.LAND_VALUE, 0));
  });
});

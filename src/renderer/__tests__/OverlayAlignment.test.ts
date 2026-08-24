import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayRenderer, OverlayType } from '../OverlayRenderer';
import { Grid } from '../../core/grid/Grid';

/**
 * A colour patch covers the cell it describes.
 *
 * The overlay is coloured per vertex and the vertices sit on the cells' **corners**: the centre of
 * cell (i,j) is at world `(i, ., j)` — buildings, the cursor and district outlines are all on
 * integers — while vertex (i,j) sits at `(i-0.5, ., j-0.5)`. The whole colour field then shifts half
 * a cell along -x and -z, which in an isometric view reads as the whole sheet moved half a cell
 * northwest.
 *
 * The blur from interpolation is a separate matter and out of scope here: a patch is meant to fade
 * between neighbouring cells, and with buildings on top it is still readable. A wrong position is
 * not.
 */

const W = 16;
const H = 16;

function build(type: OverlayType, data: Map<string, number>): THREE.Mesh {
  const renderer = new OverlayRenderer();
  const scene = new THREE.Scene();
  renderer.setOverlay(type, scene, new Grid(W, H), data);
  const mesh = (renderer as unknown as { mesh: THREE.Mesh | null }).mesh;
  expect(mesh, '覆蓋層沒有建起來，這支測試等於沒測').not.toBeNull();
  return mesh!;
}

/** Where the coloured vertices sit in world coordinates. */
function litAt(mesh: THREE.Mesh): { x: number; y: number }[] {
  const pos = mesh.geometry.getAttribute('position');
  const color = mesh.geometry.getAttribute('color');
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (color.itemSize < 4 || color.getW(i) === 0) continue;
    out.push({
      x: pos.getX(i) + mesh.position.x,
      y: pos.getZ(i) + mesh.position.z,
    });
  }
  return out;
}

/** The world extent the whole patch covers. */
function extent(mesh: THREE.Mesh): { minX: number; maxX: number; minY: number; maxY: number } {
  const pos = mesh.geometry.getAttribute('position');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + mesh.position.x;
    const y = pos.getZ(i) + mesh.position.z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

describe('覆蓋層的對位', () => {
  it('should paint the cell the value belongs to, not the corner north-west of it', () => {
    const mesh = build(OverlayType.POLLUTION, new Map([['3,5', 80]]));
    expect(litAt(mesh)).toEqual([{ x: 3, y: 5 }]);
  });

  it.each([
    [0, 0],
    [W - 1, H - 1],
    [0, H - 1],
    [W - 1, 0],
  ])('should line up at the map corner (%i, %i) too', (cx, cy) => {
    // The four corners are where the clamping happens: `Math.min(i, w-1)` folds the outermost
    // vertices back, and the direction of that fold is where the offset comes from.
    const mesh = build(OverlayType.POLICE, new Map([[`${cx},${cy}`, 80]]));
    expect(litAt(mesh)).toEqual([{ x: cx, y: cy }]);
  });

  it('should keep every overlay type on the same grid', () => {
    // Every overlay shares this construction code.
    for (const type of [
      OverlayType.DISTRICT, OverlayType.COMMUTE, OverlayType.LAND_VALUE,
      OverlayType.CRIME, OverlayType.GARBAGE, OverlayType.POWER, OverlayType.WATER,
    ]) {
      expect(litAt(build(type, new Map([['7,2', 80]]))), `${type} 沒有對齊`)
        .toEqual([{ x: 7, y: 2 }]);
    }
  });

  it('should not hang over the edge of the map', () => {
    // Pushing the whole sheet half a cell southeast would also fix the offset, but then half a cell
    // of patch hangs off the map: the terrain reaches only to w-0.5 and the extra strip floats over
    // nothing.
    const mesh = build(OverlayType.POLLUTION, new Map([['3,5', 80]]));
    expect(extent(mesh)).toEqual({ minX: 0, maxX: W - 1, minY: 0, maxY: H - 1 });
  });

  it('should still give every cell its own vertex', () => {
    // One vertex per cell; fewer means cells share a value and the overlay skips some.
    const mesh = build(OverlayType.POLLUTION, new Map([['3,5', 80]]));
    expect(mesh.geometry.getAttribute('position').count).toBe(W * H);
  });
});

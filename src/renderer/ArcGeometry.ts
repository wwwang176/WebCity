import * as THREE from 'three';

/**
 * Create a BufferGeometry containing two concentric 90° arc ribbons
 * (double center line for L-bends).
 *
 * Canonical orientation: N+E bend at origin.
 * Arc center at (0, 0, 0), arcing from (-R, 0, 0) to (0, 0, R).
 *
 * @param radius  Road center turn radius (0.5 for a grid cell)
 * @param halfGap Half-gap between the two lines (CENTER_LINE_HALF_GAP)
 * @param lineW   Width of each line
 * @param height  Y-thickness (visual only)
 * @param segs    Number of arc segments (3 is good for low-poly)
 */
export function createDoubleArcGeometry(
  radius = 0.5,
  halfGap = 0.012,
  lineW = 0.01,
  height = 0.005,
  segs = 3,
): THREE.BufferGeometry {
  const radii = [radius - halfGap, radius + halfGap];
  const vertsPerRibbon = (segs + 1) * 2;
  const totalVerts = radii.length * vertsPerRibbon;
  const trisPerRibbon = segs * 2;
  const totalTris = radii.length * trisPerRibbon;

  const positions = new Float32Array(totalVerts * 3);
  const indices: number[] = [];
  const halfH = height / 2;

  let vi = 0;
  let baseIdx = 0;

  for (const R of radii) {
    const innerR = R - lineW / 2;
    const outerR = R + lineW / 2;

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = t * Math.PI / 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);

      // Inner edge (closer to arc center)
      positions[vi++] = -innerR * cosA;
      positions[vi++] = halfH;
      positions[vi++] = innerR * sinA;

      // Outer edge (further from arc center)
      positions[vi++] = -outerR * cosA;
      positions[vi++] = halfH;
      positions[vi++] = outerR * sinA;
    }

    for (let i = 0; i < segs; i++) {
      const a = baseIdx + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }

    baseIdx += vertsPerRibbon;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { setVertexColors } from './common';

/** Strip uv attribute so all parts can merge (custom BufferGeometry has no uv). */
function stripUV(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  return geo;
}

/** Set uniform normal for all vertices (avoids computeVertexNormals averaging front+back faces). */
function setNormals(geo: THREE.BufferGeometry, nx: number, ny: number, nz: number): void {
  const count = geo.attributes.position!.count;
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

/**
 * 737-style airplane — cylindrical fuselage, hemisphere nose, upsweep tail,
 * swept wings, underwing engines with pylons, tiny nav lights.
 * Faces +X direction. Vertex colors built-in.
 */
export function buildAirplaneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // ── Constants ──
  const R = 0.06;        // fuselage radius
  const FUSE_LEN = 0.72; // cylindrical section length
  const SEGS = 8;        // circumference segments
  const TOP_Y = R * 2;   // fuselage top = diameter above ground

  // ── Fuselage: cylinder along X ──
  const fuse = stripUV(new THREE.CylinderGeometry(R, R, FUSE_LEN, SEGS));
  fuse.rotateZ(Math.PI / 2); // align along X
  fuse.translate(0, R, 0);
  setVertexColors(fuse, 0.96, 0.96, 0.96);
  parts.push(fuse);

  // ── Nose: hemisphere (front half of sphere) ──
  const nose = stripUV(new THREE.SphereGeometry(R, SEGS, 4, 0, Math.PI * 2, 0, Math.PI / 2));
  nose.rotateZ(-Math.PI / 2); // point +X
  nose.translate(FUSE_LEN / 2, R, 0);
  setVertexColors(nose, 0.96, 0.96, 0.96);
  parts.push(nose);

  // ── Cockpit windows (dark band on nose) ──
  const cockpit = stripUV(new THREE.BoxGeometry(0.02, 0.04, R * 1.6));
  cockpit.translate(FUSE_LEN / 2 + R * 0.6, R + R * 0.3, 0);
  setVertexColors(cockpit, 0.08, 0.12, 0.22);
  parts.push(cockpit);

  // ── Tail upsweep: bottom rises, top stays flush with fuselage upper edge ──
  // Custom BufferGeometry — a wedge shape tapering from circular cross-section
  // to a point, with the top edge aligned to fuselage top.
  const tailLen = 0.16;
  const tailX = -FUSE_LEN / 2;
  const tailTip = tailX - tailLen;
  // 4 faces: top, left, right, bottom-left, bottom-right
  const tv = new Float32Array([
    // Top-left at fuselage end
    tailX,   TOP_Y,     -R * 0.7,   // 0
    // Top-right at fuselage end
    tailX,   TOP_Y,      R * 0.7,   // 1
    // Bottom-left at fuselage end
    tailX,   R * 0.3,   -R * 0.7,   // 2
    // Bottom-right at fuselage end
    tailX,   R * 0.3,    R * 0.7,   // 3
    // Tip (top, flush with fuselage top)
    tailTip, TOP_Y,      0,          // 4
    // Tip bottom (upsweep — raised to near top)
    tailTip, TOP_Y * 0.7, 0,         // 5
  ]);
  const ti = [
    // Top face
    0, 4, 1,
    // Left face
    0, 2, 5,  0, 5, 4,
    // Right face
    1, 4, 5,  1, 5, 3,
    // Bottom face
    2, 3, 5,
  ];
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tv, 3));
  tailGeo.setIndex(ti);
  tailGeo.computeVertexNormals();
  setVertexColors(tailGeo, 0.93, 0.93, 0.93);
  parts.push(tailGeo);

  // ── Vertical tail (swept trapezoid, double-sided, airline blue) ──
  {
    const baseChord = 0.14;  // base front→rear (wider)
    const topChord = 0.04;   // top front→rear (narrower)
    const height = 0.15;
    const leadSweep = 0.04;  // leading edge swept back at top
    const trailSweep = 0.14; // trailing edge sweeps more
    const bx = tailX;
    const vt = new THREE.BufferGeometry();
    vt.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      bx,               TOP_Y,            0,   // 0: base front
      bx - baseChord,   TOP_Y,            0,   // 1: base rear
      bx - leadSweep,   TOP_Y + height,   0,   // 2: top front
      bx - trailSweep,  TOP_Y + height,   0,   // 3: top rear
    ]), 3));
    vt.setIndex([0, 2, 3, 0, 3, 1, 0, 3, 2, 0, 1, 3]); // both sides
    setNormals(vt, 0, 0, 1);
    setVertexColors(vt, 0.13, 0.59, 0.95);
    parts.push(vt);
  }

  // ── Horizontal tail (single piece, double-sided, swept trapezoid) ──
  {
    const rootChord = 0.10;
    const tipChord = 0.02;       // much narrower than root → visible taper
    const halfSpan = 0.18;
    const leadSweep = 0.03;      // leading edge sweep
    const trailSweep = 0.11;     // trailing edge sweeps more → tip narrower
    const htY = TOP_Y * 0.85;
    const rx = tailX - 0.02;
    const ht = new THREE.BufferGeometry();
    ht.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      rx - leadSweep,   htY,  -halfSpan,    // 0: left tip lead
      rx - trailSweep,  htY,  -halfSpan,    // 1: left tip trail
      rx,               htY,   0,            // 2: root lead
      rx - rootChord,   htY,   0,            // 3: root trail
      rx - leadSweep,   htY,   halfSpan,     // 4: right tip lead
      rx - trailSweep,  htY,   halfSpan,     // 5: right tip trail
    ]), 3));
    ht.setIndex([
      0, 2, 1, 1, 2, 3,  // left top
      2, 4, 3, 3, 4, 5,  // right top
      0, 1, 2, 1, 3, 2,  // left bottom
      2, 3, 4, 3, 5, 4,  // right bottom
    ]);
    setNormals(ht, 0, 1, 0);
    setVertexColors(ht, 0.90, 0.90, 0.90);
    parts.push(ht);
  }

  // ── Main wings (single piece, double-sided, swept trapezoid ~25°) ──
  {
    const rootChord = 0.22;
    const tipChord = 0.03;       // much narrower → strong taper (7:1 ratio)
    const halfSpan = 0.45;
    const leadSweep = 0.16;      // leading edge sweep (larger)
    const trailSweep = 0.28;     // trailing edge sweeps more
    const wingY = R * 0.85;
    const rx = 0.12;             // root lead further forward
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      rx - leadSweep,   wingY,  -halfSpan,   // 0: left tip lead
      rx - trailSweep,  wingY,  -halfSpan,   // 1: left tip trail
      rx,               wingY,   0,           // 2: root lead
      rx - rootChord,   wingY,   0,           // 3: root trail
      rx - leadSweep,   wingY,   halfSpan,    // 4: right tip lead
      rx - trailSweep,  wingY,   halfSpan,    // 5: right tip trail
    ]), 3));
    wing.setIndex([
      0, 2, 1, 1, 2, 3,  // left top
      2, 4, 3, 3, 4, 5,  // right top
      0, 1, 2, 1, 3, 2,  // left bottom
      2, 3, 4, 3, 5, 4,  // right bottom
    ]);
    setNormals(wing, 0, 1, 0);
    setVertexColors(wing, 0.90, 0.90, 0.90);
    parts.push(wing);
  }

  // ── Engines (underwing, with pylons) ──
  {
    const engR = 0.03;
    const engLen = 0.12;
    const engY = R * 0.35;
    const engOffsets = [-0.18, 0.18];
    for (const dz of engOffsets) {
      const nacelle = stripUV(new THREE.CylinderGeometry(engR * 0.85, engR, engLen, 6));
      nacelle.rotateZ(Math.PI / 2);
      nacelle.translate(0.02, engY, dz);
      setVertexColors(nacelle, 0.45, 0.45, 0.45);
      parts.push(nacelle);

      const intake = stripUV(new THREE.CircleGeometry(engR * 0.85, 6));
      intake.rotateY(Math.PI / 2);
      intake.translate(0.02 + engLen / 2, engY, dz);
      setVertexColors(intake, 0.25, 0.25, 0.25);
      parts.push(intake);
    }
  }

  return mergeGeometries(parts)!;
}

/**
 * Nav lights as a separate geometry (rendered with MeshBasicMaterial, blinks).
 * Must match the same local coordinate system as buildAirplaneGeometry.
 */
export function buildAirplaneNavLightsGeometry(): THREE.BufferGeometry {
  const R = 0.06;
  const TOP_Y = R * 2;
  const FUSE_LEN = 0.72;
  const tailX = -FUSE_LEN / 2;
  const navSize = 0.012;
  const wingY = R * 0.85;
  const tipX = 0.12 - 0.16;   // root lead X - leadSweep
  const halfSpan = 0.45;

  const parts: THREE.BufferGeometry[] = [];

  // Port (left) — red
  const navL = stripUV(new THREE.BoxGeometry(navSize, navSize * 0.8, navSize));
  navL.translate(tipX, wingY, -halfSpan);
  setVertexColors(navL, 1.0, 0.1, 0.1);
  parts.push(navL);

  // Starboard (right) — green
  const navR = stripUV(new THREE.BoxGeometry(navSize, navSize * 0.8, navSize));
  navR.translate(tipX, wingY, halfSpan);
  setVertexColors(navR, 0.1, 1.0, 0.1);
  parts.push(navR);

  // Tail — white (top of vertical tail)
  const navT = stripUV(new THREE.BoxGeometry(navSize, navSize * 0.8, navSize));
  navT.translate(tailX - 0.04, TOP_Y + 0.14, 0);
  setVertexColors(navT, 1.0, 1.0, 1.0);
  parts.push(navT);

  return mergeGeometries(parts)!;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Grid } from '../core/grid/Grid';
import { ZoneType } from '../core/grid/types';
import { getInfraConfig, type InfraType as InfraConfigType } from '../core/building/InfraConfig';
import { ViewMode } from '../core/ViewMode';
import { RESERVED_TO_ROTATION } from '../core/building/InfraPlacement';

// ===== Deterministic pseudo-random based on position =====
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263 + 1013904223) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ===== Part tagging via vertex colors =====
// R = part type (0=wall, 1=roof), G = zone category, B = reserved
const PART_WALL = 0.0;
const PART_FOLIAGE = 0.5;
const PART_ROOF = 1.0;

function tagPart(geo: THREE.BufferGeometry, part: number): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = part;
    arr[i * 3 + 1] = 0; // zone set later
    arr[i * 3 + 2] = 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// Zone category constants (encoded in vertex color G channel)
const ZONE_CAT: Record<number, number> = {
  [ZoneType.RESIDENTIAL_LOW]:  0.0,
  [ZoneType.RESIDENTIAL_HIGH]: 0.2,
  [ZoneType.COMMERCIAL_LOW]:   0.4,
  [ZoneType.COMMERCIAL_HIGH]:  0.6,
  [ZoneType.INDUSTRIAL]:       0.8,
  [ZoneType.OFFICE]:           1.0,
};

function stampZoneCategory(geo: THREE.BufferGeometry, cat: number): void {
  const attr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let i = 0; i < attr.count; i++) {
    arr[i * 3 + 1] = cat;
  }
}

// ===== Color Palettes (realistic, zone-distinguishable) =====
const ZONE_PALETTES: Record<number, number[]> = {
  [ZoneType.RESIDENTIAL_LOW]:  [
    0xf0ece4, // white render
    0xe8e0d0, // warm cream
    0xc47050, // red brick
    0xd4a870, // buff/sandstone
    0xe0d8c8, // pale ivory
    0xb85838, // dark red brick
    0xd8c8a0, // honey stone
    0xe8dcd0, // off-white
    0xc8906c, // salmon brick
    0xd0c4a8, // pale yellow stone
    0xf0e8dc, // bright cream
    0xa86040, // terracotta brick
  ],
  [ZoneType.RESIDENTIAL_HIGH]: [
    0xe0d4b8, // Paris cream stone
    0xc8c0b0, // warm gray
    0xd8ccac, // pale yellow stone
    0xb87858, // Amsterdam brick
    0xe4dcd0, // off-white plaster
    0xd0c4a0, // honey limestone
    0xc4a880, // sandstone
    0xd8d0c0, // light cream
  ],
  [ZoneType.COMMERCIAL_LOW]:   [
    0xd8c888, // warm yellow
    0xe8e0d0, // white plaster
    0xc87050, // brick red
    0xb8c8d8, // pale blue
    0xd4c4a0, // warm cream
    0xd0b870, // golden
    0xe0d0b8, // light sand
    0xc0a878, // tan
  ],
  [ZoneType.COMMERCIAL_HIGH]:  [
    0x78a8c0, // blue-green glass
    0xc8b890, // warm limestone
    0x88b0a0, // green glass
    0xa0a8b0, // steel gray
    0xd8d4d0, // white modern
    0x90a8b8, // light blue glass
    0xb8a880, // sandstone classic
    0x80a0b8, // teal glass
  ],
  [ZoneType.INDUSTRIAL]:       [
    0xb0b4b8, // silver metal
    0xa86048, // red brick factory
    0xd0ccc8, // white panel
    0xa07050, // rust/corten steel
    0x808480, // dark gray
    0xc0b8b0, // light concrete
    0x907060, // weathered brick
    0xb8b0a0, // beige concrete
  ],
  [ZoneType.OFFICE]:           [
    0x88b0c8, // light blue glass
    0x607890, // deep blue glass
    0xc8ccd0, // white modern
    0xb8a890, // warm stone base
    0x80a8a0, // green glass
    0xa0b4c0, // steel blue
    0x98a8b0, // cool gray
    0x70a0b8, // teal
  ],
};

// ===== Height ranges per zone =====
const ZONE_HEIGHTS: Record<number, { min: number; max: number }> = {
  [ZoneType.RESIDENTIAL_LOW]:  { min: 0.25, max: 0.7 },
  [ZoneType.RESIDENTIAL_HIGH]: { min: 1.0, max: 3.0 },
  [ZoneType.COMMERCIAL_LOW]:   { min: 0.4, max: 1.0 },
  [ZoneType.COMMERCIAL_HIGH]:  { min: 1.2, max: 2.8 },
  [ZoneType.INDUSTRIAL]:       { min: 0.4, max: 1.0 },
  [ZoneType.OFFICE]:           { min: 1.5, max: 4.5 },
};

// ===== Building Shader =====
const BUILDING_VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;

void main() {
  vLocalPos = position;

  #ifdef USE_COLOR
    vPartType = color.r;
    vZoneCat = color.g;
  #else
    vPartType = 0.0;
    vZoneCat = 0.0;
  #endif

  #ifdef USE_INSTANCING_COLOR
    vBldgColor = instanceColor;
  #else
    vBldgColor = vec3(0.7);
  #endif

  #ifdef USE_INSTANCING
    mat4 world = modelMatrix * instanceMatrix;
  #else
    mat4 world = modelMatrix;
  #endif

  vec4 wPos = world * vec4(position, 1.0);
  vWorldPos = wPos.xyz;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = projectionMatrix * viewMatrix * wPos;

  // Shadow map: transformedNormal required by shadowmap_vertex
  vec3 transformedNormal = vNormal;
  vec4 worldPosition = wPos;
  #include <shadowmap_vertex>
}
`;

const BUILDING_FRAG = /* glsl */ `
precision highp float;

#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>

uniform float uGlobalOpacity;
uniform float uDesaturate;

varying vec3 vNormal;
varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vBldgColor;
varying float vPartType;
varying float vZoneCat;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

// === Independent roof color palettes per zone ===
vec3 getRoofColor(float zoneCat, float h) {
  // Residential Low: clay tiles, slate
  if (zoneCat < 0.1) {
    if (h < 0.17) return vec3(0.35, 0.22, 0.14); // dark brown tiles
    if (h < 0.33) return vec3(0.58, 0.30, 0.18); // terracotta red
    if (h < 0.50) return vec3(0.40, 0.38, 0.36); // slate gray
    if (h < 0.67) return vec3(0.45, 0.28, 0.16); // warm brown
    if (h < 0.83) return vec3(0.52, 0.34, 0.22); // cedar brown
    return vec3(0.32, 0.30, 0.28);                // dark slate
  }
  // Residential High: Paris zinc, dark slate
  if (zoneCat < 0.3) {
    if (h < 0.25) return vec3(0.45, 0.45, 0.48); // zinc gray
    if (h < 0.50) return vec3(0.30, 0.30, 0.32); // dark slate
    if (h < 0.75) return vec3(0.38, 0.36, 0.34); // warm dark gray
    return vec3(0.35, 0.38, 0.42);                // blue-gray slate
  }
  // Commercial Low: European shop roofs
  if (zoneCat < 0.5) {
    if (h < 0.20) return vec3(0.55, 0.28, 0.16); // terracotta
    if (h < 0.40) return vec3(0.35, 0.22, 0.14); // dark brown
    if (h < 0.60) return vec3(0.38, 0.36, 0.34); // dark gray
    if (h < 0.80) return vec3(0.42, 0.25, 0.15); // warm brown tile
    return vec3(0.30, 0.30, 0.28);                // charcoal
  }
  // Commercial High: flat modern roofs
  if (zoneCat < 0.7) {
    if (h < 0.33) return vec3(0.32, 0.34, 0.36); // dark flat gray
    if (h < 0.66) return vec3(0.38, 0.42, 0.40); // green-gray (copper patina)
    return vec3(0.28, 0.30, 0.32);                // charcoal
  }
  // Industrial: metal roofing
  if (zoneCat < 0.9) {
    if (h < 0.25) return vec3(0.55, 0.56, 0.58); // light silver metal
    if (h < 0.50) return vec3(0.40, 0.40, 0.42); // medium gray metal
    if (h < 0.75) return vec3(0.50, 0.35, 0.25); // rusted metal
    return vec3(0.35, 0.36, 0.38);                // dark metal
  }
  // Office: modern flat roofs
  if (h < 0.33) return vec3(0.30, 0.32, 0.35); // dark gray flat
  if (h < 0.66) return vec3(0.25, 0.28, 0.30); // very dark
  return vec3(0.35, 0.35, 0.38);                // medium gray
}

void main() {
  vec3 n = normalize(vNormal);
  bool isLitWindow = false;

  // Read real lights from Three.js uniforms (set by lights_pars_begin)
  float ambient = (ambientLightColor.r + ambientLightColor.g + ambientLightColor.b) / 3.0;
  #if NUM_DIR_LIGHTS > 0
    vec3 sunDir = normalize(directionalLights[0].direction);
    float sunIntensity = length(directionalLights[0].color);
  #else
    vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
    float sunIntensity = 1.0;
  #endif
  float sunDiff = max(dot(n, sunDir), 0.0);
  vec3 fillDir = normalize(vec3(-0.6, 0.3, -0.4));
  float fillDiff = max(dot(n, fillDir), 0.0);
  float lighting = max(0.08, ambient * 0.7) + (0.45 * sunDiff + 0.13 * fillDiff) * sunIntensity;

  bool isFoliage = vPartType > 0.35 && vPartType < 0.65;
  bool isRoof = vPartType > 0.8 || (n.y > 0.85 && vPartType < 0.1);
  bool isFloor = n.y < -0.85;

  vec3 color;

  if (isFoliage) {
    // Green foliage with variation based on position
    float fh = hash21(vWorldPos.xz * 3.7);
    vec3 baseGreen = mix(vec3(0.18, 0.35, 0.12), vec3(0.25, 0.45, 0.15), fh);
    // Darker at bottom, lighter at top
    float topFade = smoothstep(0.0, 0.25, vWorldPos.y);
    color = baseGreen * (0.7 + 0.3 * topFade);
    color *= lighting;
  } else if (isFloor) {
    color = vBldgColor * 0.3;
  } else if (isRoof) {
    float rh = hash21(floor(vWorldPos.xz * 1.01));
    color = getRoofColor(vZoneCat, rh);
    color *= lighting;
  } else {
    // === WALL — zone-specific patterns ===
    float y = vWorldPos.y;
    float wallU;
    if (abs(n.x) > abs(n.z)) {
      wallU = vWorldPos.z;
    } else {
      wallU = vWorldPos.x;
    }
    bool onWall = abs(n.y) < 0.3 && y > 0.06;

    // ---- RESIDENTIAL LOW: painted siding, no window grid ----
    if (vZoneCat < 0.1) {
      color = vBldgColor * 0.9;
      if (onWall) {
        // Subtle horizontal siding lines
        float board = fract(y / 0.06);
        float line = smoothstep(0.0, 0.06, board) * smoothstep(0.12, 0.06, board);
        color = vBldgColor * (0.88 - line * 0.06);
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    }

    // ---- RESIDENTIAL HIGH: medium-spaced windows ----
    else if (vZoneCat < 0.3) {
      float floorH = 0.25;
      float winW = 0.2;
      float fy = y / floorH;
      float fx = wallU / winW;
      float fracY = fract(fy);
      float fracX = fract(fx);
      bool inWin = onWall &&
                   fracX > 0.2 && fracX < 0.8 &&
                   fracY > 0.25 && fracY < 0.68;
      if (inWin) {
        vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 7.13;
        float lit = hash21(wid);
        if (lit > 0.4) {
          float w = hash21(wid + 77.7);
          color = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
          isLitWindow = true;
        } else {
          color = vBldgColor * 0.22 + vec3(0.03, 0.05, 0.08);
        }
      } else if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        color = vBldgColor * 0.72;
      } else {
        color = vBldgColor * 0.88;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }

    // ---- COMMERCIAL LOW: storefront glass bottom, simple wall above ----
    else if (vZoneCat < 0.5) {
      if (onWall && y < 0.22) {
        // Large storefront glass
        float glassU = fract(wallU / 0.25);
        bool inGlass = glassU > 0.06 && glassU < 0.94;
        if (inGlass) {
          float r = hash21(floor(vec2(wallU / 0.25, 0.0)) + vWorldPos.xz * 3.7);
          color = mix(vec3(0.45, 0.58, 0.68), vec3(0.55, 0.7, 0.78), r);
        } else {
          color = vBldgColor * 0.6; // mullion
        }
      } else if (onWall) {
        // Upper wall — sparse small windows
        float floorH = 0.3;
        float winW = 0.22;
        float fy = y / floorH;
        float fx = wallU / winW;
        float fracY = fract(fy);
        float fracX = fract(fx);
        bool inWin = fracX > 0.3 && fracX < 0.7 && fracY > 0.3 && fracY < 0.65;
        if (inWin) {
          vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 5.3;
          float lit = hash21(wid);
          if (lit > 0.5) {
            color = mix(vec3(0.9, 0.85, 0.6), vec3(0.8, 0.7, 0.45), lit) * 0.8;
            isLitWindow = true;
          } else {
            color = vBldgColor * 0.25 + vec3(0.03, 0.04, 0.08);
          }
        } else {
          color = vBldgColor * 0.85;
        }
      } else {
        color = vBldgColor * 0.85;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }

    // ---- COMMERCIAL HIGH: dense glass curtain wall ----
    else if (vZoneCat < 0.7) {
      float floorH = 0.22;
      float winW = 0.1;
      float fy = y / floorH;
      float fx = wallU / winW;
      float fracY = fract(fy);
      float fracX = fract(fx);
      bool inWin = onWall &&
                   fracX > 0.08 && fracX < 0.92 &&
                   fracY > 0.12 && fracY < 0.82;
      if (inWin) {
        vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 7.13;
        float lit = hash21(wid);
        if (lit > 0.3) {
          float w = hash21(wid + 77.7);
          color = mix(vec3(0.92, 0.88, 0.65), vec3(0.82, 0.72, 0.42), w) * (0.8 + w * 0.15);
          isLitWindow = true;
        } else {
          color = vec3(0.35, 0.48, 0.58) * (0.6 + hash21(wid + 33.3) * 0.3);
        }
      } else {
        color = vBldgColor * 0.5; // narrow mullions
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }

    // ---- INDUSTRIAL: corrugated metal, large doors ----
    else if (vZoneCat < 0.9) {
      if (onWall) {
        // Horizontal corrugation ridges
        float ridge = fract(y / 0.08);
        float shade = smoothstep(0.0, 0.3, ridge) * smoothstep(1.0, 0.7, ridge);
        color = vBldgColor * (0.72 + shade * 0.18);

        // Large loading door at ground level
        float doorU = fract(wallU / 0.35);
        if (y < 0.18 && doorU > 0.12 && doorU < 0.88) {
          color = vBldgColor * 0.4 + vec3(0.02, 0.02, 0.01);
          // Horizontal door slats
          float slat = fract(y / 0.03);
          color *= 0.9 + 0.1 * step(0.5, slat);
        }
      } else {
        color = vBldgColor * 0.78;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.65 + 0.35 * ao;
    }

    // ---- OFFICE: dense window grid ----
    else {
      float floorH = 0.25;
      float winW = 0.125;
      float fy = y / floorH;
      float fx = wallU / winW;
      float fracY = fract(fy);
      float fracX = fract(fx);
      bool inWin = onWall &&
                   fracX > 0.15 && fracX < 0.85 &&
                   fracY > 0.2 && fracY < 0.72;
      if (inWin) {
        vec2 wid = floor(vec2(fx, fy)) + vWorldPos.xz * 7.13;
        float lit = hash21(wid);
        if (lit > 0.35) {
          float w = hash21(wid + 77.7);
          color = mix(vec3(0.95, 0.88, 0.6), vec3(0.85, 0.75, 0.4), w) * (0.8 + w * 0.15);
          isLitWindow = true;
        } else {
          color = vBldgColor * 0.2 + vec3(0.03, 0.05, 0.09);
        }
      } else if (onWall && (fracY > 0.92 || fracY < 0.08)) {
        color = vBldgColor * 0.7;
      } else {
        color = vBldgColor * 0.88;
      }
      color *= lighting;
      float ao = smoothstep(0.0, 0.1, y);
      color *= 0.6 + 0.4 * ao;
    }
  }

  // Apply shadow from directional light
  #if NUM_DIR_LIGHT_SHADOWS > 0
    float shadow = getShadow(
      directionalShadowMap[0],
      directionalLightShadows[0].shadowMapSize,
      directionalLightShadows[0].shadowIntensity,
      directionalLightShadows[0].shadowBias,
      directionalLightShadows[0].shadowRadius,
      vDirectionalShadowCoord[0]
    );
    color *= 0.45 + 0.55 * shadow;
  #endif

  // Night window glow
  if (isLitWindow) {
    float nightFactor = 1.0 - smoothstep(0.0, 0.3, sunIntensity);
    vec3 warmGlow = vec3(0.95, 0.85, 0.5);
    color = mix(color, warmGlow * 0.9, nightFactor * 0.7);
  }

  // Underground mode: white model effect (fade to near-white)
  if (uDesaturate > 0.0) {
    color = mix(color, vec3(0.88), uDesaturate);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

function createBuildingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
      ]),
      uGlobalOpacity: { value: 1.0 },
      uDesaturate: { value: 0.0 },
    },
    vertexShader: BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
    vertexColors: true,
    lights: true,
    transparent: true,
  });
}

let _buildingMaterial: THREE.ShaderMaterial | null = null;
function getBuildingMaterial(): THREE.ShaderMaterial {
  if (!_buildingMaterial) _buildingMaterial = createBuildingMaterial();
  return _buildingMaterial;
}

// ===== Geometry Builders =====

// -- Residential Low: houses with yards/garages --

function makeResLowV1(): THREE.BufferGeometry {
  // House with pitched roof + detached garage
  const body = new THREE.BoxGeometry(0.36, 0.32, 0.34);
  body.translate(-0.08, 0.16, -0.06);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.32, 0.18, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(-0.08, 0.41, -0.06);
  tagPart(roof, PART_ROOF);
  // Garage
  const garage = new THREE.BoxGeometry(0.2, 0.18, 0.22);
  garage.translate(0.22, 0.09, 0.18);
  tagPart(garage, PART_WALL);
  const gRoof = new THREE.BoxGeometry(0.22, 0.03, 0.24);
  gRoof.translate(0.22, 0.195, 0.18);
  tagPart(gRoof, PART_ROOF);
  // Front hedge
  const hedge = new THREE.BoxGeometry(0.3, 0.08, 0.06);
  hedge.translate(-0.08, 0.04, 0.25);
  tagPart(hedge, PART_FOLIAGE);
  // Garden tree
  const trunk = new THREE.CylinderGeometry(0.015, 0.02, 0.15, 5);
  trunk.translate(0.28, 0.075, -0.22);
  tagPart(trunk, PART_WALL);
  const canopy = new THREE.SphereGeometry(0.1, 5, 4);
  canopy.translate(0.28, 0.2, -0.22);
  tagPart(canopy, PART_FOLIAGE);
  return mergeGeometries([body, roof, garage, gRoof, hedge, trunk, canopy])!;
}

function makeResLowV2(): THREE.BufferGeometry {
  // Wide bungalow + garden shed
  const body = new THREE.BoxGeometry(0.5, 0.26, 0.36);
  body.translate(0, 0.13, -0.06);
  tagPart(body, PART_WALL);
  const porch = new THREE.BoxGeometry(0.18, 0.14, 0.1);
  porch.translate(0.18, 0.07, 0.15);
  tagPart(porch, PART_WALL);
  const shed = new THREE.BoxGeometry(0.14, 0.16, 0.14);
  shed.translate(-0.22, 0.08, 0.22);
  tagPart(shed, PART_WALL);
  const shedRoof = new THREE.BoxGeometry(0.16, 0.02, 0.16);
  shedRoof.translate(-0.22, 0.17, 0.22);
  tagPart(shedRoof, PART_ROOF);
  // Side bushes
  const bush1 = new THREE.SphereGeometry(0.06, 5, 4);
  bush1.translate(0.32, 0.06, -0.28);
  tagPart(bush1, PART_FOLIAGE);
  const bush2 = new THREE.SphereGeometry(0.05, 5, 4);
  bush2.translate(0.32, 0.05, -0.16);
  tagPart(bush2, PART_FOLIAGE);
  // Back garden tree
  const trunk = new THREE.CylinderGeometry(0.015, 0.02, 0.18, 5);
  trunk.translate(-0.08, 0.09, -0.32);
  tagPart(trunk, PART_WALL);
  const canopy = new THREE.SphereGeometry(0.12, 5, 4);
  canopy.translate(-0.08, 0.24, -0.32);
  tagPart(canopy, PART_FOLIAGE);
  return mergeGeometries([body, porch, shed, shedRoof, bush1, bush2, trunk, canopy])!;
}

function makeResLowV3(): THREE.BufferGeometry {
  // Narrow townhouse with steep roof + small yard wall
  const body = new THREE.BoxGeometry(0.32, 0.4, 0.4);
  body.translate(0, 0.2, -0.04);
  tagPart(body, PART_WALL);
  const roof = new THREE.ConeGeometry(0.3, 0.22, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.51, -0.04);
  tagPart(roof, PART_ROOF);
  // Low yard wall / fence
  const fence = new THREE.BoxGeometry(0.4, 0.06, 0.03);
  fence.translate(0.05, 0.03, 0.22);
  tagPart(fence, PART_WALL);
  // Front hedge row
  const hedge1 = new THREE.BoxGeometry(0.14, 0.07, 0.05);
  hedge1.translate(-0.12, 0.035, 0.22);
  tagPart(hedge1, PART_FOLIAGE);
  const hedge2 = new THREE.BoxGeometry(0.14, 0.07, 0.05);
  hedge2.translate(0.22, 0.035, 0.22);
  tagPart(hedge2, PART_FOLIAGE);
  // Corner bush
  const bush = new THREE.SphereGeometry(0.07, 5, 4);
  bush.translate(-0.25, 0.07, 0.28);
  tagPart(bush, PART_FOLIAGE);
  return mergeGeometries([body, roof, fence, hedge1, hedge2, bush])!;
}

// -- Residential High --

function makeResHighV1(): THREE.BufferGeometry {
  const main = new THREE.BoxGeometry(0.6, 0.8, 0.55);
  main.translate(0, 0.4, 0);
  tagPart(main, PART_WALL);
  const top = new THREE.BoxGeometry(0.4, 0.25, 0.35);
  top.translate(0, 0.925, 0);
  tagPart(top, PART_ROOF);
  return mergeGeometries([main, top])!;
}

function makeResHighV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.45, 1.0, 0.45);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.BoxGeometry(0.5, 0.06, 0.5);
  cap.translate(0, 1.03, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

function makeResHighV3(): THREE.BufferGeometry {
  const wing1 = new THREE.BoxGeometry(0.6, 0.7, 0.3);
  wing1.translate(0, 0.35, -0.1);
  tagPart(wing1, PART_WALL);
  const wing2 = new THREE.BoxGeometry(0.3, 0.7, 0.6);
  wing2.translate(-0.15, 0.35, 0.15);
  tagPart(wing2, PART_WALL);
  return mergeGeometries([wing1, wing2])!;
}

// -- Commercial Low --

function makeComLowV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.6, 0.4, 0.55);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const awning = new THREE.BoxGeometry(0.65, 0.03, 0.15);
  awning.translate(0, 0.35, 0.32);
  tagPart(awning, PART_ROOF);
  return mergeGeometries([body, awning])!;
}

function makeComLowV2(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.7, 0.35, 0.5);
  body.translate(0, 0.175, 0);
  tagPart(body, PART_WALL);
  const sign = new THREE.BoxGeometry(0.55, 0.06, 0.02);
  sign.translate(0, 0.38, 0.26);
  tagPart(sign, PART_ROOF);
  return mergeGeometries([body, sign])!;
}

function makeComLowV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 0.4, 0.5);
  body.translate(0, 0.2, 0);
  tagPart(body, PART_WALL);
  const entry = new THREE.BoxGeometry(0.15, 0.3, 0.08);
  entry.translate(0, 0.15, 0.29);
  tagPart(entry, PART_WALL);
  return mergeGeometries([body, entry])!;
}

// -- Commercial High --

function makeComHighV1(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.6, 0.4, 0.6);
  base.translate(0, 0.2, 0);
  tagPart(base, PART_WALL);
  const tower = new THREE.BoxGeometry(0.45, 0.8, 0.45);
  tower.translate(0, 0.8, 0);
  tagPart(tower, PART_WALL);
  return mergeGeometries([base, tower])!;
}

function makeComHighV2(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.28, 0.3, 1.0, 8);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const cap = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 8);
  cap.translate(0, 1.025, 0);
  tagPart(cap, PART_ROOF);
  return mergeGeometries([body, cap])!;
}

// -- Industrial: factories with yards --

function makeIndV1(): THREE.BufferGeometry {
  // Factory + small utility shed
  const body = new THREE.BoxGeometry(0.5, 0.38, 0.45);
  body.translate(-0.04, 0.19, -0.04);
  tagPart(body, PART_WALL);
  const chimney = new THREE.CylinderGeometry(0.06, 0.08, 0.4, 6);
  chimney.translate(0.15, 0.58, -0.15);
  tagPart(chimney, PART_WALL);
  // Utility shed
  const shed = new THREE.BoxGeometry(0.18, 0.16, 0.2);
  shed.translate(0.26, 0.08, 0.2);
  tagPart(shed, PART_WALL);
  return mergeGeometries([body, chimney, shed])!;
}

function makeIndV2(): THREE.BufferGeometry {
  // Warehouse + loading dock area
  const body = new THREE.BoxGeometry(0.55, 0.28, 0.5);
  body.translate(0, 0.14, -0.05);
  tagPart(body, PART_WALL);
  const dock = new THREE.BoxGeometry(0.3, 0.06, 0.15);
  dock.translate(0, 0.03, 0.28);
  tagPart(dock, PART_WALL);
  return mergeGeometries([body, dock])!;
}

function makeIndV3(): THREE.BufferGeometry {
  // Double chimney factory + yard wall
  const body = new THREE.BoxGeometry(0.48, 0.32, 0.42);
  body.translate(0, 0.16, 0);
  tagPart(body, PART_WALL);
  const ch1 = new THREE.CylinderGeometry(0.05, 0.07, 0.35, 6);
  ch1.translate(-0.12, 0.495, -0.12);
  tagPart(ch1, PART_WALL);
  const ch2 = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
  ch2.translate(0.12, 0.47, -0.12);
  tagPart(ch2, PART_WALL);
  // Compound wall
  const wall = new THREE.BoxGeometry(0.5, 0.1, 0.03);
  wall.translate(0, 0.05, 0.26);
  tagPart(wall, PART_WALL);
  return mergeGeometries([body, ch1, ch2, wall])!;
}

// -- Office --

function makeOfficeV1(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 1.0, 0.5);
  body.translate(0, 0.5, 0);
  tagPart(body, PART_WALL);
  const antenna = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4);
  antenna.translate(0, 1.1, 0);
  tagPart(antenna, PART_ROOF);
  return mergeGeometries([body, antenna])!;
}

function makeOfficeV2(): THREE.BufferGeometry {
  const b1 = new THREE.BoxGeometry(0.6, 0.5, 0.6);
  b1.translate(0, 0.25, 0);
  tagPart(b1, PART_WALL);
  const b2 = new THREE.BoxGeometry(0.45, 0.4, 0.45);
  b2.translate(0, 0.7, 0);
  tagPart(b2, PART_WALL);
  const b3 = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  b3.translate(0, 1.05, 0);
  tagPart(b3, PART_ROOF);
  return mergeGeometries([b1, b2, b3])!;
}

function makeOfficeV3(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.65, 0.8, 0.5);
  body.translate(0, 0.4, 0);
  tagPart(body, PART_WALL);
  const equip = new THREE.BoxGeometry(0.2, 0.1, 0.15);
  equip.translate(0.15, 0.85, 0.1);
  tagPart(equip, PART_ROOF);
  return mergeGeometries([body, equip])!;
}

// ===== Variant Registry =====
type GeoBuilder = () => THREE.BufferGeometry;

const VARIANTS: Record<number, GeoBuilder[]> = {
  [ZoneType.RESIDENTIAL_LOW]:  [makeResLowV1, makeResLowV2, makeResLowV3],
  [ZoneType.RESIDENTIAL_HIGH]: [makeResHighV1, makeResHighV2, makeResHighV3],
  [ZoneType.COMMERCIAL_LOW]:   [makeComLowV1, makeComLowV2, makeComLowV3],
  [ZoneType.COMMERCIAL_HIGH]:  [makeComHighV1, makeComHighV2],
  [ZoneType.INDUSTRIAL]:       [makeIndV1, makeIndV2, makeIndV3],
  [ZoneType.OFFICE]:           [makeOfficeV1, makeOfficeV2, makeOfficeV3],
};

// ===== Infrastructure buildingId markers =====
const INFRA_POWER_ID = 254;
const INFRA_WATER_ID = 253;
const INFRA_POLICE_ID = 252;
const INFRA_FIRE_ID = 251;
const INFRA_HOSPITAL_ID = 250;
const INFRA_SCHOOL_ID = 249;
const INFRA_PARK_ID = 248;
const INFRA_GARBAGE_ID = 247;
const INFRA_SEWAGE_ID = 246;
const INFRA_CEMETERY_ID = 245;
const INFRA_SCHOOL_HIGH_ID = 244;
const INFRA_SCHOOL_UNIV_ID = 243;
// Transport stop buildingIds
const TRANS_BUS_STOP_ID = 242;
const TRANS_METRO_STATION_ID = 241;
const TRANS_TRAIN_STATION_ID = 239;
const TRANS_FERRY_DOCK_ID = 238;
const TRANS_AIRPORT_ID = 237;
const TRANS_TAXI_STAND_ID = 236;
type InfraType = 'power' | 'water' | 'police' | 'fire' | 'hospital' | 'school' | 'school_high' | 'school_univ' | 'park' | 'garbage' | 'sewage' | 'cemetery'
  | 'bus_stop' | 'metro_station' | 'train_station' | 'ferry_dock' | 'airport' | 'taxi_stand';
const INFRA_ID_MAP: Record<number, InfraType> = {
  [INFRA_POWER_ID]: 'power', [INFRA_WATER_ID]: 'water',
  [INFRA_POLICE_ID]: 'police', [INFRA_FIRE_ID]: 'fire', [INFRA_HOSPITAL_ID]: 'hospital',
  [INFRA_SCHOOL_ID]: 'school', [INFRA_SCHOOL_HIGH_ID]: 'school_high', [INFRA_SCHOOL_UNIV_ID]: 'school_univ',
  [INFRA_PARK_ID]: 'park', [INFRA_GARBAGE_ID]: 'garbage', [INFRA_SEWAGE_ID]: 'sewage', [INFRA_CEMETERY_ID]: 'cemetery',
  [TRANS_BUS_STOP_ID]: 'bus_stop', [TRANS_METRO_STATION_ID]: 'metro_station',
  [TRANS_TRAIN_STATION_ID]: 'train_station',
  [TRANS_FERRY_DOCK_ID]: 'ferry_dock', [TRANS_AIRPORT_ID]: 'airport', [TRANS_TAXI_STAND_ID]: 'taxi_stand',
};

interface BuildingData { x: number; y: number; level: number; burned?: boolean }

export class BuildingRenderer {
  private meshes: (THREE.InstancedMesh | THREE.Mesh)[] = [];
  private infraGroups: THREE.Group[] = [];
  private readonly maxPerVariant = 3000;

  // Light spot system (fake ground glow near buildings at night)
  private lightSpotMesh: THREE.InstancedMesh | null = null;
  private lightSpotMaterial: THREE.MeshBasicMaterial | null = null;

  build(scene: THREE.Scene, grid: Grid): void {
    this.dispose(scene);

    const buildingsByZone = new Map<number, BuildingData[]>();
    const emptyZonesByType = new Map<number, { x: number; y: number }[]>();
    const infraCells: { x: number; y: number; type: InfraType; reserved: number }[] = [];

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.getCell(x, y);
        if (!cell) continue;

        // Skip secondary cells of multi-cell buildings (reserved=4)
        if (cell.reserved === 4) continue;

        const infraType = INFRA_ID_MAP[cell.buildingId];
        if (infraType) {
          infraCells.push({ x, y, type: infraType, reserved: cell.reserved });
          continue;
        }

        if (cell.zoneType !== ZoneType.NONE) {
          if (cell.buildingId > 0 && cell.buildingId < INFRA_WATER_ID) {
            if (!buildingsByZone.has(cell.zoneType)) buildingsByZone.set(cell.zoneType, []);
            buildingsByZone.get(cell.zoneType)!.push({
              x, y,
              level: Math.max(1, Math.min(3, Math.ceil(cell.serviceCoverage / 3) || 1)),
              burned: cell.reserved === 3, // BuildingStatus.BURNED
            });
          } else if (cell.buildingId === 0) {
            if (!emptyZonesByType.has(cell.zoneType)) emptyZonesByType.set(cell.zoneType, []);
            emptyZonesByType.get(cell.zoneType)!.push({ x, y });
          }
        }
      }
    }

    this.buildInfrastructure(scene, infraCells);
    this.buildZoneOverlays(scene, emptyZonesByType);
    this.buildVariantBuildings(scene, buildingsByZone);

    // Build light spots for all buildings EXCEPT burned ones (no lights in charred ruins)
    const allBuildingPositions: { x: number; y: number }[] = [];
    for (const buildings of buildingsByZone.values()) {
      for (const b of buildings) {
        if (!b.burned) allBuildingPositions.push({ x: b.x, y: b.y });
      }
    }
    for (const inf of infraCells) {
      allBuildingPositions.push({ x: inf.x, y: inf.y });
    }
    this.buildLightSpots(scene, allBuildingPositions);
  }

  private buildVariantBuildings(scene: THREE.Scene, buildingsByZone: Map<number, BuildingData[]>): void {
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const color = new THREE.Color();
    const material = getBuildingMaterial();

    for (const [zoneType, buildings] of buildingsByZone) {
      const variants = VARIANTS[zoneType];
      if (!variants || variants.length === 0) continue;

      const palette = ZONE_PALETTES[zoneType] ?? [0x888888];
      const heightRange = ZONE_HEIGHTS[zoneType] ?? { min: 0.3, max: 1.0 };
      const zoneCat = ZONE_CAT[zoneType] ?? 0;

      const buckets: BuildingData[][] = variants.map(() => []);
      for (const b of buildings) {
        const vi = Math.floor(hash(b.x, b.y) * variants.length) % variants.length;
        buckets[vi]!.push(b);
      }

      for (let vi = 0; vi < variants.length; vi++) {
        const bucket = buckets[vi]!;
        if (bucket.length === 0) continue;

        const geometry = variants[vi]!();
        // Stamp zone category into vertex color G channel
        stampZoneCategory(geometry, zoneCat);

        const count = Math.min(bucket.length, this.maxPerVariant);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;

        for (let i = 0; i < count; i++) {
          const b = bucket[i]!;
          const h = hash(b.x, b.y);
          const h2 = hash(b.x + 100, b.y + 100);
          const h3 = hash(b.x + 200, b.y + 200);

          const levelFactor = b.level / 3;
          const baseHeight = heightRange.min + (heightRange.max - heightRange.min) * levelFactor;
          const heightVar = 1.0 + (h2 - 0.5) * 0.35;
          const finalHeight = baseHeight * heightVar;

          const widthVar = 0.85 + h3 * 0.3;
          const depthVar = 0.85 + hash(b.x + 300, b.y + 300) * 0.3;

          const rotIndex = Math.floor(hash(b.x + 400, b.y + 400) * 4);
          rotation.makeRotationY((rotIndex * Math.PI) / 2);

          scale.makeScale(widthVar, finalHeight, depthVar);
          matrix.multiplyMatrices(scale, rotation);
          matrix.setPosition(b.x, 0.05, b.y);
          mesh.setMatrixAt(i, matrix);

          if (b.burned) {
            // Charred/burned building: dark gray-black with slight variation
            const burnLightness = 0.08 + h * 0.07; // 0.08 ~ 0.15 (very dark)
            color.setHSL(0.05, 0.1, burnLightness);
          } else {
            const baseColor = palette[Math.floor(h * palette.length) % palette.length]!;
            color.set(baseColor);
            const hsl = { h: 0, s: 0, l: 0 };
            color.getHSL(hsl);
            hsl.h += (h2 - 0.5) * 0.03;
            hsl.s = Math.max(0.05, Math.min(0.6, hsl.s + (h3 - 0.5) * 0.1));
            hsl.l = Math.max(0.3, Math.min(0.85, hsl.l + (h - 0.5) * 0.1));
            color.setHSL(hsl.h, hsl.s, hsl.l);
          }
          mesh.setColorAt(i, color);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        scene.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  private buildZoneOverlays(scene: THREE.Scene, emptyZonesByType: Map<number, { x: number; y: number }[]>): void {
    const matrix = new THREE.Matrix4();
    for (const [zoneType, cells] of emptyZonesByType) {
      const palette = ZONE_PALETTES[zoneType];
      const baseColor = palette ? palette[0]! : 0x888888;
      const count = Math.min(cells.length, this.maxPerVariant);
      const geometry = new THREE.PlaneGeometry(0.9, 0.9);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        color: baseColor, transparent: true, opacity: 0.35, depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) {
        const c = cells[i]!;
        matrix.setPosition(c.x, 0.02, c.y);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private buildInfrastructure(scene: THREE.Scene, cells: { x: number; y: number; type: InfraType; reserved: number }[]): void {
    for (const inf of cells) {
      // Calculate center position for multi-cell buildings
      const cfg = getInfraConfig(inf.type as InfraConfigType);
      const w = cfg ? cfg.width : 1;
      const h = cfg ? cfg.height : 1;
      const centerX = inf.x + (w - 1) / 2;
      const centerZ = inf.y + (h - 1) / 2;
      const scale = Math.max(w, h); // scale factor for larger buildings

      // Read rotation from primary cell's reserved value
      const rotationDeg = RESERVED_TO_ROTATION[inf.reserved] ?? 0;

      // Create a group at building center, rotate the group, build meshes at local offsets
      const group = new THREE.Group();
      group.position.set(centerX, 0, centerZ);
      if (rotationDeg !== 0) {
        group.rotation.y = (rotationDeg * Math.PI) / 180;
      }

      switch (inf.type) {
        case 'power':     this.buildPowerPlant(group, 0, 0, scale); break;
        case 'water':     this.buildWaterPump(group, 0, 0, scale); break;
        case 'police':    this.buildPoliceStation(group, 0, 0, scale); break;
        case 'fire':      this.buildFireStation(group, 0, 0, scale); break;
        case 'hospital':  this.buildHospital(group, 0, 0, scale); break;
        case 'school':    this.buildElementarySchool(group, 0, 0, scale); break;
        case 'school_high': this.buildHighSchool(group, 0, 0, scale); break;
        case 'school_univ': this.buildUniversity(group, 0, 0, scale); break;
        case 'park':      this.buildPark(group, 0, 0, scale); break;
        case 'cemetery':  this.buildCemetery(group, 0, 0, scale); break;
        case 'garbage':   this.buildLandfill(group, 0, 0, scale); break;
        case 'sewage':    this.buildSewagePlant(group, 0, 0, scale); break;
        case 'bus_stop':  this.buildBusStop(group, 0, 0, scale); break;
        case 'metro_station': this.buildMetroStation(group, 0, 0, scale); break;
        case 'train_station': this.buildTrainStation(group, 0, 0, scale); break;
        case 'ferry_dock':   this.buildFerryDock(group, 0, 0, scale); break;
        case 'airport':      this.buildAirport(group, 0, 0, scale); break;
        case 'taxi_stand':   this.buildTaxiStand(group, 0, 0, scale); break;
        default:          this.buildCivicBuilding(group, 0, 0, inf.type, scale); break;
      }

      scene.add(group);
      this.infraGroups.push(group);
    }
  }

  private buildCivicBuilding(scene: THREE.Scene | THREE.Group, cx: number, cz: number, type: InfraType, scale = 1): void {
    const configs: Record<string, { color: number; height: number; roofColor: number; accent?: number }> = {
      police:      { color: 0x3f51b5, height: 0.40, roofColor: 0x303f9f },
      fire:        { color: 0xd32f2f, height: 0.38, roofColor: 0xb71c1c },
      hospital:    { color: 0xe8e8e8, height: 0.50, roofColor: 0xbbbbbb, accent: 0xe91e63 },
      school:      { color: 0x795548, height: 0.30, roofColor: 0x5d4037 },
      school_high: { color: 0x6d4c41, height: 0.40, roofColor: 0x4e342e },
      school_univ: { color: 0x4e342e, height: 0.55, roofColor: 0x3e2723, accent: 0xffd600 },
      park:        { color: 0x4caf50, height: 0.10, roofColor: 0x388e3c },
      garbage:     { color: 0x795548, height: 0.25, roofColor: 0x5d4037 },
      sewage:      { color: 0x607d8b, height: 0.20, roofColor: 0x455a64 },
      cemetery:    { color: 0x9e9e9e, height: 0.15, roofColor: 0x757575 },
      // Transport stops
      bus_stop:       { color: 0xff9800, height: 0.25, roofColor: 0xf57c00 },
      metro_station:  { color: 0x2196f3, height: 0.30, roofColor: 0x1565c0 },
      train_station:  { color: 0x795548, height: 0.45, roofColor: 0x5d4037, accent: 0xff5722 },
      ferry_dock:     { color: 0x00bcd4, height: 0.18, roofColor: 0x00838f },
      airport:        { color: 0xeceff1, height: 0.55, roofColor: 0x90a4ae, accent: 0x2196f3 },
      taxi_stand:     { color: 0xffeb3b, height: 0.20, roofColor: 0xfbc02d },
    };
    const cfg = configs[type] ?? { color: 0x888888, height: 0.35, roofColor: 0x666666 };
    const s = scale; // scale factor for multi-cell buildings
    const bodyW = 0.50 * s;
    const bodyD = 0.50 * s;
    const h = cfg.height * Math.min(s, 2); // height scales but caps at 2x

    // Main building body
    const bodyGeo = new THREE.BoxGeometry(bodyW, h, bodyD);
    bodyGeo.translate(0, h / 2, 0);
    const bodyMat = new THREE.MeshLambertMaterial({ color: cfg.color });
    this.addInfraMesh(scene, bodyGeo, bodyMat, cx, 0.05, cz);

    // Roof
    if (type !== 'park') {
      const roofGeo = new THREE.BoxGeometry(bodyW + 0.05 * s, 0.04, bodyD + 0.05 * s);
      roofGeo.translate(0, 0.02, 0);
      const roofMat = new THREE.MeshLambertMaterial({ color: cfg.roofColor });
      this.addInfraMesh(scene, roofGeo, roofMat, cx, h + 0.05, cz);
    }

    // Accent detail (cross for hospital, dome for university, etc.)
    if (cfg.accent && type === 'hospital') {
      const crossH = new THREE.BoxGeometry(0.20 * s, 0.03, 0.06 * s);
      crossH.translate(0, 0.015, 0);
      const crossV = new THREE.BoxGeometry(0.06 * s, 0.03, 0.20 * s);
      crossV.translate(0, 0.015, 0);
      const crossMat = new THREE.MeshLambertMaterial({ color: cfg.accent });
      this.addInfraMesh(scene, crossH, crossMat, cx, h + 0.09, cz);
      this.addInfraMesh(scene, crossV, crossMat, cx, h + 0.09, cz);
    }
    if (cfg.accent && type === 'school_univ') {
      const domeGeo = new THREE.SphereGeometry(0.12 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const domeMat = new THREE.MeshLambertMaterial({ color: cfg.accent });
      this.addInfraMesh(scene, domeGeo, domeMat, cx, h + 0.09, cz);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP A — Emergency Services (Police / Fire / Hospital)
  // ═══════════════════════════════════════════════════════════════════

  private buildPoliceStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // L-shaped main building — long wing
    const longWingGeo = new THREE.BoxGeometry(0.70, 0.35, 0.35);
    longWingGeo.translate(-0.05, 0.35 / 2, 0.10);
    const longWingMat = new THREE.MeshLambertMaterial({ color: 0x3f51b5 });
    this.addInfraMesh(scene, longWingGeo, longWingMat, cx, 0.05, cz);

    // L-shaped main building — short wing
    const shortWingGeo = new THREE.BoxGeometry(0.35, 0.35, 0.40);
    shortWingGeo.translate(0.25, 0.35 / 2, -0.10);
    const shortWingMat = new THREE.MeshLambertMaterial({ color: 0x3949a3 });
    this.addInfraMesh(scene, shortWingGeo, shortWingMat, cx, 0.05, cz);

    // Roof for long wing
    const longRoofGeo = new THREE.BoxGeometry(0.75, 0.03, 0.40);
    longRoofGeo.translate(-0.05, 0.015, 0.10);
    const longRoofMat = new THREE.MeshLambertMaterial({ color: 0x303f9f });
    this.addInfraMesh(scene, longRoofGeo, longRoofMat, cx, 0.05 + 0.35, cz);

    // Roof for short wing
    const shortRoofGeo = new THREE.BoxGeometry(0.40, 0.03, 0.45);
    shortRoofGeo.translate(0.25, 0.015, -0.10);
    const shortRoofMat = new THREE.MeshLambertMaterial({ color: 0x303f9f });
    this.addInfraMesh(scene, shortRoofGeo, shortRoofMat, cx, 0.05 + 0.35, cz);

    // Watch tower at corner where wings meet
    const towerGeo = new THREE.BoxGeometry(0.12, 0.25, 0.12);
    towerGeo.translate(0.10, 0.35 + 0.25 / 2, -0.05);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x5c6bc0 });
    this.addInfraMesh(scene, towerGeo, towerMat, cx, 0.05, cz);

    // Tower cap
    const towerCapGeo = new THREE.BoxGeometry(0.15, 0.02, 0.15);
    towerCapGeo.translate(0.10, 0.35 + 0.25 + 0.01, -0.05);
    const towerCapMat = new THREE.MeshLambertMaterial({ color: 0x283593 });
    this.addInfraMesh(scene, towerCapGeo, towerCapMat, cx, 0.05, cz);

    // 2 garage doors on front of long wing
    const garageMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const garage1Geo = new THREE.BoxGeometry(0.16, 0.18, 0.01);
    garage1Geo.translate(-0.18, 0.18 / 2, 0.10 + 0.35 / 2 + 0.005);
    this.addInfraMesh(scene, garage1Geo, garageMat, cx, 0.05, cz);

    const garage2Geo = new THREE.BoxGeometry(0.16, 0.18, 0.01);
    garage2Geo.translate(0.06, 0.18 / 2, 0.10 + 0.35 / 2 + 0.005);
    this.addInfraMesh(scene, garage2Geo, garageMat, cx, 0.05, cz);

    // Blue police light on tower top
    const lightGeo = new THREE.SphereGeometry(0.025, 6, 6);
    lightGeo.translate(0.10, 0.35 + 0.25 + 0.02 + 0.025, -0.05);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x42a5f5 });
    this.addInfraMesh(scene, lightGeo, lightMat, cx, 0.05, cz, false);

    // White stripe band on long wing
    const stripeGeo = new THREE.BoxGeometry(0.70, 0.03, 0.36);
    stripeGeo.translate(-0.05, 0.35 / 2, 0.10);
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xe8eaf6 });
    this.addInfraMesh(scene, stripeGeo, stripeMat, cx, 0.05, cz);

    // Flagpole
    const flagpoleGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.30, 4);
    flagpoleGeo.translate(-0.30, 0.30 / 2, 0.35);
    const flagpoleMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    this.addInfraMesh(scene, flagpoleGeo, flagpoleMat, cx, 0.05, cz);
  }

  private buildFireStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Main garage building
    const mainGeo = new THREE.BoxGeometry(0.75, 0.35, 0.55);
    mainGeo.translate(0, 0.35 / 2, 0.05);
    const mainMat = new THREE.MeshLambertMaterial({ color: 0xd32f2f });
    this.addInfraMesh(scene, mainGeo, mainMat, cx, 0.05, cz);

    // Roof
    const roofGeo = new THREE.BoxGeometry(0.80, 0.03, 0.60);
    roofGeo.translate(0, 0.015, 0.05);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xb71c1c });
    this.addInfraMesh(scene, roofGeo, roofMat, cx, 0.05 + 0.35, cz);

    // 3 garage doors evenly spaced on front face
    const garageMat = new THREE.MeshLambertMaterial({ color: 0xef9a9a });
    for (let i = -1; i <= 1; i++) {
      const doorGeo = new THREE.BoxGeometry(0.18, 0.28, 0.01);
      doorGeo.translate(i * 0.22, 0.28 / 2, 0.05 + 0.55 / 2 + 0.005);
      this.addInfraMesh(scene, doorGeo, garageMat, cx, 0.05, cz);
    }

    // Drill tower (back)
    const towerGeo = new THREE.BoxGeometry(0.15, 0.55, 0.15);
    towerGeo.translate(0.25, 0.55 / 2, -0.25);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0xc62828 });
    this.addInfraMesh(scene, towerGeo, towerMat, cx, 0.05, cz);

    // Tower cap
    const towerCapGeo = new THREE.BoxGeometry(0.18, 0.02, 0.18);
    towerCapGeo.translate(0.25, 0.55 + 0.01, -0.25);
    const towerCapMat = new THREE.MeshLambertMaterial({ color: 0xb71c1c });
    this.addInfraMesh(scene, towerCapGeo, towerCapMat, cx, 0.05, cz);

    // 2 tower windows
    const windowMat = new THREE.MeshLambertMaterial({ color: 0xffcdd2 });
    const win1Geo = new THREE.BoxGeometry(0.06, 0.06, 0.01);
    win1Geo.translate(0.25, 0.40, -0.25 + 0.15 / 2 + 0.005);
    this.addInfraMesh(scene, win1Geo, windowMat, cx, 0.05, cz);

    const win2Geo = new THREE.BoxGeometry(0.06, 0.06, 0.01);
    win2Geo.translate(0.25, 0.28, -0.25 + 0.15 / 2 + 0.005);
    this.addInfraMesh(scene, win2Geo, windowMat, cx, 0.05, cz);

    // Red warning light on roof
    const lightGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8);
    lightGeo.translate(0, 0.35 + 0.03 + 0.01, 0.05);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff1744 });
    this.addInfraMesh(scene, lightGeo, lightMat, cx, 0.05, cz, false);

    // Hose reel on side (rotated to lie flat)
    const hoseGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8);
    hoseGeo.rotateZ(Math.PI / 2);
    hoseGeo.translate(-0.75 / 2 - 0.005, 0.15, 0.10);
    const hoseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, hoseGeo, hoseMat, cx, 0.05, cz);
  }

  private buildHospital(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Main wing
    const mainGeo = new THREE.BoxGeometry(0.85, 0.55, 0.55);
    mainGeo.translate(0, 0.55 / 2, 0.05);
    const mainMat = new THREE.MeshLambertMaterial({ color: 0xeceff1 });
    this.addInfraMesh(scene, mainGeo, mainMat, cx, 0.05, cz);

    // Side wing
    const sideGeo = new THREE.BoxGeometry(0.35, 0.40, 0.40);
    sideGeo.translate(-0.35, 0.40 / 2, -0.30);
    const sideMat = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
    this.addInfraMesh(scene, sideGeo, sideMat, cx, 0.05, cz);

    // Main roof
    const mainRoofGeo = new THREE.BoxGeometry(0.90, 0.03, 0.60);
    mainRoofGeo.translate(0, 0.015, 0.05);
    const mainRoofMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
    this.addInfraMesh(scene, mainRoofGeo, mainRoofMat, cx, 0.05 + 0.55, cz);

    // Side roof
    const sideRoofGeo = new THREE.BoxGeometry(0.40, 0.03, 0.45);
    sideRoofGeo.translate(-0.35, 0.015, -0.30);
    const sideRoofMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    this.addInfraMesh(scene, sideRoofGeo, sideRoofMat, cx, 0.05 + 0.40, cz);

    // Helipad circle on main roof
    const helipadGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.01, 16);
    helipadGeo.translate(0.15, 0.55 + 0.03 + 0.005, 0.05);
    const helipadMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, helipadGeo, helipadMat, cx, 0.05, cz);

    // H marking — horizontal bar
    const hMarkHGeo = new THREE.BoxGeometry(0.08, 0.015, 0.02);
    hMarkHGeo.translate(0.15, 0.55 + 0.03 + 0.015, 0.05);
    const hMarkMat = new THREE.MeshLambertMaterial({ color: 0xe91e63 });
    this.addInfraMesh(scene, hMarkHGeo, hMarkMat, cx, 0.05, cz);

    // H marking — vertical bar left
    const hMarkV1Geo = new THREE.BoxGeometry(0.02, 0.015, 0.08);
    hMarkV1Geo.translate(0.15 - 0.03, 0.55 + 0.03 + 0.015, 0.05);
    this.addInfraMesh(scene, hMarkV1Geo, hMarkMat, cx, 0.05, cz);

    // H marking — vertical bar right
    const hMarkV2Geo = new THREE.BoxGeometry(0.02, 0.015, 0.08);
    hMarkV2Geo.translate(0.15 + 0.03, 0.55 + 0.03 + 0.015, 0.05);
    this.addInfraMesh(scene, hMarkV2Geo, hMarkMat, cx, 0.05, cz);

    // Red cross on front wall — horizontal
    const crossHGeo = new THREE.BoxGeometry(0.15, 0.02, 0.04);
    crossHGeo.translate(0, 0.40, 0.05 + 0.55 / 2 + 0.005);
    const crossMat = new THREE.MeshLambertMaterial({ color: 0xe91e63 });
    this.addInfraMesh(scene, crossHGeo, crossMat, cx, 0.05, cz);

    // Red cross on front wall — vertical
    const crossVGeo = new THREE.BoxGeometry(0.04, 0.02, 0.15);
    crossVGeo.translate(0, 0.40, 0.05 + 0.55 / 2 + 0.005);
    this.addInfraMesh(scene, crossVGeo, crossMat, cx, 0.05, cz);

    // ER canopy protruding from front
    const canopyGeo = new THREE.BoxGeometry(0.30, 0.02, 0.15);
    canopyGeo.translate(0, 0.20 + 0.01, 0.05 + 0.55 / 2 + 0.15 / 2);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0xcfd8dc });
    this.addInfraMesh(scene, canopyGeo, canopyMat, cx, 0.05, cz);

    // Canopy pillar left
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    const pillar1Geo = new THREE.CylinderGeometry(0.012, 0.012, 0.20, 6);
    pillar1Geo.translate(-0.12, 0.20 / 2, 0.05 + 0.55 / 2 + 0.15);
    this.addInfraMesh(scene, pillar1Geo, pillarMat, cx, 0.05, cz);

    // Canopy pillar right
    const pillar2Geo = new THREE.CylinderGeometry(0.012, 0.012, 0.20, 6);
    pillar2Geo.translate(0.12, 0.20 / 2, 0.05 + 0.55 / 2 + 0.15);
    this.addInfraMesh(scene, pillar2Geo, pillarMat, cx, 0.05, cz);

    // Ambulance under canopy
    const ambulanceGeo = new THREE.BoxGeometry(0.10, 0.08, 0.06);
    ambulanceGeo.translate(0, 0.08 / 2, 0.05 + 0.55 / 2 + 0.08);
    const ambulanceMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, ambulanceGeo, ambulanceMat, cx, 0.05, cz);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP B — Education (Elementary / High School / University)
  // ═══════════════════════════════════════════════════════════════════

  private buildElementarySchool(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Classroom building (1 story, brown)
    const bodyGeo = new THREE.BoxGeometry(0.65, 0.25, 0.35);
    bodyGeo.translate(0, 0.25 / 2, 0);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x795548 });
    this.addInfraMesh(scene, bodyGeo, bodyMat, cx, 0.05, cz);

    // Colorful tilted roof (orange-red)
    const roofGeo = new THREE.BoxGeometry(0.70, 0.03, 0.42);
    roofGeo.rotateX(0.05);
    roofGeo.translate(0, 0.015, 0);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xff7043 });
    this.addInfraMesh(scene, roofGeo, roofMat, cx, 0.05 + 0.25, cz);

    // Entrance porch (protruding from front)
    const porchGeo = new THREE.BoxGeometry(0.12, 0.20, 0.08);
    porchGeo.translate(0, 0.20 / 2, -0.35 / 2 - 0.08 / 2);
    const porchMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    this.addInfraMesh(scene, porchGeo, porchMat, cx, 0.05, cz);

    // Porch roof
    const porchRoofGeo = new THREE.BoxGeometry(0.16, 0.02, 0.12);
    porchRoofGeo.translate(0, 0.01, -0.35 / 2 - 0.08 / 2);
    const porchRoofMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, porchRoofGeo, porchRoofMat, cx, 0.05 + 0.20, cz);

    // Playground ground (offset to the right side)
    const playGeo = new THREE.BoxGeometry(0.35, 0.01, 0.40);
    playGeo.translate(0.50, 0.005, 0);
    const playMat = new THREE.MeshLambertMaterial({ color: 0xa5d6a7 });
    this.addInfraMesh(scene, playGeo, playMat, cx, 0.05, cz);

    // Swing frame
    const swingGeo = new THREE.BoxGeometry(0.08, 0.12, 0.02);
    swingGeo.translate(0.45, 0.12 / 2, -0.08);
    const swingMat = new THREE.MeshLambertMaterial({ color: 0xff8a65 });
    this.addInfraMesh(scene, swingGeo, swingMat, cx, 0.05, cz);

    // Slide (yellow, tilted)
    const slideGeo = new THREE.BoxGeometry(0.04, 0.10, 0.02);
    slideGeo.rotateX(-0.4);
    slideGeo.translate(0.55, 0.10 / 2, 0.05);
    const slideMat = new THREE.MeshLambertMaterial({ color: 0xffd54f });
    this.addInfraMesh(scene, slideGeo, slideMat, cx, 0.05, cz);

    // Tree trunk
    const trunkGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.10, 5);
    trunkGeo.translate(-0.40, 0.10 / 2, -0.12);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6d4c41 });
    this.addInfraMesh(scene, trunkGeo, trunkMat, cx, 0.05, cz);

    // Tree canopy
    const canopyGeo = new THREE.SphereGeometry(0.06, 6, 5);
    canopyGeo.translate(-0.40, 0.10 + 0.04, -0.12);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x66bb6a });
    this.addInfraMesh(scene, canopyGeo, canopyMat, cx, 0.05, cz);

    // Flagpole
    const flagGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4);
    flagGeo.translate(-0.30, 0.25 / 2, -0.22);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    this.addInfraMesh(scene, flagGeo, flagMat, cx, 0.05, cz);
  }

  private buildHighSchool(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Main teaching block (2 stories)
    const mainGeo = new THREE.BoxGeometry(0.80, 0.40, 0.40);
    mainGeo.translate(0, 0.40 / 2, 0);
    const mainMat = new THREE.MeshLambertMaterial({ color: 0x6d4c41 });
    this.addInfraMesh(scene, mainGeo, mainMat, cx, 0.05, cz);

    // Main roof
    const roofGeo = new THREE.BoxGeometry(0.85, 0.03, 0.45);
    roofGeo.translate(0, 0.015, 0);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, roofGeo, roofMat, cx, 0.05 + 0.40, cz);

    // Clock tower (center, sitting on roof)
    const towerGeo = new THREE.BoxGeometry(0.10, 0.22, 0.10);
    towerGeo.translate(0, 0.22 / 2, 0);
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, towerGeo, towerMat, cx, 0.05 + 0.40 + 0.03, cz);

    // Tower spire
    const spireGeo = new THREE.ConeGeometry(0.08, 0.08, 4);
    spireGeo.translate(0, 0.08 / 2, 0);
    const spireMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, spireGeo, spireMat, cx, 0.05 + 0.40 + 0.03 + 0.22, cz);

    // Clock face (on tower front)
    const clockGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8);
    clockGeo.rotateX(Math.PI / 2);
    clockGeo.translate(0, 0.14, -0.051);
    const clockMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, clockGeo, clockMat, cx, 0.05 + 0.40 + 0.03, cz, false);

    // 3 entrance columns (spaced on front)
    const colMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    for (let i = -1; i <= 1; i++) {
      const colGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6);
      colGeo.translate(i * 0.09, 0.22 / 2, -0.40 / 2 - 0.02);
      this.addInfraMesh(scene, colGeo, colMat, cx, 0.05, cz);
    }

    // Entrance canopy
    const canopyGeo = new THREE.BoxGeometry(0.25, 0.02, 0.10);
    canopyGeo.translate(0, 0.01, -0.40 / 2 - 0.02);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, canopyGeo, canopyMat, cx, 0.05 + 0.22, cz);

    // Track ground (to the side)
    const trackGeo = new THREE.BoxGeometry(0.35, 0.01, 0.50);
    trackGeo.translate(0.60, 0.005, 0);
    const trackMat = new THREE.MeshLambertMaterial({ color: 0xc8b896 });
    this.addInfraMesh(scene, trackGeo, trackMat, cx, 0.05, cz);

    // Track white line
    const lineGeo = new THREE.BoxGeometry(0.30, 0.012, 0.01);
    lineGeo.translate(0.60, 0.012, -0.20);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.addInfraMesh(scene, lineGeo, lineMat, cx, 0.05, cz, false);

    // Flagpole
    const flagGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.30, 4);
    flagGeo.translate(-0.38, 0.30 / 2, -0.25);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    this.addInfraMesh(scene, flagGeo, flagMat, cx, 0.05, cz);
  }

  private buildUniversity(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Central main hall
    const hallGeo = new THREE.BoxGeometry(0.50, 0.55, 0.50);
    hallGeo.translate(0, 0.55 / 2, 0);
    const hallMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, hallGeo, hallMat, cx, 0.05, cz);

    // Left wing
    const lwGeo = new THREE.BoxGeometry(0.40, 0.40, 0.35);
    lwGeo.translate(-0.45, 0.40 / 2, 0);
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
    this.addInfraMesh(scene, lwGeo, wingMat, cx, 0.05, cz);

    // Right wing
    const rwGeo = new THREE.BoxGeometry(0.40, 0.40, 0.35);
    rwGeo.translate(0.45, 0.40 / 2, 0);
    this.addInfraMesh(scene, rwGeo, wingMat, cx, 0.05, cz);

    // Main roof
    const mainRoofGeo = new THREE.BoxGeometry(0.55, 0.03, 0.55);
    mainRoofGeo.translate(0, 0.015, 0);
    const darkRoofMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 });
    this.addInfraMesh(scene, mainRoofGeo, darkRoofMat, cx, 0.05 + 0.55, cz);

    // Gold dome (half sphere)
    const domeGeo = new THREE.SphereGeometry(0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshLambertMaterial({ color: 0xffd600 });
    this.addInfraMesh(scene, domeGeo, domeMat, cx, 0.05 + 0.55 + 0.03, cz);

    // Dome base ring
    const ringGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 10);
    ringGeo.translate(0, 0.02, 0);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xf9a825 });
    this.addInfraMesh(scene, ringGeo, ringMat, cx, 0.05 + 0.55, cz);

    // 4 front columns
    const colMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
    for (let i = 0; i < 4; i++) {
      const colGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.30, 6);
      colGeo.translate(-0.18 + i * 0.12, 0.30 / 2, -0.50 / 2 - 0.04);
      this.addInfraMesh(scene, colGeo, colMat, cx, 0.05, cz);
    }

    // Colonnade top
    const colTopGeo = new THREE.BoxGeometry(0.45, 0.03, 0.12);
    colTopGeo.translate(0, 0.015, -0.50 / 2 - 0.04);
    const colTopMat = new THREE.MeshLambertMaterial({ color: 0x4e342e });
    this.addInfraMesh(scene, colTopGeo, colTopMat, cx, 0.05 + 0.30, cz);

    // Pediment (flat triangle facing front)
    const pedGeo = new THREE.ConeGeometry(0.25, 0.08, 3);
    pedGeo.rotateX(Math.PI / 2);
    pedGeo.rotateY(Math.PI / 2);
    pedGeo.translate(0, 0.04, -0.50 / 2 - 0.04);
    const pedMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 });
    this.addInfraMesh(scene, pedGeo, pedMat, cx, 0.05 + 0.30 + 0.03, cz);

    // Courtyard ground (in front)
    const courtGeo = new THREE.BoxGeometry(0.30, 0.01, 0.30);
    courtGeo.translate(0, 0.005, -0.50 / 2 - 0.20);
    const courtMat = new THREE.MeshLambertMaterial({ color: 0xa5d6a7 });
    this.addInfraMesh(scene, courtGeo, courtMat, cx, 0.05, cz);

    // Fountain pool
    const fountGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10);
    fountGeo.translate(0, 0.03 / 2, -0.50 / 2 - 0.20);
    const fountMat = new THREE.MeshLambertMaterial({ color: 0x90caf9 });
    this.addInfraMesh(scene, fountGeo, fountMat, cx, 0.05, cz);

    // Left wing roof
    const lwRoofGeo = new THREE.BoxGeometry(0.45, 0.03, 0.40);
    lwRoofGeo.translate(-0.45, 0.015, 0);
    this.addInfraMesh(scene, lwRoofGeo, darkRoofMat, cx, 0.05 + 0.40, cz);

    // Right wing roof
    const rwRoofGeo = new THREE.BoxGeometry(0.45, 0.03, 0.40);
    rwRoofGeo.translate(0.45, 0.015, 0);
    this.addInfraMesh(scene, rwRoofGeo, darkRoofMat, cx, 0.05 + 0.40, cz);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP C — Environment (Park / Cemetery / Landfill)
  // ═══════════════════════════════════════════════════════════════════

  private buildPark(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Grass base
    const baseGeo = new THREE.BoxGeometry(0.50, 0.02, 0.50);
    baseGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, baseGeo, new THREE.MeshLambertMaterial({ color: 0x4caf50 }), cx, 0.05, cz, false);

    // Big tree trunk (offset to back-left)
    const bigTrunkGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 5);
    bigTrunkGeo.translate(-0.12, 0.075, -0.10);
    this.addInfraMesh(scene, bigTrunkGeo, new THREE.MeshLambertMaterial({ color: 0x6d4c41 }), cx, 0.06, cz);

    // Big tree canopy
    const bigCanopyGeo = new THREE.SphereGeometry(0.10, 6, 5);
    bigCanopyGeo.translate(-0.12, 0.18, -0.10);
    this.addInfraMesh(scene, bigCanopyGeo, new THREE.MeshLambertMaterial({ color: 0x388e3c }), cx, 0.06, cz);

    // Small tree trunk (offset to front-right)
    const smallTrunkGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.10, 5);
    smallTrunkGeo.translate(0.15, 0.05, 0.12);
    this.addInfraMesh(scene, smallTrunkGeo, new THREE.MeshLambertMaterial({ color: 0x795548 }), cx, 0.06, cz);

    // Small tree canopy
    const smallCanopyGeo = new THREE.SphereGeometry(0.06, 6, 4);
    smallCanopyGeo.translate(0.15, 0.13, 0.12);
    this.addInfraMesh(scene, smallCanopyGeo, new THREE.MeshLambertMaterial({ color: 0x66bb6a }), cx, 0.06, cz);

    // Fountain pool (center)
    const poolGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.025, 10);
    poolGeo.translate(0.02, 0.0125, 0.0);
    this.addInfraMesh(scene, poolGeo, new THREE.MeshLambertMaterial({ color: 0x78909c }), cx, 0.06, cz);

    // Fountain water surface
    const waterGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.01, 10);
    waterGeo.translate(0.02, 0.025, 0.0);
    this.addInfraMesh(scene, waterGeo, new THREE.MeshLambertMaterial({ color: 0x4fc3f7 }), cx, 0.06, cz, false);

    // Water jet (glowing)
    const jetGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.06, 4);
    jetGeo.translate(0.02, 0.055, 0.0);
    this.addInfraMesh(scene, jetGeo, new THREE.MeshBasicMaterial({ color: 0xb3e5fc }), cx, 0.06, cz, false);

    // Bench (front-right area)
    const benchGeo = new THREE.BoxGeometry(0.08, 0.025, 0.03);
    benchGeo.translate(-0.05, 0.0125, 0.16);
    this.addInfraMesh(scene, benchGeo, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, 0.06, cz);

    // Walking path (diagonal across park)
    const pathGeo = new THREE.BoxGeometry(0.06, 0.012, 0.30);
    pathGeo.rotateY(Math.PI / 4);
    pathGeo.translate(0.0, 0.006, 0.0);
    this.addInfraMesh(scene, pathGeo, new THREE.MeshLambertMaterial({ color: 0xd7ccc8 }), cx, 0.06, cz, false);
  }

  private buildCemetery(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Ground (grass)
    const groundGeo = new THREE.BoxGeometry(0.85, 0.02, 0.85);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0x8bc34a }), cx, 0.05, cz, false);

    // Chapel body (back-left corner)
    const chapelGeo = new THREE.BoxGeometry(0.18, 0.20, 0.15);
    chapelGeo.translate(-0.25, 0.10, -0.28);
    this.addInfraMesh(scene, chapelGeo, new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }), cx, 0.06, cz);

    // Chapel spire
    const spireGeo = new THREE.ConeGeometry(0.10, 0.15, 4);
    spireGeo.translate(-0.25, 0.275, -0.28);
    this.addInfraMesh(scene, spireGeo, new THREE.MeshLambertMaterial({ color: 0x757575 }), cx, 0.06, cz);

    // Cross vertical on spire
    const crossVGeo = new THREE.BoxGeometry(0.02, 0.08, 0.01);
    crossVGeo.translate(-0.25, 0.39, -0.28);
    this.addInfraMesh(scene, crossVGeo, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz);

    // Cross horizontal on spire
    const crossHGeo = new THREE.BoxGeometry(0.05, 0.01, 0.01);
    crossHGeo.translate(-0.25, 0.38, -0.28);
    this.addInfraMesh(scene, crossHGeo, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz);

    // Gravestones — Row 1 (4 stones)
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xbdbdbd });
    const row1X = 0.05;
    const row1Zs = [-0.20, -0.08, 0.04, 0.16];
    for (const zOff of row1Zs) {
      const stoneGeo = new THREE.BoxGeometry(0.03, 0.05, 0.015);
      stoneGeo.translate(row1X, 0.025, zOff);
      this.addInfraMesh(scene, stoneGeo, stoneMat, cx, 0.06, cz);
    }

    // Gravestones — Row 2 (4 stones)
    const row2X = 0.20;
    const row2Zs = [-0.16, -0.04, 0.08, 0.20];
    for (const zOff of row2Zs) {
      const stoneGeo = new THREE.BoxGeometry(0.03, 0.05, 0.015);
      stoneGeo.translate(row2X, 0.025, zOff);
      this.addInfraMesh(scene, stoneGeo, stoneMat, cx, 0.06, cz);
    }

    // Cypress tree 1 (near chapel)
    const cypTrunk1 = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 4);
    cypTrunk1.translate(-0.10, 0.02, -0.32);
    this.addInfraMesh(scene, cypTrunk1, new THREE.MeshLambertMaterial({ color: 0x5d4037 }), cx, 0.06, cz);

    const cypTree1 = new THREE.ConeGeometry(0.03, 0.18, 6);
    cypTree1.translate(-0.10, 0.13, -0.32);
    this.addInfraMesh(scene, cypTree1, new THREE.MeshLambertMaterial({ color: 0x2e7d32 }), cx, 0.06, cz);

    // Cypress tree 2 (opposite side)
    const cypTrunk2 = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 4);
    cypTrunk2.translate(0.32, 0.02, -0.32);
    this.addInfraMesh(scene, cypTrunk2, new THREE.MeshLambertMaterial({ color: 0x5d4037 }), cx, 0.06, cz);

    const cypTree2 = new THREE.ConeGeometry(0.03, 0.18, 6);
    cypTree2.translate(0.32, 0.13, -0.32);
    this.addInfraMesh(scene, cypTree2, new THREE.MeshLambertMaterial({ color: 0x2e7d32 }), cx, 0.06, cz);

    // Stone path down center
    const pathGeo = new THREE.BoxGeometry(0.10, 0.012, 0.60);
    pathGeo.translate(0.0, 0.006, 0.05);
    this.addInfraMesh(scene, pathGeo, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz, false);

    // Iron gate at entrance (front)
    const gateGeo = new THREE.BoxGeometry(0.15, 0.10, 0.01);
    gateGeo.translate(0.0, 0.05, 0.38);
    this.addInfraMesh(scene, gateGeo, new THREE.MeshLambertMaterial({ color: 0x616161 }), cx, 0.06, cz);
  }

  private buildLandfill(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // Dirt ground
    const groundGeo = new THREE.BoxGeometry(0.85, 0.02, 0.85);
    groundGeo.translate(0, 0.01, 0);
    this.addInfraMesh(scene, groundGeo, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, 0.05, cz, false);

    // Large garbage mound (center-back)
    const largeMound = new THREE.ConeGeometry(0.18, 0.22, 6);
    largeMound.translate(-0.05, 0.11, -0.10);
    this.addInfraMesh(scene, largeMound, new THREE.MeshLambertMaterial({ color: 0x6d4c41 }), cx, 0.06, cz);

    // Medium mound (right)
    const medMound = new THREE.ConeGeometry(0.12, 0.15, 5);
    medMound.translate(0.20, 0.075, 0.05);
    this.addInfraMesh(scene, medMound, new THREE.MeshLambertMaterial({ color: 0x795548 }), cx, 0.06, cz);

    // Small mound (left-front)
    const smallMound = new THREE.ConeGeometry(0.08, 0.10, 5);
    smallMound.translate(-0.22, 0.05, 0.15);
    this.addInfraMesh(scene, smallMound, new THREE.MeshLambertMaterial({ color: 0x8d6e63 }), cx, 0.06, cz);

    // Office shack (back-right corner)
    const shackGeo = new THREE.BoxGeometry(0.15, 0.15, 0.12);
    shackGeo.translate(0.30, 0.075, -0.30);
    this.addInfraMesh(scene, shackGeo, new THREE.MeshLambertMaterial({ color: 0xa1887f }), cx, 0.06, cz);

    // Shack roof
    const shackRoof = new THREE.BoxGeometry(0.18, 0.02, 0.15);
    shackRoof.translate(0.30, 0.16, -0.30);
    this.addInfraMesh(scene, shackRoof, new THREE.MeshLambertMaterial({ color: 0x795548 }), cx, 0.06, cz);

    // Bulldozer body (front-left area)
    const dozerBody = new THREE.BoxGeometry(0.10, 0.07, 0.06);
    dozerBody.translate(-0.25, 0.035, 0.28);
    this.addInfraMesh(scene, dozerBody, new THREE.MeshLambertMaterial({ color: 0xffc107 }), cx, 0.06, cz);

    // Bulldozer blade
    const dozerBlade = new THREE.BoxGeometry(0.08, 0.06, 0.02);
    dozerBlade.translate(-0.25, 0.03, 0.24);
    this.addInfraMesh(scene, dozerBlade, new THREE.MeshLambertMaterial({ color: 0xff8f00 }), cx, 0.06, cz);

    // Fence front
    const fenceFront = new THREE.BoxGeometry(0.85, 0.08, 0.01);
    fenceFront.translate(0, 0.04, 0.42);
    this.addInfraMesh(scene, fenceFront, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz);

    // Fence side (right)
    const fenceSide = new THREE.BoxGeometry(0.01, 0.08, 0.85);
    fenceSide.translate(0.42, 0.04, 0);
    this.addInfraMesh(scene, fenceSide, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }), cx, 0.06, cz);

    // Warning sign
    const signGeo = new THREE.BoxGeometry(0.06, 0.06, 0.01);
    signGeo.translate(0.0, 0.10, 0.42);
    this.addInfraMesh(scene, signGeo, new THREE.MeshLambertMaterial({ color: 0xf0c030 }), cx, 0.06, cz);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP D — Utility Infrastructure (Sewage / Power / Water)
  // ═══════════════════════════════════════════════════════════════════

  private buildSewagePlant(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    const s = scale;

    // Concrete foundation
    const foundGeo = new THREE.BoxGeometry(0.85 * s, 0.04 * s, 0.85 * s);
    foundGeo.translate(0, 0.02, 0);
    const foundMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, foundGeo, foundMat, cx, 0.05, cz);

    // Large settling tank
    const lgTankGeo = new THREE.CylinderGeometry(0.20 * s, 0.20 * s, 0.10 * s, 16);
    lgTankGeo.translate(0, 0.05, 0);
    const lgTankMat = new THREE.MeshLambertMaterial({ color: 0x546e7a });
    this.addInfraMesh(scene, lgTankGeo, lgTankMat, cx - 0.15 * s, 0.05, cz - 0.10 * s);

    // Large tank water surface
    const lgWaterGeo = new THREE.CylinderGeometry(0.19 * s, 0.19 * s, 0.01 * s, 16);
    lgWaterGeo.translate(0, 0.10, 0);
    const lgWaterMat = new THREE.MeshLambertMaterial({ color: 0x80cbc4 });
    this.addInfraMesh(scene, lgWaterGeo, lgWaterMat, cx - 0.15 * s, 0.05, cz - 0.10 * s);

    // Walkway bridge across large tank
    const walkGeo = new THREE.BoxGeometry(0.40 * s, 0.02 * s, 0.03 * s);
    walkGeo.translate(0, 0.11, 0);
    const walkMat = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
    this.addInfraMesh(scene, walkGeo, walkMat, cx - 0.15 * s, 0.05, cz - 0.10 * s);

    // Small settling tank
    const smTankGeo = new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 0.08 * s, 12);
    smTankGeo.translate(0, 0.04, 0);
    const smTankMat = new THREE.MeshLambertMaterial({ color: 0x546e7a });
    this.addInfraMesh(scene, smTankGeo, smTankMat, cx + 0.18 * s, 0.05, cz - 0.10 * s);

    // Small tank water surface
    const smWaterGeo = new THREE.CylinderGeometry(0.11 * s, 0.11 * s, 0.01 * s, 12);
    smWaterGeo.translate(0, 0.08, 0);
    const smWaterMat = new THREE.MeshLambertMaterial({ color: 0x80cbc4 });
    this.addInfraMesh(scene, smWaterGeo, smWaterMat, cx + 0.18 * s, 0.05, cz - 0.10 * s);

    // Control building
    const ctrlGeo = new THREE.BoxGeometry(0.20 * s, 0.20 * s, 0.18 * s);
    ctrlGeo.translate(0, 0.10, 0);
    const ctrlMat = new THREE.MeshLambertMaterial({ color: 0x607d8b });
    this.addInfraMesh(scene, ctrlGeo, ctrlMat, cx + 0.18 * s, 0.05, cz + 0.22 * s);

    // Control building roof
    const ctrlRoofGeo = new THREE.BoxGeometry(0.23 * s, 0.02 * s, 0.21 * s);
    ctrlRoofGeo.translate(0, 0.21, 0);
    const ctrlRoofMat = new THREE.MeshLambertMaterial({ color: 0x455a64 });
    this.addInfraMesh(scene, ctrlRoofGeo, ctrlRoofMat, cx + 0.18 * s, 0.05, cz + 0.22 * s);

    // Connecting pipe between tanks
    const pipeGeo = new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.18 * s, 6);
    pipeGeo.rotateZ(Math.PI / 2);
    pipeGeo.translate(0, 0.06, 0);
    const pipeMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, pipeGeo, pipeMat, cx + 0.02 * s, 0.05, cz - 0.10 * s);

    // Outlet pipe
    const outletGeo = new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 0.20 * s, 6);
    outletGeo.rotateX(Math.PI / 2);
    outletGeo.translate(0, 0.06, 0);
    const outletMat = new THREE.MeshLambertMaterial({ color: 0x607d8b });
    this.addInfraMesh(scene, outletGeo, outletMat, cx - 0.15 * s, 0.05, cz + 0.25 * s);

    // Status indicator light
    const lightGeo = new THREE.BoxGeometry(0.04 * s, 0.04 * s, 0.04 * s);
    lightGeo.translate(0, 0.23, 0);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x26a69a });
    this.addInfraMesh(scene, lightGeo, lightMat, cx + 0.18 * s, 0.05, cz + 0.22 * s, false);
  }

  private buildPowerPlant(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    const s = scale;

    // Main turbine hall
    const hallGeo = new THREE.BoxGeometry(0.50 * s, 0.40 * s, 0.55 * s);
    hallGeo.translate(0, 0.20, 0);
    const hallMat = new THREE.MeshLambertMaterial({ color: 0x5a5550 });
    this.addInfraMesh(scene, hallGeo, hallMat, cx + 0.08 * s, 0.05, cz + 0.05 * s);

    // Hall roof
    const hallRoofGeo = new THREE.BoxGeometry(0.55 * s, 0.03 * s, 0.60 * s);
    hallRoofGeo.translate(0, 0.415, 0);
    const hallRoofMat = new THREE.MeshLambertMaterial({ color: 0x484440 });
    this.addInfraMesh(scene, hallRoofGeo, hallRoofMat, cx + 0.08 * s, 0.05, cz + 0.05 * s);

    // Large cooling tower
    const lgCoolGeo = new THREE.CylinderGeometry(0.10 * s, 0.14 * s, 0.55 * s, 10);
    lgCoolGeo.translate(0, 0.275, 0);
    const lgCoolMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    this.addInfraMesh(scene, lgCoolGeo, lgCoolMat, cx - 0.25 * s, 0.05, cz - 0.15 * s);

    // Cooling tower top ring
    const lgRingGeo = new THREE.CylinderGeometry(0.11 * s, 0.11 * s, 0.03 * s, 10);
    lgRingGeo.translate(0, 0.555, 0);
    const lgRingMat = new THREE.MeshLambertMaterial({ color: 0xbdbdbd });
    this.addInfraMesh(scene, lgRingGeo, lgRingMat, cx - 0.25 * s, 0.05, cz - 0.15 * s);

    // Small cooling tower
    const smCoolGeo = new THREE.CylinderGeometry(0.07 * s, 0.10 * s, 0.42 * s, 10);
    smCoolGeo.translate(0, 0.21, 0);
    const smCoolMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
    this.addInfraMesh(scene, smCoolGeo, smCoolMat, cx - 0.10 * s, 0.05, cz - 0.28 * s);

    // Smokestack
    const stackGeo = new THREE.CylinderGeometry(0.035 * s, 0.04 * s, 0.65 * s, 8);
    stackGeo.translate(0, 0.325, 0);
    const stackMat = new THREE.MeshLambertMaterial({ color: 0x757575 });
    this.addInfraMesh(scene, stackGeo, stackMat, cx + 0.28 * s, 0.05, cz - 0.20 * s);

    // Chimney red band 1 (near top)
    const band1Geo = new THREE.CylinderGeometry(0.042 * s, 0.042 * s, 0.03 * s, 8);
    band1Geo.translate(0, 0.62, 0);
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xcc3333 });
    this.addInfraMesh(scene, band1Geo, bandMat, cx + 0.28 * s, 0.05, cz - 0.20 * s);

    // Chimney red band 2 (mid area)
    const band2Geo = new THREE.CylinderGeometry(0.042 * s, 0.042 * s, 0.03 * s, 8);
    band2Geo.translate(0, 0.42, 0);
    this.addInfraMesh(scene, band2Geo, bandMat, cx + 0.28 * s, 0.05, cz - 0.20 * s);

    // Coal pile 1
    const coal1Geo = new THREE.ConeGeometry(0.10 * s, 0.08 * s, 6);
    coal1Geo.translate(0, 0.04, 0);
    const coalMat = new THREE.MeshLambertMaterial({ color: 0x2a2520 });
    this.addInfraMesh(scene, coal1Geo, coalMat, cx - 0.22 * s, 0.05, cz + 0.25 * s);

    // Coal pile 2
    const coal2Geo = new THREE.ConeGeometry(0.07 * s, 0.05 * s, 5);
    coal2Geo.translate(0, 0.025, 0);
    this.addInfraMesh(scene, coal2Geo, coalMat, cx - 0.08 * s, 0.05, cz + 0.28 * s);

    // Transformer box 1
    const tx1Geo = new THREE.BoxGeometry(0.06 * s, 0.10 * s, 0.06 * s);
    tx1Geo.translate(0, 0.05, 0);
    const txMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, tx1Geo, txMat, cx + 0.35 * s, 0.05, cz + 0.15 * s);

    // Transformer box 2
    const tx2Geo = new THREE.BoxGeometry(0.06 * s, 0.10 * s, 0.06 * s);
    tx2Geo.translate(0, 0.05, 0);
    this.addInfraMesh(scene, tx2Geo, txMat, cx + 0.35 * s, 0.05, cz + 0.25 * s);

    // Power pylon
    const pylonGeo = new THREE.CylinderGeometry(0.008 * s, 0.008 * s, 0.30 * s, 4);
    pylonGeo.translate(0, 0.15, 0);
    const pylonMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    this.addInfraMesh(scene, pylonGeo, pylonMat, cx + 0.38 * s, 0.05, cz - 0.10 * s);

    // Pylon crossarm
    const crossGeo = new THREE.BoxGeometry(0.12 * s, 0.01 * s, 0.01 * s);
    crossGeo.translate(0, 0.28, 0);
    this.addInfraMesh(scene, crossGeo, pylonMat, cx + 0.38 * s, 0.05, cz - 0.10 * s);

    // Warning sign
    const signGeo = new THREE.BoxGeometry(0.08 * s, 0.06 * s, 0.01 * s);
    signGeo.translate(0, 0.10, 0);
    const signMat = new THREE.MeshLambertMaterial({ color: 0xf0c030 });
    this.addInfraMesh(scene, signGeo, signMat, cx + 0.35 * s, 0.05, cz - 0.28 * s);

    // Status light
    const lightGeo = new THREE.BoxGeometry(0.06 * s, 0.04 * s, 0.06 * s);
    lightGeo.translate(0, 0.44, 0);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b });
    this.addInfraMesh(scene, lightGeo, lightMat, cx + 0.08 * s, 0.05, cz + 0.05 * s, false);
  }

  private buildWaterPump(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    const s = scale;

    // Concrete foundation
    const foundGeo = new THREE.BoxGeometry(0.82 * s, 0.04 * s, 0.82 * s);
    foundGeo.translate(0, 0.02, 0);
    const foundMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    this.addInfraMesh(scene, foundGeo, foundMat, cx, 0.05, cz);

    // Water tower tank (elevated)
    const tankGeo = new THREE.CylinderGeometry(0.15 * s, 0.15 * s, 0.18 * s, 12);
    tankGeo.translate(0, 0.09, 0);
    const tankMat = new THREE.MeshLambertMaterial({ color: 0x29b6f6 });
    this.addInfraMesh(scene, tankGeo, tankMat, cx - 0.20 * s, 0.37, cz - 0.05 * s);

    // Tower cone roof
    const roofGeo = new THREE.ConeGeometry(0.16 * s, 0.06 * s, 12);
    roofGeo.translate(0, 0.21, 0);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x0288d1 });
    this.addInfraMesh(scene, roofGeo, roofMat, cx - 0.20 * s, 0.37, cz - 0.05 * s);

    // 4 tower legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0x78909c });
    const legOffsets = [
      [-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08],
    ];
    for (const [dx, dz] of legOffsets as [number, number][]) {
      const legGeo = new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.30 * s, 6);
      legGeo.translate(0, 0.15, 0);
      this.addInfraMesh(scene, legGeo, legMat, cx + (-0.20 + dx) * s, 0.07, cz + (-0.05 + dz) * s);
    }

    // 2 horizontal braces connecting legs at mid-height
    const braceGeo1 = new THREE.BoxGeometry(0.20 * s, 0.01 * s, 0.01 * s);
    braceGeo1.translate(0, 0.12, 0);
    this.addInfraMesh(scene, braceGeo1, legMat, cx - 0.20 * s, 0.07, cz - 0.05 * s);

    const braceGeo2 = new THREE.BoxGeometry(0.01 * s, 0.01 * s, 0.20 * s);
    braceGeo2.translate(0, 0.12, 0);
    this.addInfraMesh(scene, braceGeo2, legMat, cx - 0.20 * s, 0.07, cz - 0.05 * s);

    // Pump house
    const pumpGeo = new THREE.BoxGeometry(0.35 * s, 0.28 * s, 0.35 * s);
    pumpGeo.translate(0, 0.14, 0);
    const pumpMat = new THREE.MeshLambertMaterial({ color: 0x4a6a7a });
    this.addInfraMesh(scene, pumpGeo, pumpMat, cx + 0.12 * s, 0.07, cz + 0.05 * s);

    // Pump house roof
    const pumpRoofGeo = new THREE.BoxGeometry(0.38 * s, 0.03 * s, 0.38 * s);
    pumpRoofGeo.translate(0, 0.29, 0);
    const pumpRoofMat = new THREE.MeshLambertMaterial({ color: 0x3a5a6a });
    this.addInfraMesh(scene, pumpRoofGeo, pumpRoofMat, cx + 0.12 * s, 0.07, cz + 0.05 * s);

    // Filtration pool
    const poolGeo = new THREE.BoxGeometry(0.30 * s, 0.06 * s, 0.25 * s);
    poolGeo.translate(0, 0.03, 0);
    const poolMat = new THREE.MeshLambertMaterial({ color: 0x546e7a });
    this.addInfraMesh(scene, poolGeo, poolMat, cx + 0.12 * s, 0.04, cz - 0.25 * s);

    // Pool water surface
    const poolWaterGeo = new THREE.BoxGeometry(0.28 * s, 0.01 * s, 0.23 * s);
    poolWaterGeo.translate(0, 0.065, 0);
    const poolWaterMat = new THREE.MeshLambertMaterial({ color: 0x4fc3f7 });
    this.addInfraMesh(scene, poolWaterGeo, poolWaterMat, cx + 0.12 * s, 0.04, cz - 0.25 * s);

    // Main pipe (tower to pump house) — horizontal along X
    const mainPipeGeo = new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 0.22 * s, 6);
    mainPipeGeo.rotateZ(Math.PI / 2);
    mainPipeGeo.translate(0, 0.20, 0);
    const mainPipeMat = new THREE.MeshLambertMaterial({ color: 0x607888 });
    this.addInfraMesh(scene, mainPipeGeo, mainPipeMat, cx - 0.04 * s, 0.07, cz + 0.00 * s);

    // Inlet pipe — horizontal along Z
    const inletGeo = new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.15 * s, 6);
    inletGeo.rotateX(Math.PI / 2);
    inletGeo.translate(0, 0.08, 0);
    const inletMat = new THREE.MeshLambertMaterial({ color: 0x4a8898 });
    this.addInfraMesh(scene, inletGeo, inletMat, cx + 0.12 * s, 0.04, cz - 0.10 * s);

    // Control gauge box
    const gaugeGeo = new THREE.BoxGeometry(0.06 * s, 0.08 * s, 0.015 * s);
    gaugeGeo.translate(0, 0.18, 0);
    const gaugeMat = new THREE.MeshLambertMaterial({ color: 0xd0d8e0 });
    this.addInfraMesh(scene, gaugeGeo, gaugeMat, cx + 0.30 * s, 0.07, cz + 0.05 * s);

    // Status light
    const lightGeo = new THREE.BoxGeometry(0.05 * s, 0.04 * s, 0.05 * s);
    lightGeo.translate(0, 0.31, 0);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x03a9f4 });
    this.addInfraMesh(scene, lightGeo, lightMat, cx + 0.12 * s, 0.07, cz + 0.05 * s, false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP E — Land Transport (Bus / Metro / Train)
  // ═══════════════════════════════════════════════════════════════════

  private buildBusStop(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // TODO: Low-poly bus stop — shelter canopy + sign pole + bench
    this.buildCivicBuilding(scene, cx, cz, 'bus_stop', scale);
  }

  private buildMetroStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // TODO: Low-poly metro station — arch entrance + stairs + vent shaft + M sign
    this.buildCivicBuilding(scene, cx, cz, 'metro_station', scale);
  }

  private buildTrainStation(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // TODO: Low-poly train station — station house + clock tower + platform canopy + rails
    this.buildCivicBuilding(scene, cx, cz, 'train_station', scale);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  GROUP F — Other Transport (Ferry / Airport / Taxi)
  // ═══════════════════════════════════════════════════════════════════

  private buildFerryDock(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // TODO: Low-poly ferry dock — wooden pier + lighthouse + waiting shelter + bollards
    this.buildCivicBuilding(scene, cx, cz, 'ferry_dock', scale);
  }

  private buildAirport(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // TODO: Low-poly airport — terminal + control tower + runway + jet bridges
    this.buildCivicBuilding(scene, cx, cz, 'airport', scale);
  }

  private buildTaxiStand(scene: THREE.Scene | THREE.Group, cx: number, cz: number, scale = 1): void {
    // TODO: Low-poly taxi stand — shelter + TAXI sign + yellow cab
    this.buildCivicBuilding(scene, cx, cz, 'taxi_stand', scale);
  }

  // ═══════════════════════════════════════════════════════════════════

  private addInfraMesh(scene: THREE.Scene | THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true): void {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    scene.add(m);
    this.meshes.push(m);
  }

  private buildLightSpots(scene: THREE.Scene, positions: { x: number; y: number }[]): void {
    if (positions.length === 0) return;

    const glowRadius = 0.3;
    const glowSegs = 10;
    const geometry = new THREE.CircleGeometry(glowRadius, glowSegs);
    geometry.rotateX(-Math.PI / 2);
    // Radial gradient: center bright, edges fade to black
    const posAttr = geometry.attributes.position!;
    const vColors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const pz = posAttr.getZ(i);
      const dist = Math.sqrt(px * px + pz * pz) / glowRadius;
      const b = Math.max(0, 1 - dist);
      vColors[i * 3] = b;
      vColors[i * 3 + 1] = b;
      vColors[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(vColors, 3));

    this.lightSpotMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const count = Math.min(positions.length, this.maxPerVariant);
    this.lightSpotMesh = new THREE.InstancedMesh(geometry, this.lightSpotMaterial, count);
    this.lightSpotMesh.frustumCulled = false;
    this.lightSpotMesh.renderOrder = 2;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const p = positions[i]!;
      matrix.setPosition(p.x, 0.03, p.y);
      this.lightSpotMesh.setMatrixAt(i, matrix);
    }
    this.lightSpotMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.lightSpotMesh);
  }

  /** Update light spot visibility based on sun intensity (call each frame). */
  update(sunIntensity: number): void {
    if (!this.lightSpotMaterial) return;
    if (this._focusMode) {
      this.lightSpotMaterial.opacity = 0;
      return;
    }
    this.lightSpotMaterial.opacity = Math.max(0, 0.4 * (1 - sunIntensity / 0.3));
  }

  private _focusMode = false;
  private _whiteModelMesh: THREE.Mesh | null = null;
  private static _whiteModelMat: THREE.MeshBasicMaterial | null = null;

  private static getWhiteModelMat(): THREE.MeshBasicMaterial {
    if (!BuildingRenderer._whiteModelMat) {
      BuildingRenderer._whiteModelMat = new THREE.MeshBasicMaterial({
        color: 0xe0e0e0,
        opacity: 0.08,
        alphaHash: true,
      });
    }
    return BuildingRenderer._whiteModelMat;
  }

  /** Switch view mode — any non-NORMAL mode shows white model. */
  setViewMode(mode: ViewMode, scene?: THREE.Scene): void {
    const enabled = mode !== ViewMode.NORMAL;
    this._focusMode = enabled;

    if (enabled && scene) {
      // Hide originals
      for (const mesh of this.meshes) mesh.visible = false;
      for (const group of this.infraGroups) group.visible = false;
      if (this.lightSpotMesh) this.lightSpotMesh.visible = false;

      // Build merged white model mesh
      this.buildWhiteModelMesh(scene);
    } else {
      // Remove white model mesh
      if (this._whiteModelMesh && scene) {
        scene.remove(this._whiteModelMesh);
        this._whiteModelMesh.geometry.dispose();
        this._whiteModelMesh = null;
      }

      // Restore originals
      for (const mesh of this.meshes) {
        mesh.visible = true;
        mesh.material = getBuildingMaterial();
        mesh.renderOrder = 0;
      }
      for (const group of this.infraGroups) group.visible = true;
      if (this.lightSpotMesh) this.lightSpotMesh.visible = true;
    }
  }

  /** Bake all building InstancedMeshes + infra into one merged white model mesh. */
  private buildWhiteModelMesh(scene: THREE.Scene): void {
    // Remove old one if exists
    if (this._whiteModelMesh) {
      scene.remove(this._whiteModelMesh);
      this._whiteModelMesh.geometry.dispose();
      this._whiteModelMesh = null;
    }

    const geos: THREE.BufferGeometry[] = [];
    const mat4 = new THREE.Matrix4();

    // Bake InstancedMesh instances + plain Mesh (zone overlays)
    for (const mesh of this.meshes) {
      if (mesh instanceof THREE.InstancedMesh) {
        const srcGeo = mesh.geometry;
        const count = mesh.count;
        for (let i = 0; i < count; i++) {
          mesh.getMatrixAt(i, mat4);
          const clone = srcGeo.clone();
          clone.applyMatrix4(mat4);
          clone.deleteAttribute('color');
          geos.push(clone);
        }
      } else {
        const clone = mesh.geometry.clone();
        mesh.updateWorldMatrix(true, false);
        clone.applyMatrix4(mesh.matrixWorld);
        clone.deleteAttribute('color');
        geos.push(clone);
      }
    }

    // Bake infra group meshes
    for (const group of this.infraGroups) {
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const clone = child.geometry.clone();
          child.updateWorldMatrix(true, false);
          clone.applyMatrix4(child.matrixWorld);
          clone.deleteAttribute('color');
          geos.push(clone);
        }
      });
    }

    if (geos.length === 0) return;

    const merged = mergeGeometries(geos, false);
    if (!merged) return;

    // Dispose cloned geos
    for (const g of geos) g.dispose();

    this._whiteModelMesh = new THREE.Mesh(merged, BuildingRenderer.getWhiteModelMat());
    this._whiteModelMesh.renderOrder = 20;
    this._whiteModelMesh.frustumCulled = false;
    scene.add(this._whiteModelMesh);
  }

  dispose(scene: THREE.Scene): void {
    if (this._whiteModelMesh) {
      scene.remove(this._whiteModelMesh);
      this._whiteModelMesh.geometry.dispose();
      this._whiteModelMesh = null;
    }

    for (const mesh of this.meshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else if (mat !== getBuildingMaterial()) (mat as THREE.Material).dispose();
    }
    this.meshes = [];

    for (const group of this.infraGroups) {
      scene.remove(group);
    }
    this.infraGroups = [];

    if (this.lightSpotMesh) {
      scene.remove(this.lightSpotMesh);
      this.lightSpotMesh.geometry.dispose();
      if (this.lightSpotMaterial) this.lightSpotMaterial.dispose();
      this.lightSpotMesh = null;
      this.lightSpotMaterial = null;
    }
  }
}

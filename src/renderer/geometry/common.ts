import * as THREE from 'three';

/** 為 BufferGeometry 設定統一的頂點顏色。 */
export function setVertexColors(geo: THREE.BufferGeometry, r: number, g: number, b: number): void {
  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

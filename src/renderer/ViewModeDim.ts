import * as THREE from 'three';

/**
 * focus 模式的白模化 —— 把地面上的東西壓成半透明中性灰，讓底下（或聚焦中）的
 * 東西看得見。
 *
 * 壓白模是直接改材質的 `color`，而每份材質的原色只寫在建立它的那一行。這裡在
 * 第一次動手之前把原色收進 `userData.baseColor`，還原時才有東西可以寫回去；
 * 由呼叫端各自記一份色碼的話，改了建構時的顏色就會與還原的顏色不同步。
 */

/** 白模化之後蓋上去的中性灰。 */
export const DIM_TINT = 0xcccccc;

/** 半透明物體的繪製順序 —— 排在所有不透明物體之後。 */
export const DIM_RENDER_ORDER = 20;

/** 有 `color` 與透明度可調的材質。 */
type DimmableMaterial = THREE.Material & {
  color: THREE.Color;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
};

/**
 * 把材質切成半透明白模（`opacity < 1`）或還原成原本的樣子（`opacity >= 1`）。
 */
export function setMaterialDim(mat: DimmableMaterial, opacity: number, tint = DIM_TINT): void {
  if (mat.userData.baseColor === undefined) mat.userData.baseColor = mat.color.getHex();
  if (opacity < 1.0) {
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
    mat.color.setHex(tint);
  } else {
    mat.transparent = false;
    mat.opacity = 1.0;
    mat.depthWrite = true;
    mat.color.setHex(mat.userData.baseColor as number);
  }
}

/** 材質與繪製順序一起處理。多重材質的網格不在支援範圍內。 */
export function setMeshDim(
  mesh: THREE.Mesh | THREE.InstancedMesh, opacity: number, tint = DIM_TINT,
): void {
  setMaterialDim(mesh.material as DimmableMaterial, opacity, tint);
  mesh.renderOrder = opacity < 1.0 ? DIM_RENDER_ORDER : 0;
}

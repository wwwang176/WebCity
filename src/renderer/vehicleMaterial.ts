import * as THREE from 'three';

/**
 * 車輛材質。
 *
 * 車輛的顏色**直接寫在 `color` 屬性上**（`geometry/common.ts` 的
 * `setVertexColors`），所以它們吃的是 `vertexColors: true` 的 Lambert，
 * 而不是建築那支把 `color` 讀成「零件標籤 / 分區 / 地面明度」的 shader。
 *
 * 抽成一個工廠的理由：`VehicleRenderer` 與公共建築的停車場都要建它，而
 * 各寫一份 `new MeshLambertMaterial({ vertexColors: true })` 的話，哪天
 * 有人替車輛加上 `flatShading` 或改成別的材質，停在停車場的那幾台會靜靜地
 * 留在舊的樣子。
 *
 * 回傳新實例而不是單例：`VehicleRenderer` 逐車種各建一個
 * `InstancedMesh`，它們之後可能各自需要不同的設定。
 */
export function createVehicleMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

import type * as THREE from 'three';
import { detailHidden } from '../renderer/detailLOD';

/**
 * 展示區的遠景細節剔除。
 *
 * 遊戲把矮物件與懸挑放在 `InstancedLayer` 裡，用整層的閘門開關；展示區畫的
 * 是普通 `Mesh`，那個閘門碰不到它。所以這裡自己記住哪些 Mesh 屬於可剔除的
 * 兩層，判斷本身仍然共用 `renderer/detailLOD` —— 門檻與遲滯只能有一份。
 *
 * 貼片層不進來：它是平的鋪面，撐住「地面有東西」的觀感（見 BUG-231）。
 */
export class DetailVisibility {
  private readonly meshes: THREE.Object3D[] = [];
  private hidden = false;

  get size(): number { return this.meshes.length; }
  get isHidden(): boolean { return this.hidden; }

  /**
   * 開始管理一個物件，並立刻套用目前的狀態。
   *
   * 「立刻套用」是重點：切換控制項會整批重畫，重畫出來的東西若一律
   * `visible = true`，縮在遠景時動一下滑桿細節就會全部冒回來。這與遊戲那一側
   * `InstancedLayer.acquire` 的閘門是同一個坑。
   */
  add(mesh: THREE.Object3D): void {
    mesh.visible = !this.hidden;
    this.meshes.push(mesh);
  }

  /** 放掉所有參照。展示區每次重畫都會 dispose 舊的 Mesh。 */
  clear(): void {
    this.meshes.length = 0;
  }

  /** 依鏡頭的視錐高度更新。狀態沒變時不做事。 */
  update(frustumHeight: number): void {
    const hidden = detailHidden(frustumHeight, this.hidden);
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    for (const mesh of this.meshes) mesh.visible = !hidden;
  }
}

import * as THREE from 'three';
import { AirplaneAnimator, type AirportSystemLike } from '../renderer/AirplaneAnimator';
import { civicVehicleGeometry } from '../renderer/geometry/civic/assemble';
import { createVehicleMaterial } from '../renderer/vehicleMaterial';
import { getRotatedSize } from '../core/building/InfraConfig';
import { getAirportDimensions, type Airport, type AirportSize }
  from '../core/transport/AirportSystem';
import type { TransportVehicleRenderData } from '../core/transport/collectTransportVehicles';

/**
 * 展示區的飛機起降動畫。
 *
 * 展示區要有飛機動畫才比較得出來。比較的對象是**貼片** —— 飛機真的落在
 * 跑道上嗎、真的沿著滑行道走嗎、真的停進機位嗎。那三件事
 * 只有讓飛機真的動起來才看得出來，而 BUG-239 正是靠肉眼以外的方式抓到的。
 *
 * 它跑的是**遊戲裡同一個** `AirplaneAnimator`，不是另寫一份：另寫一份的話，
 * 展示區看到的對齊與遊戲裡的對齊會是兩件事，而展示區的唯一價值就是「這裡
 * 看到的就是出貨的東西」。
 */

/** 展示區裡一座機場的位置。 */
export interface PlaneField {
  size: AirportSize;
  /** 佔地中心（格），與 `civicLayout` 的 slot 同一套座標。 */
  x: number;
  z: number;
}

/**
 * 一次最多同時畫幾架。
 *
 * `AirplaneAnimator` 的 `MAX_ACTIVE` 是小 1、中 1、大 2 —— 三座加起來 4。
 * 開到 8 是為了讓池子永遠不必在飛行中重建（重建會讓飛機閃一下）。
 */
const POOL_SIZE = 8;

export class ShowcasePlanes {
  private readonly animator = new AirplaneAnimator();
  private readonly pool: THREE.Mesh[] = [];
  private readonly out: TransportVehicleRenderData[] = [];
  private readonly system: AirportSystemLike;
  private airports: Airport[] = [];

  constructor(private readonly scene: THREE.Scene) {
    const material = createVehicleMaterial();
    // 機身與尾翼合併成一份 —— 它們一起動，分開只是多一次 draw call。
    // 幾何與**停在停機坪上的那幾架**是同一份（`civicVehicleGeometry`），
    // 所以天上飛的與地上停的塗裝一致。
    const geo = civicVehicleGeometry('airplane');
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push(mesh);
    }
    this.system = { getAirports: () => this.airports };
  }

  /**
   * 設定這一輪要跑動畫的機場。
   *
   * `AirplaneAnimator` 從 `airport.x + (w − 1) / 2` 算佔地中心（`airport.x`
   * 是左上角的格索引），所以這裡要反推回去 —— 直接把 slot 的中心填進 `x`
   * 的話，飛機會整批偏掉半座機場。
   */
  setFields(fields: readonly PlaneField[]): void {
    this.airports = fields.map((f, id): Airport => {
      const dim = getAirportDimensions(f.size);
      const { w, h } = getRotatedSize(dim.w, dim.h, 0);
      return {
        id,
        x: f.x - (w - 1) / 2,
        y: f.z - (h - 1) / 2,
        size: f.size,
        rotation: 0,
        // 展示區沒有模擬，這四個值只是為了滿足型別。
        noisePollution: 0, touristsPerTick: 0, cargoPerTick: 0, operatingCost: 0,
      };
    });
  }

  /** 推進一幀。`dt` 是秒。 */
  update(dt: number): void {
    this.out.length = 0;
    this.animator.update(dt, 1, this.system, this.out);

    for (const [i, mesh] of this.pool.entries()) {
      const v = this.out[i];
      if (!v) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(v.x, v.altitude ?? 0.09, v.y);
      // 與 `VehicleRenderer` 同一套：先繞 y 轉航向，再在**局部**空間套
      // roll（繞 x）與 pitch（繞 z）。順序反了的話爬升中的飛機會側著飛。
      mesh.rotation.set(0, 0, 0);
      mesh.rotateY(v.heading);
      if (v.roll) mesh.rotateX(v.roll);
      if (v.pitch) mesh.rotateZ(v.pitch);
      const s = v.scale ?? 1;
      mesh.scale.set(s, s, s);
    }
  }

  /** 清掉場上的飛機（切換檢視模式時）。 */
  clear(): void {
    this.airports = [];
    this.out.length = 0;
    for (const mesh of this.pool) mesh.visible = false;
  }

  dispose(): void {
    this.animator.dispose();
    for (const mesh of this.pool) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.pool.length = 0;
  }
}

import * as THREE from 'three';

/**
 * 一組以 (幾何 × 材質) 分桶的 `InstancedMesh`，外加「一格一個實例」的索引。
 *
 * 建築量體與地面物件是兩個獨立的圖層，但兩者的實例管理一模一樣：建桶、
 * 容量倍增、swap-with-last 移除、四個逐實例屬性。複製一份就是兩份會各自
 * 漂移的程式碼，而這一段的錯誤特別難發現 —— 索引搬錯只在城市長到超過初始
 * 容量、或玩家拆除建築之後才現形，而且畫面上看起來只是「某棟樓怪怪的」。
 */

export interface LayerEntry {
  key: string;
  idx: number;
}

/**
 * 每個實例都要帶的自訂屬性。名稱與長度只寫這一份 —— 建桶、倍增、
 * swap-with-last 三個地方都吃它。漏掉任何一處，建築就會戴上別人的資料。
 */
const INSTANCE_ATTRIBUTES: ReadonlyArray<readonly [string, number]> = [
  ['aHighlight', 1],
  ['aHighlightColor', 3],
  ['aOccupancy', 1],
  ['aSeed', 3],
];

export class InstancedLayer {
  private readonly buckets = new Map<string, THREE.InstancedMesh>();
  private readonly counts = new Map<string, number>();
  private readonly capacities = new Map<string, number>();
  private readonly entries = new Map<string, LayerEntry>();
  /** 桶 → (實例索引 → 格子 key)。swap-with-last 之後要修正被搬動的那一個。 */
  private readonly reverse = new Map<string, Map<number, string>>();

  private readonly _matrix = new THREE.Matrix4();
  private readonly _color = new THREE.Color();

  constructor(
    private readonly material: THREE.Material,
    private readonly initialCapacity = 256,
  ) {}

  /** 既有測試與 BuildingRenderer 的相容視窗。 */
  get bucketMap(): ReadonlyMap<string, THREE.InstancedMesh> { return this.buckets; }
  get entryMap(): ReadonlyMap<string, LayerEntry> { return this.entries; }
  get meshes(): IterableIterator<THREE.InstancedMesh> { return this.buckets.values(); }
  get size(): number { return this.entries.size; }

  meshFor(key: string): THREE.InstancedMesh | undefined { return this.buckets.get(key); }
  entryFor(posKey: string): LayerEntry | undefined { return this.entries.get(posKey); }
  countOf(key: string): number { return this.counts.get(key) ?? 0; }
  /** 這個桶的第 idx 個實例屬於哪一格。 */
  posKeyAt(key: string, idx: number): string | undefined {
    return this.reverse.get(key)?.get(idx);
  }

  /**
   * 建一個空桶。`geometry` 的所有權轉移給這個圖層。
   *
   * `castShadow` 預設開，但地面貼片必須關掉：一片沒有厚度的四邊形投出來的
   * 影子是一條線，而且陰影貼圖每一棟都要算一次。
   */
  createBucket(
    scene: THREE.Scene, key: string, geometry: THREE.BufferGeometry,
    opts: { castShadow?: boolean } = {},
  ): void {
    if (this.buckets.has(key)) return;

    const mesh = new THREE.InstancedMesh(geometry, this.material, this.initialCapacity);
    mesh.count = 0;
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    for (const [name, itemSize] of INSTANCE_ATTRIBUTES) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(
        new Float32Array(this.initialCapacity * itemSize), itemSize,
      ));
    }

    scene.add(mesh);
    this.buckets.set(key, mesh);
    this.counts.set(key, 0);
    this.capacities.set(key, this.initialCapacity);
    this.reverse.set(key, new Map());
  }

  /**
   * 取一個空位給 `posKey`，容量不足時自動倍增。桶不存在時回傳 null。
   *
   * 回傳的 `mesh` 可能與 `meshFor(key)` 先前回傳的不是同一個物件 ——
   * 倍增會換一份新的。呼叫端必須用回傳的這一個寫資料。
   */
  acquire(
    scene: THREE.Scene, key: string, posKey: string,
  ): { mesh: THREE.InstancedMesh; idx: number; grew: boolean } | null {
    let mesh = this.buckets.get(key);
    if (!mesh) return null;

    const idx = this.counts.get(key)!;
    const grew = idx >= (this.capacities.get(key) ?? 0);
    if (grew) mesh = this.grow(scene, key);

    this.counts.set(key, idx + 1);
    mesh.count = idx + 1;
    this.entries.set(posKey, { key, idx });
    this.reverse.get(key)!.set(idx, posKey);
    return { mesh, idx, grew };
  }

  /**
   * 把一個桶的容量加倍。
   *
   * `InstancedMesh` 的容量在建構時固定，所以只能換一個新的並把資料整批搬過去。
   * 矩陣、顏色與所有自訂屬性都要搬。
   */
  private grow(scene: THREE.Scene, key: string): THREE.InstancedMesh {
    const old = this.buckets.get(key)!;
    const capacity = (this.capacities.get(key) ?? this.initialCapacity) * 2;

    // 幾何要自己一份：屬性緩衝長度跟著容量走，共用會讓舊的那份長度不夠。
    const geometry = old.geometry.clone();
    const grown = new THREE.InstancedMesh(geometry, old.material, capacity);
    grown.count = old.count;
    grown.castShadow = old.castShadow;
    grown.receiveShadow = old.receiveShadow;
    grown.frustumCulled = old.frustumCulled;
    grown.visible = old.visible;

    for (let i = 0; i < old.count; i++) {
      old.getMatrixAt(i, this._matrix);
      grown.setMatrixAt(i, this._matrix);
    }
    grown.instanceMatrix.needsUpdate = true;

    if (old.instanceColor) {
      for (let i = 0; i < old.count; i++) {
        old.getColorAt(i, this._color);
        grown.setColorAt(i, this._color);
      }
      if (grown.instanceColor) grown.instanceColor.needsUpdate = true;
    }

    for (const [name, itemSize] of INSTANCE_ATTRIBUTES) {
      const src = old.geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
      const data = new Float32Array(capacity * itemSize);
      if (src) data.set((src.array as Float32Array).subarray(0, old.count * itemSize));
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    }

    scene.remove(old);
    scene.add(grown);
    this.buckets.set(key, grown);
    this.capacities.set(key, capacity);
    return grown;
  }

  /**
   * 移除一格的實例：把最後一個搬進空出來的位置。
   *
   * 矩陣、顏色與每個自訂屬性都要一起搬 —— 漏搬任何一個，被搬動的那一棟
   * 就會戴上被移除那一棟的資料，而且只在玩家拆除建築之後才發生。
   */
  release(posKey: string): void {
    const entry = this.entries.get(posKey);
    if (!entry) return;

    const mesh = this.buckets.get(entry.key)!;
    const lastIdx = this.counts.get(entry.key)! - 1;
    const rev = this.reverse.get(entry.key)!;

    if (entry.idx !== lastIdx) {
      mesh.getMatrixAt(lastIdx, this._matrix);
      mesh.setMatrixAt(entry.idx, this._matrix);
      if (mesh.instanceColor) {
        mesh.getColorAt(lastIdx, this._color);
        mesh.setColorAt(entry.idx, this._color);
      }

      for (const [name, itemSize] of INSTANCE_ATTRIBUTES) {
        const attr = mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
        if (!attr) continue;
        const arr = attr.array as Float32Array;
        for (let c = 0; c < itemSize; c++) {
          arr[entry.idx * itemSize + c] = arr[lastIdx * itemSize + c]!;
        }
        attr.needsUpdate = true;
      }

      const movedPosKey = rev.get(lastIdx)!;
      this.entries.set(movedPosKey, { key: entry.key, idx: entry.idx });
      rev.set(entry.idx, movedPosKey);
    }

    rev.delete(lastIdx);
    this.entries.delete(posKey);
    this.counts.set(entry.key, lastIdx);
    mesh.count = lastIdx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** 清空所有實例但保留 GPU 緩衝（整張地圖重建時用）。 */
  reset(): void {
    for (const [key, mesh] of this.buckets) {
      mesh.count = 0;
      this.counts.set(key, 0);
      this.reverse.get(key)!.clear();
    }
    this.entries.clear();
  }

  /** 把所有桶的矩陣與顏色標記為需要上傳。整批加入之後呼叫一次即可。 */
  flush(): void {
    for (const mesh of this.buckets.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of this.buckets.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.buckets.clear();
    this.counts.clear();
    this.capacities.clear();
    this.entries.clear();
    this.reverse.clear();
  }
}

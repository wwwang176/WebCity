import * as THREE from 'three';

/**
 * A set of `InstancedMesh` buckets keyed by (geometry x material), plus a one-instance-per-cell
 * index.
 *
 * Building masses and ground props are two separate layers, but their instance management is
 * identical: creating buckets, doubling capacity, swap-with-last removal, and four per-instance
 * attributes. A second copy is two pieces of code free to drift, and mistakes here are especially
 * hard to spot — a mis-moved index only surfaces once the city outgrows the initial capacity or
 * the player demolishes something, and on screen it reads only as "that building looks odd".
 */

export interface LayerEntry {
  key: string;
  idx: number;
}

/**
 * The custom attributes every instance carries. Their names and lengths are written once, and
 * bucket creation, doubling and swap-with-last all read them. Missing any one of the three leaves
 * a building wearing somebody else's data.
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
  /** Bucket to (instance index to cell key). After a swap-with-last, the moved one has to be corrected. */
  private readonly reverse = new Map<string, Map<number, string>>();

  private readonly _matrix = new THREE.Matrix4();
  private readonly _color = new THREE.Color();

  /**
   * The whole layer's visibility gate. Closed, no bucket draws; open, **only non-empty buckets**
   * come back — an empty bucket's `visible = false` is an existing optimisation, since three.js
   * still walks the full render list for an InstancedMesh with count === 0, and the gate must not
   * override it.
   *
   * Held as state rather than left to callers to set per bucket: `acquire` and `release` also
   * touch `visible`, and without the gate, building a new house while the layer is closed makes
   * that one bucket appear on its own.
   */
  private gate = true;

  constructor(
    private readonly material: THREE.Material,
    private readonly initialCapacity = 256,
  ) {}

  /** A compatibility view for existing tests and BuildingRenderer. */
  get bucketMap(): ReadonlyMap<string, THREE.InstancedMesh> { return this.buckets; }
  get entryMap(): ReadonlyMap<string, LayerEntry> { return this.entries; }
  get meshes(): IterableIterator<THREE.InstancedMesh> { return this.buckets.values(); }
  get size(): number { return this.entries.size; }

  meshFor(key: string): THREE.InstancedMesh | undefined { return this.buckets.get(key); }
  get visible(): boolean { return this.gate; }

  /** Opens or closes the whole layer. Non-empty buckets follow the gate; empty ones stay closed. */
  setVisible(visible: boolean): void {
    if (this.gate === visible) return;
    this.gate = visible;
    for (const [key, mesh] of this.buckets) {
      mesh.visible = visible && (this.counts.get(key) ?? 0) > 0;
    }
  }

  entryFor(posKey: string): LayerEntry | undefined { return this.entries.get(posKey); }
  countOf(key: string): number { return this.counts.get(key) ?? 0; }
  /** Which cell this bucket's instance idx belongs to. */
  posKeyAt(key: string, idx: number): string | undefined {
    return this.reverse.get(key)?.get(idx);
  }

  /**
   * Creates an empty bucket. Ownership of `geometry` passes to this layer.
   *
   * `castShadow` defaults to on, but ground decals have to turn it off: a quad with no thickness
   * casts a shadow that is a line, and the shadow map computes one per building.
   */
  createBucket(
    scene: THREE.Scene, key: string, geometry: THREE.BufferGeometry,
    opts: { castShadow?: boolean } = {},
  ): void {
    if (this.buckets.has(key)) return;

    const mesh = new THREE.InstancedMesh(geometry, this.material, this.initialCapacity);
    mesh.count = 0;
    // three.js still walks the full render list for an InstancedMesh with count === 0. With the
    // bucket count grown from 60 to 168, an empty bucket's cost goes from negligible to
    // noticeable: at startup and in a sparse city, most buckets are empty.
    mesh.visible = false;
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
   * Takes a free slot for `posKey`, doubling capacity when it runs out. Returns null when the
   * bucket does not exist.
   *
   * The `mesh` returned may not be the same object `meshFor(key)` returned earlier, since doubling
   * replaces it. The caller has to write its data into the one returned here.
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
    mesh.visible = this.gate;
    this.entries.set(posKey, { key, idx });
    this.reverse.get(key)!.set(idx, posKey);
    return { mesh, idx, grew };
  }

  /**
   * Doubles one bucket's capacity.
   *
   * An `InstancedMesh`'s capacity is fixed at construction, so the only option is a new one with
   * the data copied across: matrices, colours and every custom attribute.
   */
  private grow(scene: THREE.Scene, key: string): THREE.InstancedMesh {
    const old = this.buckets.get(key)!;
    const capacity = (this.capacities.get(key) ?? this.initialCapacity) * 2;

    // The geometry needs a copy of its own: attribute buffer lengths follow the capacity, and
    // sharing leaves the old one too short.
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
   * Removes one cell's instance by moving the last one into the vacated slot.
   *
   * Matrices, colours and every custom attribute move together: missing any one leaves the moved
   * building wearing the removed building's data, and only after the player demolishes something.
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
    mesh.visible = this.gate && lastIdx > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Clears every instance while keeping the GPU buffers, for a full map rebuild. */
  reset(): void {
    for (const [key, mesh] of this.buckets) {
      mesh.count = 0;
      mesh.visible = false;
      this.counts.set(key, 0);
      this.reverse.get(key)!.clear();
    }
    this.entries.clear();
  }

  /** Marks every bucket's matrices and colours for upload. One call after a batch of additions is enough. */
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

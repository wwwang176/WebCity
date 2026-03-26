/**
 * Tracks per-cell instance indices within a pre-allocated THREE.InstancedMesh.
 * Uses individual swap-with-last removal (same pattern as BuildingRenderer).
 *
 * Each cell can own a variable number of instances (e.g., 1-3 road strips,
 * 0-4 sidewalks, 0-12 lane markings). Indices are tracked per cell.
 */
import type * as THREE from 'three';

export class RoadInstanceTracker {
  private readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private usedCount = 0;

  /** cell key → set of instance indices owned by this cell */
  private cellToIndices = new Map<string, number[]>();
  /** instance index → cell key (dense, length = usedCount) */
  private idxToCell: string[] = [];

  constructor(mesh: THREE.InstancedMesh, capacity: number) {
    this.mesh = mesh;
    this.capacity = capacity;
    mesh.count = 0;
  }

  getCount(): number { return this.usedCount; }
  hasCell(key: string): boolean { return this.cellToIndices.has(key); }
  getMesh(): THREE.InstancedMesh { return this.mesh; }

  /**
   * Reserve `count` instance slots for `cellKey` at the end of the used region.
   * Returns the start index. Caller writes matrix/color data at [start, start+count).
   * Returns -1 if capacity exceeded.
   */
  addCell(cellKey: string, count: number): number {
    if (count <= 0) return this.usedCount;
    if (this.usedCount + count > this.capacity) return -1;

    const startIdx = this.usedCount;
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      indices.push(idx);
      this.idxToCell[idx] = cellKey;
    }
    this.cellToIndices.set(cellKey, indices);
    this.usedCount += count;
    this.mesh.count = this.usedCount;
    return startIdx;
  }

  /**
   * Remove all instances owned by `cellKey` using swap-with-last for each.
   */
  removeCell(cellKey: string): void {
    const indices = this.cellToIndices.get(cellKey);
    if (!indices || indices.length === 0) { this.cellToIndices.delete(cellKey); return; }

    const matArr = this.mesh.instanceMatrix.array as Float32Array;
    const colorArr = this.mesh.instanceColor?.array as Float32Array | undefined;
    const hlAttr = this.mesh.geometry.getAttribute('aHighlight') as THREE.InstancedBufferAttribute | null;
    const hlcAttr = this.mesh.geometry.getAttribute('aHighlightColor') as THREE.InstancedBufferAttribute | null;

    // Process removals in reverse order of index to avoid invalidating earlier indices
    const sorted = [...indices].sort((a, b) => b - a);

    for (const removeIdx of sorted) {
      const lastIdx = this.usedCount - 1;

      if (removeIdx !== lastIdx) {
        // Swap with last: copy last instance data into removeIdx
        matArr.copyWithin(removeIdx * 16, lastIdx * 16, lastIdx * 16 + 16);
        if (colorArr) colorArr.copyWithin(removeIdx * 3, lastIdx * 3, lastIdx * 3 + 3);
        if (hlAttr) (hlAttr.array as Float32Array)[removeIdx] = (hlAttr.array as Float32Array)[lastIdx]!;
        if (hlcAttr) {
          const a = hlcAttr.array as Float32Array;
          a[removeIdx * 3] = a[lastIdx * 3]!;
          a[removeIdx * 3 + 1] = a[lastIdx * 3 + 1]!;
          a[removeIdx * 3 + 2] = a[lastIdx * 3 + 2]!;
        }

        // Update tracking for the moved instance
        const movedCellKey = this.idxToCell[lastIdx]!;
        this.idxToCell[removeIdx] = movedCellKey;

        // Update the moved cell's index list
        if (movedCellKey !== cellKey) {
          const movedIndices = this.cellToIndices.get(movedCellKey);
          if (movedIndices) {
            const mi = movedIndices.indexOf(lastIdx);
            if (mi >= 0) movedIndices[mi] = removeIdx;
          }
        }
      }

      this.usedCount--;
    }

    this.mesh.count = this.usedCount;
    this.idxToCell.length = this.usedCount;
    this.cellToIndices.delete(cellKey);

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (hlAttr) hlAttr.needsUpdate = true;
    if (hlcAttr) hlcAttr.needsUpdate = true;
  }

  /** Reset all tracking (for full rebuild). */
  clear(): void {
    this.usedCount = 0;
    this.mesh.count = 0;
    this.cellToIndices.clear();
    this.idxToCell.length = 0;
  }
}

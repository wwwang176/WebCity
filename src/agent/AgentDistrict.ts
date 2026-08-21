import type { DistrictPaintMode } from '../core/district/DistrictPaint';
import { DISTRICT_SWATCHES } from '../core/district/DistrictPalette';

/**
 * 行政區。
 *
 * ## 格子不在這裡畫
 *
 * 分區的格子是**拖出來的** —— `act({ tool: 'district', x1, y1, x2, y2 })` 走的就是
 * 玩家手上那支筆刷。這一層決定的是筆刷**指向誰**、用**哪一種模式**（併入／取代／
 * 扣除），以及分區本身的增刪改名換色。
 *
 * ## 一律先驗 id
 *
 * `DistrictManager` 的寫入遇到不存在的 id 幾乎都是靜靜地 return，唯獨
 * `mergeDistricts` 是**丟例外**。兩種都不能讓它發生:前者會回一個什麼都沒做的
 * `ok: true`，後者會把例外丟到呼叫端手上。所以每一支進遊戲之前都先查過。
 *
 * ## 名字不給撞
 *
 * 分區靠 id 分辨，但人是靠名字講話的。清單上兩個 Downtown 會讓「把 Downtown 的
 * 壅塞費關掉」變成一句沒有答案的話。遊戲自己不擋（自動命名會避開，手動取名不會），
 * 這一層擋。
 */

export interface DistrictRecord {
  id: string;
  name: string;
  cells: ReadonlySet<string>;
  colorIndex?: number | undefined;
}

export interface DistrictHost {
  all(): readonly DistrictRecord[];
  create(name?: string): string;
  remove(id: string): void;
  rename(id: string, name: string): void;
  setColor(id: string, colorIndex: number | undefined): void;
  merge(keepId: string, mergedId: string): string;
  activeId(): string | null;
  setActive(id: string | null): void;
  paintMode(): DistrictPaintMode;
  setPaintMode(mode: DistrictPaintMode): void;
}

export const PAINT_MODES: readonly DistrictPaintMode[] = ['replace', 'add', 'subtract'];

export interface DistrictInfo {
  id: string;
  name: string;
  cellCount: number;
  /** 色票索引。沒指定過就是 `null`（＝用預設配色）。 */
  colorIndex: number | null;
  /** 筆刷現在指著它。 */
  active: boolean;
}

export interface BrushInfo {
  active: string | null;
  mode: DistrictPaintMode;
  modes: readonly DistrictPaintMode[];
}

export interface DistrictResult {
  ok: boolean;
  districtId?: string | null;
  name?: string;
  colorIndex?: number;
  mode?: DistrictPaintMode;
  reason?: string;
}

export class AgentDistrict {
  constructor(private readonly host: DistrictHost) {}

  // ── 看 ──────────────────────────────────────────────────────────

  list(): DistrictInfo[] {
    const active = this.host.activeId();
    return this.host.all().map(d => ({
      id: d.id,
      name: d.name,
      cellCount: d.cells.size,
      colorIndex: d.colorIndex ?? null,
      active: d.id === active,
    }));
  }

  /** 筆刷指著誰。 */
  active(): string | null {
    return this.host.activeId();
  }

  /** 筆刷的狀態:指著誰、什麼模式、有哪些模式。 */
  brush(): BrushInfo {
    return { active: this.host.activeId(), mode: this.host.paintMode(), modes: PAINT_MODES };
  }

  // ── 筆刷 ────────────────────────────────────────────────────────

  /** 把筆刷指到某一區。`null` 是放掉 —— 下一筆拖曳會開一個新的分區。 */
  setActive(districtId: string | null): DistrictResult {
    if (districtId !== null && !this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    this.host.setActive(districtId);
    return { ok: true, districtId };
  }

  setBrushMode(mode: string): DistrictResult {
    if (!(PAINT_MODES as readonly string[]).includes(mode)) {
      return { ok: false, reason: `brush mode must be one of ${PAINT_MODES.join(', ')}: ${mode}` };
    }
    this.host.setPaintMode(mode as DistrictPaintMode);
    return { ok: true, mode: mode as DistrictPaintMode };
  }

  // ── 增刪改 ──────────────────────────────────────────────────────

  /** 開一個新分區，並且把筆刷指過去。不給名字的話遊戲自己編號。 */
  create(name?: string): DistrictResult {
    if (name !== undefined) {
      const bad = this.badName(name, null);
      if (bad) return { ok: false, name, reason: bad };
    }
    const id = this.host.create(name?.trim());
    const made = this.host.all().find(d => d.id === id);
    return { ok: true, districtId: id, name: made?.name ?? name ?? '' };
  }

  rename(districtId: string, name: string): DistrictResult {
    if (!this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    const bad = this.badName(name, districtId);
    if (bad) return { ok: false, districtId, name, reason: bad };

    this.host.rename(districtId, name.trim());
    return { ok: true, districtId, name: name.trim() };
  }

  /** 換色票。索引是 `DISTRICT_SWATCHES` 的位置。 */
  setColor(districtId: string, colorIndex: number): DistrictResult {
    if (!this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    // 核心會把超出範圍的靜靜換成 undefined（退回預設色）—— 那看起來就像沒反應。
    if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= DISTRICT_SWATCHES.length) {
      return {
        ok: false, districtId,
        reason: `colour index must be 0..${DISTRICT_SWATCHES.length - 1}: ${colorIndex}`,
      };
    }
    this.host.setColor(districtId, colorIndex);
    return { ok: true, districtId, colorIndex };
  }

  /**
   * 整個分區刪掉，連同它身上的條例。格子回到「不屬於任何分區」。
   *
   * 筆刷正指著它的話要一起放掉 —— 指著一個不存在的分區時，下一筆拖曳只會拿到
   * 「Pick a district first」，而工具列看起來一切正常。
   */
  delete(districtId: string): DistrictResult {
    if (!this.exists(districtId)) {
      return { ok: false, districtId, reason: `no district with id ${districtId}` };
    }
    const wasActive = this.host.activeId() === districtId;
    this.host.remove(districtId);
    if (wasActive) this.host.setActive(null);
    return { ok: true, districtId };
  }

  /** 把 `mergedId` 併進 `keepId`。格子跟過去，`mergedId` 消失。 */
  merge(keepId: string, mergedId: string): DistrictResult {
    for (const id of [keepId, mergedId]) {
      if (!this.exists(id)) return { ok: false, districtId: id, reason: `no district with id ${id}` };
    }
    if (keepId === mergedId) {
      return { ok: false, districtId: keepId, reason: 'cannot merge a district into itself' };
    }
    const wasActive = this.host.activeId() === mergedId;
    const kept = this.host.merge(keepId, mergedId);
    if (wasActive) this.host.setActive(kept);
    return { ok: true, districtId: kept };
  }

  // ── 內部 ────────────────────────────────────────────────────────

  private exists(id: string): boolean {
    return this.host.all().some(d => d.id === id);
  }

  /** `exceptId` 是「這個名字本來就是我的」—— 改色不改名的呼叫端會把原名送回來。 */
  private badName(name: string, exceptId: string | null): string | null {
    const trimmed = name.trim();
    if (trimmed === '') return 'district name cannot be blank';
    const clash = this.host.all().find(d => d.name === trimmed && d.id !== exceptId);
    return clash ? `district ${clash.id} is already called ${trimmed}` : null;
  }
}

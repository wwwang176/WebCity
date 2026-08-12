import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tagPart, PART_WALL } from '../parts';
import { HALF_ENVELOPE } from './metrics';
import { maxAbsOf, partOf, type Volume } from './volume';
import { METRES_PER_CELL } from '../../../../core/grid/constants';

/**
 * `massing/` 裡唯一碰 Three.js 的地方。
 *
 * 所有形狀都用同一個 `frustum` 產生，差別只在頂面的尺寸與偏移：盒子的頂面與底面
 * 同大、山牆的頂面是一條線、四坡的頂面是一小塊、單斜的頂面是推到一側的線。
 * 五個形狀寫成五份幾何是五份幾乎一樣的頂點算術，而算錯只表現為
 * 「某個變體的屋頂怪怪的」。
 */

/** 山牆的屋脊寬度佔比。0 會產生退化三角形，所以留一條細邊。 */
const RIDGE = 0.04;

/**
 * 一個底面 w×d、頂面 topW×topD（可偏移）的稜台。
 *
 * `y0 === 0` 時省略底面：那兩個三角形永遠貼在地上，看不到。
 */
function frustum(
  v: Volume, topW: number, topD: number, offX: number, offZ: number,
): THREE.BufferGeometry {
  const hw = v.w / 2;
  const hd = v.d / 2;
  const tw = topW / 2;
  const td = topD / 2;
  const b: Array<[number, number]> = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const t: Array<[number, number]> = [
    [offX - tw, offZ - td], [offX + tw, offZ - td],
    [offX + tw, offZ + td], [offX - tw, offZ + td],
  ];

  const pos: number[] = [];
  /**
   * 一個四邊形，四個角**逆時針排列（從該面的外側看）**。
   *
   * 纏繞方向決定 `computeVertexNormals` 算出來的法線指向哪一側，而建築材質是
   * `FrontSide` —— 反了就會看到建築的內壁，而且不會有任何東西報錯（BUG-227）。
   */
  const quad = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
  ) => { pos.push(...p0, ...p2, ...p1, ...p0, ...p3, ...p2); };

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(
      [b[i]![0], v.y0, b[i]![1]], [b[j]![0], v.y0, b[j]![1]],
      [t[j]![0], v.y1, t[j]![1]], [t[i]![0], v.y1, t[i]![1]],
    );
  }
  // 頂面
  quad(
    [t[0]![0], v.y1, t[0]![1]], [t[1]![0], v.y1, t[1]![1]],
    [t[2]![0], v.y1, t[2]![1]], [t[3]![0], v.y1, t[3]![1]],
  );
  // 底面只有離地時才需要 —— 貼在地上的那兩個三角形永遠看不到。
  if (v.y0 > 1e-6) {
    quad(
      [b[3]![0], v.y0, b[3]![1]], [b[2]![0], v.y0, b[2]![1]],
      [b[1]![0], v.y0, b[1]![1]], [b[0]![0], v.y0, b[0]![1]],
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  geo.translate(v.x, 0, v.z);
  return geo;
}

/** 一片鋸齒天窗的跨距：大約 6 m 一道，與真實廠房接近。 */
const SAWTOOTH_SPAN = 6 / METRES_PER_CELL;

/**
 * 圓柱的邊數。8 在等角視角下已經讀得出圓，而且**有頂點落在 ±x 與 ±z 上** ——
 * 所以縮放之後它剛好填滿宣告的盒子，量體算出來的牆面位置仍然對得上幾何。
 */
const CYLINDER_SIDES = 8;

/**
 * 圓柱：煙囪、筒倉、儲槽。
 *
 * 這是唯一不走 `frustum` 的形狀。用 `THREE.CylinderGeometry` 而不是自己疊三角形，
 * 因為它的纏繞方向本來就是外向的（BUG-227 的教訓）；但它是索引幾何又帶 uv，
 * 跟 `frustum` 的產物合併不起來，所以要先去掉 uv 再攤平。
 *
 * 攤平之後重算法線是刻意的：拿到的是平面著色，與其他形狀的低多邊形觀感一致。
 * 順序不能換 —— 非等比縮放會扭曲既有的法線。
 */
function cylinder(v: Volume): THREE.BufferGeometry {
  const src = new THREE.CylinderGeometry(0.5, 0.5, v.y1 - v.y0, CYLINDER_SIDES);
  src.deleteAttribute('uv');
  const geo = src.toNonIndexed();
  src.dispose();
  geo.scale(v.w, 1, v.d);
  geo.computeVertexNormals();
  geo.translate(v.x, (v.y0 + v.y1) / 2, v.z);
  return geo;
}

/**
 * 半球：圓頂。
 *
 * 與 `cylinder` 同一條路徑（THREE 圖元 → 去 uv → 攤平 → 重算法線 → 縮放），
 * 理由也一樣：`SphereGeometry` 的纏繞方向本來就是外向的，而它帶 uv 又是索引
 * 幾何，不先攤平就與 `frustum` 的產物合併不起來。
 *
 * 分段數與圓柱同為 8：兩者常常疊在一起（圓頂坐在筒身上），邊數不同的話
 * 接縫會露出來。垂直分 4 段 —— 再少就會讀成一頂斗笠。
 */
function dome(v: Volume): THREE.BufferGeometry {
  const src = new THREE.SphereGeometry(
    0.5, CYLINDER_SIDES, 4, 0, Math.PI * 2, 0, Math.PI / 2,
  );
  src.deleteAttribute('uv');
  const geo = src.toNonIndexed();
  src.dispose();
  // 半球的 y ∈ [0, 0.5]，要撐滿宣告的 [y0, y1]。
  geo.scale(v.w, (v.y1 - v.y0) * 2, v.d);
  geo.computeVertexNormals();
  geo.translate(v.x, v.y0, v.z);
  return geo;
}

/**
 * 冷卻塔：**有腰的**旋轉體。
 *
 * 電廠在低多邊形城市裡最好認的剪影就是它，而那個形狀的實體只有一件事 ——
 * 中段比上下都窄。圓柱是直的、稜台是單調收放，兩個都做不出腰，所以這是
 * 唯一需要自己給側面輪廓的形狀。
 *
 * 用 `LatheGeometry` 把輪廓轉一圈。輪廓取雙曲線 r(t) = √(1 + ((t − w) / c)²)，
 * 正規化成「最寬處剛好填滿宣告的盒子」—— 與其他形狀一樣，量體算出來的邊界
 * 就是幾何真正佔的地方。
 */
function coolingTower(v: Volume): THREE.BufferGeometry {
  /** 腰在高度的幾成。0.65 ≈ 實際冷卻塔的比例。 */
  const WAIST = 0.65;
  /** 雙曲線的收斂速度。愈小腰愈細。 */
  const C = 0.85;
  const RINGS = 6;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    profile.push(new THREE.Vector2(Math.sqrt(1 + ((t - WAIST) / C) ** 2), t));
  }
  // 最寬的一圈（底座）正規化成半徑 0.5，這樣縮放之後剛好填滿盒子。
  const widest = Math.max(...profile.map(p => p.x));
  for (const p of profile) p.x = (p.x / widest) * 0.5;

  // 塔口折進去再往下 —— **這一段修的正是俯視時的那個破口。**
  //
  // 原本輪廓走到頂就停了，上下都沒有蓋，也就是一根開口的管子。建築材質是
  // `FrontSide`，所以視角一高、看得進管口的時候，對面的內壁被背面剔除，
  // 看到的是穿過去的背景 —— 整座塔讀成兩片破掉的殼。（煙囪走
  // `CylinderGeometry`、本來就有頂蓋，沒事；破的一直是這兩座。）
  //
  // 補一片平蓋是錯的答案：真實的冷卻塔頂上就是開的，蓋起來它會變成筒倉。
  // 折回去的這一段法線朝向軸心，所以俯視看到的是**內壁**，而那正是凹槽。
  const lip = profile[profile.length - 1]!.x;
  profile.push(new THREE.Vector2(lip * 0.86, 1));
  profile.push(new THREE.Vector2(lip * 0.86, 0.94));
  profile.push(new THREE.Vector2(0, 0.94));

  return lathe(profile, v);
}

/**
 * 煙囪：塔身微收，頂上一圈環，環的內側**凹下去**。
 *
 * 圓柱的頂是一片實心的圓盤，而真的煙囪頂上是一個洞 —— 十幾公尺高的東西
 * 在等角視角下最先看到的就是它的頂。
 *
 * 凹槽用兩個同心圓柱做不出來：外筒的頂蓋會把內筒整個蓋掉。把外筒改成無蓋的
 * 管子也沒用 —— 建築材質是 `FrontSide`，管壁的法線朝外，俯視時內側被背面
 * 剔除，看到的是「穿過去」，也就是俯視時的那個破口。
 *
 * 旋轉體給得出來：輪廓在頂端折回去往下走，那一段的法線跟著朝向軸心，
 * 所以俯視看得到的是凹槽的**內壁**而不是它的背面。
 */
function chimney(v: Volume): THREE.BufferGeometry {
  /** 管口內緣的半徑（佔宣告寬度的一半的幾成）。 */
  const BORE = 0.26;
  /** 塔身收到頂端剩多少 —— 真實煙囪都是微微收的。 */
  const COLLAR = 0.44;
  /** 凹槽的深度，佔全高的比例。 */
  const DEPTH = 0.12;
  return lathe([
    new THREE.Vector2(0.5, 0),            // 底座
    new THREE.Vector2(COLLAR, 1 - DEPTH * 0.7), // 微收的塔身
    new THREE.Vector2(COLLAR, 1),         // 管口外緣
    new THREE.Vector2(BORE, 1),           // 管口的環
    new THREE.Vector2(BORE, 1 - DEPTH),   // 凹槽內壁（法線朝軸心）
    new THREE.Vector2(0, 1 - DEPTH),      // 槽底
  ], v);
}

/**
 * 一條輪廓轉一圈。`cooling` 與 `stack` 共用。
 *
 * 與 `cylinder` 同一條路徑（去 uv → 攤平 → 縮放 → 重算法線 → 位移），
 * 順序不能換：非等比縮放會扭曲既有的法線。輪廓的 x ∈ [0, 0.5]、y ∈ [0, 1]，
 * 縮放之後剛好填滿宣告的盒子。
 */
function lathe(profile: THREE.Vector2[], v: Volume): THREE.BufferGeometry {
  const src = new THREE.LatheGeometry(profile, CYLINDER_SIDES);
  src.deleteAttribute('uv');
  const geo = src.toNonIndexed();
  src.dispose();
  geo.scale(v.w, v.y1 - v.y0, v.d);
  geo.computeVertexNormals();
  geo.translate(v.x, v.y0, v.z);
  return geo;
}

/**
 * 一個量體的幾何。一份量體可能產出多份幾何（鋸齒天窗是一排）。
 *
 * 匯出是給 `geometry/civic/` 用的 —— 公共建築用同一組圖元，但護欄不同
 * （擋佔地邊界而不是行人包絡線）。圖元各寫一份的下場這個專案已經示範過
 * （BUG-231 的地板顏色）。
 */
export function shapeOf(v: Volume): THREE.BufferGeometry[] {
  const alongZ = (v.facing ?? 0) % 2 === 0;
  const sign = (v.facing ?? 0) < 2 ? 1 : -1;

  switch (v.shape ?? 'box') {
    case 'box':
      return [frustum(v, v.w, v.d, 0, 0)];
    case 'cylinder':
      return [cylinder(v)];
    case 'dome':
      return [dome(v)];
    case 'cooling':
      return [coolingTower(v)];
    case 'stack':
      return [chimney(v)];
    case 'gable':
      return alongZ
        ? [frustum(v, v.w, v.d * RIDGE, 0, 0)]
        : [frustum(v, v.w * RIDGE, v.d, 0, 0)];
    case 'hip':
      return [frustum(v, v.w * 0.2, v.d * 0.2, 0, 0)];
    case 'shed':
      return alongZ
        ? [frustum(v, v.w, v.d * RIDGE, 0, sign * (v.d / 2) * (1 - RIDGE))]
        : [frustum(v, v.w * RIDGE, v.d, sign * (v.w / 2) * (1 - RIDGE), 0)];
    case 'sawtooth': {
      const n = Math.max(2, Math.round(v.d / SAWTOOTH_SPAN));
      const teethD = v.d / n;
      const out: THREE.BufferGeometry[] = [];
      for (let i = 0; i < n; i++) {
        const z = v.z - v.d / 2 + teethD * (i + 0.5);
        out.push(frustum(
          { ...v, z, d: teethD },
          v.w, teethD * RIDGE, 0, sign * (teethD / 2) * (1 - RIDGE),
        ));
      }
      return out;
    }
  }
}

/**
 * 量體轉幾何。越過行人包絡線時**丟例外**。
 *
 * 例外在遊戲執行時不該發生：生成器是確定性的、變體集合固定，所以測試跑過就
 * 表示永遠不會丟。那個 throw 是給未來改原型的人的護欄，不是執行期的錯誤處理 ——
 * 靜靜地讓行人穿牆比當場炸掉難追一百倍。
 */
export function assemble(volumes: readonly Volume[]): THREE.BufferGeometry {
  const over = maxAbsOf(volumes) - HALF_ENVELOPE;
  if (over > 1e-6) {
    throw new Error(
      `量體越過行人包絡線 ${(over * METRES_PER_CELL).toFixed(3)} m —— 行人會穿牆（BUG-221）`,
    );
  }

  const parts: THREE.BufferGeometry[] = [];
  for (const v of volumes) {
    for (const g of shapeOf(v)) {
      tagPart(g, partOf(v));
      parts.push(g);
    }
  }
  if (parts.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    tagPart(empty, PART_WALL);
    return empty;
  }
  return mergeGeometries(parts)!;
}

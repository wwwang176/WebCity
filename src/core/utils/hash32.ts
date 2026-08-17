/**
 * 一顆便宜、確定、看起來夠亂的 32 位元雜湊。
 *
 * 程序生成的名字全部靠它:市民、建築。共用一份的理由是那條「城市種子要用乘的、
 * 不能用加的」的性質 —— 各寫各的話，第二個地方會再犯一次。
 */

/**
 * splitmix32 的 finalizer。把低位的變化擴散到所有位元上。
 *
 * 沒有它的話，連號的輸入取模之後就是連號的輸出 —— 而這裡的輸入（市民流水號、
 * 格子座標）本來就都是連號的。
 */
export function mix32(h: number): number {
  let x = h >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * 把「這一個東西」「哪一種用途」「哪一座城市」揉成一個雜湊。
 *
 * `citySeed` 先乘一顆奇質數。直接加的話，種子只差 1 的兩座城市會拿到幾乎一樣的
 * 結果 —— `key` 也是連號的，兩邊的差會互相抵消，名單整份重播只錯開一位。
 *
 * 位元運算自己會做 ToInt32，負數、小數、超過 32 位元的輸入都在這裡被收乾淨。
 */
export function hash32(key: number, salt: number, citySeed = 0): number {
  return mix32((Math.imul(citySeed, 0x27220a95) ^ key ^ salt) >>> 0);
}

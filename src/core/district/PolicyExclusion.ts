import { PolicyType } from './types';

/**
 * 互斥組:同一組裡最多只有一條能生效。
 *
 * 賭場、夜間經濟、宵禁是同一個決定的三個答案 —— 這一區的夜晚要放開、放一半、
 * 還是關起來。三個同時成立沒有意義，而且疊起來是純賺:賭場疊夜間經濟是商業收入
 * +68.75%，多出來的犯罪還能再用宵禁抵掉一部分。
 *
 * 分組而不是逐對排除，是因為「哪些條例互相衝突」會隨目錄長大，而逐對的表格會長
 * 成平方個條目，漏掉一對不會有任何徵兆。
 */
const EXCLUSIVE_GROUPS: readonly (readonly PolicyType[])[] = [
  [PolicyType.LEGALIZE_GAMBLING, PolicyType.NIGHT_ECONOMY, PolicyType.CURFEW],
];

/** 條例 → 它屬於第幾組。不屬於任何組的就不在這張表裡。 */
export const EXCLUSIVE_GROUP_OF: ReadonlyMap<PolicyType, number> = new Map(
  EXCLUSIVE_GROUPS.flatMap((g, i) => g.map(t => [t, i] as const)),
);

/** 同組的其他條例。不屬於任何組的話是空陣列。 */
export function conflictsWith(type: PolicyType): readonly PolicyType[] {
  const group = EXCLUSIVE_GROUPS.find(g => g.includes(type));
  return group ? group.filter(t => t !== type) : [];
}

/**
 * 這條條例在它那一組裡的位置。不屬於任何組的話是 -1。
 *
 * 存檔要靠它決定同組衝突時留哪一條。用存檔陣列的順序不行 —— 同一個手改過的檔案
 * 換個排列就讀出不同結果，玩家沒有辦法知道發生了什麼事。
 */
export function exclusiveGroupRank(type: PolicyType): number {
  const group = EXCLUSIVE_GROUPS.find(g => g.includes(type));
  return group ? group.indexOf(type) : -1;
}

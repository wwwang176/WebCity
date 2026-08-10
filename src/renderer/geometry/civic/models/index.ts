import type { InfraType } from '../../../../core/building/InfraConfig';
import type { CivicPlan } from '../types';
import { policePlan } from './police';
import { firePlan } from './fire';
import { hospitalPlan } from './hospital';
import { schoolPlan } from './school';

/**
 * 已經改造完成的公共建築。
 *
 * **靜態表，不是靠副作用註冊的。** 副作用註冊（每個 model 檔在載入時呼叫
 * `registerCivicPlan`）的失敗模式是靜默的：沒有人 import 到那個檔案，那種
 * 建築就不存在，而畫面上只表現為「我改的那棟沒有出現」。靜態表把「有沒有
 * 接上」變成型別問題 —— 漏了一列，選單裡就是少一個，看得見。
 *
 * 一個檔案一棟建築（spec §4.5）：每棟的量體描述會長到 80–150 行含註解，
 * 放在一起就是第二個 2929 行的 `BuildingRenderer.ts`。
 *
 * 這張表是逐批填滿的。沒列在這裡的種類仍然走 `BuildingRenderer` 舊的手寫
 * `MeshLambertMaterial` 路徑，所以半途的狀態是可用的，不必等 19 種全做完。
 */
export const CIVIC_MODELS: Partial<Record<InfraType, CivicPlan>> = {
  // 批 1：民生服務（警局／消防局／醫院／小學／高中／大學）
  police: policePlan,
  fire: firePlan,
  hospital: hospitalPlan,
  school: schoolPlan,
  // 批 2：綠地（公園／墓園）
  // 批 3：公用設施（電廠／水廠／垃圾場／汙水廠）
  // 批 4：交通站點（公車站／捷運站／火車站／渡輪碼頭）
  // 批 5：機場（小／中／大）
};
